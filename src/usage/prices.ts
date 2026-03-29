import type { Database } from "bun:sqlite"
import { getUsageDb, type PriceRow } from "./db.js"

// --- Seed Data (reference prices, Jul 2025) ---

export interface PriceEntry {
  model_id: string
  provider_id: string
  input: number
  output: number
  cache_read: number
  cache_write: number
}

export const DEFAULT_PRICES: PriceEntry[] = [
  // OpenAI
  { model_id: "gpt-4o",           provider_id: "*", input: 2.50,  output: 10.00, cache_read: 1.25,   cache_write: 2.50 },
  { model_id: "gpt-4o-mini",      provider_id: "*", input: 0.15,  output: 0.60,  cache_read: 0.075,  cache_write: 0.15 },
  { model_id: "gpt-4.1",          provider_id: "*", input: 2.00,  output: 8.00,  cache_read: 0.50,   cache_write: 2.00 },
  { model_id: "gpt-4.1-mini",     provider_id: "*", input: 0.40,  output: 1.60,  cache_read: 0.10,   cache_write: 0.40 },
  { model_id: "gpt-4.1-nano",     provider_id: "*", input: 0.10,  output: 0.40,  cache_read: 0.025,  cache_write: 0.10 },
  { model_id: "o3",               provider_id: "*", input: 2.00,  output: 8.00,  cache_read: 0.50,   cache_write: 2.00 },
  { model_id: "o3-mini",          provider_id: "*", input: 1.10,  output: 4.40,  cache_read: 0.275,  cache_write: 1.10 },
  { model_id: "o4-mini",          provider_id: "*", input: 1.10,  output: 4.40,  cache_read: 0.275,  cache_write: 1.10 },
  // Anthropic
  { model_id: "claude-sonnet-4-20250514", provider_id: "*", input: 3.00,  output: 15.00, cache_read: 0.30,  cache_write: 3.75 },
  { model_id: "claude-opus-4-20250514",   provider_id: "*", input: 15.00, output: 75.00, cache_read: 1.50,  cache_write: 18.75 },
  { model_id: "claude-3.5-sonnet",        provider_id: "*", input: 3.00,  output: 15.00, cache_read: 0.30,  cache_write: 3.75 },
  { model_id: "claude-3.5-haiku",         provider_id: "*", input: 0.80,  output: 4.00,  cache_read: 0.08,  cache_write: 1.00 },
  // Google
  { model_id: "gemini-2.5-pro",   provider_id: "*", input: 1.25, output: 10.00, cache_read: 0.315,  cache_write: 1.25 },
  { model_id: "gemini-2.5-flash", provider_id: "*", input: 0.15, output: 0.60,  cache_read: 0.0375, cache_write: 0.15 },
]

// --- Seed ---

export function seedPrices(db: Database): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO price_table
      (model_id, provider_id, input_price_per_mtok, output_price_per_mtok,
       cache_read_price_per_mtok, cache_write_price_per_mtok)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const p of DEFAULT_PRICES) {
      stmt.run(p.model_id, p.provider_id, p.input, p.output, p.cache_read, p.cache_write)
    }
  })
  tx()
}

// --- Lookup (3-level fallback: exact → wildcard → fuzzy prefix) ---

export function lookupPrice(modelId: string, providerId: string): PriceRow | null {
  const db = getUsageDb()

  // Level 1: exact match
  let row = db.prepare(
    "SELECT * FROM price_table WHERE model_id = ? AND provider_id = ?",
  ).get(modelId, providerId) as PriceRow | null
  if (row) return row

  // Level 2: wildcard provider
  row = db.prepare(
    "SELECT * FROM price_table WHERE model_id = ? AND provider_id = '*'",
  ).get(modelId) as PriceRow | null
  if (row) return row

  // Level 3: fuzzy prefix (longest match wins)
  row = db.prepare(
    "SELECT * FROM price_table WHERE ? LIKE model_id || '%' AND provider_id = '*' ORDER BY length(model_id) DESC LIMIT 1",
  ).get(modelId) as PriceRow | null
  return row
}

// --- Cost Estimation ---

export interface CostEstimate {
  cost: number
  missing: boolean
}

export interface TokenCounts {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export function estimateCost(
  modelId: string,
  providerId: string,
  tokens: TokenCounts,
): CostEstimate {
  const price = lookupPrice(modelId, providerId)
  if (!price) return { cost: 0, missing: true }

  const cost =
    (tokens.input * price.input_price_per_mtok +
      tokens.output * price.output_price_per_mtok +
      tokens.cache.read * price.cache_read_price_per_mtok +
      tokens.cache.write * price.cache_write_price_per_mtok) / 1_000_000

  return { cost, missing: false }
}
