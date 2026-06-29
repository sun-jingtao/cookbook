# ECS/Fargate 指南

本方案将 Cursor 自托管 Worker 以 ECS 任务形式运行，可部署在 Fargate 上，也可部署在由 EC2 容量支撑的 ECS 集群上。

本指南涵盖架构、自动扩缩容行为、验证预期、运维权衡与常见故障排查路径。逐步实施请参见 [`terraform/README.zh-CN.md`](terraform/README.zh-CN.md)。

## 当前状态

本目录包含以 Fargate 为主的 Terraform 部署方案，以及一份任务定义示例。Terraform 路径会创建 ECS 服务、ECR 仓库、Secrets Manager 密钥容器、CloudWatch 日志，以及用于 Cursor Worker 利用率的自动扩缩容信号链路。

## 目标架构

- 从 `docker/` 构建共享 Worker 镜像并发布到 ECR。
- 将 Cursor 服务账号 API Key 存储在 Secrets Manager 中。
- 以 ECS 服务形式运行 Worker，每个任务对应一个 Cursor Worker。
- 为任务提供出站 HTTPS 访问，以连接 Cursor API、Cursor 下载源与 Cursor Cloud Agent 制品。
- 将服务范围的 Cursor Worker 利用率发布到 CloudWatch，在空闲 Worker 耗尽时动态请求扩容，并由 ECS Service Auto Scaling 处理稳态扩缩容。

对于不需要特权 Docker、主机挂载缓存、GPU 或自定义 AMI 的团队，Fargate 是默认推荐方案。当 Agent 需要 CI Runner 风格的主机控制或专用硬件时，使用 ECS on EC2。ECS on EC2 会引入第二层扩缩容循环，因为需要同时扩展 ECS 服务的 desired count 与底层 EC2 容量提供者。

## 自动扩缩容模型

不要直接基于 CPU 或内存对 Worker 服务做自动扩缩容。空闲 Worker 的 CPU 可能很低，但仍代表可用的预热容量；繁忙 Worker 也可能因网络或构建步骤阻塞，而非 CPU 瓶颈。

需要关注的 Cursor 指标如下：

- `cursor_self_hosted_worker_connected`：Worker 与 Cursor 存在活跃出站连接时为 `1`。将其视为已连接容量与健康状态。
- `cursor_self_hosted_worker_session_active`：Worker 被 Cloud Agent 会话占用时为 `1`。将其视为已用容量与需求。
- `cursor_self_hosted_worker_last_activity_unix_seconds`：适用于陈旧连接告警。
- `cursor_self_hosted_worker_session_ends_total{reason=...}`：适用于可靠性告警，尤其是 `session_error`、`connection_timeout` 与 `session_aborted`。

自动扩缩容应基于 Worker 占用率：

```text
idle_workers = connected_workers - active_sessions
utilization_percent = active_sessions / connected_workers * 100
recommended_capacity = connected_workers + max(target_idle_workers - idle_workers, 0)
```

不要仅依据 `connected` 扩容。更多已连接 Worker 意味着更多容量，因此在 `connected` 上升时扩容会形成正反馈循环。应将 `connected` 用作利用率的分母，并在 ECS 任务已运行但 Worker 未连接时触发告警。

本实验使用定时 Lambda 指标发布器，而非抓取每个 Fargate 任务。发布器会列出 ECS 服务运行中任务的私有 IP，调用 Cursor Worker 列表 API，将名称包含这些任务 IP 的 Cursor Worker 匹配回来，将 `Connected`、`InUse`、`Idle` 与 `UtilizationPercent` 写入 CloudWatch，并由 ECS Service Auto Scaling 对 `UtilizationPercent` 做目标跟踪。

Cursor 摘要端点是团队范围的，因此当多个自托管池共享同一 Cursor 团队时，不应直接使用。团队范围的分母可能掩盖 ECS 池内的饱和，从而阻止扩容。

发布器还会基于相同指标执行动态扩容。当 `Idle` 低于 `ECS_TARGET_IDLE_WORKERS` 时，它会调用 `ecs:UpdateService` 将 desired count 提升至不超过 `max_capacity`。它只负责扩容；目标跟踪与较长的缩容冷却时间会在 Worker 空闲后处理缩容。

推荐的初始默认值：

- `min_capacity`：演示环境为 `1`，对冷启动延迟更敏感的团队为 `2`。
- `max_capacity`：默认 `5`，受 Cursor 团队 Worker 上限与成本策略约束。
- `target_idle_workers`：`1`，使服务尽量保留一个预热 Worker。
- `target_utilization_percent`：`75`。
- 扩容冷却：`60` 秒。
- 缩容冷却：`600` 至 `900` 秒。
- `CURSOR_WORKER_IDLE_RELEASE_TIMEOUT`：`600`；ECS desired count 仍是舰队规模的权威来源。

