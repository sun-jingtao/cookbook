# ECS 实施指南

这是 ECS/Fargate 方案的逐步实施指南。架构概览、自动扩缩容模型、验证检查与故障排查见 [`../README.zh-CN.md`](../README.zh-CN.md)。

除非另有说明，所有命令均从仓库根目录执行。

当你准备构建或运维 ECS 路径时使用本指南。它有意包含 Terraform、Secrets Manager、ECR 镜像发布、服务验证、自动扩缩容验证、密钥轮换与清理的具体命令。

## 1. 配置本地前置条件

安装本地工具：

```bash
brew install awscli terraform
```

本地必须运行 Docker，因为 Worker 镜像从你的机器构建并推送。

认证 AWS：

```bash
aws login --profile default
aws sts get-caller-identity --profile default
```

确认客户具备：

- 已启用 Self-Hosted Cloud Agents 的 Cursor Enterprise。
- 用于池 Worker 的 Cursor 服务账号 API Key。
- 已为目标仓库 owner 与 repository 安装 Cursor GitHub App。
- 创建 ECS、ECR、IAM、Lambda、EventBridge、CloudWatch、Secrets Manager 与安全组资源的 AWS 权限。
- 具备出站互联网访问的 VPC。默认实验路径使用公有子网并设置 `ECS_ASSIGN_PUBLIC_IP=true`；私有子网需要 NAT 或等效出站能力。

## 2. 配置 `.env`

复制示例文件：

```bash
cp .env.example .env
```

至少填写：

```bash
AWS_PROFILE=default
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=<aws-account-id>
CURSOR_API_KEY=<cursor-service-account-api-key>
CURSOR_WORKER_POOL_NAME=<base-pool-name>
ECS_WORKER_POOL_NAME=ecs-<base-pool-name>
WORKER_ENVIRONMENT_LABEL=lab
WORKER_OWNER_LABEL=platform-team
ECS_WORKER_INFRASTRUCTURE_LABEL=ecs
CURSOR_API_KEY_SECRET_NAME=cursor/ecs-service-account-key
ECS_CLUSTER_NAME=cursor-agents
ECS_SERVICE_NAME=cursor-worker-service
ECS_TASK_FAMILY=cursor-self-hosted-worker
WORKER_REPOSITORY_URL=https://github.com/OWNER/REPO.git
```

请使用 Cursor **服务账号 API Key**。普通成员、用户、团队、个人或组织 API Key 不能用于池 Worker。

使用 ECS 专用池名称，例如 `ecs-platform-agents`，以便在 Cursor Cloud Agents 仪表盘中识别 Worker。ECS 任务还会通过 `CURSOR_WORKER_LABELS_JSON` 传递标签，Cursor 应显示如 `infrastructure=ecs`、`runtime=ecs-fargate`、`environment=lab`、`owner=platform-team` 等标签。

按 CI Runner 规模配置 Worker：

```bash
ECS_TASK_CPU=1024
ECS_TASK_MEMORY=2048
ECS_MIN_CAPACITY=1
ECS_MAX_CAPACITY=5
ECS_TARGET_IDLE_WORKERS=1
ECS_TARGET_UTILIZATION_PERCENT=75
```

对于 Graviton/Fargate ARM，还需设置：

```bash
WORKER_PLATFORM=linux/arm64
ECS_TASK_CPU_ARCHITECTURE=ARM64
```

## 3. 审查 Terraform Plan

初始化 Terraform：

```bash
terraform -chdir=ecs/terraform init
```

审查 plan：

