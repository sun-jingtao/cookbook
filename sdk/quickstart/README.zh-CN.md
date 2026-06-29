# Cursor SDK 快速入门

一个最小的本地 Cursor SDK 示例：创建一个 Agent，发送硬编码 prompt，将助手文本流式输出到 stdout，并等待运行结束。

## 快速开始

需要 Node.js 22 或更高版本。

安装依赖：

```bash
pnpm install
```

设置 Cursor API Key：

```bash
export CURSOR_API_KEY="crsr_..."
```

运行快速入门：

```bash
pnpm dev
```

构建并运行编译后的示例：

```bash
pnpm build
pnpm start
```

## 说明

如需更完整的终端应用（支持参数、云端模式、模型选择和交互式 TUI），请参阅 [编码 Agent CLI](../coding-agent-cli)。
