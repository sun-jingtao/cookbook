# EKS Helm 资源

若你已有 Kubernetes 集群，需要了解 Helm target、生成的 manifest 及本地冒烟测试流程，请参阅本文档。端到端 EKS 客户运行手册请从 [`../README.zh-CN.md`](../README.zh-CN.md) 开始。

Helm 路径安装官方 Cursor worker-set controller，并为共享 Worker 镜像应用生成的 Kubernetes `WorkerDeployment`。

## 安装内容

该工作流会安装：

- 官方 Cursor worker-set controller Helm Chart。
- 默认 `cursord` 命名空间。
- 包含 Cursor 服务账号 API Key 的 Kubernetes Secret。
- 挂载到 Worker 容器的 labels ConfigMap。
- 一个运行共享 Worker 镜像的示例 `WorkerDeployment`。

Controller Chart 由 `values.yaml` 配置。默认 Chart 引用为：

```text
oci://public.ecr.aws/j6w0t2f5/cursor/worker-set-controller-chart
```

## 端到端流程

先设置 `.env` 值。对于远程集群，`K8S_WORKER_IMAGE` 必须指向集群可拉取的镜像，例如 ECR、GHCR 或其他 Registry 镜像。

```bash
make docker-build
make helm-install-controller
make helm-create-api-key-secret
make helm-render
make helm-apply
```

对于与 EC2 路径使用相同 ECR 镜像的 EKS 风格演示：

```bash
make ecr-build-push
K8S_WORKER_IMAGE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$WORKER_IMAGE_TAG" make helm-apply
```

`helm-render` 会打印生成的 `WorkerDeployment`，便于在应用前审查确切的 Kubernetes 对象。

## 本地 Kind 冒烟测试

本地验证时，使用 `kind` 配合官方 Cursor controller Chart 及本地 Worker 镜像。

若缺少 `helm` 或 `kind`：

```bash
brew install helm kind
```

创建本地集群、构建镜像并加载到 kind 节点：

```bash
kind create cluster --name cursor-helm-lab
make docker-build
kind load docker-image cursor-self-hosted-worker:local --name cursor-helm-lab
```

然后部署 Controller 和 Worker：

```bash
make helm-install-controller
make helm-create-api-key-secret
make helm-apply
```

验证本地部署：

```bash
kubectl get pods -n "$K8S_NAMESPACE"
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl logs -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker -c worker --since=5m
```

预期的健康输出：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

## Worker 启动方式

`make helm-install-controller` 对官方 controller Chart 执行 `helm upgrade --install`，并通过 `values.yaml` 启用认证管理。

`make helm-create-api-key-secret` 从 `CURSOR_API_KEY` 创建 API Key Secret，并为其打上 `WorkerDeployment` 所需标签。这样 Secret 值不会出现在已提交的 YAML 中。

`make helm-apply` 创建命名空间，从 `eks/helm/labels.json` 应用 labels ConfigMap，并应用生成的 `WorkerDeployment`。Pod 包含：

1. 将 `/workspace` 初始化为 git 仓库并将 `origin` 设置为 `WORKER_REPOSITORY_URL` 的 init 容器。
2. 启动 `agent worker --pool --pool-name "$CURSOR_WORKER_POOL_NAME"` 的 Worker 容器。
3. 供 Controller 使用的 `0.0.0.0:8080` 管理端口。
4. 位于 `/var/run/cursor/token`、由 Controller 从 API Key Secret 管理的 Token 文件。

已提交的 `manifests/worker-deployment.yaml` 为静态示例。Make target 使用 `scripts/render-worker-deployment.sh`，以便本地 `.env` 值生效，无需手动编辑 YAML。

## 验证

检查 Controller：

```bash
kubectl get pods -n "$K8S_NAMESPACE"
kubectl get deploy -n "$K8S_NAMESPACE"
kubectl logs -n "$K8S_NAMESPACE" -l app.kubernetes.io/name=worker-set-controller --since=5m
```

检查 Worker Deployment：

```bash
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl get pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
kubectl logs -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker -c worker -f
```

健康的 Worker 日志应包含：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

## 更新 Worker

修改 Docker 文件或 entrypoint 后，构建并推送新镜像，然后再次应用生成的 Worker Deployment：

```bash
make ecr-build-push
K8S_WORKER_IMAGE="<registry>/<repo>:<tag>" make helm-apply
```

若要支持多个并发 Cloud Agent 会话，将 `WORKER_READY_REPLICAS` 设置为至少等于期望并发数：

```bash
WORKER_READY_REPLICAS=2 make helm-apply
kubectl get workerdeployments -n "$K8S_NAMESPACE"
```

单个 Worker 同一时刻只能处理一个活跃任务。客户演示建议从 `WORKER_READY_REPLICAS=2` 开始，预期更多并发会话时再扩容：

```bash
WORKER_READY_REPLICAS=5 make helm-apply
kubectl get workerdeployments -n "$K8S_NAMESPACE"
```

若需基于 Cursor Worker 指标自动扩缩，安装基于 Prometheus 的 Scaler：

```bash
make helm-install-autoscaling
```

