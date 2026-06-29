# EKS 客户实施指南

本指南用于从零开始在 Amazon EKS 上部署 Cursor 自托管 Cloud Agent Worker。

该路径使用 `docker/` 中的共享 Worker 镜像，将镜像推送到 ECR，安装官方 Cursor worker-set controller Helm Chart，并应用生成的 `WorkerDeployment`。Helm values、manifests、labels 及辅助脚本位于 `eks/helm/`。

## 架构

部署后的流程如下：

1. Cursor Cloud Agents 为仓库和自托管池调度任务。
2. Cursor worker-set controller 在 EKS 中运行，并保持指定数量的 Worker Pod 处于就绪状态。
3. 每个 Worker Pod 运行来自 ECR 的共享 Cursor Worker 镜像。
4. Controller 从由 Cursor 服务账号 API Key 支持的 Kubernetes Secret 中管理 Worker 认证 Token。
5. Worker 通过 HTTPS 主动连接 Cursor，无需对 Worker Pod 开放入站访问。

## 前置条件

安装本地工具：

```bash
brew install awscli eksctl kubectl helm
```

你还需要：

- 本地运行 Docker。
- 具备创建 EKS、IAM、VPC、Node Group 和 ECR 资源的 AWS 账号权限。
- 已启用 Self-Hosted Cloud Agents 的 Cursor Enterprise 工作区。
- 用于池 Worker 的 Cursor **服务账号 API Key**。
- 已安装 Cursor GitHub App，且对目标仓库有访问权限。

池 Worker 会拒绝个人、成员、团队及通用组织 API Key。

## 步骤 1：配置本地环境

复制示例环境文件：

```bash
cp .env.example .env
```

在 `.env` 中设置以下值：

```bash
AWS_PROFILE=default
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=<your-aws-account-id>
ECR_REPOSITORY_NAME=cursor-self-hosted-worker

CURSOR_API_KEY=<cursor-service-account-api-key>
CURSOR_WORKER_POOL_NAME=<customer-or-team>-eks-worker-pool
CURSOR_WORKER_IDLE_RELEASE_TIMEOUT=600

K8S_NAMESPACE=<customer-or-team>-eks-worker-pool
WORKER_DEPLOYMENT_NAME=<customer-or-team>-eks-worker-deployment
WORKER_READY_REPLICAS=2
CURSOR_API_KEY_SECRET_NAME=my-workers-api-key
K8S_WORKER_LABELS_FILE=eks/helm/labels.json
```

池名称应包含 `eks`，例如 `acme-eks-worker-pool`，以便在 Cursor 的 Self-Hosted 选择器中识别。

若本地仓库 remote 不是 Cloud Agents 应操作的客户仓库，请设置 `WORKER_REPOSITORY_URL`：

```bash
WORKER_REPOSITORY_URL=https://github.com/<owner>/<repo>.git
```

## 步骤 2：认证 AWS

认证 AWS CLI：

```bash
aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity --profile "$AWS_PROFILE"
```

若未使用 AWS IAM Identity Center，请按常规 AWS 流程配置凭证，并确认 `aws sts get-caller-identity` 可用。若环境支持 `aws login`，亦可使用。

## 步骤 3：创建 EKS 集群

在 Shell 中设置集群名称：

```bash
export EKS_CLUSTER_NAME=cursor-agents-lab
```

创建托管节点 EKS 集群：

```bash
eksctl create cluster \
  --name "$EKS_CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" \
  --nodes 2 \
  --node-type t3.large \
  --managed
```

该命令会创建 VPC、EKS 控制平面、托管 Node Group 及节点 IAM 角色。对于私有集群，请确保 Worker 节点通过 NAT 或其他已批准的出口路径具备出站 HTTPS 访问。

更新 kubeconfig 并验证访问：

```bash
aws eks update-kubeconfig \
  --region "$AWS_REGION" \
  --name "$EKS_CLUSTER_NAME" \
  --profile "$AWS_PROFILE"

kubectl config current-context
kubectl get nodes
```

