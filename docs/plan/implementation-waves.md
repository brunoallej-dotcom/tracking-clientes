# Implementation waves — Rastreamento de entregas por cliente (fase 1: backend + banco)

> Spec de origem: [`docs/specs/client-delivery-tracking.md`](../specs/client-delivery-tracking.md)
> (+ [`security-baseline.md`](../specs/security-baseline.md), contrato
> [`contracts/openapi.v1.yaml`](../../contracts/openapi.v1.yaml), cujo `x-wave` aponta para estas ondas).
> Este arquivo é a fonte da verdade do roadmap de ondas; a tabela do NOTES.md espelha a coluna Status.
>
> Legenda: ⬜ não iniciada · 🟡 em andamento · ✅ concluída (fechada com a skill `verify`).

| Onda | Entrega | Depende de | Paralela com | Status |
|------|---------|------------|--------------|--------|
| 0 | Fundação: scaffold Next.js + tooling, kit HTTP, `proxy.ts`, headers, CI DevSecOps, `config.toml` endurecido, `GET /health` | — | — | ✅ |
| 1 | Banco — núcleo multi-tenant: `clients`, `profiles`, `projects`, `project_stages`, helpers de RLS, policies, grants, trigger de auth, seed, pgTAP | 0 | — | ⬜ |
| 2 | Banco — auditoria e funções técnicas: `audit_events`, `project_internal_notes`, rate limit, `admin_*`, pgTAP | 1 | — | ⬜ |
| 3 | Identity: login, logout, `/me`, troca de senha, pipeline de guards, rate limiter, bootstrap de CEO | 2 | — | ⬜ |
| 4 | Admin — clientes e logins de clientes (RF-10..15) | 3 | 5, 6, 7 | ⬜ |
| 5 | Projetos — agregado `Project` e ciclo de vida (RF-20..23) | 3 | 4 | ⬜ |
| 6 | Fluxo — montar as fases: adicionar, editar, remover, reordenar (RF-24) | 5 | 4, 9 | ⬜ |
| 7 | Fluxo — avançar: concluir e reabrir fase, conclusão automática (RF-25..27) | 6 | 4, 9 | ⬜ |
| 8 | Painel do cliente — read model do portal (RF-30..31) | 7 | 9, 10, 11 | ⬜ |
| 9 | Notas internas + consulta de auditoria (RF-40..41) | 5 | 6, 7, 8, 10 | ⬜ |
| 10 | Templates de fluxo — **opcional** (RF-50..51) | 7 | 8, 9, 11 | ⬜ |
| 11 | Ambientes e deploy: staging/prod, pipeline de migrations, smoke test | 4, 7 | 8, 10 | ⬜ |
| 12 | Hardening final: suíte SEC consolidada, MFA de CEO (se aprovado), alertas, runbooks, LGPD, performance | 8, 9, 11 (+10 se feita) | — | ⬜ |

**Já entregue antes da Onda 0 (2026-11-15):** a spec, o security-baseline, os ADRs 0001–0004,
o contrato OpenAPI v1 e a configuração do Claude Code (`.claude/`). A Onda 0 parte deles.

**Comandos canônicos** (criados na Onda 0, usados em todos os critérios de aceite):
`npm run lint`, `npm run typecheck`, `npm test` (unidade), `npm run test:integration`,
`npm run test:security`, `npm run db:test` (pgTAP), `npm run db:lint`, `npm run db:types`,
`npm run contract:lint`, `npm run build` e `npm run verify` (todos em sequência).

---

## Onda 0 — Fundação

**Validação local (2026-11-15):** `npm run verify`, smoke HTTP de produção, npm audit,
gitleaks, Semgrep, OSV e actionlint verdes. Revisões de contrato e OWASP aprovadas.
Arquivo de configuração npm criado pelo usuário e confirmado com `npm config get`
(`save-exact=true`, `engine-strict=true`); gates completos e smoke reexecutados com exit 0.
**Onda concluída ✅.** A CI remota será confirmada no primeiro push/PR; nenhum push nesta sessão.

