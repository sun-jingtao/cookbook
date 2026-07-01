# LangGraph 版 DAG 任务运行器（复刻 Cursor SDK dag-task-runner）

用 [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) 复刻 [`sdk/dag-task-runner`](../../sdk/dag-task-runner) 的核心：
把一个任务拆成 JSON DAG，按依赖关系编排执行，无依赖的任务自动并行，上游产物拼接进下游 prompt。

**为什么这个案例选 LangGraph**：原案例自己用 Kahn 算法做拓扑分层、再用 `Promise.all` 手动并行每一层。
而 LangGraph 的图本身就是 DAG —— 我们把每个 task 直接建成一个图节点、按 `depends_on` 连边，
**并行由 LangGraph 的 super-step 自动完成**，不需要手写调度。DAG 就是图，这是 LangGraph 的主场。

## 与原案例的对应关系

| Cursor SDK dag-task-runner | 本项目（LangGraph） |
| --- | --- |
| Kahn 拓扑分层 + `Promise.all` 手动并行 | 动态 `addNode`/`addEdge` 构图，LangGraph 自动并行无依赖节点 |
| 每个子任务是一个 Cursor coding agent | 每个节点是一次 `ChatAnthropic` 调用（最小形态，无文件/shell 工具） |
| `complexity` → Cursor 模型（gpt-5.3-codex 等） | `complexity` → Claude：HIGH→opus、MED→sonnet、LOW→haiku |
| 上游输出拼进下游 prompt（前 2000 字符） | 同样：`ReducedValue` 状态里按 taskId 存产物，下游读取拼接 |
| 实时写入 Cursor Canvas | `streamMode: "updates"` 把每个节点完成事件打印到终端 |
| 并发安全 | `ReducedValue` 的 reducer 合并并行节点的并发写入 |

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
export ANTHROPIC_API_KEY="sk-ant-..."   # 或 cp .env.example .env 后改值
pnpm example
```

`pnpm example` 会跑内置的 6 任务 DAG（4 层）：

```
DAG "Design a tiny CLI todo app" — 6 个任务，共 4 层
  rank 1/4: research-stack, research-cli-conventions
  rank 2/4: design
  rank 3/4: implement
  rank 4/4: tests, docs

  ✓ research-stack (claude-haiku-4-5-20251001) [1/6]
  ✓ research-cli-conventions (claude-haiku-4-5-20251001) [2/6]
  ✓ design (claude-sonnet-4-6) [3/6]
  ...
完成 — 6/6 个任务，产物已写入 dag-output/
```

各任务的产物会写到 `dag-output/<task-id>.md`。换自己的 DAG：

```bash
pnpm dev path/to/your_dag.json
```

## DAG 文件格式

```json
{
  "title": "...",
  "tasks": [
    {
      "id": "research-stack",
      "depends_on": [],
      "complexity": "LOW",
      "subtask_prompt": "自包含的子任务指令；运行时会在前面拼上各上游产物。"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识，供其他任务的 `depends_on` 引用 |
| `depends_on` | 依赖的 task id 数组；空数组即 rank-1 任务 |
| `complexity` | `HIGH` / `MED` / `LOW`，决定该节点用哪个 Claude 模型 |
| `subtask_prompt` | 子任务指令；上游产物会自动拼接到它前面 |

解析时会校验：字段合法性、重复 id、未知依赖、自依赖，并做**环检测**（在编译成图之前先报错）。

## 文件说明

- `src/dag.ts` — DAG 解析、校验、环检测、分层（框架无关，从原案例移植精简）。
- `src/run_dag.ts` — 把 DAG 动态编译成 `StateGraph`，用 `streamMode: "updates"` 流式打印进度并落盘产物。

## 说明

- **最小形态**：每个节点是纯 LLM 调用，产出文本 deliverable，不像原案例那样让子 agent 真正读写文件、执行命令。重点在于演示 **DAG 编排 + 自动并行 + 上游上下文传递**。
- 同一 rank 的兄弟任务并行执行；状态用 `ReducedValue` 的 reducer 合并，避免并发写冲突。
- 传给下游的上游上下文每个父任务上限 2000 字符，以控制 prompt 体积。