## 步骤 4：创建或复用 ECR 仓库

若 ECR 仓库尚不存在，则创建：

```bash
aws ecr describe-repositories \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --repository-names "$ECR_REPOSITORY_NAME" >/dev/null 2>&1 \
  || aws ecr create-repository \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --repository-name "$ECR_REPOSITORY_NAME"
```

构建并推送 Worker 镜像：

```bash
make ecr-build-push
```

默认 `WORKER_PLATFORM=linux/amd64` 与上述 `t3.large` 节点类型匹配。若使用 Graviton 节点，构建推送前请设置 `WORKER_PLATFORM=linux/arm64`。

在 `.env` 中将 Kubernetes 镜像设置为 ECR 镜像：

```bash
K8S_WORKER_IMAGE=<aws-account-id>.dkr.ecr.<region>.amazonaws.com/cursor-self-hosted-worker:latest
```

Makefile 会从 `.env` 加载并导出变量。也可在单次命令中指定镜像：`K8S_WORKER_IMAGE="..." make helm-apply`。

## 步骤 5：安装 Cursor Controller

安装官方 Cursor worker-set controller Helm Chart：

```bash
make helm-install-controller
```

确认 Controller 已完成滚动更新：

```bash
kubectl rollout status deployment/worker-set-controller -n "$K8S_NAMESPACE" --timeout=120s
kubectl get pods -n "$K8S_NAMESPACE"
```

## 步骤 6：创建 API Key Secret

从 `CURSOR_API_KEY` 创建或更新 Kubernetes Secret：

```bash
make helm-create-api-key-secret
```

确认 Secret 存在，且不打印 Secret 值：

```bash
kubectl get secret "$CURSOR_API_KEY_SECRET_NAME" -n "$K8S_NAMESPACE"
```

## 步骤 7：渲染并应用 WorkerDeployment

查看生成的 Deployment：

```bash
make helm-render
```

应用：

```bash
make helm-apply
```

等待 Worker Deployment 就绪：

```bash
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl get pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
```

## 步骤 8：验证 Worker 注册

查看 Worker 日志：

```bash
kubectl logs -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker -c worker --since=5m
```

健康的 Worker 日志应包含：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

然后在 Cursor Cloud Agents 中选择 **Self-Hosted**，针对与 `WORKER_REPOSITORY_URL` 匹配的仓库启动测试任务。

## 步骤 9：更新或扩缩 Worker

更新 Worker 镜像：

```bash
make ecr-build-push
make helm-apply
```

调整就绪 Worker 数量：

```bash
WORKER_READY_REPLICAS=2 make helm-apply
kubectl get workerdeployments -n "$K8S_NAMESPACE"
```

将 `WORKER_READY_REPLICAS` 设置为至少等于池需要承载的并发 Cloud Agent 会话数。单个 Worker 同一时刻只能处理一个活跃任务，因此客户演示建议从 `WORKER_READY_REPLICAS=2` 开始，若预期更多并发会话再扩容。

将同一池扩缩至 5 个就绪 Worker：

```bash
WORKER_READY_REPLICAS=5 make helm-apply
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl get pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
```

若 5 个 Worker 为稳态目标，确认集群容量充足后，在 `.env` 中更新 `WORKER_READY_REPLICAS=5`。

若需基于 Cursor Worker 指标自动扩缩，安装基于 Prometheus 的 Scaler：

```bash
make helm-install-autoscaling
```

该命令会安装无持久化存储的 Prometheus，为 Worker `/metrics` 端点创建 `cursor-worker-metrics` Service，并运行 Scaler CronJob。CronJob 读取 `cursor_self_hosted_worker_connected` 和 `cursor_self_hosted_worker_session_active`，在 `WORKER_MIN_REPLICAS=2` 与 `WORKER_MAX_REPLICAS=5` 之间 patch `WorkerDeployment.spec.readyReplicas`。

