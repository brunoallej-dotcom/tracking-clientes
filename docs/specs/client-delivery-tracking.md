# Spec — Rastreamento de entregas por cliente

> **Status:** Draft v1 · **Data:** 2026-11-15 · **Fase:** backend + banco de dados
> **Contrato:** [`contracts/openapi.v1.yaml`](../../contracts/openapi.v1.yaml) ·
> **Segurança:** [`security-baseline.md`](security-baseline.md) ·
> **Plano:** [`docs/plan/implementation-waves.md`](../plan/implementation-waves.md)
>
> Esta spec é a fonte da verdade do comportamento. O contrato OpenAPI é a fonte da verdade
> das formas (paths, payloads, códigos). Divergência entre os dois é bug — corrija os dois no mesmo PR.

---

## 1. Visão geral

### 1.1 Problema

A empresa entrega projetos sob medida para clientes, e o cliente não tem visibilidade da fase
em que a entrega está. O produto é um rastreador no estilo "rastreio de encomenda": cada
cliente acessa o domínio com login próprio (criado pela empresa) e vê só o andamento dos
seus projetos. Os 4 CEOs configuram o fluxo de entrega de cada projeto e avançam as fases.

### 1.2 Objetivos

1. O cliente entra no domínio com a conta já criada e vê a linha do tempo de cada projeto seu.
2. Os CEOs definem um **fluxo de entrega personalizado por projeto** (fases ordenadas).
3. O fluxo **só avança quando um CEO marca a fase atual como concluída**.
4. **Isolamento total entre clientes**: um cliente nunca vê dados de outro.
5. Segurança como requisito de primeira classe: OWASP Top 10:2025, SQL injection, LGPD.

### 1.3 Escopo desta fase

API REST (Next.js Route Handlers) + banco (Supabase Postgres com RLS), com testes. O frontend
dos dois painéis fica para a fase 2 e consome este contrato.

### 1.4 Fora de escopo (v1)

- Interface dos painéis (fase 2).
- Auto-cadastro, login social, "esqueci minha senha" self-service (o reset é feito por um CEO).
- Notificações (e-mail/WhatsApp) quando uma fase avança.
- Anexos, comentários do cliente, chat.
- Atualização em tempo real (Supabase Realtime): na v1 basta recarregar.
- Multi-idioma, cobrança, financeiro.

---

## 2. Linguagem ubíqua

| Termo (pt-BR) | No código | Definição |
|---|---|---|
| Cliente | `Client` | Empresa ou pessoa atendida. É o **tenant**, a unidade de isolamento de dados. |
| Usuário do cliente | perfil com `role = client` | Login vinculado a exatamente um cliente. Um cliente pode ter N usuários. |
| CEO | perfil com `role = ceo` | Sócio com acesso total ao painel administrativo. Não pertence a nenhum cliente. |
| Projeto | `Project` | Entrega contratada por um cliente, com fluxo próprio. Um cliente pode ter N projetos. |
| Fluxo de entrega | `DeliveryFlow` | Lista ordenada de fases de um projeto. |
| Fase | `Stage` | Passo do fluxo (ex.: "Briefing", "Protótipo", "Desenvolvimento", "Entrega"). |
| Fase atual | `currentStage` | Primeira fase não concluída de um projeto `active`. Derivada, nunca armazenada. |
| Concluir fase | `completeStage` | Ação de um CEO que marca a fase atual como feita e faz o fluxo andar. |
| Reabrir fase | `reopenStage` | Ação de um CEO que desfaz a conclusão da última fase concluída, com justificativa. |
| Publicar projeto | `publish` | Passa o projeto de `draft` para `active` e o torna visível ao cliente. |
| Painel CEO | `admin` (`/api/v1/admin/*`) | Superfície exclusiva dos CEOs. O cliente não acessa. |
| Painel do cliente | `portal` (`/api/v1/portal/*`) | Visão de rastreamento. Acessível ao cliente (só os seus projetos) e aos CEOs (todos). |
| Nota interna | `InternalNote` | Anotação dos CEOs sobre um projeto ou fase. Nunca visível ao cliente. |
| Evento de auditoria | `AuditEvent` | Registro imutável de quem fez o quê e quando. |
| Template de fluxo | `FlowTemplate` | Modelo reutilizável de fases (opcional, Onda 10). |

---

## 3. Atores e permissões

| Capacidade | CEO | Usuário do cliente | Anônimo |
|---|---|---|---|
| Login, logout, trocar a própria senha | ✅ | ✅ | só login |
| Ver os próprios dados (`GET /me`) | ✅ | ✅ | ❌ |
| Painel do cliente: listar e ver projetos | ✅ todos (preview) | ✅ só do seu cliente, `active`/`completed` | ❌ |
| Gerenciar clientes e logins de clientes | ✅ | ❌ | ❌ |
| Criar e editar projetos e fluxos | ✅ | ❌ | ❌ |
| Concluir ou reabrir fase | ✅ | ❌ | ❌ |
| Notas internas, auditoria, templates | ✅ | ❌ | ❌ |
| Criar contas de CEO | ❌ pela API (só script operacional, RF-05) | ❌ | ❌ |

Regras transversais:

- **Deny by default.** Toda rota exige sessão, exceto `POST /auth/login` e `GET /health`,
  declaradas no contrato com `security: []`.
- **O tenant vem da credencial.** O `client_id` do usuário do cliente é lido do perfil no
  servidor. Nenhum endpoint do portal aceita `clientId` como parâmetro.
