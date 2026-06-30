# LangChain 版 Quickstart（复刻 Cursor SDK Quickstart）

用 [LangChain.js](https://js.langchain.com/) 复刻 [`sdk/quickstart`](../sdk/quickstart)（Cursor SDK Quickstart）的行为：
创建一个能访问本地文件系统的 Agent，发送一条硬编码 prompt「用一段话解释这个项目。」，
让 Agent **实际读取当前目录的文件**来理解项目，并把助手文本**流式**打印到 stdout。

与原案例的对应关系：

| Cursor SDK Quickstart | 本项目（LangChain） |
| --- | --- |
| `Agent.create({ local: { cwd } })` 自带文件/命令工具 | `model.bindTools(tools)` + 自定义只读文件工具 |
| `model: { id: 'composer-2.5' }` | `ChatAnthropic({ model: 'claude-sonnet-4-6' })` |
| Cursor 内部托管的 Agent 循环 | **手写** 的 tool-calling 循环（见 `src/index.ts`） |
| `run.stream()` 取 `assistant` 文本块 | `model.stream(messages)` 逐 token 输出 |

与 [LangGraph 版](../langgraph-quickstart) 的核心差异：这里**不使用 LangGraph 图**，而是手写
「调模型 → 若有 tool_calls 则执行并回灌 ToolMessage → 再调模型」的循环，直观展示 tool-calling agent 的内部机制。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
export ANTHROPIC_API_KEY="sk-ant-..."   # 或 cp .env.example .env 后改值
pnpm dev
```

默认针对当前目录运行。若想让它解释**别的**项目，在目标目录里执行：

```bash
cd /path/to/some/project
ANTHROPIC_API_KEY="sk-ant-..." \
  pnpm --dir /Users/luoluo/Desktop/my-github/cookbook/langchain-quickstart dev
```

> 注：`tsx src/index.ts` 不会自动加载 `.env`。若用 `.env` 文件，请改用
> `tsx --env-file=.env src/index.ts`，或直接 `export ANTHROPIC_API_KEY`。

## 文件说明

- `src/tools.ts` — 两个只读工具 `list_files` / `read_file`，限制在启动目录内，复刻 coding agent 的「读项目」能力。
- `src/index.ts` — `bindTools` + 手写循环，逐 token 流式输出助手文本。

## 说明

- 工具仅提供**只读**能力，刻意不开放写文件 / 执行命令，避免演示项目误改你的工作区。
- `read_file` 有 64KB 截断、`list_files` 会忽略 `node_modules`、`.git`、`dist` 等目录。