CronJob 版本有意保持简单，但并非即时生效。Kubernetes CronJob 按分钟边界执行，因此扩容最多约需 60 秒，外加 Worker Pod 启动时间。当所有当前 Worker 均繁忙时，Scaler 将池开放至 `WORKER_MAX_REPLICAS`；活跃会话归零后，缩回 `WORKER_MIN_REPLICAS`。若客户需要亚分钟级响应，可将 CronJob 替换为常驻的小型 Scaler Deployment，每 10–15 秒轮询 Prometheus 并使用相同的 patch 逻辑。

轮换 Cursor 服务账号 Key：

```bash
make helm-create-api-key-secret
kubectl delete pod -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
```

Controller 会重建 Worker Pod 并挂载新的认证材料。

## 故障排查

### `helm` 或 `kubectl` 缺失

安装所需工具：

```bash
brew install awscli eksctl kubectl helm
```

然后重新运行 `helm version --short` 和 `kubectl version --client=true`。

### `kubectl` 无集群 Context

若 `kubectl config current-context` 失败，或 `kubectl cluster-info` 尝试连接 `localhost:8080`，请更新 kubeconfig：

```bash
aws eks update-kubeconfig \
  --region "$AWS_REGION" \
  --name "$EKS_CLUSTER_NAME" \
  --profile "$AWS_PROFILE"
```

### Worker Pod 出现 `ImagePullBackOff`

确认 `K8S_WORKER_IMAGE` 指向已推送的 ECR 镜像：

```bash
echo "$K8S_WORKER_IMAGE"
aws ecr describe-images \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --repository-name "$ECR_REPOSITORY_NAME"
```

同时确认节点 IAM 角色具备 ECR 拉取权限。`eksctl` 创建的托管 Node Group 通常已包含 ECR 读权限。

### Pod 因 `exec format error` 失败

Worker 镜像架构与节点架构不匹配。x86 节点使用 `WORKER_PLATFORM=linux/amd64`，Graviton 节点使用 `WORKER_PLATFORM=linux/arm64`，然后重新运行 `make ecr-build-push` 和 `make helm-apply`。

### WorkerDeployment Kind 无法识别

Controller Chart 未安装 CRD，或 `helm-install-controller` 未成功完成：

```bash
make helm-install-controller
kubectl get crd | rg workers.cursor.com
```

### Worker 日志显示 API Key 无效

从 Cursor 的 Service Accounts 设置创建 Cursor 服务账号 API Key。更新 `.env` 中的 `CURSOR_API_KEY`，然后重新运行：

```bash
make helm-create-api-key-secret
kubectl delete pod -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
```

### Worker 已运行但任务未启动

检查 Cursor 中的池名称是否与 `CURSOR_WORKER_POOL_NAME` 一致，Worker 日志中的仓库是否为预期仓库，以及 Cursor GitHub App 是否对该仓库有访问权限。

若首个任务能启动但第二个并发任务等待或分配失败，请检查 `kubectl get workerdeployments -n "$K8S_NAMESPACE"`。当 `READY` 低于预期并发会话数时，增大 `WORKER_READY_REPLICAS`。

### 池未从 2 自动增长到 5

`WORKER_READY_REPLICAS=2` 表示 Controller 保持 2 个就绪 Worker。若要池自动增长，请安装指标 Scaler：

```bash
make helm-install-autoscaling
```

预期更多并发任务时仍可手动扩缩：

```bash
WORKER_READY_REPLICAS=5 make helm-apply
kubectl get workerdeployments -n "$K8S_NAMESPACE"
```

EKS 集群自动扩缩、Karpenter 或 Cluster Autoscaler 仅在 Kubernetes 存在不可调度 Pod 时添加节点，不会自行提高 `WorkerDeployment` 副本目标。

### 指标 Autoscaler 未扩缩

确认 Prometheus 正在抓取 Worker：

```bash
kubectl exec -n prometheus deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum(cursor_self_hosted_worker_connected{namespace="'$K8S_NAMESPACE'"})'

kubectl exec -n prometheus deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum(cursor_self_hosted_worker_session_active{namespace="'$K8S_NAMESPACE'"})'
```