- **Recurso fora do escopo do usuário responde 404, nunca 403**, para não revelar que existe.
- **Troca de senha obrigatória.** Enquanto `mustChangePassword = true`, só `GET /me`,
  `POST /auth/password` e `POST /auth/logout` respondem; o resto retorna
  `403 PASSWORD_CHANGE_REQUIRED`.

---

## 4. Requisitos funcionais

Formato: **RF-xx — título (Onda N)**, seguido dos critérios de aceite (**CA**). Cada CA vira
um teste nomeado `RF-xx.CAy`.

### 4.1 Identidade e acesso — contexto `identity`

**RF-01 — Login com e-mail e senha (Onda 3).** `POST /auth/login { email, password }`.
- CA1: credenciais válidas de usuário ativo → `200` com `Me` e cookies de sessão
  `HttpOnly; Secure; SameSite=Lax`.
- CA2: e-mail inexistente, senha errada, usuário inativo ou cliente inativo → **a mesma**
  resposta `401 INVALID_CREDENTIALS`, sem distinguir o motivo.
- CA3: na 6ª tentativa falha em 15 min para o mesmo par (IP, e-mail), ou na 21ª para o mesmo
  IP → `429 RATE_LIMITED` com `Retry-After`.
- CA4: o sucesso grava a auditoria `auth.login_succeeded`. A falha gera o log estruturado
  `auth.login_failed`, sem e-mail nem senha.

**RF-02 — Logout (Onda 3).** `POST /auth/logout` revoga a sessão atual (refresh token) e limpa
os cookies. CA: sem sessão também responde `204` (idempotente).

**RF-03 — Dados do usuário logado (Onda 3).** `GET /me` →
`{ id, fullName, role, client: { id, name } | null, mustChangePassword }`.
CA: CEO recebe `client = null`; usuário do cliente recebe o próprio cliente.

**RF-04 — Trocar a própria senha (Onda 3).** `POST /auth/password { currentPassword, newPassword }`.
- CA1: senha atual errada → `401 INVALID_CREDENTIALS`. A 6ª tentativa em 15 min por usuário → `429`.
- CA2: `newPassword` com menos de 12 ou mais de 128 caracteres, igual à atual ou presente na
  lista de senhas comuns → `400 VALIDATION_FAILED`.
- CA3: o sucesso zera `mustChangePassword`, revoga as outras sessões do usuário, grava a
  auditoria `auth.password_changed` e responde `204`.

**RF-05 — Bootstrap de CEO (Onda 3).** O script operacional `scripts/bootstrap-ceo.ts` é
executado localmente por quem tem a secret key. Ele cria um CEO com senha temporária forte,
exibida uma única vez, e `mustChangePassword = true`. Não existe endpoint para criar CEO.

### 4.2 Clientes e logins — contextos `clients` + `identity` (painel CEO)

**RF-10 — Cadastrar cliente (Onda 4).** `POST /admin/clients { name }` → `201`.
CA: o nome tem 2–120 caracteres após o trim; nome repetido (sem diferenciar maiúsculas) →
`409 CLIENT_NAME_TAKEN`.

**RF-11 — Listar e detalhar clientes (Onda 4).** `GET /admin/clients` (paginado, filtro
`status=active|inactive`) e `GET /admin/clients/{clientId}` com os usuários e o resumo dos projetos.

**RF-12 — Editar e desativar cliente (Onda 4).** `PATCH /admin/clients/{clientId} { name?, isActive? }`.
- CA1: desativar faz todos os usuários do cliente perderem acesso **na hora** (RLS), revoga
  as sessões e bloqueia o login (ban no Supabase Auth).
- CA2: reativar remove o ban dos usuários que estão ativos.
- CA3: grava a auditoria `client.updated`, `client.deactivated` ou `client.reactivated`.

**RF-13 — Criar login de usuário do cliente (Onda 4).**
`POST /admin/clients/{clientId}/users { email, fullName, temporaryPassword? }`.
- Sem `temporaryPassword`, o servidor gera uma senha aleatória (≥ 20 caracteres) e a devolve
  **uma única vez** na resposta. Ela nunca é logada nem guardada em texto puro.
- CA1: o usuário nasce com `role = client`, `client_id` igual ao cliente da rota,
  `mustChangePassword = true` e e-mail confirmado.
- CA2: e-mail já cadastrado → `409 EMAIL_ALREADY_REGISTERED`; cliente inativo → `409 CLIENT_INACTIVE`.
- CA3: a criação do usuário de auth e do perfil é atômica (trigger em `auth.users`): se uma
  falhar, a outra é desfeita.
- CA4: grava a auditoria `user.created`.

**RF-14 — Editar e desativar usuário do cliente (Onda 4).**
`PATCH /admin/users/{userId} { fullName?, isActive? }`. Atua só sobre usuários `client`;
se o alvo for CEO → `404`. Desativar = ban + sessões revogadas + bloqueio imediato pela RLS.

**RF-15 — Resetar senha de usuário do cliente (Onda 4).**
`POST /admin/users/{userId}/password-reset { temporaryPassword? }` define a senha temporária,
liga `mustChangePassword`, revoga as sessões e grava a auditoria `user.password_reset`.

### 4.3 Projetos e fluxo de entrega — contexto `tracking` (painel CEO)

**RF-20 — Criar projeto (Onda 5; `templateId` na Onda 10).**
`POST /admin/projects { clientId, name, description?, stages? | templateId? }` → `201` em `draft`.
CA: no máximo 50 fases; `stages` e `templateId` juntos → `400`; cliente inativo →
`409 CLIENT_INACTIVE`; o projeto e as fases são criados atomicamente.

