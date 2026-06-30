# LangGraph 版 Quickstart（复刻 Cursor SDK Quickstart）

用 [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) 复刻 [`sdk/quickstart`](../sdk/quickstart)（Cursor SDK Quickstart）的行为：
创建一个能访问本地文件系统的 Agent，发送一条硬编码 prompt「用一段话解释这个项目。」，
让 Agent **实际读取当前目录的文件**来理解项目，并把助手文本**流式**打印到 stdout。

与原案例的对应关系：

| Cursor SDK Quickstart | 本项目（LangGraph） |
| --- | --- |
| `Agent.create({ local: { cwd } })` 自带文件/命令工具 | `createReactAgent({ llm, tools })` + 自定义只读文件工具 |
| `model: { id: 'composer-2.5' }` | `ChatAnthropic({ model: 'claude-sonnet-4-6' })` |
| `run.stream()` 取 `assistant` 文本块 | `agent.stream(..., { streamMode: 'messages' })` 取 AI token |
| `run.wait()` | `for await` 流结束即等价于运行结束 |

整个「思考 → 调工具 → 再思考」的 Agent 循环由 LangGraph 预构建的 ReAct 图托管，这是与 [LangChain 版](../langchain-quickstart) 的核心差异（后者手写循环）。

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
  pnpm --dir /Users/luoluo/Desktop/my-github/cookbook/langgraph-quickstart dev
```

> 注：`tsx src/index.ts` 不会自动加载 `.env`。若用 `.env` 文件，请改用
> `tsx --env-file=.env src/index.ts`，或直接 `export ANTHROPIC_API_KEY`。

## 文件说明

- `src/tools.ts` — 两个只读工具 `list_files` / `read_file`，限制在启动目录内，复刻 coding agent 的「读项目」能力。
- `src/index.ts` — 创建 ReAct Agent 并以 `streamMode: "messages"` 流式输出助手 token。

## 说明

- 工具仅提供**只读**能力，刻意不开放写文件 / 执行命令，避免演示项目误改你的工作区。
- `read_file` 有 64KB 截断、`list_files` 会忽略 `node_modules`、`.git`、`dist` 等目录。
