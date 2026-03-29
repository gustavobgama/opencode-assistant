import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initUsageDb, closeUsageDb, getMessageUsage, getStepsByMessage, getToolsByMessage } from "../src/usage/db.js"
import { createUsageEventHandler } from "../src/usage/collector.js"
import { Database } from "bun:sqlite"

let db: Database
let handler: ReturnType<typeof createUsageEventHandler>

beforeEach(() => {
  db = initUsageDb(":memory:")
  handler = createUsageEventHandler()
})

afterEach(() => {
  closeUsageDb()
})

function makeAssistantMessageEvent(overrides: Record<string, any> = {}) {
  return {
    type: "message.updated" as const,
    properties: {
      info: {
        id: "msg-001",
        sessionID: "sess-1",
        role: "assistant",
        modelID: "gpt-4o",
        providerID: "copilot",
        cost: 0,
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 0,
          cache: { read: 200, write: 100 },
        },
        time: { created: Date.now(), completed: Date.now() + 1000 },
        ...overrides,
      },
    },
  }
}

function makeStepFinishEvent(overrides: Record<string, any> = {}) {
  return {
    type: "message.part.updated" as const,
    properties: {
      part: {
        id: "step-001",
        sessionID: "sess-1",
        messageID: "msg-001",
        type: "step-finish",
        cost: 0,
        tokens: {
          input: 500,
          output: 200,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        reason: "tool_use",
        ...overrides,
      },
    },
  }
}

function makeToolPartEvent(overrides: Record<string, any> = {}) {
  return {
    type: "message.part.updated" as const,
    properties: {
      part: {
        id: "tool-001",
        sessionID: "sess-1",
        messageID: "msg-001",
        type: "tool",
        callID: "call-abc",
        tool: "bash",
        state: { status: "completed", input: {}, output: "ok" },
        ...overrides,
      },
    },
  }
}

describe("message.updated handling", () => {
  it("captures assistant message with valid tokens", async () => {
    await handler({ event: makeAssistantMessageEvent() as any })
    const row = getMessageUsage("msg-001")
    expect(row).not.toBeNull()
    expect(row!.tokens_input).toBe(1000)
    expect(row!.tokens_output).toBe(500)
    expect(row!.model_id).toBe("gpt-4o")
    expect(row!.cost_estimated).toBeGreaterThan(0) // price lookup worked
    expect(row!.price_missing).toBe(0)
  })

  it("ignores user messages", async () => {
    await handler({
      event: makeAssistantMessageEvent({ role: "user" }) as any,
    })
    expect(getMessageUsage("msg-001")).toBeNull()
  })

  it("ignores messages with zero input tokens", async () => {
    await handler({
      event: makeAssistantMessageEvent({
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }) as any,
    })
    expect(getMessageUsage("msg-001")).toBeNull()
  })

  it("upsert — second event updates the row", async () => {
    await handler({ event: makeAssistantMessageEvent() as any })
    await handler({
      event: makeAssistantMessageEvent({
        tokens: { input: 2000, output: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
      }) as any,
    })
    const row = getMessageUsage("msg-001")
    expect(row!.tokens_input).toBe(2000)
  })
})

describe("step-finish handling", () => {
  it("captures step-finish part", async () => {
    await handler({ event: makeStepFinishEvent() as any })
    const steps = getStepsByMessage("msg-001")
    expect(steps.length).toBe(1)
    expect(steps[0].tokens_input).toBe(500)
    expect(steps[0].reason).toBe("tool_use")
  })
})

describe("tool part handling", () => {
  it("captures completed tool part", async () => {
    await handler({ event: makeToolPartEvent() as any })
    const tools = getToolsByMessage("msg-001")
    expect(tools.length).toBe(1)
    expect(tools[0].tool_name).toBe("bash")
    expect(tools[0].status).toBe("completed")
  })

  it("captures error tool part", async () => {
    await handler({
      event: makeToolPartEvent({
        id: "tool-err",
        state: { status: "error", input: {}, error: "timeout" },
      }) as any,
    })
    const tools = getToolsByMessage("msg-001")
    expect(tools.length).toBe(1)
    expect(tools[0].status).toBe("error")
  })

  it("ignores running tool part", async () => {
    await handler({
      event: makeToolPartEvent({
        state: { status: "running" },
      }) as any,
    })
    expect(getToolsByMessage("msg-001")).toEqual([])
  })
})

describe("fire-and-forget", () => {
  it("does not throw on DB errors", async () => {
    closeUsageDb() // force DB closed
    // should not throw — just log error
    await expect(
      handler({ event: makeAssistantMessageEvent() as any }),
    ).resolves.toBeUndefined()
  })
})

describe("idempotency", () => {
  it("same event twice produces exactly 1 row", async () => {
    const event = makeAssistantMessageEvent()
    await handler({ event: event as any })
    await handler({ event: event as any })
    const count = db.prepare("SELECT COUNT(*) as c FROM message_usage").get() as { c: number }
    expect(count.c).toBe(1)
  })
})

describe("unknown events", () => {
  it("ignores unrelated event types", async () => {
    await handler({
      event: { type: "session.created", properties: { sessionID: "s" } } as any,
    })
    // no crash, no rows
    expect(getMessageUsage("msg-001")).toBeNull()
  })
})
