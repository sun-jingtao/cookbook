import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
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
const modelWithTools = model.bindTools(tools);

// LangGraph v1 版：显式搭建「模型节点 → 工具节点 → 模型节点」的循环图。
async function llmCall(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    ...state.messages,
  ]);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) return END;
  return lastMessage.tool_calls?.length ? "tools" : END;
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", llmCall)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["tools", END])
  .addEdge("tools", "llmCall")
  .compile();

// streamMode: "messages" 会逐 token 产出 [messageChunk, metadata]。
const stream = await graph.stream(
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
  // 只打印模型产出的助手文本，跳过工具调用块与工具返回消息。
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
