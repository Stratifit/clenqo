-- =====================================================================
-- 0012_worker.sql — Change 6 (create-worker)
-- openspec/changes/create-worker/design.md §3 (conceptual schema made
-- concrete); normative decision record BD-W1…BD-W13.
--
-- Decisions encoded:
--   BD-W1   employee_branches is the authoritative employee↔branch
--           authorization relationship (many-to-many); NO scalar
--           employees.branch_id authorization column exists.
--   BD-W2   employees.status CHECK carries exactly active /
--           temporarily_unavailable / on_leave / inactive (no suspended);
--           deactivation blocks NEW assignments (validator-level) while
--           all history is preserved.
--   BD-W3   employment_type CHECK carries exactly full_time / part_time /
--           minijob / flexible (no on_call in V1).
--   BD-W4   jobs.booking_id is nullable (internal operational jobs are
--           documented, WORKER §15/§17) with a PARTIAL UNIQUE index:
--           at most one job per booking — extensible to future
--           multi-job bookings by constraint relaxation alone.
--   BD-W5   job_number CHECK-enforced format JOB-<year>-<seq 6 digits>,
--           UNIQUE per organization; job_number_sequences holds ONE
--           monotonic counter per organization that NEVER resets — the
--           year component is derived from the source booking's
--           branch-local scheduled_start, so a year boundary cannot
--           create duplicates (identical rationale to BD-5/0011).
--           EMP- numbering follows the same discipline (DATABASE §58).
--   BD-W6   Job creation happens post-commit via the Worker domain;
--           the partial unique index is the convergence guarantee.
--   BD-W7a  NO cross-domain table writes: jobs reference bookings
--           read-only; derived booking transitions flow through the
--           Booking-owned contract in the domain layer.
--   BD-W7d  incidents carries a no_show type; NO new job state exists.
--   BD-W8   job_assignments partial UNIQUE: at most ONE non-terminal
--           (active/pending) assignment per job; table stays multi-row
--           for future team cleaning; rows are never deleted.
--   BD-W9   V1 writes only active/completed/cancelled assignment
--           statuses; pending/accepted/declined remain reserved
--           (CHECK allows them for the future acceptance workflow).
--   BD-W10  No cleaner-PWA, checklist, photo/storage, messaging,
--           payment, payroll, or automatic-assignment tables.
--   BD-W11  employee_skills.skill_key is CHECK-constrained to the
--           documented key namespace (NOT a registry table); level is
--           reserved with no V1 semantics; NO seed content.
--   BD-W12  employees.user_id is NULLABLE (records may exist without
--           app access); memberships/membership_branches remain the
--           RLS anchor; employee_branches is operational eligibility.
--   BD-W13  Scheduling occupancy is NOT changed here (bookings remain
--           the single source); the Change 3 speculative jobs probe is
--           removed in the application layer (TD-W10).
--
-- RLS: enabled in this creation migration, one combined policy per
-- table (0007/0008/0009/0010/0011 pattern) — HQ org-wide, branch via
-- has_branch_access(), cleaner role scoped to own employee row / own
-- assignments / own assigned jobs via exists-subselects. No FORCE:
-- owner-exemption keeps the 0006 SECURITY DEFINER helpers working.
-- =====================================================================

-- ---------------------------------------------------------------------
-- employee_number_sequences (BD-W5 discipline, DATABASE §58) — ONE
-- monotonic counter per organization for EMP-<seq> numbers.
-- ---------------------------------------------------------------------
create table public.employee_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_sequence   bigint not null default 0 check (last_sequence >= 0),
  updated_at      timestamptz not null default now()
);

comment on table public.employee_number_sequences is
  'Per-organization monotonic employee-number counter (BD-W5 discipline, DATABASE §58 EMP-000001); allocation is transactional (row lock) and never resets.';

