-- =====================================================================
-- 0014_admin_foundation.sql — Change 8 (create-admin-foundation)
-- openspec/changes/create-admin-foundation/design.md §3 (C8-3 schema
-- alignment). Normative decision records: DOCUMENTATION_AUDIT §4c,
-- BRANCH_SYSTEM §22, DATABASE §11.1.
--
-- Scope: branch-slug routing-identity alignment ONLY.
--   1. Pre-validation of existing slug data (abort on violation).
--   2. branches.slug CHECKs: length 2–63, ^[a-z0-9]([a-z0-9-]*[a-z0-9])$,
--      reserved words (admin, cleaner, apply, api, login, setup, static,
--      public, assets, book, auth, settings, profile, help, legal).
--   3. Global unique routing-namespace index uq_branches_slug_global
--      (archived branches intentionally RETAIN slug reservation).
--   4. branch_slug_aliases: old-slug → branch redirect records (301 at
--      the future public-site layer); UNIQUE(alias) global so a freed
--      slug is redirectable but never reassignable; combined-policy RLS.
--
-- Deliberately NOT created (design §3): no bootstrap tables (env
-- SETUP_TOKEN + zero-active-HQ-admin invariant + audit_logs), no
-- invitation tables (Supabase inviteUserByEmail + memberships +
-- membership_branches), no context/dashboard structures (query/cookie +
-- existing tables). No new permissions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pre-validation (fail the migration on dirty data)
-- ---------------------------------------------------------------------

do $$
declare
  v_duplicates text;
  v_invalid text;
begin
  -- Duplicate slugs (global namespace) would break the unique index.
  select string_agg(slug, ', ')
    into v_duplicates
    from (
      select slug from public.branches group by slug having count(*) > 1
    ) d;
  if v_duplicates is not null then
    raise exception '0014: duplicate branch slugs in global namespace: %', v_duplicates;
  end if;

  -- Existing slugs must already satisfy the new validation rules.
  select string_agg(slug, ', ')
    into v_invalid
    from public.branches
    where char_length(slug) not between 2 and 63
       or slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'
       or position('--' in slug) > 0
       or slug in ('admin', 'cleaner', 'apply', 'api', 'login', 'setup',
                   'static', 'public', 'assets', 'book', 'auth', 'settings',
                   'profile', 'help', 'legal');
  if v_invalid is not null then
    raise exception '0014: existing branch slugs violate new CHECK rules: %', v_invalid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. branches.slug validation CHECKs (C8-3 normalization rules)
-- ---------------------------------------------------------------------

alter table public.branches
  add constraint ck_branches_slug_length check (char_length(slug) between 2 and 63);

alter table public.branches
  add constraint ck_branches_slug_shape check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$');

alter table public.branches
  add constraint ck_branches_slug_reserved check (
    slug <> all (array[
      'admin', 'cleaner', 'apply', 'api', 'login', 'setup', 'static',
      'public', 'assets', 'book', 'auth', 'settings', 'profile', 'help',
      'legal'
    ])
  );

alter table public.branches
  add constraint ck_branches_slug_no_double check (position('--' in slug) = 0);

-- ---------------------------------------------------------------------
-- 3. Global routing-namespace uniqueness
--    (uq_branches_org_slug from 0002 remains: per-org uniqueness is
--    implied by global uniqueness and backs idempotent creation.)
-- ---------------------------------------------------------------------

create unique index uq_branches_slug_global on public.branches (slug);

-- ---------------------------------------------------------------------
-- 4. branch_slug_aliases — old slug → branch UUID redirect records
-- ---------------------------------------------------------------------

create table public.branch_slug_aliases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id       uuid not null references public.branches (id) on delete cascade,
  -- Same normalization rules as branches.slug; globally unique so a
  -- freed slug can only ever redirect, never be reassigned.
  alias           text not null,
  created_at      timestamptz not null default now(),

  constraint uq_branch_slug_aliases_alias unique (alias),
  constraint ck_branch_slug_alias_length check (char_length(alias) between 2 and 63),
  constraint ck_branch_slug_alias_shape check (alias ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'),
  constraint ck_branch_slug_alias_reserved check (
    alias <> all (array[
      'admin', 'cleaner', 'apply', 'api', 'login', 'setup', 'static',
      'public', 'assets', 'book', 'auth', 'settings', 'profile', 'help',
      'legal'
    ])
  ),
  constraint ck_branch_slug_alias_no_double check (position('--' in alias) = 0)
);

create index idx_branch_slug_aliases_branch on public.branch_slug_aliases (branch_id);

comment on table public.branch_slug_aliases is
  'Change 8 (C8-3): old public branch slugs retained as redirect records (301 at the public-site layer). Alias is globally unique — a freed slug is redirectable, never reassignable. Slug identity model: UUID = internal identity, display name = public identity, slug = routing identity.';

-- ---------------------------------------------------------------------
-- RLS — one combined select policy (0007/0012/0013 pattern, no FORCE,
-- no application-role write policies: mutations flow through the
-- privileged domain layer).
-- ---------------------------------------------------------------------

alter table public.branch_slug_aliases enable row level security;
create policy branch_slug_aliases_select on public.branch_slug_aliases
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
