import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tools, toText } from "./tools.js";

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

for await (const [chunk] of stream) {
  // 只打印模型产出的助手文本，跳过工具调用块与工具返回消息。
  if (!AIMessageChunk.isInstance(chunk)) continue;
  const text = toText(chunk.content);
  if (text) process.stdout.write(text);
}

process.stdout.write("\n");
