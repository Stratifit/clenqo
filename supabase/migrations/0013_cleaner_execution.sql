-- =====================================================================
-- 0013_cleaner_execution.sql — Change 7 (create-cleaner-pwa)
-- openspec/changes/create-cleaner-pwa/design.md §3 (conceptual schema made
-- concrete); normative decision record BD-C1…BD-C9.
--
-- Decisions encoded:
--   BD-C2  Cleaner execution lifecycle triggers (assigned → en_route →
--         checked_in → in_progress → completed; direct assigned →
--         checked_in permitted). No new job states — only execution
--         timestamps are added. NO location/GPS columns exist (BD-C6)
--         and NO signature columns exist (BD-C8).
--   BD-C3  Service-level checklist definitions (versioned templates,
--         Worker-owned) copied into an immutable per-job snapshot at the
--         first execution action; item completion records provenance
--         (status/completed_at/completed_by/notes). No production seed
--         content. The Service Catalog does not own execution state.
--   BD-C4  Job media linkage: private, job-scoped, categories exactly
--         before / after / incident_evidence; incident_evidence requires
--         a linked incident. Binary objects stay in private Storage —
--         only metadata lives here. Deduplication per (job, path).
--   BD-C5  No offline/replication structures.
--   BD-C7  No delivery infrastructure — in-app surface consumes the
--         existing job_events / notification_outbox intents.
--
-- jobs execution timestamps — consistency CHECKs follow the 0012 style
-- (state-conditional implications, not equivalences): the documented
-- staff-authoritative override path (BD-C9: manager may complete an
-- assigned job without cleaner execution steps) must remain valid, so
-- `completed` does not REQUIRE checked_in_at/en_route_at — the override
-- legitimately bypasses them (audited). The states en_route/checked_in/
-- in_progress can only be reached through cleaner execution, so their
-- timestamp implications are strict.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. jobs execution timestamps (design §3.1)
-- ---------------------------------------------------------------------
alter table public.jobs
  add column en_route_at   timestamptz,
  add column checked_in_at timestamptz,
  add column checked_out_at timestamptz,
  add column actual_start  timestamptz,
  add column actual_end    timestamptz;

-- en_route is reachable only via the cleaner en-route action, which stamps
-- en_route_at (BD-C2). checked_in/in_progress may legitimately have a NULL
-- en_route_at: the direct assigned → checked_in path is explicitly permitted.
alter table public.jobs
  add constraint ck_jobs_en_route_meta
  check (status <> 'en_route' or en_route_at is not null);

alter table public.jobs
  add constraint ck_jobs_checked_in_meta
  check (
    status not in ('checked_in', 'in_progress')
    or (checked_in_at is not null and actual_start is not null)
  );

-- Completion always carries an actual end (cleaner path or staff override).
alter table public.jobs
  add constraint ck_jobs_actual_end_meta
  check (status <> 'completed' or actual_end is not null);

-- Chronological sanity of execution timestamps.
alter table public.jobs
  add constraint ck_jobs_execution_order
  check (
    (en_route_at is null or checked_in_at is null or checked_in_at >= en_route_at)
    and (actual_start is null or actual_end is null or actual_end >= actual_start)
    and (checked_out_at is null or checked_in_at is not null)
    and (checked_out_at is null or actual_end is null or checked_out_at <= actual_end)
    and (checked_out_at is null or status in ('checked_in', 'in_progress', 'completed'))
  );

comment on column public.jobs.en_route_at is
  'Change 7 (BD-C2): server-authoritative en-route stamp; optional (direct assigned→checked_in permitted); never carries location data (BD-C6).';
comment on column public.jobs.checked_in_at is
  'Change 7 (BD-C2): server-authoritative check-in stamp (cleaner execution start).';
comment on column public.jobs.checked_out_at is
  'Change 7: server-authoritative checkout stamp; checkout precedes but does not perform completion.';
comment on column public.jobs.actual_start is
  'Change 7: actual work start (check-in time).';
comment on column public.jobs.actual_end is
  'Change 7: actual work end (checkout or completion; staff override stamps it too).';

-- ---------------------------------------------------------------------
-- B. Checklist (design §3.2–3.4; BD-C3)
-- ---------------------------------------------------------------------
create table public.checklist_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- NULL branch_id = organization-wide default for the service; a
  -- branch-scoped row overrides it for that branch.
  branch_id       uuid references public.branches (id),
  -- Scoping only — the Service Catalog does not own execution state
  -- (BD-C3). Same-branch/org consistency is the domain layer's concern
  -- (the nullable branch_id makes a composite same-branch FK impossible).
  service_id      uuid not null references public.services (id),
  version         integer not null check (version >= 1),
  status          text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  name            text not null,
  -- Frozen item definitions: [{key, label, mandatory, sort_order}].
  -- Validated in the domain layer (no production seed content — TD-C8).
  items           jsonb not null default '[]'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One version per (org, service, scope): org-wide and branch-scoped rows
-- are versioned independently (partial uniques — nullable branch_id).
create unique index uq_checklist_templates_org_version
  on public.checklist_templates (organization_id, service_id, version)
  where branch_id is null;
create unique index uq_checklist_templates_branch_version
  on public.checklist_templates (organization_id, branch_id, service_id, version)
  where branch_id is not null;
create index idx_checklist_templates_service
  on public.checklist_templates (organization_id, service_id, status);

