# Cursor SDK Agent 看板

一个 Linear 风格的 Cursor Cloud Agents 看板。使用 Cursor SDK 列出 Cloud Agent，按列分组展示，在卡片上预览产物，并通过仓库与 prompt 创建新的 Cloud Agent。

本示例演示：

- 在加载任何 Cloud Agent 数据前，必须先完成 API Key 引导，
- 列出 Cloud Agent，并按状态、仓库、分支或创建日期分组，
- Agent 卡片展示状态、仓库/分支元数据、最新活动、PR 链接和产物预览，
- 基于 `Agent.create({ cloud: { repos } })` 的创建 Agent 流程，
- 通过本地 API 路由代理、带身份验证的产物媒体预览。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开本地 Next.js URL，在引导流程中输入来自 [Cursor 集成控制台](https://cursor.com/dashboard/integrations) 的 Cursor API Key。若勾选「记住此 Key」，Key 会保存在 `~/.agent-kanban/settings.json`；否则仅保留在内存中的应用会话里。

## 说明

仓库列表受 Cloud Agents API 速率限制，并在内存中短暂缓存。产物预览通过带身份验证的本地 API 路由获取；若预览停止加载，请刷新看板。
