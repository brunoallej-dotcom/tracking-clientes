begin;
select plan(2);
select is(current_setting('server_version_num')::integer / 10000, 17, 'Foundation: Postgres 17');
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)),
  0, 'SEC-03: every public table enables and forces RLS'
);
select * from finish();
rollback;
