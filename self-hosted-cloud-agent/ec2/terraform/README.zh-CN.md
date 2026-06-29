# EC2 实现指南

这是 EC2 + Docker 方案面向客户的实现部署手册。

架构概览、运行模型、验证预期与故障排查请参阅 [`../README.zh-CN.md`](../README.zh-CN.md)。

除非另有说明，所有命令均从仓库根目录执行。

## 1. 确认前置条件

确认客户具备：

- 已启用 Self-Hosted Cloud Agents 的 Cursor Enterprise。
- 用于 Pool Worker 的 Cursor 服务账号 API Key。
- 已为目标仓库所有者与仓库安装 Cursor GitHub App。
- 创建 EC2、ECR、IAM、Secrets Manager、安全组与 SSM 资源的 AWS 权限。
- 具备出站互联网访问的 VPC/子网，可访问 Cursor、ECR、Secrets Manager、SSM 与软件包仓库。

安装本地工具：

```bash
brew install awscli terraform
```

Worker 镜像需在本地构建并推送，因此 Docker 必须在本地运行。

认证 AWS 并确认账户：

```bash
aws login --profile default
aws sts get-caller-identity --profile default
```

## 2. 配置 `.env`

复制示例文件：

```bash
cp .env.example .env
```

填写 EC2 相关值：

```bash
AWS_PROFILE=default
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=<aws-account-id>

CURSOR_API_KEY=<cursor-service-account-api-key>
CURSOR_WORKER_POOL_NAME=<customer-ec2-pool-name>
CURSOR_WORKER_IDLE_RELEASE_TIMEOUT=600
CURSOR_API_KEY_SECRET_NAME=cursor/ec2-service-account-key

ECR_REPOSITORY_NAME=cursor-self-hosted-worker
WORKER_IMAGE_TAG=latest
WORKER_PLATFORM=linux/amd64
WORKER_REPOSITORY_URL=https://github.com/OWNER/REPO.git

EC2_INSTANCE_TYPE=t3.small
EC2_WORKER_HOST_NAME=cursor-worker-lab
```

请使用 Cursor **服务账号 API Key**。普通成员、用户、团队、个人或组织 API Key 无法用于 Pool Worker。

请使用 EC2 专用 Pool 名称（如 `ec2-platform-agents`），便于在 Cursor Cloud Agents 中识别 Worker。

`WORKER_REPOSITORY_URL` 应指向 Cloud Agents 将要操作的仓库。若为空，Makefile 默认使用本地 git remote origin。

Graviton 实例请设置：

```bash
WORKER_PLATFORM=linux/arm64
EC2_INSTANCE_TYPE=t4g.small
```

直接运行 Terraform 时传入 `-var "ami_architecture=arm64"`，或在本实验的 Makefile EC2 Terraform 命令中添加该变量。

## 3. 初始化 Terraform

初始化 EC2 Terraform 脚手架：

```bash
make ec2-terraform-init
```

## 4. 审查 Terraform Plan

审查计划：

```bash
make ec2-terraform-plan
```

确认计划仅创建预期资源：

- ECR 仓库。
- 用于 Cursor 服务账号密钥的 Secrets Manager 密钥容器。
- IAM 角色、实例配置文件与最小权限 inline policy。
- SSM 托管实例策略附加。
- 无入站规则、出站 HTTPS/DNS 的安全组。
- EC2 Worker 主机。

Terraform 创建 Secrets Manager 密钥容器，但不会在 state 中存储 Cursor API Key 值。

## 5. 应用基础设施

客户批准计划后执行 apply：

```bash
make ec2-terraform-apply
```

EC2 实例可能在密钥值或 Worker 镜像就绪前即已启动。user data 脚本会等待两者就绪，最长数分钟。若等待超时，请上传密钥、推送镜像，并通过 Terraform 替换实例，或通过 SSM 重新执行 Bootstrap 命令。

## 6. 上传 Cursor 服务账号密钥

将 `.env` 中的密钥上传至 Secrets Manager：

```bash
make ec2-put-api-key-secret
```

EC2 主机在 Bootstrap 时读取该密钥并写入 `/etc/cursor/worker.env`。

## 7. 构建并推送 Worker 镜像

构建 Docker 镜像并推送至 ECR：

```bash
make ecr-build-push
```

默认构建 `linux/amd64`，与默认 `t3.small` 实例类型匹配。

## 8. 验证 EC2 与 SSM

从 Terraform 输出获取实例 ID：

```bash
INSTANCE_ID="$(terraform -chdir=ec2/terraform output -raw worker_instance_id)"
echo "$INSTANCE_ID"
```

检查 EC2 状态：

```bash
aws ec2 describe-instance-status \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --include-all-instances
```

启动 SSM 会话：

