# Design: Admin Foundation / Control Center v1 (Change 8)

Normative. The authoritative decision record is DOCUMENTATION_AUDIT §4c
(BD-A1–BD-A4, C8-1–C8-5) with full contracts in SECURITY §14, BRANCH_SYSTEM
§12/§19/§22, ADMIN_SYSTEM §3/§22–23, REQUIREMENTS §28/§32, DATABASE §11.1.

## 1. Binding decisions

| ID | Decision (summary) |
|---|---|
| BD-A1 | One-time `/setup`; zero-active-HQ-admin invariant; pre-created Supabase Auth user + deployment-held one-time `SETUP_TOKEN`; transactional org+membership creation; audited; permanently fail-closed after bootstrap; CLI fallback with the same invariant; no repeatable bootstrap, no "make me admin" endpoint. |
| BD-A2 | `/admin` = operational dashboard (org identity, branch overview, lifecycle/provisioning state+failures, operational counts from existing queries, quick actions, user/role, permission-aware nav) + protected shell + context model. No analytics; no domain editors. |
| BD-A3 | One shell for all staff roles; Branch Manager context constrained by `membership_branches`; selector enumerates authorized branches only; All-Branches is HQ Admin/HQ Staff only; cleaners never enter `/admin`; no new permissions. |
| BD-A4 | All mandatory readiness items stay; `notification_configuration` advisory; audited `branches.activate` override allowed only for advisory-only gaps (actor + reason); mandatory items never overridable; branches see their own readiness failures. |
| C8-1 | One `/admin` surface; context = `?branch=<branchId>` query + non-sensitive cookie echo, validated server-side per request against `membership_branches`; "All Branches" HQ-only; deep links carry branch UUID; slug is never the admin authorization identity; `/<branch-slug>/admin` is future evolution only. |
| C8-3 | Global slug uniqueness in the public routing namespace; lowercase/NFKC, `a–z0–9-`, 2–63 chars, no edge/double hyphens, reserved words; HQ owns changes (`branches.edit`); owners cannot change slugs in V1; immutable after activation; alias/redirect records; UUID = internal identity, display name = public identity, slug = routing identity. |
| C8-4/C8-5 | Lighter ownership model (role + RLS + domain rules; no inheritance engine); no policy engine. |

## 2. Domain boundary

The admin foundation consumes existing domain services/actions; it never
re-implements business logic. `/cleaner/*` and customer magic-link flows are
untouched. The canonical permission catalog (`lib/permissions.ts`) remains the
single permission authority; no new permission names are introduced.

## 3. Migration 0014 (C8-3 alignment; additive, hosted-safe)

1. Pre-validation: assert no duplicate slugs and no slug violating the new
   CHECKs / reserved-word list (single-org V1 data; abort with a clear error if
   violated).
2. `branches.slug` CHECKs: `char_length(slug) between 2 and 63`;
   `slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])$'`; `slug <> all(reserved words)` —
   reserved: `admin, cleaner, apply, api, login, setup, static, public, assets,
   book, auth, settings, profile, help, legal`.
3. Global uniqueness: create unique index `uq_branches_slug_global` on
   `branches (slug)`. Archived branches **retain slug reservation** (the index
   covers all rows; documented intentionally).
4. `branch_slug_aliases (id uuid pk, organization_id uuid not null references
   organizations, branch_id uuid not null references branches on delete
   cascade, alias text not null, created_at timestamptz default now())`:
   UNIQUE(alias) global, alias subject to the same length/shape/reserved CHECKs
   (a freed slug is only redirectable, never reassignable); combined-policy RLS
   (0007 pattern, org + branch scope, HQ writes via application role).
5. **No other objects.** Bootstrap = `SETUP_TOKEN` env + zero-active-HQ-admin
   query + `audit_logs`; invitation = Supabase `inviteUserByEmail` +
   `memberships` + `membership_branches`; context = query/cookie; dashboard =
   existing tables.

## 4. Authentication and middleware

- Sessions: Supabase Auth session cookies via `@supabase/ssr` exclusively.
- `middleware.ts` with matcher `/admin/:path*`: refresh the Supabase session
  (cookie exchange), detect unauthenticated access, redirect to
  `/login?next=<original-path>`; fail closed (on any session-resolution error,
  treat as unauthenticated).
