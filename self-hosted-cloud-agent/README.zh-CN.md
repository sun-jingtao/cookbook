# 自托管 Cloud Agents 实验环境

本仓库演示如何在客户自管基础设施上，通过自托管 Worker 池运行 Cursor Cloud Agents。Cursor 仍负责编排、模型推理和 Cloud Agents 体验，Worker 则运行在你的环境中，用于克隆仓库、执行命令、编辑文件、运行构建/测试，以及访问内部服务。

Worker 通过 HTTPS 出站连接 Cursor，无需对 Worker 开放入站访问。

## 基础设施指南

| 基础设施 | 概览 README | 实施 README |
| --- | --- | --- |
| EC2 + Docker | [`ec2/README.zh-CN.md`](ec2/README.zh-CN.md) | [`ec2/terraform/README.zh-CN.md`](ec2/terraform/README.zh-CN.md) |
| ECS/Fargate | [`ecs/README.zh-CN.md`](ecs/README.zh-CN.md) | [`ecs/terraform/README.zh-CN.md`](ecs/terraform/README.zh-CN.md) |
| EKS + Helm | [`eks/README.zh-CN.md`](eks/README.zh-CN.md) | [`eks/helm/README.zh-CN.md`](eks/helm/README.zh-CN.md) |

概览 README 用于了解架构、权衡、验证预期和故障排查。实施 README 提供可直接复制粘贴的设置命令。

- EC2 + Docker 占用最小，在一台主机上运行一个 Worker 容器。
- ECS/Fargate 是 AWS 原生服务路径，支持 CloudWatch 指标和 ECS Service Auto Scaling。
- EKS + Helm 是 Kubernetes 路径，使用 Cursor 的 worker-set controller 和 `WorkerDeployment` 资源。