- **Objetivo**: ter um projeto Next.js executável, com tooling, CI DevSecOps, kit HTTP seguro e o primeiro endpoint público.
- **Escopo (slices/arquivos)**:
  - Config do projeto: `package.json` (scripts canônicos, versões exatas), `.npmrc` (`save-exact=true`),
    `tsconfig.json` (strict + `noUncheckedIndexedAccess`), ESLint + Prettier, `vitest.config.ts` e
    `vitest.integration.config.ts`.
  - `next.config.ts` (headers da security-baseline §8, `poweredByHeader: false`) e `src/proxy.ts`
    (request id, refresh de sessão, checagem de `Origin`).
  - `src/shared/http/**` (problem+json, wrapper de rota com a ordem fixa da spec §6.3, limite de
    corpo, mapeador de erros) e `src/shared/infrastructure/{env,logger}.ts` (Zod + pino com redação).
  - `src/app/api/v1/health/route.ts`. A porta de rate limit fica pronta nesta onda; o adapter
    Postgres e a quota de 60/min/IP do health são conectados na Onda 3, após a função da Onda 2
    (`x-rate-limit-wave: 3` no contrato). Até lá, segue a política fail-open de E27.
  - `supabase/config.toml` (`supabase init` + signup off, JWT 900 s, rotação de refresh,
    senha ≥ 12, `api.schemas = ["public"]`).
  - CI e qualidade: `.github/workflows/ci.yml` (Actions pinadas por SHA, `permissions: contents: read`,
    gitleaks, Semgrep, `npm audit`, osv-scanner, grep da secret key), `.github/dependabot.yml`,
    `redocly.yaml`.
  - `docs/how-to/local-setup.md`.
- **Depende de / paralela com**: — / — (fundação, sempre sequencial).
- **Critérios de aceite**:
  - `npm run lint && npm run typecheck && npm test && npm run contract:lint && npm run build` terminam com exit 0.
  - `tests/security/foundation.test.ts` passa:
    - SEC-08: `GET /api/v1/health` → `200 {"status":"ok"}` com todos os headers da §8, `X-Request-Id` e sem `X-Powered-By`.
    - SEC-09: mutação com `Origin` estranho ou ausente → `403 ORIGIN_NOT_ALLOWED`.
    - SEC-11: erro inesperado → `500` problem+json sem stack; JSON inválido → `400`.
  - `npx supabase start` sobe com o `config.toml` versionado.
  - O workflow `ci.yml` existe e roda todos os passos (verde no primeiro PR).
- **Goal command**: `/goal npm run lint && npm run typecheck && npm test && npm run contract:lint && npm run build terminam com exit 0 e npm run test:security -- tests/security/foundation.test.ts passa com SEC-08, SEC-09 e SEC-11, stop after 8 tries`

## Onda 1 — Banco: núcleo multi-tenant

- **Objetivo**: criar o schema do núcleo com isolamento por RLS provado por testes antes de qualquer endpoint.
- **Escopo (slices/arquivos)**:
  - `supabase/migrations/<ts>_core_schema.sql`: enums, `clients`, `profiles`, `projects`, `project_stages`,
    schema `private` com `auth_role`/`is_ceo`/`auth_client_id`/`assert_ceo`, RLS `enable` + `force`,
    policies, `revoke`/grants por coluna, `set_updated_at` e `handle_new_user`.
  - `supabase/seed.sql` (só local).
  - `supabase/tests/001_core_rls.test.sql` e `002_handle_new_user.test.sql`.
  - `src/shared/infrastructure/supabase/database.types.ts` (gerado).
- **Depende de / paralela com**: 0 (Supabase CLI e scripts) / — (migration base; tudo depois depende dela).
- **Critérios de aceite**:
  - `npx supabase db reset` aplica as migrations e o seed sem erro.
  - `npm run db:test` verde, cobrindo:
    - SEC-03: `anon` sem acesso a nenhuma tabela.
    - Cliente A não lê nada do cliente B; cliente não lê `draft`/`archived`.
    - SEC-02: cliente sem INSERT/UPDATE/DELETE.
    - CEO lê tudo; usuário inativo, cliente inativo e usuário sem perfil sem acesso.
    - `handle_new_user` rejeita papel inválido, cliente inexistente ou inativo e combinação papel/cliente inconsistente.
  - `npm run db:lint` sem erros; `npm run db:types` atualiza os tipos sem diff pendente.
- **Goal command**: `/goal npx supabase db reset && npm run db:test && npm run db:lint terminam com exit 0, com 001_core_rls.test.sql cobrindo clients, profiles, projects e project_stages para anon, cliente A, cliente B, CEO, usuário inativo e usuário sem perfil, stop after 10 tries`

## Onda 2 — Banco: auditoria e funções técnicas

