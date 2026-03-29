# Requirements — Usage Tracking & Cost Estimation

## 1. Overview

**Objetivo:** Rastrear consumo de tokens e custo estimado de cada interação com LLMs no plugin `opencode-assistant`, com granularidade até o nível de tool call, e expor essas métricas ao assistente via custom tools para consultas sob demanda e projeções de consumo.

**Entregável:** Coleta passiva de eventos de uso via hook `event`, persistência em SQLite dedicado (`assistant-usage.db`), tabela de preços estimados por modelo, e 3 custom tools (`usage_summary`, `usage_query`, `usage_estimate`) que o LLM pode chamar para responder perguntas sobre consumo.

**Contexto:** O OpenCode usa GitHub Copilot como LLM provider primário — sem cobrança direta por token. Mas rastrear consumo é valioso por 3 razões: (1) entender padrões de uso (quais tasks/tools consomem mais), (2) estimar custo-equivalente caso o provider mude para pay-per-token (Anthropic, OpenAI), (3) projetar consumo futuro com base em histórico real. O SDK do OpenCode já emite eventos com `tokens: {input, output, reasoning, cache: {read, write}}` e `cost: number` em cada `AssistantMessage` e `StepFinishPart` — a informação existe, só precisa ser capturada e armazenada.

**Stakeholder:** Gustavo Gama (uso pessoal, máquina local).

**Dependência:** plugin-scaffold (completa), plugin-memory (completa — padrão de DB + tools reutilizado).

---

## 2. Definitions

| Termo | Definição |
|-------|-----------|
| **Usage event** | Registro atômico de consumo: tokens in/out/reasoning/cache, custo reportado pelo engine, custo estimado, modelo, provider, sessão, timestamp. |
| **Step** | Uma "rodada" completa do agentic loop do OpenCode. Uma mensagem do usuário pode gerar N steps (tool calls, reasoning, etc). Cada step tem contagem própria de tokens. |
| **Tool call** | Invocação de uma tool pelo LLM dentro de um step. Rastreado via `ToolPart` com estado `completed` ou `error`. |
| **Estimated cost** | Custo calculado pelo plugin aplicando a tabela de preços por modelo sobre a contagem de tokens. Diferente do `cost` reportado pelo engine (que pode ser zero pra Copilot). |
| **Price table** | Mapeamento `model_id → {input_price, output_price, cache_read_price, cache_write_price}` em USD por milhão de tokens. Configurável e atualizável. |
| **Projection** | Estimativa de consumo futuro baseada em médias históricas (ex: "nos últimos 7 dias vc usou X tokens/dia, projeta Y no mês"). |

---

## 3. Functional Requirements

### FR-1: Event Capture

- **REQ-1:** O plugin SHALL registrar o hook `event` e capturar eventos relevantes para tracking de uso.
  1.1 WHEN um evento `message.updated` for recebido com uma `AssistantMessage` (role === "assistant"), THEN o plugin SHALL extrair e persistir: `tokens` (input, output, reasoning, cache.read, cache.write), `cost`, `modelID`, `providerID`, `sessionID`, `messageID`, timestamps (`time.created`, `time.completed`).
  1.2 WHEN um evento `message.part.updated` for recebido com um `StepFinishPart` (type === "step-finish"), THEN o plugin SHALL extrair e persistir: `tokens`, `cost`, `sessionID`, `messageID`, step `id`, `reason`.
  1.3 WHEN um evento `message.part.updated` for recebido com um `ToolPart` (type === "tool") em estado terminal (completed ou error), THEN o plugin SHALL extrair e persistir: `tool` (nome), `callID`, `sessionID`, `messageID`, `state.status`, timestamp.
  1.4 A captura SHALL ser fire-and-forget — erros de persistência NÃO DEVEM impactar o fluxo normal do assistente.

### FR-2: Usage Storage

- **REQ-2:** O plugin SHALL criar e manter um banco SQLite **separado** em `~/.config/opencode/assistant-usage.db`.
  2.1 O schema SHALL conter uma tabela `message_usage` com: `id` (PK), `session_id`, `message_id`, `model_id`, `provider_id`, `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost_reported` (do engine), `cost_estimated` (calculado pelo plugin), `created_at`, `completed_at`.
  2.2 O schema SHALL conter uma tabela `step_usage` com: `id` (PK), `session_id`, `message_id`, `step_id`, `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost_reported`, `cost_estimated`, `reason`, `created_at`.
  2.3 O schema SHALL conter uma tabela `tool_usage` com: `id` (PK), `session_id`, `message_id`, `call_id`, `tool_name`, `status` (completed|error), `created_at`.
  2.4 O schema SHALL conter uma tabela `price_table` com: `model_id`, `provider_id`, `input_price_per_mtok`, `output_price_per_mtok`, `cache_read_price_per_mtok`, `cache_write_price_per_mtok`, `currency` (default "USD"), `updated_at`. Compound PK em (model_id, provider_id).
  2.5 O banco SHALL ser inicializado no boot do plugin, em paralelo ao banco de memórias (NÃO bloqueia um ao outro).
  2.6 O banco SHALL usar WAL mode para permitir leitura concorrente com escrita.

### FR-3: Price Table & Cost Estimation

- **REQ-3:** O plugin SHALL manter uma tabela de preços estimados por modelo, usada para calcular `cost_estimated` em cada evento.
  3.1 A tabela SHALL vir pré-populada com preços de referência dos principais modelos (baseados em preços públicos de Anthropic, OpenAI e Google como proxy).
  3.2 Para modelos do GitHub Copilot (provider "copilot"), o plugin SHALL usar preços equivalentes do modelo base (ex: `gpt-4o` → preços da OpenAI, `claude-sonnet-4-20250514` → preços da Anthropic).
  3.3 O `cost_estimated` SHALL ser calculado como: `(tokens_input × input_price + tokens_output × output_price + tokens_cache_read × cache_read_price + tokens_cache_write × cache_write_price) / 1_000_000`.
  3.4 WHEN um modelo não estiver na tabela de preços, THEN o `cost_estimated` SHALL ser zero e o registro SHALL ser marcado com flag `price_missing = true`.
  3.5 A tabela de preços SHALL ser atualizável via tool `usage_update_prices` (admin).

