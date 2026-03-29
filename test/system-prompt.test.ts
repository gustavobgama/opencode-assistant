import { describe, expect, it, beforeEach, afterAll } from "bun:test"
import { initDb, closeDb, saveMemory } from "../src/memory/db"
import { buildMemoryBlock, createSystemPromptHook } from "../src/hooks/system-prompt"

beforeEach(() => {
  initDb(":memory:")
})

afterAll(() => {
  closeDb()
})

describe("buildMemoryBlock", () => {
  it("retorna string vazia quando não há memórias", () => {
    expect(buildMemoryBlock()).toBe("")
  })

  it("retorna bloco <memories> quando há memórias", () => {
    saveMemory("TypeScript é top", "preference", "lang")
    const block = buildMemoryBlock()
    expect(block).toContain("<memories>")
    expect(block).toContain("</memories>")
    expect(block).toContain("(preference)")
    expect(block).toContain("TypeScript é top")
    expect(block).toContain("#lang")
    expect(block).toContain("1 total")
  })

  it("não inclui tags vazias no output", () => {
    saveMemory("Sem tags aqui", "fact", "")
    const block = buildMemoryBlock()
    expect(block).toContain("Sem tags aqui")
    expect(block).not.toContain("# ")  // no trailing hash for empty tags
  })

  it("inclui instrução de uso pro LLM", () => {
    saveMemory("algo", "fact", "")
    const block = buildMemoryBlock()
    expect(block).toContain("memory_save")
    expect(block).toContain("Never mention or quote memories")
  })

  it("limita a 10 memórias", () => {
    for (let i = 0; i < 15; i++) saveMemory(`mem ${i}`, "fact", "")
    const block = buildMemoryBlock()
    expect(block).toContain("15 total, showing 10")
    // Count occurrences of "- (fact)"
    const matches = block.match(/- \(fact\)/g)
    expect(matches).toHaveLength(10)
  })
})

describe("createSystemPromptHook", () => {
  it("injeta prompt do assistente no system", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [] as string[] }
    await hook({ sessionID: "test", model: {} } as any, output)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain("<personal-assistant>")
    expect(output.system[0]).toContain("Brazilian Portuguese")
  })

  it("inclui memórias quando existem", async () => {
    saveMemory("Lembrar disso", "fact", "test")
    const hook = createSystemPromptHook()
    const output = { system: [] as string[] }
    await hook({ sessionID: "test", model: {} } as any, output)
    expect(output.system[0]).toContain("<memories>")
    expect(output.system[0]).toContain("Lembrar disso")
  })

  it("não inclui bloco <memories> quando DB está vazio", async () => {
    const hook = createSystemPromptHook()
    const output = { system: [] as string[] }
    await hook({ sessionID: "test", model: {} } as any, output)
    expect(output.system[0]).not.toContain("<memories>")
  })
})
