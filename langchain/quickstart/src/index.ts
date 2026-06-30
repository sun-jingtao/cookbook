import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tools, toolsByName, toText } from "./tools.js";

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

// LangChain 版：不依赖 LangGraph，手写「思考 → 调工具 → 再思考」的循环，
// 直观展示一个 tool-calling agent 的内部机制。
const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(PROMPT)];

while (true) {
  // 逐 token 流式输出本轮助手文本，同时把所有分片拼回一条完整的 AIMessage。
  let gathered: AIMessageChunk | undefined;
  for await (const chunk of await modelWithTools.stream(messages)) {
    gathered = gathered ? gathered.concat(chunk) : chunk;
    const text = toText(chunk.content);
    if (text) process.stdout.write(text);
  }
  if (!gathered) break;
  messages.push(gathered);

  const toolCalls = gathered.tool_calls ?? [];
  if (toolCalls.length === 0) break; // 没有工具调用 = 已给出最终答案

  // 执行模型请求的每个工具，把结果作为 ToolMessage 回灌，进入下一轮。
  for (const call of toolCalls) {
    const selected = toolsByName[call.name];
    const result = selected
      ? await selected.invoke(call.args)
      : `未知工具：${call.name}`;
    messages.push(new ToolMessage({ content: String(result), tool_call_id: call.id ?? "" }));
  }
}

process.stdout.write("\n");