- **Objetivo**: deixar prontas no banco a trilha de auditoria append-only, as notas internas e as funções técnicas que a Identity e o Admin usam.
- **Escopo (slices/arquivos)**:
  - `supabase/migrations/<ts>_audit_and_ops.sql`:
    - `audit_events` + trigger append-only + `audit_row_change` (em `clients`, `projects`, notas).
    - `project_internal_notes` + RLS.
    - `private.rate_limit_counters` + `rate_limit_hit`.
    - `admin_revoke_user_sessions` e `admin_record_audit_event` (grants só para `service_role`).
  - `supabase/tests/003_audit.test.sql` e `004_ops_functions.test.sql`; tipos regenerados.
- **Depende de / paralela com**: 1 (FKs e helpers) / — (migration; ondas com migration nunca são paralelas entre si).
- **Critérios de aceite**:
  - `npm run db:test` verde, cobrindo:
    - SEC-14 (banco): UPDATE/DELETE em `audit_events` rejeitados.
    - Cliente não lê notas nem auditoria; CEO só insere nota com o próprio `author_id`.
    - `rate_limit_hit` bloqueia no limite e libera na janela seguinte.
    - Funções `admin_*` e `rate_limit_hit` não executáveis por `anon`/`authenticated`.
    - Os triggers gravam `actor_id` e `request_id`.
- **Goal command**: `/goal npx supabase db reset && npm run db:test && npm run db:lint terminam com exit 0, incluindo 003_audit.test.sql e 004_ops_functions.test.sql verdes, stop after 8 tries`

## Onda 3 — Identity

- **Objetivo**: login, sessão e o pipeline completo de guards (auth → gate de senha → authz) que todas as rotas usam.
- **Escopo (slices/arquivos)**:
  - `src/modules/identity/**`: domínio `Profile` e política de senha; features `login`, `logout`,
    `get-me` e `change-password`.
  - `src/shared/http/guards/**` e `src/shared/infrastructure/supabase/{server-client,admin-client}.ts`
    (`admin-client` com `server-only`).
  - `src/shared/infrastructure/rate-limit/**` (porta + adapter Postgres, ADR-0004).
  - Rotas: `src/app/api/v1/{auth/login,auth/logout,auth/password,me}/route.ts`.
  - `scripts/bootstrap-ceo.ts`.
  - Testes: `tests/integration/identity/**` e `tests/security/auth.test.ts`.
- **Depende de / paralela com**: 2 (`rate_limit_hit`, `admin_revoke_user_sessions`, auditoria) / — (define as interfaces compartilhadas dos guards).
- **Critérios de aceite**:
  - Testes `RF-01.CA1..CA4`, `RF-02`, `RF-03`, `RF-04.CA1..CA3` e `RF-05` verdes.
  - SEC-07: 429 com `Retry-After`.
  - SEC-10: flags do cookie; o logout revoga o refresh; usuário desativado → 401 imediato.
  - SEC-13: política de senha; e-mail e senha ausentes dos logs capturados.
  - SEC-15: `signUp` falha.
  - O gate `PASSWORD_CHANGE_REQUIRED` vale em toda rota, exceto `/me`, `/auth/password` e `/auth/logout`.
  - `npm run verify` verde.
- **Goal command**: `/goal npm test -- src/modules/identity && npm run test:integration -- tests/integration/identity && npm run test:security -- tests/security/auth.test.ts passam cobrindo RF-01..RF-05, SEC-07, SEC-10, SEC-13 e SEC-15, e npm run verify termina com exit 0, stop after 10 tries`

## Onda 4 — Admin: clientes e logins de clientes

- **Objetivo**: os CEOs cadastram clientes e criam, editam, desativam e resetam os logins deles.
- **Escopo (slices/arquivos)**:
  - `src/modules/clients/**`.
  - `src/modules/identity/features/{provision-client-user,update-client-user,reset-client-user-password}/**`.
  - Rotas: `src/app/api/v1/admin/{clients,users}/**`.
  - Testes: `tests/integration/admin-clients/**` e `tests/security/admin-clients.test.ts`.
  - **Sem migration**: tudo o que ela precisa no banco foi entregue nas Ondas 1–2.
- **Depende de / paralela com**: 3 (guards, admin client) / 5, 6, 7.
  Toca só `identity`/`clients` e rotas `admin/{clients,users}`, sem migration nem tipos
  regenerados; as Ondas 5–7 tocam só `tracking`, as migrations dele e as rotas `admin/projects`.
  Se precisar mudar o banco, vira sequencial.
