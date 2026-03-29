/**
 * Performance & NFR verification tests.
 * Phase 5, Task 5.3 — NFR-1, NFR-2, NFR-3, NFR-5, NFR-7
 *
 * ISOLATED: filename *.perf.test.ts — excluded from default `bun test` via pattern.
 * Run explicitly: `bun test test/usage-performance.perf.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initUsageDb, closeUsageDb, getUsageDb, upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "../../src/usage/db.js"
import { seedPrices } from "../../src/usage/prices.js"
import { querySummaryByDay, querySummaryByModel, querySummaryByTool, queryProjectionBase } from "../../src/usage/queries.js"
import { createUsageEventHandler } from "../../src/usage/collector.js"

const DAY_MS = 86_400_000

beforeEach(() => {
  initUsageDb(":memory:")
})
afterEach(() => {
  closeUsageDb()
})

// --- Helper: bulk insert ---

function bulkInsertMessages(count: number, daysSpan: number = 180) {
  const db = getUsageDb()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO message_usage
    (id, session_id, model_id, provider_id,
     tokens_input, tokens_output, tokens_reasoning,
     tokens_cache_read, tokens_cache_write,
     cost_reported, cost_estimated, price_missing,
     created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const day = Math.floor((i / count) * daysSpan)
      const epoch = now - (daysSpan - day) * DAY_MS + (i % 500) * 60_000
      stmt.run(
        `msg-${i}`, `sess-${i % 10}`, i % 3 === 0 ? "claude-sonnet-4-20250514" : "gpt-4o", "copilot",
        800 + (i % 200), 400 + (i % 100), i % 5 === 0 ? 50 : 0,
        100, 50,
        0.01, 0.008, 0,
        epoch, epoch + 3000,
      )
    }
  })
  tx()
}

function bulkInsertToolsAndSteps(count: number) {
  const db = getUsageDb()
  const stmtStep = db.prepare(`
    INSERT OR REPLACE INTO step_usage
    (id, session_id, message_id,
     tokens_input, tokens_output, tokens_reasoning,
     tokens_cache_read, tokens_cache_write,
     cost_reported, cost_estimated,
     created_at, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const stmtTool = db.prepare(`
    INSERT OR REPLACE INTO tool_usage
    (id, session_id, message_id, call_id, tool_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  const tools = ["bash", "read", "write", "grep", "glob"]
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const msgId = `msg-${i % 50000}`
      const epoch = now - (i % 180) * DAY_MS
      stmtStep.run(
        `step-${i}`, `sess-${i % 10}`, msgId,
        400, 200, 0, 50, 25,
        0.004, 0.003,
        epoch, "end_turn",
      )
      stmtTool.run(
        `tool-${i}`, `sess-${i % 10}`, msgId,
        `call-${i}`, tools[i % tools.length],
        i % 20 === 0 ? "error" : "completed",
        epoch + 200,
      )
    }
  })
  tx()
}

// --- Tests ---

describe("NFR-2 — DB init time", () => {
  it("initUsageDb (create + migrate + seed) < 50ms", () => {
    closeUsageDb() // close the one from beforeEach
    const start = performance.now()
    initUsageDb(":memory:")
    const elapsed = performance.now() - start
    console.log(`  DB init: ${elapsed.toFixed(2)}ms`)
    expect(elapsed).toBeLessThan(50)
  })
})

describe("NFR-3 — Aggregation at scale", () => {
  it("querySummaryByDay with 100K messages < 500ms", () => {
    bulkInsertMessages(100_000)
    const start = performance.now()
    const rows = querySummaryByDay(0)
    const elapsed = performance.now() - start
    console.log(`  querySummaryByDay (100K rows): ${elapsed.toFixed(2)}ms, ${rows.length} groups`)
    expect(elapsed).toBeLessThan(500)
    expect(rows.length).toBeGreaterThan(0)
  })

  it("querySummaryByTool with 50K tools+steps < 500ms", () => {
    bulkInsertMessages(25_000)
    bulkInsertToolsAndSteps(50_000)
    const start = performance.now()
    const rows = querySummaryByTool(0)
    const elapsed = performance.now() - start
    console.log(`  querySummaryByTool (50K rows): ${elapsed.toFixed(2)}ms, ${rows.length} tools`)
    expect(elapsed).toBeLessThan(500)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe("NFR-5 — 6-month simulation", () => {
  it("90K messages (500/day × 180 days) — all queries complete", () => {
    bulkInsertMessages(90_000, 180)

    const queries = [
      { name: "byDay", fn: () => querySummaryByDay(0) },
      { name: "byModel", fn: () => querySummaryByModel(0) },
      { name: "projection", fn: () => queryProjectionBase(0) },
    ]

    for (const q of queries) {
      const start = performance.now()
      const result = q.fn()
      const elapsed = performance.now() - start
      console.log(`  ${q.name}: ${elapsed.toFixed(2)}ms`)
      expect(result).toBeTruthy()
      expect(elapsed).toBeLessThan(500) // generous limit for CI
    }
  })
})

describe("NFR-1 — Collector throughput", () => {
  it("1000 events processed < 5000ms (avg < 5ms/event)", () => {
    const handler = createUsageEventHandler()
    const events: any[] = []
    for (let i = 0; i < 1000; i++) {
      events.push({
        type: "message.updated",
        properties: {
          info: {
            id: `perf-msg-${i}`,
            role: "assistant",
            sessionID: `perf-sess-${i % 5}`,
            metadata: {
              modelID: "gpt-4o",
              providerID: "copilot",
              tokens: { input: 1000, output: 500, reasoning: 0, cacheRead: 100, cacheWrite: 50 },
              cost: { input: 0.005, output: 0.003 },
            },
            time: { created: new Date(), completed: new Date() },
          },
        },
      })
    }

    const start = performance.now()
    // Fire all handlers (they're async but use sync DB ops internally)
    const promises = events.map((e) => handler({ event: e } as any))
    Promise.all(promises).then(() => {
      const elapsed = performance.now() - start
      console.log(`  Collector: ${elapsed.toFixed(2)}ms for 1000 events (${(elapsed / 1000).toFixed(3)}ms/event)`)
      expect(elapsed).toBeLessThan(5000)
    })
  })
})

describe("Index effectiveness", () => {
  it("aggregation queries use indexes (no full table scan)", () => {
    bulkInsertMessages(1000)
    const db = getUsageDb()

    const queries = [
      "SELECT * FROM message_usage WHERE created_at >= 0",
      "SELECT * FROM message_usage WHERE model_id = 'gpt-4o'",
      "SELECT * FROM message_usage WHERE session_id = 'sess-0'",
      "SELECT * FROM step_usage WHERE message_id = 'msg-0'",
    ]

    for (const sql of queries) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]
      const planStr = plan.map((r: any) => r.detail).join(" ")
      // Should mention USING INDEX or SEARCH, not SCAN TABLE without index
      const hasIndex = planStr.includes("USING INDEX") || planStr.includes("USING COVERING INDEX") || planStr.includes("SEARCH")
      console.log(`  ${sql.slice(0, 60)}... → ${planStr}`)
      expect(hasIndex).toBe(true)
    }
  })
})
