---
name: new-migration
description: Cria uma migration do Supabase seguindo as regras de segurança do projeto (RLS habilitada e forçada, grants mínimos por coluna, funções security definer seguras, auditoria na mesma transação, teste pgTAP junto). Use ao criar ou alterar tabela, enum, policy, grant, trigger ou função Postgres.
argument-hint: "<nome_descritivo_em_snake_case>"
---

# Nova migration: $ARGUMENTS

## 1. Antes de escrever SQL

- Confirme que a mudança está descrita na spec (`docs/specs/client-delivery-tracking.md` §7). Se
  não estiver, **atualize a spec primeiro** (tabela, matriz de RLS §7.3, funções §7.4).
- Se a mudança for estrutural (novo padrão de acesso, mudança de modelo de tenant), escreva um ADR.
- **Nunca edite uma migration que já está na `main`.** Correção = migration nova. O hook
  `guard-sensitive-files` bloqueia a edição.

## 2. Criar o arquivo

```bash
npx supabase migration new $ARGUMENTS
```

## 3. Escrever o SQL com os templates

### Tabela

```sql
create table public.example (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete restrict,
  name        text not null check (char_length(name) between 2 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index example_client_id_idx on public.example (client_id);

-- RLS: sempre as duas linhas
alter table public.example enable row level security;
alter table public.example force row level security;

-- Privilégios: revogue tudo, conceda o mínimo (por coluna nas escritas)
revoke all on public.example from anon, authenticated, public;
grant select on public.example to authenticated;
grant insert (client_id, name), update (name) on public.example to authenticated;  -- só se CEO escreve direto

-- Policies: uma por operação, sempre "to authenticated", helpers em subselect
create policy example_select_ceo on public.example
  for select to authenticated using ((select private.is_ceo()));
create policy example_select_own_client on public.example
  for select to authenticated using (client_id = (select private.auth_client_id()));
create policy example_write_ceo on public.example
  for insert to authenticated with check ((select private.is_ceo()));
create policy example_update_ceo on public.example
  for update to authenticated using ((select private.is_ceo())) with check ((select private.is_ceo()));

create trigger example_set_updated_at
  before update on public.example
  for each row execute function private.set_updated_at();
```

Dado interno dos CEOs **não** entra numa tabela que o cliente lê: crie uma tabela separada só
para CEO (ADR-0002).

### Função de comando (multi-linha / invariante)

```sql
create or replace function public.tracking_example(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  perform private.assert_ceo();                                   -- 1ª instrução, sempre

  select * into v_project
    from public.projects
   where id = p_project_id
     for update;                                                  -- serializa CEOs concorrentes
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if v_project.status = 'archived' then
    raise exception using errcode = 'P0001', message = 'PROJECT_ARCHIVED';
  end if;

  -- ... mutação com SQL estático e parâmetros (sem EXECUTE dinâmico) ...

  insert into public.audit_events (actor_id, action, entity_type, entity_id, client_id, project_id, metadata, request_id)
  values (auth.uid(), 'project.example', 'project', p_project_id, v_project.client_id, p_project_id,
          '{}'::jsonb,                                             -- nunca PII
          current_setting('request.headers', true)::json ->> 'x-request-id');
end;
$$;

revoke execute on function public.tracking_example(uuid) from public, anon;
grant execute on function public.tracking_example(uuid) to authenticated;
```

Os códigos de `message` vêm do catálogo da spec §9.2. Funções `admin_*` e `rate_limit_*` recebem
grant **só** para `service_role`.

## 4. Proibido

- `create table` em `public` sem `enable` **e** `force row level security`.
- `grant … to anon`, `using (true)`/`with check (true)` sem comentário justificando, `disable row level security`.
- `security definer` sem `set search_path = ''`, sem checagem de authz na 1ª linha ou sem `revoke … from public, anon`.
- `EXECUTE` dinâmico (se for inevitável: `format('%I', …)`/`%L` + revisão do `rls-auditor`).
- Ler papel ou tenant de `raw_user_meta_data` (o usuário edita). Use `raw_app_meta_data` ou `profiles`.
- FK em `audit_events` (é snapshot append-only).
- Dados reais no `seed.sql`.

## 5. Testar e gerar tipos

1. Escreva o teste pgTAP em `supabase/tests/NNN_<nome>.test.sql` com a skill `tenant-isolation-test`.
2. Rode:
   ```bash
   npx supabase db reset && npm run db:test && npm run db:lint
   npm run db:types   # regenera src/shared/infrastructure/supabase/database.types.ts
   ```
3. Peça revisão ao agent `rls-auditor` e corrija tudo o que for CRÍTICO ou ALTO antes do PR.
