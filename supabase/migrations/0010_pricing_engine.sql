-- =====================================================================
-- 0010_pricing_engine.sql — Change 4A
-- openspec/changes/create-pricing-engine (decision record P1–P22,
-- docs/PRICING_ENGINE.md; docs/DATABASE.md §16 Change-4A scope).
--
-- Decisions encoded:
--   P12  pricing_profiles / pricing_versions / pricing_rules are
--        branch-owned: organization_id + branch_id NOT NULL on every row
--        (Q9 Change 1/2 convention). No org-level shared rows in V1.
--   P1   rules attach to an immutable pricing VERSION (never the profile).
--   P16  lifecycle draft → published → archived; published versions are
--        immutable (DB guard triggers — the only DB-expressible mechanism
--        for cross-row invariants; design §3.2 leaves the mechanism to
--        implementation). DELETE is rejected for published/archived
--        history; only draft rows are deletable.
--   P17  effective dating: at most one published version may cover any
--        service date per profile — EXCLUDE USING gist on the inclusive
--        daterange (btree_gist), matching the 0009 effective-range
--        semantics (effective_until inclusive).
--   P9   minimum-charge / minimum-billable-duration exist as typed rule
--        structures (rule_type values) but are INACTIVE in V1 — the engine
--        never applies them to Scheduling duration (money-only, P9).
--   P5   surcharge rule rows may exist for all four kinds (night,
--        emergency, holiday, sunday) — the V1 engine evaluates sunday only.
--   P6   discount structures are NOT created (no active discounts in V1);
--        the engine stage exists and contributes zero.
--   P7   tax is a version-level configuration structure (rate, jurisdiction)
--        stored in pricing_versions.configuration — INACTIVE until the
--        approved business value sheet provides a rate (P7b).
--   P8   currency lives on the profile, CHECK-validated ISO shape; the
--        domain layer validates it against the branch currency (P8).
--   Q5   no pricing data is written to catalog tables; composite same-branch
--        FKs to services/service_variants/service_addons (0008 pattern).
--
-- RLS: enabled in this creation migration, one combined policy per table
-- (0007/0008/0009 pattern: HQ roles org-wide via get_membership_role(),
-- branch roles via has_branch_access()). No FORCE: owner-exemption keeps
-- the 0006 SECURITY DEFINER helpers working.
-- =====================================================================

-- P17: range-overlap exclusion requires btree_gist (available on Supabase
-- and pglite contrib extensions).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- pricing_profiles (P11/P12) — grouping container; mutable.
-- ---------------------------------------------------------------------
create table public.pricing_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  name            text not null,
  description     text,
  currency        text not null,
  status          text not null default 'draft'
                  check (status in ('draft', 'active', 'archived')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_pricing_profiles_branch_name unique (branch_id, name),
  constraint ck_pricing_profiles_currency
    check (currency = upper(currency) and char_length(currency) = 3)
);

-- P11: at most ONE active profile per branch in V1 (partial unique index —
-- the schema permits any number of draft/archived profiles; service/customer
-- mapping is deferred). Mirrors the 0009 partial-index pattern.
create unique index uq_pricing_profiles_one_active_per_branch
  on public.pricing_profiles (branch_id)
  where status = 'active';

comment on table public.pricing_profiles is
  'Branch-owned pricing profile (P11/P12): version container; currency per profile (P8); exactly one active profile per branch in V1.';

-- Composite same-branch FK target (0008 pattern) — must exist before
-- pricing_versions declares its (pricing_profile_id, branch_id) FK.
alter table public.pricing_profiles
  add constraint uq_pricing_profiles_id_branch unique (id, branch_id);

create index idx_pricing_profiles_branch on public.pricing_profiles (branch_id);
create index idx_pricing_profiles_status on public.pricing_profiles (status);

