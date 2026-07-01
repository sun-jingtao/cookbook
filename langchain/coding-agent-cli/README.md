# LangChain 版 编码 Agent CLI（复刻 Cursor SDK coding-agent-cli）

用 [LangChain.js](https://js.langchain.com/) 复刻 [`sdk/coding-agent-cli`](../../sdk/coding-agent-cli) 的核心：
一个针对当前工作区运行的命令行 agent，支持**一次性 prompt** 与**交互式会话**两种模式。

## 与原案例的对应关系

| Cursor SDK coding-agent-cli | 本项目（LangChain） |
| --- | --- |
| `Agent.create()` + 内置文件/命令工具 | `createAgent({ model, tools })` + 只读文件工具 |
| 一次性 prompt（`bun run dev -- "..."`） | 一次性模式（`pnpm dev "..."`），跑完即退 |
| 交互式 TUI（OpenTUI） | 交互式 REPL（Node `readline`），最小形态 |
| 本地 vs 云端执行切换 | 一次性=无跨次记忆；交互=`MemorySaver` 线程级记忆 |
| 流式输出 | `streamEvents({ version: "v3" })` 的 `message.text` 逐 token 输出 |

> 关于「本地/云端」：Cursor 的本地/云 runtime 是其平台能力，LangChain 没有对等物。
> 这里把它重新诠释为「单轮无状态」与「多轮有记忆」——更贴近 LangChain 用 checkpointer
> 管理会话状态的方式。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
cp .env.example .env   # 填写 OPENAI_API_KEY / OPENAI_BASE_URL；必要时调整 OPENAI_MODEL
```

> 模型走 OpenAI-compatible 中转站：`ChatOpenAI` + `configuration.baseURL`，配置从 `.env` 读取
> （`dev` 脚本已带 `--env-file=.env`）。

一次性提问（针对当前目录）：

```bash
pnpm dev "用一段话解释这个项目"
```

省略 prompt 进入交互式 REPL（同一会话内有记忆）：

```bash
pnpm dev
# > 这个项目用了哪些依赖？
# > 其中哪些是 dev 依赖？      ← 能记住上一轮的上下文
# > /exit
```

## 文件说明

- `src/tools.ts` — 只读文件工具 `list_files` / `read_file`，限制在启动目录内。
- `src/index.ts` — 模式分发（一次性 / REPL）、`createAgent` + `MemorySaver`、`streamEvents v3` 流式输出。

## 说明

- 工具仅**只读**，刻意不开放写文件 / 执行命令，避免误改工作区。
- 交互模式用固定 `thread_id` 维持记忆；一次性模式用独立 thread，不跨次保留。
- `read_file` 有 64KB 截断，`list_files` 忽略 `node_modules`、`.git`、`dist` 等目录。
