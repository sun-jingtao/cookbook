# 编码 Agent CLI

一个使用 Cursor SDK Agent 针对工作区运行的小型 CLI 示例。一次性 prompt 默认使用本地运行时，交互式 TUI 可在本地与云端执行之间切换。

## 快速开始

需要 Bun 1.3 或更高版本。本 CLI 仅支持 Bun，因为 OpenTUI 的原生渲染器通过 `bun:ffi` 暴露。

安装依赖：

```bash
pnpm install
```

设置 API Key：

```bash
export CURSOR_API_KEY="crsr_..."
```

在当前目录执行一次性任务：

```bash
bun run dev -- "Explain how this project is structured"
```

省略 prompt 即可启动 TUI：

```bash
bun run dev
```

## 说明

在 TUI 中输入 `/` 打开命令菜单。可在本地与云端执行之间切换、选择模型、重置会话或退出。
