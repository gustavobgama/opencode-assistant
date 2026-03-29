import { describe, expect, it } from "bun:test"
import { containsSecret } from "../src/memory/secrets"

describe("containsSecret", () => {
  // --- Should REJECT ---

  it("rejeita GitHub personal access token (ghp_)", () => {
    // 36-char suffix — minimum to match /gh[ps]_[A-Za-z0-9_]{36,}/
    expect(containsSecret("my token is ghp_" + "x".repeat(36))).toBe(true)
  })

  it("rejeita GitHub PAT (github_pat_)", () => {
    // 22-char suffix — minimum to match /github_pat_[A-Za-z0-9_]{22,}/
    expect(containsSecret("github_pat_" + "A".repeat(22))).toBe(true)
  })

  it("rejeita OpenAI API key (sk-)", () => {
    // 20-char suffix — minimum to match /sk-[A-Za-z0-9\-_]{20,}/
    expect(containsSecret("sk-proj-" + "a".repeat(20))).toBe(true)
  })

  it("rejeita AWS access key ID", () => {
    // AKIA + 16 uppercase chars — matches /AKIA[0-9A-Z]{16}/
    expect(containsSecret("AKIA" + "X".repeat(16))).toBe(true)
  })

  it("rejeita Slack token (xoxb-)", () => {
    // 10+ chars after xoxb- — matches /xox[bpras]-[0-9A-Za-z\-]{10,}/
    expect(containsSecret("xoxb-" + "1".repeat(12))).toBe(true)
  })

  it("rejeita JWT", () => {
    // Synthetic JWT — 3 base64url segments with eyJ prefix
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "A".repeat(20)
    expect(containsSecret(jwt)).toBe(true)
  })

  it("rejeita RSA private key", () => {
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----\nMIIE...")).toBe(true)
  })

  it("rejeita private key genérica", () => {
    expect(containsSecret("-----BEGIN PRIVATE KEY-----\nMIIE...")).toBe(true)
  })

  it("rejeita generic api_key=... pattern", () => {
    expect(containsSecret("api_key=someVeryLongSecretKeyValue12345678")).toBe(true)
  })

  it("rejeita secret: pattern", () => {
    expect(containsSecret('secret: "MyVeryLongSecretValue12345678"')).toBe(true)
  })

  it("rejeita token dentro de texto maior", () => {
    const fakeGhp = "ghp_" + "y".repeat(36)
    expect(containsSecret(`O token do GitHub do projeto é ${fakeGhp} e precisa ser renovado`)).toBe(true)
  })

  // --- Should ALLOW ---

  it("permite texto normal", () => {
    expect(containsSecret("Minha linguagem favorita é TypeScript")).toBe(false)
  })

  it("permite texto com palavras curtas parecidas com tokens", () => {
    expect(containsSecret("O projeto usa a lib sk-utils pra parsing")).toBe(false)
  })

  it("permite texto vazio", () => {
    expect(containsSecret("")).toBe(false)
  })

  it("permite texto com números e caracteres especiais sem padrão de secret", () => {
    expect(containsSecret("A build #1234 passou em 2m30s com 95% de cobertura")).toBe(false)
  })

  it("permite menção genérica à palavra 'token' sem valor", () => {
    expect(containsSecret("Precisamos renovar o token do serviço")).toBe(false)
  })
})
