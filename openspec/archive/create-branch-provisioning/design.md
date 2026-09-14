# Design: Branch Creation with Automatic Provisioning

**Change ID:** `create-branch-provisioning`

Implementation considerations derived from the source-of-truth documents.
No code or migrations are written in this change.

---

## 1. Current implementation status (verified 2026-09-14)

| Area | Status |
|---|---|
| Application code, migrations, seeds | **Missing** — repository contains only `README.md` + `docs/` |
| OpenSpec structure | **Missing** before this change; minimal conventions created with this change (`openspec/README.md`) |
| Documentation set | **Complete** — 32 documents + audit (`docs/DOCUMENTATION_AUDIT.md`) |
| CRITICAL-1 (permission catalog) | **Resolved** — consolidated catalog in `SECURITY.md` §14 |
| CRITICAL-2 (pricing snapshot) | **Resolved** — canonical representation in `DATABASE.md` §16.3/§18.1/§64 and `PRICING_ENGINE.md` §35–36 (not needed by this change, but unblocks the next one) |

Everything this change specifies is **specified but not implemented**.
Nothing is recreated; the database starts from an empty migration chain.

---

## 2. Authoritative sources

| Topic | Source |
|---|---|
| Branch lifecycle & provisioning flow | `BRANCH_SYSTEM.md` §14–19, `AUDIT_SYSTEM.md` §45–48, `DATABASE.md` §12 |
| Lifecycle states | `draft/provisioning/ready/active/suspended/archived` (branch), `pending/provisioning/ready/failed` (provisioning) — verified identical in BRANCH_SYSTEM, AUDIT_SYSTEM, TESTING_STRATEGY §67, ROADMAP §36 |
| Tables & fields | `DATABASE.md` §6–14, §64, §65 |
| Permissions | `SECURITY.md` §14 consolidated catalog (post-audit) |
| Roles & membership model | `DATABASE.md` §5–9, `SECURITY.md` §20 |
| API contract pattern | `API_STANDARDS.md` §4, §7–13, §32, §50, §62 |
| Provisioning contract | `API_STANDARDS.md` §32, `BRANCH_SYSTEM.md` §15–17 |
| Audit architecture | `AUDIT_SYSTEM.md` §5–7, §46–48 |
| Observability | `OBSERVABILITY.md` §17, §26, §32 |
| Section registry / pages / locales | `CONTENT_SYSTEM.md` §10–21, `LOCALIZATION.md` §5–14 |
| RLS | `DATABASE.md` §39–40, §66; `SECURITY_PRIVACY.md` §11–12 |
| Scope of milestone | `README.md` §13, `REQUIREMENTS.md` §51, `ROADMAP.md` §6.1–6.2 |

---

## 3. Lifecycle and state decisions

* **Creation ≠ activation.** The lifecycle `draft → provisioning → ready →
  active → suspended → archived` is documented in four sources. A newly created
  branch lands in `provisioning`, transitions to `ready` on success (or
  `failed` per the provisioning sub-lifecycle), and remains non-public until an
  explicit `branches.activate` operation. `BRANCH_SYSTEM.md` §19 and §18 both
  require this separation; no document requires auto-activation.
* **Provisioning status is branch state, not a separate table.**
  `BRANCH_SYSTEM.md` §18 defines the provisioning lifecycle;
  `DATABASE.md` §11.1 gives `branches` a `status` plus
  `activated_at/archived_at` timestamps. This change adds
  `provisioning_status`, `provisioning_error`, `provisioning_attempts`, and
  `provisioned_at` columns to `branches` (schema delta specified in
  `specs/branch-provisioning/spec.md`, Deltas section) rather than a parallel
  table — the documents never describe a provisioning-jobs table for the
  synchronous path (`BACKGROUND_JOBS.md` §29 keeps provisioning
  synchronous with async recovery as a later concern).
* **`draft` state:** `DATABASE.md` §11.1's lifecycle starts at `draft`, but
  every creation flow (BRANCH_SYSTEM §15, ROADMAP §6.2) goes straight into
  provisioning. This change creates branches directly in
  `provisioning_status = pending`, `status = provisioning`. The `draft` state
  remains valid for future "create inactive draft branch" flows and is not
  removed from the model.

## 4. Provisioning pipeline

Order follows `BRANCH_SYSTEM.md` §15 and `DATABASE.md` §12:

