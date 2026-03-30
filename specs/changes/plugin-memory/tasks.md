# Tasks — Persistent Memory

## Overview

3 fases: storage layer, tools + hooks, validação end-to-end.

- **Phase 0: Storage Layer** — SQLite DB com FTS5, módulo de memória (DES-1) ✅
- **Phase 1: Tools & Hooks** — Custom tools + injeção no prompt + compactação (DES-2, DES-3, DES-4) ✅
- **Phase 2: Final Checkpoint** — Validar persistência, busca, injeção e privacy

---

## Phase 0: Storage Layer ✅

**Objetivo:** Módulo `src/memory/db.ts` com DB SQLite + FTS5 funcional.

### T-0.1: Criar módulo de storage SQLite

- [x] Criar `src/memory/db.ts` com inicialização do `bun:sqlite` Database → _Implements: DES-1, REQ-1.1_
- [x] DB path: `~/.config/opencode/assistant-memory.db`, com `mkdir -p` do diretório → _Implements: DES-1, REQ-1.1_
- [x] PRAGMA `journal_mode=WAL` e `foreign_keys=ON` → _Implements: DES-1_
- [x] Criar tabela `memories` com schema: `id` (TEXT PK, UUID), `type` (TEXT, CHECK IN 4 tipos), `content` (TEXT), `tags` (TEXT), `created_at` (TEXT ISO) → _Implements: DES-1, REQ-1.2_
- [x] Criar virtual table FTS5 `memories_fts` indexando `content` e `tags` → _Implements: DES-1, REQ-1.3_
- [x] Criar triggers de sync entre `memories` e `memories_fts` (INSERT, DELETE) → _Implements: DES-1, REQ-1.3_
- **Acceptance:** DB criada automaticamente, schema correto, FTS5 funcional, triggers ativos. Boot < 100ms.

### T-0.2: Implementar funções de acesso

- [x] Implementar `saveMemory(content, type, tags)` → INSERT com randomUUID, retorna Memory → _Implements: DES-1, REQ-2_
- [x] Implementar `searchMemories(query, type?, limit)` → FTS5 MATCH com rank, retorna SearchResult[] → _Implements: DES-1, REQ-3.2_
- [x] Implementar `listMemories(type?, limit)` → SELECT com filtro opcional, ORDER BY created_at DESC → _Implements: DES-1, REQ-4_
- [x] Implementar `getRecentMemories(limit)` → SELECT priorizado (preference > decision > fact > observation) → _Implements: DES-1, REQ-5.1_
- **Acceptance:** Todas as funções CRUD operam corretamente, search retorna ranking BM25.

---

## Phase 1: Tools & Hooks ✅

**Objetivo:** 3 custom tools acessíveis pelo LLM + injeção no prompt + compactação.

### T-1.1: Implementar secret detection

- [x] Criar array `SECRET_PATTERNS` com regexes pra GitHub tokens, OpenAI keys, AWS keys, Slack tokens, JWTs, private keys → _Implements: DES-2, NFR-5_
- [x] Implementar `containsSecret(text)` que testa todos os patterns → _Implements: DES-2, NFR-5_
- **Acceptance:** Detecta padrões comuns de secrets, retorna boolean.

### T-1.2: Implementar custom tools de memória

- [x] Criar `src/memory/tools.ts` com 3 tools via `tool()` do `@opencode-ai/plugin` → _Implements: DES-2_
- [x] Tool `memory_save`: args `{content, type?, tags?}`, chama `saveMemory()`, rejeita se `containsSecret()` → _Implements: DES-2, REQ-2.1, REQ-2.2_
- [x] Tool `memory_search`: args `{query, type?, limit?}`, chama `searchMemories()`, formata resultado → _Implements: DES-2, REQ-3.1, REQ-3.3_
- [x] Tool `memory_list`: args `{type?, limit?}`, chama `listMemories()`, formata resultado → _Implements: DES-2, REQ-4.1, REQ-4.2_
- [x] Descriptions dos tools instruem o LLM a salvar proativamente → _Implements: REQ-2.3_
- **Acceptance:** Tools aparecem no `/tools` do OpenCode, executam sem erro, secret rejection funciona.

### T-1.3: Implementar injeção de memórias no system prompt

