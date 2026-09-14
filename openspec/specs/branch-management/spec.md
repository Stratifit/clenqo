# Branch Management — Creation & Provisioning

**Capability:** `branch-management`
**Status:** Active capability
**Established by:** `openspec/archive/create-branch-provisioning/` (implemented 2026-09-14, commit `b76db9b`; hosted Supabase verification 19/19 PASS)
**Sources:** `BRANCH_SYSTEM.md`, `DATABASE.md`, `SECURITY.md`, `API_STANDARDS.md`, `AUDIT_SYSTEM.md`, `OBSERVABILITY.md`, `LOCALIZATION.md`, `CONTENT_SYSTEM.md`, `REQUIREMENTS.md` §51, `ROADMAP.md` §6.1–6.2

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.

## Requirement: HQ-only branch creation

The system SHALL allow branch creation only for authenticated internal users
holding the `branches.create` permission at organization scope (HQ roles per
`SECURITY.md` §14 and `BRANCH_SYSTEM.md` §53). Authorization SHALL be verified
server-side before any business logic executes; the active branch context in
the UI SHALL NOT be treated as authorization.

#### Scenario: HQ Admin creates a branch

* **WHEN** an authenticated user with `hq_admin` role and `branches.create`
  submits a valid branch creation request for their organization
* **THEN** the request is accepted and a branch provisioning run starts

#### Scenario: Branch Manager cannot create a branch

* **WHEN** an authenticated user whose only role is `branch_manager`
  (branch-scoped via `membership_branches`) submits a branch creation request
* **THEN** the request is rejected with a stable `FORBIDDEN` error before any
  branch record is created, and a `branch.create` authorization failure is
  auditable per `AUDIT_SYSTEM.md` §20

#### Scenario: Unauthenticated request rejected

* **WHEN** a request without a valid server-side session reaches the
  branch-creation endpoint
* **THEN** it is rejected with `UNAUTHENTICATED` and no state changes

#### Scenario: Cross-organization attempt rejected

* **WHEN** an HQ Admin of organization A submits a creation request naming
  organization B
* **THEN** the request is rejected with `FORBIDDEN`; the organization context
  is resolved from the authenticated membership, never from the request body

## Requirement: Branch input validation

The system SHALL validate all creation input server-side with a strict schema
(`API_STANDARDS.md` §12): branch name, slug, country, IANA timezone, currency,
default locale, enabled locales, and contact/service-area information. Invalid
input SHALL produce stable error codes without partial writes.

#### Scenario: Invalid slug rejected

* **WHEN** the submitted slug is empty, non-URL-safe, uppercase, or contains
  reserved path segments
* **THEN** validation fails with `INVALID_INPUT` and field errors identify the
  slug; no branch record is created

#### Scenario: Invalid locale rejected

* **WHEN** `default_locale` or any `enabled_locales` entry is not a
  platform-supported locale (`de/en/fr/es` per `LOCALIZATION.md` §5)
* **THEN** validation fails with `INVALID_INPUT`

#### Scenario: Default locale must be enabled

* **WHEN** `default_locale` is not included in `enabled_locales`
* **THEN** validation fails with `INVALID_INPUT` (`LOCALIZATION.md` §6/§11)

## Requirement: Branch slug uniqueness

The system SHALL enforce branch slug uniqueness within the organization at the
database level (`branches (organization_id, slug) UNIQUE`, `DATABASE.md` §42)
and within the public routing namespace (`BRANCH_SYSTEM.md` §22). Slug
normalization SHALL be deterministic (lowercase, URL-safe).

#### Scenario: Duplicate slug rejected

* **WHEN** a second branch is created with a slug already used by an existing
  branch of the same organization
* **THEN** the operation fails with a stable `CONFLICT` error, no duplicate
  row exists, and no provisioning artifacts are created

#### Scenario: Uniqueness across organizations

* **WHEN** two different organizations each create a branch with slug `berlin`
* **THEN** both succeed; slug uniqueness is scoped per organization per the
  documented constraint

## Requirement: Organization association

Every created branch SHALL belong to exactly one organization resolved from the
authenticated membership (`DATABASE.md` §2.3, §11.1). Client-supplied
organization identifiers SHALL be treated as untrusted input.

## Requirement: Deterministic provisioning pipeline

Branch creation SHALL trigger deterministic provisioning of, in order
(`BRANCH_SYSTEM.md` §15–16, `DATABASE.md` §12): branch record → website record
→ website locales → pages → page translations → sections → navigation and
footer → SEO defaults. The pipeline SHALL create only records defined by the
source documents and SHALL NOT provision services, pricing, operating hours,
notification configuration, or manager assignments (out of scope for this
change; `BRANCH_SYSTEM.md` §74/§75).

#### Scenario: Full provisioning on success

* **WHEN** a branch is created with valid input and the provisioning pipeline
  completes
