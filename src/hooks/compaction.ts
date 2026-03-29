import type { Hooks } from "@opencode-ai/plugin"
import { getRecentMemories } from "../memory/db.js"

export function createCompactionHook(): NonNullable<Hooks["experimental.session.compacting"]> {
  return async (_input, output) => {
    const memories = getRecentMemories(10)
    if (memories.length === 0) return

    const lines = memories.map(
      (m) => `- (${m.type}) ${m.content}${m.tags ? ` #${m.tags}` : ""}`,
    )

    output.context.push(
      `<persistent-memories>\n` +
        `The user has these persistent memories that should be preserved:\n` +
        `${lines.join("\n")}\n` +
        `</persistent-memories>`,
    )
  }
}