```bash
aws ssm start-session \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --target "$INSTANCE_ID"
```

## 9. 在主机上验证 Worker

在 SSM Shell 中检查 Bootstrap 日志：

```bash
sudo tail -n 200 /var/log/cursor-worker-bootstrap.log
```

检查 Docker：

```bash
sudo docker ps --filter name=cursor-worker
sudo docker logs -f cursor-worker
```

健康的 Worker 应显示：

```text
Worker is now running
Registering to worker pool
Repo: <owner>/<repo>
Pool: <pool-name>
```

然后打开 Cursor Cloud Agents，确认自托管 Worker Pool 可见且已为目标仓库选中。

## 10. Bootstrap 超时后替换实例

若首次启动时密钥值或 ECR 镜像尚不可用，请先创建缺失依赖：

```bash
make ec2-put-api-key-secret
make ecr-build-push
```

然后使用 apply 步骤中相同的 Terraform 变量替换 Worker 实例：

```bash
terraform -chdir=ec2/terraform apply -replace=aws_instance.worker
```

若 AWS 认证使用 `aws login`，请先在清理步骤中通过 `aws configure export-credentials` 导出临时凭证。

## 11. 更新 Worker 镜像

修改 `docker/` 或 entrypoint 后，发布新镜像：

```bash
make ecr-build-push
```

然后启动 SSM 会话连接主机并重建容器：

```bash
AWS_REGION=<aws-region>
ECR_WORKER_IMAGE=<account-id>.dkr.ecr.<aws-region>.amazonaws.com/<repository-name>:<tag>

aws ecr get-login-password --region "$AWS_REGION" \
  | sudo docker login --username AWS --password-stdin "${ECR_WORKER_IMAGE%/*}"

sudo docker rm -f cursor-worker
sudo docker pull "$ECR_WORKER_IMAGE"
sudo docker run -d \
  --name cursor-worker \
  --restart unless-stopped \
  --env-file /etc/cursor/worker.env \
  --volume /opt/cursor/worker:/workspace \
  "$ECR_WORKER_IMAGE"
```

## 12. 轮换服务账号密钥

更新 `.env` 后上传新值：

```bash
make ec2-put-api-key-secret
```

启动 SSM 会话连接主机，刷新 `/etc/cursor/worker.env` 并重建容器。单纯的 `docker restart` 不会从 `--env-file` 重新加载环境变量。

```bash
AWS_REGION=<aws-region>
CURSOR_API_KEY_SECRET_NAME=<secret-name>
CURSOR_WORKER_POOL_NAME=<customer-ec2-pool-name>
CURSOR_WORKER_IDLE_RELEASE_TIMEOUT=600
ECR_WORKER_IMAGE=<account-id>.dkr.ecr.<aws-region>.amazonaws.com/<repository-name>:<tag>

SECRET_VALUE="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$CURSOR_API_KEY_SECRET_NAME" \
  --query SecretString \
  --output text)"

sudo install -d -m 0700 /etc/cursor
{
  printf 'CURSOR_API_KEY=%s\n' "$SECRET_VALUE"
  printf 'CURSOR_WORKER_POOL_NAME=%s\n' "$CURSOR_WORKER_POOL_NAME"
  printf 'CURSOR_WORKER_IDLE_RELEASE_TIMEOUT=%s\n' "$CURSOR_WORKER_IDLE_RELEASE_TIMEOUT"
  printf 'CURSOR_WORKER_LABELS_FILE=/etc/cursor/labels.json\n'
} | sudo tee /etc/cursor/worker.env >/dev/null
sudo chmod 0600 /etc/cursor/worker.env
unset SECRET_VALUE

sudo docker rm -f cursor-worker
sudo docker run -d \
  --name cursor-worker \
  --restart unless-stopped \
  --env-file /etc/cursor/worker.env \
  --volume /opt/cursor/worker:/workspace \
  "$ECR_WORKER_IMAGE"
```

## 13. 清理

完成后销毁 EC2 演示资源：

```bash
tmpfile="$(mktemp)"
aws configure export-credentials --profile "$AWS_PROFILE" --format env-no-export > "$tmpfile"
set -a
source "$tmpfile"
set +a
rm -f "$tmpfile"

terraform -chdir=ec2/terraform destroy
```

destroy 时若 Terraform 提示输入变量，请使用 apply 步骤中相同的 Terraform 变量值。

ECR 仓库已配置 force delete 以便实验清理，因此即使仓库内仍有演示镜像，Terraform 也可删除该仓库。

## 安全注意事项

- 不要将真实服务账号 API Key 写入 Terraform 变量或 state。
- 不要提交 `.env`、Terraform state、AWS 凭证或私钥。
- 若密钥暴露在日志、Shell 历史或 SSM 命令输出中，请轮换服务账号密钥。
