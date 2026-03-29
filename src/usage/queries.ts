import { getUsageDb } from "./db.js"

// --- Types ---

export interface SummaryRow {
  group_key: string
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  estimated_cost_usd: number
  message_count: number
}

export interface ToolSummaryRow {
  tool_name: string
  invocations: number
  successes: number
  errors: number
  attributed_cost_usd: number
}

export interface UsageDetailRow {
  id: string
  session_id: string
  model_id: string
  provider_id: string
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  cost_estimated: number
  created_at: number
  // Tool fields (when tool_name filter used)
  tool_name?: string
  tool_status?: string
}

export interface ProjectionBase {
  active_days: number
  total_tokens: number
  total_cost: number
  avg_daily_tokens: number
  avg_daily_cost: number
  var_tokens: number
  var_cost: number
}

// --- Helpers ---

export function periodToEpoch(period: string): number {
  const now = Date.now()
  switch (period) {
    case "today": {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case "7d":
      return now - 7 * 86_400_000
    case "30d":
      return now - 30 * 86_400_000
    case "all":
      return 0
    default:
      return now - 7 * 86_400_000 // fallback to 7d
  }
}

// --- Aggregation Queries ---

export function querySummaryByDay(fromEpoch: number): SummaryRow[] {
  const db = getUsageDb()
  return db.prepare(`
    SELECT
      date(created_at / 1000, 'unixepoch', 'localtime') AS group_key,
      SUM(tokens_input + tokens_output + tokens_reasoning) AS total_tokens,
      SUM(tokens_input) AS input_tokens,
      SUM(tokens_output) AS output_tokens,
      SUM(tokens_reasoning) AS reasoning_tokens,
      SUM(cost_estimated) AS estimated_cost_usd,
      COUNT(*) AS message_count
    FROM message_usage
    WHERE created_at >= ?
    GROUP BY group_key
    ORDER BY group_key DESC
  `).all(fromEpoch) as SummaryRow[]
}

export function querySummaryByModel(fromEpoch: number): SummaryRow[] {
  const db = getUsageDb()
  return db.prepare(`
    SELECT
      model_id AS group_key,
      SUM(tokens_input + tokens_output + tokens_reasoning) AS total_tokens,
      SUM(tokens_input) AS input_tokens,
      SUM(tokens_output) AS output_tokens,
      SUM(tokens_reasoning) AS reasoning_tokens,
      SUM(cost_estimated) AS estimated_cost_usd,
      COUNT(*) AS message_count
    FROM message_usage
    WHERE created_at >= ?
    GROUP BY model_id
    ORDER BY total_tokens DESC
  `).all(fromEpoch) as SummaryRow[]
}

export function querySummaryBySession(fromEpoch: number): SummaryRow[] {
  const db = getUsageDb()
  return db.prepare(`
    SELECT
      session_id AS group_key,
      SUM(tokens_input + tokens_output + tokens_reasoning) AS total_tokens,
      SUM(tokens_input) AS input_tokens,
      SUM(tokens_output) AS output_tokens,
      SUM(tokens_reasoning) AS reasoning_tokens,
      SUM(cost_estimated) AS estimated_cost_usd,
      COUNT(*) AS message_count
    FROM message_usage
    WHERE created_at >= ?
    GROUP BY session_id
    ORDER BY total_tokens DESC
  `).all(fromEpoch) as SummaryRow[]
}

export function querySummaryByTool(fromEpoch: number): ToolSummaryRow[] {
  const db = getUsageDb()
  return db.prepare(`
    SELECT
      t.tool_name,
      COUNT(*) AS invocations,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) AS errors,
      COALESCE(SUM(mc.msg_cost / NULLIF(tc.tool_count, 0)), 0) AS attributed_cost_usd
    FROM tool_usage t
    LEFT JOIN (
      SELECT id AS message_id, cost_estimated AS msg_cost
      FROM message_usage
    ) mc ON mc.message_id = t.message_id
    LEFT JOIN (
      SELECT message_id, COUNT(*) AS tool_count
      FROM tool_usage
      GROUP BY message_id
    ) tc ON tc.message_id = t.message_id
    WHERE t.created_at >= ?
    GROUP BY t.tool_name
    ORDER BY invocations DESC
  `).all(fromEpoch) as ToolSummaryRow[]
}

// --- Filtered Query ---

export interface UsageFilters {
  session_id?: string
  model_id?: string
  tool_name?: string
  from_epoch?: number
  to_epoch?: number
  limit?: number
}

export function queryUsageFiltered(filters: UsageFilters): UsageDetailRow[] {
  const db = getUsageDb()
  const conditions: string[] = []
  const params: any[] = []

  if (filters.tool_name) {
    // Query tool_usage joined with message_usage
    if (filters.session_id) {
      conditions.push("t.session_id = ?")
      params.push(filters.session_id)
    }
    if (filters.from_epoch) {
      conditions.push("t.created_at >= ?")
      params.push(filters.from_epoch)
    }
    if (filters.to_epoch) {
      conditions.push("t.created_at <= ?")
      params.push(filters.to_epoch)
    }
    conditions.push("t.tool_name = ?")
    params.push(filters.tool_name)

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""
    params.push(filters.limit ?? 50)

    return db.prepare(`
      SELECT
        t.id, t.session_id, m.model_id, m.provider_id,
        m.tokens_input, m.tokens_output, m.tokens_reasoning,
        m.cost_estimated, t.created_at,
        t.tool_name, t.status AS tool_status
      FROM tool_usage t
      LEFT JOIN message_usage m ON m.id = t.message_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(...params) as UsageDetailRow[]
  }

  // Query message_usage
  if (filters.session_id) {
    conditions.push("session_id = ?")
    params.push(filters.session_id)
  }
  if (filters.model_id) {
    conditions.push("model_id = ?")
    params.push(filters.model_id)
  }
  if (filters.from_epoch) {
    conditions.push("created_at >= ?")
    params.push(filters.from_epoch)
  }
  if (filters.to_epoch) {
    conditions.push("created_at <= ?")
    params.push(filters.to_epoch)
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""
  params.push(filters.limit ?? 50)

  return db.prepare(`
    SELECT id, session_id, model_id, provider_id,
           tokens_input, tokens_output, tokens_reasoning,
           cost_estimated, created_at
    FROM message_usage
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params) as UsageDetailRow[]
}

// --- Projection ---

export function queryProjectionBase(fromEpoch: number): ProjectionBase {
  const db = getUsageDb()
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT day) AS active_days,
      COALESCE(SUM(daily_tokens), 0) AS total_tokens,
      COALESCE(SUM(daily_cost), 0) AS total_cost,
      COALESCE(AVG(daily_tokens), 0) AS avg_daily_tokens,
      COALESCE(AVG(daily_cost), 0) AS avg_daily_cost,
      COALESCE(AVG(daily_tokens * daily_tokens) - AVG(daily_tokens) * AVG(daily_tokens), 0) AS var_tokens,
      COALESCE(AVG(daily_cost * daily_cost) - AVG(daily_cost) * AVG(daily_cost), 0) AS var_cost
    FROM (
      SELECT
        date(created_at / 1000, 'unixepoch', 'localtime') AS day,
        SUM(tokens_input + tokens_output + tokens_reasoning) AS daily_tokens,
        SUM(cost_estimated) AS daily_cost
      FROM message_usage
      WHERE created_at >= ?
      GROUP BY day
    ) daily
  `).get(fromEpoch) as ProjectionBase

  return row
}