-- ---------------------------------------------------------------------
-- employees — organization-scoped operational records (BD-W2/W3/W12).
-- ---------------------------------------------------------------------
create table public.employees (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  employee_number     text not null,
  first_name          text not null,
  last_name           text not null,
  phone               text,
  email               text,
  preferred_language  text,
  employment_type     text not null default 'full_time'
                      check (employment_type in ('full_time', 'part_time', 'minijob', 'flexible')),
  status              text not null default 'active'
                      check (status in ('active', 'temporarily_unavailable', 'on_leave', 'inactive')),
  hire_date           date,
  termination_date    date,
  -- BD-W12: nullable Auth linkage; records may exist without app access.
  user_id             uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_employees_org_number unique (organization_id, employee_number),
  constraint ck_employees_number_format
    check (employee_number ~ '^EMP-[0-9]{6}$'),
  constraint ck_employees_names_present
    check (length(trim(first_name)) > 0 and length(trim(last_name)) > 0),
  constraint ck_employees_termination_after_hire
    check (termination_date is null or hire_date is null or termination_date >= hire_date)
);

create index idx_employees_org_status on public.employees (organization_id, status);
create index idx_employees_user on public.employees (user_id);

comment on table public.employees is
  'Workforce records (BD-W2/W3/W12): employment status is distinct from application role; user_id nullable; branch authorization lives in employee_branches (BD-W1).';

-- ---------------------------------------------------------------------
-- employee_branches (BD-W1) — the authoritative many-to-many
-- employee↔branch authorization relationship.
-- ---------------------------------------------------------------------
create table public.employee_branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  branch_id       uuid not null references public.branches (id),
  created_at      timestamptz not null default now(),
  constraint uq_employee_branches unique (employee_id, branch_id)
);

create index idx_employee_branches_branch on public.employee_branches (branch_id);
create index idx_employee_branches_employee on public.employee_branches (employee_id);

comment on table public.employee_branches is
  'Authoritative employee↔branch authorization (BD-W1, EM-003): one-or-more branches per employee; the scalar branch_id model is deliberately not used.';

-- ---------------------------------------------------------------------
-- employee_skills (BD-W11) — org-wide skill_key strings with
-- qualification metadata; NOT a registry table; no seed content.
-- ---------------------------------------------------------------------
create table public.employee_skills (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id),
  employee_id          uuid not null references public.employees (id) on delete cascade,
  skill_key            text not null,
  qualification_status text check (qualification_status in ('pending', 'qualified', 'expired')),
  qualification_date   date,
  expiry_date          date,
  -- BD-W11: reserved column, no V1 semantics.
  level                integer,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_employee_skills unique (employee_id, skill_key),
  constraint ck_employee_skills_key_namespace
    check (skill_key in (
      'home_cleaning', 'deep_cleaning', 'commercial_cleaning',
      'move_out_cleaning', 'specialized_cleaning', 'window_cleaning'
    )),
  constraint ck_employee_skills_expiry_shape
    check (expiry_date is null or qualification_date is null or expiry_date >= qualification_date)
);

create index idx_employee_skills_employee on public.employee_skills (employee_id);
create index idx_employee_skills_key on public.employee_skills (skill_key);

comment on table public.employee_skills is
  'Employee skills (BD-W11): documented skill_key namespace (WORKER §9 / DATABASE §24 / SCHEDULING §15), qualification metadata per WORKER §10; level reserved.';

-- ---------------------------------------------------------------------
-- employee_availability (TD-W6 / DATABASE §25.1) — recurring weekly
-- windows with effective dating.
-- ---------------------------------------------------------------------
create table public.employee_availability (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  start_time      time not null,
  end_time        time not null,
  effective_from  date not null default current_date,
  effective_until date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_employee_availability_window check (end_time > start_time),
  constraint ck_employee_availability_range
    check (effective_until is null or effective_until >= effective_from)
);

create index idx_employee_availability_employee on public.employee_availability (employee_id, weekday);

comment on table public.employee_availability is
  'Recurring weekly employee availability (DATABASE §25.1, WORKER §12); interpreted in the branch timezone at evaluation time.';