* **THEN** the branch has one active website record (`branch_websites`)
  bound to the master template, one `website_locales` row per enabled locale
  with exactly one `is_default = true`, the documented default page set
  (home, services, about, contact, faq, legal, booking — `CONTENT_SYSTEM.md`
  §12–13) with unique slugs, page translations for the default locale,
  registered section rows per page layout (`website_sections` with
  `section_type`, `section_key`, `sort_order`, `is_enabled`), a navigation and
  a footer section, and SEO defaults on the website and pages

#### Scenario: Default locale configuration persisted

* **WHEN** a branch is provisioned with default locale `de` and enabled
  locales `de, en`
* **THEN** `website_locales` contains exactly two rows for the website, `de`
  with `is_default = true`, matching `LOCALIZATION.md` §6 and §11

## Requirement: Provisioning lifecycle states

The branch record SHALL expose a provisioning lifecycle
`pending → provisioning → ready | failed` (`BRANCH_SYSTEM.md` §18) and the
branch lifecycle `draft → provisioning → ready → active → suspended →
archived` (`AUDIT_SYSTEM.md` §45). A branch SHALL NOT be publicly resolvable
or activatable until provisioning reaches `ready` (`BRANCH_SYSTEM.md` §18,
`OBSERVABILITY.md` §17).

#### Scenario: Branch never publicly active before ready

* **WHEN** provisioning is `pending`, `provisioning`, or `failed`
* **THEN** public branch resolution does not return an active website for the
  branch slug and activation is refused

## Requirement: Transactional provisioning

Branch creation SHALL commit the branch record in its own transaction
(including the `branch.created` audit event) before provisioning begins, and
provisioning content SHALL run as a second, all-or-nothing transaction that
also sets `provisioning_status = ready` and writes the provisioning audit
events transactionally with the state change (`AUDIT_SYSTEM.md` §50).
Provisioning-failure marking and retry-start marking SHALL be small committed
transactions so the documented recoverable state survives any rollback
(`API_STANDARDS.md` §18; `BRANCH_SYSTEM.md` §18, §92). Domain audit events
SHALL be transactional with the state they describe; failure/attempt records
SHALL be durable committed records of the failure itself. Telemetry (metrics,
logs) SHALL be emitted outside transactions and SHALL NOT be authoritative
for business state (`OBSERVABILITY.md` §10).

#### Scenario: Statement failure aborts cleanly

* **WHEN** any provisioning insert fails mid-pipeline
* **THEN** the provisioning transaction rolls back leaving no orphaned
  websites/pages/sections/locales, the branch row survives, and a committed
  failure transaction sets `provisioning_status = failed` with the failed
  stage and error code plus a `provisioning.failed` audit record

#### Scenario: Audit insert failure fails the operation closed

* **WHEN** an audit event insert fails inside the creation or provisioning
  transaction
* **THEN** the whole transaction aborts (fail-closed per
  `AUDIT_SYSTEM.md` §101), no unrecorded state change persists, and the
  branch ends in the recoverable `failed` state via the failure transaction

#### Scenario: Telemetry loss does not affect business state

* **WHEN** telemetry delivery fails after a transaction commits, or telemetry
  is emitted for a run that then rolls back
* **THEN** business state and audit records are unaffected; the committed
  audit records remain the authoritative history

#### Scenario: Rollback leaves only the documented recoverable state

* **WHEN** the provisioning transaction rolls back for any reason
* **THEN** the only provisioning-related artifacts in the database are the
  branch row (in `provisioning_status = failed` or a later retry state) and
  its audit/attempt records — never orphaned website content

## Requirement: Idempotent provisioning

Provisioning SHALL be safe to re-execute: a retry SHALL detect existing
resources and create only missing ones, and SHALL never create duplicate
pages, sections, locales, or configuration records (`BRANCH_SYSTEM.md` §17).
Uniqueness constraints per `DATABASE.md` §42 SHALL back this behavior.

#### Scenario: Retry creates no duplicates

* **WHEN** a provisioning run executes twice against the same branch
  (simulated failure between runs or repeated request)
* **THEN** the counts of websites, locales, pages, page translations, and
  sections are identical to a single successful run

#### Scenario: Repeated identical request is idempotent

* **WHEN** the same creation request (same idempotency key, `API_STANDARDS.md`
  §19) is submitted twice
* **THEN** the second call returns the existing branch and its current
  provisioning status instead of creating a second branch

## Requirement: Provisioning retry and failure handling

A failed provisioning run SHALL be retryable. Retry SHALL be separately
traceable from the original failure (`AUDIT_SYSTEM.md` §48) and SHALL be
permission-controlled. Failure diagnostics SHALL identify the failed stage
without exposing secrets (`AUDIT_SYSTEM.md` §47). A retry SHALL re-run the
provisioning transaction after atomically transitioning the branch status
from `failed` to `provisioning` via a guarded conditional update, so
concurrent retries serialize and the retry operation itself is idempotent.
Retry SHALL NOT require per-artifact bookkeeping: recovery state is derived
from the natural-key existence checks defined in the idempotency requirement.

