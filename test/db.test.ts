import { describe, expect, it, beforeEach, afterAll } from "bun:test"
import {
  initDb,
  closeDb,
  saveMemory,
  searchMemories,
  listMemories,
  getRecentMemories,
  countMemories,
} from "../src/memory/db"

beforeEach(() => {
  // Fresh in-memory DB for each test — complete isolation
  initDb(":memory:")
})

afterAll(() => {
  closeDb()
})

describe("saveMemory", () => {
  it("salva e retorna memória com id UUID", () => {
    const m = saveMemory("TypeScript é minha linguagem favorita", "preference", "lang")
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(m.type).toBe("preference")
    expect(m.content).toBe("TypeScript é minha linguagem favorita")
    expect(m.tags).toBe("lang")
    expect(m.created_at).toBeTruthy()
  })

  it("incrementa contagem", () => {
    expect(countMemories()).toBe(0)
    saveMemory("fact 1", "fact", "")
    expect(countMemories()).toBe(1)
    saveMemory("fact 2", "fact", "")
    expect(countMemories()).toBe(2)
  })

  it("rejeita type inválido via CHECK constraint", () => {
    expect(() => {
      // @ts-expect-error — testing invalid type at runtime
      saveMemory("test", "invalid_type", "")
    }).toThrow()
  })
})

describe("listMemories", () => {
  it("retorna vazio quando não há memórias", () => {
    expect(listMemories()).toEqual([])
  })

  it("retorna memórias em ordem decrescente de criação", () => {
    // Insert with explicit timestamps to guarantee ordering
    const db = initDb(":memory:")
    db.run("INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
      ["id-1", "fact", "first", "", "2025-01-01T00:00:00Z"])
    db.run("INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
      ["id-2", "fact", "second", "", "2025-01-02T00:00:00Z"])
    db.run("INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
      ["id-3", "fact", "third", "", "2025-01-03T00:00:00Z"])
    const list = listMemories()
    expect(list).toHaveLength(3)
    expect(list[0].content).toBe("third")
    expect(list[2].content).toBe("first")
  })

  it("filtra por type", () => {
    saveMemory("fato", "fact", "")
    saveMemory("decisão", "decision", "")
    saveMemory("preferência", "preference", "")
    const facts = listMemories("fact")
    expect(facts).toHaveLength(1)
    expect(facts[0].content).toBe("fato")
  })

  it("respeita limit", () => {
    for (let i = 0; i < 10; i++) saveMemory(`item ${i}`, "fact", "")
    expect(listMemories(undefined, 3)).toHaveLength(3)
  })
})

describe("searchMemories (FTS5)", () => {
  it("encontra por conteúdo", () => {
    saveMemory("TypeScript é minha linguagem favorita", "preference", "lang")
    saveMemory("Prefiro café sem açúcar", "preference", "food")
    const results = searchMemories("TypeScript")
    expect(results).toHaveLength(1)
    expect(results[0].content).toContain("TypeScript")
    expect(results[0].rank).toBeDefined()
    expect(results[0].snippet).toBeDefined()
  })

  it("encontra por tag", () => {
    saveMemory("Gosto de café", "preference", "food,drink")
    const results = searchMemories("drink")
    expect(results).toHaveLength(1)
  })

  it("retorna vazio quando não há match", () => {
    saveMemory("algo completamente diferente", "fact", "")
    const results = searchMemories("xyznonexistent")
    expect(results).toHaveLength(0)
  })

  it("filtra por type no search", () => {
    saveMemory("TypeScript rocks", "fact", "")
    saveMemory("TypeScript é preferência", "preference", "")
    const facts = searchMemories("TypeScript", "fact")
    expect(facts).toHaveLength(1)
    expect(facts[0].type).toBe("fact")
  })

  it("respeita limit no search", () => {
    for (let i = 0; i < 10; i++) saveMemory(`item repetido ${i}`, "fact", "item")
    const results = searchMemories("item", undefined, 3)
    expect(results).toHaveLength(3)
  })
})

describe("getRecentMemories", () => {
  it("prioriza preference > decision > fact > observation", () => {
    saveMemory("obs", "observation", "")
    saveMemory("fato", "fact", "")
    saveMemory("decisão", "decision", "")
    saveMemory("preferência", "preference", "")
    const recent = getRecentMemories(4)
    expect(recent[0].type).toBe("preference")
    expect(recent[1].type).toBe("decision")
    expect(recent[2].type).toBe("fact")
    expect(recent[3].type).toBe("observation")
  })

  it("dentro do mesmo type, ordena por created_at DESC", () => {
    const db = initDb(":memory:")
    db.run("INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
      ["id-old", "fact", "fact old", "", "2025-01-01T00:00:00Z"])
    db.run("INSERT INTO memories (id, type, content, tags, created_at) VALUES (?, ?, ?, ?, ?)",
      ["id-new", "fact", "fact new", "", "2025-01-02T00:00:00Z"])
    const recent = getRecentMemories(2)
    expect(recent[0].content).toBe("fact new")
    expect(recent[1].content).toBe("fact old")
  })

  it("respeita limit", () => {
    for (let i = 0; i < 20; i++) saveMemory(`mem ${i}`, "fact", "")
    expect(getRecentMemories(5)).toHaveLength(5)
  })
})

describe("countMemories", () => {
  it("retorna 0 em DB vazio", () => {
    expect(countMemories()).toBe(0)
  })

  it("conta corretamente", () => {
    saveMemory("a", "fact", "")
    saveMemory("b", "decision", "")
    expect(countMemories()).toBe(2)
  })
})
