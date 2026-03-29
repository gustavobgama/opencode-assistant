import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initUsageDb, closeUsageDb, upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "../src/usage/db.js"
import {
  querySummaryByDay,
  querySummaryByModel,
  querySummaryBySession,
  querySummaryByTool,
  queryUsageFiltered,
  queryProjectionBase,
  periodToEpoch,
} from "../src/usage/queries.js"
import { Database } from "bun:sqlite"

const DAY_MS = 86_400_000

beforeEach(() => {
  initUsageDb(":memory:")
})

afterEach(() => {
  closeUsageDb()
})

// Helper: create test data spanning multiple days/models/sessions
function seedTestData() {
  const now = Date.now()
  const day1 = now - 2 * DAY_MS
  const day2 = now - 1 * DAY_MS
  const day3 = now

  // Day 1: 2 messages, model gpt-4o, session A
  upsertMessageUsage({
    id: "msg-1a", session_id: "sess-A", model_id: "gpt-4o", provider_id: "openai",
    tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
    tokens_cache_read: 200, tokens_cache_write: 100,
    cost_reported: 0.01, cost_estimated: 0.0075, price_missing: 0,
    created_at: day1, completed_at: day1 + 5000,
  })
  upsertMessageUsage({
    id: "msg-1b", session_id: "sess-A", model_id: "gpt-4o", provider_id: "openai",
    tokens_input: 800, tokens_output: 400, tokens_reasoning: 100,
    tokens_cache_read: 0, tokens_cache_write: 0,
    cost_reported: 0.008, cost_estimated: 0.006, price_missing: 0,
    created_at: day1 + 10000, completed_at: day1 + 15000,
  })

  // Day 2: 1 message, model claude-sonnet-4-20250514, session B
  upsertMessageUsage({
    id: "msg-2a", session_id: "sess-B", model_id: "claude-sonnet-4-20250514", provider_id: "anthropic",
    tokens_input: 2000, tokens_output: 1000, tokens_reasoning: 500,
    tokens_cache_read: 300, tokens_cache_write: 0,
    cost_reported: 0.02, cost_estimated: 0.018, price_missing: 0,
    created_at: day2, completed_at: day2 + 8000,
  })

  // Day 3: 1 message, model gpt-4o, session A
  upsertMessageUsage({
    id: "msg-3a", session_id: "sess-A", model_id: "gpt-4o", provider_id: "openai",
    tokens_input: 500, tokens_output: 250, tokens_reasoning: 0,
    tokens_cache_read: 100, tokens_cache_write: 50,
    cost_reported: 0.005, cost_estimated: 0.004, price_missing: 0,
    created_at: day3, completed_at: day3 + 3000,
  })

  // Steps for msg-1a: 2 steps
  upsertStepUsage({
    id: "step-1a-1", message_id: "msg-1a", session_id: "sess-A",
    model_id: "gpt-4o", provider_id: "openai",
    tokens_input: 600, tokens_output: 300, tokens_reasoning: 0,
    tokens_cache_read: 200, tokens_cache_write: 100,
    cost_reported: 0.006, cost_estimated: 0.0045,
    created_at: day1, completed_at: day1 + 2000, finish_reason: "tool_use",
  })
  upsertStepUsage({
    id: "step-1a-2", message_id: "msg-1a", session_id: "sess-A",
    model_id: "gpt-4o", provider_id: "openai",
    tokens_input: 400, tokens_output: 200, tokens_reasoning: 0,
    tokens_cache_read: 0, tokens_cache_write: 0,
    cost_reported: 0.004, cost_estimated: 0.003,
    created_at: day1 + 2000, completed_at: day1 + 5000, finish_reason: "end_turn",
  })

  // Tools for msg-1a: 3 tools
  upsertToolUsage({
    id: "tool-1a-1-bash", message_id: "msg-1a", session_id: "sess-A",
    call_id: "call-1a-1-bash",
    tool_name: "bash", status: "completed",
    created_at: day1 + 500,
  })
  upsertToolUsage({
    id: "tool-1a-1-write", message_id: "msg-1a", session_id: "sess-A",
    call_id: "call-1a-1-write",
    tool_name: "write", status: "completed",
    created_at: day1 + 1200,
  })
  upsertToolUsage({
    id: "tool-1a-2-read", message_id: "msg-1a", session_id: "sess-A",
    call_id: "call-1a-2-read",
    tool_name: "read", status: "completed",
    created_at: day1 + 3000,
  })

  // Tool for msg-2a: 1 tool with error
  upsertToolUsage({
    id: "tool-2a-bash", message_id: "msg-2a", session_id: "sess-B",
    call_id: "call-2a-bash",
    tool_name: "bash", status: "error",
    created_at: day2 + 2000,
  })

  return { now, day1, day2, day3 }
}

describe("querySummaryByDay", () => {
  it("groups by day with correct totals", () => {
    const { day1 } = seedTestData()
    const rows = querySummaryByDay(day1 - DAY_MS)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    // Day 1 should have 2 messages aggregated
    const day1Row = rows.find(r => r.message_count === 2)
    expect(day1Row).toBeTruthy()
    expect(day1Row!.input_tokens).toBe(1800) // 1000 + 800
    expect(day1Row!.output_tokens).toBe(900) // 500 + 400
  })

  it("respects date range filter", () => {
    const { day2 } = seedTestData()
    // Only day2+day3
    const rows = querySummaryByDay(day2 - 1000)
    const totalMessages = rows.reduce((sum, r) => sum + r.message_count, 0)
    expect(totalMessages).toBe(2) // msg-2a + msg-3a
  })

  it("returns empty array for future epoch", () => {
    seedTestData()
    const rows = querySummaryByDay(Date.now() + DAY_MS)
    expect(rows).toEqual([])
  })
})

