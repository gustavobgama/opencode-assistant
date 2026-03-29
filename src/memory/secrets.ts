// Common secret patterns — reject memory_save if content matches any
const SECRET_PATTERNS: RegExp[] = [
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9_]{36,}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  // OpenAI / Anthropic
  /sk-[A-Za-z0-9\-_]{20,}/,
  // AWS
  /AKIA[0-9A-Z]{16}/,
  /[0-9a-zA-Z/+]{40}(?=\s|$)/,
  // Slack
  /xox[bpras]-[0-9A-Za-z\-]{10,}/,
  // Generic JWT (3 base64 parts separated by dots)
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // Private keys
  /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  // Generic long hex/base64 secrets (API keys)
  /(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"]?[A-Za-z0-9/+_\-]{20,}/i,
]

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}