- **Critérios de aceite**:
  - Testes `RF-10..RF-15` (todos os CA) verdes.
  - SEC-01: cliente → 403 em todas as rotas; IDs inexistentes ou de CEO → 404.
  - SEC-04: corpus em `name` e `fullName`.
  - SEC-06: `role`, `clientId` e `isActive` extras onde não cabem → 400.
  - SEC-13: `temporaryPassword` ausente dos logs.
  - SEC-14: um evento de auditoria por mutação.
- **Goal command**: `/goal npm run test:integration -- tests/integration/admin-clients && npm run test:security -- tests/security/admin-clients.test.ts passam cobrindo RF-10..RF-15 e SEC-01, SEC-04, SEC-06, SEC-13 e SEC-14, e npm run verify termina com exit 0, stop after 10 tries`

## Onda 5 — Projetos: agregado e ciclo de vida

- **Objetivo**: criar o agregado `Project` com as invariantes I1–I7 e os endpoints de projeto, incluindo publicar, arquivar e desarquivar.
- **Escopo (slices/arquivos)**:
  - `src/modules/tracking/domain/**`: `Project`, `Stage`, invariantes, `deriveStageState`, erros de domínio.
  - Features `create-project` (sem `templateId`), `list-projects`, `get-project`, `update-project` e
    `transition-project`; repositório Supabase + mapeador de erros Postgres → domínio.
  - `supabase/migrations/<ts>_tracking_project_functions.sql` (`tracking_create_project`,
    `tracking_transition_project`) + `005_tracking_project.test.sql`.
  - Rotas: `src/app/api/v1/admin/projects/**` (raiz, `[projectId]`, `publish`, `archive`, `unarchive`).
- **Depende de / paralela com**: 3 (guards) / 4 (arquivos disjuntos, ver Onda 4).
- **Critérios de aceite**:
  - Testes `RF-20` (sem template), `RF-21`, `RF-22` e `RF-23` verdes.
  - Testes de unidade das invariantes e da máquina de estados (tabela da spec §6.2).
  - pgTAP: cliente chamando `tracking_*` → `42501`; transições inválidas → `P0001` com o código certo.
  - SEC-01, SEC-04, SEC-05 (`status` fora do enum → 400), SEC-06 e SEC-14.
- **Goal command**: `/goal npm test -- src/modules/tracking && npm run db:test && npm run test:integration -- tests/integration/projects passam cobrindo RF-20..RF-23, e npm run verify termina com exit 0, stop after 12 tries`

## Onda 6 — Fluxo: montar as fases

- **Objetivo**: os CEOs montam e ajustam o fluxo de cada projeto (adicionar, editar, remover e reordenar fases) respeitando o prefixo imutável.
- **Escopo (slices/arquivos)**:
  - Métodos de domínio `addStage`, `updateStage`, `removeStage` e `reorderStages`.
  - Features `add-stage`, `update-stage`, `remove-stage` e `reorder-stages`.
  - `supabase/migrations/<ts>_tracking_stage_edit_functions.sql` + `006_tracking_stage_edit.test.sql`.
  - Rotas: `src/app/api/v1/admin/projects/[projectId]/stages/**` (raiz, `order` e `[stageId]` PATCH/DELETE).
- **Depende de / paralela com**: 5 (agregado e repositório) / 4, 9.
  Com a 9: a Onda 9 não altera `tracking/domain` nem migrations, só lê projetos.
- **Critérios de aceite**:
  - Testes `RF-24` e dos edge cases E4–E11 e E30 verdes em unidade **e** pgTAP (mesma tabela de casos).
  - Reordenar com um conjunto inválido → 400.
  - SEC-01, SEC-04, SEC-06 e SEC-14.
- **Goal command**: `/goal npm test -- src/modules/tracking && npm run db:test && npm run test:integration -- tests/integration/stages passam cobrindo RF-24 e E4..E11 e E30, e npm run verify termina com exit 0, stop after 12 tries`

## Onda 7 — Fluxo: avançar

- **Objetivo**: o fluxo anda só quando um CEO conclui a fase atual, com reabertura auditada e conclusão automática do projeto.
- **Escopo (slices/arquivos)**:
  - Métodos de domínio `completeStage` e `reopenStage`.
  - Features `complete-stage` e `reopen-stage`.
  - `supabase/migrations/<ts>_tracking_stage_progress_functions.sql` + `007_tracking_stage_progress.test.sql`.
  - Rotas `…/stages/[stageId]/{complete,reopen}`.
  - Teste de concorrência (duas conclusões simultâneas).