```bash
tmpfile="$(mktemp)"
aws configure export-credentials --profile "$AWS_PROFILE" --format env-no-export > "$tmpfile"
set -a
source "$tmpfile"
set +a
rm -f "$tmpfile"

terraform -chdir=ecs/terraform plan \
  -var "aws_profile=" \
  -var "aws_region=$AWS_REGION" \
  -var "ecs_cluster_name=$ECS_CLUSTER_NAME" \
  -var "ecs_service_name=$ECS_SERVICE_NAME" \
  -var "ecs_task_family=$ECS_TASK_FAMILY" \
  -var "worker_pool_name=$ECS_WORKER_POOL_NAME" \
  -var "worker_repository_url=$WORKER_REPOSITORY_URL" \
  -var "cursor_api_key_secret_name=$CURSOR_API_KEY_SECRET_NAME" \
  -var "min_capacity=$ECS_MIN_CAPACITY" \
  -var "max_capacity=$ECS_MAX_CAPACITY" \
  -var "target_idle_workers=$ECS_TARGET_IDLE_WORKERS"
```

确认 plan 仅创建预期资源：

- ECS 集群，除非 `create_ecs_cluster=false`。
- ECR 仓库，除非 `create_ecr_repository=false`。
- 用于 Cursor 服务账号 Key 的 Secrets Manager 密钥容器。
- ECS 任务执行角色与任务角色。
- Fargate 任务定义与 ECS 服务。
- 无入站规则、允许出站 HTTPS/DNS 的安全组。
- Worker 与指标发布器日志的 CloudWatch 日志组。
- 用于服务范围 Cursor Worker 利用率与动态扩容的定时 Lambda 指标发布器。
- Application Auto Scaling 目标、目标跟踪策略与快速步进扩缩容备用告警。

Terraform 会创建 Secrets Manager 密钥容器，但不会将 Cursor API Key 值存入 state。

## 4. 应用基础设施

客户批准 plan 后执行 apply：

```bash
terraform -chdir=ecs/terraform apply \
  -var "aws_profile=" \
  -var "aws_region=$AWS_REGION" \
  -var "ecs_cluster_name=$ECS_CLUSTER_NAME" \
  -var "ecs_service_name=$ECS_SERVICE_NAME" \
  -var "ecs_task_family=$ECS_TASK_FAMILY" \
  -var "worker_pool_name=$ECS_WORKER_POOL_NAME" \
  -var "worker_repository_url=$WORKER_REPOSITORY_URL" \
  -var "cursor_api_key_secret_name=$CURSOR_API_KEY_SECRET_NAME" \
  -var "min_capacity=$ECS_MIN_CAPACITY" \
  -var "max_capacity=$ECS_MAX_CAPACITY" \
  -var "target_idle_workers=$ECS_TARGET_IDLE_WORKERS"
```

ECS 服务可能在 Worker 镜像或密钥值存在之前启动。首次部署时这是预期行为；后续步骤中上传密钥、推送镜像并强制新部署即可。

## 5. 上传 Cursor 服务账号 Key

将 `.env` 中的 Key 上传到 Secrets Manager：

```bash
aws secretsmanager put-secret-value \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --secret-id "$CURSOR_API_KEY_SECRET_NAME" \
  --secret-string "$CURSOR_API_KEY"
```

ECS 任务执行角色在任务启动时读取该密钥，并注入为 `CURSOR_API_KEY`。

## 6. 构建并推送 Worker 镜像

构建 Docker 镜像并推送到 ECR：

```bash
make ecr-build-push
```

确认 `WORKER_PLATFORM` 与 `ECS_TASK_CPU_ARCHITECTURE` 匹配：`linux/amd64` 对应 `X86_64`，`linux/arm64` 对应 `ARM64`。

若 ECS 服务在密钥或镜像存在之前已启动，强制新部署：

```bash
aws ecs update-service \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$ECS_SERVICE_NAME" \
  --force-new-deployment
```

## 7. 验证 Worker

检查服务状态：

```bash
aws ecs describe-services \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --services "$ECS_SERVICE_NAME" \
  --query "services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,taskDefinition:taskDefinition,events:events[0:5]}"
```

检查运行中任务：

