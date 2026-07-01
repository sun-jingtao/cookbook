import { createAgent } from "langchain";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { tools, toText } from "./tools.js";

const SYSTEM_PROMPT = [
  "你是一个本地代码库助手，工作目录就是当前项目根目录。",
  "当被要求解释项目时，先用 list_files 查看结构、用 read_file 读取关键文件（如 README、package.json、入口源码），",
  "再用一段话给出解释。请用中文回答。",
].join("");

const PROMPT = "用一段话解释这个项目。";
const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL!;
const modelName = process.env.OPENAI_MODEL!;

if (!apiKey) {
  throw new Error("缺少 OPENAI_API_KEY，请创建或编辑 .env 后填写中转站 key。");
}

// 使用 OpenAI-compatible 中转站；key/baseURL/model 都从 .env 读取。
const model = new ChatOpenAI({
  model: modelName,
  apiKey,
  configuration: {
    baseURL,
  },
  temperature: 0,
});

// LangChain v1 版：使用 createAgent 这个标准 Agent harness。
const agent = createAgent({
  model,
  tools,
  systemPrompt: SYSTEM_PROMPT,
});

// 使用 streamMode: "messages" 逐 token 输出模型文本。
const stream = await agent.stream(
  { messages: [{ role: "user", content: PROMPT }] },
  { streamMode: "messages" },
);

process.stderr.write(`正在请求模型 ${modelName}，baseURL=${baseURL}\n`);

let wroteText = false;
const timeout = setTimeout(() => {
  process.stderr.write("\n请求超过 60 秒仍未收到文本输出，请检查中转站 baseURL、模型名、流式响应和 tool/function calling 支持。\n");
  process.exit(1);
}, 60_000);

for await (const [chunk] of stream) {
  if (!AIMessageChunk.isInstance(chunk)) continue;
  const text = toText(chunk.content);
  if (text) {
    wroteText = true;
    process.stdout.write(text);
  }
}

clearTimeout(timeout);

if (!wroteText) {
  process.stderr.write("\n未收到模型文本输出，请检查 OPENAI_MODEL 是否支持 tool/function calling，或中转站是否支持流式响应。\n");
}

process.stdout.write("\n");