describe("querySummaryByModel", () => {
  it("groups by model_id with correct totals", () => {
    seedTestData()
    const rows = querySummaryByModel(0)
    expect(rows.length).toBe(2) // gpt-4o and claude-sonnet-4-20250514
    const gpt = rows.find(r => r.group_key === "gpt-4o")
    expect(gpt).toBeTruthy()
    expect(gpt!.message_count).toBe(3) // msg-1a, 1b, 3a
  })

  it("calculates total tokens correctly per model", () => {
    seedTestData()
    const rows = querySummaryByModel(0)
    const claude = rows.find(r => r.group_key === "claude-sonnet-4-20250514")
    expect(claude).toBeTruthy()
    expect(claude!.input_tokens).toBe(2000)
    expect(claude!.output_tokens).toBe(1000)
    expect(claude!.reasoning_tokens).toBe(500)
    expect(claude!.total_tokens).toBe(3500)
  })
})

describe("querySummaryBySession", () => {
  it("groups by session_id", () => {
    seedTestData()
    const rows = querySummaryBySession(0)
    expect(rows.length).toBe(2)
    const sessA = rows.find(r => r.group_key === "sess-A")
    expect(sessA!.message_count).toBe(3)
    const sessB = rows.find(r => r.group_key === "sess-B")
    expect(sessB!.message_count).toBe(1)
  })
})

describe("querySummaryByTool", () => {
  it("counts tool invocations with success/error", () => {
    seedTestData()
    const rows = querySummaryByTool(0)
    expect(rows.length).toBeGreaterThanOrEqual(2) // bash, write, read
    const bash = rows.find(r => r.tool_name === "bash")
    expect(bash).toBeTruthy()
    expect(bash!.invocations).toBe(2) // tool-1a-1-bash + tool-2a-bash
    expect(bash!.successes).toBe(1)
    expect(bash!.errors).toBe(1)
  })

  it("calculates attributed cost from step cost / tools_in_message", () => {
    seedTestData()
    const rows = querySummaryByTool(0)
    // msg-1a has 3 tools, step cost_reported=0.006+0.004=0.01
    // Each tool gets cost_reported / tool_count (per step) attributed
    const bash = rows.find(r => r.tool_name === "bash")
    expect(bash!.attributed_cost_usd).toBeGreaterThan(0)
  })
})

describe("queryUsageFiltered", () => {
  it("filters by tool_name", () => {
    seedTestData()
    const rows = queryUsageFiltered({ tool_name: "bash" })
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.tool_name === "bash")).toBe(true)
  })

  it("filters by session_id (message level)", () => {
    seedTestData()
    const rows = queryUsageFiltered({ session_id: "sess-B" })
    expect(rows.length).toBe(1) // msg-2a
  })

  it("filters by tool_name + session_id combined", () => {
    seedTestData()
    const rows = queryUsageFiltered({ tool_name: "bash", session_id: "sess-A" })
    expect(rows.length).toBe(1) // only tool-1a-1-bash
  })

  it("filters by model_id", () => {
    seedTestData()
    const rows = queryUsageFiltered({ model_id: "claude-sonnet-4-20250514" })
    expect(rows.length).toBe(1) // msg-2a
    expect(rows[0].model_id).toBe("claude-sonnet-4-20250514")
  })

  it("respects limit", () => {
    seedTestData()
    const rows = queryUsageFiltered({ limit: 2 })
    expect(rows.length).toBe(2)
  })

  it("returns empty array with no matches", () => {
    seedTestData()
    const rows = queryUsageFiltered({ model_id: "nonexistent-model" })
    expect(rows).toEqual([])
  })
})

describe("queryProjectionBase", () => {
  it("returns daily averages and variance", () => {
    seedTestData()
    const result = queryProjectionBase(0)
    expect(result).toBeTruthy()
    expect(result.active_days).toBeGreaterThanOrEqual(2) // at least 2 distinct days
    expect(result.avg_daily_tokens).toBeGreaterThan(0)
    expect(result.avg_daily_cost).toBeGreaterThan(0)
    expect(result.var_cost).toBeGreaterThanOrEqual(0)
  })

  it("returns zeros for empty DB", () => {
    const result = queryProjectionBase(0)
    expect(result.active_days).toBe(0)
    expect(result.total_tokens).toBe(0)
    expect(result.total_cost).toBe(0)
  })

  it("total_tokens matches sum of all messages", () => {
    seedTestData()
    const result = queryProjectionBase(0)
    // msg-1a: 1000+500+0=1500, msg-1b: 800+400+100=1300, msg-2a: 2000+1000+500=3500, msg-3a: 500+250+0=750
    const expectedTotal = 1500 + 1300 + 3500 + 750
    expect(result.total_tokens).toBe(expectedTotal)
  })
})

describe("periodToEpoch", () => {
  it("today — returns start of today", () => {
    const epoch = periodToEpoch("today")
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    expect(epoch).toBe(startOfDay.getTime())
  })

  it("7d — returns ~7 days ago", () => {
    const epoch = periodToEpoch("7d")
    const expected = Date.now() - 7 * DAY_MS
    expect(Math.abs(epoch - expected)).toBeLessThan(100)
  })

  it("30d — returns ~30 days ago", () => {
    const epoch = periodToEpoch("30d")
    const expected = Date.now() - 30 * DAY_MS
    expect(Math.abs(epoch - expected)).toBeLessThan(100)
  })

  it("all — returns 0", () => {
    expect(periodToEpoch("all")).toBe(0)
  })

  it("unknown period — falls back to 7d", () => {
    const epoch = periodToEpoch("garbage")
    const expected = Date.now() - 7 * DAY_MS
    expect(Math.abs(epoch - expected)).toBeLessThan(100)
  })
})