**RF-21 — Listar e detalhar projetos (Onda 5).** `GET /admin/projects?clientId&status` e
`GET /admin/projects/{projectId}` com as fases, o estado derivado de cada uma e quem concluiu.

**RF-22 — Editar dados do projeto (Onda 5).** `PATCH /admin/projects/{projectId} { name?, description? }`.
Projeto `archived` → `409 PROJECT_ARCHIVED`.

**RF-23 — Ciclo de vida do projeto (Onda 5).** Ações explícitas:
- `POST …/publish`: `draft → active`. Exige ≥ 1 fase (`409 PROJECT_HAS_NO_STAGES`) e
  preenche `startedAt`.
- `POST …/archive`: `active | completed → archived`.
- `POST …/unarchive`: `archived → active`, ou `completed` se todas as fases estiverem concluídas.
- Transição inválida → `409 INVALID_STATUS_TRANSITION`. `active → completed` acontece sozinha
  (RF-27); `completed → active` acontece sozinha ao reabrir ou adicionar uma fase.

**RF-24 — Montar o fluxo (Onda 6).**
- Adicionar: `POST …/stages { title, description?, expectedDate?, position? }` (padrão: no fim).
- Editar texto ou previsão: `PATCH …/stages/{stageId}`.
- Remover: `DELETE …/stages/{stageId}`.
- Reordenar: `PUT …/stages/order { stageIds[] }`, com a lista completa.
- Valem as invariantes da §6.2: as fases concluídas formam um prefixo imutável (não saem do
  lugar, não podem ser removidas e nenhuma fase nova entra antes delas). O texto de uma fase
  concluída pode ser corrigido, e a correção é auditada.

**RF-25 — Concluir a fase atual (Onda 7).** `POST …/stages/{stageId}/complete`.
- CA1: exige CEO ativo, projeto `active` e que o alvo seja **a fase atual**. Caso contrário →
  `409 STAGE_NOT_CURRENT`, `409 STAGE_ALREADY_COMPLETED` ou `409 PROJECT_NOT_ACTIVE`.
- CA2: se dois CEOs concluírem a mesma fase ao mesmo tempo, exatamente um tem sucesso; o outro
  recebe `409 STAGE_ALREADY_COMPLETED` (lock pessimista na linha do projeto).
- CA3: grava `completedAt` e a auditoria `stage.completed` com o CEO autor na mesma transação.
- CA4: concluir a última fase leva o projeto a `completed` e grava `project.completed`.

**RF-26 — Reabrir fase (Onda 7).** `POST …/stages/{stageId}/reopen { reason }`.
CA: só vale para a última fase concluída (`409 NOT_LAST_COMPLETED_STAGE`); projeto `completed`
volta a `active`; `reason` (3–500 caracteres) fica só na auditoria, que é interna.

**RF-27 — Conclusão automática (Onda 7).** Um projeto `active` passa a `completed` quando todas as fases
estão concluídas: ao concluir a última ou ao remover a única fase pendente que restava.

### 4.4 Painel do cliente — contexto `tracking`, read model `portal`

**RF-30 — Listar meus projetos (Onda 8).** `GET /portal/projects` → resumo com progresso
(`completed/total`) e fase atual. Usuário do cliente: só os projetos do seu cliente com status
`active` ou `completed`. CEO: todos os projetos (preview).

**RF-31 — Ver o rastreamento do projeto (Onda 8).** `GET /portal/projects/{projectId}` → linha do
tempo com cada fase em `completed | current | upcoming`, `completedAt`, `expectedDate`, título e descrição.
- CA1: para usuário do cliente, projeto de outro cliente, `draft` ou `archived` → `404 NOT_FOUND`.
- CA2: o DTO do portal **nunca** contém notas internas, autor da conclusão, motivo de
  reabertura, dados de outros clientes ou e-mails. Isso é garantido por allowlist de campos
  e coberto por um teste de snapshot das chaves.
- CA3: o CEO recebe exatamente o DTO que o cliente veria ("painel do cliente visto pelo CEO").

### 4.5 Colaboração interna e auditoria — painel CEO

**RF-40 — Notas internas (Onda 9).** `GET/POST /admin/projects/{projectId}/notes { body, stageId? }`.
As notas são imutáveis na v1 (sem editar nem apagar) e nunca chegam ao cliente, porque moram
em tabela separada com RLS só para CEO.

**RF-41 — Consultar a auditoria (Onda 9).** `GET /admin/audit-events?projectId&clientId&actorId&action`,
paginado por cursor, mais recentes primeiro. Os eventos são append-only: nem CEO edita ou apaga.

### 4.6 Templates de fluxo — opcional (Onda 10)

**RF-50 — CRUD de templates.** `GET/POST /admin/flow-templates` e
`GET/PATCH/DELETE /admin/flow-templates/{templateId}`.

**RF-51 — Criar projeto a partir de template.** O `templateId` do RF-20 copia as fases como
snapshot: editar o template depois não altera projetos existentes.

---

## 5. Requisitos não funcionais

