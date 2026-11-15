# AGENTS.md

Instruções para qualquer agente de código (Claude Code, Codex, Cursor etc.) e para humanos.
Instruções específicas do Claude Code ficam no `CLAUDE.md`.

## O projeto

Rastreador de entregas por cliente. Cada cliente tem login próprio (criado pelos CEOs) e vê
só o andamento dos próprios projetos. Os 4 CEOs definem um fluxo de fases por projeto e só
eles fazem o fluxo andar, marcando a fase atual como concluída. São dois painéis: **CEO**
(`/api/v1/admin/*`, só CEO) e **cliente** (`/api/v1/portal/*`, cliente e CEO).

- **Fase atual:** 1 — backend + banco. Sem UI ainda.
- **Estado e próxima onda:** [`NOTES.md`](NOTES.md).
- **Comportamento:** [`docs/specs/client-delivery-tracking.md`](docs/specs/client-delivery-tracking.md).
- **Segurança:** [`docs/specs/security-baseline.md`](docs/specs/security-baseline.md).
- **Contrato:** [`contracts/openapi.v1.yaml`](contracts/openapi.v1.yaml).
- **Plano:** [`docs/plan/implementation-waves.md`](docs/plan/implementation-waves.md).

## Stack

Next.js 16+ (App Router, Route Handlers, `proxy.ts`) · TypeScript strict · Supabase (Postgres 17,
Auth, RLS, CLI, pgTAP) · `@supabase/ssr` + `supabase-js` (sem ORM) · Zod · pino · Vitest ·
Vercel (`gru1`) · Tailwind v4 (fase 2). Node 24. Racional: [ADR-0001](docs/adr/0001-stack.md).

## Comandos

Os comandos abaixo são criados na Onda 0. Até lá, o repositório só tem documentação.

| Comando | O que faz |
|---|---|
| `npm run dev` | Next.js local (`http://localhost:3000`) |
| `npx supabase start` / `stop` | Supabase local em Docker |
| `npx supabase db reset` | Recria o banco local (migrations + `seed.sql`) |
| `npm run lint` | ESLint + Prettier check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes de unidade (Vitest) |
| `npm run test:integration` | Integração contra o Supabase local |
| `npm run test:security` | Suíte SEC-xx (`tests/security`) |
| `npm run db:test` | pgTAP (`supabase test db`) |
| `npm run db:lint` | `supabase db lint` |
| `npm run db:types` | Regenera `src/shared/infrastructure/supabase/database.types.ts` |
| `npm run contract:lint` | Redocly lint do OpenAPI |
| `npm run build` | Build de produção |
| `npm run verify` | Todos os gates acima em sequência. Precisa estar verde antes de qualquer PR. |

## Arquitetura e pastas

Monolito modular + Vertical Slice + DDD. As dependências apontam para dentro
(`presentation → application → domain`); `domain` não importa nada de fora.

```
src/
├── proxy.ts                         # request id, refresh de sessão, checagem de Origin. NUNCA autoriza.
├── app/api/v1/**/route.ts           # só re-exporta o handler do módulo (zero lógica)
├── modules/
│   ├── identity/                    # sessão, perfis, provisionamento de usuários
│   ├── clients/                     # clientes (tenants)
│   ├── tracking/                    # projetos, fluxo/fases, portal, notas, templates
│   └── audit/                       # consulta de eventos de auditoria
│       ├── domain/                  # entidades, VOs, invariantes, erros, portas (TS puro)
│       ├── features/<caso-de-uso>/  # 1 pasta por caso de uso (vertical slice):
│       │     <slice>.schema.ts      #   Zod de params/query/body (.strict())
│       │     <slice>.handler.ts     #   adaptador HTTP fino: guard → validação → use case → resposta
│       │     <slice>.use-case.ts    #   aplicação: orquestra domínio + portas
│       │     <slice>.use-case.test.ts
│       ├── infrastructure/          # repositórios Supabase (implementam as portas do domain)
│       └── index.ts                 # API pública do módulo: único import permitido de fora
└── shared/
    ├── domain/                      # Result, DomainError base, tipos utilitários
    ├── http/                        # problem+json, wrapper de rota, guards, request id, limites
    └── infrastructure/              # env (Zod), logger (pino), supabase/{server,admin}-client, rate-limit
supabase/
├── config.toml                      # versionado e endurecido (signup off etc.)
├── migrations/                      # IMUTÁVEIS depois do merge — corrija com uma migration nova
├── seed.sql                         # só dados fictícios, só local
└── tests/*.test.sql                 # pgTAP: RLS, grants, funções
tests/
├── integration/<area>/              # handlers reais contra o Supabase local
└── security/                        # SEC-01..SEC-15
contracts/openapi.v1.yaml            # API-first: muda ANTES do código
docs/{specs,plan,adr,tutorials,how-to,reference,explanation}/
scripts/                             # bootstrap-ceo.ts, smoke.ts, perf.ts (operacionais)
```

