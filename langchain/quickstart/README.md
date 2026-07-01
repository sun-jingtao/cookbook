# LangChain 版 Quickstart（复刻 Cursor SDK Quickstart）

用 [LangChain.js](https://js.langchain.com/) 复刻 [`sdk/quickstart`](../../sdk/quickstart)（Cursor SDK Quickstart）的行为：
创建一个能访问本地文件系统的 Agent，发送一条硬编码 prompt「用一段话解释这个项目。」，
让 Agent **实际读取当前目录的文件**来理解项目，并把助手文本**流式**打印到 stdout。

与原案例的对应关系：

| Cursor SDK Quickstart | 本项目（LangChain） |
| --- | --- |
| `Agent.create({ local: { cwd } })` 自带文件/命令工具 | `createAgent({ model, tools, systemPrompt })` + 自定义只读文件工具 |
| `model: { id: 'composer-2.5' }` | `ChatOpenAI` 连接 OpenAI-compatible 中转站 |
| Cursor 内部托管的 Agent 循环 | LangChain v1 的 `createAgent` 托管模型/工具循环 |
| `run.stream()` 取 `assistant` 文本块 | `agent.stream(..., { streamMode: 'messages' })` 取 AI token |

与 [LangGraph 版](../../langgraph/quickstart) 的核心差异：这里使用 LangChain v1 推荐的高级
Agent harness；LangGraph 版则显式搭建图节点和条件边。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
# 创建或编辑 .env，填写 OPENAI_API_KEY；必要时调整 OPENAI_BASE_URL / OPENAI_MODEL
pnpm dev
```

默认针对当前目录运行。若想让它解释**别的**项目，在目标目录里执行：

```bash
cd /path/to/some/project
OPENAI_API_KEY="sk-..." \
OPENAI_BASE_URL="https://calciumion.nbops.com/v1" \
OPENAI_MODEL="claude-sonnet-4-6" \
  /Users/luoluo/Desktop/my-github/cookbook/langchain/quickstart/node_modules/.bin/tsx \
  /Users/luoluo/Desktop/my-github/cookbook/langchain/quickstart/src/index.ts
```

## 文件说明

- `src/tools.ts` — 两个只读工具 `list_files` / `read_file`，限制在启动目录内，复刻 coding agent 的「读项目」能力。
- `src/index.ts` — `createAgent` + `streamMode: "messages"`，逐 token 流式输出助手文本。

## 说明

- 工具仅提供**只读**能力，刻意不开放写文件 / 执行命令，避免演示项目误改你的工作区。
- `read_file` 有 64KB 截断、`list_files` 会忽略 `node_modules`、`.git`、`dist` 等目录。
