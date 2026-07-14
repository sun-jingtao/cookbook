/**
 * ponytail: assert local model-id encoding matches what the local runtime accepts.
 * Run: node scripts/check-local-model-ids.mjs
 */
import assert from "node:assert/strict"

function encodeLocalModelId(catalogId, model, config) {
  const remapped = encodeLegacyLocalModelId(catalogId, config)
  if (remapped) return remapped
  if (usesBareLocalModelId(catalogId, model)) return catalogId
  const effort = config.effort
  if (!effort || effort === "none") return catalogId
  const fast = config.fast && supportsFastLocalSuffix(catalogId, effort)
  return `${catalogId}-${effort}${fast ? "-fast" : ""}`
}

function encodeLegacyLocalModelId(catalogId, config) {
  switch (catalogId) {
    case "gpt-5.4": {
      const effort = config.effort ?? "medium"
      const supportsFast = ["medium", "high", "xhigh"].includes(effort)
      return `gpt-5.4-${effort}${config.fast && supportsFast ? "-fast" : ""}`
    }
    case "gpt-5.3-codex": {
      const effort = config.effort ?? "medium"
      const effortSuffix = effort === "medium" ? "" : `-${effort}`
      const supportsFast = ["medium", "high", "xhigh"].includes(effort)
      return `gpt-5.3-codex${effortSuffix}${
        config.fast && supportsFast ? "-fast" : ""
      }`
    }
    case "gpt-5.1":
    case "gpt-5.1-codex-mini": {
      const effort = config.effort ?? "medium"
      if (!effort || effort === "none" || effort === "medium") return catalogId
      return `${catalogId}-${effort}`
    }
    case "claude-sonnet-4-6": {
      const effort = config.effort === "high" ? "high" : "medium"
      return `claude-4.6-sonnet-${effort}${config.thinking ? "-thinking" : ""}`
    }
    case "claude-opus-4-6": {
      const effort = config.effort === "max" ? "max" : "high"
      const supportsVariants = effort === "high"
      return `claude-4.6-opus-${effort}${
        config.thinking && supportsVariants ? "-thinking" : ""
      }${config.fast && supportsVariants ? "-fast" : ""}`
    }
    case "claude-sonnet-4-5":
      return `claude-4.5-sonnet${config.thinking ? "-thinking" : ""}`
    case "claude-haiku-4-5":
      return `claude-4.5-haiku${config.thinking ? "-thinking" : ""}`
    case "claude-sonnet-4":
      return `claude-4-sonnet${config.thinking ? "-thinking" : ""}`
    default:
      return null
  }
}

function usesBareLocalModelId(catalogId, model) {
  if (catalogId === "default" || catalogId === "auto") return true
  if (catalogId.startsWith("composer-")) return true
  if (catalogId.startsWith("gemini-") || catalogId.startsWith("kimi-")) return true
  return !model?.parameters?.some((p) => p.id === "effort" || p.id === "reasoning")
}

function supportsFastLocalSuffix(catalogId, effort) {
  if (catalogId.startsWith("grok-")) return false
  return ["medium", "high", "xhigh", "max"].includes(effort)
}

const cases = [
  [
    "grok-4.5",
    { parameters: [{ id: "effort" }, { id: "fast" }] },
    { effort: "high", fast: true, thinking: false },
    "grok-4.5-high",
  ],
  [
    "claude-opus-4-8",
    { parameters: [{ id: "effort" }, { id: "thinking" }, { id: "fast" }] },
    { effort: "high", fast: false, thinking: true },
    "claude-opus-4-8-high",
  ],
  [
    "claude-sonnet-5",
    { parameters: [{ id: "effort" }, { id: "thinking" }] },
    { effort: "high", fast: false, thinking: true },
    "claude-sonnet-5-high",
  ],
  [
    "gpt-5.6-sol",
    { parameters: [{ id: "reasoning" }, { id: "fast" }] },
    { effort: "medium", fast: true, thinking: false },
    "gpt-5.6-sol-medium-fast",
  ],
  [
    "composer-2.5",
    { parameters: [{ id: "fast" }] },
    { effort: undefined, fast: true, thinking: false },
    "composer-2.5",
  ],
  [
    "claude-sonnet-4-5",
    { parameters: [{ id: "thinking" }] },
    { effort: undefined, fast: false, thinking: true },
    "claude-4.5-sonnet-thinking",
  ],
  [
    "gpt-5.1",
    { parameters: [{ id: "reasoning" }] },
    { effort: "medium", fast: false, thinking: false },
    "gpt-5.1",
  ],
  [
    "gemini-3.1-pro",
    { parameters: [] },
    { effort: undefined, fast: false, thinking: false },
    "gemini-3.1-pro",
  ],
]

for (const [id, model, config, expected] of cases) {
  assert.equal(encodeLocalModelId(id, model, config), expected, id)
}

console.log(`ok: ${cases.length} local model id cases`)
