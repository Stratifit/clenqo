# Design: Booking System (Change 5)

**Status:** Documentation/design only — no implementation has occurred. Migration 0011, `features/booking/`, and tests are created only after approval and BUILD MODE begins.

**Normative sources:** owner decision records **BD-1…BD-6, B-NEW-1, TD-1** (2026-09, §1); BOOKING_SYSTEM §37–50/§62–67/§83/§88/§91–95; SCHEDULING_SYSTEM §84–86 (S1–S18); PRICING_ENGINE (P1–P22); DATABASE §16.3/§17–22/§41; SECURITY §14; SECURITY_PRIVACY §28–34; AUDIT §49–51. Where wording could diverge, the decision records win.

## 1. Approved decision record (normative)

| ID | Decision |
|---|---|
| BD-1 | No FAILED booking state; failed confirmation rolls back entirely (no persisted booking; hold released); payment keeps its own failed state. |
| BD-2 | Cancellation windows from `scheduled_start`; tiers [24,∞) 0% / [12,24) 25% / [2,12) 50% / [0,2) 100%; fee = immutable pricing-snapshot total (tax incl., tips excl.), half-up minor-unit rounding; policy branch-configurable/versioned/effective-dated/snapshotted at confirmation; dedicated `bookings.override` (HQ Admin only, audited: actor/timestamp/booking/original fee/final fee/reason); customer cancellation prohibited at/after start (`no_show` is the post-start outcome); unpaid fee = amount owed (collection deferred to Payment). |
| BD-3 | Rescheduling V1 for customers (magic link) and staff; states confirmed/assigned only; customer deadline ≥2h before current `scheduled_start`; target slot satisfies the full 24h minimum notice (no same-day targets); unlimited repeats; FREE (cancellation tiers never applied); cancellation window restarts from the new `scheduled_start`; price increase → explicit customer acceptance, decrease → auto-apply; new snapshot authoritative, old preserved; internal roles hq_admin/hq_staff/branch_manager via existing `bookings.edit`; no `bookings.reschedule` permission; `booking_rescheduled` is an event, not a state. |
| BD-4 | Customer match: email first, then phone; email trimmed lowercase, phone E.164 (used for matching AND storage); on conflict keep stored values, flag, staff resolve via `customers.edit`; uniqueness organization-wide. |
| BD-5 | Booking number `CLN-<year>-<sequence>` (e.g. CLN-2026-000123), unique per organization, DB-enforced, one sequence per org; UUID stays the internal id. |
| BD-6 | Service-area enforcement in V1: per-branch postal-code allowlist; outside → booking cannot proceed; branch-managed via existing `branches.edit`. |
| B-NEW-1 | Booking Hub "Contact CLENQO" = branch contact information only; no messages table/threads; messaging deferral explicitly documented. |
| TD-1 | NO jobs table in Change 5; Worker change owns Jobs and creates them idempotently from confirmed bookings; booking→job handoff contract documented here; no assignment logic. |

**S15 boundary (verbatim, binding):** "Scheduling answers whether the requested work can be performed in the requested interval from branch, service, capacity, and conflict constraints — it counts eligible resources but never selects one. Assignment answers which eligible, available worker is chosen to perform it — it may rank and select only among candidates Scheduling has already established as feasible; neither domain performs the other's question."

## 2. Domain boundary

Catalog = sellability · Pricing = price + duration + snapshots · Scheduling = feasibility/capacity/holds · Booking = transaction, lifecycle, customer data, policy application, events, idempotency · Worker = jobs/assignment (future) · Payment = provider transactions (future) · Notification = delivery (future). Booking never calculates price/duration, never computes availability, never selects workers.

## 3. Data model (conceptual; implemented by migration 0011)

Conventions: UUID PKs; `organization_id` + `branch_id NOT NULL`; composite same-branch FKs (0008/0009 pattern); `timestamptz` UTC; created/updated audit columns; RLS enabled at creation with combined policies via 0006 definer helpers; no FORCE.

**3.1 `customers`** — organization-scoped (BD-4). `email_normalized`, `phone_e164`, `first_name`, `last_name`, `company?`, `preferred_language?`, `status`, `contact_conflict_flag boolean default false`, `notes`. Partial UNIQUE `(organization_id, email_normalized)` and `(organization_id, phone_e164)`.

**3.2 `customer_addresses`** — `customer_id` FK; `label?`, `street`, `house_number`, `postal_code`, `city`, `country`, access instructions (sensitive — protected per BOOKING §13).

**3.3 `branch_service_areas`** (BD-6) — `branch_id`, `postal_code`; UNIQUE `(branch_id, postal_code)`; managed via `branches.edit`.

