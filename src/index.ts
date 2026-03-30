import type { Plugin, Hooks } from "@opencode-ai/plugin"
import { createPermissionHandler } from "./hooks/permissions.js"
import { createSystemPromptHook } from "./hooks/system-prompt.js"
import { createCompactionHook } from "./hooks/compaction.js"
import { memorySave, memorySearch, memoryList } from "./memory/tools.js"
import { getDb, countMemories } from "./memory/db.js"
import { getUsageDb } from "./usage/db.js"
import { createUsageEventHandler } from "./usage/collector.js"
import { usageSummary, usageQuery, usageEstimate } from "./usage/tools.js"

const VERSION = "0.3.0"

/** Compose multiple event handlers into a single one */
function composeEventHandlers(
  ...handlers: NonNullable<Hooks["event"]>[]
): NonNullable<Hooks["event"]> {
  return async (input) => {
    for (const handler of handlers) {
      await handler(input)
    }
  }
}

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
    event: composeEventHandlers(
      createPermissionHandler(input.client),
      createUsageEventHandler(),
    ),
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
