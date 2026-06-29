# Cursor SDK 原型工具

这是一个展示 Cursor SDK 能力的小型示例：启动本地 Cursor Agent 会话，搭建热更新的 React 预览应用，并通过聊天 UI 迭代该应用。

目标是演示端到端的应用构建闭环：

- 在本地收集 Cursor API Key，
- 创建隔离的预览工作区，
- 流式展示 Agent 响应与工具活动，
- 在 iframe 中预览生成的 UI，
- 管理多个应用构建会话。

## 快速开始

安装依赖并启动 Next.js 宿主应用：

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

首次启动时粘贴 Cursor API Key。应用将其本地保存在 `~/.app-builder/settings.json`，并用于创建本地 Agent 会话。

## 说明

本应用面向本地 Cursor SDK 演示。若作为共享公共服务部署，请先补充身份认证、按用户隔离存储和更严格的密钥管理。