- `/login`, `/setup`, `/cleaner/*`, static assets, and the future public site
  are exempt from the admin matcher.
- Safe `next`: must begin with `/`, must not begin with `//`, must contain no
  scheme (`://`) or authority; otherwise default `/admin`.
- **Middleware is UX, not the security boundary.** Server actions/domain
  services (`currentContext` → `resolveActor` → permission/branch checks) and
  RLS remain authoritative; the `(admin)/layout.tsx` server guard additionally
  redirects unauthenticated renders.

## 5. Membership and context (resolveActor treatment)

V1 is single-organization; `resolveActor`'s oldest-active-membership
(`limit 1`) resolution remains authoritative for organization identity and is
documented as such (SECURITY §14 record). No multi-organization behavior is
introduced. Branch context is a **UI/navigation preference, never an
authorization claim**.

New narrow helper `features/admin/context.ts`:

```text
resolveAdminContext(ctx, branchParam: string | null | undefined)
  branchParam null | "all"  → org context  — requires role ∈ {hq_admin, hq_staff}
                              (Branch Manager → FORBIDDEN, fail closed)
  branchParam = <uuid>      → verify branch exists in the actor's organization
                              AND hasBranchScope(ctx, branchId) → branch context;
                              otherwise FORBIDDEN (fail closed)
  returns { organizationId, role, branchContext: "org" | { branchId } }
```

The selected branch is re-validated on **every** server request; a stale
cookie/query never widens access. Cookie echo stores only the branch UUID
(non-sensitive; not an authorization claim).

## 6. Bootstrap (`/setup`, BD-A1)

Server action flow (transaction where the architecture supports it):

1. Invariant check: zero `memberships` rows with `role='hq_admin' and
   status='active'`. If any exist → stable error, attempt audited
   (`admin.setup_rejected`, reason `already_bootstrapped`).
2. Token check: constant-time comparison against `process.env.SETUP_TOKEN`;
   missing/invalid → stable error, attempt audited (reason `invalid_token`).
   The token is never logged.
3. Require an existing Supabase Auth user id (created beforehand via the
   Supabase Auth admin surface). No user creation here.
4. Transactionally: create the initial organization if none exists (name from
   setup input); insert `memberships(organization_id, user_id,
   role='hq_admin', status='active')`.
5. Audit `admin.setup_completed` (actor, organization). Setup is thereafter
   permanently fail-closed by the invariant — no token consumption state is
   needed; the invariant is the consumption mechanism.
6. CLI fallback (`scripts/setup-admin.ts`): enforces the identical invariant
   and token check server-side; documented recovery path only.

## 7. Login

`/login`: email/password via Supabase Auth (`signInWithPassword`); no public
signup; enumeration-stable errors; on success redirect to validated `next` or
`/admin`.

## 8. Admin shell and context selector (C8-1)

- Route group `app/(admin)/admin/*`; existing `app/admin/*` pages relocated
  with **URLs unchanged**; `(admin)/layout.tsx` performs the server guard and
  renders the shell.
- Shell: navigation (§10), context selector, current user/role, account menu
  (profile placeholder + sign out), loading/error states (API_STANDARDS).
- Context: `?branch=<branchId>` query param echoed into a non-sensitive cookie
  for navigation persistence; resolved per request via §5; deep links preserve
  the parameter; context changes take effect on the next request.
- Selector enumerates only authorized branches (`listBranchesAction` scoping);
  HQ Admin/HQ Staff additionally get "All Branches"; Branch Managers never see
  it (BD-A3). Branch UUID is the context key — slug is never used.

## 9. Dashboard (BD-A2)

Reads existing domain services only: organization identity; branch overview
(`listBranches` — lifecycle `status`, `provisioning_status`,
`provisioning_error`); operational counts (bookings, jobs, employees via
existing list/count services, branch-context aware); quick actions (create
branch → `branches.create`; invite user → `users.invite`); current user/role/
context. Individual query failures degrade to per-card error states. **No
revenue/rating/performance analytics.**

## 10. Permissions and navigation

Navigation visibility derives exclusively from `hasPermission(ctx, …)` against
the canonical catalog (e.g., Branches → `branches.view`; Employees →
`employees.view`; Jobs → `jobs.view`; future modules hidden until their
permission grants exist). Hidden ≠ protected: every route/action re-checks
server-side (§4/§13).

## 11. Invitation and deactivation

