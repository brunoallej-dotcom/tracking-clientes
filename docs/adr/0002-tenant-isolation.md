# ADR-0002 — Isolamento multi-tenant e separação por audiência

- **Status:** accepted
- **Data:** 2026-11-15

## Contexto

O requisito mais crítico do produto é que um cliente nunca veja o rastreamento de outro, e
que o cliente nunca veja o que é interno dos CEOs. Com Supabase, o PostgREST é alcançável
diretamente por quem tiver a publishable key. Por isso o isolamento não pode depender só da
nossa API.

## Decisão

1. **Tenant = cliente (`clients`).** Cada usuário tem um perfil (`profiles`) com `role`
   (`ceo` | `client`) e `client_id` (nulo para CEO).
2. **Papel e tenant vêm do banco, não de claims no JWT.** As funções `private.auth_role()` e
   `private.auth_client_id()` consultam `profiles` e `clients` a cada query. Desativar um
   usuário ou cliente tem efeito imediato, sem esperar o JWT expirar.
3. **Duas barreiras independentes:** o use case filtra e autoriza; a RLS (`enable` + `force`
   em toda tabela de `public`) repete a regra. Uma sozinha precisa bastar.
4. **Separação por audiência em tabelas.** Tabelas legíveis pelo cliente (`clients`,
   `projects`, `project_stages`, o próprio `profiles`) só têm colunas publicáveis. O que é
   interno mora em tabelas só de CEO (`project_internal_notes`, `audit_events`), inclusive
   "quem concluiu a fase". Assim não depende de privilégio por coluna, que no Postgres é por
   role e não por usuário.
5. **Escrita mínima.** CEOs e clientes usam o mesmo papel Postgres (`authenticated`), então os
   grants são iguais para os dois: mínimos e por coluna (ex.: `update (name, description)` em
   `projects`). Quem impede o cliente de escrever é a RLS: só existem policies de escrita para
   `private.is_ceo()`. Tabelas sem escrita direta (`project_stages`, `profiles`, `audit_events`)
   não têm grant nenhum de escrita. O status do projeto e as fases só mudam por funções (ADR-0003).
6. **O navegador nunca fala com o Supabase.** Toda chamada passa pelos Route Handlers. Os
   cookies de sessão são `HttpOnly`, e as variáveis do Supabase são server-only (sem
   `NEXT_PUBLIC_`).
7. **Recurso de outro tenant = 404.**
8. **Contas de CEO só por script operacional**, nunca pela API.
9. **Signup desabilitado.** Usuário sem perfil tem `auth_role() = null`, e a RLS nega tudo.

## Consequências

- (+) Um vazamento exigiria falhar a checagem do use case **e** a RLS ao mesmo tempo.
- (+) Revogação imediata. O portal não tem como vazar campo interno, porque o campo não está
  na tabela.
- (−) Uma consulta extra a `profiles` por avaliação de policy (mitigada com `(select …)` e
  índice pela PK; irrelevante nesta escala).
- (−) Se o frontend precisar de Realtime no futuro, a regra 6 terá de ser revisitada em um
  novo ADR (o browser client precisaria da publishable key e de cookies legíveis).
- Obrigatório: teste cross-tenant (pgTAP + integração) para toda tabela e todo endpoint novo.
