-- 0002: Organizations and branches — org model, branch lifecycle,
-- provisioning sub-lifecycle columns.
-- Source: docs/DATABASE.md §10–12, §42, §43; docs/BRANCH_SYSTEM.md §14–22;
--         openspec/changes/create-branch-provisioning design §3.

-- =====================================================================
-- organizations (DATABASE.md §10.1)
-- =====================================================================
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  legal_name      text,
  slug            text not null unique,
  status          text not null default 'active'
                  check (status in ('active', 'inactive', 'suspended', 'archived')),
  default_locale  text not null default 'de',
  default_timezone text not null default 'Europe/Berlin',
  country_code    text not null default 'DE',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.organizations is
  'Top-level organization; branches belong to exactly one organization (DATABASE.md §10).';

-- =====================================================================
-- branches (DATABASE.md §11.1) + provisioning lifecycle (BRANCH_SYSTEM §18)
-- =====================================================================
create table public.branches (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id),
  name                  text not null,
  slug                  text not null,
  status                text not null default 'draft'
                        check (status in ('draft', 'provisioning', 'ready', 'active',
                                          'suspended', 'archived')),
  provisioning_status   text not null default 'pending'
                        check (provisioning_status in ('pending', 'provisioning',
                                                       'ready', 'failed')),
  provisioning_error    text,
  provisioning_stage    text,
  provisioning_attempts integer not null default 0,
  provisioned_at        timestamptz,
  country_code          text not null,
  timezone              text not null,
  currency              text not null,
  locale                text not null,
  enabled_locales       jsonb not null default '[]'::jsonb,
  address_line_1        text,
  address_line_2        text,
  postal_code           text,
  city                  text,
  state_region          text,
  phone                 text,
  email                 text,
  website_status        text not null default 'offline',
  service_area          jsonb,
  activated_at          timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Slug uniqueness is per organization (DATABASE.md §42); the unique index
  -- also backs idempotency of concurrent branch creation (design §4).
  constraint uq_branches_org_slug unique (organization_id, slug),
  constraint ck_branches_activated_at check (
    (status = 'active') = (activated_at is not null)
  )
);

comment on table public.branches is
  'A branch is data/configuration of one organization — never a separate codebase (BRANCH_SYSTEM §65).';

-- Lifecycle guard: activation requires provisioning ready (BRANCH_SYSTEM §18).
alter table public.branches
  add constraint ck_branches_activation_requires_ready
  check (status <> 'active' or provisioning_status = 'ready');

create index idx_branches_organization_id on public.branches (organization_id);
create index idx_branches_status on public.branches (status);
