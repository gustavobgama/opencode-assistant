# Tasks — Usage Tracking & Cost Estimation

## Overview

Implementação em 8 phases (0–7), 18 tasks. Phase 0 valida assumptions. Phases 1–4 constroem cada camada com testes básicos inline. **Phase 5 consolida testes unitários** — cobre edge cases, cross-module, boundary conditions e NFRs que os testes inline não cobrem. Phase 6 integra e valida E2E. Phase 7 é o checkpoint final.

- **Phase 0:** Validation & Spike (Event Discovery) — 2 tasks
- **Phase 1:** Storage Foundation — 2 tasks
- **Phase 2:** Price Engine — 2 tasks
- **Phase 3:** Event Collector — 2 tasks
- **Phase 4:** Query Layer & Tools — 4 tasks
- **Phase 5:** Consolidated Unit Tests — 3 tasks
- **Phase 6:** Plugin Integration & E2E — 3 tasks
- **Phase 7:** Final Checkpoint — 1 task

## Phase 0: Validation & Spike (Event Discovery)

> Validar empiricamente que o hook `event` recebe os dados documentados no SDK. Sem isso, todo o resto é especulação.

- [x] 0.1 — **Event Probe** `REQ-1, A-1, A-4` _Implements: DES-1_ — `src/usage/probe.ts` (temporary)
  1. Criar um handler de `event` hook temporário que loga **todos** os eventos recebidos (type + JSON truncado) no console.
  2. Registrar no `index.ts` como hook `event`.
  3. Abrir uma sessão no OpenCode, enviar 2-3 mensagens simples.
  4. Verificar no log:
     - `message.updated` emitido com `role === "assistant"`, `tokens` preenchido, `cost` presente
     - `message.part.updated` emitido com `type === "step-finish"`, `tokens` e `cost` presentes
     - `message.part.updated` emitido com `type === "tool"` e `state.status === "completed"`
     - `modelID` e `providerID` presentes no `AssistantMessage`
  5. Documentar quais campos chegam populados e quais são zero/null/undefined.
  6. Se algum dado **não** vier conforme esperado, atualizar a spec (requirements + design) antes de prosseguir.
  - **Acceptance:** Log confirma os 4 itens acima. Probe removido após validação.

- [x] 0.2 — **Model ID Mapping** `REQ-3.2, A-5` _Implements: DES-3_
  1. Na mesma sessão de teste, anotar o `modelID` exato que o engine reporta para o provider Copilot.
  2. Comparar com os IDs na seed data da tabela de preços (`prices.ts`).
  3. Se houver discrepância (ex: "copilot/gpt-4o" vs "gpt-4o"), documentar o pattern e ajustar a seed data ou o fuzzy match.
  - **Acceptance:** Mapeamento modelo→preço confirmado para pelo menos o modelo default do Copilot.

---

## Phase 1: Storage Foundation

> DB, schema, migrations, CRUD functions. Testes básicos inline pra feedback rápido.

- [x] 1.1 — **Usage Database Module** `REQ-2 (2.1–2.6)` _Implements: DES-2_ — `src/usage/db.ts`
  1. Criar `src/usage/db.ts` seguindo o padrão do `src/memory/db.ts`: singleton `getUsageDb()` / `initUsageDb(path)` / `closeUsageDb()`. Default path: `~/.config/opencode/assistant-usage.db`. `:memory:` para testes. WAL mode + foreign keys.
  2. Implementar `migrate()` com as 4 tabelas + índices do design (Section 4).
  3. Implementar CRUD: `upsertMessageUsage(data)`, `upsertStepUsage(data)`, `upsertToolUsage(data)`, `getMessageUsage(id)`, `getStepsByMessage(messageId)`, `getToolsByMessage(messageId)`.
  4. Exportar types: `MessageUsageRow`, `StepUsageRow`, `ToolUsageRow`, `PriceRow`.
  - **Acceptance:** `bun test test/usage-db.test.ts` passa — cobre create, upsert, read.

