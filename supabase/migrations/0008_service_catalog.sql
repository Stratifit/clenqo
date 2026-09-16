-- 0008: Service catalog & branch service configuration.
-- Source: docs/SERVICE_CATALOG.md (decisions Q1–Q9); docs/DATABASE.md §15
-- (pre-alignment reference — see tasks.md §15 for the documentation sync);
-- Change 1 conventions (UUID PKs, timestamptz UTC, natural-key UNIQUEs).
--
-- Decisions encoded here:
--   Q1  Per-branch rows; no master + branch-join structures.
--   Q2  Opt-in offering: rows are created disabled / not customer-visible;
--       missing/disabled offering means NOT OFFERED.
--   Q3  Explicit allow-list compatibility via service_addon_compatibility;
--       absence = incompatible; participants must share the same branch.
--   Q4  First-class service_categories (replaces DATABASE.md §15.1
--       service_type field — documentation synchronized in task 15).
--   Q5  NO pricing columns anywhere in the catalog.
--   Q7  Internal identity immutable; customer-facing slugs freeze after
--       publication (published_at); audited alias rows implement redirects.
--   Q9  branch_id NOT NULL on every catalog row (no platform-default rows).
--
-- RLS is enabled in this same migration (never a later gap) and follows the
-- 0007 owner-exemption pattern (no FORCE — see 0007 header for rationale).

-- =====================================================================
-- service_categories (Q4)
-- =====================================================================
create table public.service_categories (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  slug                text not null,
  name                text not null,
  description         text,
  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'inactive', 'archived')),
  sort_order          integer not null default 0,
  is_enabled          boolean not null default false,
  is_customer_visible boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint uq_service_categories_branch_slug unique (branch_id, slug),
  constraint ck_service_categories_status
    check (status in ('draft', 'active', 'inactive', 'archived'))
);

comment on table public.service_categories is
  'First-class service categories (Q4); branch-scoped per-branch MVP (Q1/Q9).';

create index idx_service_categories_branch_id on public.service_categories (branch_id);
create index idx_service_categories_status on public.service_categories (status);

-- =====================================================================
-- services
-- =====================================================================
create table public.services (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  category_id         uuid not null references public.service_categories (id),
  slug                text not null,
  name                text not null,
  description         text,
  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'inactive', 'archived')),
  sort_order          integer not null default 0,
  is_enabled          boolean not null default false,
  is_customer_visible boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint uq_services_branch_slug unique (branch_id, slug),
  constraint ck_services_status
    check (status in ('draft', 'active', 'inactive', 'archived'))
);

comment on table public.services is
  'Sellable services; category_id FK replaces the legacy service_type field (Q4).';

create index idx_services_branch_id on public.services (branch_id);
create index idx_services_status on public.services (status);
create index idx_services_category_id on public.services (category_id);

-- =====================================================================
-- service_variants
-- =====================================================================
create table public.service_variants (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  service_id          uuid not null references public.services (id),
  slug                text not null,
  name                text not null,
  description         text,
  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'inactive', 'archived')),
  sort_order          integer not null default 0,
  is_enabled          boolean not null default false,
  is_customer_visible boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint uq_service_variants_service_slug unique (service_id, slug),
  constraint ck_service_variants_status
    check (status in ('draft', 'active', 'inactive', 'archived'))
);

create index idx_service_variants_service_id on public.service_variants (service_id);
create index idx_service_variants_branch_id on public.service_variants (branch_id);
create index idx_service_variants_status on public.service_variants (status);

-- =====================================================================
-- service_addons — no pricing columns (Q5)
-- =====================================================================
create table public.service_addons (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  slug                text not null,
  name                text not null,
  description         text,
  status              text not null default 'draft'
                      check (status in ('draft', 'active', 'inactive', 'archived')),
  sort_order          integer not null default 0,
  min_quantity        integer not null default 1,
  max_quantity        integer not null default 1,
  is_enabled          boolean not null default false,
  is_customer_visible boolean not null default false,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint uq_service_addons_branch_slug unique (branch_id, slug),
  constraint ck_service_addons_status
    check (status in ('draft', 'active', 'inactive', 'archived')),
  constraint ck_service_addons_quantity_bounds check (min_quantity >= 1 and max_quantity >= min_quantity)
);

comment on table public.service_addons is
  'Optional booking extras; carries NO authoritative pricing data (Q5).';

create index idx_service_addons_branch_id on public.service_addons (branch_id);
create index idx_service_addons_status on public.service_addons (status);

-- Composite unique constraints required by the same-branch composite FKs of
-- service_addon_compatibility (must exist before that table is created).
alter table public.service_addons
  add constraint uq_service_addons_id_branch unique (id, branch_id);
alter table public.services
  add constraint uq_services_id_branch unique (id, branch_id);
alter table public.service_variants
  add constraint uq_service_variants_id_branch unique (id, branch_id);

-- =====================================================================
-- Translation tables — (entity_id, locale) UNIQUE per DATABASE.md §42
-- (service_translations already mandated there; the other three follow
-- the same established pattern). New locales are rows, not columns.
-- =====================================================================
create table public.service_category_translations (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories (id),
  locale      text not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_service_category_translations unique (category_id, locale)
);

create index idx_service_category_translations_category on public.service_category_translations (category_id);

create table public.service_translations (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references public.services (id),
  locale      text not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_service_translations unique (service_id, locale)
);

create index idx_service_translations_service on public.service_translations (service_id);

create table public.service_variant_translations (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.service_variants (id),
  locale      text not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_service_variant_translations unique (variant_id, locale)
);

create index idx_service_variant_translations_variant on public.service_variant_translations (variant_id);

