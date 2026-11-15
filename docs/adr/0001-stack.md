# ADR-0001 — Stack: Next.js + Supabase + Vercel, sem ORM e sem backend separado

- **Status:** accepted
- **Data:** 2026-11-15

## Contexto

Precisamos de um rastreador de entregas multi-tenant, com dois painéis (CEO e cliente), login
por cliente, isolamento forte entre clientes e foco em segurança (OWASP Top 10:2025, SQL
injection, LGPD). O time é pequeno, o volume é baixo (dezenas de clientes, 4 CEOs) e a
primeira fase é só backend e banco. A stack proposta pelo dono do produto foi Vercel +
Supabase + Next.js (React) + TypeScript + Tailwind.

## Decisão

Manter a stack proposta, com estes complementos e restrições:

| Camada | Escolha |
|---|---|
| Runtime / API | Next.js 16+ (App Router), Route Handlers como única API, `proxy.ts` só para cross-cutting. Node 24 LTS. |
| Linguagem | TypeScript `strict` (+ `noUncheckedIndexedAccess`). |
| Banco / Auth | Supabase: Postgres 17, Auth (e-mail + senha), RLS, Supabase CLI para migrations, ambiente local (Docker) e testes pgTAP. Região `sa-east-1`. |
| Acesso a dados | `@supabase/ssr` + `supabase-js` com o JWT do usuário (a RLS se aplica). Funções Postgres para comandos transacionais (ADR-0003). **Sem ORM.** |
| Validação | Zod em toda fronteira (request, resposta de terceiros, env). |
| Logs | pino (JSON). |
| Testes | Vitest (unidade e integração), pgTAP (banco), Playwright (fase 2). |
| Contrato | OpenAPI 3.1 em `contracts/`, lint com Redocly CLI. |
| Hospedagem | Vercel, funções em `gru1` (São Paulo). |
| UI (fase 2) | React + Tailwind CSS v4. |

## Alternativas consideradas

- **Backend separado (NestJS/Fastify) + SPA:** mais infraestrutura, dois deploys e CORS, sem
  ganho real nesta escala. O monolito modular em Next.js pode ter módulos extraídos depois,
  se um dia houver motivo.
- **Prisma ou Drizzle com conexão direta ao Postgres:** a conexão privilegiada ignora a RLS,
  a menos que se troque role e claims a cada transação. Isso adiciona um pool no serverless e
  uma credencial de banco na Vercel. Perderíamos a segunda barreira de isolamento ou
  pagaríamos em complexidade.
- **Firebase:** NoSQL, com integridade relacional e transações multi-documento mais fracas
  para um fluxo ordenado com invariantes.
- **Auth0 ou Clerk:** fornecedor e operador de dados a mais, e o JWT precisaria ser integrado
  à RLS. O Supabase Auth já é nativo da RLS (`auth.uid()`).

## Consequências

- (+) Uma linguagem, um deploy e um provedor de banco. RLS nativa como segunda barreira.
  Ambiente local idêntico ao remoto (Supabase CLI).
- (+) Dados no Brasil (`sa-east-1` + `gru1`), o que ajuda na LGPD.
- (−) Sem transações multi-statement no supabase-js: lógica transacional vai para funções
  Postgres (ADR-0003).
- (−) O PostgREST fica exposto pela natureza do Supabase: a RLS e os grants têm de ser
  impecáveis (ADR-0002).
- (−) Lock-in moderado no Supabase. O domínio em TypeScript puro e as portas de repositório
  limitam o raio de uma troca futura.