Terraform 路径还会为突发演示场景添加快速步进扩缩容告警。AWS 目标跟踪使用多个评估周期，当服务从单个 Worker 启动且多个会话同时到达时可能过慢。发布器的动态扩容是最快路径；快速告警是 CloudWatch 备用路径，目标跟踪仍负责正常稳态扩缩容与缩容。

每个 Worker 的 `/metrics` 端点对仪表盘与调试仍然有用。从 Fargate 抓取它需要服务发现以及 Prometheus、ADOT 或 CloudWatch Agent 等配套组件，因此在本实验中属于次要路径。

## 指标发布机制

Terraform 将 `terraform/metrics_publisher.py` 打包为 Lambda 函数。EventBridge 按 `metrics_publish_schedule_expression` 调用它，默认值为 `rate(1 minute)`。

每次运行完成四件事：

1. 从 Secrets Manager 读取 Cursor 服务账号 Key。
2. 列出该服务的运行中 ECS 任务并记录其私有 IP。
3. 调用 Cursor Worker 列表 API，通过 Worker 名称中的私有 IP 将 Cursor Worker 匹配回 ECS 任务。
4. 将服务范围指标发布到 CloudWatch 命名空间 `Cursor/SelfHostedWorkers`。

Lambda 发布的容量与推荐指标包括：

```text
Connected
InUse
Idle
UtilizationPercent
DesiredCount
RunningTasks
RecommendedCapacity
TargetIdleWorkers
```

启用动态扩容且服务空闲 Worker 少于 `ECS_TARGET_IDLE_WORKERS` 时，Lambda 会以更高的 desired count 调用 `ecs:UpdateService`，上限为 `ECS_MAX_CAPACITY`。ECS 随后从任务定义启动新的 Fargate 任务。这些任务拉取 Worker 镜像，从 Secrets Manager 读取 Cursor API Key，初始化 git 工作区，启动 `agent worker`，并注册到配置的 Cursor 池。

Lambda 不直接缩容。缩容仍由 Application Auto Scaling 与更长的冷却时间处理，以避免活跃会话被激进的控制器打断。

## 企业级建议

对于 ECS/Fargate，当团队希望采用简单、AWS 原生的控制循环，而不运行 Prometheus 或独立控制器时，这种定时 Lambda 模式是合理的实现。它将密钥放在 Secrets Manager，指标放在 CloudWatch，扩缩容放在 ECS/Application Auto Scaling，Worker 服务保持私有且仅出站。

更大规模的企业部署可能更偏好更正式的控制器模式：

- 在 Kubernetes 或 EKS 上，使用 Cursor worker-set 控制器，通过 Prometheus 抓取 Worker `/metrics`，并由 scaler 补丁 `WorkerDeployment.spec.readyReplicas`。普通 HPA/KEDA 可能因 CRD scale-selector 要求而受阻，因此需针对 Cursor CRD 验证所选 scaler。
- 在 ECS/Fargate 上，保留此 Lambda 模式，但需加强告警、仪表盘、最小权限 IAM、仅在账户配额允许时设置预留并发，并按团队、仓库或环境拆分池/服务。
- 对于极高突发负载，将 `min_capacity` 或 `ECS_TARGET_IDLE_WORKERS` 设得足够高以保留预热容量。Cursor 当前的 Worker 指标展示已连接与活跃 Worker，但不暴露会话占用 Worker 之前的排队需求。

## 部署顺序

高层上，ECS/Fargate 路径按以下顺序进行。具体命令与变量见 [`terraform/README.zh-CN.md`](terraform/README.zh-CN.md)。

1. 配置 `.env`：AWS 默认值、Cursor 服务账号 Key、目标仓库，以及 ECS 专用 Worker 池名称。
2. 执行 Terraform apply，创建 ECS、ECR、IAM、Secrets Manager 元数据、日志、指标发布与自动扩缩容。
3. 将 Cursor 服务账号 Key 上传到 Secrets Manager。
4. 构建 Worker 镜像并推送到 ECR。
5. 若服务在密钥或镜像存在之前已启动，则强制新的 ECS 部署。
6. 在 Cursor Cloud Agents 中选择 ECS 自托管池。

## 验证

验证三个层面：ECS 服务健康、Worker 注册与自动扩缩容指标。实施指南包含每层检查的具体 AWS CLI 命令。

