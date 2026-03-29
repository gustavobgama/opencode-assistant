/**
 * Shared test fixtures for usage tracking tests.
 * Factories produce valid default objects with optional overrides.
 */

import { initUsageDb, closeUsageDb, upsertMessageUsage, upsertStepUsage, upsertToolUsage } from "../../src/usage/db.js"

const DAY_MS = 86_400_000

// --- Token factory ---

export function makeTokens(overrides?: Partial<{
  input: number; output: number; reasoning: number;
  cacheRead: number; cacheWrite: number;
}>) {
  return {
    input: overrides?.input ?? 1000,
    output: overrides?.output ?? 500,
    reasoning: overrides?.reasoning ?? 0,
    cacheRead: overrides?.cacheRead ?? 100,
    cacheWrite: overrides?.cacheWrite ?? 50,
  }
}

// --- Event factories ---

export function makeAssistantMessageEvent(overrides?: Record<string, any>) {
  const id = overrides?.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`
  const sessionID = overrides?.sessionID ?? "sess-test"
  const tokens = overrides?.tokens ?? makeTokens()
  return {
    type: "message.updated" as const,
    properties: {
      id,
      role: overrides?.role ?? "assistant",
      sessionID,
      metadata: {
        modelID: overrides?.modelID ?? "gpt-4o",
        providerID: overrides?.providerID ?? "copilot",
        tokens: {
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning,
          cacheRead: tokens.cacheRead,
          cacheWrite: tokens.cacheWrite,
        },
        cost: overrides?.cost ?? { input: 0.005, output: 0.003 },
      },
      time: {
        created: overrides?.created ?? new Date(),
        completed: overrides?.completed !== undefined ? overrides.completed : new Date(),
      },
    },
  }
}

export function makeStepFinishEvent(overrides?: Record<string, any>) {
  return {
    type: "message.part.updated" as const,
    properties: {
      part: {
        type: "step-finish" as const,
        id: overrides?.id ?? `step-${Math.random().toString(36).slice(2, 8)}`,
        messageID: overrides?.messageID ?? "msg-test",
        sessionID: overrides?.sessionID ?? "sess-test",
        metadata: {
          modelID: overrides?.modelID ?? "gpt-4o",
          providerID: overrides?.providerID ?? "copilot",
          tokens: {
            input: overrides?.tokensInput ?? 600,
            output: overrides?.tokensOutput ?? 300,
            reasoning: overrides?.tokensReasoning ?? 0,
            cacheRead: overrides?.cacheRead ?? 100,
            cacheWrite: overrides?.cacheWrite ?? 50,
          },
          cost: overrides?.cost ?? { input: 0.003, output: 0.002 },
        },
        time: {
          created: overrides?.created ?? new Date(),
          completed: overrides?.completed ?? new Date(),
        },
        finishReason: overrides?.finishReason ?? "end_turn",
      },
    },
  }
}

export function makeToolPartEvent(overrides?: Record<string, any>) {
  return {
    type: "message.part.updated" as const,
    properties: {
      part: {
        type: "tool" as const,
        id: overrides?.id ?? `tool-${Math.random().toString(36).slice(2, 8)}`,
        toolCallId: overrides?.toolCallId ?? `call-${Math.random().toString(36).slice(2, 8)}`,
        toolName: overrides?.toolName ?? "bash",
        messageID: overrides?.messageID ?? "msg-test",
        sessionID: overrides?.sessionID ?? "sess-test",
        state: overrides?.state ?? "completed",
        time: {
          created: overrides?.created ?? new Date(),
        },
      },
    },
  }
}

// --- DB seeder ---

export interface SeedOpts {
  days?: number
  messagesPerDay?: number
  stepsPerMessage?: number
  toolsPerStep?: number
  model?: string
  provider?: string
  session?: string
}

export function seedUsageDb(opts?: SeedOpts) {
  const days = opts?.days ?? 7
  const messagesPerDay = opts?.messagesPerDay ?? 3
  const stepsPerMessage = opts?.stepsPerMessage ?? 2
  const toolsPerStep = opts?.toolsPerStep ?? 1
  const model = opts?.model ?? "gpt-4o"
  const provider = opts?.provider ?? "openai"
  const session = opts?.session ?? "sess-seed"

  const now = Date.now()
  let toolCounter = 0

  for (let d = 0; d < days; d++) {
    const dayBase = now - (days - 1 - d) * DAY_MS
    for (let m = 0; m < messagesPerDay; m++) {
      const msgId = `msg-${d}-${m}`
      const msgTime = dayBase + m * 60_000
      upsertMessageUsage({
        id: msgId, session_id: session, model_id: model, provider_id: provider,
        tokens_input: 800 + d * 50, tokens_output: 400 + d * 25, tokens_reasoning: 0,
        tokens_cache_read: 100, tokens_cache_write: 50,
        cost_reported: 0.008 + d * 0.001, cost_estimated: 0.006 + d * 0.0008,
        price_missing: 0,
        created_at: msgTime, completed_at: msgTime + 3000,
      })

      for (let s = 0; s < stepsPerMessage; s++) {
        const stepId = `step-${d}-${m}-${s}`
        upsertStepUsage({
          id: stepId, message_id: msgId, session_id: session,
          model_id: model, provider_id: provider,
          tokens_input: 400 + d * 25, tokens_output: 200 + d * 12, tokens_reasoning: 0,
          tokens_cache_read: 50, tokens_cache_write: 25,
          cost_reported: 0.004 + d * 0.0005, cost_estimated: 0.003 + d * 0.0004,
          created_at: msgTime + s * 1000, completed_at: msgTime + s * 1000 + 500,
          finish_reason: s === stepsPerMessage - 1 ? "end_turn" : "tool_use",
        })

        for (let t = 0; t < toolsPerStep; t++) {
          const toolNames = ["bash", "read", "write", "grep", "glob"]
          const toolName = toolNames[toolCounter % toolNames.length]
          toolCounter++
          upsertToolUsage({
            id: `tool-${d}-${m}-${s}-${t}`, message_id: msgId, session_id: session,
            call_id: `call-${d}-${m}-${s}-${t}`,
            tool_name: toolName,
            status: Math.random() > 0.1 ? "completed" : "error",
            created_at: msgTime + s * 1000 + t * 200,
          })
        }
      }
    }
  }
}

// --- Lifecycle helpers ---

export function setupMemoryDb() {
  initUsageDb(":memory:")
}

export function teardownDb() {
  closeUsageDb()
}