### FR-4: Usage Tools

- **REQ-4:** O plugin SHALL registrar uma tool `usage_summary` que retorna um resumo de consumo.
  4.1 Args: `period` (optional, default "7d" — suporta "today", "7d", "30d", "all"), `group_by` (optional, default "day" — suporta "day", "model", "session", "tool").
  4.2 O retorno SHALL incluir: total de tokens (input+output+reasoning), custo estimado total (USD), número de mensagens, número de tool calls, breakdown pelo agrupamento escolhido.
  4.3 WHEN `group_by` for "tool", THEN o retorno SHALL incluir contagem de invocações, taxa de sucesso e custo estimado associado ao step que contém cada tool call.

- **REQ-5:** O plugin SHALL registrar uma tool `usage_query` que permite consultas granulares.
  5.1 Args: `session_id` (optional), `model_id` (optional), `tool_name` (optional), `from_date` (optional), `to_date` (optional), `limit` (optional, default 50).
  5.2 O retorno SHALL incluir registros individuais de `message_usage` e `tool_usage` filtrados pelos critérios.
  5.3 A tool SHALL suportar combinação de filtros (ex: "tool calls de bash na última semana").

- **REQ-6:** O plugin SHALL registrar uma tool `usage_estimate` que projeta consumo futuro.
  6.1 Args: `horizon` (required — "week", "month", "quarter"), `based_on` (optional, default "30d" — período base para a média).
  6.2 A projeção SHALL ser calculada como: média diária do período base × dias do horizonte.
  6.3 O retorno SHALL incluir: projeção de tokens (input, output, total), custo estimado projetado (USD), intervalo de confiança simples (min/max baseado em desvio padrão do período base).
  6.4 WHEN o período base tiver menos de 3 dias de dados, THEN a tool SHALL retornar warning indicando projeção pouco confiável.

### FR-5: Tool-Level Attribution

- **REQ-7:** O plugin SHALL correlacionar tool calls com steps para atribuição de custo.
  7.1 WHEN um `ToolPart` for capturado, o plugin SHALL associá-lo ao step corrente (mesmo `messageID`) via join em `step_usage`.
  7.2 O custo atribuído a uma tool call SHALL ser calculado como: custo do step ÷ número de tool calls no step (distribuição uniforme dentro do step).
  7.3 A atribuição SHALL ser feita sob demanda (na query, não na escrita) para evitar dependência de ordem de eventos.

---

## 4. Non-Functional Requirements

- **NFR-1:** A captura de eventos NÃO DEVE adicionar mais que 5ms de latência ao processamento de cada evento.
- **NFR-2:** O banco `assistant-usage.db` DEVE ser inicializado (create + migrate) em menos de 50ms.
- **NFR-3:** Queries de agregação (usage_summary) DEVEM retornar em menos de 100ms para até 100.000 registros de usage.
- **NFR-4:** O plugin NÃO DEVE ter dependências externas além de `bun:sqlite`.
- **NFR-5:** O banco SHALL suportar uso contínuo de 6+ meses sem degradação (estimativa: ~500 mensagens/dia × 180 dias = ~90.000 registros).
- **NFR-6:** A captura de eventos SHALL ser idempotente — re-processamento do mesmo evento (mesmo `messageID` + `step_id`) NÃO DEVE criar duplicatas.
- **NFR-7:** Testes de performance (100K+ rows) SHALL rodar separados do test suite rápido. O comando `bun test` padrão DEVE completar em menos de 500ms (excluindo perf tests). Perf tests SHALL ser executáveis via `bun test test/usage-performance.test.ts` sob demanda.

---

## 5. Assumptions

- **A-1:** O hook `event` recebe todos os eventos do engine, incluindo `message.updated` e `message.part.updated`, com os campos documentados no SDK v1.3.3.
- **A-2:** O `cost` reportado pelo engine é zero (ou próximo de zero) para o provider GitHub Copilot — a estimativa de custo é o valor real de referência.
- **A-3:** Os eventos `message.part.updated` com `ToolPart` são emitidos em estado terminal (completed/error) — não é necessário fazer polling.
- **A-4:** Um `StepFinishPart` é emitido após cada agentic loop step, mesmo quando o step contém apenas uma tool call.
- **A-5:** O `modelID` no `AssistantMessage` corresponde ao ID público do modelo (ex: "gpt-4o", "claude-sonnet-4-20250514") e pode ser mapeado 1:1 para a tabela de preços.
- **A-6:** O volume de uso é pessoal (1 usuário) — não há necessidade de multitenancy ou controle de acesso.

---

## 6. Out of Scope

- **OS-1:** Dashboard ou UI gráfica de consumo (consumo é consultável via tools do LLM).
- **OS-2:** Alertas automáticos de consumo excessivo (spec futura).
- **OS-3:** Integração com APIs reais de billing de providers (os custos são estimados, não reais).
- **OS-4:** Tracking de tokens do system prompt / context injection (tokens contados pelo engine já incluem tudo).
- **OS-5:** Exportação de dados para CSV/JSON (pode ser feita via tool `usage_query` + bash).
- **OS-6:** Retenção automática / purge de dados antigos (volume pessoal não justifica).
- **OS-7:** Tracking de custo de MCP tools (tokens de MCP são contabilizados dentro do step pelo engine).