```text
Tx1 (commits)                Tx2 (the provisioning transaction)
1. branch record      →      2. website record (branch_websites, clenqo-main)
   audit: branch.created     3. website locales
                             4. pages
                             5. page translations
                             6. sections
                             7. navigation + footer
                             8. SEO defaults
                             9. audit events + provisioning_status = ready
                                + branch.ready audit (same tx)

Tx2 failure → Tx3: provisioning_status = failed + provisioning.failed audit
Retry    → guarded Tx2 re-run (provisioning_status = 'failed' guard)
```

* **Transaction model (design-review 2026-09-14):** a naive "everything in one
  transaction" cannot represent a failed state — if the branch row is inside
  the rolled-back transaction, no branch exists to mark `failed`, which would
  violate the documented recoverable-state requirement (`API_STANDARDS.md` §18
  "the system must leave a recoverable provisioning state"; `BRANCH_SYSTEM.md`
  §18/§92 `Branch → provisioning_failed` with error visibility, retry, and
  audit history). The minimal model consistent with the docs is a
  **two-transaction split**:

```text
Tx1 — Creation (commits first)
  ├── branches row: status = provisioning, provisioning_status = pending
  └── audit: branch.created                    (AUDIT_SYSTEM §50)

Tx2 — Provisioning content (the provisioning transaction)
  ├── branch_websites / website_locales / website_pages /
  │   website_page_translations / website_sections / SEO defaults
  ├── branches: provisioning_status = ready, provisioned_at set
  └── audit: website.provisioned, locales.provisioned, pages.provisioned,
      configuration.provisioned, branch.ready   (same tx, AUDIT_SYSTEM §50)

On Tx2 failure → Tx3 — Failure marking (small committed transaction)
  ├── branches: provisioning_status = failed, provisioning_error,
  │   provisioning_attempts = provisioning_attempts + 1
  └── audit: provisioning.failed (stage + error code, no secrets)

Retry → guarded re-run of Tx2 (see below)
```

  `DATABASE.md` §12's "roll back unless a recoverable state is intentionally
  supported" is satisfied: the provisioning-content transaction rolls back
  completely (no orphaned pages/sections/locales), while the branch row
  persists in the documented recoverable state. `AUDIT_SYSTEM.md` §101
  (explicit audit-failure policy per operation): for this change, if an audit
  insert fails inside Tx1/Tx2, the whole transaction aborts (fail-closed) —
  an unrecorded `branch.created` must not exist.