Regras de fronteira:
- Um módulo **não** importa internals de outro, só o `index.ts` dele.
- Route Handler não tem lógica. Use case não monta resposta HTTP. Repositório não tem regra de negócio.
- Mutação multi-linha do fluxo = função Postgres `tracking_*` via `.rpc()` ([ADR-0003](docs/adr/0003-flow-commands-in-postgres.md)).

## Workflow obrigatório

1. **Spec primeiro.** Nada de código sem a seção correspondente na spec. Mudou o comportamento?
   Atualize a spec no mesmo PR.
2. **Contrato antes do handler.** Endpoint novo ou alterado → `contracts/openapi.v1.yaml` primeiro.
   Mudança incompatível = nova versão.
3. **Uma onda = uma branch = um PR** (`feat/wave-<n>-<slug>`), squash merge, Conventional Commits.
4. **Decisão arquitetural → ADR** em `docs/adr/` (formato Nygard, numeração sequencial).
5. **Superfície de ataque nova** (rota, tabela, função, integração) → atualize o threat model em
   `security-baseline.md`.
6. **Fim de sessão:** atualize o `NOTES.md` (status da onda, log de sessão, armadilhas novas).

## Regras de segurança inegociáveis

1. **Deny by default.** Toda rota exige sessão. Exceções públicas (`/auth/login`, `/health`) estão
   declaradas no contrato com `security: []`.
2. **Ordem fixa no handler:** rate limit → auth (`auth.getUser()`, nunca `getSession()`) →
   gate de troca de senha → authz por papel → validação Zod `.strict()` → use case.
3. **O tenant vem da sessão.** Nunca aceite `clientId` do cliente para escolher o tenant no portal.
   Recurso de outro tenant → **404**.
4. **Toda tabela em `public` tem RLS `enable` + `force`**, policies explícitas e grants mínimos
   (`revoke all` primeiro). Tabela nova sem teste cross-tenant não entra.
5. **Dado interno nunca em tabela legível pelo cliente**: use uma tabela só de CEO ([ADR-0002](docs/adr/0002-tenant-isolation.md)).
6. **SQL injection:**
   - Nada de SQL montado por string.
   - Nada de input interpolado em `.or()`, `.filter()`, `.not()` ou `.textSearch()`: use
     `.eq/.in/.ilike` com valor validado.
   - Ordenação só por allowlist.
   - PL/pgSQL sem `EXECUTE` dinâmico; toda função com `set search_path = ''`.
7. **`security definer`:** `set search_path = ''`, `perform private.assert_ceo()` (ou checagem
   equivalente) na 1ª linha, `revoke execute … from public, anon` e teste pgTAP de authz.
8. **Secret key do Supabase:** só em `src/shared/infrastructure/supabase/admin-client.ts` (com
   `import 'server-only'`) e no `env.ts`. Nunca `NEXT_PUBLIC_`. Nunca no browser.
9. **O navegador nunca fala com o Supabase.** Cookies de sessão `HttpOnly; Secure; SameSite=Lax`.
10. **Erros:** `application/problem+json` com `code` do catálogo e `requestId`. Nunca stack, SQL
    ou mensagem do Postgres para o cliente.
11. **Logs:** pino JSON com `requestId`. Sem PII (e-mail, nome, senha, token, IP em claro). Sem
    `console.log` em `src/`.
12. **Auditoria:** toda mutação gera `audit_events` (na mesma transação, quando é função Postgres).
13. **Segredos:** nunca no código nem em docs. `.env.local` fora do git; `.env.example` só com placeholders.
14. **Migrations aplicadas são imutáveis.** Corrija com uma migration nova.
15. **Dependência nova** exige justificativa no PR e versão exata.

## Convenções de código

- Código, identificadores e comentários em **inglês**. Docs e mensagens de commit podem ser em pt-BR.
- TypeScript strict + `noUncheckedIndexedAccess`. `any` só com comentário justificando.
- Nomes de arquivo em kebab-case. Uma feature = uma pasta. Testes ao lado do código
  (`*.test.ts`), exceto integração e segurança (`tests/`).
- JSON da API em camelCase; colunas do banco em snake_case. O mapeamento fica no repositório.
- Erros de domínio são classes com `code` do catálogo da spec §9.2.
- Conventional Commits: `feat(tracking): …`, `fix(identity): …`, `test(db): …`, `docs(spec): …`.

## Testes

- Pirâmide: muito unitário (`domain` e `use-case` são obrigatórios), integração média, E2E na fase 2.
- Todo critério de aceite da spec vira um teste nomeado `RF-xx.CAy`. Todo SEC-xx tem um teste.
- Determinístico: sem `sleep`, sem rede externa. O Supabase local roda em Docker.
- Bug fix começa por um teste que reproduz o bug.

## Definition of Done (por onda)

- [ ] Critérios de aceite da onda verdes (Goal command) e `npm run verify` verde.
- [ ] Spec, contrato e ADRs coerentes com o código.
- [ ] Testes cross-tenant para toda tabela e endpoint novos.
- [ ] Sem segredos, sem PII em logs, sem `console.log`.
- [ ] `NOTES.md` e `docs/plan/implementation-waves.md` atualizados (status ✅).