**3.4 `branch_cancellation_policies`** (BD-2) — `branch_id`, `version_number`, `status` (draft/published/archived), `effective_from date NOT NULL`, `effective_until date`, `tiers jsonb` (the four documented bands; published content immutable). Exclusion constraint rejects overlapping published windows per branch (P17 pattern). Seed default = the documented 0/25/50/100 tiers (already-approved values, not new business values).

**3.5 `booking_number_sequences`** (BD-5) — `organization_id` PK, `last_sequence bigint`; transactional row-lock allocation; format `CLN-<year>-<seq 6-digit>`; year from the branch-local service date.

**3.6 `bookings`** — `customer_id` FK; `booking_number text`; UNIQUE `(organization_id, booking_number)`; `status` CHECK in `draft/pending/confirmed/assigned/in_progress/completed/cancelled/no_show` (BD-1: no FAILED); `booking_type` CHECK (one_time/recurring/move_in/move_out/commercial/airbnb — §6); `scheduled_start/scheduled_end timestamptz NOT NULL`; `timezone text`; `service_address jsonb` (immutable snapshot, TD-4); `pricing_version_id uuid`; `cancellation_policy_snapshot jsonb` (captured at confirmation); `source` CHECK (website/dashboard/phone/admin/api — §58); `customer_notes`, `internal_notes`; money columns in currency minor units (`subtotal`, `surcharge_total`, `tax_total`, `total`, `currency`); `cancelled_at/cancelled_by/cancellation_reason`; `cancellation_fee_minor?`, `amount_owed_minor?`; `reschedule_count int default 0`; `confirmed_at`, `completed_at`. Indexes `(branch_id, scheduled_start)`, `(customer_id)`, `(status)`.

**3.7 `booking_items`** — `booking_id` FK; `kind` (service/variant/addon); nullable catalog FKs (ON DELETE SET NULL — history survives catalog edits); `label`, `quantity`, `unit_amount_minor`, `total_amount_minor`, `metadata jsonb`.

**3.8 `booking_events`** — append-only (update/delete guard trigger). `booking_id` FK; `event_type` CHECK (`booking_created`, `booking_confirmed`, `booking_rescheduled`, `booking_cancelled`, `booking_assigned`, `booking_started`, `booking_completed`, `booking_no_show`, `booking_amount_owed_recorded`, `contact_conflict_flagged`); `metadata jsonb`; `actor_type` (customer/staff/system); `actor_user_id?`. Index `(booking_id, created_at)`.

**3.9 `booking_pricing_snapshots`** (TD-3.2) — append-only. `booking_id` FK; `seq int`; `pricing_version_id`; `snapshot jsonb` (canonical inputs/rules_applied/result per DATABASE §16.3); `is_current boolean`; `created_reason` (confirmation/reschedule). Partial UNIQUE: exactly one `is_current` per booking.

**3.10 `customer_magic_link_tokens`** (TD-3) — `customer_id`, `booking_id` (scope); `token_hash` (sha-256, UNIQUE); `expires_at`; `consumed_at?` (single-use); `revoked_at?`. RLS: deny-all to application roles (service-role only).

**3.11 `booking_idempotency_keys`** (TD-5) — `scope` CHECK (confirmation/reschedule); `key text`; `booking_id?`; `request_hash`; `result jsonb` (replay payload). UNIQUE `(organization_id, scope, key)`.

**3.12 `notification_outbox`** (TD-6, minimal) — `booking_id`, `event_type`, `payload jsonb`, `status` CHECK (pending/processing/sent/failed), `retry_count`, `next_attempt_at`. Change 5 writes rows transactionally; the delivery worker is the Notification change.

**3.13 Explicitly absent:** no `jobs` (TD-1), no `booking_messages` (B-NEW-1), no payment tables, no `job_id` column (the Worker change owns job↔booking linkage via its own tables).

## 4. Technical decisions

Each: **Decision / Recommendation / Why / Alternatives / Impact / Schema.**

**TD-2 Confirmation price drift** — Recalculate authoritatively inside the confirmation transaction (P13 stateless); the client submits `accepted_total_minor`; if `quote.total ≠ accepted_total` → `PRICE_CHANGED` error, rollback, hold retained within TTL (customer re-accepts). Decreases are inherently accepted (customer saw the fresh quote). Why: BK-005/§21 server-authoritative pricing; §48. Alternatives: accept any drift (charges more than accepted — violates transparency); persist quotes (P13 forbids). Impact: one comparison in the tx. Schema: none.

**TD-3 Magic-link token architecture** — Dedicated hashed-token table (3.10): 256-bit random token, only its sha-256 stored; single-use (consume on verify); TTL (default 15 minutes, branch-configurable); revocation on cancellation or re-issue; scope = exactly one booking. Why: SECURITY_PRIVACY §29–33 + DATABASE §41 (hash storage, scope, expiry, revocation). Alternatives: stateless signed tokens (cannot revoke — fails §29). Rate limiting per email/booking/IP at the action layer (§33). Schema: 3.10.

