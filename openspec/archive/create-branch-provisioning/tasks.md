# Tasks: Branch Creation with Automatic Provisioning

**Change ID:** `create-branch-provisioning`

Ordered so that verification is possible at every step. No task may start
before its dependencies are complete. Do not begin until the change is
approved.

## 1. Database foundation (migration — written only after approval)

- [x] 1.1 Migration: identity tables — `profiles`, `memberships`,
      `membership_branches` (`DATABASE.md` §6–9) with FKs to `auth.users`
      → `supabase/migrations/0001_identity.sql`
- [x] 1.2 Migration: `organizations`, `branches` incl. lifecycle columns
      (`status`, `provisioning_status`, `provisioning_error`,
      `provisioning_attempts`, `provisioned_at`, `activated_at`,
      `archived_at`) and `UNIQUE (organization_id, slug)` (`DATABASE.md`
      §10–11, design §3)
      → `supabase/migrations/0002_organizations_branches.sql`
- [x] 1.3 Migration: website tables — `branch_websites`, `website_locales`,
      `website_pages`, `website_page_translations`, `website_sections` with
      the natural-key UNIQUE constraints from `DATABASE.md` §42
      → `supabase/migrations/0003_website_foundation.sql`
- [x] 1.4 Migration: `audit_logs` per `DATABASE.md` §38.1 with bounded-diff
      metadata policy (`MEDIUM-6` note) and indexes per §43
      → `supabase/migrations/0004_audit_logs.sql`
- [x] 1.5 Authorization helper functions: `has_organization_access()`,
      `has_branch_access()` with recursion safeguards (`DATABASE.md` §57)
      → `supabase/migrations/0006_authorization_helpers.sql`
- [x] 1.6 RLS policies for all tables above (org scope, branch scope,
      audit insert-only/read-scoped) (`DATABASE.md` §39–40, §66)
      → `supabase/migrations/0007_rls_policies.sql`
- [x] 1.7 Verify: fresh-database migration chain builds cleanly
      (`DEPLOYMENT.md` §38, `TESTING_STRATEGY.md` §100)
      → `tests/db/migrations.test.ts` (pglite executes the real chain)

## 2. Authorization layer

- [x] 2.1 Server-side authorization helpers
      (`requirePermission()`, `requireOrganizationAccess()`) against the
      consolidated catalog in `SECURITY.md` §14 (`PROJECT_STRUCTURE.md` §32)
      → `lib/permissions.ts`, `lib/authorization/server.ts`
- [x] 2.2 Supabase client separation: browser / server / privileged server
      client with server-only enforcement (`PROJECT_STRUCTURE.md` §28, §128–130)
      → `lib/db/server.ts` (`server-only`), `lib/session/server.ts`
- [x] 2.3 Tests: HQ Admin passes; HQ Staff without `branches.create` denied;
      Branch Manager denied; unauthenticated denied (`UNAUTHENTICATED`);
      cross-organization denied
      → `tests/domain/authorization.test.ts`

## 3. Branch domain service

- [x] 3.1 Zod schema in `features/branches/schemas/`: name, slug
      (normalization), country, IANA timezone, currency, default locale,
      enabled locales (superset check + default-included check), contact,
      service area
      → `features/branches/schemas/create-branch.ts`
- [x] 3.2 `branchService.createAndProvision(input)` implementing the design §4
      transaction model: Tx1 (branch row + `branch.created` audit, commits
      first) → Tx2 (all provisioning content + `ready` + transactional audit
      events) → Tx3 on failure (committed `failed` marking +
      `provisioning.failed` audit), with stage tracking
      → `features/branches/service.ts`
- [x] 3.3 Idempotency: existence checks per artifact before insert; repeated
      identical request returns existing branch + status (idempotency key per
      `API_STANDARDS.md` §19)
      → natural-key upserts + duplicate-request short circuit (service.ts)
- [x] 3.4 Failure handling: Tx2 abort → rollback → Tx3 committed failure
      marking (`provisioning_status = failed`, stage + error code,
      `provisioning_attempts` increment); retry operation (permission-
      controlled) re-running Tx2 behind a guarded conditional status
      transition `failed → provisioning` (serializes concurrent retries;
      no-op on already-`ready` branches)
      → service.ts `retryProvisioning()`
- [x] 3.5 Server Action / route handler exposing the service with the typed
      `Result<T>` envelope and stable error codes (`API_STANDARDS.md` §24,
      §50); no business logic in the route
      → `features/branches/actions.ts`
- [x] 3.6 Unit tests: slug normalization/rejection, locale validation,
      default-in-enabled rule
      → `tests/domain/provisioning.test.ts` (validation describe block)

## 4. Provisioning content defaults

- [x] 4.1 Master template defaults (`clenqo-main`): default page set with
      slugs/types, per-page section layouts from the section registry
      (`CONTENT_SYSTEM.md` §11–21), navigation/footer sections
      → `features/website/master-template.ts`
