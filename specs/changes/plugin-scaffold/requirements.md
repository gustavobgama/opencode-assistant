# Requirements — Plugin Scaffold & Machine Access

## 1. Overview

**Objetivo:** Criar o plugin unificado `opencode-assistant` (npm package), registrá-lo no OpenCode Desktop e configurar acesso irrestrito à máquina — eliminando prompts de confirmação para operações de filesystem, bash e edição.

**Entregável:** O plugin instalado no OpenCode, agente respondendo em PT-BR como assistente pessoal de máquina (não coding agent), sem mensagens de restrição ao executar comandos como `brew install`, ler arquivos fora do projeto, ou editar em qualquer path.

**Contexto:** O OpenCode tem um sistema de permissões com 3 níveis (allow/deny/ask). Por default, operações fora do diretório do projeto pedem confirmação. O plugin pode interceptar essas permissões via hook `permission.ask` e auto-aprovar. Combinado com config de permissões e AGENTS.md, isso transforma o OpenCode de coding agent em assistente pessoal.

**Stakeholder:** Gustavo Gama (uso pessoal, máquina local).

---

## 2. Definitions

| Termo | Definição |
|-------|-----------|
| **Plugin** | Pacote npm que o OpenCode carrega no boot, recebe `PluginInput` (client SDK, serverUrl, BunShell) e retorna `Hooks` (tools, event listeners, interceptors) |
| **Hook** | Função callback que intercepta pontos do lifecycle do engine (permissões, mensagens, system prompt, etc) |
| **Permission** | Sistema de 3 níveis do OpenCode: `allow` (silencioso), `ask` (prompt interativo), `deny` (bloqueio) |
| **AGENTS.md** | Arquivo markdown injetado no system prompt de todos os agentes — define comportamento global |
| **PluginInput** | Objeto passado ao plugin no boot: `{ client, project, directory, worktree, serverUrl, $ }` |

---

## 3. Functional Requirements

### FR-1: Plugin Scaffold

- **REQ-1:** WHEN o OpenCode inicializa, THEN o sistema SHALL carregar o plugin `opencode-assistant` a partir da config `plugin: ["file://path"]` ou `plugin: ["opencode-assistant@version"]`.
  1.1 O plugin SHALL exportar uma função `Plugin` que recebe `PluginInput` e retorna `Promise<Hooks>`.
  1.2 O plugin SHALL ser implementado em TypeScript usando `@opencode-ai/plugin` como dependência.
- **REQ-2:** WHEN o plugin é carregado, THEN o sistema SHALL registrar todos os hooks retornados (permission, system transform, tools, events).
  2.1 O plugin SHALL logar no console a versão e os hooks registrados durante a inicialização.
- **REQ-3:** O plugin SHALL ser distribuível como npm package para que outros usuários possam instalar via `plugin: ["opencode-assistant@1.0.0"]` no `opencode.json`.
  3.1 O plugin SHALL funcionar também via path local durante desenvolvimento: `plugin: ["file:///path/to/plugin.js"]`.

### FR-2: Machine Access (Auto-Approve Permissions)

- **REQ-4:** WHEN o engine pede confirmação de permissão (hook `permission.ask`), THEN o plugin SHALL auto-aprovar setando `output.status = "allow"`.
  4.1 O auto-approve SHALL cobrir todas as categorias: bash, read, edit, external_directory.
  4.2 O auto-approve SHALL ser ativável/desativável via flag no config do plugin.
- **REQ-5:** O config do OpenCode SHALL incluir permissões explícitas como fallback: `permission: { bash: "allow", read: "allow", edit: "allow", external_directory: { "*": "allow" } }`.
  5.1 O plugin e o config de permissões são redundantes por design — defense in depth.

### FR-3: Personal Assistant System Prompt

- **REQ-6:** WHEN o engine monta o system prompt (hook `experimental.chat.system.transform`), THEN o plugin SHALL injetar instruções de assistente pessoal no array `system`.
  6.1 As instruções SHALL incluir: idioma PT-BR casual, princípios de operação (resourceful, honest, concise), framing de "assistente de máquina" (não coding agent).
  6.2 As instruções SHALL ser complementares ao AGENTS.md (não duplicar).
- **REQ-7:** O AGENTS.md global (`~/.config/opencode/AGENTS.md`) SHALL conter instruções complementares ao plugin sobre comportamento, memórias (futuras) e linguagem.
  7.1 O AGENTS.md SHALL mencionar que o agente tem acesso completo à máquina e não é restrito a projetos.

### FR-4: Security Guardrails

- **REQ-8:** O system prompt e o AGENTS.md SHALL conter diretivas de segurança que impeçam o agente de vazar informações sensíveis do ambiente.
  8.1 O agente SHALL ser instruído a NUNCA exibir, logar ou incluir em respostas: tokens de API, variáveis de ambiente que contenham credenciais, chaves privadas, cookies de sessão ou qualquer secret.
  8.2 WHEN o usuário pedir pra executar comandos como `env`, `printenv`, `set`, ou ler arquivos como `.env`, `credentials`, o agente SHALL redatar valores sensíveis na saída (substituir por `[REDACTED]` ou omitir).
  8.3 O agente SHALL recusar pedidos explícitos de revelar tokens, API keys ou secrets — mesmo que o usuário insista.
  8.4 O agente SHALL tratar conteúdo de tool outputs (bash, read) como dados potencialmente sensíveis e filtrar antes de incluir na resposta ao usuário.
  8.5 As diretivas de segurança SHALL estar presentes TANTO no system prompt injetado via plugin QUANTO no AGENTS.md — defense in depth.

---

## 4. Non-Functional Requirements

- **NFR-1:** O plugin DEVE ser carregado em menos de 500ms (não deve impactar o boot do OpenCode).
- **NFR-2:** O hook `permission.ask` DEVE responder síncronamente (sem I/O, sem latência perceptível).
- **NFR-3:** O plugin DEVE ter zero dependências além de `@opencode-ai/plugin` (mínimo footprint).
- **NFR-4:** O plugin DEVE funcionar com OpenCode Desktop v1.3.3+ sem patches no engine.
- **NFR-5:** O plugin DEVE ser testável standalone (sem precisar do OpenCode rodando).

---

## 5. Assumptions

- **A-1:** O OpenCode Desktop v1.3.3+ está instalado e funcional.
- **A-2:** GitHub Copilot está autenticado como provider.
- **A-3:** Bun está instalado (o OpenCode usa Bun pra instalar deps de plugins).
- **A-4:** O diretório de trabalho será `~/Assistant/`.
- **A-5:** O hook `permission.ask` é chamado antes de qualquer prompt interativo de permissão — se o plugin seta `allow`, o prompt não aparece.
- **A-6:** O hook `experimental.chat.system.transform` permite injetar strings no array `system` que compõe o system prompt.

---

## 6. Out of Scope

- **OS-1:** Memory tools (spec separada futura).
- **OS-2:** Heartbeat scheduler (spec separada futura).
- **OS-3:** Agent personas (spec separada futura).
- **OS-4:** Usage tracking / token metrics (spec separada futura).
- **OS-5:** Publicação no npm registry (v1 usa path local, publicação é step futuro).
