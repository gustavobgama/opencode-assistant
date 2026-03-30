import type { Plugin } from "@opencode-ai/plugin"
import { createSystemPromptHook } from "./hooks/system-prompt.js"
import { createCompactionHook } from "./hooks/compaction.js"
import { memorySave, memorySearch, memoryList } from "./memory/tools.js"
import { getDb, countMemories } from "./memory/db.js"
import { getUsageDb } from "./usage/db.js"
import { createUsageEventHandler } from "./usage/collector.js"
import { usageSummary, usageQuery, usageEstimate } from "./usage/tools.js"

const VERSION = "0.3.0"

const plugin: Plugin = async (input) => {
  console.log(`[opencode-assistant] v${VERSION} loaded`)
  console.log(`[opencode-assistant] directory: ${input.directory}`)

  // Initialize memory DB on boot
  getDb()
  const count = countMemories()
  console.log(`[opencode-assistant] memory: ready (${count} memories)`)

  // Initialize usage tracking DB on boot
  getUsageDb()
  console.log(`[opencode-assistant] usage: ready`)

  return {
    "experimental.chat.system.transform": createSystemPromptHook(),
    "experimental.session.compacting": createCompactionHook(),
    event: createUsageEventHandler(),
    tool: {
      memory_save: memorySave,
      memory_search: memorySearch,
      memory_list: memoryList,
      usage_summary: usageSummary,
      usage_query: usageQuery,
      usage_estimate: usageEstimate,
    },
  }
}

export default plugin
