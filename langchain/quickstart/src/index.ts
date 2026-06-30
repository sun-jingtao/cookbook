import { createAgent } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = [
  "你是一个本地代码库助手，工作目录就是当前项目根目录。",
  "当被要求解释项目时，先用 list_files 查看结构、用 read_file 读取关键文件（如 README、package.json、入口源码），",
  "再用一段话给出解释。请用中文回答。",
].join("");

const PROMPT = "用一段话解释这个项目。";

// 与 Cursor 的 composer-2.5 对应，这里用 Claude 作为推理模型。
// ChatAnthropic 默认读取环境变量 ANTHROPIC_API_KEY。
const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0,
});

// LangChain v1 版：使用 createAgent 这个标准 Agent harness。
const agent = createAgent({
  model,
  tools,
  systemPrompt: SYSTEM_PROMPT,
});

// v1.3+ 推荐使用 streamEvents v3 的 typed projections，而不是手动解析 streamMode tuple。
const stream = await agent.streamEvents(
  { messages: [{ role: "user", content: PROMPT }] },
  { version: "v3" },
);

for await (const message of stream.messages) {
  for await (const token of message.text) {
    process.stdout.write(token);
  }
}

process.stdout.write("\n");
