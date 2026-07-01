# LangChain 版 App Builder（复刻 Cursor SDK app-builder）

用 [LangChain.js](https://js.langchain.com/) 复刻 [`sdk/app-builder`](../../sdk/app-builder) 的核心：
通过对话让 agent 在一个隔离目录里**搭建并迭代**一个网页应用。

## 与原案例的对应关系

| Cursor SDK app-builder | 本项目（LangChain） |
| --- | --- |
| 本地 agent 会话 + 内置工具 | `createAgent({ model, tools })` + 文件读写工具 |
| 隔离的预览工作区 | 隔离的构建目录 `./app-output`（`APP_BUILDER_DIR` 可改） |
| 搭建热重载 React 预览应用 | 生成可直接打开的单页 `index.html`（CDN 引 React） |
| 聊天 UI 迭代 | 终端 REPL 迭代，`MemorySaver` 记住此前生成的应用 |
| 流式展示 agent 响应与工具活动 | `streamEvents v3` 逐 token 输出；每轮后打印文件清单 |

> **最小形态说明**：原案例是 Next.js 全栈应用，带 iframe 实时预览与热重载。这里聚焦
> 核心 agent 逻辑 —— 用一个 `write_file` 工具把应用写到本地目录，「预览」即用浏览器打开
> 生成的 `index.html`。没有复刻全栈 UI 与 dev server 热重载。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
pnpm install
cp .env.example .env   # 填写 OPENAI_API_KEY / OPENAI_BASE_URL；必要时调整 OPENAI_MODEL
```

一次性生成：

```bash
pnpm dev "做一个待办清单网页，支持新增和勾选完成"
open app-output/index.html   # 浏览器打开看效果
```

进入 REPL 持续迭代（有记忆）：

```bash
pnpm dev
# > 做一个计数器网页
# > 把按钮改成蓝色，加一个重置按钮     ← 在上一版基础上改
# > /exit
```

## 文件说明

- `src/tools.ts` — `list_files` / `read_file` / `write_file`，全部限制在构建目录内。
- `src/index.ts` — `createAgent` + `MemorySaver`，REPL/一次性两种模式，`streamEvents v3` 流式输出，每轮打印文件清单。

## 说明

- 写操作**仅限构建目录**（默认 `./app-output`），不会动到项目其他文件。
- 构建目录已加入 `.gitignore`，生成产物不会污染仓库。
- 多轮迭代靠固定 `thread_id` 的记忆；一次性模式用独立 thread。
