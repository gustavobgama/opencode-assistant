import type { Event } from "@opencode-ai/sdk"
import { upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "./db.js"
import { estimateCost } from "./prices.js"

export function createUsageEventHandler() {
  return async ({ event }: { event: Event }) => {
    try {
      switch (event.type) {
        case "message.updated":
          handleMessageUpdated(event as any)
          break
        case "message.part.updated":
          handlePartUpdated(event as any)
          break
      }
    } catch (err) {
      // REQ-1.4: fire-and-forget — log but never throw
      console.error("[usage] capture error:", err)
    }
  }
}

function handleMessageUpdated(event: {
  type: "message.updated"
  properties: { info: any }
}) {
  const msg = event.properties.info
  if (!msg || msg.role !== "assistant") return
  if (!msg.tokens || msg.tokens.input === 0) return

  const estimated = estimateCost(msg.modelID, msg.providerID, {
    input: msg.tokens.input,
    output: msg.tokens.output,
    reasoning: msg.tokens.reasoning ?? 0,
    cache: {
      read: msg.tokens.cache?.read ?? 0,
      write: msg.tokens.cache?.write ?? 0,
    },
  })

  upsertMessageUsage({
    id: msg.id,
    session_id: msg.sessionID,
    model_id: msg.modelID,
    provider_id: msg.providerID,
    tokens_input: msg.tokens.input,
    tokens_output: msg.tokens.output,
    tokens_reasoning: msg.tokens.reasoning ?? 0,
    tokens_cache_read: msg.tokens.cache?.read ?? 0,
    tokens_cache_write: msg.tokens.cache?.write ?? 0,
    cost_reported: msg.cost ?? 0,
    cost_estimated: estimated.cost,
    price_missing: estimated.missing ? 1 : 0,
    created_at: msg.time.created,
    completed_at: msg.time.completed ?? null,
  })
}

function handlePartUpdated(event: {
  type: "message.part.updated"
  properties: { part: any }
}) {
  const part = event.properties.part

  if (part.type === "step-finish") {
    upsertStepUsage({
      id: part.id,
      session_id: part.sessionID,
      message_id: part.messageID,
      tokens_input: part.tokens?.input ?? 0,
      tokens_output: part.tokens?.output ?? 0,
      tokens_reasoning: part.tokens?.reasoning ?? 0,
      tokens_cache_read: part.tokens?.cache?.read ?? 0,
      tokens_cache_write: part.tokens?.cache?.write ?? 0,
      cost_reported: part.cost ?? 0,
      cost_estimated: 0, // calculated on read via join
      reason: part.reason ?? null,
      created_at: Date.now(),
    })
  }

  if (part.type === "tool" && isTerminalState(part.state)) {
    upsertToolUsage({
      id: part.id,
      session_id: part.sessionID,
      message_id: part.messageID,
      call_id: part.callID,
      tool_name: part.tool,
      status: part.state.status,
      created_at: Date.now(),
    })
  }
}

function isTerminalState(state: any): state is { status: "completed" | "error" } {
  return state?.status === "completed" || state?.status === "error"
}
