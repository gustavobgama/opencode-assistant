import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  initUsageDb,
  closeUsageDb,
  upsertMessageUsage,
  upsertStepUsage,
  upsertToolUsage,
  getMessageUsage,
  getStepsByMessage,
  getToolsByMessage,
  type MessageUsageRow,
} from "../src/usage/db.js"
import { Database } from "bun:sqlite"

let db: Database

beforeEach(() => {
  db = initUsageDb(":memory:")
})

afterEach(() => {
  closeUsageDb()
})

describe("schema creation", () => {
  it("creates all 4 tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain("message_usage")
    expect(names).toContain("step_usage")
    expect(names).toContain("tool_usage")
    expect(names).toContain("price_table")
  })

  it("creates all 8 indexes", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    expect(indexes.length).toBe(8)
  })
})

describe("upsertMessageUsage", () => {
  const baseRow: MessageUsageRow = {
    id: "msg-001",
    session_id: "sess-1",
    model_id: "gpt-4o",
    provider_id: "copilot",
    tokens_input: 1000,
    tokens_output: 500,
    tokens_reasoning: 0,
    tokens_cache_read: 200,
    tokens_cache_write: 100,
    cost_reported: 0,
    cost_estimated: 0.0075,
    price_missing: 0,
    created_at: Date.now(),
    completed_at: Date.now() + 1000,
  }

  it("inserts a new row", () => {
    upsertMessageUsage(baseRow)
    const row = getMessageUsage("msg-001")
    expect(row).not.toBeNull()
    expect(row!.tokens_input).toBe(1000)
    expect(row!.model_id).toBe("gpt-4o")
  })

  it("upsert is idempotent — same id, count stays 1", () => {
    upsertMessageUsage(baseRow)
    upsertMessageUsage(baseRow)
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as { c: number }
    expect(count.c).toBe(1)
  })

  it("upsert updates values on re-insert", () => {
    upsertMessageUsage(baseRow)
    upsertMessageUsage({ ...baseRow, tokens_input: 2000, cost_estimated: 0.015 })
    const row = getMessageUsage("msg-001")
    expect(row!.tokens_input).toBe(2000)
    expect(row!.cost_estimated).toBe(0.015)
  })

  it("handles null completed_at", () => {
    upsertMessageUsage({ ...baseRow, id: "msg-002", completed_at: null })
    const row = getMessageUsage("msg-002")
    expect(row).not.toBeNull()
    expect(row!.completed_at).toBeNull()
  })
})

describe("upsertStepUsage", () => {
  it("inserts and retrieves by message_id", () => {
    upsertStepUsage({
      id: "step-001",
      session_id: "sess-1",
      message_id: "msg-001",
      tokens_input: 500,
      tokens_output: 200,
      tokens_reasoning: 0,
      tokens_cache_read: 100,
      tokens_cache_write: 50,
      cost_reported: 0,
      cost_estimated: 0,
      reason: "tool_use",
      created_at: Date.now(),
    })
    upsertStepUsage({
      id: "step-002",
      session_id: "sess-1",
      message_id: "msg-001",
      tokens_input: 300,
      tokens_output: 100,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      cost_reported: 0,
      cost_estimated: 0,
      reason: "end_turn",
      created_at: Date.now() + 1000,
    })

    const steps = getStepsByMessage("msg-001")
    expect(steps.length).toBe(2)
    expect(steps[0].id).toBe("step-001")
    expect(steps[1].id).toBe("step-002")
  })

  it("upsert is idempotent", () => {
    const step = {
      id: "step-dup",
      session_id: "sess-1",
      message_id: "msg-001",
      tokens_input: 100,
      tokens_output: 50,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      cost_reported: 0,
      cost_estimated: 0,
      reason: "end_turn",
      created_at: Date.now(),
    }
    upsertStepUsage(step)
    upsertStepUsage(step)
    const count = db.prepare("SELECT COUNT(*) as c FROM step_usage").get() as { c: number }
    expect(count.c).toBe(1)
  })
})

describe("upsertToolUsage", () => {
  it("inserts and retrieves by message_id", () => {
    upsertToolUsage({
      id: "tool-001",
      session_id: "sess-1",
      message_id: "msg-001",
      call_id: "call-abc",
      tool_name: "bash",
      status: "completed",
      created_at: Date.now(),
    })
    upsertToolUsage({
      id: "tool-002",
      session_id: "sess-1",
      message_id: "msg-001",
      call_id: "call-def",
      tool_name: "read",
      status: "error",
      created_at: Date.now() + 500,
    })

    const tools = getToolsByMessage("msg-001")
    expect(tools.length).toBe(2)
    expect(tools[0].tool_name).toBe("bash")
    expect(tools[1].status).toBe("error")
  })

  it("rejects invalid status via CHECK constraint", () => {
    expect(() => {
      db.run(
        "INSERT INTO tool_usage (id, session_id, message_id, call_id, tool_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["t-bad", "s", "m", "c", "bash", "invalid_status", Date.now()],
      )
    }).toThrow()
  })
})

describe("isolation", () => {
  it("empty DB returns null/empty for queries", () => {
    expect(getMessageUsage("nonexistent")).toBeNull()
    expect(getStepsByMessage("nonexistent")).toEqual([])
    expect(getToolsByMessage("nonexistent")).toEqual([])
  })
})
