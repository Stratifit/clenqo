-- 0001: Identity foundation — profiles, memberships, membership_branches
-- Source: docs/DATABASE.md §5–9, §64; docs/SECURITY.md §20
--
-- Supabase Auth (auth.users) owns credentials; the application database
-- stores business identity only (DATABASE.md §5.1). In hosted Supabase the
-- auth schema already exists; in local/test environments 0000 creates a
-- minimal stand-in so FKs resolve. Never duplicate passwords here.

-- =====================================================================
-- profiles (DATABASE.md §6) — id IS the Supabase Auth user id
-- =====================================================================
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  first_name   text,
  last_name    text,
  display_name text,
  phone        text,
  avatar_path  text,
  locale       text,
  timezone     text,
  status       text not null default 'active'
               check (status in ('active', 'inactive', 'deactivated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for each authenticated internal platform user (DATABASE.md §6).';

-- =====================================================================
-- memberships (DATABASE.md §7) — user ↔ organization with a role
-- =====================================================================
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null
                  check (role in ('hq_admin', 'hq_staff', 'branch_manager', 'cleaner')),
  status          text not null default 'active'
                  check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.memberships is
  'A user''s relationship with an organization: role at organization scope (DATABASE.md §7, §8).';

-- Branch scope rows (DATABASE.md §43)
create index idx_memberships_user_id on public.memberships (user_id);
create index idx_memberships_organization_id on public.memberships (organization_id);

-- =====================================================================
-- membership_branches (DATABASE.md §9) — explicit branch scope rows
-- =====================================================================
create table public.membership_branches (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  branch_id     uuid not null,
  created_at    timestamptz not null default now(),
  unique (membership_id, branch_id)
);

comment on table public.membership_branches is
  'Branch scope for a membership: managers/staff may operate on specific branches only (DATABASE.md §9).';

create index idx_membership_branches_membership_id on public.membership_branches (membership_id);
create index idx_membership_branches_branch_id on public.membership_branches (branch_id);
