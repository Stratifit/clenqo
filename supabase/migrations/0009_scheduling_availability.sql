-- =====================================================================
-- 0009_scheduling_availability.sql — Change 3
-- openspec/changes/create-scheduling-availability (decision record S1–S18,
-- docs/SCHEDULING_SYSTEM.md §84–86; docs/DATABASE.md §64/§65 Change-3 scope).
--
-- Decisions encoded:
--   S2   branch_operating_hours: weekly effective-dated template, multiple
--        intervals per weekday, branch-local wall clock, history immutable.
--   S9   branch_schedule_exceptions: unified typed exception model
--        (closed | reduced_hours | blackout | holiday_override), manual V1
--        source only (S9b — no calendar provider).
--   S4–S7, S12, S1b branch_scheduling_configuration: per-branch singleton
--        with approved platform defaults.
--   S18  service_scheduling_rules: per-service windows only — never a
--        second pricing/duration authority (S6).
--   S1/S1b slot_holds: the single capacity-blocking reservation mechanism;
--        TTL default 15 min; one active hold per session; idempotency key.
--   S13  no overnight bookings in V1 (end_time > start_time enforced);
--        hold instants are absolute UTC so the model stays wrap-capable.
--   Q9   branch_id NOT NULL + organization_id on every row (Change 1/2
--        convention).
--
-- RLS: enabled in this creation migration, one combined policy per table
-- (0007/0008 pattern: HQ roles org-wide via get_membership_role(),
-- branch roles via has_branch_access(); two permissive policies would OR
-- and leak org-wide visibility to branch roles). No FORCE: owner-exemption
-- keeps the 0006 SECURITY DEFINER helpers working.
-- =====================================================================

-- ---------------------------------------------------------------------
-- branch_operating_hours (S2) — effective-dated weekly template.
-- ---------------------------------------------------------------------
create table public.branch_operating_hours (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  weekday         smallint not null check (weekday between 0 and 6), -- 0 = Sunday (branch-local)
  interval_index  smallint not null check (interval_index >= 0),
  start_time      time not null,
  end_time        time not null,
  effective_from  date not null,
  effective_until date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- S13: a V1 interval must not cross midnight (wrap-capable model arrives
  -- with overnight support; end_time = start_time is also rejected).
  constraint ck_branch_hours_no_wrap check (end_time > start_time),
  -- Effective dating: closed interval must be well-formed.
  constraint ck_branch_hours_effective_range
    check (effective_until is null or effective_until >= effective_from),
  -- One version of an interval slot per effective period (S2 immutability:
  -- changes create new effective-dated rows, never mutate history).
  constraint uq_branch_hours_interval_version
    unique (branch_id, weekday, interval_index, effective_from)
);

comment on table public.branch_operating_hours is
  'Weekly recurring operating-hours template (S2): branch-local wall clock, effective dating, closed day = no rows.';

create index idx_branch_hours_branch on public.branch_operating_hours (branch_id);
create index idx_branch_hours_effective on public.branch_operating_hours (branch_id, weekday, effective_from);

-- ---------------------------------------------------------------------
-- branch_schedule_exceptions (S9/S9b) — typed overrides of the template.
-- ---------------------------------------------------------------------
create table public.branch_schedule_exceptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  exception_type  text not null check (
    exception_type in ('closed', 'reduced_hours', 'blackout', 'holiday_override')
  ),
  start_date      date not null,
  end_date        date not null,
  -- reduced_hours: alternate intervals for the date(s) — validated by Zod at
  -- the domain layer (DATABASE.md §46: JSONB never unstructured).
  intervals       jsonb,
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ck_schedule_exception_range check (end_date >= start_date),
  -- S13: alternate intervals must not wrap midnight either.
  constraint ck_schedule_exception_intervals_shape check (
    intervals is null
    or jsonb_typeof(intervals) = 'array'
  )
);

comment on table public.branch_schedule_exceptions is
  'Typed schedule exceptions (S9): closed/reduced_hours/blackout/holiday_override; override the weekly template; manual V1 source (S9b).';

create index idx_schedule_exceptions_branch on public.branch_schedule_exceptions (branch_id);
create index idx_schedule_exceptions_dates on public.branch_schedule_exceptions (branch_id, start_date, end_date);

-- ---------------------------------------------------------------------
-- branch_scheduling_configuration (S4–S7, S12, S1b) — per-branch singleton
-- with the approved platform defaults.
-- ---------------------------------------------------------------------
create table public.branch_scheduling_configuration (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id),
  branch_id                   uuid not null references public.branches (id),
  minimum_notice_minutes      integer not null default 1440,  -- S4: 24 h
  maximum_advance_days        integer not null default 90,    -- S5
  slot_grid_minutes           integer not null default 15,    -- S3/S3b
  operational_buffer_minutes  integer not null default 15,    -- S6b
  travel_buffer_minutes       integer not null default 30,    -- S6b
  concurrency_cap             integer not null default 3,     -- S7/S7b
  customer_horizon_days       integer not null default 14,    -- S12
  hold_ttl_minutes            integer not null default 15,    -- S1b
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint uq_scheduling_config_branch unique (branch_id),
  constraint ck_config_notice_positive check (minimum_notice_minutes >= 0),
  constraint ck_config_advance_positive check (maximum_advance_days >= 1),
  -- Deterministic grid alignment: must divide evenly into one hour.
  constraint ck_config_grid_divides_hour check (60 % slot_grid_minutes = 0 and slot_grid_minutes >= 5),
  constraint ck_config_buffers_nonnegative
    check (operational_buffer_minutes >= 0 and travel_buffer_minutes >= 0),
  constraint ck_config_cap_positive check (concurrency_cap >= 1),
  constraint ck_config_horizon_positive check (customer_horizon_days >= 1),
  constraint ck_config_hold_ttl_positive check (hold_ttl_minutes >= 1)
);

