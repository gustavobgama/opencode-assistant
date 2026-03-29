import { tool } from "@opencode-ai/plugin"
import {
  periodToEpoch,
  querySummaryByDay,
  querySummaryByModel,
  querySummaryBySession,
  querySummaryByTool,
  queryUsageFiltered,
  queryProjectionBase,
} from "./queries.js"

const z = tool.schema

// --- Helpers ---

function formatTokens(n: number): string {
  return n.toLocaleString("en-US")
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`
}

function epochToIso(ms: number): string {
  return new Date(ms).toISOString()
}

function horizonToDays(horizon: string): number {
  switch (horizon) {
    case "week": return 7
    case "month": return 30
    case "quarter": return 90
    default: return 30
  }
}

// --- Tools ---

export const usageSummary = tool({
  description:
    "Returns a summary of token usage and estimated costs. " +
    "Supports grouping by day, model, session, or tool. " +
    "Use for questions like 'how much have I used?', 'which model costs more?', 'which tools are most expensive?'.",
  args: {
    period: z.enum(["today", "7d", "30d", "all"]).optional().default("7d")
      .describe("Time period to summarize"),
    group_by: z.enum(["day", "model", "session", "tool"]).optional().default("day")
      .describe("How to group results"),
  },
  async execute(args) {
    const period = args.period ?? "7d"
    const groupBy = args.group_by ?? "day"
    const fromEpoch = periodToEpoch(period)

    if (groupBy === "tool") {
      const rows = querySummaryByTool(fromEpoch)
      if (rows.length === 0) return "No tool usage data found for the selected period."
      const totalInvocations = rows.reduce((s, r) => s + r.invocations, 0)
      const totalCost = rows.reduce((s, r) => s + r.attributed_cost_usd, 0)
      let out = `Tool usage summary (${period}):\n`
      out += `Total invocations: ${formatTokens(totalInvocations)}, Total attributed cost: ${formatUsd(totalCost)}\n\n`
      for (const r of rows) {
        const successRate = r.invocations > 0 ? ((r.successes / r.invocations) * 100).toFixed(1) : "0"
        out += `- ${r.tool_name}: ${formatTokens(r.invocations)} calls (${successRate}% success), cost: ${formatUsd(r.attributed_cost_usd)}\n`
      }
      return out
    }

    const queryFn =
      groupBy === "model" ? querySummaryByModel :
      groupBy === "session" ? querySummaryBySession :
      querySummaryByDay

    const rows = queryFn(fromEpoch)
    if (rows.length === 0) return "No usage data found for the selected period."

    const totalTokens = rows.reduce((s, r) => s + r.total_tokens, 0)
    const totalCost = rows.reduce((s, r) => s + r.estimated_cost_usd, 0)
    const totalMessages = rows.reduce((s, r) => s + r.message_count, 0)

    let out = `Usage summary (${period}, grouped by ${groupBy}):\n`
    out += `Total: ${formatTokens(totalTokens)} tokens, ${formatUsd(totalCost)} estimated, ${formatTokens(totalMessages)} messages\n\n`
    for (const r of rows) {
      out += `- ${r.group_key}: ${formatTokens(r.total_tokens)} tokens (in: ${formatTokens(r.input_tokens)}, out: ${formatTokens(r.output_tokens)}), ${formatUsd(r.estimated_cost_usd)}, ${r.message_count} msgs\n`
    }
    return out
  },
})

export const usageQuery = tool({
  description:
    "Query detailed usage records with filters. " +
    "Returns individual message and tool usage events. " +
    "Use for drill-down analysis like 'show me all bash tool calls this week'.",
  args: {
    session_id: z.string().optional().describe("Filter by session ID"),
    model_id: z.string().optional().describe("Filter by model (e.g. 'gpt-4o')"),
    tool_name: z.string().optional().describe("Filter by tool name (e.g. 'bash', 'read')"),
    from_date: z.string().optional().describe("Start date (ISO format, e.g. '2025-07-01')"),
    to_date: z.string().optional().describe("End date (ISO format)"),
    limit: z.number().optional().default(50).describe("Max records to return"),
  },
  async execute(args) {
    const filters = {
      session_id: args.session_id,
      model_id: args.model_id,
      tool_name: args.tool_name,
      from_epoch: args.from_date ? new Date(args.from_date).getTime() : undefined,
      to_epoch: args.to_date ? new Date(args.to_date).getTime() : undefined,
      limit: args.limit,
    }

    const rows = queryUsageFiltered(filters)
    if (rows.length === 0) return "No records found matching the filters."

    let out = `Found ${rows.length} records:\n\n`
    for (const r of rows) {
      if (r.tool_name) {
        out += `- [${epochToIso(r.created_at)}] tool: ${r.tool_name} (${r.tool_status}), session: ${r.session_id.substring(0, 8)}...\n`
      } else {
        out += `- [${epochToIso(r.created_at)}] ${r.model_id}: ${formatTokens(r.tokens_input)} in / ${formatTokens(r.tokens_output)} out, cost: ${formatUsd(r.cost_estimated)}, session: ${r.session_id.substring(0, 8)}...\n`
      }
    }
    return out
  },
})

export const usageEstimate = tool({
  description:
    "Projects future token usage and costs based on historical patterns. " +
    "Use for questions like 'how much will I spend this month?', 'what's my projected usage?'.",
  args: {
    horizon: z.enum(["week", "month", "quarter"]).optional().default("month")
      .describe("Projection period"),
    based_on: z.string().optional().default("30d")
      .describe("Historical period to base projection on. Supports '7d', '30d', '90d'."),
  },
  async execute(args) {
    const horizon = args.horizon ?? "month"
    const basedOn = args.based_on ?? "30d"
    const fromEpoch = periodToEpoch(basedOn)
    const horizonDays = horizonToDays(horizon)

    const base = queryProjectionBase(fromEpoch)

    if (base.active_days === 0) {
      return "No usage data available for projection. Start using the assistant and check back later."
    }

    if (base.active_days < 3) {
      const projected_tokens = base.avg_daily_tokens * horizonDays
      const projected_cost = base.avg_daily_cost * horizonDays
      return (
        `⚠️ Warning: Only ${base.active_days} day(s) of data — projection is unreliable.\n\n` +
        `Rough estimate for next ${horizon} (${horizonDays} days):\n` +
        `- Tokens: ~${formatTokens(Math.round(projected_tokens))}\n` +
        `- Cost: ~${formatUsd(projected_cost)}\n` +
        `\nCollect at least 3 days of data for a meaningful projection.`
      )
    }

    const projected_tokens = base.avg_daily_tokens * horizonDays
    const projected_cost = base.avg_daily_cost * horizonDays
    const stddev_tokens = Math.sqrt(Math.max(0, base.var_tokens))
    const stddev_cost = Math.sqrt(Math.max(0, base.var_cost))
    const low_tokens = Math.max(0, (base.avg_daily_tokens - stddev_tokens) * horizonDays)
    const high_tokens = (base.avg_daily_tokens + stddev_tokens) * horizonDays
    const low_cost = Math.max(0, (base.avg_daily_cost - stddev_cost) * horizonDays)
    const high_cost = (base.avg_daily_cost + stddev_cost) * horizonDays

    let out = `Projection for next ${horizon} (${horizonDays} days), based on ${base.active_days} days of history:\n\n`
    out += `Tokens:\n`
    out += `  Expected: ${formatTokens(Math.round(projected_tokens))}\n`
    out += `  Range: ${formatTokens(Math.round(low_tokens))} — ${formatTokens(Math.round(high_tokens))}\n`
    out += `  Daily avg: ${formatTokens(Math.round(base.avg_daily_tokens))}\n\n`
    out += `Estimated cost (USD):\n`
    out += `  Expected: ${formatUsd(projected_cost)}\n`
    out += `  Range: ${formatUsd(low_cost)} — ${formatUsd(high_cost)}\n`
    out += `  Daily avg: ${formatUsd(base.avg_daily_cost)}\n\n`
    out += `Based on: ${formatTokens(Math.round(base.total_tokens))} tokens over ${base.active_days} active days (${formatUsd(base.total_cost)} total)`
    return out
  },
})