#### Scenario: Failed provisioning can be retried

* **WHEN** a branch is in `provisioning_status = failed` and an authorized HQ
  user triggers a retry
* **THEN** the pipeline re-runs, completes, and the branch reaches
  `provisioning_status = ready` with `branch.ready` audited

#### Scenario: Concurrent retries serialize

* **WHEN** two authorized users trigger retry on the same failed branch
  simultaneously
* **THEN** exactly one retry transitions the branch to `provisioning` and
  executes; the other observes the transition and returns current status
  without executing a second pipeline run

#### Scenario: Retry of an already-provisioned branch is a no-op

* **WHEN** retry is requested for a branch whose provisioning status is
  already `ready`
* **THEN** no pipeline run occurs, no duplicate artifacts are created, and
  the operation returns the current branch state

## Requirement: Branch activation is a separate operation

Activation SHALL be a distinct authorized operation (`branches.activate`,
HQ-only) and SHALL require provisioning `ready` plus the documented mandatory
configuration (`BRANCH_SYSTEM.md` §19, §74–75). Creating a branch SHALL NOT
automatically activate it.

#### Scenario: Activation blocked when requirements missing

* **WHEN** activation is requested for a provisioned branch that lacks any
  mandatory item of the readiness checklist (e.g., services, pricing,
  operating hours)
* **THEN** activation is refused with an explicit list of missing requirements

#### Scenario: Successful activation

* **WHEN** an HQ user with `branches.activate` activates a branch whose
  readiness requirements are satisfied
* **THEN** branch status becomes `active`, `activated_at` is set, and
  `branch.activated` is audited

## Requirement: Branch isolation via RLS

All tables created by this capability SHALL have Row Level Security enabled
enforcing organization and branch scope (`DATABASE.md` §39–40, §66;
`SECURITY_PRIVACY.md` §11). A member of one branch SHALL NOT gain access to
another branch's data by manipulating URL, query parameter, branch ID, or
request body (`BRANCH_SYSTEM.md` §59).

#### Scenario: Cross-branch read denied

* **WHEN** a branch-scoped manager of branch A requests branch B's website
  configuration or admin data
* **THEN** the database returns no rows (RLS) and/or the server rejects the
  request with `FORBIDDEN`

#### Scenario: Another organization's data invisible

* **WHEN** any user of organization A queries branch/website data of
  organization B
* **THEN** no rows are returned regardless of known identifiers

## Requirement: Audit events for creation and provisioning

The capability SHALL produce audit records for: `branch.created`,
`website.provisioned`, `locales.provisioned`, `pages.provisioned`,
`configuration.provisioned`, `provisioning.failed`,
`provisioning.retry_started`, `branch.ready`, `branch.activated`
(`AUDIT_SYSTEM.md` §46–48). Records SHALL include actor, organization, branch,
action, resource, timestamp, result, and request ID, with bounded safe
metadata; secrets, tokens, and sensitive payloads are prohibited
(`AUDIT_SYSTEM.md` §21–25).

#### Scenario: Successful run produces the expected audit trail

* **WHEN** provisioning completes successfully
* **THEN** audit records exist for `branch.created` through `branch.ready`
  with the actor and request ID correlating all events

#### Scenario: Failure is audited without sensitive data

* **WHEN** provisioning fails at the sections stage
* **THEN** a `provisioning.failed` record exists whose metadata identifies the
  stage and error code and contains no credentials, tokens, or full payloads

## Requirement: Observability of provisioning

The system SHALL expose provisioning telemetry: started/completed/failed/
retried events and duration (`OBSERVABILITY.md` §17), with structured logs
carrying request ID, organization ID, and branch ID (`OBSERVABILITY.md` §5, §9).
Duplicate/idempotent executions SHALL be distinguishable from first runs.

#### Scenario: Provisioning failure is diagnosable

* **WHEN** a provisioning run fails
* **THEN** the failed stage, error code, branch, and request ID are available
  in logs/metrics such that an operator can diagnose the run without database
  access

#### Scenario: Retry visible in telemetry

* **WHEN** a failed run is retried successfully
* **THEN** telemetry records the retry (`provisioning_retried`) and the
  duration of the successful run

## Requirement: Dashboard context availability

Once provisioning reaches `ready`, the new branch SHALL be resolvable in the
dashboard for authorized users: HQ users see it organization-wide;
branch-scoped users see it only when a `membership_branches` row exists
(`ROADMAP.md` §6.2, `BRANCH_SYSTEM.md` §12). Manager assignment remains an
administrative operation outside this capability's scope.

#### Scenario: New branch appears for HQ

* **WHEN** provisioning completes and an HQ Admin opens the branch list
* **THEN** the new branch appears with its provisioning/activation status

#### Scenario: New branch hidden from unauthorized branch managers

* **WHEN** a branch manager of another branch lists accessible branches
* **THEN** the new branch does not appear (no `membership_branches` row)