- [x] 1.2 — **Usage Database Tests (baseline)** `NFR-2, NFR-6` _Implements: DES-2_ — `test/usage-db.test.ts`
  1. Testar schema creation (4 tabelas existem após init).
  2. Testar upsert idempotency: inserir mesma row 2x, contar = 1.
  3. Testar upsert update: inserir com tokens_input=100, upsert com tokens_input=200, ler = 200.
  4. Testar queries de leitura (getMessageUsage, getStepsByMessage, getToolsByMessage).
  5. Testar `:memory:` isolation (cada teste com DB próprio).
  - **Acceptance:** 5+ test cases passando, cobrindo happy path e idempotency.

---

## Phase 2: Price Engine

> Tabela de preços, seed data, cálculo de estimativas. Testável isoladamente.

- [x] 2.1 — **Price Table & Estimation** `REQ-3 (3.1–3.4)` _Implements: DES-3_ — `src/usage/prices.ts`
  1. Definir `DEFAULT_PRICES` array com seed data conforme design Section 6.
  2. Implementar `seedPrices(db)` — INSERT OR IGNORE dos defaults.
  3. Implementar `lookupPrice(modelId, providerId): PriceRow | null` com 3-level fallback (exact → wildcard → fuzzy prefix).
  4. Implementar `estimateCost(modelId, providerId, tokens): { cost: number, missing: boolean }`.
  5. Chamar `seedPrices()` dentro de `migrate()` do `db.ts` (após CREATE TABLE).
  - **Acceptance:** `bun test test/usage-prices.test.ts` passa.

- [x] 2.2 — **Price Engine Tests (baseline)** `REQ-3` _Implements: DES-3_ — `test/usage-prices.test.ts`
  1. Testar lookup exact match (model_id + provider_id).
  2. Testar lookup wildcard fallback (provider_id = "*").
  3. Testar lookup fuzzy prefix (model com sufixo de data).
  4. Testar estimateCost com tokens conhecidos — verificar cálculo aritmético.
  5. Testar modelo não encontrado → `{ cost: 0, missing: true }`.
  6. Testar seedPrices idempotency (rodar 2x, sem duplicatas).
  - **Acceptance:** 6+ test cases passando.

---

## Phase 3: Event Collector

> Handler de eventos que conecta engine → DB. Core da feature.

- [x] 3.1 — **Collector Implementation** `REQ-1 (1.1–1.4)` _Implements: DES-1_ — `src/usage/collector.ts`
  1. Implementar `createUsageEventHandler()` conforme design Section 5.
  2. Handler de `message.updated`: filtrar `role === "assistant"` e `tokens.input > 0`. Extrair campos, chamar `estimateCost()`, chamar `upsertMessageUsage()`.
  3. Handler de `message.part.updated` para `StepFinishPart`: filtrar `type === "step-finish"`. Extrair campos, chamar `upsertStepUsage()`.
  4. Handler de `message.part.updated` para `ToolPart`: filtrar `type === "tool"` e estado terminal (`completed` ou `error`). Extrair campos, chamar `upsertToolUsage()`.
  5. Wrap tudo em try/catch — `console.error` mas nunca throw (REQ-1.4).
  - **Acceptance:** `bun test test/usage-collector.test.ts` passa.

- [x] 3.2 — **Collector Tests (baseline)** `REQ-1, NFR-1` _Implements: DES-1_ — `test/usage-collector.test.ts`
  1. Testar com evento `message.updated` com AssistantMessage válida → row inserida.
  2. Testar com evento `message.updated` com UserMessage → ignorado (nenhuma row).
  3. Testar com evento `message.updated` com tokens.input === 0 → ignorado.
  4. Testar com `message.part.updated` com StepFinishPart → row inserida em step_usage.
  5. Testar com `message.part.updated` com ToolPart completed → row inserida em tool_usage.
  6. Testar com ToolPart em estado `running` → ignorado.
  7. Testar fire-and-forget: forçar erro no DB (close antes), verificar que handler não lança.
  8. Testar idempotency: enviar mesmo evento 2x, contar rows = 1.
  - **Acceptance:** 8+ test cases passando.

---

## Phase 4: Query Layer & Tools

> SQL de agregação e as 3 custom tools que o LLM vai usar.

