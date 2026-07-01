import { promises as fs } from "node:fs";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import {
  END,
  GraphNode,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import * as z from "zod";
import { type Complexity, type Task, computeRanks, parseDAG } from "./dag.js";

const SYSTEM_PROMPT =
  "你是一个 DAG 流水线中的子任务执行器。只完成本子任务，输出简洁、可直接被下游任务消费。请用中文。";

// 使用 OpenAI-compatible 中转站；key / baseURL 从 .env 读取。
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("缺少 OPENAI_API_KEY，请在 .env 中填写中转站 key。");
}
const rawBaseURL = process.env.OPENAI_BASE_URL;
if (!rawBaseURL) {
  throw new Error("缺少 OPENAI_BASE_URL，请在 .env 中填写 OpenAI-compatible 中转站地址。");
}
const baseURL = rawBaseURL.replace(/\/$/, "").endsWith("/v1")
  ? rawBaseURL.replace(/\/$/, "")
  : `${rawBaseURL.replace(/\/$/, "")}/v1`;

// 复刻原案例「complexity 驱动模型选型」：三档可分别用 OPENAI_MODEL_HIGH/MED/LOW
// 指定不同模型；都缺省时统一回退到 OPENAI_MODEL（单模型中转站只需设这一个）。
const FALLBACK_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const MODEL_BY_COMPLEXITY: Record<Complexity, string> = {
  HIGH: process.env.OPENAI_MODEL_HIGH || FALLBACK_MODEL,
  MED: process.env.OPENAI_MODEL_MED || FALLBACK_MODEL,
  LOW: process.env.OPENAI_MODEL_LOW || FALLBACK_MODEL,
};

const UPSTREAM_CHAR_CAP = 2000;

// 共享状态：一个 taskId -> 产物文本 的 map。reducer 让并行节点并发写入时
// 安全合并（不同 key 互不覆盖），这是 LangGraph 并行 fan-out 的关键。
const State = new StateSchema({
  outputs: new ReducedValue(z.record(z.string(), z.string()).default(() => ({})), {
    reducer: (a: Record<string, string>, b: Record<string, string>) => ({ ...a, ...b }),
  }),
});

/** 把消息内容（字符串或内容块数组）抽取为纯文本。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "string"
          ? b
          : b && typeof b === "object" && (b as { type?: string }).type === "text"
            ? ((b as { text?: string }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

/** 把一个 DAG 任务包成一个图节点：拼接上游产物 → 调模型 → 写回自己的产物。 */
function makeNode(task: Task): GraphNode<typeof State> {
  const model = new ChatOpenAI({
    model: MODEL_BY_COMPLEXITY[task.complexity],
    apiKey,
    configuration: { baseURL },
    temperature: 0,
  });
  return async (state) => {
    const upstream = task.depends_on
      .map((dep) => `## 上游产物：${dep}\n${(state.outputs[dep] ?? "").slice(0, UPSTREAM_CHAR_CAP)}`)
      .join("\n\n");
    const userPrompt = upstream ? `${upstream}\n\n---\n\n${task.subtask_prompt}` : task.subtask_prompt;
    const res = await model.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    return { outputs: { [task.id]: textOf(res.content) } };
  };
}

async function main() {
  const dagPath = process.argv[2] ?? "examples/example_dag.json";
  const raw = JSON.parse(await fs.readFile(path.resolve(process.cwd(), dagPath), "utf8"));
  const dag = parseDAG(raw);

  // 动态把 DAG 直接搭成 LangGraph 图：每个 task 一个节点，按 depends_on 连边。
  // 节点名在运行时才由 DAG 决定，TS 无法静态推断节点名集合，故用一个放宽
  // 签名的视图来增删节点/边（方法原地 mutate，底层仍是同一个 builder 实例）。
  type DynamicBuilder = {
    addNode(name: string, action: GraphNode<typeof State>): unknown;
    addEdge(from: string, to: string): unknown;
  };
  const builder = new StateGraph(State);
  const b = builder as unknown as DynamicBuilder;
  for (const t of dag.tasks) b.addNode(t.id, makeNode(t));
  const hasDependents = new Set(dag.tasks.flatMap((t) => t.depends_on));
  for (const t of dag.tasks) {
    if (t.depends_on.length === 0) b.addEdge(START, t.id);
    else for (const dep of t.depends_on) b.addEdge(dep, t.id);
    if (!hasDependents.has(t.id)) b.addEdge(t.id, END);
  }
  const app = builder.compile();

  // 运行前打印执行计划（同一 rank 的任务会被 LangGraph 并行执行）。
  const ranks = computeRanks(dag);
  console.log(`DAG "${dag.title}" — ${dag.tasks.length} 个任务，共 ${ranks.length} 层`);
  ranks.forEach((r, i) => console.log(`  rank ${i + 1}/${ranks.length}: ${r.map((t) => t.id).join(", ")}`));
  console.log("");

  // streamMode "updates"：每个节点完成时产出 { [nodeName]: 状态增量 }。
  const results: Record<string, string> = {};
  let done = 0;
  const byId = new Map(dag.tasks.map((t) => [t.id, t]));
  for await (const chunk of await app.stream({}, { streamMode: "updates" })) {
    for (const [node, update] of Object.entries(chunk)) {
      Object.assign(results, (update as { outputs?: Record<string, string> })?.outputs ?? {});
      done += 1;
      const model = MODEL_BY_COMPLEXITY[byId.get(node)!.complexity];
      console.log(`  ✓ ${node} (${model}) [${done}/${dag.tasks.length}]`);
    }
  }

  // 把各任务产物落盘，便于查看流水线结果。
  const outDir = path.resolve(process.cwd(), "dag-output");
  await fs.mkdir(outDir, { recursive: true });
  for (const [id, text] of Object.entries(results)) {
    await fs.writeFile(path.join(outDir, `${id}.md`), text, "utf8");
  }
  console.log(`\n完成 — ${done}/${dag.tasks.length} 个任务，产物已写入 ${path.relative(process.cwd(), outDir)}/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
