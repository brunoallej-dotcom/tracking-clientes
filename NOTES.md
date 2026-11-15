# NOTES — estado vivo do projeto

> Memória de trabalho entre sessões (humanos e agents). Atualize a cada fim de sessão.
> A fonte da verdade do roadmap é [`docs/plan/implementation-waves.md`](docs/plan/implementation-waves.md);
> a tabela abaixo espelha a coluna Status de lá — as duas nunca podem divergir.

## Current status

- **Fase:** 1 — backend + banco de dados (frontend é a fase 2).
- **Onda atual:** **Onda 0 — Fundação concluída ✅**. Próxima: **Onda 1 — Banco: núcleo multi-tenant + RLS**.
- **Pronto antes da Onda 0 (2026-11-15):** spec, security-baseline, ADRs 0001–0004, contrato
  OpenAPI v1 e configuração do Claude Code (`.claude/`, `.mcp.json`).

| Onda | Entrega | Depende de | Paralela com | Status |
|------|---------|------------|--------------|--------|
| 0 | Fundação | — | — | ✅ |
| 1 | Banco — núcleo multi-tenant + RLS | 0 | — | ⬜ |
| 2 | Banco — auditoria e funções técnicas | 1 | — | ⬜ |
| 3 | Identity (login, sessão, guards, rate limit, bootstrap CEO) | 2 | — | ⬜ |
| 4 | Admin — clientes e logins | 3 | 5, 6, 7 | ⬜ |
| 5 | Projetos — agregado e ciclo de vida | 3 | 4 | ⬜ |
| 6 | Fluxo — montar fases | 5 | 4, 9 | ⬜ |
| 7 | Fluxo — avançar (concluir/reabrir) | 6 | 4, 9 | ⬜ |
| 8 | Painel do cliente (portal) | 7 | 9, 10, 11 | ⬜ |
| 9 | Notas internas + auditoria | 5 | 6, 7, 8, 10 | ⬜ |
| 10 | Templates de fluxo (opcional) | 7 | 8, 9, 11 | ⬜ |
| 11 | Ambientes e deploy | 4, 7 | 8, 10 | ⬜ |
| 12 | Hardening final | 8, 9, 11 (+10 se feita) | — | ⬜ |

Legenda: ⬜ não iniciada · 🟡 em andamento · ✅ concluída.

## Decisões

| ADR | Decisão | Status |
|---|---|---|
| [0001](docs/adr/0001-stack.md) | Next.js 16 + Supabase + Vercel; sem ORM; sem backend separado | accepted |
| [0002](docs/adr/0002-tenant-isolation.md) | Isolamento multi-tenant: RLS forçada + tabelas por audiência + browser sem Supabase | accepted |
| [0003](docs/adr/0003-flow-commands-in-postgres.md) | Comandos do fluxo como funções Postgres + dupla checagem no domínio TS | accepted |
| [0004](docs/adr/0004-rate-limiting.md) | Rate limiting em Postgres + Vercel Firewall | **proposed** |

## Questões em aberto (aguardando o dono do produto)

Detalhes e decisões assumidas em [spec §11](docs/specs/client-delivery-tracking.md#11-questões-em-aberto-e-decisões-assumidas).
As que mais mudam o plano:

- **Q3 — MFA TOTP obrigatório para CEOs?** Recomendado. Se aprovado, entra na Onda 12.
- **Q10 — Rate limit em Postgres (ADR-0004) ou Upstash Redis?** Assumido Postgres.
- **Q9 — Retenção da auditoria (5 anos?)** Validar com o jurídico.
- **Q11 — Painel CEO em subdomínio separado?** Assumido mesmo domínio na v1.

## Ambiente e armadilhas conhecidas

- **Pré-requisitos locais:** Node 24 (via nvm), Docker (para `npx supabase start`). A Supabase CLI
  entra como devDependency na Onda 0 (`npx supabase …`); não precisa de instalação global.
- **`.env.local` já existe** e não foi lido pelo Claude (há um guardrail de segredos). Confira se os
  nomes das variáveis batem com o [`.env.example`](.env.example). As variáveis do Supabase são
  **server-only**, sem prefixo `NEXT_PUBLIC_` (ADR-0002).
- **`venv/` (Python) na raiz:** não faz parte da stack. Está no `.gitignore`; pode ser removido
  se não for usado por nenhuma ferramenta local.
- **Hooks do Claude Code** em `.claude/hooks/` usam `node`. Se o `node` não estiver no `PATH` do
  shell que abre o Claude Code, os hooks não rodam: abra o terminal com o nvm carregado.
- **MCP `supabase-staging`:** exige `SUPABASE_STAGING_PROJECT_REF` exportada no shell e vem
  desabilitado em `.claude/settings.local.json`. Nunca aponte para produção.

## Log de sessões

- **2026-11-15** — Bootstrap da documentação e da configuração:
  - Spec funcional, security-baseline (STRIDE + OWASP Top 10:2025 + SQLi + LGPD), ADRs 0001–0004,
    contrato OpenAPI v1 (35 operações, validado por script estrutural offline) e plano de 13 ondas.
  - `.claude/` com agents, skills e hooks; `settings.json`, `settings.local.json` e `.mcp.json`.
  - Estrutura corrigida: `.mcp.json` movido de `.claude/` para a raiz; `hooks/` e `skills/`
    estavam aninhados em `.claude/agents/`.
  - O lint do contrato com Redocly fica para `npm run contract:lint` (Onda 0).

- **2026-11-15** — Onda 0 na branch `feat/wave-0`:
  - Next.js 16.4.6, Node 24, TypeScript strict, ESLint/Prettier, Vitest e scripts canônicos.
  - Health público, headers, Origin no proxy e wrapper, renovação server-only, problem+json,
    limite de 16 KiB por stream, env Zod e pino com redação.
  - Supabase CLI 3.1.0 e Postgres 17 locais iniciados com config endurecido; pgTAP e tipos gerados.
  - `npm run verify` verde: 14 unitários, 1 integração, 12 segurança e 2 pgTAP.
    Smoke HTTP de produção verde. `npm ci` e `npm audit` sem vulnerabilidades.
  - Gitleaks histórico, Semgrep (290 regras), OSV e actionlint sem achados. Revisões de contrato
    e OWASP aprovadas. Redocly válido, com três avisos prévios (localhost e required em not).
  - CI com Actions por SHA, scanners por versão/checksum, token somente leitura e Dependabot.
    Resultado remoto só pode ser confirmado após push/PR; nenhum push foi feito.
  - Contrato 1.0.1 explicita ativação do rate limit do health na Onda 3, depois da função da Onda 2.
  - Arquivo de configuração npm criado manualmente pelo usuário; `npm config get` confirmou
    `save-exact=true` e `engine-strict=true`. Onda fechada ✅ após nova execução de todos os
    gates (`npm run verify`), smoke HTTP e npm audit sem vulnerabilidades.
    A inclusão desse arquivo no stage foi feita pelo usuário, devido ao bloqueio do hook.

### Armadilhas da fundação

- CLI Supabase 3 usa alvo local por padrão e removeu `--local` de `db lint` e `gen types`.
- O seed fica desativado até a Onda 1 criar dados fictícios.
- `db:types` formata com Prettier antes de gravar, para regeneração sem diff de whitespace.
- ESLint 9.39.5 respeita peers dos plugins Next; override minimatch 11.0.8 elimina o advisory
  do parser TypeScript. Os binários gitleaks/OSV são verificados por SHA-256 no instalador.