- [x] 4.1 — **Query Builders** `REQ-4 (4.2, 4.3), REQ-5 (5.3), REQ-7` _Implements: DES-5_ — `src/usage/queries.ts`
  1. Implementar `querySummaryByDay(fromEpoch): SummaryRow[]`.
  2. Implementar `querySummaryByModel(fromEpoch): SummaryRow[]`.
  3. Implementar `querySummaryBySession(fromEpoch): SummaryRow[]`.
  4. Implementar `querySummaryByTool(fromEpoch): ToolSummaryRow[]` com cost attribution (REQ-7.2).
  5. Implementar `queryUsageFiltered(filters): UsageDetailRow[]` com dynamic WHERE builder.
  6. Implementar `queryProjectionBase(fromEpoch): ProjectionBase` com avg/variance por dia.
  7. Helper: `periodToEpoch(period: string): number` — converte "today", "7d", "30d" para epoch ms.
  - **Acceptance:** `bun test test/usage-queries.test.ts` passa.

- [x] 4.2 — **Query Tests (baseline)** `REQ-4, REQ-5, REQ-6, REQ-7, NFR-3` _Implements: DES-5_ — `test/usage-queries.test.ts`
  1. Seed DB com dados de teste (10+ messages, 20+ steps, 30+ tool calls em 5+ dias).
  2. Testar querySummaryByDay — verificar agrupamento e totais.
  3. Testar querySummaryByTool — verificar contagens e cost attribution.
  4. Testar queryUsageFiltered com combinação de filtros (tool_name + date range).
  5. Testar queryProjectionBase — verificar avg e variance.
  6. Testar periodToEpoch — "today", "7d", "30d", "all".
  - **Acceptance:** 6+ test cases passando.

- [x] 4.3 — **Custom Tools** `REQ-4, REQ-5, REQ-6` _Implements: DES-4_ — `src/usage/tools.ts`
  1. Implementar `usageSummary` ToolDefinition: parsear args (`period`, `group_by`), converter para epoch via `periodToEpoch`, chamar query builder apropriado, formatar output com totais legíveis.
  2. Implementar `usageQuery` ToolDefinition: parsear args (`session_id`, `model_id`, `tool_name`, `from_date`, `to_date`, `limit`), chamar `queryUsageFiltered`, formatar output com timestamps ISO.
  3. Implementar `usageEstimate` ToolDefinition: parsear args (`horizon`, `based_on`), chamar `queryProjectionBase`, calcular projeção + intervalo de confiança, retornar warning se active_days < 3 (REQ-6.4).
  - **Acceptance:** `bun test test/usage-tools.test.ts` passa.

- [x] 4.4 — **Tools Tests (baseline)** `REQ-4, REQ-5, REQ-6` _Implements: DES-4_ — `test/usage-tools.test.ts`
  1. Testar usageSummary com period="7d" group_by="day" — output contém breakdown por dia.
  2. Testar usageSummary com group_by="tool" — output contém tool names e attribution.
  3. Testar usageQuery com filtro tool_name="bash" — retorna só tool calls de bash.
  4. Testar usageEstimate com horizon="month" — retorna projeção numérica.
  5. Testar usageEstimate com < 3 dias de dados — retorna warning.
  - **Acceptance:** 5+ test cases passando.

---

## Phase 5: Consolidated Unit Tests

> Expande a cobertura de testes além do baseline das fases anteriores. Foca em edge cases, boundary conditions, cross-module interactions e NFRs mensuráveis. Usa test fixtures compartilhadas.

- [x] 5.1 — **Shared Test Fixtures** `ALL REQs` _Implements: DES-1, DES-2, DES-3, DES-4, DES-5_ — `test/fixtures/usage-fixtures.ts`
  1. Criar `test/fixtures/usage-fixtures.ts` com factories reutilizáveis:
     - `makeAssistantMessageEvent(overrides?)` — retorna `EventMessageUpdated` com defaults válidos (tokens, cost, modelID, providerID, sessionID, timestamps).
     - `makeStepFinishEvent(overrides?)` — retorna `EventMessagePartUpdated` com `StepFinishPart`.
     - `makeToolPartEvent(overrides?)` — retorna `EventMessagePartUpdated` com `ToolPart` em estado terminal.
     - `seedUsageDb(db, opts?)` — popula DB in-memory com N dias de dados realistas (messages, steps, tools com proporções configuráveis).
     - `makeTokens(overrides?)` — retorna objeto `tokens` com defaults razoáveis.
  2. Configurar `beforeEach`/`afterEach` pattern compartilhado: `initUsageDb(":memory:")` + `closeUsageDb()`.
  - **Acceptance:** Factories exportadas, usáveis em todos os test files. Nenhuma duplicação de setup entre suites.

