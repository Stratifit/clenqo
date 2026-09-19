## ADDED Requirements

### Requirement: Staff login and session protection
Staff authentication SHALL use Supabase Auth exclusively (email/password in V1, no public signup); a `middleware.ts` scoped to `/admin/:path*` SHALL refresh the Supabase session and redirect unauthenticated requests to `/login?next=<safe-local-path>`; the `next` parameter SHALL accept only local paths (leading `/`, no `//`, no scheme) and default to `/admin`; middleware SHALL be a UX layer only — server-action/domain authorization and RLS SHALL remain the authoritative security boundary.

#### Scenario: Unauthenticated admin access redirects
* **WHEN** a user without a valid Supabase session requests any `/admin/*` route
* **THEN** they are redirected to `/login?next=<original-path>` and after login land on the original path

#### Scenario: Unsafe next rejected
* **WHEN** `next` is `//evil.example`, `https://evil.example`, or empty
* **THEN** the login redirect targets `/admin`, never an external URL

### Requirement: One-time HQ bootstrap (BD-A1)
A one-time `/setup` flow SHALL create the initial organization (if none exists) and the first `hq_admin` membership transactionally, only while **zero active `hq_admin` memberships exist**, only for a pre-existing Supabase Auth user, and only with a valid deployment-held one-time `SETUP_TOKEN` compared in constant time and never logged; setup SHALL be audited on success and on every rejected attempt; once an active HQ Admin exists, setup SHALL fail closed permanently; a CLI/script fallback MAY exist only under the identical zero-HQ-admin invariant; no repeatable bootstrap and no "make me admin" endpoint SHALL exist.

#### Scenario: Happy-path bootstrap
* **WHEN** setup runs with a valid token, an existing auth user, and no active HQ Admin
* **THEN** the organization (if needed) and `hq_admin` membership exist in one commit and `admin.setup_completed` is audited

#### Scenario: Bootstrap permanently closed
* **WHEN** setup is attempted after any active HQ Admin exists (valid token or not)
* **THEN** it fails with a stable error and the attempt is audited

#### Scenario: Concurrent setup attempts
* **WHEN** two setup attempts race
* **THEN** exactly one succeeds and the other fails closed

### Requirement: Protected admin shell
`/admin` SHALL live in a protected route group whose server layout guard redirects unauthenticated renders to the login flow; the shell SHALL provide permission-aware navigation derived exclusively from the canonical permission catalog, the current user and role, an account menu with sign-out, and loading/error states; hiding a navigation item SHALL never be the only protection — every route and action SHALL re-check authorization server-side.

#### Scenario: Permission-aware navigation
* **WHEN** users with different permission grants load the shell
* **THEN** navigation shows exactly the modules their canonical permissions allow

### Requirement: Organization/branch context (C8-1)
V1 SHALL use one `/admin` surface with an explicit context model: `?branch=<branchId>` plus a non-sensitive cookie echo, resolved and validated server-side on every request against `membership_branches`; the branch UUID SHALL be the context key and the slug SHALL never be an admin authorization identity; `/<branch-slug>/admin` SHALL NOT exist in V1.

#### Scenario: Context re-validated every request
* **WHEN** a request carries a branch context the actor is not authorized for (stale cookie or forged query)
* **THEN** the request fails closed with FORBIDDEN and no branch data is returned

### Requirement: Branch selector scope (BD-A3)
The branch selector SHALL enumerate only branches the actor is authorized to operate; Branch Managers SHALL be constrained to their `membership_branches` branches and SHALL never be offered an All-Branches context; multi-branch managers MAY switch among their own branches; HQ Admin/HQ Staff MAY use an "All Branches" organization context; cleaners SHALL never enter `/admin` (their surface remains `/cleaner/*`); no new permissions SHALL be introduced.

#### Scenario: Branch manager cannot use All Branches
* **WHEN** a branch manager requests the organization-wide context
* **THEN** the request fails closed with FORBIDDEN

#### Scenario: Multi-branch manager switching
* **WHEN** a manager scoped to two branches switches context
* **THEN** both branches are selectable and only their data is shown

### Requirement: Operational dashboard (BD-A2)
`/admin` SHALL render an operational Control Center: organization/network identity, branch overview with lifecycle and provisioning state including failures, operational counts obtained from existing domain queries (bookings, jobs, employees), quick actions, and current user/role/context; individual query failures SHALL degrade gracefully per card; analytics metrics (revenue, ratings, performance) SHALL NOT appear and domain editors SHALL NOT be bundled into the foundation.

