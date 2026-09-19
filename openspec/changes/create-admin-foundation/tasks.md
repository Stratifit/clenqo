# Tasks: Admin Foundation / Control Center v1 (Change 8)

> All tasks completed and verified (implementation, local + hosted suites, quality gates).
> Normative source: design.md §1 (BD-A1–A4, C8-1, C8-3), §3 (migration 0014), §5–§12 (contracts), §15 (test matrix).

## 1. Migration 0014 (C8-3)
- [x] 1.1 `supabase/migrations/0014_admin_foundation.sql`: pre-validation of existing slugs; `branches.slug` CHECKs (length 2–63, shape, reserved words); global unique index `uq_branches_slug_global`; `branch_slug_aliases` table with UNIQUE(alias) + same CHECKs + combined-policy RLS.
- [x] 1.2 Update migration-chain and table-set tests to 0001–0014 with documented supersession rationale.

## 2. Authentication foundation
- [x] 2.1 `middleware.ts` (matcher `/admin/:path*`): Supabase session refresh, fail-closed redirect to `/login?next=<safe-local>`; exempt `/login`, `/setup`, `/cleaner`, static.
- [x] 2.2 `/login` route + server action: `signInWithPassword`, no signup, enumeration-stable errors, safe-`next` validation (leading `/`, no `//`, no scheme; default `/admin`).

## 3. One-time setup (BD-A1)
- [x] 3.1 `/setup` route + server action: zero-active-HQ-admin invariant, constant-time `SETUP_TOKEN` compare (never logged), transactional initial organization (if none) + `hq_admin` membership, audit `admin.setup_completed`/`admin.setup_rejected`, permanently fail-closed after bootstrap.
- [x] 3.2 `scripts/setup-admin.ts` CLI fallback enforcing the identical invariant + token check.

## 4. Admin context (C8-1)
- [x] 4.1 `features/admin/context.ts`: `resolveAdminContext` (org context HQ-only; branch UUID validated against `membership_branches` fail-closed; V1 single-org resolution documented).
- [x] 4.2 Context plumbing: `?branch=<branchId>` + non-sensitive cookie echo; per-request server re-validation.

## 5. Protected admin shell
- [x] 5.1 Relocate `app/admin/*` → `app/(admin)/admin/*` (URLs unchanged); `(admin)/layout.tsx` server guard; remove the old unprotected layout.
- [x] 5.2 Shell: permission-aware navigation (canonical catalog), current user/role, account menu, sign-out action, loading/error states.

## 6. Branch selector (BD-A3)
- [x] 6.1 Selector enumerating only authorized branches; HQ-only "All Branches"; context effective next request; deep links preserve `?branch=<uuid>`.

## 7. Dashboard (BD-A2)
- [x] 7.1 `/admin` dashboard: org identity, branch overview (lifecycle/provisioning state+failures), operational counts via existing services with per-card graceful failure, quick actions, user/role/context. No analytics.

## 8. Invitation foundation
- [x] 8.1 `users.invite`-gated server actions: invite (new user via `inviteUserByEmail`; existing user direct grant), transactional memberships + membership_branches + audit; duplicate protection; resend.
- [x] 8.2 `deactivateUserAction`: status→inactive + audit; never delete the auth user. Minimal HQ UI surface.

## 9. Activation readiness (BD-A4)
- [x] 9.1 `evaluateReadiness` reclassification: `notification_configuration` advisory; UI distinguishes mandatory vs advisory.
- [x] 9.2 `activateBranch` advisory-only override (actor + reason required, audited `admin.activation_override`); mandatory failures never overridable.

## 10. Tests
- [x] 10.1 Domain: bootstrap matrix (happy/invalid token/after-bootstrap/concurrent/audit/CLI invariant); context resolution (HQ all, authorized/unauthorized branch, Branch Manager restrictions, multi-branch switching); invitation matrix (unauthorized/authorized/new-user/existing-user/duplicate/resend/deactivate); readiness (mandatory blocking, advisory non-blocking, audited override, mandatory override rejected); slug constraints (global uniqueness incl. archived reservation, CHECKs, aliases).
- [x] 10.2 RLS: `branch_slug_aliases` policies; existing policy regression.
- [x] 10.3 Route/session: unauthenticated redirect, safe-`next` matrix, context echo.
- [x] 10.4 Quality gates: `tsc --noEmit`, `eslint`, `next build`.

## 11. Documentation synchronization
- [x] 11.1 Append implemented-notes at the decision-record anchors: DATABASE §11.1, BRANCH_SYSTEM §12/§19/§22, ADMIN_SYSTEM §3, REQUIREMENTS §28/§32, SECURITY §14, ROADMAP §35/§36; mark tasks complete per convention.

## 12. Hosted verification
- [x] 12.1 Apply 0014 to the hosted CLENQO Supabase project (established workflow); verify constraints/policies.
- [x] 12.2 Dedicated hosted Change 8 verification suite; full hosted Changes 1–8 regression; zero leftovers.