- [x] 5.2 — **Edge Cases & Boundary Conditions** `REQ-1, REQ-3, REQ-6, REQ-7, NFR-1, NFR-6` _Implements: DES-1, DES-2, DES-3, DES-5_ — `test/usage-edge-cases.test.ts`
  1. **Collector — eventos malformados**: evento `message.updated` sem campo `tokens` (undefined) → handler não lança, nenhuma row inserida.
  2. **Collector — tokens todos zero**: `tokens.input === 0 && tokens.output === 0` → ignorado (sem row).
  3. **Collector — completed_at null**: `AssistantMessage` com `time.completed` undefined → row inserida com `completed_at = null`.
  4. **Collector — evento desconhecido**: evento com `type === "session.created"` → handler retorna sem erro, nenhuma row.
  5. **Price — modelo com caracteres especiais**: model_id com `/`, `.`, espaços (ex: "anthropic/claude-3.5-sonnet") → lookup funciona via fuzzy.
  6. **Price — tabela de preços vazia**: deletar todas as rows de `price_table` → `estimateCost` retorna `{ cost: 0, missing: true }` sem crash.
  7. **Price — tokens negativos**: tokens.input = -1 (dados corrompidos do engine) → estimateCost retorna custo negativo (sem crash, sem silenciar).
  8. **Queries — DB vazio**: chamar `querySummaryByDay` com zero rows → retorna array vazio, sem erro.
  9. **Queries — single day**: chamar `queryProjectionBase` com exatamente 1 dia de dados → retorna avg com variance = 0.
  10. **Queries — active_days < 3 na projeção**: 2 dias de dados → `usageEstimate` retorna warning (REQ-6.4).
  11. **Attribution — step sem tool calls**: `querySummaryByTool` quando existem steps sem nenhuma tool → steps ignorados na attribution (sem division by zero).
  12. **Attribution — tools órfãs**: tool_usage com `message_id` que não tem step_usage correspondente → tool aparece com attributed_cost = 0 ou null (sem crash).
  13. **Idempotency — concurrent upserts**: inserir mesma `message_id` 10x em sequência rápida → exatamente 1 row no DB com último valor.
  14. **Tools — args defaults**: chamar `usageSummary` sem nenhum arg → usa defaults (period="7d", group_by="day"), retorna resultado válido.
  15. **Tools — from_date no futuro**: chamar `usageQuery` com `from_date` no futuro → retorna array vazio, sem erro.
  - **Acceptance:** 15+ test cases passando. Cada edge case documentado com comentário explicando o cenário.

- [x] 5.3 — **Performance & NFR Verification** `NFR-1, NFR-2, NFR-3, NFR-5, NFR-7` _Implements: DES-2, DES-5_ — `test/usage-performance.test.ts`
  1. **NFR-2 — DB init time**: medir tempo de `initUsageDb(":memory:")` incluindo migrate + seed → assert < 50ms.
  2. **NFR-3 — Aggregation at scale**: inserir 100.000 rows em `message_usage` via loop bulk INSERT, rodar `querySummaryByDay` → assert < 100ms.
  3. **NFR-3 — Tool attribution at scale**: inserir 100.000 tool_usage + step_usage, rodar `querySummaryByTool` → assert < 200ms.
  4. **NFR-5 — 6-month simulation**: inserir 500 messages/dia × 180 dias = 90.000 rows, rodar todas as queries de agregação → todas retornam sem erro, performance aceitável.
  5. **NFR-1 — Collector throughput**: criar 1.000 eventos válidos, processar todos via `createUsageEventHandler`, medir tempo total → assert < 5.000ms (média < 5ms/evento).
  6. **Index effectiveness**: rodar `EXPLAIN QUERY PLAN` nas 4 queries de agregação principais, verificar que usam os índices criados (nenhum full table scan).
  7. **NFR-7 — Test isolation**: este arquivo NÃO É importado/executado pelo `bun test` padrão. Usar `// @bun-test-ignore` ou pattern de nome (`*.perf.test.ts`) pra excluir do run default. Validar que `bun test` sem argumentos completa em < 500ms excluindo este arquivo.
  - **Acceptance:** 7 test cases passando. Executável isoladamente via `bun test test/usage-performance.test.ts`. Não impacta o ciclo rápido.