| ID | Requisito | Meta / verificação |
|---|---|---|
| RNF-01 | Segurança | Todos os controles de [`security-baseline.md`](security-baseline.md): OWASP Top 10:2025, SQLi, STRIDE. |
| RNF-02 | Isolamento multi-tenant | Duas barreiras independentes: checagem no use case e RLS no Postgres. Teste cross-tenant obrigatório para toda tabela e todo endpoint. |
| RNF-03 | Performance | p95 < 300 ms nas leituras do portal e < 500 ms nas mutações, com até 50 fases por projeto (medido em staging). |
| RNF-04 | Disponibilidade | Herdada de Vercel + Supabase, sem SLA próprio na v1. `GET /health` serve para monitoramento. |
| RNF-05 | Observabilidade | Logs JSON (pino) com `requestId`, `userId`, `role`, rota, status e latência, sem PII. Auditoria de toda mutação. |
| RNF-06 | LGPD | Minimização (só nome e e-mail), base legal de execução de contrato, retenção e exclusão definidas (security-baseline §13). |
| RNF-07 | Localização dos dados | Supabase em `sa-east-1` (São Paulo) e funções Vercel em `gru1`. |
| RNF-08 | Contrato | Implementação aderente a `contracts/openapi.v1.yaml`. Mudança de contrato = bump de versão + nota de compatibilidade. |
| RNF-09 | Qualidade | TypeScript strict, sem `any` sem justificativa. Lint, typecheck, testes e scans verdes no CI antes do merge. |
| RNF-10 | Mensagens | O `code` de erro é estável e em inglês (para máquina); os textos em pt-BR para humanos ficam no frontend. |

---

## 6. Design técnico

### 6.1 Arquitetura

Monolito modular em Next.js (App Router). Os Route Handlers são a única API: **o navegador
nunca fala direto com o Supabase.**

```
Navegador ──HTTPS──▶ Vercel (Next.js, região gru1)
                      proxy.ts    → request id, refresh de sessão, checagem de Origin (sem authz)
                      route.ts    → só re-exporta o handler do módulo
                      handler     → rate limit → auth → gate de senha → authz → validação Zod → use case
                      use case    → regras de domínio (TS puro) → porta de repositório
                      repositório → supabase-js com o JWT do usuário ──▶ PostgREST ──▶ Postgres (RLS)
                                  → admin client (secret key) só para Auth Admin e funções admin_*
```

Bounded contexts em `src/modules/*`: `identity` (sessão, perfis, provisionamento), `clients`
(tenants), `tracking` (projetos, fluxo, portal, notas, templates) e `audit` (consulta de
eventos). Um módulo só fala com outro pelo `index.ts` público. O layout de pastas está no `AGENTS.md`.

Decisões: [ADR-0001](../adr/0001-stack.md) (stack), [ADR-0002](../adr/0002-tenant-isolation.md)
(isolamento), [ADR-0003](../adr/0003-flow-commands-in-postgres.md) (comandos do fluxo em funções
Postgres), [ADR-0004](../adr/0004-rate-limiting.md) (rate limiting).

### 6.2 Regras de domínio — agregado `Project`

`Project` é a raiz de agregação; `Stage` só muda através dele.

| # | Invariante |
|---|---|
| I1 | As posições das fases são contíguas `1..N`, com N ≤ 50. |
| I2 | As fases concluídas formam um **prefixo**: se a fase na posição `p` está concluída, todas as anteriores também estão. |
| I3 | A fase atual é a primeira não concluída, e só existe se o projeto está `active`. |
| I4 | Só a fase atual pode ser concluída; só a última concluída pode ser reaberta. |
| I5 | Fase concluída não é removida nem muda de posição; fase nova entra sempre depois da última concluída. |
| I6 | Projeto fora de `draft` tem sempre ≥ 1 fase (`409 PROJECT_REQUIRES_STAGE` ao remover a última). |
| I7 | Projeto `archived` é somente leitura, exceto pelo `unarchive`. |

Máquina de estados do projeto:

```
draft ──publish──▶ active ──(última fase concluída)──▶ completed
                    ▲   │                                 │
                    │   └──archive──▶ archived ◀──archive──┘
                    └──(reabrir ou adicionar fase)── completed
archived ──unarchive──▶ active | completed   (derivado das fases)
```

Estado derivado da fase, usado nos DTOs: `completed` se `completedAt` estiver preenchido;
`current` se for a primeira não concluída e o projeto estiver `active`; senão `upcoming`.

**Dupla checagem (ADR-0003).** O domínio em TypeScript valida as invariantes antes da chamada,
o que dá erros rápidos e testáveis em unidade. A função Postgres correspondente revalida tudo
dentro de uma transação com `SELECT … FOR UPDATE` na linha do projeto e é a autoridade final
contra condições de corrida.

### 6.3 Pipeline de requisição (ordem fixa)

1. **`proxy.ts`**: gera ou propaga `X-Request-Id`, renova a sessão Supabase e, nos métodos
   `POST/PUT/PATCH/DELETE`, exige `Origin` igual a `APP_URL` (senão `403 ORIGIN_NOT_ALLOWED`).
   **Não faz autorização**: autorização só no proxy é contornável (ref. CVE-2025-29927).
2. **Rate limit**: por IP nas rotas públicas e por usuário nas autenticadas (ADR-0004).
3. **Auth**: `supabase.auth.getUser()` valida o JWT no servidor de Auth (nunca usar
   `getSession()` para decidir acesso), e o perfil e o cliente precisam estar ativos.
   Senão → `401 UNAUTHENTICATED`.
4. **Gate de troca de senha** → `403 PASSWORD_CHANGE_REQUIRED`.
5. **Authz**: papel exigido pela rota (`ceo` em `/admin/*`; `ceo | client` em `/portal/*`) →
   `403 FORBIDDEN`. Recurso de outro tenant → `404` (decidido no use case e reforçado pela RLS).
6. **Validação**: `Content-Type: application/json` (senão `415`), corpo ≤ 16 KB (senão `413`) e
   Zod `.strict()` em params, query e body. Chave desconhecida é rejeitada com `400 VALIDATION_FAILED`.
