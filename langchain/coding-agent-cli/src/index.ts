import * as readline from "node:readline/promises";
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = [
  "你是一个针对当前工作目录的编码助手。",
  "可以用 list_files / read_file 查看项目结构与文件内容来回答问题。",
  "回答简洁、直接，必要时引用具体文件路径。请用中文。",
].join("");

const model = new ChatAnthropic({ model: "claude-sonnet-4-6", temperature: 0 });

// 用 MemorySaver 做线程级短期记忆：交互模式下同一 thread_id 能记住上文。
// 这对应原案例「交互式会话」相对「一次性 prompt」的区别。
const agent = createAgent({
  model,
  tools,
  systemPrompt: SYSTEM_PROMPT,
  checkpointer: new MemorySaver(),
});

/** 跑一轮：流式把助手文本逐 token 打到 stdout。 */
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

async function main(): Promise<void> {
  const oneShot = process.argv.slice(2).join(" ").trim();

  // 一次性模式：给了 prompt 就跑一次后退出（每次用独立 thread，无跨次记忆）。
  if (oneShot) {
    await streamAnswer(oneShot, "oneshot");
    return;
  }

  // 交互模式：省略 prompt 进入 REPL，同一 thread 跨轮保留记忆。
  console.log("编码助手 CLI — 针对当前目录提问。输入 /exit 退出。\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      await streamAnswer(line, "repl");
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
