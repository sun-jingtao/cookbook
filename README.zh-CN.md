# Cursor Cookbook

本仓库收录了使用 Cursor 构建应用的小型示例。

## Cursor Hooks

Cursor Hooks 可在 Agent 相关事件（如提交 prompt、执行 shell 命令、编辑文件、Agent 完成）前后运行自定义检查与工作流。

### [Hooks 示例](hooks)

一套带引导的项目 Hook 配置，涵盖审计日志、敏感 prompt 防护，以及用于保持 Cursor Skills 与代码变更同步的后续检查。

## Cloud Agents

### [自托管 Cloud Agents 实验环境](cloud-agent)

在客户自管的 AWS 基础设施上运行 Cursor Cloud Agent Worker，示例覆盖 EC2 + Docker、ECS/Fargate 以及 EKS + Helm。

## Cursor SDK

Cursor SDK 是 TypeScript API，用于在你自己的应用、脚本和工作流中运行 Cursor 编码 Agent。同一套 Agent 可在本地工作区与云端运行时中使用，运行过程中可流式接收 Agent 事件，并可通过代码管理 prompt、模型、取消、产物与会话状态。

运行 SDK 示例前，请先在 [Cursor 集成控制台](https://cursor.com/dashboard/integrations) 创建 Cursor API Key，并将其设置为环境变量 `CURSOR_API_KEY`。

### [快速入门](sdk/quickstart)

一个最小的 Node.js 示例：创建本地 Agent、发送一条 prompt，并流式接收响应。

### [原型工具](sdk/app-builder)

一个 Web 应用，用于启动 Agent，在沙箱化的云端环境中搭建新项目并迭代想法。

### [看板](sdk/agent-kanban)

一个看板，用于查看 Cursor Cloud Agents，按状态或仓库分组，预览产物，并通过仓库与 prompt 创建新的 Cloud Agent。

### [编码 Agent CLI](sdk/coding-agent-cli)

一个最小命令行工具，可在终端中启动 Cursor Agent。

### [DAG 任务运行器](sdk/dag-task-runner)

将任务拆解为 JSON DAG，分发到多个本地子 Agent 并行执行，并将实时状态流式写入 Cursor Canvas；Canvas 会在每次状态变更时热更新。既可作为可运行示例，也可作为可复制的 Cursor Skill 使用，见 [`.cursor/skills/dag-task-runner`](.cursor/skills/dag-task-runner)。

更多信息请参阅 [Cursor SDK TypeScript 文档](https://cursor.com/docs/api/sdk/typescript)。