7. **Use case** → repositório (RLS como segunda barreira) → resposta. Erros saem como
   `application/problem+json` (RFC 9457) com `code` e `requestId`, sem detalhes internos.

### 6.4 Acesso a dados

| Cliente Supabase | Credencial | Onde mora | Uso |
|---|---|---|---|
| `createUserClient()` | publishable key + JWT do usuário (cookie) | qualquer repositório | Leituras e escritas comuns; a RLS se aplica. |
| `createAdminClient()` | secret key | `src/shared/infrastructure/supabase/admin-client.ts` (com `import 'server-only'`) | **Somente** Auth Admin API (criar e banir usuário, resetar senha) e funções `admin_*` / `rate_limit_hit`, sempre depois da authz no use case. |

Regras:
- Nada de SQL montado por concatenação ou interpolação de string.
- Toda escrita multi-linha do fluxo é uma função Postgres chamada via `.rpc()` com parâmetros tipados.
- Filtro PostgREST nunca recebe input interpolado (security-baseline §4).
- O `X-Request-Id` vai para o PostgREST como header, e as funções e triggers o gravam em
  `audit_events.request_id` via `current_setting('request.headers', true)`.

### 6.5 Sessão

- Supabase Auth com e-mail e senha, **signup desabilitado** (`enable_signup = false`).
- Cookies do `@supabase/ssr` com `HttpOnly; Secure; SameSite=Lax; Path=/`. Isso só é possível
  porque o navegador não usa o Supabase diretamente.
- JWT de acesso com expiração de 15 min e refresh token rotativo.
- Desativação de usuário = ban no Auth + exclusão das sessões + RLS checando `is_active` em
  toda query. O efeito é imediato mesmo com um JWT ainda válido.

---

## 7. Modelo de dados

Dois schemas:
- `public`: exposto ao PostgREST. Toda tabela tem RLS **habilitada e forçada**
  (`enable` + `force row level security`).
- `private`: não exposto. Guarda as funções auxiliares de RLS e as tabelas técnicas.

### 7.1 Tabelas (Ondas 1–2; templates na Onda 10)

```sql
create type public.app_role       as enum ('ceo', 'client');
create type public.project_status as enum ('draft', 'active', 'completed', 'archived');

-- Tenants
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index clients_name_ci_key on public.clients (lower(name));

-- 1:1 com auth.users. Criado pelo trigger private.handle_new_user() a partir de
-- raw_app_meta_data (role, client_id, full_name), que só a secret key consegue escrever.
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  role                  public.app_role not null,
  client_id             uuid references public.clients (id) on delete restrict,
  full_name             text not null check (char_length(full_name) between 2 and 120),
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_role_client_chk check (
    (role = 'ceo' and client_id is null) or (role = 'client' and client_id is not null)
  )
);
create index profiles_client_id_idx on public.profiles (client_id);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete restrict,
  name          text not null check (char_length(name) between 2 and 120),
  description   text check (char_length(description) <= 2000),
  status        public.project_status not null default 'draft',
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index projects_client_status_idx on public.projects (client_id, status);

-- Só colunas publicáveis ao cliente (ADR-0002: dado interno mora em outra tabela).
-- Quem concluiu a fase fica em audit_events, que é só para CEO.
create table public.project_stages (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  position       integer not null check (position between 1 and 50),
  title          text not null check (char_length(title) between 2 and 120),
  description    text check (char_length(description) <= 2000),
  expected_date  date,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint project_stages_position_key unique (project_id, position) deferrable initially deferred
);

-- Interno (só CEO)
create table public.project_internal_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  stage_id    uuid references public.project_stages (id) on delete set null,
  author_id   uuid not null default auth.uid() references public.profiles (id),
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index project_internal_notes_project_idx on public.project_internal_notes (project_id, created_at desc);

-- Append-only. Sem FKs de propósito: o evento é um snapshot e não pode ser alterado por cascata.
create table public.audit_events (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,                      -- profiles.id; null = sistema
  action       text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type  text not null,
  entity_id    uuid,
  client_id    uuid,
  project_id   uuid,
  metadata     jsonb not null default '{}'::jsonb,   -- nunca PII
  request_id   text
);
create index audit_events_project_idx on public.audit_events (project_id, id desc);
create index audit_events_client_idx  on public.audit_events (client_id, id desc);
create index audit_events_actor_idx   on public.audit_events (actor_id, id desc);

-- Técnica (ADR-0004). key = HMAC-SHA256(RATE_LIMIT_PEPPER, escopo || identificador): nunca IP em claro.
create table private.rate_limit_counters (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (key, window_start)
);

-- Onda 10 (opcional)
create table public.flow_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index flow_templates_name_ci_key on public.flow_templates (lower(name));

create table public.flow_template_stages (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.flow_templates (id) on delete cascade,
  position     integer not null check (position between 1 and 50),
  title        text not null check (char_length(title) between 2 and 120),
  description  text check (char_length(description) <= 2000),
  constraint flow_template_stages_position_key unique (template_id, position) deferrable initially deferred
);
```

Triggers:
- `set_updated_at`: before update em todas as tabelas que têm `updated_at`.
- `private.handle_new_user()`: after insert em `auth.users`. Cria o perfil a partir de
  `raw_app_meta_data` e valida papel, cliente existente e ativo e `full_name`. Se algo for
  inválido, lança exceção e a criação do usuário é desfeita.
- `private.audit_row_change()`: after insert/update em `clients`, `projects` (nome e descrição)
  e `project_internal_notes`. Grava `audit_events` com `actor_id = auth.uid()`.
- `audit_events_append_only`: before update/delete em `audit_events` → exceção.

