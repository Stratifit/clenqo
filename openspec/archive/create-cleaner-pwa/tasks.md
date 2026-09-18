# Tasks: Cleaner Execution PWA (Change 7)

> All tasks verified complete 2026-09 (implementation + verification round).
> Normative source: design.md §1 (BD-C1…BD-C9), §3 (migration 0013), §5 (execution contracts), §6 (completion gates).

## 1. Schema & migration
- [x] 1.1 `supabase/migrations/0013_cleaner_execution.sql` per design §3: jobs execution timestamps (`en_route_at`, `checked_in_at`, `checked_out_at`, `actual_start`, `actual_end`) + consistency CHECKs; `checklist_templates` (versioned, service-scoped, draft/published/retired); `job_checklist_snapshots` (immutable, one per job); `job_checklist_items` (status/completed_at/completed_by/notes); `job_media` (category CHECK before/after/incident_evidence, incident linkage); `job_events` event-type CHECK widened (`en_route`, `checklist_completed`); indexes per design; no GPS/signature columns; no seed content.
- [x] 1.2 RLS on all new tables per design §12 (combined policies via 0006 helpers, cleaner own-active-assignment subselects, no FORCE, no application-role write policies).

## 2. Domain: schemas & errors
- [x] 2.1 Extend `features/worker/schemas` with execution-action Zod schemas (en_route, check_in, start, checklist item update, incident, checkout, complete; no location fields possible — BD-C6).
- [x] 2.2 Extend `features/worker/errors` with stable execution error codes (`COMPLETION_BLOCKED` with gate detail, transition conflicts, checklist denial, media denial).

## 3. Domain: cleaner session context
- [x] 3.1 Worker-owned cleaner resolution chain (design §4): auth user → `employees.user_id` → active employee → branch authorizations → active assignments; stable denials for every failure mode.
- [x] 3.2 `features/cleaner` context helper consuming 3.1 (no duplicated authorization logic).

## 4. Domain: execution contracts
- [x] 4.1 `enRoute` (assigned→en_route, `en_route_at`, idempotent, event + audit).
- [x] 4.2 `checkIn` (assigned/en_route→checked_in — direct path permitted per BD-C2; `checked_in_at`, `actual_start`; idempotent).
- [x] 4.3 `startWork` (checked_in→in_progress; `actual_start`; checklist snapshot ensured).
- [x] 4.4 `checkOut` (`checked_out_at`, `actual_end`; event; does not complete).
- [x] 4.5 `completeCleanerJob` (BD-C9 gate evaluation inside transaction per design §6; completion via existing Worker→Booking contract post-commit; no direct Booking writes).
- [x] 4.6 Concurrency: row-lock serialization per design §5; stale-state echo; idempotent retries converge.

## 5. Domain: checklist
- [x] 5.1 Checklist template management (staff, `employees.manage`-adjacent catalog permission path per design; versioning draft/published/retired; no production seed content).
- [x] 5.2 Snapshot creation at execution start (immutable, provenance template+version, frozen item definitions).
- [x] 5.3 `updateChecklistItem` (pending→completed, notes, `completed_at`/`completed_by`, `checklist_completed` event, immutable after completion).

## 6. Domain: incidents & media
- [x] 6.1 `reportExecutionIncident` via the existing Worker incidents model (no separate domain); incident-evidence linkage.
- [x] 6.2 Media authorization service: category allow-list (before/after/incident_evidence), active-assignment binding, size/type from Media Storage configuration, `incident_evidence` requires incident; `job_media` rows; dedup.
- [x] 6.3 Signed-URL read path minted only after server authorization (private storage, job-scoped paths per MEDIA_STORAGE §67; bucket finalized during implementation).

## 7. Events / audit / outbox
- [x] 7.1 All execution mutations write `job_events` (widened types) + fail-closed audit via existing writers; no second architecture.
- [x] 7.2 Outbox intents continue for operational events; in-app surface consumers defined (BD-C7 — no delivery).

## 8. PWA surface
- [x] 8.1 Web app manifest + icons + installable experience (design §9).
- [x] 8.2 Service worker: static/app-shell caching only; no API/customer-data caching; update prompt.
- [x] 8.3 Offline action queue (BD-C5 design §8): idempotency keys, deterministic replay/ordering, stale/conflict echo, explicit pending states; media requires connectivity.

## 9. Routes & UI (`app/(cleaner)/cleaner/*`)
- [x] 9.1 `/cleaner` home: today/upcoming/completed lists + in-app notification surface (existing intents only).
- [x] 9.2 `/cleaner/today`: today's assignments, branch-local dates/times (employee `preferred_language`, localization fallback per design §10).
- [x] 9.3 `/cleaner/jobs/[id]` execution screen: minimized customer data (BD-C1 field set only), status, en_route/check-in/start/checklist/notes/incidents/photos/checkout/complete actions; no internal notes/email/payment anywhere.
- [x] 9.4 Mobile-first execution UX; no `/admin/*` coupling; no Admin Foundation routes.

## 10. Security verification
- [x] 10.1 RLS tests: every new table — cleaner own-assignment scope, cross-cleaner denial, reassigned/cancelled denial, inactive-employee denial, staff scopes.
- [x] 10.2 Authorization matrix tests for media (upload/read denials, category restrictions, incident linkage requirement).
- [x] 10.3 BD-C1 data-minimization tests: cleaner view payloads contain exactly the allowed customer field set and none of the prohibited fields.

## 11. Tests — domain & lifecycle
- [x] 11.1 Execution contract tests on pglite chain 0001→0013: all transitions incl. direct `assigned→checked_in`, en_route optionality, timestamps, idempotent repeats, concurrent race single-winner, mid-execution reassignment/cancellation denial.
- [x] 11.2 Completion-gate tests: check-in gate, mandatory-checklist gate, high/critical incident block, low/medium non-block, manager override audited+idempotent, booking reaches `completed` via contract (no direct writes).
- [x] 11.3 Checklist tests: snapshot creation/immutability, item completion, mandatory gating, no retroactive change.
- [x] 11.4 Offline queue tests: replay, duplicate-key no-op, stale conflict echo, deterministic ordering, no offline media.

## 12. Tests — PWA & migration
- [x] 12.1 PWA tests: manifest validity, service worker registration + app-shell-only caching assertion, route loading, mobile execution flow smoke.
- [x] 12.2 Migration-chain tests 0001→0013; reapply safety.

## 13. Hosted verification
- [x] 13.1 Apply 0013 to the hosted Supabase project using the established workflow.
- [x] 13.2 `tests/hosted/cleaner-hosted-verification.test.ts` (schema/constraints/RLS/flows/leftovers=0) — all pass.
- [x] 13.3 Full hosted regression Changes 1–7 — all pass; zero leftovers.

## 14. Quality gates
- [x] 14.1 Typecheck, lint, build all clean.
- [x] 14.2 Full local suite green; no secrets/junk; `git diff --check` clean.

## 15. Documentation synchronization
- [x] 15.1 Sync WORKER_SYSTEM (implementation status), DATABASE (§23–29 + new tables), SECURITY/SECURITY_PRIVACY (cleaner execution surface), MEDIA_STORAGE (bucket finalization), NOTIFICATION_SYSTEM (in-app surface), PROJECT_STRUCTURE (features/cleaner, routes), ROADMAP (Phase 2 progress), DOCUMENTATION_AUDIT (TD closures) — without altering the BD-C decision record.
- [x] 15.2 OpenSpec tasks verified against implementation; archive/promotion per the established convention (separate commit, owner-approved).
