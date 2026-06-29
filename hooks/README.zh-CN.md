# Cursor Hooks 示例

本目录是一个带引导的 [Cursor Hooks](https://cursor.com/docs/hooks) 示例，采用项目式布局：一份 Hook 配置文件，以及一个共享脚本目录，集中演示多种 Hook 模式。

## 项目结构

```sh
hooks/
├── README.md
└── .cursor/
    ├── hooks.json
    └── hooks/
        ├── audit-log.sh
        ├── block-models-by-repo-origin.sh
        ├── sensitive-prompt-guard.sh
        └── update-skills-on-stop.mjs
```

## 示例内容

### 附加日志

`audit-log.sh` 为 prompt 提交、shell 命令、shell 结果和文件编辑写入 JSONL 审计日志。默认从项目根目录写入 `.cursor/hook-logs/audit.jsonl`。

目标不必是本地 JSONL 文件。同样的模式也可以把记录发送到个人日志脚本、公司内部审计服务、SIEM，或团队自有的其他日志工具。

### 敏感 prompt 防护

`sensitive-prompt-guard.sh` 会拦截疑似包含密钥或敏感数据的 prompt。`beforeSubmitPrompt` 可以阻止向 Cursor 后端和模型提交，但无法在原地改写或脱敏 prompt 文本。

类似的 Hook 也可以把 prompt 交给 DLP 服务、密钥扫描器或其他内部安全工具，当该系统返回敏感命中时阻止提交。

### 按模型/仓库拦截 prompt

`block-models-by-repo-origin.sh` 在选定的模型与 git origin 仓库名同时匹配配置子串列表时，拦截 prompt 提交。Hook 从 `beforeSubmitPrompt` 载荷读取 `model`，在项目根执行 `git remote get-url origin`，从 URL 提取仓库名，并对 `MODEL_BLOCKLIST` 与 `BLOCKED_REPO_NAMES` 做宽泛子串匹配。示例中两个列表都使用 `example`，因此 `example` 模型会在如 `git@github.com:{org}/example.git` 或 `https://github.com/{org}/example-app.git` 的仓库上被拦截。

匹配故意设计得较宽：概念上类似检查被拦截的仓库字符串是否出现在 git remote 返回的仓库名任意位置，可能超出精确仓库名匹配。示例 Hook 配置为 `failClosed: true`，因此崩溃、超时或无效 JSON 会 fail closed；但当不存在 git `origin` remote 时，脚本会故意返回 `continue: true`。

### Skill 更新后续检查

`update-skills-on-stop.mjs` 在 `stop` 时运行，检查变更文件，并在配置的代码区域发生变更时，要求 Agent 更新相关 `.cursor/skills/*/SKILL.md`。

这可作为让 Skills 随时间自我维护的一种方式。

## 使用这些示例

将 `hooks/` 目录复制到你的项目中，然后把 `hooks/.cursor/hooks.json` 合并到项目 Hook 配置 `.cursor/hooks.json`。示例命令假设脚本仍在 `hooks/.cursor/hooks/*`，并从项目根目录运行：

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "hooks/.cursor/hooks/sensitive-prompt-guard.sh",
        "matcher": "UserPromptSubmit",
        "failClosed": true
      }
    ]
  }
}
```

若更偏好 Cursor 常规的项目 Hook 位置，可将脚本移到 `.cursor/hooks/`，并相应更新 command 路径。

你可以注释掉或删除不需要启用的 Hook。

## 自定义

- 编辑 `block-models-by-repo-origin.sh` 中的 `BLOCKED_REPO_NAMES` 和 `MODEL_BLOCKLIST`，拦截特定模型/仓库子串组合。
- 编辑 `sensitive-prompt-guard.sh` 中的模式，调整 prompt 拦截规则。
- 编辑 `update-skills-on-stop.mjs` 中的 `SKILL_MAPPINGS`，映射代码路径到你自己的 Skills。
- 设置 `CURSOR_HOOK_LOG_DIR` 更改审计日志目录。
- 设置 `CURSOR_HOOK_LOG_VERBOSE=1`，在审计日志中包含 shell 输出预览。

## 说明

- 项目 Hook 从项目根目录运行。
- 受信任的工作区会自动从 `.cursor/hooks.json` 加载项目 Hook。同样，可在用户级 `~/.cursor` 或组织级（cursor.com/dashboard）定义这些 Hook。
- `audit-log.sh` 使用 `bash` 和 `jq`；启用前请确认 Hook 环境中可用。
- `block-models-by-repo-origin.sh` 使用 `git` 和 `bash`；启用前请确认 Hook 环境中可用。
- `sensitive-prompt-guard.sh` 使用 `bash` 和 `jq`；启用前请确认 Hook 环境中可用。
- `beforeSubmitPrompt` 可拦截本地 prompt 提交，但对 Cloud Agent 不可用，因为 prompt 在云端 VM 创建之前就已提交。
- 若还需按模型拦截子 Agent，请额外使用 `subagentStart` Hook；`beforeSubmitPrompt` 仅覆盖启动主请求的 prompt 提交。
- 日志 Hook 可能捕获敏感信息。在真实仓库中启用前，请审查本示例记录的内容。
