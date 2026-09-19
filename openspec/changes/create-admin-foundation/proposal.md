# Proposal: Admin Foundation / Control Center v1 (Change 8)

**Change ID:** `create-admin-foundation`
**Status:** Draft — implementation contract approved (BUILD MODE); precedes migration `0014`.

## Problem

Changes 1–7 delivered a coherent backend transaction engine (branches, catalog,
scheduling, pricing, booking, worker, cleaner execution) with no operable staff
surface:

- no login page, no session middleware, no route protection (`/admin/*` renders
  for unauthenticated users until a server action throws);
- no first-HQ-Admin bootstrap (the hosted test harness creates users via the
  Supabase Auth admin API + SQL — not a supported operating path);
- no `/admin` Control Center dashboard or organization/branch context;
- `resolveActor` resolves the oldest active membership with no branch-context
  application beyond per-request `hasBranchScope` checks;
- `users.invite` exists in the canonical permission catalog with no
  implementation;
- branch activation is hard-blocked by `notification_configuration`, which can
  never be satisfied before the notifications domain ships;
- branch slugs are unique only per organization while public routing
  (BRANCH_SYSTEM §22, C8-3) requires global routing-namespace uniqueness.

## Motivation

The Admin Foundation is the shared predecessor of every future admin-facing
capability (booking/customer admin UI, catalog/pricing/scheduling UIs, CMS,
application review, audit/settings). ROADMAP Phase 1 §16 exit criteria and
Phase 4 §35 (HQ Administration) both depend on it. The decision round
(BD-A1–BD-A4, C8-1, C8-3 — recorded 2026-09 in SECURITY §14, BRANCH_SYSTEM
§12/§19/§22, ADMIN_SYSTEM §3/§22–23, REQUIREMENTS §28/§32, DATABASE §11.1,
DOCUMENTATION_AUDIT §4c) removed every blocking owner decision.

## Scope (foundation only)

1. One-time HQ bootstrap: `/setup` (BD-A1) + CLI/script recovery fallback.
2. Staff login: `/login` (Supabase Auth email/password; no public signup).
3. Session middleware for `/admin/:path*` (refresh + redirect; UX layer).
4. Protected admin route group with server-side layout guard.
5. `/admin` Control Center: operational dashboard (BD-A2).
6. Organization/branch context + branch selector (C8-1; BD-A3 scoping).
7. Permission-aware navigation from the canonical catalog; account menu; sign
   out.
8. Invitation foundation: `users.invite`-gated Supabase Auth admin invite with
   transactional membership + `membership_branches` scope + audit; staff
   deactivation (status-only, never deletes the auth user).
9. Activation readiness per BD-A4: `notification_configuration` advisory;
   audited HQ advisory-only override; mandatory items never overridable.
10. C8-3 slug schema alignment via migration `0014` (global uniqueness,
    validation CHECKs, reserved words, `branch_slug_aliases`).
11. Relocation of existing `/admin/branches|employees|jobs` pages into the
    protected route group with URLs unchanged.

## Dependencies

- Changes 1–6 capability specs (branch-management, service-catalog,
  scheduling-availability, pricing-engine, booking, worker); Change 7 surface
  remains untouched.
- Supabase Auth foundation (`lib/session/server.ts`, `@supabase/ssr`).
- Canonical permission catalog (`lib/permissions.ts`, SECURITY §14) — no new
  permissions.
- Existing audit infrastructure (`audit_logs`, 0004).

## Migration 0014

C8-3 schema alignment only:

- global unique index on `branches.slug` (archived branches retain slug
  reservation); pre-validation of existing rows;
- slug CHECKs: length 2–63, `^[a-z0-9]([a-z0-9-]*[a-z0-9])$`, reserved-word
  list;
- `branch_slug_aliases` (old slug → branch UUID, 301 at the future public-site
  layer) with RLS following the combined-policy pattern.

Explicitly **no other objects**: bootstrap uses the `SETUP_TOKEN` env secret +
zero-active-HQ-admin invariant + existing `audit_logs`; invitation uses the
Supabase Auth admin invite primitive + existing
`memberships`/`membership_branches`; context uses query parameter + a
non-sensitive cookie echo; the dashboard reads existing tables.

## Affected domains

`admin` (new foundation), `branches` (readiness reclassification + slug
constraints + alias table), `authorization` (context helper; catalog
unchanged), `audit` (new event actions), `website` (untouched data model).

## Acceptance criteria

1. `/setup` creates the initial organization (if none) and `hq_admin`
   membership exactly once, then fails closed permanently; attempts audited.
2. Unauthenticated `/admin/*` requests redirect to `/login?next=<safe-local>`;
   `next` validation rejects non-local paths; login returns to `next` or
   `/admin`.
3. Branch context is validated against `membership_branches` on every server
   request; unauthorized branches fail closed.
4. Branch Managers see only their authorized branches in the selector and can
   never use All-Branches; HQ Admin/HQ Staff may use it.
5. Navigation visibility derives solely from the canonical permission catalog.
6. `/admin` dashboard shows org identity, branch lifecycle/provisioning state
   and failures, operational counts from existing domain queries, quick
   actions, current user/role/context — and no analytics metrics.
7. Invitation creates membership + scope transactionally with audit; duplicate
   memberships impossible; existing users are granted without duplicate
   invites; deactivation is audited and never deletes the auth user.
8. Activation keeps all mandatory readiness items; `notification_configuration`
   is advisory; advisory-only override requires actor + reason and is audited;
   mandatory failures cannot be overridden.
9. Global slug uniqueness/validation/reserved words enforced; aliases recorded;
   identity model UUID/display-name/slug unchanged.
10. Migration chain 0001 → 0014 applies cleanly; migration reapply-safe.
11. Typecheck, lint, build green; hosted Change 8 verification and full hosted
    Changes 1–8 regression pass.

## Non-goals

Branch application intake (`/apply/branch`, C8-2 deferral) · public website
renderer · customer booking UI · CMS editors · generic configuration
inheritance engine (C8-4 lighter model) · generic policy engine (C8-5) ·
notification delivery · payments · quality/reviews · reporting/analytics ·
multi-organization support · slug-scoped `/<branch-slug>/admin` · new
permission names · Cleaner PWA changes · customer magic-link changes.

## Risks

- **Middleware treated as the security boundary** — mitigated: middleware is
  UX; server-action/domain authorization + RLS remain authoritative (three
  documented layers, design §13).
- **Setup token leakage** — deployment-held secret, constant-time compare,
  never logged, consumed by the fail-closed invariant, attempts audited.
- **Page relocation regressions** — URLs unchanged; existing admin flows
  covered by the hosted regression suite.

## Verification strategy

Local domain + RLS + route tests (design §15 matrix), migration-chain tests,
`tsc --noEmit`, `eslint`, `next build`, hosted application of 0014, dedicated
hosted Change 8 verification, full hosted Changes 1–8 regression.

## Future boundaries

The shell exposes a plug-in navigation contract (design §17) for later
consumers; nothing in this change precludes application intake, the public
website, or policy templates, but none of their business rules are designed
here (their decision rounds are recorded as deferrals in
DOCUMENTATION_AUDIT §4c).
