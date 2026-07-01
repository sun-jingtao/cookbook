# LangGraph 版 Agent 看板（复刻 Cursor SDK agent-kanban）

用 [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) 复刻 [`sdk/agent-kanban`](../../sdk/agent-kanban) 的核心：
**并发运行多个 agent，按状态分组展示其生命周期**，像一块看板。

## 与原案例的对应关系

| Cursor SDK agent-kanban | 本项目（LangGraph） |
| --- | --- |
| 列出/创建 Cursor **Cloud Agents**（托管平台） | 本地并发运行多个 LangGraph agent run |
| 一个 Cloud Agent = 一个仓库任务 | 一张卡片 = 一次独立的 agent run（独立 `thread_id`） |
| 按状态分组（看板列） | 终端看板按 QUEUED / RUNNING / DONE / ERROR 分组 |
| Cloud Agents API 速率限制/worker 池 | 简单并发池（默认上限 2，其余排队） |
| Next.js + React Query 实时 UI | 终端实时重绘（`console.clear` + 重新渲染） |

> **最小形态说明**：原案例是 Next.js 全栈应用，对接 Cursor 的 **Cloud Agents 托管平台**
> （云端跑 agent、产物、PR）。LangChain/LangGraph 没有这个托管平台，所以这里按你的选择
> 重新诠释为「**本地多 agent run 的生命周期管理 + 终端看板**」——保留「并发编排 + 状态分组」
> 这个核心概念，去掉全栈 UI 与云托管。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
export ANTHROPIC_API_KEY="sk-ant-..."   # 或 cp .env.example .env 后改值
pnpm dev
```

会并发跑 5 个分析 agent（针对当前项目），看板实时刷新：

```
Agent 看板 — 本地多 agent run 生命周期（并发上限 2）

○ QUEUED (1)
    入口分析
◐ RUNNING (2)
    脚本说明
    结构概览
● DONE (2)
    依赖审计 — 运行时依赖 4 个、开发依赖 3 个……
    README 摘要 — 这是一个用 LangGraph 复刻的多 agent 看板示例……
✗ ERROR (0)
```

每张卡片是一次独立 agent run（复用「模型 → 工具 → 模型」的 LangGraph 循环图 + `MemorySaver`），
读当前项目文件完成各自任务。改 `src/index.ts` 里的 `cards` 数组即可换成你自己的任务集。

## 文件说明

- `src/tools.ts` — 只读文件工具 `list_files` / `read_file`，限制在 cwd 内。
- `src/index.ts` — 可复用的 LangGraph agent 图、卡片定义、并发池、看板渲染。

## 说明

- 每个 agent run 用各自的 `thread_id`，相互隔离。
- 并发池上限默认 2（改 `runPool(2)` 即可），便于观察 QUEUED→RUNNING→DONE 的流转。
- 单个 run 失败（如超时/报错）只会让该卡片进入 ERROR，不影响其他卡片 —— 对应原案例「单 agent 失败隔离」。