**TD-3.1 Reschedule hold strategy** — Hold-then-commit swap reusing scheduling slot holds: the reschedule request creates a hold on the target slot (`session_id` = the reschedule idempotency key; S1 one-active-hold rule applies to that session); commit = one transaction [consume new hold → update booking interval → snapshots/events/audit]. The old slot frees automatically because committed bookings occupy capacity via `bookings` (not holds) and the interval update moves it. Failure/expiry → hold expires by TTL; booking untouched. Why: single reservation mechanism (S1); reuses proven S16 primitives; closes §48's check-then-commit gap flagged in the audit. Alternatives: direct re-check without hold (TOCTOU gap); a second hold mechanism (forbidden by S1). Schema: none new.

**TD-3.2 Snapshot history** — Append-only `booking_pricing_snapshots` (3.9) with `is_current`; `bookings` keeps denormalized current totals for querying. Why: DATABASE §16.3 golden rule + BD-3.5 (new authoritative, old preserved). Alternatives: overwrite the jsonb (loses history); snapshots only on the booking row (reschedule overwrites). Schema: 3.9.

**TD-3.3 Reschedule idempotency/concurrency** — Per-attempt key in 3.11 (scope=reschedule); `SELECT … FOR UPDATE` on the booking row serializes simultaneous reschedules of one booking; target-slot contention resolved by hold arbitration (a competing hold on the target makes hold creation fail `SLOT_UNAVAILABLE`); stale requests detected by comparing the booking's current `scheduled_start` with the value the request was built from. Why: §63 idempotency requirement + S16 concurrency model. Schema: 3.11.

**TD-3.4 Event/audit payloads** — `booking_rescheduled` metadata: `previous_scheduled_start/end`, `new_scheduled_start/end`, `actor_type/actor_id`, `reason?`, `pricing_snapshot_seq_old/new`, `price_delta_minor`, `reschedule_count`. `booking_cancelled` metadata: policy snapshot reference, tier applied, `fee_minor`, `amount_owed_minor`, actor. Sensitive-data minimization per §50. Schema: jsonb only.

**TD-3.5 Notification triggers** — `booking_confirmed` → confirmation email; `booking_cancelled` → cancellation email (fee/owed info per NOTIFICATION §29 content list); `booking_rescheduled` → reschedule email; token creation → magic-link email. Outbox rows written inside the business transaction (atomic enqueue). Internal/cleaner notifications: future. Schema: 3.12.

**TD-4 Address strategy** — `customer_addresses` = reusable reference data; every booking stores an immutable `service_address` jsonb snapshot captured at confirmation. Why: reproducibility of the historical booking (golden rule); address edits must never mutate history. Alternatives: live FK on bookings (edits mutate history — rejected). Schema: 3.2 + snapshot column.

**TD-5 Idempotency keys** — Table 3.11; client-supplied key (magic-link session id or staff action id), scope-separated; UNIQUE `(organization_id, scope, key)`; replay returns the stored result without re-execution; keys retained (audit value). Alternatives: natural-key dedup only (unsafe retries); no persistence. Schema: 3.11.

**TD-6 Outbox** — Minimal `notification_outbox` in Change 5 written transactionally; delivery worker, retries, and channels belong to the Notification change (rows remain `pending` until then). Alternatives: post-commit enqueue (loses atomicity); full notification system (out of scope). Schema: 3.12.

## 5. Booking lifecycle

State CHECK as in 3.6; domain-layer + trigger-guarded transitions: `draft→pending` (checkout submission), `pending→confirmed` (confirmation transaction), `pending→cancelled` (abandonment), `confirmed→cancelled`, `assigned→cancelled`, `confirmed→assigned` / `assigned→in_progress` / `in_progress→completed` (Worker-change-driven mirrors — valid in the model, set by future domain), `confirmed/assigned→no_show` (operational, future action surface). Terminal: completed/cancelled/no_show. Rescheduling = mutation + `booking_rescheduled` event (no state).

## 6. Confirmation flow (authoritative)

1. Zod validation (branch context, catalog ids, propertyDetails, address, slot, customer details, `source`, idempotency key, `accepted_total_minor`).
2. Catalog gate: branch active; service sellable; variant/add-on compatible.
3. Service-area gate (BD-6): postal code ∈ `branch_service_areas` for the branch.
4. Scheduling: availability check → hold created/reused (S1; branch TTL).
5. Customer upsert (BD-4): normalize; match email → phone; conflict → keep stored + flag + `contact_conflict_flagged` event; else insert.
6. **One transaction:** final availability re-check (`validateSlotFeasibility`, S16) → `consumeHoldInTx` → `calculateQuote` (P17 by service date; P-D1) → `quote.total == accepted_total_minor` else `PRICE_CHANGED` (TD-2) → allocate booking number (row-lock sequence; BD-5) → insert booking (`status=confirmed`, address snapshot, pricing snapshot, cancellation-policy snapshot from the published policy effective at the service date) → booking_items → `booking_pricing_snapshots(seq=1, is_current)` → booking_events (`booking_created`, `booking_confirmed`) → audit events → outbox rows → idempotency result → **COMMIT**.
7. Failure anywhere → full rollback; hold released; **no booking persisted** (BD-1); idempotency key not marked succeeded (retry allowed).