### 7.2 Funções auxiliares de RLS (schema `private`)

Todas são `security definer`, `stable` e `set search_path = ''`:

| Função | Retorno |
|---|---|
| `private.auth_role()` | Papel do perfil de `auth.uid()` se o perfil estiver ativo e (for CEO ou o cliente estiver ativo); senão `null`. |
| `private.is_ceo()` | `private.auth_role() = 'ceo'`. |
| `private.auth_client_id()` | `client_id` do usuário do cliente ativo; senão `null`. |
| `private.assert_ceo()` | Lança `42501 FORBIDDEN` se o chamador não for CEO ativo. É a primeira linha de toda função `tracking_*`. |

Nas policies, chame sempre envolvendo em subselect, por exemplo `(select private.is_ceo())`,
para o planner avaliar uma vez por query.

### 7.3 Matriz de RLS e privilégios

Base: `revoke all` em tabelas e funções de `public` para `anon`, `authenticated` e `public`,
inclusive nos default privileges. Depois disso, só os grants abaixo são concedidos.

| Tabela | `anon` | Usuário do cliente | CEO | Escrita |
|---|---|---|---|---|
| `clients` | nada | SELECT da própria linha | SELECT de todas | CEO: INSERT `(name)` e UPDATE `(name, is_active)`. Sem DELETE. |
| `profiles` | nada | SELECT da própria linha | SELECT de todas | Nenhuma pela API de dados: só o trigger de auth e o admin client. |
| `projects` | nada | SELECT se `client_id = auth_client_id()` e `status in ('active','completed')` | SELECT de todas | CEO: UPDATE `(name, description)`. Criação e status só via funções. |
| `project_stages` | nada | SELECT se o projeto pai for visível ao cliente | SELECT de todas | Nenhuma direta: só funções `tracking_*`. |
| `project_internal_notes` | nada | nada | SELECT de todas | CEO: INSERT `(project_id, stage_id, body)` com `author_id = auth.uid()`. Sem UPDATE/DELETE. |
| `audit_events` | nada | nada | SELECT de todas | Só funções `security definer`, triggers e admin client. |
| `flow_templates`, `flow_template_stages` | nada | nada | SELECT de todas | CEO: CRUD (Onda 10). |
| `private.*` | sem `usage` no schema | — | — | — |

### 7.4 Funções de comando (RPC)

Todas `security definer`, `set search_path = ''`, com `revoke execute … from public, anon`
e grant explícito. Cada uma grava a própria auditoria na mesma transação.

| Função | Grant | Onda | Auditoria |
|---|---|---|---|
| `tracking_create_project(p_client_id, p_name, p_description, p_stages jsonb) → uuid` | authenticated (CEO checado) | 5 | `project.created` |
| `tracking_add_stage(p_project_id, p_title, p_description, p_expected_date, p_position) → uuid` | authenticated | 6 | `stage.added` |
| `tracking_update_stage(p_stage_id, p_title, p_description, p_expected_date)` | authenticated | 6 | `stage.updated` |
| `tracking_remove_stage(p_stage_id)` | authenticated | 6 | `stage.removed` |
| `tracking_reorder_stages(p_project_id, p_stage_ids uuid[])` | authenticated | 6 | `stage.reordered` |
| `tracking_complete_stage(p_stage_id)` | authenticated | 7 | `stage.completed` (+ `project.completed`) |
| `tracking_reopen_stage(p_stage_id, p_reason)` | authenticated | 7 | `stage.reopened` |
| `tracking_transition_project(p_project_id, p_action)` (`publish`, `archive`, `unarchive`) | authenticated | 5 | `project.published`, `project.archived`, `project.unarchived` |
| `admin_revoke_user_sessions(p_user_id)` | **service_role** | 2 | (o use case audita) |
| `admin_record_audit_event(...)` | **service_role** | 2 | — |
| `rate_limit_hit(p_key, p_limit, p_window_seconds) → (allowed, retry_after_seconds)` | **service_role** | 2 | — |

`tracking_update_stage` recebe o estado completo: o use case mescla o patch com o estado atual
antes de chamar. Erros saem com `raise exception using errcode = 'P0001', message = '<CODE>'`
(o `<CODE>` é do catálogo da §9.2); falta de permissão sai com `errcode = '42501', message = 'FORBIDDEN'`.
A camada de infraestrutura traduz esses erros para erros de domínio.

### 7.5 Seed local

`supabase/seed.sql` só roda localmente (`supabase db reset`). Ele cria 2 clientes fictícios,
1 CEO e 1 usuário por cliente, além de projetos em vários estados. As senhas do seed valem
apenas para o banco local. O pipeline **nunca** usa `--include-seed`.

---

## 8. Contrato de API (resumo)

A fonte da verdade é [`contracts/openapi.v1.yaml`](../../contracts/openapi.v1.yaml). Base: `/api/v1`.

