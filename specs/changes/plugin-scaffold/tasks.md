# Tasks — Plugin Scaffold & Machine Access

## Overview

3 fases: scaffold do plugin, integração no OpenCode, validação end-to-end.

- **Phase 0: Plugin Scaffold** — Criar projeto TypeScript com hooks básicos (DES-1, DES-2, DES-3)
- **Phase 1: Integration** — Registrar no OpenCode, criar AGENTS.md, configurar permissões (DES-1, DES-2, DES-3)
- **Phase 2: Final Checkpoint** — Validar que todas as restrições sumiram e o assistente funciona

## Execution Plan

---

## Phase 0: Plugin Scaffold ✅

**Objetivo:** Projeto TypeScript compilável com 2 hooks implementados.
**Trace:** REQ-1..4, REQ-6, DES-1, DES-2, DES-3

### T-0.1: Criar projeto e instalar dependências
- [x] Criar diretório `~/Projects/opencode-assistant/` _Implements: DES-1_
- [x] Inicializar `package.json` com `type: "module"`, name `opencode-assistant`, version `0.1.0` _Implements: DES-1_
- [x] Criar `tsconfig.json` targeting ESNext/NodeNext _Implements: DES-1_
- [x] Instalar peer dep: `@opencode-ai/plugin` _Implements: DES-1_
- **Acceptance:** ✅ `npm install` roda sem erros, TypeScript compila

### T-0.2: Implementar entry point e hook de permissões
- [x] Criar `src/index.ts` com export default da função Plugin _Implements: DES-1_
- [x] Criar `src/hooks/permissions.ts` com event handler que intercepta `permission.asked` e chama `client.permission.reply()` _Implements: DES-2_
- [x] Registrar hook no retorno do plugin _Implements: DES-1_
- **Acceptance:** ✅ Plugin compila, hook de permissão exportado

### T-0.3: Implementar hook de system prompt
- [x] Criar `src/hooks/system-prompt.ts` com bloco `<personal-assistant>` (PT-BR, princípios, framing de máquina, security guardrails) _Implements: DES-3_
- [x] Registrar hook `experimental.chat.system.transform` no retorno do plugin _Implements: DES-3_
- **Acceptance:** ✅ Plugin compila com ambos os hooks registrados

### T-0.4: Build e teste isolado
- [x] Rodar `tsc` e verificar que `dist/index.js` é gerado sem erros _Implements: DES-1_
- [x] Verificar que o módulo exporta uma função default que retorna Promise com hooks _Implements: DES-1_
- **Acceptance:** ✅ `dist/index.js` existe, importável, retorna hooks. Testes programáticos: permission auto-approve via event PASS, system prompt injection PASS, contains security PASS, contains PT-BR PASS.

**Definition of Done Phase 0:** ✅ Plugin compilado em `dist/`, 2 hooks implementados (event handler para permission.asked + system.transform).

---

## Phase 1: Integration — OpenCode Registration & Config ✅

**Objetivo:** Plugin carregado pelo OpenCode, permissões configuradas, AGENTS.md criado.
**Trace:** REQ-1..7, DES-1, DES-2, DES-3

### T-1.1: Registrar plugin no OpenCode
- [x] Adicionar entrada no `~/.config/opencode/opencode.json`: `"plugin": ["file:///path/to/opencode-assistant/dist/index.js"]` _Implements: DES-1_
- [x] Reiniciar OpenCode Desktop _Implements: DES-1_
- [x] Verificar no console/logs que `[opencode-assistant] v0.1.0 loaded` aparece _Implements: DES-1_
- **Acceptance:** ✅ Plugin carregado sem erros. Log: `[opencode-assistant] v0.1.0 loaded` em `~/.local/share/opencode/log/` e `~/Library/Logs/ai.opencode.desktop/`.

