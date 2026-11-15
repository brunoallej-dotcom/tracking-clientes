# ADR-0003 — Comandos do fluxo como funções Postgres, com dupla checagem no domínio

- **Status:** accepted
- **Data:** 2026-11-15

## Contexto

Concluir uma fase precisa, de forma atômica: verificar que o chamador é CEO, travar o
projeto, garantir que a fase é a atual, gravar a conclusão, possivelmente concluir o projeto
e gravar a auditoria. Reordenar, adicionar e remover fases mexem em várias linhas e precisam
preservar invariantes (prefixo de fases concluídas, posições contíguas). O supabase-js não
oferece transações multi-statement, e dois CEOs podem agir ao mesmo tempo.

## Decisão

- Toda **mutação multi-linha ou com invariante de ordem** do agregado `Project` é uma função
  PL/pgSQL `security definer` em `public` (`tracking_*`), chamada via `.rpc()`:
  - 1ª instrução: `perform private.assert_ceo();`
  - `set search_path = ''` e nomes qualificados; SQL estático, sem `EXECUTE` dinâmico.
  - `select … for update` na linha do projeto, para serializar operações concorrentes.
  - Revalida as invariantes e grava `audit_events` na mesma transação.
  - Erro de regra: `raise exception using errcode = 'P0001', message = '<CODE>'`. Falta de
    permissão: `errcode = '42501'`.
  - `revoke execute … from public, anon` e `grant execute … to authenticated`.
- O **domínio em TypeScript** (`src/modules/tracking/domain`) implementa as mesmas
  invariantes. O use case carrega o agregado, chama o método de domínio (erro rápido e
  testável em unidade) e só então chama a função. **A função é a autoridade final.**
- Mutações simples de uma linha (renomear cliente ou projeto, criar nota) usam supabase-js com
  RLS e grants por coluna, e são auditadas por trigger.

## Alternativas consideradas

- **Só TypeScript + escrita direta:** sem transação, com corrida entre CEOs e auditoria não atômica.
- **Driver Postgres direto (Drizzle/postgres.js) com transações em TS:** ignora a RLS ou exige
  trocar role e claims a cada transação, além de pool em serverless e credencial de banco na
  Vercel (ver ADR-0001).
- **Só funções Postgres, sem domínio em TS:** regras sem testes de unidade rápidos e erros
  menos claros na API.

## Consequências

- (+) Atomicidade, serialização e auditoria garantidas no banco, inclusive para quem chame o
  PostgREST direto.
- (−) Regras duplicadas em SQL e TS. Mitigação: uma única tabela de casos (spec §6.2 e §9.1)
  é testada nos dois lados (pgTAP + Vitest), e qualquer mudança de regra altera os dois no
  mesmo PR.
- (−) `security definer` é sensível. Mitigação: checklist da skill `new-migration`, hook
  `security-lint`, agent `rls-auditor` e testes pgTAP de authz para cada função.