#### Scenario: Dashboard uses existing queries only
* **WHEN** the dashboard loads
* **THEN** all displayed data comes from existing domain services and no new analytics aggregation exists

### Requirement: Staff invitation and deactivation
Invitation SHALL use the Supabase Auth admin invite primitive (`inviteUserByEmail`) behind the canonical `users.invite` permission; membership, `membership_branches` scope, and audit SHALL be created transactionally; existing authenticated users SHALL receive membership/scope without a duplicate invitation; resend SHALL re-invoke the approved primitive; `UNIQUE(organization_id, user_id)` SHALL prevent duplicate memberships; deactivation SHALL set `memberships.status='inactive'`, SHALL be audited, and SHALL never delete the auth user; service-role credentials SHALL never reach the client.

#### Scenario: Existing user granted without duplicate invite
* **WHEN** an HQ user invites an email that already has an auth user
* **THEN** membership/scope are created directly with audit and no second invite is sent

#### Scenario: Duplicate membership prevented
* **WHEN** an invitation targets a user who already has an active membership in the organization
* **THEN** the operation fails with a stable error and no duplicate membership row exists

### Requirement: Activation readiness and advisory override (BD-A4)
Branch activation SHALL keep all mandatory readiness requirements (provisioning ready, website ready, ≥1 active service, published pricing version, operating hours, service area, branch manager); `notification_configuration` SHALL be advisory ("recommended, not required") while notification delivery does not exist; a caller holding `branches.activate` MAY override advisory-only gaps via an explicit server-authoritative action recording actor and reason, audited as `admin.activation_override`; mandatory readiness failures SHALL never be overridable; branches SHALL see their own readiness failures.

#### Scenario: Advisory gap does not block
* **WHEN** a branch satisfies every mandatory item but has no notification configuration
* **THEN** activation succeeds without override and the advisory is displayed

#### Scenario: Advisory-only override audited
* **WHEN** HQ overrides an advisory-only gap with a recorded reason
* **THEN** activation proceeds and `admin.activation_override` records actor, branch, reason, and overridden items

#### Scenario: Mandatory failure never overridden
* **WHEN** activation is attempted with a missing mandatory item and an override reason
* **THEN** activation is rejected

### Requirement: Branch slug routing identity (C8-3)
Public branch slugs SHALL be globally unique across the CLENQO routing namespace (globally unique index; archived branches retain reservation); slugs SHALL be normalized lowercase, restricted to `a-z0-9-`, 2–63 characters, without edge or double hyphens, and SHALL reject the reserved word list; slug changes SHALL be HQ-owned (`branches.edit`), unavailable to branch owners in V1, and immutable after activation; pre-activation changes MAY retain alias/redirect records (`branch_slug_aliases`); branch UUID SHALL remain the internal identity, display name the public identity, and slug the routing identity.

#### Scenario: Global uniqueness enforced
* **WHEN** a second organization attempts a slug already used by any branch (including archived)
* **THEN** creation is rejected with a stable validation error

#### Scenario: Reserved word rejected
* **WHEN** a branch is created with slug `admin` or `cleaner`
* **THEN** creation is rejected

### Requirement: Security layering and audit
Authorization SHALL always enforce all three layers — middleware/session protection, server-action/domain authorization (`currentContext`, `requirePermission`, `hasBranchScope`, `resolveAdminContext`), and PostgreSQL RLS — with server-side validation of branch context on every request and fail-closed behavior on every check; security-sensitive actions (setup success/rejection, invitation, deactivation, activation override) SHALL be audited through the existing `audit_logs` infrastructure with no second audit architecture.

#### Scenario: Client state never authorizes
* **WHEN** any authorization decision is evaluated
* **THEN** it derives only from server-resolved membership, permissions, and RLS — never from cookies, query parameters, or hidden UI

### Requirement: Non-goals (explicit deferrals)
The foundation SHALL NOT include branch application intake (`/apply/branch`), the public website renderer, customer booking UI, CMS editors, a generic configuration-inheritance engine, a generic policy engine, notification delivery, payments, quality/reviews, reporting/analytics, multi-organization support, slug-scoped `/<branch-slug>/admin` routes, new permission names, or Cleaner PWA changes; these remain separate future changes per the recorded decision round.

#### Scenario: No scope leakage
* **WHEN** the implemented change surface is inspected
* **THEN** none of the deferred capabilities exist in code, schema, or routes
