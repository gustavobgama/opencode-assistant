import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initUsageDb, closeUsageDb, upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "../src/usage/db.js"
import { usageSummary, usageQuery, usageEstimate } from "../src/usage/tools.js"

const DAY_MS = 86_400_000

beforeEach(() => {
  initUsageDb(":memory:")
})

afterEach(() => {
  closeUsageDb()
})

function seedData() {
  const now = Date.now()
  const day1 = now - 3 * DAY_MS
  const day2 = now - 2 * DAY_MS
  const day3 = now - 1 * DAY_MS
  const day4 = now

  for (let d = 0; d < 4; d++) {
    const dayEpoch = [day1, day2, day3, day4][d]
    upsertMessageUsage({
      id: `msg-${d}`, session_id: "sess-1", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000 + d * 100, tokens_output: 500 + d * 50, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008 + d * 0.001, price_missing: 0,
      created_at: dayEpoch, completed_at: dayEpoch + 3000,
    })

    upsertStepUsage({
      id: `step-${d}`, message_id: `msg-${d}`, session_id: "sess-1",
      model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000 + d * 100, tokens_output: 500 + d * 50, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008 + d * 0.001,
      created_at: dayEpoch, completed_at: dayEpoch + 2000, finish_reason: "end_turn",
    })

    upsertToolUsage({
      id: `tool-${d}`, message_id: `msg-${d}`, session_id: "sess-1",
      call_id: `call-${d}`, tool_name: d % 2 === 0 ? "bash" : "read",
      status: "completed", created_at: dayEpoch + 500,
    })
  }
}

// --- usageSummary ---

describe("usageSummary", () => {
  it("returns summary grouped by day (default)", async () => {
    seedData()
    const result = await usageSummary.execute({ period: "7d" })
    expect(typeof result).toBe("string")
    expect(result).toContain("Usage summary")
    expect(result).toContain("grouped by day")
    expect(result).toContain("4 messages") // 4 total messages
  })

  it("returns summary grouped by model", async () => {
    seedData()
    const result = await usageSummary.execute({ period: "all", group_by: "model" })
    expect(result).toContain("grouped by model")
    expect(result).toContain("gpt-4o")
  })

  it("returns summary grouped by session", async () => {
    seedData()
    const result = await usageSummary.execute({ period: "all", group_by: "session" })
    expect(result).toContain("grouped by session")
    expect(result).toContain("sess-1")
  })

  it("returns summary grouped by tool", async () => {
    seedData()
    const result = await usageSummary.execute({ period: "all", group_by: "tool" })
    expect(result).toContain("Tool usage summary")
    expect(result).toContain("bash")
    expect(result).toContain("read")
  })

  it("returns 'no data' message for empty DB", async () => {
    const result = await usageSummary.execute({ period: "today" })
    expect(result).toContain("No usage data found")
  })

  it("defaults to 7d and day if no args", async () => {
    seedData()
    const result = await usageSummary.execute({})
    expect(result).toContain("7d")
    expect(result).toContain("grouped by day")
  })
})

// --- usageQuery ---

describe("usageQuery", () => {
  it("returns message-level records without tool filter", async () => {
    seedData()
    const result = await usageQuery.execute({})
    expect(result).toContain("Found 4 records")
    expect(result).toContain("gpt-4o")
  })

  it("filters by tool_name", async () => {
    seedData()
    const result = await usageQuery.execute({ tool_name: "bash" })
    expect(result).toContain("Found 2 records")
    expect(result).toContain("bash")
    expect(result).not.toContain("read")
  })

  it("filters by session_id", async () => {
    seedData()
    const result = await usageQuery.execute({ session_id: "sess-1" })
    expect(result).toContain("Found 4 records")
  })

  it("filters by model_id", async () => {
    seedData()
    const result = await usageQuery.execute({ model_id: "claude-sonnet" })
    expect(result).toContain("No records found")
  })

  it("respects limit", async () => {
    seedData()
    const result = await usageQuery.execute({ limit: 2 })
    expect(result).toContain("Found 2 records")
  })

  it("returns 'no records' for no matches", async () => {
    seedData()
    const result = await usageQuery.execute({ tool_name: "nonexistent" })
    expect(result).toContain("No records found")
  })
})

// --- usageEstimate ---

describe("usageEstimate", () => {
  it("projects for a month with adequate data", async () => {
    seedData()
    const result = await usageEstimate.execute({ horizon: "month", based_on: "30d" })
    expect(result).toContain("Projection for next month")
    expect(result).toContain("30 days")
    expect(result).toContain("Expected")
    expect(result).toContain("Range")
    expect(result).toContain("Daily avg")
  })

  it("projects for a week", async () => {
    seedData()
    const result = await usageEstimate.execute({ horizon: "week" })
    expect(result).toContain("7 days")
  })

  it("projects for a quarter", async () => {
    seedData()
    const result = await usageEstimate.execute({ horizon: "quarter" })
    expect(result).toContain("90 days")
  })

  it("warns when data is insufficient (<3 days)", async () => {
    // Only seed 2 days of data
    const now = Date.now()
    upsertMessageUsage({
      id: "msg-a", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
      created_at: now - DAY_MS, completed_at: now - DAY_MS + 2000,
    })
    upsertMessageUsage({
      id: "msg-b", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 800, tokens_output: 400, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.008, cost_estimated: 0.006, price_missing: 0,
      created_at: now, completed_at: now + 2000,
    })

    const result = await usageEstimate.execute({ horizon: "month" })
    expect(result).toContain("Warning")
    expect(result).toContain("unreliable")
  })

  it("returns guidance when no data at all", async () => {
    const result = await usageEstimate.execute({ horizon: "month" })
    expect(result).toContain("No usage data available")
  })

  it("defaults horizon to month", async () => {
    seedData()
    const result = await usageEstimate.execute({})
    expect(result).toContain("month")
  })
})
