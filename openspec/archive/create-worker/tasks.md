# Tasks: Worker / Workforce Foundation (Change 6)

> Normative source: design.md §1 (BD-W1…BD-W13) and §4 (TD-W1…TD-W10).
> All tasks verified complete 2026-09 (implementation + verification round).

## 1. Schema & migration
- [x] 1.1 `supabase/migrations/0012_worker.sql` per design §3: employees, employee_number_sequences, employee_branches, employee_skills, employee_availability, employee_availability_exceptions, jobs, job_assignments, job_events, incidents, job_number_sequences — UUID PKs, org(+branch) scoping, composite same-branch FKs, timestamptz UTC.
- [x] 1.2 Constraints: status/type CHECKs (BD-W2/W3), job & assignment state CHECKs, `JOB-`/`EMP-` number format CHECKs + per-org UNIQUEs, partial UNIQUE one-job-per-booking (BD-W4), partial UNIQUE one-non-terminal-assignment (BD-W8), skill_key CHECK namespace (BD-W11), incident type CHECK, append-only guard trigger on job_events.
- [x] 1.3 Indexes per §3; migration-chain test extended 0001→0012.

## 2. RLS & authorization
- [x] 2.1 Combined RLS policies per TD-W2 (HQ org-wide, branch via has_branch_access, cleaner own-row/own-job subselects); sequences tables staff-only; no FORCE; no app-role write grants.
- [x] 2.2 Server-side authorization wiring (`employees.*`, `jobs.*` per lib/permissions.ts) — no new permissions.

## 3. Zod schemas & errors
- [x] 3.1 Employee/branch-membership/skill/availability/exception/job/assignment/incident schemas.
- [x] 3.2 Stable error codes (EMPLOYEE_INACTIVE, NOT_BRANCH_AUTHORIZED, SKILL_MISSING, QUALIFICATION_EXPIRED, EMPLOYEE_UNAVAILABLE, ASSIGNMENT_CONFLICT, ASSIGNMENT_EXISTS, JOB_STATE_INVALID, JOB_ALREADY_EXISTS …) mapped to the platform envelope.

## 4. Employee domain
- [x] 4.1 Employee CRUD + deactivation (BD-W2 lifecycle; `user_id` nullable linkage BD-W12).
- [x] 4.2 employee_branches M2M management (BD-W1).
- [x] 4.3 Skills + qualification metadata incl. expiry (BD-W11); EMP-number allocation (org-unique, monotonic, never reused).

## 5. Availability
- [x] 5.1 Recurring weekly windows + effective dating (TD-W6/DATABASE §25.1).
- [x] 5.2 Typed exceptions overriding recurring availability (§25.2); branch-tz/DST interpretation helpers.

## 6. Jobs
- [x] 6.1 `ensureJobForBooking` post-commit creation per BD-W6/TD-W1 (idempotent, retry-convergent, booking survives failure).
- [x] 6.2 JOB-number allocation (BD-W5/TD-W5: row-lock, year from booking branch-local scheduled_start, never reset).
- [x] 6.3 Immutable job snapshots (TD-W3) incl. minimized customer display and `pricing_version_id` reference only.
- [x] 6.4 Staff-authoritative lifecycle transitions (pending→assigned on assignment; assigned→completed staff path; cancellation only via booking contracts).

## 7. Assignments
- [x] 7.1 Eligibility validator per design §7 (existence, active status, branch authorization, skills, qualification validity, availability incl. exceptions, global cross-branch conflict, job timing, one-active backstop).
- [x] 7.2 Transactional assign (FOR UPDATE, BD-W9 immediate active), atomic reassignment (cancel+create in one tx, history preserved), idempotent retries (TD-W7).
- [x] 7.3 Assignment cancel/release path (BD-W7c) with events + audit.

## 8. Booking ↔ Job contracts
- [x] 8.1 Worker-owned contracts: propagateRescheduleToJob (same job, interval update, retain+revalidate, flag-not-unassign BD-W7b), propagateCancellationToJob (BD-W7c), propagateNoShowToJob (BD-W7d cancelled + no_show incident).
- [x] 8.2 Booking-owned transition contract `applyJobDerivedBookingTransition` (assigned/in_progress/completed; idempotent, state-guarded, audited) + call sites post-Worker-commit (TD-W4).
- [x] 8.3 Hook confirmation action post-commit + reschedule/cancel/no_show actions to the contracts (BD-W6/7).

## 9. Incidents
- [x] 9.1 Minimal incident model incl. no_show creation from BD-W7d; no quality workflow.

## 10. Events / audit / outbox
- [x] 10.1 job_events writer + payload schemas (TD-W8); fail-closed transactional audit.
- [x] 10.2 Outbox rows for job_created/job_assigned/reassignment/job_cancelled (delivery remains Notification-domain).

## 11. Scheduling occupancy unification
- [x] 11.1 Remove the speculative `jobs` probe from `loadOccupied`; bookings remain the single occupancy source (BD-W13/TD-W10); regression-proof availability tests.

## 12. Internal operations UI
- [x] 12.1 Employees surfaces: list/detail/create/edit/branches/skills/availability/status (employees.view/manage).
- [x] 12.2 Jobs surfaces: list/detail/search (WORKER §68 fields)/assignment panel/eligibility feedback (jobs.view/manage/assign).
- [x] 12.3 No cleaner routes anywhere (BD-W10).

## 13. Tests, docs, verification
- [x] 13.1 Unit tests (design §11 unit list).
- [x] 13.2 Domain tests (design §11 domain list incl. RLS denials, races, rollback, propagation, occupancy).
- [x] 13.3 Hosted suite `worker-hosted-verification.test.ts` + full hosted regression Changes 1–6.
- [x] 13.4 Quality gates: typecheck, lint, build, full local suite.
- [x] 13.5 Documentation sync (design §12) incl. DOCUMENTATION_AUDIT HIGH-6 closure.
- [x] 13.6 Acceptance walkthrough: confirm booking → job appears → assign (validated) → reassign (history) → reschedule booking (job interval + revalidation) → cancel booking (job cancelled, released) → no_show (incident) → complete job (booking completed).
