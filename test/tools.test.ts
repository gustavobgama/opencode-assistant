import { describe, expect, it, beforeEach, afterAll } from "bun:test"
import { initDb, closeDb, saveMemory } from "../src/memory/db"
import { memorySave, memorySearch, memoryList } from "../src/memory/tools"

// Fake ToolContext — tools receive this but our tests only need execute()
const fakeContext = {} as any

beforeEach(() => {
  initDb(":memory:")
})

afterAll(() => {
  closeDb()
})

describe("memorySave tool", () => {
  it("salva memória normal e retorna confirmação", async () => {
    const result = await memorySave.execute(
      { content: "Prefiro dark mode", type: "preference", tags: "ui" },
      fakeContext,
    )
    expect(result).toContain("Memory saved")
    expect(result).toContain("preference")
  })

  it("usa defaults quando type e tags são omitidos", async () => {
    const result = await memorySave.execute(
      { content: "Algo observado", type: "observation", tags: "" },
      fakeContext,
    )
    expect(result).toContain("Memory saved")
    expect(result).toContain("observation")
  })

  it("rejeita conteúdo com GitHub token", async () => {
    const result = await memorySave.execute(
      { content: "Token: ghp_ABCDEFghijklMNOPQRstuvwx1234567890ab", type: "fact", tags: "" },
      fakeContext,
    )
    expect(result).toContain("REJECTED")
    expect(result).toContain("secret")
  })

  it("rejeita conteúdo com JWT", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    const result = await memorySave.execute(
      { content: `Meu JWT é ${jwt}`, type: "fact", tags: "" },
      fakeContext,
    )
    expect(result).toContain("REJECTED")
  })
})

describe("memorySearch tool", () => {
  it("encontra memória salva", async () => {
    saveMemory("Bun é mais rápido que Node", "fact", "runtime")
    const result = await memorySearch.execute(
      { query: "Bun", limit: 10 },
      fakeContext,
    )
    expect(result).toContain("Found 1 memories")
    expect(result).toContain("Bun é mais rápido que Node")
  })

  it("retorna mensagem quando não encontra", async () => {
    const result = await memorySearch.execute(
      { query: "inexistente", limit: 10 },
      fakeContext,
    )
    expect(result).toContain("No memories found")
  })
})

describe("memoryList tool", () => {
  it("lista memórias existentes", async () => {
    saveMemory("mem 1", "fact", "")
    saveMemory("mem 2", "decision", "")
    const result = await memoryList.execute({ limit: 20 }, fakeContext)
    expect(result).toContain("2 memories")
    expect(result).toContain("mem 1")
    expect(result).toContain("mem 2")
  })

  it("retorna mensagem quando vazio", async () => {
    const result = await memoryList.execute({ limit: 20 }, fakeContext)
    expect(result).toContain("No memories stored yet")
  })

  it("filtra por type", async () => {
    saveMemory("fato", "fact", "")
    saveMemory("decisão", "decision", "")
    const result = await memoryList.execute({ type: "fact", limit: 20 }, fakeContext)
    expect(result).toContain("1 memories")
    expect(result).toContain("fato")
    expect(result).not.toContain("decisão")
  })
})