-- ---------------------------------------------------------------------
-- employee_availability_exceptions (TD-W6 / DATABASE §25.2) — typed
-- date/time overrides; unavailable overrides recurring windows,
-- available widens them.
-- ---------------------------------------------------------------------
create table public.employee_availability_exceptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  exception_type  text not null check (exception_type in ('unavailable', 'available')),
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_employee_availability_exceptions_window check (end_at > start_at)
);

create index idx_employee_availability_exceptions_employee
  on public.employee_availability_exceptions (employee_id, start_at, end_at);

comment on table public.employee_availability_exceptions is
  'Date/time-scoped availability exceptions (DATABASE §25.2, WORKER §13): override the recurring schedule in their window.';

-- ---------------------------------------------------------------------
-- job_number_sequences (BD-W5) — ONE monotonic counter per
-- organization for JOB-<year>-<seq> numbers; year from the source
-- booking's branch-local scheduled_start (TD-W5).
-- ---------------------------------------------------------------------
create table public.job_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_sequence   bigint not null default 0 check (last_sequence >= 0),
  updated_at      timestamptz not null default now()
);

comment on table public.job_number_sequences is
  'Per-organization monotonic job-number counter (BD-W5); allocation is transactional (row lock) and never resets, keeping JOB-<year>-<seq> unique across year boundaries.';

-- ---------------------------------------------------------------------
-- jobs — operational work items (BD-W4/W5/W7a/W11/TD-W3).
-- ---------------------------------------------------------------------
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id),
  branch_id             uuid not null references public.branches (id),
  -- BD-W4: nullable (internal jobs documented, WORKER §15/§17); V1
  -- creates jobs only from bookings; partial UNIQUE enforces one per
  -- booking while the schema stays extensible to multi-job bookings.
  booking_id            uuid references public.bookings (id),
  job_number            text not null,
  status                text not null default 'pending'
                        check (status in (
                          'pending', 'assigned', 'en_route', 'checked_in',
                          'in_progress', 'completed', 'cancelled'
                        )),
  scheduled_start       timestamptz not null,
  scheduled_end         timestamptz not null,
  timezone              text not null,
  -- TD-W3: immutable operational snapshot (service/variant/add-on
  -- labels, address snapshot, minimized customer display, property
  -- details, instructions, booking number). Pricing is NEVER copied —
  -- pricing_version_id is a reference only (Pricing ownership).
  job_snapshot          jsonb not null,
  required_skills       text[] not null default '{}',
  pricing_version_id    uuid,
  -- BD-W7b: manager-replacement flag when reschedule revalidation fails.
  assignment_flag_reason text,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_jobs_org_number unique (organization_id, job_number),
  constraint ck_jobs_number_format check (job_number ~ '^JOB-[0-9]{4}-[0-9]{6}$'),
  constraint ck_jobs_window check (scheduled_end > scheduled_start),
  constraint ck_jobs_required_skills_namespace
    check (required_skills <@ array[
      'home_cleaning', 'deep_cleaning', 'commercial_cleaning',
      'move_out_cleaning', 'specialized_cleaning', 'window_cleaning'
    ]::text[]),
  constraint ck_jobs_terminal_metadata
    check (
      (status <> 'completed' or completed_at is not null)
      and (status <> 'cancelled' or (cancelled_at is not null and cancellation_reason is not null))
    )
);

-- BD-W4: at most one job per booking (partial — internal jobs without
-- bookings are unaffected; future multi-job needs relaxation only).
create unique index uq_jobs_one_per_booking on public.jobs (booking_id) where booking_id is not null;

create index idx_jobs_branch_window on public.jobs (branch_id, scheduled_start);
create index idx_jobs_booking on public.jobs (booking_id);
create index idx_jobs_status on public.jobs (status);

comment on table public.jobs is
  'Operational work items (BD-W4/W5/W7a): created by the Worker domain from confirmed bookings (post-commit, idempotent); the snapshot is immutable operational data; pricing is referenced, never copied.';

