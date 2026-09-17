-- =====================================================================
-- 0011_booking.sql — Change 5 (create-booking)
-- openspec/changes/create-booking/design.md §3 (conceptual schema made
-- concrete); normative decision record BD-1…BD-6, B-NEW-1, TD-1.
--
-- Decisions encoded:
--   BD-1  bookings.status CHECK carries NO failed state; the transition
--         guard trigger enforces the approved §5 state machine and
--         rejects DELETE of booking history (BOOKING_SYSTEM §37: "the
--         booking is never deleted").
--   BD-2  branch_cancellation_policies: branch-scoped, versioned,
--         effective-dated; published content immutable (P17 mechanics
--         reused from 0010); the confirmed booking captures the policy
--         snapshot (bookings.cancellation_policy_snapshot). Money columns
--         are integer MINOR UNITS (P14) with non-negative CHECKs.
--   BD-3  no rescheduled state — rescheduling is a mutation plus a
--         booking_rescheduled EVENT; reschedule_count is bookkeeping.
--   BD-4  customers are organization-scoped; email normalized
--         (trim + lowercase), phone E.164; partial UNIQUE per contact
--         channel; conflict flag column for staff resolution.
--   BD-5  booking_number CHECK-enforced format CLN-<year>-<seq 6 digits>,
--         UNIQUE per organization; booking_number_sequences holds ONE
--         monotonic counter per organization (organization_id PK). The
--         year component is derived from the branch-local service date
--         and the counter NEVER resets — a monotonic counter cannot emit
--         a duplicate number across a year boundary, so uniqueness holds
--         deterministically without a per-year reset rule.
--   BD-6  branch_service_areas: per-branch postal-code allowlist.
--   B-NEW-1  NO messaging tables of any kind.
--   TD-1  NO jobs/employees/assignment tables — the Worker change owns
--         them; the confirmed booking is the future idempotent source.
--   TD-2/3.2/3.3/3.5/3.6  booking_pricing_snapshots (append-only history
--         with exactly-one-current), booking_idempotency_keys
--         (scope-separated), notification_outbox (transactional enqueue;
--         delivery is the Notification change).
--   TD-3  customer_magic_link_tokens: sha-256 hash only, single-use,
--         expiring, revocable, one booking per token. RLS is enabled with
--         NO policies — deny-all for application roles; access flows
--         exclusively through the privileged domain layer (service role).
--
-- RLS: enabled in this creation migration, one combined policy per table
-- (0007/0008/0009/0010 pattern: HQ + branch-manager roles org/branch
-- scoped via get_membership_role()/has_branch_access()). No FORCE:
-- owner-exemption keeps the 0006 SECURITY DEFINER helpers working.
-- =====================================================================

-- ---------------------------------------------------------------------
-- customers (BD-4) — organization-scoped identity without accounts.
-- ---------------------------------------------------------------------
create table public.customers (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id),
  -- Normalized match/store values (BD-4): email trimmed + lowercased;
  -- phone E.164 (+<digits>) or NULL when not provided.
  email_normalized      text not null,
  phone_e164            text,
  first_name            text not null,
  last_name             text not null,
  company               text,
  preferred_language    text,
  status                text not null default 'active'
                        check (status in ('active', 'inactive')),
  -- BD-4: differing contact details on match keep the stored canonical
  -- values and raise this flag; staff resolve via customers.edit.
  contact_conflict_flag boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint ck_customers_email_shape
    check (email_normalized = lower(trim(email_normalized))
           and email_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint ck_customers_phone_e164
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{1,14}$')
);

comment on table public.customers is
  'Organization-scoped customer identity (BD-4): no accounts; matched by normalized email then E.164 phone; conflicts flagged for staff resolution.';

-- BD-4: organization-wide uniqueness per contact channel (partial — phone
-- is optional; a NULL phone never conflicts).
create unique index uq_customers_org_email
  on public.customers (organization_id, email_normalized);
create unique index uq_customers_org_phone
  on public.customers (organization_id, phone_e164)
  where phone_e164 is not null;

create index idx_customers_organization on public.customers (organization_id);
create index idx_customers_conflict on public.customers (organization_id, contact_conflict_flag)
  where contact_conflict_flag;

-- ---------------------------------------------------------------------
-- customer_addresses (TD-4) — reusable reference data; bookings carry an
-- immutable service_address snapshot, so edits never mutate history.
-- ---------------------------------------------------------------------
create table public.customer_addresses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id),
  customer_id         uuid not null references public.customers (id) on delete cascade,
  label               text,
  street              text not null,
  house_number        text not null,
  postal_code         text not null,
  city                text not null,
  country             text not null check (country = upper(country) and char_length(country) = 2),
  -- Sensitive access data (BOOKING_SYSTEM §13) — protected by RLS and
  -- never included in customer-visible event payloads.
  access_instructions text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.customer_addresses is
  'Reusable customer address reference data (TD-4); confirmed bookings store their own immutable service_address snapshot.';