create table public.service_addon_translations (
  id          uuid primary key default gen_random_uuid(),
  addon_id    uuid not null references public.service_addons (id),
  locale      text not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_service_addon_translations unique (addon_id, locale)
);

create index idx_service_addon_translations_addon on public.service_addon_translations (addon_id);

-- =====================================================================
-- service_addon_compatibility (Q3) — explicit allow-list; absence =
-- incompatible. Composite FKs keep all participants in the same branch.
-- =====================================================================
create table public.service_addon_compatibility (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  branch_id          uuid not null references public.branches (id),
  service_addon_id   uuid not null references public.service_addons (id),
  service_id         uuid not null references public.services (id),
  service_variant_id uuid references public.service_variants (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- NULL variant = applies to all variants of the service. NULLS NOT DISTINCT
  -- makes the natural key enforce one row per (addon, service[, variant]) even
  -- for the NULL-variant "all variants" case (spec: duplicate row → CONFLICT).
  constraint uq_service_addon_compatibility
    unique nulls not distinct (service_addon_id, service_id, service_variant_id),
  -- All participants must belong to the same branch (join cannot cross
  -- branch boundaries — spec "Cross-branch compatibility rejected").
  constraint fk_compat_addon_same_branch
    foreign key (service_addon_id, branch_id)
    references public.service_addons (id, branch_id),
  constraint fk_compat_service_same_branch
    foreign key (service_id, branch_id)
    references public.services (id, branch_id),
  constraint fk_compat_variant_same_branch
    foreign key (service_variant_id, branch_id)
    references public.service_variants (id, branch_id)
);

comment on table public.service_addon_compatibility is
  'Explicit allow-list (Q3): no row = add-on incompatible with the service/variant.';

create index idx_compat_addon on public.service_addon_compatibility (service_addon_id);
create index idx_compat_service on public.service_addon_compatibility (service_id);
create index idx_compat_branch on public.service_addon_compatibility (branch_id);


-- =====================================================================
-- service_slug_aliases (Q7) — audited redirect/alias mechanism.
-- Append-only history: aliases are never rewritten. Uniqueness prevents
-- two aliases claiming the same old slug (no chains) and reuse by a
-- different entity of the same type.
-- =====================================================================
create table public.service_slug_aliases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  entity_type     text not null
                  check (entity_type in ('service', 'service_variant', 'service_addon')),
  entity_id       uuid not null,
  old_slug        text not null,
  created_at      timestamptz not null default now(),

  constraint uq_service_slug_aliases unique (branch_id, entity_type, old_slug)
);

comment on table public.service_slug_aliases is
  'Published-slug redirects (Q7); created only by the audited rename operation.';

create index idx_slug_aliases_entity on public.service_slug_aliases (entity_type, entity_id);
create index idx_slug_aliases_branch on public.service_slug_aliases (branch_id);

-- entity_id integrity cannot use a plain FK (polymorphic target); enforced
-- in the domain service within the rename transaction.

-- =====================================================================
-- RLS — every table, enabled in its creation migration (0007 pattern;
-- no FORCE: owner-exemption so the 0006 SECURITY DEFINER helpers keep
-- working; anon/authenticated/service_role remain fully governed).
--
-- IMPORTANT: one combined policy per table, exactly like 0007's
-- branches_select — HQ roles get organization-wide visibility via
-- get_membership_role(); branch-scoped roles via has_branch_access().
-- Two separate permissive policies would be OR'd together and would leak
-- org-wide visibility to branch-scoped roles.
-- =====================================================================

alter table public.service_categories enable row level security;
create policy service_categories_select on public.service_categories
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.services enable row level security;
create policy services_select on public.services
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.service_variants enable row level security;
create policy service_variants_select on public.service_variants
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.service_addons enable row level security;
create policy service_addons_select on public.service_addons
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

-- Translation tables inherit the parent entity's scope (role-aware, 0007
-- pattern) — never org-wide for branch-scoped roles.
alter table public.service_category_translations enable row level security;
create policy service_category_translations_select on public.service_category_translations
  for select using (
    exists (
      select 1 from public.service_categories c
      where c.id = service_category_translations.category_id
        and (
          public.get_membership_role(auth.uid(), c.organization_id)
            in ('hq_admin', 'hq_staff')
          or public.has_branch_access(auth.uid(), c.branch_id)
        )
    )
  );

alter table public.service_translations enable row level security;
create policy service_translations_select on public.service_translations
  for select using (
    exists (
      select 1 from public.services s
      where s.id = service_translations.service_id
        and (
          public.get_membership_role(auth.uid(), s.organization_id)
            in ('hq_admin', 'hq_staff')
          or public.has_branch_access(auth.uid(), s.branch_id)
        )
    )
  );

alter table public.service_variant_translations enable row level security;
create policy service_variant_translations_select on public.service_variant_translations
  for select using (
    exists (
      select 1 from public.service_variants v
      where v.id = service_variant_translations.variant_id
        and (
          public.get_membership_role(auth.uid(), v.organization_id)
            in ('hq_admin', 'hq_staff')
          or public.has_branch_access(auth.uid(), v.branch_id)
        )
    )
  );

alter table public.service_addon_translations enable row level security;
create policy service_addon_translations_select on public.service_addon_translations
  for select using (
    exists (
      select 1 from public.service_addons a
      where a.id = service_addon_translations.addon_id
        and (
          public.get_membership_role(auth.uid(), a.organization_id)
            in ('hq_admin', 'hq_staff')
          or public.has_branch_access(auth.uid(), a.branch_id)
        )
    )
  );

alter table public.service_addon_compatibility enable row level security;
create policy service_addon_compatibility_select on public.service_addon_compatibility
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.service_slug_aliases enable row level security;
create policy service_slug_aliases_select on public.service_slug_aliases
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