确认 Scaler CronJob 正在运行并查看最新日志：

```bash
kubectl get cronjob -n "$K8S_NAMESPACE" cursor-worker-metrics-scaler
kubectl get jobs -n "$K8S_NAMESPACE" | rg cursor-worker-metrics-scaler
kubectl logs -n "$K8S_NAMESPACE" job/<latest-scaler-job-name>
```

若 Prometheus 因未绑定的 PVC 处于 Pending，请用 `make helm-install-autoscaling` 重新安装；该辅助脚本为本实验环境禁用了 Prometheus 持久化。若 Scaler 日志显示 `active=0` 但会话仍在运行，请检查 Worker 是否以 `--management-addr 0.0.0.0:8080` 启动，以及 `kubectl get endpoints -n "$K8S_NAMESPACE" cursor-worker-metrics` 是否列出 Worker Pod IP。若 Scaler 已 patch 副本数但 Pod 仍为 Pending，请修复节点容量、子网 IP 容量或集群自动扩缩。

请勿在未验证的情况下直接对 `WorkerDeployment` 使用普通 HPA 或 KEDA `ScaledObject`。Cursor CRD 暴露了 `/scale`，但其 scale status 不包含 selector，Kubernetes HPA 可能因 `selector is required` 拒绝该目标。本仓库辅助脚本使用 CronJob Scaler 直接 patch `WorkerDeployment` scale 端点。

Prometheus 可能短暂保留已删除 Worker Pod 的指标。Scaler 日志会输出 `connected_metric` 以便观测，但以 Kubernetes `WorkerDeployment` 副本数作为容量分母，避免过期的 Prometheus 序列阻塞扩容。当所有当前 Worker 均活跃时，Scaler 将池开放至 `WORKER_MAX_REPLICAS`；仅当活跃会话归零后才缩回。

### 扩缩至 5 未产生 5 个就绪 Worker

首先确认期望数量已变更：

```bash
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl describe workerdeployment "$WORKER_DEPLOYMENT_NAME" -n "$K8S_NAMESPACE"
```

若 `DESIRED` 为 5 但 `READY` 持续偏低，检查 Pod 与事件：

```bash
kubectl get pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker -o wide
kubectl describe pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
kubectl get events -n "$K8S_NAMESPACE" --sort-by=.lastTimestamp
```

常见阻塞包括节点 CPU/内存不足、VPC CNI IP 耗尽、EC2 实例或子网容量限制、ECR 镜像拉取失败、节点 Taint，以及缺少 Cluster Autoscaler 或 Karpenter 容量。若 Pod 为 `Pending`，请先添加节点或启用自动扩缩，再增大 `WORKER_READY_REPLICAS`。若 Pod 为 `ImagePullBackOff`，请修复 ECR 镜像 URI 或节点 ECR 权限。

### Worker 无法连接 Cursor

Worker 需要出站 HTTPS 访问 Cursor API、Cursor 下载及 Cloud Agent 制品。对于私有 EKS 节点，请验证 NAT、防火墙、代理及 DNS 配置。

### Pod 处于 Pending

检查调度事件：

```bash
kubectl describe pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
kubectl get events -n "$K8S_NAMESPACE" --sort-by=.lastTimestamp
```

常见原因包括 CPU/内存不足、节点 Taint、缺少 Toleration，或 Cluster Autoscaler 限制。

## 清理

删除示例 Worker 及 labels ConfigMap：

```bash
make helm-delete
```

移除 Controller：

```bash
helm uninstall "$CURSOR_CONTROLLER_RELEASE_NAME" -n "$K8S_NAMESPACE"
kubectl delete namespace "$K8S_NAMESPACE"
```

演示完成后删除 EKS 集群：

```bash
eksctl delete cluster \
  --name "$EKS_CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE"
```

若 ECR 仓库仅为演示创建，可删除：

```bash
aws ecr delete-repository \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --repository-name "$ECR_REPOSITORY_NAME" \
  --force
```
