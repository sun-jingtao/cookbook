# DAG 任务运行器

将任务拆解为 JSON DAG，按拓扑顺序以 Cursor SDK 本地子 Agent 运行各节点，并将实时状态流式写入 [Cursor Canvas](https://cursor.com/docs/canvases)；Canvas 在每次状态变更时热更新。

![Live DAG Canvas 预览](docs/demo_vid_dag.gif)

> 录制的 Canvas 运行效果。Runner 每次将新状态写入磁盘时，IDE 都会重新渲染 Canvas，因此可实时看到任务从 `PENDING → RUNNING → FINISHED/ERROR` 推进。

## 功能

- **编写 DAG**：子任务带显式 `depends_on` 边和 `complexity`（HIGH / MED / LOW），Runner 通过可配置默认值映射到 Cursor 模型。
- **拓扑排序**：用 Kahn 算法将 DAG 排成层级（rank），每层用 `Promise.all` 并发执行，独立工作自动扇出。
- **拼接上游输出**：将每个父任务结果写入子任务 prompt——子任务会收到每个父任务结果的前 2,000 字符摘要，无需重复描述。
- **实时流式写入** `.canvas.tsx` 文件。Cursor 在每次写入时重新编译 Canvas，可在各任务卡片中看到逐 token 输出。
- **安全失败**：超时将任务标记为 `ERROR` 而非挂起；下游依赖自动跳过；SIGINT/SIGTERM 会取消进行中的子 Agent，并在退出前 finalize Canvas。

## 快速开始

需要 Node.js 22 或更高版本。

安装依赖：

```bash
pnpm install
```

设置 Cursor API Key：

```bash
export CURSOR_API_KEY="crsr_..."
```

渲染初始 Canvas（无需 API Key），以便在启动运行前打开：

```bash
pnpm init-canvas
open .canvas/dag-example.canvas.tsx
```

端到端运行内置示例 DAG：

```bash
pnpm example
```

示例会构建一个小的单文件 CLI todo 应用。任务默认针对 `process.cwd()` 运行，若不想在 cookbook 中写入文件，请使用临时目录：

```bash
mkdir -p /tmp/dag-demo && cd /tmp/dag-demo
CURSOR_API_KEY="crsr_..." \
  pnpm --dir ~/Code/cookbook/sdk/dag-task-runner \
  dev -- --dag examples/example_dag.json --canvas-path "$PWD/dag-example.canvas.tsx" --cwd "$PWD"
```

观察 [`dag-example.canvas.tsx`](./examples/example_dag.json) 随各 rank 推进而刷新：

```
[dag-runner] DAG "Build a tiny CLI todo app" — 6 tasks across 4 rank(s)
[dag-runner] rank 1/4: research-stack, research-cli-conventions
[dag-runner] rank 2/4: design
[dag-runner] rank 3/4: implement
[dag-runner] rank 4/4: tests, docs
[dag-runner] done — 6/6 succeeded in 1m 47s
```

## DAG 模式

```json
{
  "title": "Build a tiny CLI todo app",
  "models": {
    "HIGH": "gpt-5.3-codex",
    "MED": "composer-2",
    "LOW": "auto-low"
  },
  "tasks": [
    {
      "id": "research-stack",
      "depends_on": [],
      "complexity": "LOW",
      "subtask_prompt": "Sketch the smallest reasonable design …"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------------------|----------|-----------------------------------------------------------------------|
| `id` | 是 | 唯一 kebab-case 标识符，供其他任务的 `depends_on` 引用。 |
| `depends_on` | 是 | `id` 数组。rank-1 任务为空。解析时拒绝环。 |
| `complexity` | 是 | `HIGH`、`MED` 或 `LOW`。通过下方模型映射解析。 |
| `subtask_prompt` | 是 | 自包含 prompt——Runner 会在前面附加 upstream 输出摘要。 |
| `models` | 否 | 顶层 partial complexity → model 覆盖映射。 |

完整示例见 [`examples/example_dag.json`](./examples/example_dag.json)。

## 复杂度模型映射

默认复杂度映射：

| Complexity | 默认模型 |
|------------|--------------------|
| `HIGH` | `gpt-5.3-codex` |
| `MED` | `composer-2` |
| `LOW` | `auto-low` |

可在 DAG 顶层 `models` 对象中 inline 覆盖任意子集，或在 JSON 文件中保存可复用配置：

```json
{
  "HIGH": "gpt-5.3-codex",
  "MED": "composer-2",
  "LOW": "auto-low"
}
```

然后运行：

```bash
pnpm dev -- --dag examples/example_dag.json --models-file ./models.fast.json --canvas-path "$PWD/.canvas/dag-example.canvas.tsx"
```

优先级：defaults < DAG `models` < `--models-file`。Cursor SDK 模型目录因账户而异；官方 SDK 文档建议在覆盖前用 `Cursor.models.list()` 确认有效模型 ID。

## CLI 选项

| 标志 | 默认值 | 说明 |
|-----------------------------|----------------------|------------------------------------------------------------------------------------|
| `--dag` | 必填 | DAG JSON 文件路径。 |
| `--canvas-path` | 组合 | Canvas 文件的完整绝对路径。父级托管流程优先使用。 |
| `--canvas` | — | Canvas 文件名 stem（不含 `.canvas.tsx`）。仅在省略 `--canvas-path` 时使用。 |
| `--canvases-dir` | 按工作区 | 覆盖 Canvas 输出目录。仅与 `--canvas` 一起使用。 |
| `--cwd` | `process.cwd()` | 各子 Agent 的工作目录。 |
| `--models-file` | — | 包含 partial complexity → model 覆盖映射的 JSON 文件。 |
| `--init-only` | `false` | 写入初始全 `PENDING` Canvas 后退出。无需 `CURSOR_API_KEY`。 |
| `--debounce` | `200` ms | Canvas 写入防抖间隔。 |
| `--task-timeout-ms` | `1200000`（20 分钟） | 超过此时间将任务标记为 `ERROR`。 |
| `--stream-publish-ms` | `500` ms | 限制 Canvas 流式写入频率。 |
| `--stream-idle-timeout-ms` | `300000`（5 分钟） | 此窗口内无流事件则将任务标记为 `ERROR`。 |

## 复制为 Cursor Skill

本仓库在 [`../../.cursor/skills/dag-task-runner`](../../.cursor/skills/dag-task-runner) 提供可直接复制的 Skill。将该目录复制到其他项目或个人 Skills 目录：

```bash
# 项目级 Skill（其他仓库）
mkdir -p /path/to/project/.cursor/skills
cp -R .cursor/skills/dag-task-runner /path/to/project/.cursor/skills/

# 跨工作区可用的个人 Skill
mkdir -p ~/.cursor/skills
cp -R .cursor/skills/dag-task-runner ~/.cursor/skills/
```

复制的 Skill 包含 `SKILL.md`、`examples/` 和 `scripts/` 运行时目录，不含 `node_modules`；Skill 说明会在首次使用时在 `scripts/` 中安装依赖。

Skill 按以下顺序自动检测 Runner：

1. 若已设置，使用 `DAG_RUNNER_DIR`。
2. `<current-working-directory>/.cursor/skills/dag-task-runner/scripts`。
3. `<git-root>/.cursor/skills/dag-task-runner/scripts`。
4. `~/.cursor/skills/dag-task-runner/scripts`。

## 同步可复制产物

从 SDK 源码生成 [`../../.cursor/skills/dag-task-runner`](../../.cursor/skills/dag-task-runner)：

```bash
./scripts/sync-copyable-skill.sh
```

编辑 `src/`、`skill/SKILL.md`、`examples/`、`package.json` 或 `tsconfig.json` 后请运行此脚本。

## 项目结构

```
sdk/dag-task-runner/
├── README.md                     # 本文件
├── package.json                  # @cursor/sdk ^1.0.9, tsx, typescript
├── tsconfig.json
├── pnpm-workspace.yaml
├── src/
│   ├── run_dag.ts                # 入口 + 单任务生命周期
│   ├── dag.ts                    # 解析、校验、环检测、拓扑排序
│   └── canvas_writer.ts          # 防抖 .canvas.tsx 渲染器
├── examples/
│   └── example_dag.json          # 6 任务「tiny CLI todo app」演示 DAG
├── docs/
│   ├── dag-canvas-preview.png    # Canvas 截图
│   └── demo_vid_dag.gif          # 本 README 中的 Canvas 动画演示
├── skill/
│   └── SKILL.md                  # 可复制 Skill 说明的源码
└── scripts/
    └── sync-copyable-skill.sh    # 重新生成 ../../.cursor/skills/dag-task-runner/
```

## 说明

- Runner 使用本地 Cursor SDK 运行时——每个子 Agent 针对 `--cwd` 运行（默认为调用 Runner 时的当前目录）。
- 同一 rank 的兄弟任务并行运行；勿让它们写入相同文件。
- 单任务流式文本上限 4,000 字符；传给子任务的 upstream 上下文每个父任务上限 2,000 字符，以控制 Canvas 文件体积。
- 更深入的 API 介绍请参阅 [Cursor SDK TypeScript 文档](https://cursor.com/docs/api/sdk/typescript) 和同级的 [Quickstart](../quickstart) 示例。