```bash
TASKS="$(aws ecs list-tasks \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --service-name "$ECS_SERVICE_NAME" \
  --desired-status RUNNING \
  --query 'taskArns[]' \
  --output text)"

aws ecs describe-tasks \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --tasks $TASKS \
  --query "tasks[].{lastStatus:lastStatus,healthStatus:healthStatus,taskDefinitionArn:taskDefinitionArn,containers:containers[].{name:name,lastStatus:lastStatus,healthStatus:healthStatus,reason:reason}}"
```

跟踪 Worker 日志：

```bash
aws logs tail "${ECS_WORKER_LOG_GROUP_NAME:-/ecs/$ECS_SERVICE_NAME}" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --follow
```

健康的 Worker 应显示：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <ecs-pool-name>
```

确认 Worker 出现在 Cursor Cloud Agents 仪表盘的 `ECS_WORKER_POOL_NAME` 下，然后选择该池启动测试 Cloud Agent 运行。

## 8. 验证自动扩缩容指标

指标发布器列出运行中的 ECS 任务，将其私有 IP 匹配到 Cursor Worker，并在 `Cursor/SelfHostedWorkers` 下发布以下服务范围 CloudWatch 指标：

- `Connected`
- `InUse`
- `Idle`
- `UtilizationPercent`
- `DesiredCount`
- `RunningTasks`
- `RecommendedCapacity`
- `TargetIdleWorkers`

它还会基于相同指标执行动态扩容。当 `Idle` 低于 `ECS_TARGET_IDLE_WORKERS` 时，会请求更高的 ECS desired count，上限为 `ECS_MAX_CAPACITY`。它不直接缩容；Application Auto Scaling 目标跟踪在较长冷却时间后处理缩容。

动态扩容路径有意仅基于现有 Cursor Worker 指标：

```text
idle_workers = Connected - InUse
recommended_capacity = current_capacity + max(ECS_TARGET_IDLE_WORKERS - idle_workers, 0)
```

这意味着扩缩器在 Worker 变为活跃时才会反应。指标不暴露未能占用 Worker 的排队会话，因此 `ECS_MIN_CAPACITY` 仍是控制无等待突发容量的手段。

### 定时发布器的工作方式

Terraform 使用 `archive` provider 将 `metrics_publisher.py` 打包为 Lambda zip。EventBridge 按 `metrics_publish_schedule_expression` 调用该 Lambda，默认值为：

```text
rate(1 minute)
```

每次运行时，Lambda 会：

1. 从 Secrets Manager 读取 Cursor 服务账号 Key。
2. 对 `ECS_CLUSTER_NAME` 与 `ECS_SERVICE_NAME` 调用 ECS `ListTasks` 与 `DescribeTasks`。
3. 提取每个运行中任务的私有 IP 地址。
4. 调用 Cursor 的 `/v0/private-workers` Worker 列表端点。
5. 将 Cursor Worker 名称与 ECS 任务私有 IP 匹配。
6. 将 ECS 服务范围指标发布到 CloudWatch。
7. 当服务空闲 Worker 少于 `ECS_TARGET_IDLE_WORKERS` 时调用 ECS `UpdateService`。

新 Worker 由 ECS 创建，而非 Lambda 直接创建。Lambda 仅修改 ECS 服务 desired count。ECS 随后从任务定义启动另一个 Fargate 任务，容器启动后该任务注册为另一个 Cursor Worker。

### 生产就绪说明

ECS 概览更详细地解释了控制循环权衡。对本实施而言，先确认指标发布器在运行，生产上线前再应用本指南后续的加固清单。

确认指标发布器在运行：

```bash
aws logs tail "/aws/lambda/${ECS_METRICS_PUBLISHER_NAME:-$ECS_SERVICE_NAME-metrics-publisher}" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --since 15m
```

检查 CloudWatch 利用率：

```bash
aws cloudwatch get-metric-statistics \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --namespace "${ECS_METRICS_NAMESPACE:-Cursor/SelfHostedWorkers}" \
  --metric-name "UtilizationPercent" \
  --dimensions Name=PoolName,Value="${ECS_WORKER_POOL_NAME:-ecs-$CURSOR_WORKER_POOL_NAME}" Name=ClusterName,Value="$ECS_CLUSTER_NAME" Name=ServiceName,Value="$ECS_SERVICE_NAME" \
  --start-time "$(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 \
  --statistics Average
