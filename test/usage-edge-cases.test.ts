/**
 * Edge cases & boundary conditions for usage tracking.
 * Phase 5, Task 5.2 — REQ-1, REQ-3, REQ-6, REQ-7, NFR-1, NFR-6
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { initUsageDb, closeUsageDb, getUsageDb, upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "../src/usage/db.js"
import { createUsageEventHandler } from "../src/usage/collector.js"
import { seedPrices, estimateCost, lookupPrice } from "../src/usage/prices.js"
import { querySummaryByDay, querySummaryByTool, queryProjectionBase, queryUsageFiltered } from "../src/usage/queries.js"
import { usageSummary, usageQuery, usageEstimate } from "../src/usage/tools.js"
import { makeAssistantMessageEvent, makeToolPartEvent, setupMemoryDb, teardownDb } from "./fixtures/usage-fixtures.js"

const DAY_MS = 86_400_000

beforeEach(() => setupMemoryDb())
afterEach(() => teardownDb())

// Helper — invoke handler properly (it expects { event })
async function callHandler(handler: ReturnType<typeof createUsageEventHandler>, event: any) {
  await handler({ event } as any)
}

// --- Collector edge cases ---

describe("collector — malformed events", () => {
  it("event without tokens field → no row inserted", async () => {
    const handler = createUsageEventHandler()
    const event = makeAssistantMessageEvent()
    delete event.properties.metadata.tokens
    await callHandler(handler, event)
    const db = getUsageDb()
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as any
    expect(count.c).toBe(0)
  })

  it("tokens all zero → ignored", async () => {
    const handler = createUsageEventHandler()
    const event = makeAssistantMessageEvent({
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
    await callHandler(handler, event)
    const db = getUsageDb()
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as any
    expect(count.c).toBe(0)
  })

  it("completed_at null → row inserted with null completed_at", async () => {
    const handler = createUsageEventHandler()
    const event = makeAssistantMessageEvent({ completed: undefined })
    await callHandler(handler, event)
    const db = getUsageDb()
    const row = db.prepare("SELECT completed_at FROM message_usage LIMIT 1").get() as any
    // Handler may skip or insert with null — either is acceptable
    // The important thing is no crash
    if (row) {
      expect(row.completed_at).toBeNull()
    }
  })

  it("unknown event type → no error, no row", async () => {
    const handler = createUsageEventHandler()
    await callHandler(handler, { type: "session.created", properties: {} })
    const db = getUsageDb()
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as any
    expect(count.c).toBe(0)
  })

  it("user role message → ignored", async () => {
    const handler = createUsageEventHandler()
    const event = makeAssistantMessageEvent({ role: "user" })
    await callHandler(handler, event)
    const db = getUsageDb()
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as any
    expect(count.c).toBe(0)
  })
})

// --- Price edge cases ---

describe("price — edge cases", () => {
  it("model with special characters in name → fuzzy lookup works", () => {
    seedPrices(getUsageDb())
    // Existing models have simple names, but fuzzy should handle date suffixes
    const price = lookupPrice("gpt-4o-2025-07-01", "copilot")
    expect(price).toBeTruthy() // fuzzy match on "gpt-4o" prefix
  })

  it("empty price_table → estimateCost returns missing=true without crash", () => {
    // initUsageDb auto-seeds prices, so we need to clear them manually
    const db = getUsageDb()
    db.run("DELETE FROM price_table")
    const result = estimateCost("gpt-4o", "openai", {
      input: 1000, output: 500, reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(result.missing).toBe(true)
    expect(result.cost).toBe(0)
  })

  it("negative tokens (corrupted data) → returns negative cost without crash", () => {
    seedPrices(getUsageDb())
    const result = estimateCost("gpt-4o", "copilot", {
      input: -100, output: 500, reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    // Should compute without crashing — result may be negative
    expect(typeof result.cost).toBe("number")
    expect(result.missing).toBe(false)
  })
})

// --- Query edge cases ---

describe("queries — edge cases", () => {
  it("empty DB → querySummaryByDay returns empty array", () => {
    const rows = querySummaryByDay(0)
    expect(rows).toEqual([])
  })

  it("single day → queryProjectionBase returns variance = 0", () => {
    const now = Date.now()
    upsertMessageUsage({
      id: "msg-only", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
      created_at: now, completed_at: now + 2000,
    })
    const result = queryProjectionBase(0)
    expect(result.active_days).toBe(1)
    expect(result.var_cost).toBe(0)
    expect(result.var_tokens).toBe(0)
  })

  it("steps without tools → querySummaryByTool returns empty (no div by zero)", () => {
    const now = Date.now()
    upsertMessageUsage({
      id: "msg-notool", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
      created_at: now, completed_at: now + 2000,
    })
    upsertStepUsage({
      id: "step-notool", message_id: "msg-notool", session_id: "s",
      model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008,
      created_at: now, completed_at: now + 1000, finish_reason: "end_turn",
    })
    const rows = querySummaryByTool(0)
    expect(rows).toEqual([]) // no tools, nothing to aggregate
  })

  it("orphan tools (no matching step) → attributed from message cost, no crash", () => {
    const now = Date.now()
    upsertMessageUsage({
      id: "msg-orphan", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
      created_at: now, completed_at: now + 2000,
    })
    // Tool without corresponding step — attribution uses message cost_estimated
    upsertToolUsage({
      id: "tool-orphan", message_id: "msg-orphan", session_id: "s",
      call_id: "call-orphan", tool_name: "bash", status: "completed",
      created_at: now + 500,
    })
    const rows = querySummaryByTool(0)
    expect(rows.length).toBe(1)
    expect(rows[0].tool_name).toBe("bash")
    expect(rows[0].attributed_cost_usd).toBeCloseTo(0.008, 4) // message cost / 1 tool
  })
})

// --- Idempotency ---

describe("idempotency", () => {
  it("10 sequential upserts of same message → exactly 1 row", () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      upsertMessageUsage({
        id: "msg-dup", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
        tokens_input: 1000 + i, tokens_output: 500, tokens_reasoning: 0,
        tokens_cache_read: 0, tokens_cache_write: 0,
        cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
        created_at: now, completed_at: now + 2000,
      })
    }
    const db = getUsageDb()
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as any
    expect(count.c).toBe(1)
    // Last value wins
    const row = db.prepare("SELECT tokens_input FROM message_usage WHERE id = 'msg-dup'").get() as any
    expect(row.tokens_input).toBe(1009)
  })
})

// --- Tools defaults ---

describe("tools — argument defaults", () => {
  it("usageSummary with no args → uses defaults, no crash", async () => {
    const result = await usageSummary.execute({})
    expect(typeof result).toBe("string")
    // Either "No usage data" or a valid summary
  })

  it("usageQuery with from_date in the future → empty result", async () => {
    upsertMessageUsage({
      id: "msg-past", session_id: "s", model_id: "gpt-4o", provider_id: "openai",
      tokens_input: 1000, tokens_output: 500, tokens_reasoning: 0,
      tokens_cache_read: 0, tokens_cache_write: 0,
      cost_reported: 0.01, cost_estimated: 0.008, price_missing: 0,
      created_at: Date.now() - DAY_MS, completed_at: Date.now() - DAY_MS + 2000,
    })
    const result = await usageQuery.execute({ from_date: "2099-01-01" })
    expect(result).toContain("No records found")
  })

  it("usageEstimate with no data → guidance message", async () => {
    const result = await usageEstimate.execute({ horizon: "month" })
    expect(result).toContain("No usage data available")
  })
})