| Método | Path | Papel | Onda | RF |
|---|---|---|---|---|
| GET | `/health` | público | 0 | — |
| POST | `/auth/login` | público | 3 | RF-01 |
| POST | `/auth/logout` | sessão | 3 | RF-02 |
| POST | `/auth/password` | sessão | 3 | RF-04 |
| GET | `/me` | sessão | 3 | RF-03 |
| GET | `/admin/clients` · POST `/admin/clients` | ceo | 4 | RF-10, RF-11 |
| GET · PATCH | `/admin/clients/{clientId}` | ceo | 4 | RF-11, RF-12 |
| POST | `/admin/clients/{clientId}/users` | ceo | 4 | RF-13 |
| PATCH | `/admin/users/{userId}` | ceo | 4 | RF-14 |
| POST | `/admin/users/{userId}/password-reset` | ceo | 4 | RF-15 |
| GET · POST | `/admin/projects` | ceo | 5 | RF-20, RF-21 |
| GET · PATCH | `/admin/projects/{projectId}` | ceo | 5 | RF-21, RF-22 |
| POST | `/admin/projects/{projectId}/publish` · `/archive` · `/unarchive` | ceo | 5 | RF-23 |
| POST | `/admin/projects/{projectId}/stages` | ceo | 6 | RF-24 |
| PUT | `/admin/projects/{projectId}/stages/order` | ceo | 6 | RF-24 |
| PATCH · DELETE | `/admin/projects/{projectId}/stages/{stageId}` | ceo | 6 | RF-24 |
| POST | `/admin/projects/{projectId}/stages/{stageId}/complete` | ceo | 7 | RF-25 |
| POST | `/admin/projects/{projectId}/stages/{stageId}/reopen` | ceo | 7 | RF-26 |
| GET | `/portal/projects` | ceo, client | 8 | RF-30 |
| GET | `/portal/projects/{projectId}` | ceo, client | 8 | RF-31 |
| GET · POST | `/admin/projects/{projectId}/notes` | ceo | 9 | RF-40 |
| GET | `/admin/audit-events` | ceo | 9 | RF-41 |
| GET · POST | `/admin/flow-templates` | ceo | 10 | RF-50 |
| GET · PATCH · DELETE | `/admin/flow-templates/{templateId}` | ceo | 10 | RF-50 |

Convenções:
- JSON em camelCase.
- IDs são UUID v4.
- Datas em ISO 8601 UTC; `expectedDate` é `YYYY-MM-DD`.
- Paginação por `limit` (1–100, padrão 20) + `cursor` opaco, com resposta `{ items, nextCursor }`.
- Toda resposta traz `X-Request-Id` e `Cache-Control: no-store`.

---

## 9. Edge cases e erros

### 9.1 Edge cases

| # | Cenário | Comportamento esperado |
|---|---|---|
| E1 | Dois CEOs concluem a mesma fase ao mesmo tempo | Um `200`; o outro `409 STAGE_ALREADY_COMPLETED`. |
| E2 | CEO conclui uma fase que não é a atual (tela desatualizada) | `409 STAGE_NOT_CURRENT`. |
| E3 | Concluir fase de projeto `draft` ou `archived` | `409 PROJECT_NOT_ACTIVE`. |
| E4 | Reordenar com IDs faltando, repetidos ou de outro projeto | `400 VALIDATION_FAILED`, sem revelar a qual projeto o ID pertence. |
| E5 | Reordenar movendo uma fase concluída | `409 STAGE_LOCKED`. |
| E6 | Remover uma fase concluída | `409 STAGE_LOCKED`. |
| E7 | Remover a última fase de projeto fora de `draft` | `409 PROJECT_REQUIRES_STAGE`. |
| E8 | Remover a fase atual quando todas as outras já estão concluídas | Remove e o projeto vira `completed` (RF-27). |
| E9 | Adicionar fase em projeto `completed` | O projeto volta a `active` e a nova fase vira a atual. |
| E10 | Adicionar fase com `position` ≤ última concluída | `409 STAGE_LOCKED`. |
| E11 | Adicionar a 51ª fase | `409 STAGE_LIMIT_REACHED`. |
| E12 | Usuário desativado chama a API com JWT ainda válido | `401 UNAUTHENTICATED` (guard + RLS). |
| E13 | Cliente desativado com usuário logado | Igual ao E12, para todos os usuários do cliente. |
| E14 | Usuário do cliente chama `/admin/*` | `403 FORBIDDEN`. |
| E15 | Usuário do cliente pede projeto de outro cliente | `404 NOT_FOUND`. |
| E16 | Usuário do cliente pede projeto `draft` ou `archived` do próprio cliente | `404 NOT_FOUND`. |
| E17 | Usuário do cliente chama o PostgREST direto com o próprio JWT | A RLS limita às linhas dele. INSERT e DELETE dão erro; UPDATE não altera nada (não há policy de escrita para cliente). `rpc('tracking_*')` → `42501`. |
| E18 | Alguém tenta `signUp` direto no Supabase Auth | Bloqueado (signup desabilitado). Mesmo que fosse liberado por engano, sem perfil `auth_role()` é `null` e a RLS nega tudo. |
| E19 | UUID inválido no path | `400 VALIDATION_FAILED`, nunca `500`. |
| E20 | Campo desconhecido no body (ex.: `role`, `status`, `completedAt`) | `400 VALIDATION_FAILED` (proteção contra mass assignment). |
| E21 | Corpo > 16 KB ou `Content-Type` diferente de JSON | `413` ou `415`. |
| E22 | Texto com payload de SQL (`'; drop table clients; --`) | Gravado literalmente como texto, sem erro e sem efeito colateral. |
| E23 | Texto com HTML ou `<script>` | Gravado como texto puro e devolvido em JSON com `nosniff`. O frontend renderiza como texto, nunca como HTML. |
| E24 | Caracteres de controle (exceto `\n` e `\t` em descrições) | `400 VALIDATION_FAILED`. Emoji e acentos são aceitos; o tamanho conta caracteres. |
| E25 | `expectedDate` no passado | Aceito: é previsão e pode estar atrasada. |
| E26 | Usuário com `mustChangePassword` chama o portal | `403 PASSWORD_CHANGE_REQUIRED`. |
| E27 | Armazenamento do rate limit indisponível | Login e troca de senha falham fechado (`503 SERVICE_UNAVAILABLE`); demais rotas seguem e logam `error`. |
| E28 | Supabase Auth indisponível ou timeout (> 10 s) | `503 SERVICE_UNAVAILABLE` genérico. |
| E29 | Erro inesperado | `500 INTERNAL_ERROR` com `requestId`; o stack trace fica só no log do servidor. |
| E30 | Dois CEOs editam o mesmo fluxo ao mesmo tempo (reordenar × adicionar) | Serializado pelo lock do projeto; a segunda operação é validada contra o estado novo. |
| E31 | E-mail com maiúsculas | Normalizado para minúsculas; a unicidade não diferencia maiúsculas. |
| E32 | CEO tenta desativar ou resetar outro CEO pela API | `404` (o alvo precisa ser usuário do cliente). |
| E33 | Falha ao gravar a auditoria dentro de uma função `tracking_*` | A transação inteira é desfeita. |
| E34 | Criar projeto para cliente inativo | `409 CLIENT_INACTIVE`. O CEO ainda pode ver e arquivar projetos existentes desse cliente. |