-- ---------------------------------------------------------------------
-- pricing_versions (P1/P16/P17) — the immutable published unit.
-- ---------------------------------------------------------------------
create table public.pricing_versions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  pricing_profile_id  uuid not null,
  version_number      integer not null check (version_number >= 1),
  status              text not null default 'draft'
                      check (status in ('draft', 'published', 'archived')),
  effective_from      date not null,
  effective_until     date,
  -- P7/P7b: tax configuration STRUCTURE (rate + jurisdiction label). A rate
  -- is only ever filled from the approved business value sheet; null rate =
  -- inactive tax stage (engine yields explicit zero-tax results).
  tax_rate_percent    numeric(5, 4),
  tax_jurisdiction    text,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint fk_pricing_versions_profile
    foreign key (pricing_profile_id, branch_id)
    references public.pricing_profiles (id, branch_id)
    on delete cascade,
  constraint uq_pricing_versions_profile_number
    unique (pricing_profile_id, version_number),
  constraint ck_pricing_versions_effective_range
    check (effective_until is null or effective_until >= effective_from),
  constraint ck_pricing_versions_tax_shape
    check (
      (tax_rate_percent is null and tax_jurisdiction is null)
      or (tax_rate_percent is not null and tax_jurisdiction is not null
          and tax_rate_percent >= 0)
    ),
  -- Composite same-branch FK target for pricing_rules (0008 pattern).
  constraint uq_pricing_versions_id_branch unique (id, branch_id)
);

comment on table public.pricing_versions is
  'Immutable published pricing version (P1/P16): rules attach here; effective dating per P17; tax structure per P7 (inactive until P7b values).';

create index idx_pricing_versions_profile on public.pricing_versions (pricing_profile_id);
create index idx_pricing_versions_branch on public.pricing_versions (branch_id);
create index idx_pricing_versions_status_effective
  on public.pricing_versions (status, effective_from);

-- P17: overlapping published effective windows per profile are rejected by
-- constraint. Windows are inclusive on both ends (0009 effective-dating
-- semantics: effective_until is covered).
alter table public.pricing_versions
  add constraint ex_pricing_versions_published_no_overlap
  exclude using gist (
    pricing_profile_id with =,
    daterange(effective_from, effective_until, '[]') with &&
  )
  where (status = 'published');

-- P16: published versions are immutable. The only permitted transition is
-- published → archived (status + updated_at); every other mutation and any
-- DELETE of published/archived history is rejected at the database level.
create function public.pricing_versions_immutable_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Container teardown (profile/branch/org deletion) cascades through this
    -- table at trigger depth > 1 — a referential action, not a content
    -- mutation. Direct deletes of published/archived history stay rejected.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if old.status in ('published', 'archived') then
      raise exception 'published or archived pricing versions cannot be deleted (P16)'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- Archived rows are history: completely immutable.
  if old.status = 'archived' then
    raise exception 'archived pricing versions are immutable (P16)'
      using errcode = 'check_violation';
  end if;

  -- Published rows: content frozen; the ONLY permitted change is the
  -- transition to archived with identical content (updated_at bookkeeping
  -- aside).
  if old.status = 'published' then
    if new.status = 'archived'
       and row(new.version_number, new.effective_from, new.effective_until,
               new.tax_rate_percent, new.tax_jurisdiction, new.pricing_profile_id)
           is not distinct from
           row(old.version_number, old.effective_from, old.effective_until,
               old.tax_rate_percent, old.tax_jurisdiction, old.pricing_profile_id)
    then
      return new;
    end if;
    if new.status = 'published'
       and row(new.version_number, new.effective_from, new.effective_until,
               new.tax_rate_percent, new.tax_jurisdiction, new.pricing_profile_id)
           is not distinct from
           row(old.version_number, old.effective_from, old.effective_until,
               old.tax_rate_percent, old.tax_jurisdiction, old.pricing_profile_id)
    then
      return new; -- no-op bookkeeping update
    end if;
    raise exception 'published pricing versions are immutable; only archiving is permitted (P16)'
      using errcode = 'check_violation';
  end if;

  return new; -- draft rows are freely editable
end;
$$;