---

## Phase 6: Plugin Integration & E2E

> Conectar tudo no index.ts e validar end-to-end com o OpenCode real.

- [x] 6.1 — **Plugin Registration** `all REQs` _Implements: DES-1, DES-2, DES-3, DES-4, DES-5_ — `src/index.ts`
  1. Importar `getUsageDb`, `createUsageEventHandler`, `usageSummary`, `usageQuery`, `usageEstimate`.
  2. No boot: chamar `getUsageDb()` e logar readiness.
  3. Registrar `event: createUsageEventHandler()` nos hooks retornados.
  4. Adicionar as 3 tools ao objeto `tool` existente.
  5. Atualizar `VERSION` para "0.3.0".
  6. Build: `bun run build` sem erros.
  7. Adicionar script `"test:perf": "bun test test/*.perf.test.ts"` no `package.json`. Renomear `usage-performance.test.ts` → `usage-performance.perf.test.ts`.
  8. Configurar `bunfig.toml` (ou campo `test` no package.json) com `preload` ou pattern exclusion pra que `bun test` ignore `*.perf.test.ts` por padrão.
  - **Acceptance:** Plugin compila, `bun test` roda testes rápidos (< 500ms), `bun run test:perf` roda perf tests separadamente. Zero falhas em ambos.

- [x] 6.2 — **E2E Validation — Capture** `REQ-1, REQ-2, REQ-3` _Implements: DES-1, DES-2, DES-3_
  1. Carregar plugin no OpenCode (já registrado em opencode.json).
  2. Enviar 3-5 mensagens variadas (uma com tool calls, uma com raciocínio longo, uma simples).
  3. Verificar `assistant-usage.db`: `message_usage` tem N rows, `step_usage` tem >= N rows, `tool_usage` tem rows para cada tool call, `cost_estimated > 0` em pelo menos 1 row, `price_missing = 0` para o modelo default do Copilot.
  4. Verificar logs: nenhum erro de captura.
  - **Acceptance:** Todos os itens do passo 3 confirmados, sem erros no log.

- [x] 6.3 — **E2E Validation — Tools** `REQ-4, REQ-5, REQ-6` _Implements: DES-4, DES-5_
  1. Na mesma sessão (com dados já capturados), pedir ao assistente: "Quanto eu gastei de tokens hoje?", "Quais tools eu mais usei na última semana?", "Me mostra as últimas chamadas de bash", "Quanto vou gastar no mês se continuar assim?".
  2. Verificar: assistente chama a tool correta para cada pergunta, output é legível, projeção retorna valores plausíveis, warning aparece se < 3 dias de dados.
  - **Acceptance:** Assistente responde as 4 perguntas usando as tools corretas, com dados consistentes.

---

## Phase 7: Final Checkpoint

- [x] 7.1 — **Spec Compliance Verification** `ALL REQs, ALL NFRs` _Implements: DES-1, DES-2, DES-3, DES-4, DES-5_
  1. Revisitar cada REQ e confirmar implementação: REQ-1 (event capture), REQ-2 (DB schema), REQ-3 (price table), REQ-4 (usage_summary), REQ-5 (usage_query), REQ-6 (usage_estimate), REQ-7 (tool-level attribution).
  2. Revisitar NFRs: NFR-1 (captura < 5ms), NFR-2 (DB init < 50ms), NFR-3 (aggregation < 100ms), NFR-4 (zero deps), NFR-5 (6+ meses), NFR-6 (idempotency).
  3. Todos os testes passam: `bun test` (fast suite < 500ms) + `bun run test:perf` (perf suite). Total esperado: ~60+ test cases.
  4. Build limpo: `bun run build`.
  5. Cobertura de testes cobre todos os módulos: db.ts, prices.ts, collector.ts, queries.ts, tools.ts.
  - **Acceptance:** ✅ Todos os REQs e NFRs confirmados, zero falhas em testes e build. Post-review fixes applied: (1) cost attribution in querySummaryByTool corrected to use cost_estimated from message_usage instead of cost_reported from step_usage (REQ-7.2), (2) probe handler removed (Phase 0 cleanup), (3) null guard added to collector for malformed events, (4) version aligned to 0.3.0 across package.json and index.ts.
