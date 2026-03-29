# Requirements — Persistent Memory

## 1. Overview

**Objetivo:** Adicionar memória persistente cross-session ao plugin `opencode-assistant`, permitindo que o assistente lembre fatos, decisões, preferências e observações entre sessões.

**Entregável:** 3 custom tools (`memory_save`, `memory_search`, `memory_list`) acessíveis pelo LLM, com storage em SQLite local via `bun:sqlite`. Memórias relevantes são injetadas automaticamente no system prompt a cada conversa. Memórias sobrevivem compactação de contexto.

**Contexto:** O OpenCode não tem memória cross-session nativa. Cada sessão começa do zero. O HubAI Nitro resolve isso com 4 tipos de memória (fact, decision, preference, observation) armazenadas em SQLite com busca híbrida (FTS5 + embeddings). Nesta spec, implementamos busca textual via FTS5 — embeddings ficam pra uma evolução futura.

**Stakeholder:** Gustavo Gama (uso pessoal, máquina local).

**Dependência:** plugin-scaffold (spec anterior, completa).

---

## 2. Definitions

| Termo | Definição |
|-------|-----------|
| **Memory** | Registro persistente com tipo, conteúdo, tags e timestamps. Armazenado em SQLite. |
| **Memory type** | Classificação: `fact` (fato sobre o mundo), `decision` (decisão técnica/arquitetural), `preference` (preferência do usuário), `observation` (padrão/comportamento observado) |
| **FTS5** | Full-Text Search do SQLite — índice invertido pra busca textual eficiente |
| **Context injection** | Memórias relevantes inseridas no system prompt no início de cada mensagem |
| **Compaction** | Resumo automático do OpenCode quando o contexto fica grande — memórias devem sobreviver |

---

## 3. Functional Requirements

### FR-1: Memory Storage

- **REQ-1:** O plugin SHALL criar e manter um banco SQLite em `~/.config/opencode/assistant-memory.db` usando `bun:sqlite`.
  1.1 O banco SHALL ser criado automaticamente na primeira execução do plugin (auto-migrate).
  1.2 O schema SHALL conter uma tabela `memories` com: `id` (UUID), `type` (fact|decision|preference|observation), `content` (text), `tags` (text, comma-separated), `created_at` (ISO timestamp).
  1.3 O schema SHALL conter uma virtual table FTS5 `memories_fts` indexando `content` e `tags`.

### FR-2: Memory Tools

- **REQ-2:** O plugin SHALL registrar uma tool `memory_save` que o LLM pode chamar pra salvar memórias.
  2.1 Args: `content` (required string), `type` (optional, default "observation"), `tags` (optional string, comma-separated).
  2.2 O tool SHALL retornar confirmação com o ID da memória criada.
  2.3 O LLM SHALL ser instruído a salvar proativamente — não apenas quando o usuário diz "lembra disso".

- **REQ-3:** O plugin SHALL registrar uma tool `memory_search` que busca memórias por texto.
  3.1 Args: `query` (required string), `type` (optional, filtra por tipo), `limit` (optional, default 10).
  3.2 A busca SHALL usar FTS5 match com ranking BM5 (built-in do SQLite FTS5).
  3.3 O tool SHALL retornar lista de memórias com id, type, content, tags, created_at e score de relevância.

- **REQ-4:** O plugin SHALL registrar uma tool `memory_list` que lista memórias recentes.
  4.1 Args: `type` (optional), `limit` (optional, default 20).
  4.2 Ordenação por `created_at` DESC.

### FR-3: Automatic Context Injection

- **REQ-5:** WHEN o engine monta o system prompt (hook `experimental.chat.system.transform`), THEN o plugin SHALL injetar as top-K memórias mais recentes e relevantes.
  5.1 O plugin SHALL injetar no máximo 10 memórias no system prompt.
  5.2 As memórias injetadas SHALL ser formatadas como bloco `<memories>` com tipo, conteúdo e data.
  5.3 O plugin SHALL priorizar memórias do tipo `preference` e `decision` (mais acionáveis) sobre `fact` e `observation`.
  5.4 O plugin SHALL incluir instrução ao LLM pra usar memórias silenciosamente (nunca citar "minhas memórias dizem...").

### FR-4: Compaction Survival

- **REQ-6:** WHEN uma sessão é compactada (hook `experimental.session.compacting`), THEN o plugin SHALL injetar as memórias ativas no contexto de compactação.
  6.1 Isso garante que o resumo gerado pela compactação inclua referências às memórias.

---

## 4. Non-Functional Requirements

- **NFR-1:** O banco SQLite DEVE ser criado e migrado em menos de 100ms no boot do plugin.
- **NFR-2:** Buscas FTS5 DEVEM retornar em menos de 50ms pra bases de até 10.000 memórias.
- **NFR-3:** O plugin NÃO DEVE ter dependências externas além de `bun:sqlite` (built-in).
- **NFR-4:** A injeção de memórias no system prompt NÃO DEVE exceder 2.000 tokens (~8KB de texto).
- **NFR-5:** O banco NÃO DEVE armazenar secrets (tokens, passwords) — o `memory_save` SHALL rejeitar conteúdo que contenha patterns de secrets (reutilizar patterns do vibeguard config).

---

## 5. Assumptions

- **A-1:** `bun:sqlite` está disponível no runtime do plugin (confirmado via teste).
- **A-2:** O hook `tool` permite registrar custom tools que aparecem pro LLM como tools normais.
- **A-3:** O hook `experimental.session.compacting` permite injetar contexto extra no resumo.
- **A-4:** O plugin-scaffold já está implementado e carregando no OpenCode.
- **A-5:** O volume de memórias será da ordem de centenas a poucos milhares (uso pessoal).

---

## 6. Out of Scope

- **OS-1:** Embeddings e busca semântica (evolução futura — requer modelo de embedding local).
- **OS-2:** UI de gestão de memórias (visualizar, editar, deletar via interface gráfica).
- **OS-3:** Memória por agente/projeto (todas as memórias são globais nesta spec).
- **OS-4:** Decay temporal de relevância (memórias antigas perdendo peso automaticamente).
- **OS-5:** Exportação/importação de memórias.