create index idx_customer_addresses_customer on public.customer_addresses (customer_id);
create index idx_customer_addresses_organization on public.customer_addresses (organization_id);

-- ---------------------------------------------------------------------
-- branch_service_areas (BD-6) — per-branch postal-code allowlist.
-- ---------------------------------------------------------------------
create table public.branch_service_areas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  postal_code     text not null,
  created_at      timestamptz not null default now(),

  constraint uq_branch_service_areas unique (branch_id, postal_code)
);

comment on table public.branch_service_areas is
  'Per-branch postal-code allowlist (BD-6); bookings outside the allowlist are rejected before any hold is created. Managed via the existing branches.edit permission.';

create index idx_branch_service_areas_branch on public.branch_service_areas (branch_id);

-- ---------------------------------------------------------------------
-- branch_cancellation_policies (BD-2) — branch-scoped, versioned,
-- effective-dated; published content immutable (P17 mechanics).
-- ---------------------------------------------------------------------
create table public.branch_cancellation_policies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  version_number  integer not null check (version_number >= 1),
  status          text not null default 'draft'
                  check (status in ('draft', 'published', 'archived')),
  effective_from  date not null,
  effective_until date,
  -- The four cancellation bands: [{min_hours, max_hours | null, percent}].
  -- The seeded default carries the documented 0/25/50/100 tiers (approved
  -- business policy — BD-2; NOT a new value). Shape validated by Zod at
  -- the domain layer (DATABASE.md §46).
  tiers           jsonb not null,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_cancellation_policies_branch_version
    unique (branch_id, version_number),
  constraint ck_cancellation_policies_range
    check (effective_until is null or effective_until >= effective_from),
  constraint ck_cancellation_policies_tiers_shape
    check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) >= 1)
);

comment on table public.branch_cancellation_policies is
  'Branch cancellation policy (BD-2): versioned, effective-dated, published content immutable; confirmed bookings capture the applicable snapshot at confirmation.';

create index idx_cancellation_policies_branch on public.branch_cancellation_policies (branch_id);
create index idx_cancellation_policies_status_effective
  on public.branch_cancellation_policies (status, effective_from);

-- BD-2/P17: overlapping PUBLISHED effective windows per branch are
-- rejected (windows inclusive on both ends, matching 0009/0010).
alter table public.branch_cancellation_policies
  add constraint ex_cancellation_policies_published_no_overlap
  exclude using gist (
    branch_id with =,
    daterange(effective_from, effective_until, '[]') with &&
  )
  where (status = 'published');