comment on table public.checklist_templates is
  'Change 7 (BD-C3): versioned service-scoped checklist definitions (Worker-owned). Only published versions snapshot into jobs. No production seed content.';

create table public.job_checklist_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  job_id          uuid not null references public.jobs (id),
  -- Provenance of the copied definition (BD-C3).
  template_id     uuid references public.checklist_templates (id),
  template_version integer not null,
  service_id      uuid,
  -- Frozen item definitions: [{key, label, mandatory, sort_order}].
  snapshot        jsonb not null,
  created_at      timestamptz not null default now(),
  -- Exactly one snapshot per job (copied at the first execution action).
  constraint uq_job_checklist_snapshots_job unique (job_id)
);

comment on table public.job_checklist_snapshots is
  'Change 7 (BD-C3): immutable per-job checklist snapshot copied from a published template at execution start; never mutated afterwards (historical execution record).';

create table public.job_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  job_id          uuid not null references public.jobs (id),
  snapshot_id     uuid not null references public.job_checklist_snapshots (id),
  item_key        text not null,
  label           text not null,
  mandatory       boolean not null default false,
  sort_order      integer not null default 0,
  status          text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at    timestamptz,
  completed_by    uuid,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_job_checklist_items_job_key unique (job_id, item_key),
  constraint ck_job_checklist_items_completed
    check ((status = 'completed') = (completed_at is not null))
);

create index idx_job_checklist_items_job on public.job_checklist_items (job_id);

comment on table public.job_checklist_items is
  'Change 7 (BD-C3/C9): execution state per snapshot item; completion records status/completed_at/completed_by/notes; mandatory items gate cleaner self-completion (BD-C9).';

-- ---------------------------------------------------------------------
-- C. Job media linkage (design §3.5; BD-C4)
-- ---------------------------------------------------------------------
create table public.job_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  job_id          uuid not null references public.jobs (id),
  -- Required when category = incident_evidence (CHECK below).
  incident_id     uuid references public.incidents (id),
  category        text not null check (category in ('before', 'after', 'incident_evidence')),
  -- Job-scoped path inside the private media bucket (MEDIA_STORAGE §67);
  -- the binary object never lives in the database.
  storage_path    text not null,
  mime_type       text,
  byte_size       bigint,
  uploaded_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_job_media_job_path unique (job_id, storage_path),
  constraint ck_job_media_evidence_requires_incident
    check (category <> 'incident_evidence' or incident_id is not null)
);

create index idx_job_media_job on public.job_media (job_id);
create index idx_job_media_incident on public.job_media (incident_id);

comment on table public.job_media is
  'Change 7 (BD-C4): job-scoped photo metadata (before/after/incident_evidence). Private Storage only; signed-URL access after server authorization; no public exposure path.';

-- ---------------------------------------------------------------------
-- D. job_events event-type widening (design §3.6)
--    Same ALTER pattern as the Change 6 notification_outbox widening;
--    actor_type semantics unchanged — cleaner actions use 'staff' with
--    employee linkage in metadata (TD-W8 minimization discipline).
-- ---------------------------------------------------------------------
alter table public.job_events drop constraint job_events_event_type_check;
alter table public.job_events
  add constraint job_events_event_type_check
  check (event_type in (
    'job_created', 'job_assigned', 'job_unassigned', 'job_rescheduled',
    'job_started', 'check_in', 'check_out', 'job_completed',
    'job_cancelled', 'incident_reported', 'assignment_flagged',
    'en_route', 'checklist_completed'
  ));

comment on constraint job_events_event_type_check on public.job_events is
  'Change 7 (BD-C2/C3): widened with en_route and checklist_completed; Change 6 event types unchanged.';

-- =====================================================================
-- RLS — one combined select policy per table (established pattern, no
-- FORCE, no application-role write policies: mutations flow through the
-- privileged domain layer, 0007 pattern). Cleaner role sees checklist
-- snapshots/items/media only for jobs with their own active assignment
-- (exists-subselect on job_assignments — same shape as the 0012 jobs
-- policy). Existing jobs/job_assignments policies are NOT modified.
-- =====================================================================

alter table public.checklist_templates enable row level security;
create policy checklist_templates_select on public.checklist_templates
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or (
      public.get_membership_role(auth.uid(), organization_id) = 'branch_manager'
      and (branch_id is null or public.has_branch_access(auth.uid(), branch_id))
    )
  );

alter table public.job_checklist_snapshots enable row level security;
create policy job_checklist_snapshots_select on public.job_checklist_snapshots
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.job_id = job_checklist_snapshots.job_id
           and ja.assignment_status in ('active', 'pending')
           and e.user_id = auth.uid()
       )
  );

alter table public.job_checklist_items enable row level security;
create policy job_checklist_items_select on public.job_checklist_items
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.job_id = job_checklist_items.job_id
           and ja.assignment_status in ('active', 'pending')
           and e.user_id = auth.uid()
       )
  );

alter table public.job_media enable row level security;
create policy job_media_select on public.job_media
  for select using (
    public.get_membership_role(auth.uid(), organization_id) in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
    or exists (
         select 1
         from public.job_assignments ja
         join public.employees e on e.id = ja.employee_id
         where ja.job_id = job_media.job_id
           and ja.assignment_status in ('active', 'pending')
           and e.user_id = auth.uid()
       )
  );
