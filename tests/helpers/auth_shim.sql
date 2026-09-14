-- Test-only shim pieces applied at specific points by the harness.
-- NEVER applied in hosted Supabase.

-- ===== Applied BEFORE migrations =====
-- (The shim creates the auth schema itself; 0007 policies need auth.uid()
-- to exist when the policies are created.)

create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

-- auth.uid()/auth.role() over request.jwt.claims (Supabase semantics).
-- Empty-string claims (local set_config reverted by rollback in some
-- environments) are treated as unset.
create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select case
    when current_setting('request.jwt.claims', true) is null then null::uuid
    when current_setting('request.jwt.claims', true) = '' then null::uuid
    else nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  end
$$;

create or replace function auth.role() returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'anon'
  )
$$;

-- ===== Applied AFTER migrations =====
-- Hosted Supabase grants SELECT to anon/authenticated on public tables;
-- replicate so RLS policies (not missing grants) are the effective gate.
-- Grants require the tables to exist, hence post-migration.

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