-- Published policies are immutable; the only permitted transition is
-- published → archived with identical content (mirrors 0010 guard).
create function public.cancellation_policies_immutable_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old; -- cascade teardown is a referential action, not a mutation
    end if;
    if old.status in ('published', 'archived') then
      raise exception 'published or archived cancellation policies cannot be deleted (BD-2)'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'archived' then
    raise exception 'archived cancellation policies are immutable (BD-2)'
      using errcode = 'check_violation';
  end if;

  if old.status = 'published' then
    if new.status = 'archived'
       and row(new.version_number, new.effective_from, new.effective_until, new.tiers, new.branch_id)
           is not distinct from
           row(old.version_number, old.effective_from, old.effective_until, old.tiers, old.branch_id)
    then
      return new;
    end if;
    if new.status = 'published'
       and row(new.version_number, new.effective_from, new.effective_until, new.tiers, new.branch_id)
           is not distinct from
           row(old.version_number, old.effective_from, old.effective_until, old.tiers, old.branch_id)
    then
      return new; -- no-op bookkeeping update
    end if;
    raise exception 'published cancellation policies are immutable; only archiving is permitted (BD-2)'
      using errcode = 'check_violation';
  end if;

  return new; -- draft rows are freely editable
end;
$$;

create trigger trg_cancellation_policies_immutable
  before update or delete on public.branch_cancellation_policies
  for each row execute function public.cancellation_policies_immutable_guard();

-- ---------------------------------------------------------------------
-- booking_number_sequences (BD-5) — ONE monotonic counter per
-- organization. Row-locked allocation inside the confirmation
-- transaction; the year in the rendered number comes from the
-- branch-local service date and the counter never resets, so a year
-- boundary cannot create duplicates.
-- ---------------------------------------------------------------------
create table public.booking_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_sequence   bigint not null default 0 check (last_sequence >= 0),
  updated_at      timestamptz not null default now()
);

comment on table public.booking_number_sequences is
  'Per-organization monotonic booking-number counter (BD-5); allocation is transactional (row lock) and never resets, keeping CLN-<year>-<seq> unique per organization across year boundaries.';

-- ---------------------------------------------------------------------
-- bookings (BD-1/BD-2/BD-3/BD-5/TD-4) — the commercial transaction.
-- ---------------------------------------------------------------------
create table public.bookings (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations (id),
  branch_id                     uuid not null references public.branches (id),
  customer_id                   uuid not null references public.customers (id),
  booking_number                text not null,
  -- BD-1: the approved 8-state lifecycle — NO failed state.
  status                        text not null default 'confirmed'
                                check (status in (
                                  'draft', 'pending', 'confirmed', 'assigned',
                                  'in_progress', 'completed', 'cancelled', 'no_show'
                                )),
  booking_type                  text not null default 'one_time'
                                check (booking_type in
                                  ('one_time', 'recurring', 'move_in', 'move_out', 'commercial', 'airbnb')),
  scheduled_start               timestamptz not null,
  scheduled_end                 timestamptz not null,
  timezone                      text not null,
  -- TD-4: immutable service-address snapshot captured at confirmation.
  service_address               jsonb not null,
  -- Pricing provenance. Deliberately NO FK to pricing_versions: the
  -- canonical snapshot below is the authoritative historical record
  -- (DATABASE §16.3) and booking history must survive pricing teardown.
  pricing_version_id            uuid not null,
  cancellation_policy_snapshot  jsonb not null,
  source                        text not null default 'website'
                                check (source in ('website', 'dashboard', 'phone', 'admin', 'api')),
  customer_notes                text,
  internal_notes                text,
  currency                      text not null check (currency = upper(currency) and char_length(currency) = 3),
  -- Money in integer MINOR UNITS (P14); total incl. tax (tax-exclusive
  -- storage with explicit tax component, P15).
  subtotal                      integer not null check (subtotal >= 0),
  surcharge_total               integer not null default 0 check (surcharge_total >= 0),
  tax_total                     integer not null default 0 check (tax_total >= 0),
  total                         integer not null check (total >= 0),
  -- Cancellation (BD-2).
  cancelled_at                  timestamptz,
  cancelled_by                  text,
  cancellation_reason           text,
  cancellation_fee_minor        integer check (cancellation_fee_minor is null or cancellation_fee_minor >= 0),
  amount_owed_minor             integer check (amount_owed_minor is null or amount_owed_minor >= 0),
  -- Rescheduling (BD-3): bookkeeping only — no rescheduled state.
  reschedule_count              integer not null default 0 check (reschedule_count >= 0),
  confirmed_at                  timestamptz,
  completed_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint uq_bookings_org_number unique (organization_id, booking_number),
  constraint ck_bookings_number_format
    check (booking_number ~ '^CLN-[0-9]{4}-[0-9]{6}$'),
  constraint ck_bookings_interval check (scheduled_end > scheduled_start)
);