- [x] Modificar `src/hooks/system-prompt.ts` pra construir bloco `<memories>` → _Implements: DES-3, REQ-5.2_
- [x] Buscar top-10 memórias via `getRecentMemories(10)` → _Implements: DES-3, REQ-5.1, REQ-5.3_
- [x] Formatar cada memória como `- (type) date: content` → _Implements: DES-3, REQ-5.2_
- [x] Incluir instrução: nunca citar memórias explicitamente, internalizar e agir naturalmente → _Implements: DES-3, REQ-5.4_
- [x] Se zero memórias, não injetar bloco (sem ruído) → _Implements: DES-3_
- [x] Garantir que bloco `<memories>` não excede ~8KB (~2000 tokens) → _Implements: NFR-4_
- **Acceptance:** System prompt contém `<memories>` com memórias recentes, formatadas corretamente.

### T-1.4: Implementar hook de compactação

- [x] Criar `src/hooks/compaction.ts` com hook `experimental.session.compacting` → _Implements: DES-4, REQ-6_
- [x] Quando compactação ocorrer, injetar memórias recentes via `output.context.push()` → _Implements: DES-4, REQ-6.1_
- **Acceptance:** Hook registrado, injecta memórias no contexto de compactação.

### T-1.5: Integrar módulo de memória no plugin

- [x] Atualizar `src/index.ts` pra importar e registrar memory tools via hook `tool` → _Implements: DES-2_
- [x] Atualizar `src/index.ts` pra registrar compaction hook → _Implements: DES-4_
- [x] Inicializar DB no boot do plugin via `getDb()` → _Implements: DES-1_
- [x] Log de inicialização: `[opencode-assistant] memory: ready` → _Implements: DES-1_
- [x] Bump version pra `0.2.0` → _Implements: DES-1_
- [x] Build sem erros (`bun run build`) → _Implements: DES-1_
- **Acceptance:** Plugin compila, inicia com memória, loga status. 3 tools + 3 hooks registrados.

---

## Phase 2: Final Checkpoint ✅

**Objetivo:** Validação end-to-end de memória persistente cross-session.

### T-2.1: Validar tools de memória funcionais

- [x] No OpenCode: chamar `memory_save` com content, type=fact, tags → retorna id → _Validates: REQ-2, DES-2_
- [x] No OpenCode: chamar `memory_search` com query → retorna memória salva → _Validates: REQ-3, DES-2_
- [x] No OpenCode: chamar `memory_list` sem filtro → retorna todas as memórias → _Validates: REQ-4, DES-2_
- [x] No OpenCode: chamar `memory_list` com type=fact → retorna apenas facts → _Validates: REQ-4, DES-2_
- **Acceptance:** ✅ Todos os tools respondem corretamente via chat no OpenCode.

### T-2.2: Validar persistência cross-session

- [x] Salvar memória na sessão A → _Validates: REQ-1, REQ-2_
- [x] Fechar sessão A, abrir sessão B → _Validates: REQ-1_
- [x] Na sessão B, verificar que `memory_search` encontra a memória da sessão A → _Validates: REQ-1, REQ-3_
- [x] Na sessão B, verificar que bloco `<memories>` aparece no system prompt (via debug ou pergunta indireta) → _Validates: REQ-5, DES-3_
- **Acceptance:** ✅ Memórias persistem entre sessões, são buscáveis e injetadas automaticamente.

### T-2.3: Validar segurança e privacidade

- [x] Verificar que o DB existe em `~/.config/opencode/assistant-memory.db` → _Validates: REQ-1, NFR-3_
- [x] Tentar salvar memória com GitHub token (`ghp_...`) → deve ser rejeitada → _Validates: NFR-5, DES-2_
- [x] Tentar salvar memória com JWT (`eyJ...`) → deve ser rejeitada → _Validates: NFR-5, DES-2_
- [x] Verificar que nenhuma memória transita por serviços externos → _Validates: REQ-1_
- **Acceptance:** ✅ 100% local, secrets rejeitados, zero dados saem da máquina.

### T-2.4: Validar specs atualizadas

- [x] tasks.md atualizado com [x] em todas as tasks completadas → _Validates: spec hygiene_
- [x] Nenhum regression no plugin-scaffold (permission event handler + system prompt hook continuam funcionando) → _Validates: backward compat_
- **Acceptance:** ✅ Spec completa, plugin v0.3.0 operacional.

**Definition of Done Phase 2:** ✅ OpenCode com memória persistente cross-session funcional. Tools de memória respondendo, persistência validada, segurança verificada, zero regressões.
