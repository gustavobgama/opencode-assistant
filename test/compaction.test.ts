import { describe, expect, it, beforeEach, afterAll } from "bun:test"
import { initDb, closeDb, saveMemory } from "../src/memory/db"
import { createCompactionHook } from "../src/hooks/compaction"

beforeEach(() => {
  initDb(":memory:")
})

afterAll(() => {
  closeDb()
})

describe("compaction hook", () => {
  it("não adiciona contexto quando não há memórias", async () => {
    const hook = createCompactionHook()
    const output = { context: [] as string[] }
    await hook({ sessionID: "test" }, output)
    expect(output.context).toHaveLength(0)
  })

  it("injeta memórias no contexto de compactação", async () => {
    saveMemory("Projeto usa Bun", "fact", "stack")
    saveMemory("Prefiro dark mode", "preference", "ui")
    const hook = createCompactionHook()
    const output = { context: [] as string[] }
    await hook({ sessionID: "test" }, output)
    expect(output.context).toHaveLength(1)
    expect(output.context[0]).toContain("<persistent-memories>")
    expect(output.context[0]).toContain("Projeto usa Bun")
    expect(output.context[0]).toContain("Prefiro dark mode")
    expect(output.context[0]).toContain("</persistent-memories>")
  })

  it("inclui tags nas memórias injetadas", async () => {
    saveMemory("algo", "fact", "tag1,tag2")
    const hook = createCompactionHook()
    const output = { context: [] as string[] }
    await hook({ sessionID: "test" }, output)
    expect(output.context[0]).toContain("#tag1,tag2")
  })
})