comment on table public.bookings is
  'The commercial booking transaction (BD-1/2/3/5): 8-state lifecycle without FAILED, immutable pricing + cancellation-policy snapshots, DB-unique CLN numbers per organization, no jobs linkage (TD-1).';

create index idx_bookings_branch_start on public.bookings (branch_id, scheduled_start);
create index idx_bookings_customer on public.bookings (customer_id);
create index idx_bookings_status on public.bookings (status);
create index idx_bookings_organization on public.bookings (organization_id);

-- Approved §5 state machine + history protection (BD-1; BOOKING §37).
create function public.bookings_transition_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old; -- container teardown (org/branch deletion) is a cascade
    end if;
    raise exception 'bookings are permanent history and cannot be deleted (BOOKING_SYSTEM §37)'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('draft', 'pending'),
      ('pending', 'confirmed'),   ('pending', 'cancelled'),
      ('confirmed', 'cancelled'), ('confirmed', 'assigned'), ('confirmed', 'no_show'),
      ('assigned', 'cancelled'),  ('assigned', 'in_progress'), ('assigned', 'no_show'),
      ('in_progress', 'completed')
    ) then
      raise exception 'invalid booking status transition % -> % (design §5)', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_bookings_transition_guard
  before update or delete on public.bookings
  for each row execute function public.bookings_transition_guard();

-- ---------------------------------------------------------------------
-- booking_items — sold lines with snapshot labels; catalog FKs are
-- nullable with ON DELETE SET NULL so history survives catalog edits
-- (design §3.7; composite same-branch FKs, 0008 pattern).
-- ---------------------------------------------------------------------
create table public.booking_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  branch_id          uuid not null references public.branches (id),
  booking_id         uuid not null references public.bookings (id) on delete cascade,
  kind               text not null check (kind in ('service', 'variant', 'addon')),
  service_id         uuid,
  service_variant_id uuid,
  service_addon_id   uuid,
  label              text not null,
  quantity           integer not null check (quantity > 0),
  unit_amount_minor  integer not null check (unit_amount_minor >= 0),
  total_amount_minor integer not null check (total_amount_minor >= 0),
  metadata           jsonb,
  created_at         timestamptz not null default now(),

  constraint fk_booking_items_service_same_branch
    foreign key (service_id, branch_id)
    references public.services (id, branch_id) on delete set null,
  constraint fk_booking_items_variant_same_branch
    foreign key (service_variant_id, branch_id)
    references public.service_variants (id, branch_id) on delete set null,
  constraint fk_booking_items_addon_same_branch
    foreign key (service_addon_id, branch_id)
    references public.service_addons (id, branch_id) on delete set null
);

comment on table public.booking_items is
  'Booking line items (design §3.7): snapshot labels survive catalog edits (ON DELETE SET NULL); no price data lives in catalog tables (Q5).';

create index idx_booking_items_booking on public.booking_items (booking_id);
create index idx_booking_items_branch on public.booking_items (branch_id);

-- ---------------------------------------------------------------------
-- booking_events (TD-3.4) — append-only business event history.
-- ---------------------------------------------------------------------
create table public.booking_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  event_type      text not null check (event_type in (
                    'booking_created', 'booking_confirmed', 'booking_rescheduled',
                    'booking_cancelled', 'booking_assigned', 'booking_started',
                    'booking_completed', 'booking_no_show',
                    'booking_amount_owed_recorded', 'contact_conflict_flagged'
                  )),
  metadata        jsonb not null default '{}',
  actor_type      text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_user_id   uuid,
  created_at      timestamptz not null default now()
);

