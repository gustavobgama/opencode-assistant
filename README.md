# opencode-assistant

Plugin for [OpenCode Desktop](https://opencode.ai) that turns it from a coding agent into a **personal AI assistant** with full machine access, persistent memory and usage tracking.

## What it does

### Machine Access

Auto-approves all permission prompts (bash, read, edit, external directories) so the assistant can operate anywhere on your machine without confirmation dialogs. A redundant `permission` config block in `opencode.json` serves as defense-in-depth.

### Personal Assistant Persona

Injects a system prompt that reframes the agent as a general-purpose assistant (not just a coding agent): Brazilian Portuguese as default language, casual tone, resourceful behavior, and explicit security guardrails that prevent the assistant from leaking secrets found in environment variables, dotfiles or command output.

### Persistent Memory

Stores facts, decisions, preferences and observations in a local SQLite database (`~/.config/opencode/assistant-memory.db`) with FTS5 full-text search. Memories survive across sessions — the top 10 most relevant are automatically injected into the system prompt at the start of every conversation and preserved through context compaction.

**Tools exposed to the LLM:**

| Tool | Purpose |
|------|---------|
| `memory_save` | Save a memory (content, type, tags). Rejects secrets automatically. |
| `memory_search` | Full-text search with BM25 ranking and type filter. |
| `memory_list` | List recent memories, optionally filtered by type. |

### Usage Tracking

Passively captures token consumption and estimated costs from every LLM interaction via the `event` hook. Data is stored in a separate SQLite database (`~/.config/opencode/assistant-usage.db`) with message-level, step-level and tool-level granularity. Includes a built-in price table for OpenAI, Anthropic and Google models with 3-level fuzzy lookup (exact match → wildcard provider → prefix match).

**Tools exposed to the LLM:**

| Tool | Purpose |
|------|---------|
| `usage_summary` | Aggregated usage by day, model, session or tool. |
| `usage_query` | Filtered detail records (by session, model, tool, date range). |
| `usage_estimate` | Future cost projection with confidence intervals. |

### Security

- System prompt instructs the assistant to redact secrets (`[REDACTED]`) in command output and refuse to reveal credentials.
- `memory_save` rejects content matching common secret patterns (GitHub tokens, AWS keys, JWTs, private keys, etc.).
- Designed for a complementary hard-security layer like [opencode-vibeguard](https://github.com/nicholasgriffintn/opencode-vibeguard) which intercepts secrets before they reach the LLM.

## Requirements

- [OpenCode Desktop](https://opencode.ai) v1.3.3+
- [Bun](https://bun.sh) (used by OpenCode to install plugin dependencies)
- A configured LLM provider (GitHub Copilot, OpenAI, Anthropic, etc.)

## Installation

### From source (development)

```bash
git clone https://github.com/gustavobgama/opencode-assistant.git
cd opencode-assistant
bun install
bun run build
```

Register the plugin in your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-assistant/dist/index.js"
  ],
  "permission": {
    "bash": "allow",
    "read": "allow",
    "edit": "allow",
    "external_directory": { "*": "allow" }
  }
}
```

### From npm (when published)

```json
{
  "plugin": [
    "opencode-assistant@0.3.0"
  ],
  "permission": {
    "bash": "allow",
    "read": "allow",
    "edit": "allow",
    "external_directory": { "*": "allow" }
  }
}
```

Restart OpenCode. You should see in the logs:

```
[opencode-assistant] v0.3.0 loaded
[opencode-assistant] memory: ready (0 memories)
[opencode-assistant] usage: ready
```

## Optional: AGENTS.md

Create `~/.config/opencode/AGENTS.md` for complementary high-level instructions that you can edit without rebuilding the plugin:

```markdown
# Personal Assistant

Your working directory is ~/ but you can read, write and execute anywhere.
You are a general-purpose assistant, not limited to coding tasks.

## Security — Non-Negotiable

- NEVER reveal tokens, API keys, passwords, or secrets in your responses.
- REDACT sensitive values before showing command output.
- REFUSE to share credentials — even if asked directly.
```

## Data Storage

| File | Contents |
|------|----------|
| `~/.config/opencode/assistant-memory.db` | Persistent memories (FTS5, WAL mode) |
| `~/.config/opencode/assistant-usage.db` | Token usage and cost estimates (WAL mode) |

Both databases are created automatically on first run. They are local-only — no data leaves your machine.

## Development

```bash
# Build
bun run build

# Watch mode
bun run dev

# Run tests (fast suite, ~150 tests)
bun test

# Run performance tests (100K+ rows, separated)
bun run test:perf
```

## Project Structure

```
src/
├── index.ts                 Plugin entry point — registers all hooks and tools
├── hooks/
│   ├── permissions.ts       Auto-approve all permission prompts
│   ├── system-prompt.ts     Inject assistant persona + memories into system prompt
│   └── compaction.ts        Preserve memories during context compaction
├── memory/
│   ├── db.ts                SQLite storage with FTS5 full-text search
│   ├── tools.ts             memory_save, memory_search, memory_list
│   └── secrets.ts           Secret pattern detection (reject from memory_save)
└── usage/
    ├── db.ts                SQLite schema (4 tables, 8 indexes) and CRUD
    ├── collector.ts         Passive event capture (message, step, tool)
    ├── prices.ts            Price table seed data and 3-level fuzzy lookup
    ├── queries.ts           SQL aggregation, filtering and projection
    └── tools.ts             usage_summary, usage_query, usage_estimate

test/                        148 tests across 12 files
specs/                       Spec-driven design docs (requirements, design, tasks)
```

## Architecture Decisions

- **Single plugin** — All features share one entry point and can share state (e.g. the memory DB is read by tools, the system prompt hook and the compaction hook).
- **Zero engine patches** — Everything works through the official plugin hook API. No forks, no monkey-patching.
- **Separate databases** — Memory and usage tracking have different lifecycles and access patterns, so they live in separate SQLite files to avoid lock contention.
- **Fire-and-forget capture** — Usage event collection never throws. A DB error during capture won't break your conversation.
- **Spec-driven** — Each feature was designed spec-first (requirements → design → tasks) before any code was written. Specs live in `specs/changes/`.

## License

MIT