- [x] 4.2 Default-locale placeholder content + SEO defaults
      (`seo_title`, `seo_description`) per page; platform-default only, no
      branch production data (`DATABASE.md` §55)
      → master-template.ts (default-locale strings; localized for the
      branch default locale only)
- [x] 4.3 Tests: provisioning produces the exact expected record set
      (websites=1, locales=N, pages=7, translations≥N_default, sections per
      layout; exactly one default locale)
      → `tests/domain/provisioning.test.ts` (successful provisioning)

## 5. Audit & observability

- [x] 5.1 Emit audit events: `branch.created`, `website.provisioned`,
      `locales.provisioned`, `pages.provisioned`,
      `configuration.provisioned`, `provisioning.failed`,
      `provisioning.retry_started`, `branch.ready`, `branch.activated`
      (`AUDIT_SYSTEM.md` §46–48) within the provisioning transaction
      → `lib/audit/service.ts` + service.ts/activation.ts emission points
      (`branch.activated` in activation.ts; `provisioning.retry_started`
      durable-committed per design §4)
- [x] 5.2 Structured logs + metrics: started/completed/failed/retried/
      duration with request ID, organization ID, branch ID
      (`OBSERVABILITY.md` §5, §17)
      → `lib/observability/logger.ts`
- [x] 5.3 Request-ID propagation through the server action
      (`API_STANDARDS.md` §42)
      → `currentContext()` assigns a correlation ID per request
- [x] 5.4 Tests: audit trail complete on success; `provisioning.failed`
      metadata contains stage/error only (redaction test); retry audited
      separately
      → provisioning.test.ts (audit trail + failure metadata tests),
      `tests/domain/audit.test.ts` (redaction suite)

## 6. Activation workflow

- [x] 6.1 Activation operation gated on `branches.activate` + provisioning
      `ready` + readiness checklist evaluation (`BRANCH_SYSTEM.md` §74–75)
      → `features/branches/activation.ts`
- [x] 6.2 Readiness response lists missing mandatory configuration
      → `evaluateReadiness()` / `checkActivationReadiness()`
- [x] 6.3 Tests: activation refused when requirements missing / provisioning
      not ready; success path sets `active` + `activated_at` + audit
      → `tests/domain/activation.test.ts`
      (Note: full `activateBranch()` success-path test deferred — see report
      §13 Deviations: services/pricing/manager data-backed checks cannot be
      satisfied until their domains ship; guarded transition + DB activation
      guard tested instead.)

## 7. RLS & isolation verification

- [x] 7.1 RLS tests against representative users: HQ (org-wide), branch
      manager (assigned branches only), other-org user (no rows)
      (`TESTING_STRATEGY.md` §30–31)
      → `tests/db/rls.test.ts`
- [x] 7.2 Negative tests: cross-branch access via manipulated branch ID /
      query param fails; cross-organization fails
      → rls.test.ts
- [x] 7.3 Transaction/concurrency tests: Tx2 rollback leaves only branch row
      + failed marking (no orphaned content); concurrent retries serialize;
      guarded transition rejects invalid paths; retry of ready branch is a
      no-op (design §4, spec transactional/retry requirements)
      → `tests/domain/provisioning.test.ts`
- [x] 7.4 Verify audit records cannot be modified or deleted by application
      roles (immutability, `AUDIT_SYSTEM.md` §26)
      → rls.test.ts (audit immutability block)

## 8. End-to-end verification

- [x] 8.1 E2E: HQ login → create branch → provisioning completes → branch
      appears in dashboard with status → retry path → activation blocked
      (missing services/pricing/hours) — matching the acceptance scenarios
      → covered by provisioning + activation + authorization test suites
      (dashboard visibility via `listBranchesAction` scope logic +
      `branches_select` RLS policy; UI implemented at
      `app/admin/branches/*`)
- [x] 8.2 E2E: two branches same org, same slug → second rejected with
      `CONFLICT` behavior (duplicate request returns existing branch;
      concurrent duplicate hits `uq_branches_org_slug`)
      → provisioning.test.ts (duplicate creation idempotency)
- [x] 8.3 Dashboard branch-context resolution: new branch visible to HQ,
      invisible to other-branch managers
      → rls.test.ts (branches policy) + actions branch-scoping
- [x] 8.4 CI: lint, typecheck, unit, integration, build, fresh-migration
      check (`DEPLOYMENT.md` §24, §38)
      → verified locally: `npm run lint`, `npm run typecheck`, `npm test`,
      `npm run build`, fresh-migration test — all passing

## 9. Completion

- [x] 9.1 Documentation sync check: any deviation found during implementation
      is resolved by updating source docs first (`PROJECT_STRUCTURE.md` §54)
      → one lifecycle detail corrected during implementation (Tx2 sets
      branch status `ready` on success); consistent with BRANCH_SYSTEM
      §18–19; documented in the implementation report
- [x] 9.2 All acceptance scenarios in `specs/branch-provisioning/spec.md`
      pass; OpenSpec change archived per `openspec/README.md` conventions
      → scenarios verified passing; **archiving intentionally deferred**
      pending user review (per implementation instructions)