-- ---------------------------------------------------------------------
-- job_assignments (BD-W8/W9) — multi-row table with the V1 one-active
-- invariant enforced by partial unique index.
-- ---------------------------------------------------------------------
create table public.job_assignments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id),
  branch_id         uuid not null references public.branches (id),
  job_id            uuid not null references public.jobs (id),
  employee_id       uuid not null references public.employees (id),
  assignment_status text not null default 'active'
                    check (assignment_status in ('pending', 'accepted', 'declined', 'active', 'completed', 'cancelled')),
  assigned_at       timestamptz not null default now(),
  assigned_by       uuid,
  -- Reserved for the future acceptance workflow (BD-W9): not written in V1.
  accepted_at       timestamptz,
  declined_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- BD-W8: at most ONE non-terminal assignment per job at any commit.
create unique index uq_job_assignments_one_active
  on public.job_assignments (job_id)
  where assignment_status in ('active', 'pending');

create index idx_job_assignments_employee on public.job_assignments (employee_id, assignment_status);
create index idx_job_assignments_job on public.job_assignments (job_id);
create index idx_job_assignments_branch on public.job_assignments (branch_id);

comment on table public.job_assignments is
  'Job assignments (BD-W8/W9): structurally multi-row for future team cleaning; V1 enforces one non-terminal assignment per job; rows are history — never deleted.';

-- ---------------------------------------------------------------------
-- job_events — append-only operational history (WORKER §66).
-- ---------------------------------------------------------------------
create table public.job_events (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id     uuid not null references public.branches (id),
  job_id        uuid not null references public.jobs (id),
  event_type    text not null check (event_type in (
                  'job_created', 'job_assigned', 'job_unassigned', 'job_rescheduled',
                  'job_started', 'check_in', 'check_out', 'job_completed',
                  'job_cancelled', 'incident_reported', 'assignment_flagged'
                )),
  metadata      jsonb not null default '{}'::jsonb,
  actor_type    text not null default 'system' check (actor_type in ('staff', 'system', 'customer')),
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);

create index idx_job_events_job on public.job_events (job_id, created_at);

-- Append-only guard (0011 booking_events pattern).
create or replace function public.job_events_append_only_guard() returns trigger as $$
begin
  raise exception 'job_events are append-only (WORKER §66)'
    using errcode = 'check_violation';
end;
$$ language plpgsql;

create trigger trg_job_events_append_only
  before update or delete on public.job_events
  for each row execute function public.job_events_append_only_guard();

comment on table public.job_events is
  'Append-only job history (WORKER §66): updates and deletes are rejected by trigger; payloads per design TD-W8 with sensitive-data minimization.';

-- ---------------------------------------------------------------------
-- incidents — minimal model (DATABASE §29 + BD-W7d no_show).
-- ---------------------------------------------------------------------
create table public.incidents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  job_id          uuid not null references public.jobs (id),
  reported_by     uuid,
  incident_type   text not null check (incident_type in (
                    'no_show', 'property_damage', 'access_problem', 'customer_issue',
                    'cleaner_issue', 'safety_issue', 'late_arrival'
                  )),
  severity        text check (severity in ('low', 'medium', 'high', 'critical')),
  description     text,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index idx_incidents_job on public.incidents (job_id);
create index idx_incidents_branch on public.incidents (branch_id, status);

comment on table public.incidents is
  'Minimal incident records (DATABASE §29; BD-W7d): no_show incidents accompany job cancellation when a booking becomes no_show; no quality workflow in Change 6.';

-- =====================================================================
-- notification_outbox extension for Worker events (design §11; BD-W10:
-- worker emits documented outbox events; delivery stays external).
--
-- Change 5 scoped the outbox to booking emails: booking_id was NOT NULL
-- and the event_type CHECK covered only booking email types. Change 6
-- adds worker-sourced events (job_created / job_assigned /
-- job_unassigned / job_cancelled) which are booking-optional, so the
-- column becomes nullable and the CHECK is widened. Existing booking
-- semantics (values, NOT NULL at insert time from booking flows) are
-- unchanged.
-- =====================================================================
alter table public.notification_outbox
  alter column booking_id drop not null;

alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
  check (event_type in (
    'booking_confirmation_email', 'booking_cancellation_email',
    'booking_reschedule_email', 'magic_link_email',
    'job_created', 'job_assigned', 'job_unassigned', 'job_cancelled'
  ));

comment on constraint notification_outbox_event_type_check on public.notification_outbox is
  'Change 6 (BD-W10): widened with worker event types; booking email types unchanged.';

-- =====================================================================
-- RLS — one combined policy per table (established pattern, no FORCE).
-- HQ org-wide via get_membership_role(); branch via has_branch_access();
-- cleaner role scoped to own employee row / own assignments / own
-- assigned jobs via exists-subselects (TD-W2). Mutations flow through
-- the privileged domain layer; no application-role write policies.
-- =====================================================================

alter table public.employee_number_sequences enable row level security;
create policy employee_number_sequences_select on public.employee_number_sequences
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

-- Employees: branch scope through the SECURITY DEFINER helper below so the
-- employees policy never opens employee_branches directly (its policy opens
-- job_assignments — mutual visibility would recurse).
create or replace function public.has_employee_branch_access(
  p_user_id uuid,
  p_employee_id uuid
) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.employee_branches eb
    where eb.employee_id = p_employee_id
      and public.has_branch_access(p_user_id, eb.branch_id)
  );
$$;

alter table public.employees enable row level security;
create policy employees_select on public.employees
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_employee_branch_access(auth.uid(), employees.id)
    or user_id = auth.uid()
  );

alter table public.employee_branches enable row level security;
create policy employee_branches_select on public.employee_branches
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.branch_id = employee_branches.branch_id
           and e.user_id = auth.uid()
       )
  );

-- Employee-subdata tables (skills / availability / exceptions): the branch
-- scope comes from has_employee_branch_access (SECURITY DEFINER, above),
-- which reads employee_branches without RLS — same pattern as 0006 helpers
-- reading membership_branches. This keeps the employees ↔ employee_branches
-- policies from recursing while branch managers and linked cleaners retain
-- exactly their scoped view.

alter table public.employee_skills enable row level security;
create policy employee_skills_select on public.employee_skills
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_employee_branch_access(auth.uid(), employee_skills.employee_id)
    or exists (
         select 1 from public.employees e
         where e.id = employee_skills.employee_id and e.user_id = auth.uid()
       )
  );

alter table public.employee_availability enable row level security;
create policy employee_availability_select on public.employee_availability
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_employee_branch_access(auth.uid(), employee_availability.employee_id)
    or exists (
         select 1 from public.employees e
         where e.id = employee_availability.employee_id and e.user_id = auth.uid()
       )
  );

alter table public.employee_availability_exceptions enable row level security;
create policy employee_availability_exceptions_select on public.employee_availability_exceptions
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_employee_branch_access(auth.uid(), employee_availability_exceptions.employee_id)
    or exists (
         select 1 from public.employees e
         where e.id = employee_availability_exceptions.employee_id and e.user_id = auth.uid()
       )
  );

alter table public.job_number_sequences enable row level security;
create policy job_number_sequences_select on public.job_number_sequences
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

alter table public.jobs enable row level security;
create policy jobs_select on public.jobs
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.job_id = jobs.id
           and ja.assignment_status in ('active', 'pending')
           and e.user_id = auth.uid()
       )
  );

alter table public.job_assignments enable row level security;
create policy job_assignments_select on public.job_assignments
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1 from public.employees e
         where e.id = job_assignments.employee_id and e.user_id = auth.uid()
       )
  );

alter table public.job_events enable row level security;
create policy job_events_select on public.job_events
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.job_id = job_events.job_id
           and ja.assignment_status in ('active', 'pending')
           and e.user_id = auth.uid()
       )
  );

alter table public.incidents enable row level security;
create policy incidents_select on public.incidents
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