```

ECS Service Auto Scaling 对 `UtilizationPercent` 做目标跟踪。除非添加独立的从零扩缩容信号，否则保持 `ECS_MIN_CAPACITY` 大于零。

本 Terraform root 还会创建快速步进扩缩容告警作为 CloudWatch 备用路径。目标跟踪适用于稳态控制，但 AWS 对其生成的高告警会在多个一分钟周期内评估。快速告警在单个饱和数据点后增加一个 Worker，而指标发布器的动态扩容会在定时发布器观察到无空闲容量后立即反应。

若第二个 Cloud Agent 会话被阻塞而 ECS 仍显示一个 desired task，调用指标发布器并确认分母范围限定在本 ECS 服务：

```bash
aws lambda invoke \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --function-name "${ECS_METRICS_PUBLISHER_NAME:-$ECS_SERVICE_NAME-metrics-publisher}" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  /tmp/cursor-ecs-metrics-response.json

cat /tmp/cursor-ecs-metrics-response.json
```

对于单个繁忙 ECS 任务，`connected` 应为 `1`，`inUse` 应为 `1`，`utilizationPercent` 应为 `100.0`。若 `connected` 包含其他团队 Worker，请应用当前 Terraform，使 Lambda 使用 ECS 任务私有 IP 匹配，而非 Cursor 团队范围摘要端点。

## 9. 更新 Worker 镜像

修改 `docker/` 或 entrypoint 后：

```bash
make ecr-build-push
```

然后强制新的 ECS 部署：

```bash
aws ecs update-service \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$ECS_SERVICE_NAME" \
  --force-new-deployment
```

## 10. 轮换服务账号 Key

更新 `.env`，然后上传新值：

```bash
aws secretsmanager put-secret-value \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --secret-id "$CURSOR_API_KEY_SECRET_NAME" \
  --secret-string "$CURSOR_API_KEY"
```

强制新的 ECS 部署，使新任务读取新密钥值：

```bash
aws ecs update-service \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$ECS_SERVICE_NAME" \
  --force-new-deployment
```

## 11. 生产加固清单

生产上线前，请决定：

- 是否使用带 NAT 的私有子网或 VPC 端点，而非公有任务 ENI。
- 每个仓库、团队或环境是否应获得独立池与 ECS 服务。
- `ECS_MIN_CAPACITY` 是否应为 `2` 或更高以保留预热备用容量。
- 对经常同时启动多个会话的团队，`ECS_TARGET_IDLE_WORKERS` 是否应高于 `1`。
- Worker 是否因特权 Docker、主机缓存、GPU、更大本地磁盘或自定义 AMI 而需要 ECS on EC2 而非 Fargate。
- 是否添加客户标准告警：ECS 部署失败、任务停止、Lambda 错误、指标缺失、高利用率与 Worker 连接失败。

## 12. 清理

完成后销毁 ECS 演示资源：

```bash
terraform -chdir=ecs/terraform destroy
```

这将删除本 Terraform root 管理的 ECS 服务、任务定义资源、ECR 仓库、IAM 角色、日志组、Lambda 指标发布器、EventBridge 调度、安全组与密钥容器。

ECR 仓库配置为强制删除以便实验清理，因此即使包含演示镜像，Terraform 也可移除它。

## 安全说明

- 不要将真实服务账号 API Key 放入 Terraform 变量或 state。
- 不要提交 `.env`、Terraform state、AWS 凭证或私钥。
- 若服务账号 Key 暴露在日志、shell 历史或命令输出中，请轮换该 Key。
