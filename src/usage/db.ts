import { Database } from "bun:sqlite"
import { mkdirSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import { seedPrices } from "./prices.js"

// --- Types ---

export interface MessageUsageRow {
  id: string
  session_id: string
  model_id: string
  provider_id: string
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  cost_reported: number
  cost_estimated: number
  price_missing: number
  created_at: number
  completed_at: number | null
}

export interface StepUsageRow {
  id: string
  session_id: string
  message_id: string
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  cost_reported: number
  cost_estimated: number
  reason: string | null
  created_at: number
}

export interface ToolUsageRow {
  id: string
  session_id: string
  message_id: string
  call_id: string
  tool_name: string
  status: "completed" | "error"
  created_at: number
}

export interface PriceRow {
  model_id: string
  provider_id: string
  input_price_per_mtok: number
  output_price_per_mtok: number
  cache_read_price_per_mtok: number
  cache_write_price_per_mtok: number
  currency: string
  updated_at: string
}

// --- DB singleton ---

const DEFAULT_DB_PATH = join(homedir(), ".config", "opencode", "assistant-usage.db")
let _db: Database | null = null

export function getUsageDb(): Database {
  if (_db) return _db
  return initUsageDb(DEFAULT_DB_PATH)
}

export function initUsageDb(dbPath: string): Database {
  if (_db) _db.close()
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  _db = new Database(dbPath)
  _db.run("PRAGMA journal_mode=WAL")
  _db.run("PRAGMA foreign_keys=ON")
  migrate(_db)
  return _db
}

export function closeUsageDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// --- Schema & Migration ---

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS message_usage (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      model_id        TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      tokens_input    INTEGER NOT NULL DEFAULT 0,
      tokens_output   INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read  INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      cost_reported   REAL NOT NULL DEFAULT 0.0,
      cost_estimated  REAL NOT NULL DEFAULT 0.0,
      price_missing   INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      completed_at    INTEGER
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS step_usage (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      message_id      TEXT NOT NULL,
      tokens_input    INTEGER NOT NULL DEFAULT 0,
      tokens_output   INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read  INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      cost_reported   REAL NOT NULL DEFAULT 0.0,
      cost_estimated  REAL NOT NULL DEFAULT 0.0,
      reason          TEXT,
      created_at      INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_usage (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      message_id      TEXT NOT NULL,
      call_id         TEXT NOT NULL,
      tool_name       TEXT NOT NULL,
      status          TEXT NOT NULL CHECK(status IN ('completed','error')),
      created_at      INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_table (
      model_id                TEXT NOT NULL,
      provider_id             TEXT NOT NULL,
      input_price_per_mtok    REAL NOT NULL,
      output_price_per_mtok   REAL NOT NULL,
      cache_read_price_per_mtok  REAL NOT NULL DEFAULT 0.0,
      cache_write_price_per_mtok REAL NOT NULL DEFAULT 0.0,
      currency                TEXT NOT NULL DEFAULT 'USD',
      updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      PRIMARY KEY (model_id, provider_id)
    )
  `)

  // Indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_message_usage_session ON message_usage(session_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_message_usage_created ON message_usage(created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_message_usage_model   ON message_usage(model_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_step_usage_message    ON step_usage(message_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_step_usage_created    ON step_usage(created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_usage_message    ON tool_usage(message_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_usage_tool       ON tool_usage(tool_name)")
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_usage_created    ON tool_usage(created_at)")

  // Seed price table with reference data
  seedPrices(db)
}

// --- CRUD ---

export function upsertMessageUsage(data: Omit<MessageUsageRow, never>): void {
  const db = getUsageDb()
  db.run(
    `INSERT OR REPLACE INTO message_usage
      (id, session_id, model_id, provider_id, tokens_input, tokens_output, tokens_reasoning,
       tokens_cache_read, tokens_cache_write, cost_reported, cost_estimated, price_missing,
       created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id, data.session_id, data.model_id, data.provider_id,
      data.tokens_input, data.tokens_output, data.tokens_reasoning,
      data.tokens_cache_read, data.tokens_cache_write,
      data.cost_reported, data.cost_estimated, data.price_missing,
      data.created_at, data.completed_at,
    ],
  )
}

export function upsertStepUsage(data: Omit<StepUsageRow, never>): void {
  const db = getUsageDb()
  db.run(
    `INSERT OR REPLACE INTO step_usage
      (id, session_id, message_id, tokens_input, tokens_output, tokens_reasoning,
       tokens_cache_read, tokens_cache_write, cost_reported, cost_estimated, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id, data.session_id, data.message_id,
      data.tokens_input, data.tokens_output, data.tokens_reasoning,
      data.tokens_cache_read, data.tokens_cache_write,
      data.cost_reported, data.cost_estimated, data.reason, data.created_at,
    ],
  )
}

export function upsertToolUsage(data: Omit<ToolUsageRow, never>): void {
  const db = getUsageDb()
  db.run(
    `INSERT OR REPLACE INTO tool_usage
      (id, session_id, message_id, call_id, tool_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.id, data.session_id, data.message_id, data.call_id, data.tool_name, data.status, data.created_at],
  )
}

export function getMessageUsage(id: string): MessageUsageRow | null {
  const db = getUsageDb()
  return db.prepare("SELECT * FROM message_usage WHERE id = ?").get(id) as MessageUsageRow | null
}

export function getStepsByMessage(messageId: string): StepUsageRow[] {
  const db = getUsageDb()
  return db.prepare("SELECT * FROM step_usage WHERE message_id = ? ORDER BY created_at").all(messageId) as StepUsageRow[]
}

export function getToolsByMessage(messageId: string): ToolUsageRow[] {
  const db = getUsageDb()
  return db.prepare("SELECT * FROM tool_usage WHERE message_id = ? ORDER BY created_at").all(messageId) as ToolUsageRow[]
}
