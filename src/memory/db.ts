import { Database } from "bun:sqlite"
import { mkdirSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"

// --- Types ---

export interface Memory {
  id: string
  type: MemoryType
  content: string
  tags: string
  created_at: string
}

export type MemoryType = "fact" | "decision" | "preference" | "observation"

export interface SearchResult extends Memory {
  rank: number
  snippet: string
}

// --- DB singleton ---

const DEFAULT_DB_PATH = join(homedir(), ".config", "opencode", "assistant-memory.db")
let _db: Database | null = null

export function getDb(): Database {
  if (_db) return _db
  return initDb(DEFAULT_DB_PATH)
}

/**
 * Initialize DB with a specific path. Use ":memory:" for tests.
 * Resets the singleton — subsequent getDb() calls return this instance.
 */
export function initDb(dbPath: string): Database {
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

/** Close and reset the singleton. Used in test teardown. */
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK(type IN ('fact','decision','preference','observation')),
      content    TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `)

  // FTS5 virtual table — may already exist, ignore error
  try {
    db.run(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content, tags, content=memories, content_rowid=rowid
      )
    `)
  } catch {
    // already exists — fine
  }

  // Sync triggers
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
    END
  `)
}

// --- CRUD ---

export function saveMemory(content: string, type: MemoryType, tags: string): Memory {
  const db = getDb()
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  db.run(
    "INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, type, content, tags, created_at],
  )
  return { id, type, content, tags, created_at }
}

export function searchMemories(query: string, type?: MemoryType, limit = 10): SearchResult[] {
  const db = getDb()

  if (type) {
    return db.prepare(`
      SELECT m.*, rank, snippet(memories_fts, 0, '**', '**', '...', 32) AS snippet
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
      AND m.type = ?
      ORDER BY rank
      LIMIT ?
    `).all(query, type, limit) as SearchResult[]
  }

  return db.prepare(`
    SELECT m.*, rank, snippet(memories_fts, 0, '**', '**', '...', 32) AS snippet
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as SearchResult[]
}

export function listMemories(type?: MemoryType, limit = 20): Memory[] {
  const db = getDb()
  if (type) {
    return db.prepare(
      "SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?",
    ).all(type, limit) as Memory[]
  }
  return db.prepare(
    "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?",
  ).all(limit) as Memory[]
}

export function getRecentMemories(limit = 10): Memory[] {
  const db = getDb()
  // Priority: preference > decision > fact > observation
  return db.prepare(`
    SELECT * FROM memories
    ORDER BY
      CASE type
        WHEN 'preference' THEN 0
        WHEN 'decision'   THEN 1
        WHEN 'fact'       THEN 2
        WHEN 'observation' THEN 3
      END,
      created_at DESC
    LIMIT ?
  `).all(limit) as Memory[]
}

export function countMemories(): number {
  const db = getDb()
  const row = db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }
  return row.count
}