- **Depende de / paralela com**: 6 (mesmo agregado e padrão de função) / 4, 9.
- **Critérios de aceite**:
  - `RF-25.CA1..CA4`, `RF-26` e `RF-27` verdes.
  - E1: com duas requisições concorrentes, exatamente um 200 e um 409 `STAGE_ALREADY_COMPLETED`.
  - E2, E3, E8 e E33 verdes.
  - `AdminStage.completedBy` preenchido a partir da auditoria.
- **Goal command**: `/goal npm run db:test && npm run test:integration -- tests/integration/stage-progress passam cobrindo RF-25..RF-27 e E1, E2, E3, E8 e E33 (teste de concorrência com exatamente um 200 e um 409), e npm run verify termina com exit 0, stop after 12 tries`

## Onda 8 — Painel do cliente

- **Objetivo**: o cliente (e o CEO, como preview) vê o rastreamento dos projetos, sem nenhum campo interno.
- **Escopo (slices/arquivos)**:
  - Features `list-portal-projects` e `get-portal-project` (read model + mapper com allowlist).
  - Rotas: `src/app/api/v1/portal/**`.
  - Testes: `tests/integration/portal/**` e `tests/security/portal.test.ts`.
- **Depende de / paralela com**: 7 (a semântica completa de `current`/`completed`) / 9, 10, 11.
  Só lê o domínio, sem migration; 10 e 11 tocam arquivos disjuntos.
- **Critérios de aceite**:
  - `RF-30` e `RF-31.CA1..CA3` verdes.
  - Teste de snapshot: as chaves do DTO do portal são exatamente as do schema `PortalProjectDetail`.
  - SEC-01: matriz cross-tenant do portal (cliente A × projetos de B, `draft` e `archived` → 404).
  - SEC-05.
  - Respostas validadas contra o OpenAPI.
- **Goal command**: `/goal npm run test:integration -- tests/integration/portal && npm run test:security -- tests/security/portal.test.ts passam cobrindo RF-30, RF-31.CA1..CA3 e o snapshot de chaves do DTO, e npm run verify termina com exit 0, stop after 8 tries`

## Onda 9 — Notas internas + consulta de auditoria

- **Objetivo**: os CEOs registram notas internas e consultam quem fez o quê.
- **Escopo (slices/arquivos)**:
  - Features `list-internal-notes` e `create-internal-note` (tracking) e `list-audit-events` (`src/modules/audit/**`).
  - Rotas: `src/app/api/v1/admin/projects/[projectId]/notes/**` e `src/app/api/v1/admin/audit-events/**`.
  - Testes de integração e segurança.
- **Depende de / paralela com**: 5 (projetos existem) / 6, 7, 8, 10.
  As tabelas vêm da Onda 2; a Onda 9 não altera domínio, migrations nem tipos.
- **Critérios de aceite**:
  - `RF-40` e `RF-41` verdes.
  - Cliente → 403; `stageId` de outro projeto → 404.
  - Paginação por cursor estável (sem duplicatas nem buracos).
  - SEC-01, SEC-04 e SEC-06.
- **Goal command**: `/goal npm run test:integration -- tests/integration/notes-audit passa cobrindo RF-40, RF-41 e a paginação por cursor, e npm run verify termina com exit 0, stop after 8 tries`

## Onda 10 — Templates de fluxo (opcional)

- **Objetivo**: os CEOs criam projetos mais rápido a partir de modelos de fluxo.
- **Escopo (slices/arquivos)**:
  - `supabase/migrations/<ts>_flow_templates.sql` + `008_flow_templates.test.sql`; tipos regenerados.
  - Features do CRUD de templates e `templateId` em `create-project` (snapshot).
  - Rotas: `src/app/api/v1/admin/flow-templates/**`.
- **Depende de / paralela com**: 7 (fecha as migrations de tracking) / 8, 9, 11.
  É a única onda desse grupo com migration e com tipos regenerados; 8 e 9 não tocam `create-project`.
- **Critérios de aceite**:
  - `RF-50` e `RF-51` verdes; editar o template não altera projetos existentes.
  - RLS de templates: cliente sem acesso.
  - `TEMPLATE_NAME_TAKEN`.
- **Goal command**: `/goal npm run db:test && npm run test:integration -- tests/integration/templates passam cobrindo RF-50, RF-51 e o snapshot de fases, e npm run verify termina com exit 0, stop after 8 tries`

## Onda 11 — Ambientes e deploy

