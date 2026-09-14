-- 0000: Local/test environment shim — minimal auth schema stand-in.
-- In hosted Supabase, `auth` is provided by Supabase Auth and this file is
-- NOT applied (see runner). It exists only so the migration chain resolves
-- `auth.users` foreign keys in local/test environments (DATABASE.md §5.1).
create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  created_at timestamptz not null default now()
);