* **Inside vs outside transactions:** domain audit events are transactional
  with the state change they describe (AUDIT_SYSTEM §50). Failure/attempt
  records (`provisioning.failed`, `provisioning.retry_started`) are durable
  committed records of the failure state itself (Tx3 / retry Tx2'). Telemetry
  (metrics/logs) is emitted **outside** all transactions and is diagnostic
  only — never authoritative; it may legitimately record a run that later
  rolled back (OBSERVABILITY §10: logs are not audit).
* **Retry targeting:** a retry does not need per-artifact bookkeeping. The
  recovery cursor is the database itself: existence checks against the
  natural keys below ("detect existing resources → create only missing",
  BRANCH_SYSTEM §17) make Tx2 self-resuming for the only partial states the
  model allows (i.e., none after rollback, or fully provisioned).
* **Concurrency:** `UNIQUE (organization_id, slug)` (`DATABASE.md` §42) makes
  concurrent creations safe — the loser receives `CONFLICT` (or, with the
  same idempotency key, the existing branch). Concurrent retries on the same
  branch serialize through a guarded status transition:
  `UPDATE branches SET provisioning_status = 'provisioning' WHERE id = ? AND
  provisioning_status = 'failed'` — exactly one retry wins; the second
  request sees 0 rows affected and re-reads current status (atomic
  state-transition pattern, `DATABASE.md` §56). The same guarded transition
  makes the retry operation itself idempotent: retrying an already-`ready`
  branch is a no-op returning current state.
* **Idempotency of provisioning inserts:** every provisioning insert uses
  natural keys — `branches(organization_id, slug)` UNIQUE,
  `branch_websites(branch_id)` one active, `website_locales(website_id, locale)`
  UNIQUE, `website_pages(website_id, slug)` UNIQUE,
  `website_sections(page_id, section_key)` UNIQUE (DATABASE.md §42). Duplicate
  records can never accumulate even if a future async path retries after
  partial commits.
* **Residual inconsistency surface:** after Tx2 rollback the only surviving
  artifact is the branch row in `provisioning_status = failed` — this is the
  documented recoverable state (BRANCH_SYSTEM §92, OBSERVABILITY §17
  "FAILED — retry available"), not an inconsistent state. No orphaned
  website/page/section rows can exist because Tx2 is all-or-nothing.
* **Commit-vs-telemetry skew:** if Tx2/Tx3 commit but telemetry delivery
  fails, state and audit are intact; diagnostics are degraded but the audit
  trail + request ID still allow investigation (OBSERVABILITY §100 treats a
  failed audit write as serious; a failed metric/log write is not). If
  telemetry records success but the transaction rolls back, the durable
  `provisioning.failed` audit record (Tx3) remains the truth; the metric
  mismatch is observable noise, never business state.
* **Seeded content is platform-default, not branch production data**
  (`PROJECT_RULES.md`, `DATABASE.md` §55): headline/section placeholders come
  from the master template defaults; localized default text is required only
  for the branch's default locale.

## 5. Authorization

Per `SECURITY.md` §14 consolidated catalog and `BRANCH_SYSTEM.md` §52–58:

* `branches.create`, `branches.activate`, `branches.suspend` — HQ-only
  (org scope; a Branch Manager must never create or activate branches).
* `branches.view` / `branches.edit` — HQ org-wide; Branch Managers receive
  branch-scoped variants via `membership_branches`.
* Server-side check via `lib/authorization` (`requirePermission()` /
  `requireOrganizationAccess()`, `PROJECT_STRUCTURE.md` §32) before the domain
  service runs; RLS is the second boundary, never the first.
* The active-branch UI context is never treated as authorization
  (`API_STANDARDS.md` §9).

## 6. API contract shape

`API_STANDARDS.md` §32 contract with §50 result envelope:

```text
branchService.createAndProvision(input)  →  Result<CreateBranchResult>
```

* Input validated by a Zod schema in `features/branches/schemas/`:
  name, slug (normalized, UNIQUE per org), country, timezone (IANA),
  currency, default_locale, enabled_locales (must include default; subset of
  platform-supported), contact info, service area.
* Errors use stable codes (`API_STANDARDS.md` §24): `FORBIDDEN`,
  `INVALID_INPUT`, `CONFLICT` (slug), `PROVISIONING_FAILED`, `INTERNAL_ERROR`.
* Idempotency: slug uniqueness makes duplicate creation naturally
  idempotent-safe; a repeated identical request returns the existing branch
  (with its current provisioning status) rather than `CONFLICT` when the
  caller supplies the same idempotency key (`API_STANDARDS.md` §19).

## 7. Audit and observability

* Audit events use `resource.action` naming with actor, organization, branch,
  resource, result, request ID, safe metadata (`AUDIT_SYSTEM.md` §7).
  `provisioning.failed` metadata carries the failed stage and error code —
  never secrets, tokens, or full payloads (`AUDIT_SYSTEM.md` §21–25,
  `MEDIUM-6` note in DATABASE §38.1).
* Metrics: `provisioning_started/completed/failed/retried/duration`
  (`OBSERVABILITY.md` §17); logs are structured with `organizationId`,
  `branchId`, `operation`, `requestId` (`OBSERVABILITY.md` §5, §9).
* Telemetry emission points (all outside transactions): start of Tx1, start
  and end of Tx2 (success or failure), each retry. A rollback is recorded as
  a failure telemetry event by the same request handler that then runs Tx3 —
  telemetry and audit may disagree transiently; audit is authoritative
  (design §4).
* A branch must never appear operationally active while provisioning is
  incomplete (`OBSERVABILITY.md` §17) — enforced by the `status` values above.

## 8. RLS sketch (policy intent, not SQL)

* `branches`: select for members of the org (HQ: all; branch-scoped: only
  branches with a `membership_branches` row); mutate via privileged server
  client after application authorization.
* `branch_websites` / `website_*`: follow the parent branch's org/branch scope.
* `audit_logs`: insert-only for the platform; read per `audit.view` /
  `audit.view_branch` scope.
* Helper functions per `DATABASE.md` §57 (`has_organization_access`,
  `has_branch_access`) with recursion safeguards.

## 9. Risks / open decisions for implementation

* Page/section **default layout registry** (which sections on which page type)
  lives in the master template configuration (code-owned registry per
  `CONTENT_SYSTEM.md` §20), not in the database — implementers must not invent
  a `section_registry` table.
* Dashboard "context availability" (ROADMAP §6.2) is satisfied by the branch
  appearing in the authorized branch list for its members; no separate
  provisioning artifact is specified anywhere in the docs.
* Manager assignment, operating hours, services, and pricing are **not**
  provisioned here; they are Phase 1 follow-ons (`BRANCH_SYSTEM.md` §74
  readiness therefore cannot be fully satisfied at `ready` — activation
  additionally requires services/pricing/hours per the §75 checklist).