- **Objetivo**: staging e produção reproduzíveis, com migrations aplicadas só pelo CI e um smoke test ponta a ponta.
- **Escopo (slices/arquivos)**:
  - Projetos Supabase de staging e produção (`sa-east-1`) e projeto Vercel (`gru1`, envs por ambiente;
    Preview → staging).
  - `vercel.json` (regions).
  - `.github/workflows/deploy.yml`: `supabase db push` em staging no merge para `main`; produção com
    aprovação manual via GitHub Environment; nunca `--include-seed`.
  - `supabase config push`.
  - `scripts/smoke.ts`, `docs/how-to/deploy.md` e `docs/how-to/bootstrap-ceo.md`.
- **Depende de / paralela com**: 4 e 7 (o smoke cobre login → admin → fluxo) / 8, 10.
  Toca só infraestrutura, workflow e docs, disjuntos do código das 8 e 10.
- **Critérios de aceite**:
  - `deploy.yml` verde em `main`.
  - `npx tsx scripts/smoke.ts --env staging` com exit 0: health 200, login de CEO, criar cliente,
    criar e publicar projeto, concluir fase e o cliente ver o portal.
  - A env de Preview aponta para o project ref de staging (checado pelo script).
- **Goal command**: `/goal o workflow deploy.yml termina verde em main e npx tsx scripts/smoke.ts --env staging termina com exit 0, stop after 6 tries`

## Onda 12 — Hardening final

- **Objetivo**: fechar a fase 1 com a suíte de segurança completa, a observabilidade com alertas e a operação documentada.
- **Escopo (slices/arquivos)**:
  - `tests/security/**` consolidado: SEC-01 com a matriz de todos os endpoints e SEC-04 com o corpus
    em todos os campos.
  - MFA TOTP para CEOs, **se a Q3 for aprovada**: contrato 1.1.0 (minor, compatível), policies `aal2`.
  - Alertas via log drain.
  - Runbooks em `docs/how-to/`: rotação de chaves, offboarding de cliente, exclusão LGPD.
  - Texto do aviso de privacidade.
  - Revisão do agent `threat-modeler`; `scripts/perf.ts`.
- **Depende de / paralela com**: 8, 9, 11 (+10 se feita) / — (consolida tudo).
- **Critérios de aceite**:
  - `npm run verify && npm run test:security` verdes.
  - A skill `security-scan` reporta 0 achados high ou critical.
  - `npx tsx scripts/perf.ts --env staging` reporta p95 < 300 ms nas leituras do portal e < 500 ms nas mutações (RNF-03).
  - Os runbooks existem e estão linkados no `docs/README.md`.
- **Goal command**: `/goal npm run verify && npm run test:security terminam com exit 0, a skill security-scan reporta 0 achados high/critical e npx tsx scripts/perf.ts --env staging reporta p95 portal < 300ms e mutações < 500ms, stop after 10 tries`

---

## Notas de execução

- Ondas sequenciais rodam na sessão principal, uma branch/PR por onda (`feat/wave-<n>-<slug>`,
  squash merge, Conventional Commits).
- Uma onda sequencial pode rodar como um **goal loop**: invoque o Goal command dela e deixe o
  avaliador manter a sessão presa aos critérios de aceite, em vez de confiar em "parece pronto".
  Feche a onda com a skill `verify` antes de marcá-la como ✅.
- Grupos paralelos (ex.: 4 ∥ 5, 8 ∥ 9 ∥ 10 ∥ 11) podem rodar como subagents em worktrees
  isoladas, uma onda por agent, com os resultados mergeados um PR por vez. Antes de mergear o
  segundo, rode `npm run db:types` e `npm run verify` em cima da `main` atualizada.
- **Regra de migrations:** duas ondas com migration nunca rodam em paralelo (ordem de timestamp
  e `database.types.ts` compartilhado).
- Toda onda que cria tabela, função ou endpoint usa as skills do projeto: `new-migration`,
  `new-endpoint` e `tenant-isolation-test`. Antes do PR, peça revisão aos agents `rls-auditor`
  (se tocou SQL), `api-contract-guardian` (se tocou rotas) e `owasp-reviewer`.
- Quando uma onda terminar, marque-a como ✅ aqui E no NOTES.md, e então atualize o status atual
  do NOTES.md antes de encerrar a sessão.
- **Fase 2 (fora deste plano):** frontend dos dois painéis (React + Tailwind) consumindo o
  contrato v1, com E2E em Playwright. Será planejada com uma spec própria.
