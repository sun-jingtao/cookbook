# EC2 + Docker 指南

本 README 用于理解 EC2 架构、运行模型、验证预期与故障排查路径。分步命令与客户侧部署流程请参阅 [`terraform/README.zh-CN.md`](terraform/README.zh-CN.md)。

## 适用场景

EC2 + Docker 路径是本实验环境中 AWS 占用最小的方案，适合演示、概念验证，以及希望在采用 ECS、EKS 或 Kubernetes 之前先部署单台自托管 Cursor Worker 的客户。

当客户需要自动扩缩容、多台预热 Worker、滚动更新、集群级调度，或更强的团队与工作负载隔离时，应改用 ECS 或 Kubernetes。

## 文档导航

- 本 README：架构、资源概览、安全模型、运维、验证与故障排查。
- [`terraform/README.zh-CN.md`](terraform/README.zh-CN.md)：客户前置条件、`.env` 配置、Terraform 命令、镜像发布、Worker 验证、更新、密钥轮换与清理。

## 创建的资源

Terraform 将创建：

- 一台 EC2 Worker 主机。
- 一个用于 Worker 镜像的 ECR 仓库。
- 一个用于 Cursor 服务账号密钥的 Secrets Manager 密钥容器。
- 一个 IAM 角色与实例配置文件，用于 ECR 镜像拉取、Secrets Manager 读取与 SSM 访问。
- 一个安全组，无入站规则，出站允许 HTTPS/DNS。

Terraform 仅创建 Secrets Manager 密钥的元数据。服务账号密钥值单独上传，避免写入 Terraform state。

## 架构

EC2 主机运行名为 `cursor-worker` 的单个 Docker 容器。容器使用 ECR 中的共享 Worker 镜像，并通过 HTTPS 出站连接 Cursor。Cursor Cloud Agents 无需任何入站端口。

Worker 工作区位于主机 `/opt/cursor/worker`，挂载到容器内 `/workspace`。Bootstrap 期间，主机会将该目录初始化为最小 git 仓库，并将 `origin` 设置为 `WORKER_REPOSITORY_URL`，以便 Cursor 推导仓库标签。

密钥在 Terraform state 之外处理。主机在 Bootstrap 时从 Secrets Manager 读取 Cursor 服务账号密钥，写入 `/etc/cursor/worker.env`，并通过 `--env-file` 传递给 Docker。

默认镜像平台为 `linux/amd64`，与 `t3`、`t3a` 实例类型匹配。对于 `t4g` 实例，请构建 `linux/arm64` 镜像，并将 Terraform 的 `ami_architecture` 变量设为 `arm64`。

## Bootstrap 流程

首次启动时，`user_data.sh.tpl` 在 EC2 主机上执行以下步骤：

1. 安装 Docker、Git 与 AWS CLI。
2. 启动 Docker。
3. 使用实例角色登录 ECR。
4. 从 Secrets Manager 获取 Cursor 服务账号密钥。
5. 写入 `/etc/cursor/worker.env`。
6. 将 `/opt/cursor/worker` 初始化为 git 仓库并设置 GitHub origin。
7. 从 ECR 拉取 Worker 镜像。
8. 启动 `cursor-worker`，并将 `/opt/cursor/worker` 挂载为 `/workspace`。

Worker 进程从 Docker 环境变量读取 `CURSOR_API_KEY`，而非容器内的 `.env` 文件。

## 网络与安全模型

- Worker 通过 HTTPS 出站连接 Cursor。
- 安全组无入站规则。
- 管理 Shell 访问使用 SSM Session Manager；无需 SSH。
- EC2 根卷已加密。
- 要求使用 IMDSv2。
- 实例角色可从 Worker ECR 仓库拉取镜像、仅读取已配置的 Cursor API Key 密钥，并使用 SSM。

对于私有子网，请确保子网具备 NAT 或等效出站能力，以便 Bootstrap 期间访问 Cursor、ECR、Secrets Manager、SSM 与软件包仓库。

## 运行模型

本路径在一台 EC2 实例上运行单个 Worker 容器。EC2 实现中不包含自动扩缩容循环。

修改 Docker 文件或 entrypoint 后，需发布新镜像并重建容器，使主机拉取最新镜像。轮换服务账号密钥后，将新值上传至 Secrets Manager，刷新 `/etc/cursor/worker.env`，并重建容器。单纯的 `docker restart` 不会从 `--env-file` 重新加载值。

