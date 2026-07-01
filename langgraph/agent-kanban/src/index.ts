import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage } from "@langchain/core/messages";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tools } from "./tools.js";

const SYSTEM_PROMPT =
  "你是一个针对当前工作目录的分析 agent。用 list_files / read_file 查看项目，简洁地完成被指派的任务。请用中文，控制在两三句话内。";

const model = new ChatAnthropic({ model: "claude-sonnet-4-6", temperature: 0 });
const modelWithTools = model.bindTools(tools);

// 复用 LangGraph 的「模型节点 → 工具节点 → 模型节点」循环；带 MemorySaver，
// 每个看板卡片用各自的 thread_id 作为一次独立的 agent run。
async function llmCall(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    ...state.messages,
  ]);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1);
  if (!last || !AIMessage.isInstance(last)) return END;
  return last.tool_calls?.length ? "tools" : END;
}

const agent = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", llmCall)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["tools", END])
  .addEdge("tools", "llmCall")
  .compile({ checkpointer: new MemorySaver() });

type Status = "QUEUED" | "RUNNING" | "DONE" | "ERROR";
interface Card {
  id: string;
  title: string;
  prompt: string;
  status: Status;
  summary?: string;
  error?: string;
}

// 每张卡片 = 一次独立的 agent run（对应原案例里的一个 Cloud Agent）。
const cards: Card[] = [
  { id: "deps", title: "依赖审计", prompt: "读 package.json，列出运行时依赖和开发依赖各有哪些。", status: "QUEUED" },
  { id: "structure", title: "结构概览", prompt: "查看目录结构，用一句话说明这个项目的组织方式。", status: "QUEUED" },
  { id: "readme", title: "README 摘要", prompt: "读 README.md，用两句话概括这个项目是做什么的。", status: "QUEUED" },
  { id: "scripts", title: "脚本说明", prompt: "读 package.json 的 scripts 字段，说明每个脚本的作用。", status: "QUEUED" },
  { id: "entry", title: "入口分析", prompt: "找到并阅读 src 下的入口源码，用两句话说明它做了什么。", status: "QUEUED" },
];

const COLUMNS: Status[] = ["QUEUED", "RUNNING", "DONE", "ERROR"];
const ICON: Record<Status, string> = { QUEUED: "○", RUNNING: "◐", DONE: "●", ERROR: "✗" };

function render(): void {
  console.clear();
  console.log("Agent 看板 — 本地多 agent run 生命周期（并发上限 2）\n");
  for (const col of COLUMNS) {
    const items = cards.filter((c) => c.status === col);
    console.log(`${ICON[col]} ${col} (${items.length})`);
    for (const c of items) {
      const detail = c.summary ? ` — ${c.summary}` : c.error ? ` — ⚠ ${c.error}` : "";
      console.log(`    ${c.title}${detail}`);
    }
    console.log("");
  }
}

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

async function runCard(card: Card): Promise<void> {
  card.status = "RUNNING";
  render();
  try {
    const res = await agent.invoke(
      { messages: [{ role: "user", content: card.prompt }] },
      { configurable: { thread_id: card.id } },
    );
    const text = textOf(res.messages.at(-1)?.content).replace(/\s+/g, " ").trim();
    card.summary = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    card.status = "DONE";
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
    card.error = msg.length > 80 ? `${msg.slice(0, 80)}…` : msg;
    card.status = "ERROR";
  }
  render();
}

/** 简单的并发池：最多 limit 个卡片同时 RUNNING，其余在 QUEUED 等待。 */
async function runPool(limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cards.length) {
      await runCard(cards[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, cards.length) }, worker));
}

async function main(): Promise<void> {
  render();
  await runPool(2);
  const ok = cards.filter((c) => c.status === "DONE").length;
  console.log(`全部结束 — ${ok}/${cards.length} 成功。`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
