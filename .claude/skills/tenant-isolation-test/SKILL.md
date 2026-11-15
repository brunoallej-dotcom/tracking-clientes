---
name: tenant-isolation-test
description: Escreve os testes obrigatórios de isolamento entre clientes — pgTAP para tabelas e funções, integração para endpoints — cobrindo anon, cliente A, cliente B, CEO, usuário inativo e usuário sem perfil. Use sempre que criar ou alterar tabela, policy, função ou endpoint que toque dados de cliente.
argument-hint: "<tabela | função | operationId>"
---

# Testes de isolamento para: $ARGUMENTS

Isolamento entre clientes é o requisito nº 1 (RNF-02). Toda tabela, função e endpoint novo tem
estes testes **no mesmo PR**.

## Personas (sempre todas)

| Persona | Como montar | Expectativa padrão |
|---|---|---|
| `anon` | `set local role anon` / requisição sem cookie | Nenhum acesso (`42501` ou 0 linhas / `401`) |
| Cliente A | usuário `client` do cliente A, ativo | Só dados do cliente A, só projetos `active`/`completed`, sem escrita |
| Cliente B | usuário `client` do cliente B, ativo | Nunca vê nada do cliente A (`404` na API) |
| CEO | usuário `ceo` ativo | Tudo |
| Usuário inativo | `profiles.is_active = false` (ou cliente inativo) | Nenhum acesso, mesmo com JWT válido (`401`) |
| Sem perfil | linha em `auth.users` sem `profiles` | Nenhum acesso |

## pgTAP (`supabase/tests/NNN_<nome>.test.sql`)

```sql
begin;
select plan(8);

-- Fixtures (rodando como postgres). Os UUIDs fixos deixam o teste determinístico.
insert into public.clients (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Cliente A'),
  ('00000000-0000-0000-0000-0000000000b1', 'Cliente B');

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local',
     '{"role":"client","client_id":"00000000-0000-0000-0000-0000000000a1","full_name":"User A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local',
     '{"role":"client","client_id":"00000000-0000-0000-0000-0000000000b1","full_name":"User B"}'),
  ('00000000-0000-0000-0000-00000000000c', 'ceo@test.local',
     '{"role":"ceo","full_name":"CEO"}');
-- (o trigger handle_new_user cria os profiles)

insert into public.projects (id, client_id, name, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Projeto A', 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'Rascunho A', 'draft');

-- anon
set local role anon;
select throws_ok($$ select * from public.projects $$, '42501', null, 'anon: sem acesso a projects');
reset role;

-- Cliente B não vê nada do A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.projects), 0, 'cliente B: não vê projetos do A');
select is((select count(*)::int from public.project_stages), 0, 'cliente B: não vê fases do A');
reset role;

-- Cliente A vê o ativo, não vê o draft e não escreve
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select results_eq($$ select name from public.projects $$, $$ values ('Projeto A'::text) $$,
  'cliente A: só o projeto ativo do próprio cliente');
-- O grant de UPDATE por coluna é do papel authenticated (CEOs usam), então a RLS
-- ignora as linhas em silêncio em vez de lançar erro: verifique que nada mudou.
update public.projects set name = 'hacked';
select is((select count(*)::int from public.projects where name = 'hacked'), 0,
  'cliente A: UPDATE não altera nada (RLS)');
-- Funções de CEO (tracking_*, a partir da Onda 5) devem lançar 42501 via assert_ceo().
select throws_ok($$ select public.tracking_complete_stage('00000000-0000-0000-0000-000000000099') $$,
  '42501', null, 'cliente A: função de CEO negada');
reset role;

-- CEO vê tudo
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select is((select count(*)::int from public.projects), 2, 'CEO: vê todos, inclusive draft');
reset role;

-- Usuário inativo
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.projects), 0, 'usuário inativo: sem acesso');
reset role;

select * from finish();
rollback;
```

Adapte: uma asserção por (persona × operação: SELECT, INSERT, UPDATE, DELETE, EXECUTE) que se
aplique ao objeto. Inclua também a persona "sem perfil" (insira em `auth.users` com
`raw_app_meta_data` vazio **só se** o `handle_new_user` permitir. Senão, teste que a inserção falha).

## Integração / segurança (endpoints)

Em `tests/security/<area>.test.ts`, use uma matriz `it.each`:

```ts
it.each([
  { persona: 'anon',     expected: 401 },
  { persona: 'clientB',  expected: 404 },  // recurso do cliente A
  { persona: 'clientA',  expected: 200 },  // portal; em /admin/* o esperado é 403
  { persona: 'ceo',      expected: 200 },
  { persona: 'inactive', expected: 401 },
])('SEC-01 $persona → $expected em GET /portal/projects/{idDoA}', async ({ persona, expected }) => {
  const res = await callAs(persona, 'GET', `/api/v1/portal/projects/${fixtures.projectA}`);
  expect(res.status).toBe(expected);
});
```

E sempre:
- O corpo de 404 cross-tenant é **idêntico** ao de um ID inexistente (não revela existência).
- Campos extras no body (`clientId`, `role`, `status`, `completedAt`) → 400 (SEC-06).
- Corpus de SQLi em todo campo string: gravado literalmente, sem 500 (SEC-04).

## Rodar

```bash
npm run db:test
npm run test:security -- tests/security/<area>.test.ts
```