comment on table public.booking_events is
  'Append-only booking event history (TD-3.4); payloads minimize sensitive data (BOOKING_SYSTEM §50).';

create index idx_booking_events_booking on public.booking_events (booking_id, created_at);
create index idx_booking_events_branch on public.booking_events (branch_id);

create function public.booking_events_append_guard() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new; -- cascade teardown from booking deletion
  end if;
  raise exception 'booking events are append-only (TD-3.4)'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_booking_events_append_only
  before update or delete on public.booking_events
  for each row execute function public.booking_events_append_guard();

-- ---------------------------------------------------------------------
-- booking_pricing_snapshots (TD-3.2) — append-only pricing history;
-- exactly one current snapshot per booking (partial unique index). The
-- ONLY permitted UPDATE is the reschedule hand-off is_current true→false
-- with identical content.
-- ---------------------------------------------------------------------
create table public.booking_pricing_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id),
  branch_id          uuid not null references public.branches (id),
  booking_id         uuid not null references public.bookings (id) on delete cascade,
  seq                integer not null check (seq >= 1),
  pricing_version_id uuid not null,
  -- Canonical snapshot: pricing_profile_id / pricing_version_id /
  -- pricing_version_number / inputs / rules_applied / result (§16.3).
  snapshot           jsonb not null,
  is_current         boolean not null default true,
  created_reason     text not null check (created_reason in ('confirmation', 'reschedule')),
  created_at         timestamptz not null default now(),

  constraint uq_booking_snapshots_seq unique (booking_id, seq)
);

comment on table public.booking_pricing_snapshots is
  'Append-only booking pricing snapshot history (TD-3.2): confirmation stores seq 1; each reschedule appends a new authoritative snapshot and retires the prior one via the is_current hand-off.';

create unique index uq_booking_snapshots_one_current
  on public.booking_pricing_snapshots (booking_id)
  where is_current;
create index idx_booking_snapshots_booking on public.booking_pricing_snapshots (booking_id, seq);
create index idx_booking_snapshots_branch on public.booking_pricing_snapshots (branch_id);

create function public.booking_pricing_snapshots_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old; -- cascade teardown from booking deletion
    end if;
    raise exception 'pricing snapshots are history and cannot be deleted (TD-3.2)'
      using errcode = 'check_violation';
  end if;

  -- The sanctioned mutation: the reschedule hand-off flips is_current
  -- true→false with ALL content columns unchanged.
  if new.is_current = false and old.is_current = true
     and new.snapshot is not distinct from old.snapshot
     and new.seq = old.seq
     and new.pricing_version_id = old.pricing_version_id
     and new.booking_id = old.booking_id
     and new.created_reason = old.created_reason
     and new.organization_id = old.organization_id
     and new.branch_id = old.branch_id
  then
    return new;
  end if;

  raise exception 'pricing snapshots are append-only; only the is_current hand-off may be updated (TD-3.2)'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_booking_pricing_snapshots_guard
  before update or delete on public.booking_pricing_snapshots
  for each row execute function public.booking_pricing_snapshots_guard();

-- ---------------------------------------------------------------------
-- customer_magic_link_tokens (TD-3) — hashed, single-use, expiring,
-- revocable, one booking per token. RLS deny-all: enabled with NO
-- policies, so application roles (anon/authenticated) see nothing;
-- access flows through the privileged domain layer only.
-- ---------------------------------------------------------------------
create table public.customer_magic_link_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  customer_id     uuid not null references public.customers (id) on delete cascade,
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  token_hash      text not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint uq_magic_link_token_hash unique (token_hash),
  constraint ck_magic_link_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'), -- sha-256 hex
  constraint ck_magic_link_expiry check (expires_at > created_at)
);