Server actions gated by `users.invite` (canonical permission):

- `inviteUserAction({ email, role, branchIds? })`: validate role ∈ catalog
  roles and branch scope ownership; if the auth user does not exist →
  Supabase `auth.admin.inviteUserByEmail`; then transactionally insert
  `memberships` (role) + `membership_branches` (scope, only for branch-scoped
  roles) + audit `admin.user_invited`. Existing auth users receive membership/
  scope directly without a duplicate invitation.
- Resend re-invokes the invite primitive; `UNIQUE(organization_id, user_id)`
  prevents duplicate memberships.
- `deactivateUserAction`: sets `memberships.status='inactive'`, audited
  (`admin.user_deactivated`); **never deletes the auth user**.
- Service-role credentials stay server-side; the client never sees them.

## 12. Activation readiness (BD-A4)

`features/branches/activation.ts`: `notification_configuration` becomes
`advisory: true` (displayed "recommended, not required"); all other items stay
mandatory. `activateBranch(ctx, branchId, opts?)` accepts an explicit override
path: when all remaining missing items are advisory-only, a caller holding
`branches.activate` may pass `{ overrideReason }` — server-authoritative,
audited `admin.activation_override` (actor, branch, reason, overridden items).
Mandatory failures can never be overridden. Branch-scoped users see their own
readiness failures on the branch detail page.

## 13. Security layers and audit

1. Middleware/session refresh + redirect (UX).
2. Server actions/domain authorization (`currentContext`, `requirePermission`,
   `hasBranchScope`, `resolveAdminContext`) — authoritative for application
   logic.
3. PostgreSQL RLS — authoritative for data access.

Audited events (existing `audit_logs` infrastructure): `admin.setup_completed`,
`admin.setup_rejected`, `admin.user_invited`, `admin.user_deactivated`,
`admin.activation_override`, plus existing `branch.*` events. Fail-closed on
every check; no authorization decision may depend on client-controlled state.

## 14. Route architecture

Public: `/login`, `/setup`. Protected group `(admin)/admin/*`: `page.tsx`
(dashboard), `branches/{page,new,[id]}`, `employees/{page,[id]}`,
`jobs/{page,[id]}` — existing URLs preserved. `app/admin/*` (old unprotected
group) is removed by the relocation. `/cleaner/*` untouched.

## 15. Test strategy

- **Bootstrap:** happy path; invalid/missing token; after-first-HQ-Admin
  (fail-closed); concurrent setup attempts (exactly one succeeds); audit
  records; CLI fallback invariant.
- **Login/session:** unauthenticated `/admin/*` redirect; safe-`next` matrix
  (`/x` ok; `//evil`, `https://…`, blank → `/admin`); session refresh; login
  success/failure.
- **Context:** HQ All-Branches; HQ branch selection; Branch Manager authorized
  branch; Branch Manager All-Branches → FORBIDDEN; unauthorized branch →
  FORBIDDEN; multi-branch manager switching; context echo non-sensitive.
- **Shell/nav:** permission-aware visibility (granted/denied permission sets).
- **Invitation:** unauthorized caller; authorized HQ caller; new-user invite;
  existing-user grant; duplicate membership protection; resend; deactivation
  audited, auth user retained.
- **Readiness:** mandatory blocking (each item); advisory
  `notification_configuration` non-blocking; advisory override audited;
  mandatory override → rejected.
- **Slug (C8-3):** global uniqueness (incl. cross-organization and archived
  reservation); CHECKs (length/shape/reserved); alias insert + uniqueness.
- **RLS:** alias table policies; existing policies unchanged.
- **Migration:** chain 0001 → 0014; reapply-safety.
- **Regression:** Changes 1–7 suites remain green; full hosted regression
  1–8.
- Gates: `tsc --noEmit`, `eslint`, `next build`.

## 16. Observability and localization

Structured errors via `AppError`/`ErrorCode`; `audit_logs` is the trace of
record (no second audit architecture). UI text is English-only in V1 (the i18n
runtime is a future localization change; LOCALIZATION §55 context);
timestamps render in branch timezone where shown.

## 17. Future consumer boundaries

The shell + context + navigation contract is the plug-in point for later
modules (bookings, customers, services, scheduling, pricing, CMS, audit UI,
settings, application review). Adding a module = new route + navigation entry
gated by its existing permission — no shell redesign, no new permission
mechanism.
