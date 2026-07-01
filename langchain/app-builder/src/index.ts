import * as readline from "node:readline/promises";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { BUILD_DIR, tools } from "./tools.js";

const SYSTEM_PROMPT = [
  "你是一个应用搭建助手。用户用自然语言描述想要的网页应用，你用 write_file 把它建到构建目录里。",
  "优先生成可直接在浏览器打开的单页应用：一个自包含的 `index.html`（可通过 CDN 引入 React 等），",
  "必要时再拆分 `app.js` / `style.css`。迭代时先用 read_file 看现有内容，再增量修改。",
  "每次改动后用一两句话说明你做了什么。请用中文。",
].join("");

// 使用 OpenAI-compatible 中转站；key / baseURL / model 都从 .env 读取。
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
const modelName = process.env.OPENAI_MODEL || "gpt-5.5";

const model = new ChatOpenAI({
  model: modelName,
  apiKey,
  configuration: { baseURL },
  temperature: 0,
});

// 用 MemorySaver 让多轮迭代记住此前生成的应用上下文（“把按钮改成蓝色”能接上文）。
const agent = createAgent({
  model,
  tools,
  systemPrompt: SYSTEM_PROMPT,
  checkpointer: new MemorySaver(),
});

async function streamAnswer(content: string, threadId: string): Promise<void> {
  const stream = await agent.streamEvents(
    { messages: [{ role: "user", content }] },
    { version: "v3", configurable: { thread_id: threadId } },
  );
  for await (const message of stream.messages) {
    for await (const token of message.text) {
      process.stdout.write(token);
    }
  }
  process.stdout.write("\n");
}

/** 打印构建目录当前的文件清单，便于查看生成结果。 */
async function printTree(): Promise<void> {
  const entries = await fs.readdir(BUILD_DIR, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.name !== ".DS_Store").map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
  const rel = path.relative(process.cwd(), BUILD_DIR) || ".";
  console.log(files.length ? `\n[${rel}/] ${files.join("  ")}` : `\n[${rel}/] (空)`);
}

async function main(): Promise<void> {
  await fs.mkdir(BUILD_DIR, { recursive: true });
  const oneShot = process.argv.slice(2).join(" ").trim();

  if (oneShot) {
    await streamAnswer(oneShot, "oneshot");
    await printTree();
    return;
  }

  const rel = path.relative(process.cwd(), BUILD_DIR) || ".";
  console.log(`应用搭建助手 — 描述你想要的网页应用，会生成到 ${rel}/。输入 /exit 退出。\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      await streamAnswer(line, "repl");
      await printTree();
      process.stdout.write("\n");
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