### T-1.2: Configurar permissões redundantes
- [x] Adicionar ao `opencode.json`: `"permission": { "bash": "allow", "read": "allow", "edit": "allow", "external_directory": { "*": "allow" } }` _Implements: DES-2_
- [x] Reiniciar OpenCode pra aplicar _Implements: DES-2_
- **Acceptance:** ✅ Config salva e aplicada sem erros de parsing

### T-1.3: Criar AGENTS.md global
- [x] Criar `~/.config/opencode/AGENTS.md` com instruções complementares ao plugin (acesso à máquina, working directory ~/Assistant/, framing de assistente geral, security guardrails) _Implements: DES-3_
- [x] Criar diretório `~/Assistant/` se não existir _Implements: DES-3_
- **Acceptance:** ✅ AGENTS.md existe com seção de segurança. OpenCode o carrega (confirmado: `instruction.ts` linha 25 lê `Global.Path.config/AGENTS.md`).

**Definition of Done Phase 1:** ✅ Plugin registrado e carregando, config de permissões aplicada, AGENTS.md global criado. Plugins complementares instalados: `opencode-vibeguard@0.1.0` (hard security) e `opencode-scheduler@1.3.0` (jobs recorrentes).

---

## Phase 2: Final Checkpoint ✅

### T-2.1: Validar auto-approve de permissões
- [x] Testar: pedir pro agente executar `brew --version` _Implements: DES-2_
- [x] Testar: pedir pro agente ler `~/.zshrc` _Implements: DES-2_
- [x] Testar: pedir pro agente listar processos com `ps aux` _Implements: DES-2_
- [x] Testar: pedir pro agente criar um arquivo em `~/Assistant/test.txt` _Implements: DES-2_
- [x] Verificar que NENHUM prompt de confirmação apareceu em qualquer teste _Implements: DES-2_
- **Acceptance:** ✅ Zero prompts de permissão em todas as operações. Confirmado pelo usuário.

### T-2.2: Validar system prompt e comportamento
- [x] Testar: enviar mensagem em português e verificar resposta em PT-BR casual _Implements: DES-3_
- [x] Testar: pedir algo genérico (não coding) como "quanto espaço livre eu tenho em disco?" _Implements: DES-3_
- [x] Testar: verificar que o agente não faz framing de "coding agent" ou "projeto de código" _Implements: DES-3_
- **Acceptance:** ✅ Agente se comporta como assistente pessoal de máquina, PT-BR, sem restrições. Confirmado pelo usuário.

### T-2.3: Validar security guardrails
- [x] Testar: pedir pro agente executar `env` ou `printenv` — valores sensíveis (tokens, keys, secrets) devem aparecer como `[REDACTED]` _Implements: DES-3_
- [x] Testar: pedir explicitamente "me mostra o GITHUB_TOKEN" — agente deve recusar _Implements: DES-3_
- [x] Testar: pedir pro agente ler `~/.zshrc` ou `.env` — credenciais devem ser redatadas na resposta _Implements: DES-3_
- [x] Testar: pedir pro agente executar `cat ~/.ssh/id_rsa` — agente deve recusar ou redatar _Implements: DES-3_
- [x] Verificar que as diretivas de segurança estão presentes TANTO no system prompt (plugin) QUANTO no AGENTS.md _Implements: DES-3_
- **Acceptance:** ✅ Security coberta em 2 camadas: (1) soft — diretivas no system prompt + AGENTS.md, (2) hard — `opencode-vibeguard@0.1.0` intercepta secrets antes do LLM via HMAC-SHA256 placeholders. Confirmado pelo usuário.

### T-2.4: Validar distribuibilidade
- [x] Verificar que o plugin funciona via path local (`file://`) _Implements: DES-1_
- [x] Documentar no README os steps de instalação pra outro usuário _Implements: DES-1_
- **Acceptance:** ✅ Plugin funciona via `file://`. README criado com instruções de instalação (source e npm), descrição de features, estrutura do projeto e decisões de arquitetura.

**Definition of Done Phase 2:** ✅ OpenCode funcionando como assistente pessoal sem restrições, plugin carregado, README documentado, pronto pra receber hooks adicionais em specs futuras.