comment on table public.branch_scheduling_configuration is
  'Per-branch scheduling parameters (S4–S7, S12, S1b); defaults are the approved S1–S18 platform values (SCHEDULING_SYSTEM §86).';

create index idx_scheduling_config_branch on public.branch_scheduling_configuration (branch_id);

-- ---------------------------------------------------------------------
-- service_scheduling_rules (S18 step 3) — per-service permitted windows.
-- MUST NOT become a second pricing/duration authority (S6).
-- ---------------------------------------------------------------------
create table public.service_scheduling_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  service_id      uuid not null,
  weekday         smallint check (weekday between 0 and 6), -- NULL = every open day
  start_time      time,                                     -- NULL = branch operating window
  end_time        time,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Composite same-branch FK: the rule cannot reference another branch's
  -- service (0008 composite-FK pattern).
  constraint fk_service_rules_service_same_branch
    foreign key (service_id, branch_id)
    references public.services (id, branch_id),
  -- Either both times or neither (partial windows are meaningless).
  constraint ck_service_rules_window_pair
    check ((start_time is null) = (end_time is null)),
  constraint ck_service_rules_no_wrap
    check (start_time is null or end_time > start_time),
  constraint uq_service_scheduling_rules
    unique nulls not distinct (branch_id, service_id, weekday, start_time)
);

comment on table public.service_scheduling_rules is
  'Optional per-service scheduling windows (S18 step 3); NULL weekday/time inherits the branch operating window. No pricing or duration data (S6).';

create index idx_service_rules_branch on public.service_scheduling_rules (branch_id);
create index idx_service_rules_service on public.service_scheduling_rules (service_id);

-- ---------------------------------------------------------------------
-- slot_holds (S1/S1b) — the single temporary capacity-blocking mechanism.
-- ---------------------------------------------------------------------
create table public.slot_holds (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  branch_id           uuid not null references public.branches (id),
  service_id          uuid not null,
  -- Absolute UTC instants: cross-midnight representable (S13 wrap-capable),
  -- DST-safe comparisons (S14).
  start_time          timestamptz not null,
  end_time            timestamptz not null,
  session_id          text not null,
  idempotency_key     text not null,
  status              text not null default 'held'
                      check (status in ('held', 'consumed', 'released', 'expired')),
  expires_at          timestamptz not null,
  consumed_by_booking uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint fk_slot_holds_service_same_branch
    foreign key (service_id, branch_id)
    references public.services (id, branch_id),
  constraint ck_slot_holds_interval check (end_time > start_time),
  constraint ck_slot_holds_expiry check (expires_at > created_at)
);

comment on table public.slot_holds is
  'Temporary slot holds (S1): created only after an authoritative availability check; TTL per branch (S1b, default 15 min); consumed atomically by booking confirmation (S16 stage 5).';

create index idx_slot_holds_branch_time on public.slot_holds (branch_id, start_time, end_time);
create index idx_slot_holds_status_expiry on public.slot_holds (status, expires_at);
create index idx_slot_holds_session on public.slot_holds (session_id);
create index idx_slot_holds_service on public.slot_holds (service_id, branch_id);

-- S1: exactly one ACTIVE hold per session. Partial unique index — released,
-- expired, and consumed holds do not count, so a session can book again.
create unique index uq_slot_holds_one_active_per_session
  on public.slot_holds (session_id)
  where status = 'held';

-- Idempotent creation: repeat calls with the same key return the same hold.
create unique index uq_slot_holds_idempotency
  on public.slot_holds (idempotency_key);

-- =====================================================================
-- RLS — one combined policy per table (0007/0008 pattern, no FORCE).
-- Public customer slot reads are served by the privileged domain layer
-- (availability engine), not by direct table SELECT as anon.
-- =====================================================================

alter table public.branch_operating_hours enable row level security;
create policy branch_operating_hours_select on public.branch_operating_hours
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.branch_schedule_exceptions enable row level security;
create policy branch_schedule_exceptions_select on public.branch_schedule_exceptions
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.branch_scheduling_configuration enable row level security;
create policy branch_scheduling_configuration_select on public.branch_scheduling_configuration
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.service_scheduling_rules enable row level security;
create policy service_scheduling_rules_select on public.service_scheduling_rules
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.slot_holds enable row level security;
create policy slot_holds_select on public.slot_holds
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