create trigger trg_pricing_versions_immutable
  before update or delete on public.pricing_versions
  for each row execute function public.pricing_versions_immutable_guard();

-- ---------------------------------------------------------------------
-- pricing_rules (P1) — version-attached typed rules. No pricing data is
-- ever written to catalog tables (Q5).
-- ---------------------------------------------------------------------
create table public.pricing_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  pricing_version_id  uuid not null,
  rule_type           text not null check (
    rule_type in (
      'base_rate', 'duration_rule', 'difficulty', 'addon_price', 'surcharge',
      'minimum_charge', 'minimum_duration' -- P9 structures (inactive in V1)
    )
  ),
  -- Target refs: stable catalog identities, same-branch enforced (0008
  -- composite-FK pattern). Nullability per rule semantics.
  service_id          uuid,
  service_variant_id  uuid,
  service_addon_id    uuid,
  -- Property-factor scoping (optional): e.g. min/max rooms for a rule.
  min_value           numeric,
  max_value           numeric,
  multiplier          numeric,
  fixed_amount        numeric check (fixed_amount is null or fixed_amount >= 0),
  -- Rule-specific parameters — Zod-validated per rule_type at the domain
  -- layer (DATABASE.md §46: JSONB never unstructured).
  configuration       jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint fk_pricing_rules_version
    foreign key (pricing_version_id, branch_id)
    references public.pricing_versions (id, branch_id)
    on delete cascade,
  constraint fk_pricing_rules_service_same_branch
    foreign key (service_id, branch_id)
    references public.services (id, branch_id),
  constraint fk_pricing_rules_variant_same_branch
    foreign key (service_variant_id, branch_id)
    references public.service_variants (id, branch_id),
  constraint fk_pricing_rules_addon_same_branch
    foreign key (service_addon_id, branch_id)
    references public.service_addons (id, branch_id)
);

comment on table public.pricing_rules is
  'Version-attached pricing rules (P1): base_rate, duration_rule, difficulty, addon_price, surcharge (P5 kinds), minimum structures (P9, inactive in V1). Never written into catalog tables (Q5).';

create index idx_pricing_rules_version on public.pricing_rules (pricing_version_id);
create index idx_pricing_rules_branch on public.pricing_rules (branch_id);
create index idx_pricing_rules_service on public.pricing_rules (service_id);
create index idx_pricing_rules_addon on public.pricing_rules (service_addon_id);

-- P1: rules of a non-draft version are immutable. The guard resolves the
-- parent version status and rejects UPDATE/DELETE against published or
-- archived versions; changing a rule's version linkage is always rejected.
create function public.pricing_rules_immutable_guard() returns trigger
language plpgsql as $$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' then
    -- Cascade teardown from version/profile deletion (depth > 1) is a
    -- referential action; direct deletes of protected rules stay rejected.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    select status into parent_status from public.pricing_versions
      where id = old.pricing_version_id;
    if parent_status in ('published', 'archived') then
      raise exception 'rules of published or archived versions are immutable (P1/P16)'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.pricing_version_id is distinct from old.pricing_version_id then
    raise exception 'a rule cannot be moved between versions (P1)'
      using errcode = 'check_violation';
  end if;

  select status into parent_status from public.pricing_versions
    where id = new.pricing_version_id;
  if parent_status in ('published', 'archived') then
    raise exception 'rules of published or archived versions are immutable (P1/P16)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_pricing_rules_immutable
  before update or delete on public.pricing_rules
  for each row execute function public.pricing_rules_immutable_guard();

-- =====================================================================
-- RLS — one combined policy per table (0007/0008/0009 pattern, no FORCE).
-- Mutations flow exclusively through the privileged domain layer.
-- =====================================================================

alter table public.pricing_profiles enable row level security;
create policy pricing_profiles_select on public.pricing_profiles
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.pricing_versions enable row level security;
create policy pricing_versions_select on public.pricing_versions
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.pricing_rules enable row level security;
create policy pricing_rules_select on public.pricing_rules
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