## 验证

健康部署应具备：

- 一台运行中的 EC2 实例。
- 可通过 SSM 连接实例。
- 一个运行中的 `cursor-worker` Docker 容器。
- Worker 日志显示已注册到预期 Pool 与仓库。
- 自托管 Pool 在 Cursor Cloud Agents 中可见且可选。
- Cursor GitHub App 已授权访问目标仓库。

主机侧常用检查：

```bash
sudo docker ps --filter name=cursor-worker
sudo docker logs -f cursor-worker
sudo systemctl status docker
sudo tail -f /var/log/cursor-worker-bootstrap.log
```

健康的 Worker 日志应包含：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

## 故障排查

### Terraform 无法使用 `aws login`

AWS CLI 可通过 `aws login` 认证，但部分 Terraform AWS Provider 版本无法直接读取该缓存登录配置。

本仓库的 Make 目标在运行 Terraform 前通过 `aws configure export-credentials` 导出临时凭证。若 Terraform 报错 `No valid credential sources found`，请刷新本地认证后重试：

```bash
aws login --profile "$AWS_PROFILE"
make ec2-terraform-plan
```

### AMI 查询失败

部分 Provider 版本在 `aws_instance` 中拒绝 `resolve:ssm:/...` 形式的 AMI 值。

本仓库使用 `data "aws_ssm_parameter"` 解析最新 Amazon Linux 2023 AMI，再将真实 AMI ID 传给 EC2。

### Bootstrap 未完成

检查 Bootstrap 日志：

```bash
sudo tail -f /var/log/cursor-worker-bootstrap.log
```

首次启动会等待 Secrets Manager 密钥值与 ECR 镜像就绪。若等待超时前密钥或镜像尚不存在，请上传密钥、推送镜像，并通过 Terraform 替换实例，或通过 SSM 重新执行 Bootstrap 命令。

### 镜像拉取失败

确认镜像存在于 ECR、标签与 `WORKER_IMAGE_TAG` 一致，且本地构建架构与 EC2 实例一致。

默认 `t3.small` 路径期望 `WORKER_PLATFORM=linux/amd64`。Graviton 实例请使用 `WORKER_PLATFORM=linux/arm64` 与 `ami_architecture=arm64`。

### API Key 无效

Pool Worker 需要 Cursor **服务账号 API Key**。普通用户、成员、团队、个人或组织 API Key 会被拒绝。

在 Cursor 的 Service Accounts 设置中创建密钥，更新 `.env`，将新值上传至 Secrets Manager，并重建容器。

### Worker CLI 拒绝参数

Worker 选项应放在 `start` 子命令之前。正确用法：

```bash
agent worker --pool --pool-name "$CURSOR_WORKER_POOL_NAME" start
```

错误用法：

```bash
agent worker start --pool "$CURSOR_WORKER_POOL_NAME"
```

Docker entrypoint 已遵循正确顺序。

### Worker 目录不是 Git 仓库

Cursor 从 Worker 目录的 git remote 推导仓库标签。若 `/workspace` 不在带有 `origin` 的 git 仓库内，启动将失败。

EC2 Bootstrap 将 `/opt/cursor/worker` 初始化为最小 git 仓库，将 `origin` 设为 `WORKER_REPOSITORY_URL`，并挂载到容器内 `/workspace`。

### 新密钥值未生效

Docker 仅在创建容器时读取 `--env-file`。若更新了 Secrets Manager 或 `/etc/cursor/worker.env`，`docker restart` 不足。

更新 env 文件后需重建容器。实现指南中包含可复制粘贴的命令。

### Cloud Agents 无法访问仓库

Worker 已连接并不足够。Cursor Cloud Agents 还需 GitHub App 对目标仓库的访问权限。

为仓库所有者安装或更新 Cursor GitHub App，授权访问该仓库，保存 GitHub App 设置，并刷新 Cloud Agents 页面。

### 无任务日志

Worker CLI 在默认日志级别下不总是输出详细的 per-job 日志。请先确认 Worker 已在 Cloud Agents UI 中注册并被选中，然后检查：

```bash
sudo docker logs -f cursor-worker
```

以及 Cloud Agents 仪表盘/任务 UI。

## 清理

演示结束后销毁 EC2 资源以停止 AWS 费用。实现指南中包含确切的清理命令。

本实验将 ECR 仓库配置为 force-delete，因此即使仓库内仍有演示镜像，Terraform 也可删除该仓库。
