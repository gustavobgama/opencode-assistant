import { tool } from "@opencode-ai/plugin"
import { saveMemory, searchMemories, listMemories } from "./db.js"
import { containsSecret } from "./secrets.js"

const z = tool.schema

const memoryTypeEnum = z.enum(["fact", "decision", "preference", "observation"])

export const memorySave = tool({
  description:
    "Save a persistent memory that will be available across all future sessions. " +
    "Use PROACTIVELY to remember important facts, user preferences, project decisions, and key observations. " +
    "Types: fact (factual info), decision (choices made), preference (user likes/dislikes), observation (patterns noticed). " +
    "Be concise but include enough context to be useful later. Do this silently — never mention memories to the user.",
  args: {
    content: z.string().describe("The memory content. Be concise but contextual."),
    type: memoryTypeEnum.optional().default("observation").describe("Category of memory"),
    tags: z.string().optional().default("").describe("Comma-separated tags for searchability"),
  },
  async execute(args) {
    if (containsSecret(args.content)) {
      return "REJECTED: content appears to contain a secret or credential. Memories must not store sensitive data."
    }
    const memory = saveMemory(args.content, args.type, args.tags)
    return `Memory saved (id: ${memory.id}, type: ${memory.type})`
  },
})

export const memorySearch = tool({
  description:
    "Search persistent memories by keywords. Uses full-text search with relevance ranking. " +
    "Use to recall past decisions, user preferences, project facts, or observations from previous sessions.",
  args: {
    query: z.string().describe("Search query — words will be matched against memory content and tags"),
    type: memoryTypeEnum.optional().describe("Filter by memory type"),
    limit: z.number().optional().default(10).describe("Maximum results (default: 10)"),
  },
  async execute(args) {
    const results = searchMemories(args.query, args.type, args.limit)
    if (results.length === 0) return "No memories found matching the query."

    const lines = results.map(
      (m) => `- [${m.id}] (${m.type}) ${m.content}${m.tags ? ` #${m.tags}` : ""} — ${m.created_at}`,
    )
    return `Found ${results.length} memories:\n${lines.join("\n")}`
  },
})

export const memoryList = tool({
  description:
    "List recent persistent memories, optionally filtered by type. " +
    "Use to review what has been remembered across sessions.",
  args: {
    type: memoryTypeEnum.optional().describe("Filter by memory type"),
    limit: z.number().optional().default(20).describe("Maximum results (default: 20)"),
  },
  async execute(args) {
    const results = listMemories(args.type, args.limit)
    if (results.length === 0) return "No memories stored yet."

    const lines = results.map(
      (m) => `- [${m.id}] (${m.type}) ${m.content}${m.tags ? ` #${m.tags}` : ""} — ${m.created_at}`,
    )
    return `${results.length} memories:\n${lines.join("\n")}`
  },
})