### 9.2 Catálogo de códigos de erro

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION_FAILED` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ORIGIN_NOT_ALLOWED` |
| 404 | `NOT_FOUND` |
| 409 | `CLIENT_NAME_TAKEN`, `CLIENT_INACTIVE`, `EMAIL_ALREADY_REGISTERED`, `INVALID_STATUS_TRANSITION`, `PROJECT_NOT_ACTIVE`, `PROJECT_ARCHIVED`, `PROJECT_HAS_NO_STAGES`, `PROJECT_REQUIRES_STAGE`, `STAGE_NOT_CURRENT`, `STAGE_ALREADY_COMPLETED`, `NOT_LAST_COMPLETED_STAGE`, `STAGE_LOCKED`, `STAGE_LIMIT_REACHED`, `TEMPLATE_NAME_TAKEN` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` |

---

## 10. Plano de testes

| Camada | Ferramenta | Onde | Cobre |
|---|---|---|---|
| Unidade | Vitest | `src/modules/*/domain/**/*.test.ts` e `*.use-case.test.ts` | Invariantes I1–I7, máquina de estados, estado derivado das fases, allowlist do DTO do portal, política de senha, mapeamento de erros. Use cases com repositórios fake. |
| Banco | pgTAP (`supabase test db`) | `supabase/tests/*.sql` | RLS de cada tabela para `anon`, cliente A, cliente B, CEO, usuário inativo e usuário sem perfil; grants (cliente sem escrita); authz e invariantes das funções `tracking_*`; auditoria gravada; append-only; validações do `handle_new_user`. |
| Integração | Vitest + Supabase local | `tests/integration/**` | Cada endpoint (caminho feliz + erros principais), chamando o handler com `Request` real contra o Supabase local. Respostas validadas contra o OpenAPI. |
| Contrato | Redocly CLI | CI (`npm run contract:lint`) | Contrato válido e sem regras quebradas. |
| Segurança | Vitest | `tests/security/**` | SEC-01..SEC-15 do security-baseline: matriz de IDOR, corpus de SQLi, injeção de filtro PostgREST, mass assignment, rate limit, headers, CSRF, sessão. |
| E2E | Playwright | fase 2 | Fluxos críticos dos painéis. |

Regras:
- Todo CA desta spec vira teste nomeado `RF-xx.CAy`.
- Teste cross-tenant é obrigatório para toda tabela nova e todo endpoint novo (skill `tenant-isolation-test`).
- Sem `sleep` e sem rede externa: o Supabase local roda em Docker.

---

## 11. Questões em aberto e decisões assumidas

As decisões abaixo foram assumidas para não travar o plano. Se alguma mudar, atualize esta
spec, o contrato e o plano de ondas no mesmo PR.

| # | Questão | Decisão assumida | Impacto se mudar |
|---|---|---|---|
| Q1 | Um cliente pode ter vários projetos ao mesmo tempo? | Sim (1 cliente : N projetos). | Baixo. |
| Q2 | Um cliente pode ter mais de um login (ex.: sócio e gerente)? | Sim (1 cliente : N usuários). | Baixo. |
| Q3 | MFA (TOTP) obrigatório para os CEOs? | **Recomendado**, planejado para a Onda 12 se aprovado. | Médio: novos endpoints e policies exigindo `aal2`. |
| Q4 | Avisar o cliente por e-mail quando uma fase avança? | Fora da v1. | Médio: provedor de e-mail, templates, LGPD. |
| Q5 | Reabrir fase concluída por engano? | Permitido só para a última concluída, com justificativa auditada. | Baixo. |
| Q6 | Projeto arquivado aparece para o cliente? | Não. | Baixo. |
| Q7 | Previsão de data por fase visível ao cliente? | Sim, opcional por fase. | Baixo. |
| Q8 | O cliente vê qual CEO concluiu a fase? | Não, só a data. | Baixo. |
| Q9 | Retenção da auditoria | 5 anos (validar com o jurídico). | Baixo: job de expurgo. |
| Q10 | Rate limiting em Postgres ou Upstash Redis? | Postgres + Vercel Firewall (ADR-0004, `proposed`). | Médio: troca de adapter e nova env var. |
| Q11 | Painel CEO no mesmo domínio ou em subdomínio (`admin.`)? | Mesmo domínio na v1. Subdomínio é um hardening possível (isola cookies). | Médio. |
| Q12 | Os CEOs são sempre 4? | Não há limite fixo no código; CEO é um papel. | Nenhum. |