## 7. Cancellation flow

Actor: customer (magic link) or staff (`bookings.cancel`). State ∈ pending/confirmed/assigned. Customer deadline: `now < scheduled_start` strictly (BD-2.5). Notice = `scheduled_start − now` on UTC instants. Tier from the booking's `cancellation_policy_snapshot`. Fee = half-up(tier% × snapshot total) (BD-2.2). Paid bookings: refund interaction is the Payment-domain contract (§83) — not implemented. Unpaid: `amount_owed_minor` recorded when fee > 0 (BD-2.6); no collection. Events + audit + outbox. Override: separate action, `bookings.override` (HQ Admin), audited with actor/timestamp/booking/original fee/final fee/reason (BD-2.4).

## 8. Rescheduling flow (BD-3)

Preconditions: state ∈ confirmed/assigned; authority (magic-link token or `bookings.edit`); **customer** deadline ≥2h before current `scheduled_start` (BD-3.3a; staff rescheduling is bound by the state rules, not the customer deadline — the literal BD-3 reading, stated explicitly here). Target: full Scheduling feasibility incl. 24h minimum notice (S4) — no same-day targets; grid/exceptions/DST/capacity unchanged. Price: fresh `calculateQuote`; higher → explicit acceptance (TD-2 comparison); lower → auto-apply. Hold per TD-3.1. Transaction: lock booking (TD-3.3) → verify state + unchanged `scheduled_start` → consume target hold → update interval → append new snapshot (`is_current=true`; prior flips false) → update totals → `booking_rescheduled` event (TD-3.4 payload) → audit → outbox row → `reschedule_count+1` → idempotency result → COMMIT. Free (no fee path); unlimited; the cancellation window thereafter uses the new `scheduled_start` (BD-3.4b). Failure → full rollback; old interval + old snapshot fully intact.

## 9. Booking Hub (customer surface)

Token issued post-confirmation and re-issuable (rate-limited). Actions: view booking; timeline (customer-visible events only); reschedule (BD-3); cancel (BD-2); rebook (prefill from a prior booking through the normal confirmation flow — CU-004); Contact CLENQO = branch contact info only (B-NEW-1). Security: hash verify → single-use consume → short-lived server session bound to booking+customer; enumeration-safe responses (§32); rate limits (§33); no staff data exposure.

## 10. Internal operations

Server actions per `lib/permissions.ts`: list/detail/search (`bookings.view`, branch-scoped via `has_branch_access`); staff create-on-behalf (`bookings.create`, same confirmation flow, `source=admin`); cancel (`bookings.cancel`); reschedule (`bookings.edit`, BD-3 rules); fee override (`bookings.override`); customer management + conflict-flag resolution (`customers.view/edit`); audit visibility per `audit.view*`.

## 11. Security summary

RLS combined policies on every table (0006 helpers; tokens table deny-all to app roles); public endpoints: Zod validation, rate limiting, enumeration-safe errors (§87/§32), abuse controls (§34); PII minimized; sensitive access info protected; audit fail-closed (AUDIT §50); magic-link authority never grants staff permissions.

## 12. Testing strategy

**Unit:** transition matrix; tier boundaries (exactly 24h/12h/2h); fee rounding; BD-4 normalization/matching/conflict; 2h deadline + 24h target notice; DST (spring-forward rejected / fall-back first occurrence per S14); price increase/decrease branching; booking-number format/allocation.
**Domain (pglite, full chain 0001→0011):** confirmation happy path; hold consumption; rollback leaves nothing + hold released; idempotent replay; two confirmations on one slot (one wins); expired hold; catalog/service-area rejections; policy snapshot capture; token lifecycle; conflict-flag path; reschedule full flow (accept/reject/decrease/repeat); old-snapshot preservation; outbox rows written transactionally; RLS cross-branch/cross-org denial on all new tables.
**Hosted:** `tests/hosted/booking-hosted-verification.test.ts` per the established convention (schema/constraints/RLS/flows/leftovers=0) + full regression Changes 1–5.

## 13. Documentation sync (post-implementation)

BOOKING_SYSTEM (status), DATABASE §17–21, REQUIREMENTS BK notes, API_STANDARDS, NOTIFICATION (outbox written; delivery deferred), DOCUMENTATION_AUDIT (B-NEW-1 deferral recorded; TD closures).
