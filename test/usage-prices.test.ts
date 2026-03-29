import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initUsageDb, closeUsageDb } from "../src/usage/db.js"
import { seedPrices, lookupPrice, estimateCost, DEFAULT_PRICES } from "../src/usage/prices.js"
import { Database } from "bun:sqlite"

let db: Database

beforeEach(() => {
  db = initUsageDb(":memory:")
})

afterEach(() => {
  closeUsageDb()
})

describe("seedPrices", () => {
  it("populates price_table with default models", () => {
    const count = db.prepare("SELECT COUNT(*) as c FROM price_table").get() as { c: number }
    expect(count.c).toBe(DEFAULT_PRICES.length)
  })

  it("is idempotent — running twice doesn't duplicate", () => {
    seedPrices(db) // migrate already called it once
    const count = db.prepare("SELECT COUNT(*) as c FROM price_table").get() as { c: number }
    expect(count.c).toBe(DEFAULT_PRICES.length)
  })
})

describe("lookupPrice", () => {
  it("exact match — model + provider", () => {
    // Insert a provider-specific price
    db.run(
      "INSERT INTO price_table (model_id, provider_id, input_price_per_mtok, output_price_per_mtok) VALUES (?, ?, ?, ?)",
      ["gpt-4o", "openai", 2.50, 10.00],
    )
    const price = lookupPrice("gpt-4o", "openai")
    expect(price).not.toBeNull()
    expect(price!.provider_id).toBe("openai")
  })

  it("wildcard fallback — provider='*'", () => {
    const price = lookupPrice("gpt-4o", "copilot")
    expect(price).not.toBeNull()
    expect(price!.provider_id).toBe("*")
    expect(price!.input_price_per_mtok).toBe(2.50)
  })

  it("fuzzy prefix match — model with date suffix", () => {
    const price = lookupPrice("claude-sonnet-4-20250514-extended", "*")
    expect(price).not.toBeNull()
    expect(price!.model_id).toBe("claude-sonnet-4-20250514")
  })

  it("returns null for unknown model", () => {
    const price = lookupPrice("totally-unknown-model", "copilot")
    expect(price).toBeNull()
  })

  it("prefers exact match over wildcard", () => {
    db.run(
      "INSERT INTO price_table (model_id, provider_id, input_price_per_mtok, output_price_per_mtok) VALUES (?, ?, ?, ?)",
      ["gpt-4o", "copilot", 0.00, 0.00],
    )
    const price = lookupPrice("gpt-4o", "copilot")
    expect(price!.provider_id).toBe("copilot")
    expect(price!.input_price_per_mtok).toBe(0.00)
  })
})

describe("estimateCost", () => {
  it("calculates cost correctly for known model", () => {
    // gpt-4o: input=2.50, output=10.00 per Mtok
    const result = estimateCost("gpt-4o", "copilot", {
      input: 1_000_000,
      output: 1_000_000,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(result.missing).toBe(false)
    expect(result.cost).toBeCloseTo(12.50, 4) // 2.50 + 10.00
  })

  it("includes cache costs in calculation", () => {
    // gpt-4o: cache_read=1.25, cache_write=2.50 per Mtok
    const result = estimateCost("gpt-4o", "copilot", {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 1_000_000, write: 1_000_000 },
    })
    expect(result.cost).toBeCloseTo(3.75, 4) // 1.25 + 2.50
  })

  it("returns missing=true for unknown model", () => {
    const result = estimateCost("nonexistent", "whatever", {
      input: 1000,
      output: 500,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(result.missing).toBe(true)
    expect(result.cost).toBe(0)
  })

  it("calculates proportional cost for small token counts", () => {
    // gpt-4o: 1000 input + 500 output
    const result = estimateCost("gpt-4o", "copilot", {
      input: 1000,
      output: 500,
      reasoning: 0,
      cache: { read: 200, write: 100 },
    })
    // (1000*2.5 + 500*10 + 200*1.25 + 100*2.5) / 1M
    const expected = (2500 + 5000 + 250 + 250) / 1_000_000
    expect(result.cost).toBeCloseTo(expected, 8)
    expect(result.missing).toBe(false)
  })
})