该命令为 Worker `/metrics` 端点创建 `cursor-worker-metrics` Service，安装 Prometheus，并运行 Scaler CronJob。面向客户的行为说明与调优指南见 [`../README.zh-CN.md`](../README.zh-CN.md)。

轮换服务账号 Key 后：

```bash
make helm-create-api-key-secret
kubectl delete pod -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker
```

若 Controller 在 Secret 更新后自动重建 Pod，则无需手动重启。

## 常见问题

### Helm 或 Kind 缺失

本地冒烟测试需安装两者：

```bash
brew install helm kind
```

对于已有远程集群，`kind` 可选，但 `make helm-install-controller` 需要 `helm`。

### 未设置 Kubernetes Context

若 `kubectl config current-context` 失败，或 `kubectl cluster-info` 尝试连接 `localhost:8080`，说明 kubeconfig 未指向集群。本地验证请创建 kind 集群：

```bash
kind create cluster --name cursor-helm-lab
kubectl config current-context
```

对于 EKS 或其他远程集群，运行 Helm target 前先更新 kubeconfig。

### 集群无法拉取镜像

默认 `cursor-self-hosted-worker:local` 镜像仅在本地 Kubernetes 运行时可见时可用，例如将镜像加载到集群后的本地 kind/minikube 环境。远程集群需将 `K8S_WORKER_IMAGE` 设置为 Registry 镜像。

对于 kind：

```bash
make docker-build
kind load docker-image cursor-self-hosted-worker:local --name cursor-helm-lab
```

### Worker 目录不是 Git 仓库

Cursor 从 Worker 目录的 git remote 推导仓库标签。生成的 Helm 示例通过 init 容器在 `/workspace` 执行 `git init`，并从 `WORKER_REPOSITORY_URL` 设置 remote 来处理。

### API Key 无效

池 Worker 需要 Cursor **服务账号 API Key**。普通用户、成员、团队、个人或组织 API Key 会被拒绝。

从 Cursor 的 Service Accounts 设置创建 Key，更新 `.env`，然后重新运行 `make helm-create-api-key-secret`。

### CRD 缺失

若 `kubectl apply` 报告无法识别 `WorkerDeployment`，说明 controller Chart 未完成 CRD 安装。重新运行：

```bash
make helm-install-controller
kubectl get crd | rg workers.cursor.com
```

### 扩缩未达到期望 Worker 数量

若 `WORKER_READY_REPLICAS=5 make helm-apply` 未得到 `READY 5`，检查 Worker Pod 与事件：

```bash
kubectl get workerdeployments -n "$K8S_NAMESPACE"
kubectl get pods -n "$K8S_NAMESPACE" -l app=cursor-self-hosted-worker -o wide
kubectl get events -n "$K8S_NAMESPACE" --sort-by=.lastTimestamp
```

典型阻塞包括节点 CPU/内存容量、EKS 上 VPC CNI IP 耗尽、镜像拉取错误、节点 Taint，以及缺少集群自动扩缩。持续使用前请先增加容量或启用自动扩缩，再提高就绪 Worker 目标。

若池仍停留在 `READY 2`，请确认 `WorkerDeployment` 期望副本数已变更。Cluster Autoscaler 仅为不可调度 Pod 添加 Kubernetes 节点，不会自动将 `readyReplicas` 从 2 改为 5。

### 指标 Autoscaler 未扩缩

确认 Prometheus 正在抓取 Worker：

```bash
kubectl exec -n prometheus deploy/prometheus-server -c prometheus-server -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum(cursor_self_hosted_worker_connected{namespace="'$K8S_NAMESPACE'"})'
```

确认 Scaler CronJob 正在运行：

```bash
kubectl get cronjob -n "$K8S_NAMESPACE" cursor-worker-metrics-scaler
kubectl get jobs -n "$K8S_NAMESPACE" | rg cursor-worker-metrics-scaler
```

若 Prometheus 因未绑定的 PVC 处于 Pending，请使用仓库辅助脚本安装；该脚本为实验环境禁用 Prometheus 持久化，使无默认 StorageClass 的 EKS 集群仍可工作。若 Scaler 日志显示 `active=0` 但会话仍在运行，请检查 Worker 是否以 `--management-addr 0.0.0.0:8080` 启动，以及 `cursor-worker-metrics` Service 是否有 endpoints。

请勿在未验证的情况下直接对 `WorkerDeployment` 使用普通 HPA 或 KEDA `ScaledObject`。客户指南说明了 CRD scale 限制及 CronJob Scaler 行为。

### Kind 初始调度警告

在单节点 kind 集群上，事件可能短暂显示 Controller 的 `FailedScheduling`，因为 control-plane Taint 尚未被 Toleration。实际运行中通常在数秒内恢复，Controller 正常完成滚动更新。

## 清理

移除示例 Worker Deployment 及 labels ConfigMap：

```bash
make helm-delete
```

卸载 Controller Release 及命名空间：

```bash
helm uninstall "$CURSOR_CONTROLLER_RELEASE_NAME" -n "$K8S_NAMESPACE"
kubectl delete namespace "$K8S_NAMESPACE"
```

若创建了本地 kind 集群，一并删除：

```bash
kind delete cluster --name cursor-helm-lab
```