健康的 Worker 日志应包含：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

CloudWatch 中应在 `Cursor/SelfHostedWorkers` 下看到服务范围的 `UtilizationPercent` 指标，维度为 `PoolName`、`ClusterName` 与 `ServiceName`。

## 清理

演示结束后停止 AWS 开销：

```bash
terraform -chdir=ecs/terraform destroy
```

本实验将 ECR 仓库配置为强制删除，因此即使仓库中仍有演示镜像，Terraform 也可移除该仓库。

## 常见阻塞点

### Fargate 任务在镜像或密钥存在之前启动

ECS 服务在任务启动时拉取配置的镜像，并从 Secrets Manager 注入密钥值。若任一缺失，任务会很快停止。使用 `aws secretsmanager put-secret-value` 上传密钥，用 `make ecr-build-push` 推送镜像，然后强制新的服务部署。

### ECR 仓库已存在

若已有演示仓库使用相同的 `ECR_REPOSITORY_NAME`，可将其导入 `ecs/terraform` state，或设置 `create_ecr_repository=false` 并将现有仓库作为数据源使用。导入可保持与实验一致的清理行为。

### Lambda 预留并发失败

部分沙箱账户的区域 Lambda 并发配额较低。本实验不为指标发布器预留并发，因为即使预留 1 个执行也可能失败——若会导致账户未预留并发低于 AWS 最低要求。

### Worker 目录不是 Git 仓库

Cursor 从 Worker 目录的 git remote 推导仓库标签。Fargate 任务以空的临时存储启动，因此当设置了 `WORKER_REPOSITORY_URL` 时，共享 Docker entrypoint 会将 `/workspace` 初始化为最小 git 仓库。

### Fleet API 指标是团队范围的

摘要端点返回用户与团队计数。本 ECS 路径使用 Worker 列表端点加上 ECS 任务私有 IP，将利用率隔离到本服务。若 Cursor API 后续在列表响应中暴露池标签，应优先直接按 `pool` 标签过滤。

### ECS 池已满但自动扩缩容未增加任务

现象：一个 ECS Worker 已被 Cloud Agent 会话占用，第二个会话仍被阻塞，ECS 仍保持 `desired_count=1`。

首先确认自动扩缩容指标是服务范围的。若 `connected` 包含 Cursor 团队内所有自托管 Worker 而非仅本 ECS 服务，即使本池已饱和，利用率也可能看起来偏低。实施指南包含用于检查的 Lambda 调用与预期响应结构。

指标修复后，CloudWatch 目标跟踪告警仍需要多个新鲜数据点才会触发扩缩容。对于突发演示，保持快速步进扩缩容告警启用，或临时提高 ECS 服务 desired count。

### 突发会话在新任务就绪前失败

现有 Cursor 指标展示已连接 Worker 与活跃会话，不展示排队或被阻塞的会话。若三名用户同时启动会话而服务仅有一个已连接 Worker，扩缩器只能在第一个 Worker 变为活跃且下一次定时指标发布器运行观察到 `Idle=0` 后才能反应。

对于需要无等待突发的客户演示，将 `min_capacity` 设为预期并发会话数。对于成本敏感默认值，保持 `min_capacity=1`、`target_idle_workers=1`，并说明新 Fargate 任务仍需要时间启动、运行容器 entrypoint、连接 Cursor 并在所选池中注册。

### 动态扩容不会降低 Desired Count

指标发布器只负责扩容。这可避免 Lambda 与 Application Auto Scaling 竞态，在会话仍活跃时终止 Worker。缩容由目标跟踪策略在较长缩容冷却时间后处理。

若突发后服务仍高于基线，检查目标跟踪低告警、近期数据点与 Application Auto Scaling 活动历史。

### 从零扩缩容没有 Connected 分母

若 `min_capacity` 为 `0`，可能没有已连接 Worker 计数作为分母。除非添加独立的定时或基于队列的从零扩缩容信号，否则至少保留一个预热 Worker。

### Service Auto Scaling 会修改 Desired Count

Terraform 创建 ECS 服务的初始 desired count，随后忽略 desired count 漂移，以便 Application Auto Scaling 管理它。应修改 `min_capacity`、`max_capacity` 或扩缩容策略，而不是反复用 Terraform 强制将 `desired_count` 改回。

## 文件

- `task-definition.example.json` 展示 ECS 期望的 Worker 容器命令、环境变量与密钥引用。
- `terraform/` 负责配置 Fargate 服务与 Cursor 利用率指标发布器。

注册任务定义前，请替换占位 ARN、镜像名称以及 CPU/内存值。