comment on table public.customer_magic_link_tokens is
  'Magic-link tokens (TD-3): sha-256 hash only, single-use (consumed_at), expiring, revocable, scoped to exactly one booking. RLS deny-all — no policies; service-role access only.';

create index idx_magic_link_tokens_booking on public.customer_magic_link_tokens (booking_id);
create index idx_magic_link_tokens_customer on public.customer_magic_link_tokens (customer_id);

alter table public.customer_magic_link_tokens enable row level security;
-- No policy created: RLS denies every application role by default.

-- ---------------------------------------------------------------------
-- booking_idempotency_keys (TD-5) — scope-separated idempotency with
-- stored replay results. Retained for audit value (no expiry job).
-- ---------------------------------------------------------------------
create table public.booking_idempotency_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  scope           text not null check (scope in ('confirmation', 'reschedule')),
  key             text not null,
  booking_id      uuid references public.bookings (id) on delete set null,
  request_hash    text not null,
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_booking_idempotency_keys unique (organization_id, scope, key)
);

comment on table public.booking_idempotency_keys is
  'Idempotency keys (TD-5): replay returns the stored result; the result row is written inside the business transaction so a failure leaves the key retryable.';

create index idx_booking_idempotency_booking on public.booking_idempotency_keys (booking_id);

-- ---------------------------------------------------------------------
-- notification_outbox (TD-6) — minimal transactional enqueue. Rows are
-- written inside the business transaction; the delivery worker, retry
-- loop and channels belong to the Notification change.
-- ---------------------------------------------------------------------
create table public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  branch_id       uuid not null references public.branches (id),
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  event_type      text not null check (event_type in (
                    'booking_confirmation_email', 'booking_cancellation_email',
                    'booking_reschedule_email', 'magic_link_email'
                  )),
  payload         jsonb not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'sent', 'failed')),
  retry_count     integer not null default 0 check (retry_count >= 0),
  next_attempt_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.notification_outbox is
  'Minimal notification outbox (TD-6): transactional enqueue only; delivery/retry is the Notification change''s concern (rows stay pending until then).';

create index idx_notification_outbox_status on public.notification_outbox (status, next_attempt_at);
create index idx_notification_outbox_booking on public.notification_outbox (booking_id);
create index idx_notification_outbox_branch on public.notification_outbox (branch_id);

-- =====================================================================
-- RLS — one combined policy per table (0007/0008/0009/0010 pattern,
-- no FORCE). The magic-link token table is deliberately policy-less
-- (deny-all for application roles). Mutations flow exclusively through
-- the privileged domain layer.
-- =====================================================================

alter table public.customers enable row level security;
create policy customers_select on public.customers
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

alter table public.customer_addresses enable row level security;
create policy customer_addresses_select on public.customer_addresses
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

alter table public.branch_service_areas enable row level security;
create policy branch_service_areas_select on public.branch_service_areas
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.branch_cancellation_policies enable row level security;
create policy branch_cancellation_policies_select on public.branch_cancellation_policies
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.booking_number_sequences enable row level security;
create policy booking_number_sequences_select on public.booking_number_sequences
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

alter table public.bookings enable row level security;
create policy bookings_select on public.bookings
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.booking_items enable row level security;
create policy booking_items_select on public.booking_items
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.booking_events enable row level security;
create policy booking_events_select on public.booking_events
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.booking_pricing_snapshots enable row level security;
create policy booking_pricing_snapshots_select on public.booking_pricing_snapshots
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );

alter table public.booking_idempotency_keys enable row level security;
create policy booking_idempotency_keys_select on public.booking_idempotency_keys
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff', 'branch_manager')
  );

alter table public.notification_outbox enable row level security;
create policy notification_outbox_select on public.notification_outbox
  for select using (
    public.get_membership_role(auth.uid(), organization_id)
      in ('hq_admin', 'hq_staff')
    or public.has_branch_access(auth.uid(), branch_id)
  );
