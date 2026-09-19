# CLENQO Project Structure

## 1. Purpose

This document defines the canonical structure of the CLENQO repository.

It establishes:

* application boundaries
* domain boundaries
* route organization
* UI organization
* database organization
* shared code
* tests
* configuration
* documentation
* OpenSpec integration

The structure must support the complete CLENQO platform without allowing unrelated concerns to become tightly coupled.

---

# 2. Core Principle

> **Organize the code around business capabilities and clear boundaries, not around arbitrary technical layers alone.**

The repository should make it obvious where functionality belongs.

---

# 3. Repository Philosophy

CLENQO uses:

```text
one repository
one application
one database
one deployment model
many branches
```

Branch-specific behavior is configuration/data.

It must not create branch-specific source code.

---

# 4. High-Level Repository

The target structure is:

```text
clenqo/
├── app/
├── components/
├── features/
├── lib/
├── hooks/
├── types/
├── config/
├── public/
├── supabase/
├── tests/
├── docs/
├── openspec/
├── scripts/
├── .github/
├── package.json
├── tsconfig.json
├── next.config.ts
├── eslint.config.*
├── postcss.config.*
├── README.md
└── .env.example
```

The exact filenames may evolve with implementation.

---

# 5. Next.js Application

`app/` contains the Next.js routing layer.

It should primarily define:

* routes
* layouts
* loading states
* error states
* route-level composition
* server/client boundaries

Business logic should not be placed directly into route files when it belongs to a domain module.

---

# 6. App Router

CLENQO uses the Next.js App Router.

Conceptually:

```text
app/
├── (public)/
├── (booking)/
├── (customer)/
├── (admin)/
├── (cleaner)/
├── api/
├── layout.tsx
├── error.tsx
├── not-found.tsx
└── globals.css
```

Route groups are organizational and do not necessarily appear in URLs.

---

# 7. Public Routes

Public website routes should be organized separately from internal dashboard routes.

Example:

```text
app/
└── (public)/
    └── [branchSlug]/
        ├── page.tsx
        ├── services/
        ├── faq/
        ├── contact/
        └── ...
```

The actual route hierarchy follows the finalized website information architecture.

---

# 8. Branch Routing

Branch routing must be dynamic.

Example:

```text
[branchSlug]
```

The route resolves the branch from the database.

Never create:

```text
app/berlin/
app/leipzig/
app/munich/
```

for individual branches.

---

# 9. Branch Context

A resolved branch context should provide the application with:

```text
organization
branch
locale
timezone
currency
website configuration
```

Only authorized internal routes may use privileged branch data.

---

# 10. Booking Routes

Booking should have a dedicated route group.

Conceptually:

```text
app/
└── (booking)/
    └── [branchSlug]/
        └── book/
            ├── page.tsx
            ├── loading.tsx
            └── ...
```

The exact step structure may evolve.

---

# 11. Customer Routes

Customer booking management should be isolated from internal administration.

Example:

```text
app/
└── (customer)/
    └── manage/
        └── [token]/
```

The token-based access must be securely validated server-side.

---

# 12. Admin Routes

The admin dashboard should be centrally hosted.

Conceptually:

```text
app/
└── (admin)/
    └── admin/
        ├── page.tsx
        ├── branches/
        ├── bookings/
        ├── customers/
        ├── employees/
        ├── jobs/
        ├── services/
        ├── pricing/
        ├── website/
        ├── payments/
        ├── invoices/
        ├── quality/
        ├── reports/
        ├── users/
        └── settings/
```

Actual URL naming can be adjusted without changing domain boundaries.

---

> **Resolved (C8-1 — Change 8 decision record):** the actual URL structure for
> the implemented V1 is `/login` (+ `/setup` one-time bootstrap, BD-A1) and
> one protected `/admin` surface carrying an explicit server-resolved
> branch context (query parameter + cookie echo; BRANCH_SYSTEM §12 record) —
> not slug-scoped `/<branch-slug>/admin` routes, which remain a documented
> future evolution. Route groups (`(public)`, `(booking)`, `(customer)`,
> `(admin)`) organize code; `(public)`/`(booking)`/`(customer)` are created by
> their own future changes, not by the Admin Foundation. **Implemented
> (Change 8):** `app/(auth)/login/page.tsx`, `app/(auth)/setup/page.tsx`, and
> `app/(admin)/admin/*` — the existing branches/employees/jobs pages moved
> into the `(admin)` group byte-identical (URLs `/admin/branches`,
> `/admin/employees`, `/admin/jobs` unchanged) under the shared protected
> shell (`layout.tsx`: permission-aware nav, context selector, account
> menu, sign out). The `bookings/customers/services/pricing/website/
> payments/invoices/quality/reports/users/settings` directories in the
> conceptual tree above remain future consumer routes, not Change 8 scope.

# 13. Cleaner Routes

Cleaner operations should have a mobile-first experience.

Conceptually:

```text
app/
└── (cleaner)/
    └── cleaner/
        ├── page.tsx
        ├── jobs/
        ├── schedule/
        ├── notifications/
        └── profile/
```

---

# 14. API Routes

`app/api/` should contain HTTP endpoints where required.

API routes should remain thin.

Preferred flow:

```text
API Route
 ↓
Authentication
 ↓
Authorization
 ↓
Validation
 ↓
Domain Service
 ↓
Database / Provider
```

---

# 15. Server Actions

Server Actions may be used for appropriate dashboard/form mutations.

They must follow the same:

```text
authentication
authorization
validation
domain logic
```

rules as API routes.

---

# 16. No Business Logic in UI

Avoid putting core business rules inside:

```text
React components
page.tsx
client hooks
```

Examples that belong elsewhere:

```text
pricing calculation
booking validation
availability
permission evaluation
payment state transitions
assignment logic
```

---

# 17. Components

`components/` contains reusable presentation components.

Example:

```text
components/
├── ui/
├── layout/
├── navigation/
├── forms/
├── tables/
├── feedback/
└── shared/
```

---

# 18. UI Components

`components/ui/` contains reusable primitives based on shadcn/ui and approved design-system components.

Examples:

```text
Button
Input
Select
Dialog
Sheet
Tabs
Card
Table
Badge
```

---

# 19. Layout Components

Shared layouts may include:

```text
Header
Footer
DashboardShell
Sidebar
MobileNavigation
PageHeader
```

---

# 20. Feature Components

Business-specific UI should generally live with its feature/domain rather than becoming an unstructured global component collection.

---

# 21. Features

`features/` contains business-capability modules.

Conceptually:

```text
features/
├── auth/
├── branches/
├── website/
├── cms/
├── localization/
├── services/
├── pricing/
├── booking/
├── availability/
├── workforce/
├── jobs/
├── payments/
├── finance/
├── notifications/
├── quality/
├── reporting/
├── audit/
└── administration/
```

> **Implemented (Change 8, `create-admin-foundation`):** `features/admin/`
> hosts the Admin Foundation capability — `auth.ts` (one-time bootstrap,
> invitation, deactivation), `context.ts`/`contextShared.ts` (server-resolved
> admin/branch context + client-safe echo format), `authActions.ts`
> (sign-out server action). The `administration/` name in the conceptual
> tree above maps to `features/admin/`; no new permissions, roles, or auth
> systems were introduced.

---

# 22. Feature Boundary

Each feature should contain only the code required for that capability.

Example:

```text
features/pricing/
├── components/
├── schemas/
├── services/
├── queries/
├── actions/
├── types/
└── tests/
```

The exact structure may vary by feature complexity.

---

# 23. Domain Logic

Domain services should contain business rules.

Examples:

```text
calculatePrice()
createBooking()
checkAvailability()
assignJob()
publishPage()
createBranch()
```

---

# 24. Domain Services

Domain services should be callable from:

```text
Server Actions
API Routes
Background Jobs
Admin Workflows
```

without duplicating business logic.

---

# 25. Validation

Feature-specific Zod schemas should live close to their domain.

Example:

```text
features/booking/schemas/
features/pricing/schemas/
features/branches/schemas/
```

---

# 26. Queries

Read operations should be separated from mutations where useful.

Example:

```text
queries/
services/
actions/
```

This is organizational, not a requirement to create unnecessary abstraction.

---

# 27. Database Access

Database access should be centralized through a controlled data-access layer.

Avoid scattering raw database calls throughout React components.

---

# 28. Supabase Clients

The project should distinguish appropriate Supabase clients.

Conceptually:

```text
Browser Client
Server Client
Privileged Server Client
```

The privileged client must never reach the browser.

---

# 29. Database Types

Generated or maintained database types should live in a clearly defined location.

Example:

```text
types/database.ts
```

or an equivalent generated location.

The exact generated strategy may evolve.

---

# 30. Shared Library

`lib/` contains infrastructure and cross-cutting utilities.

Examples:

```text
lib/
├── supabase/
├── auth/
├── authorization/
├── validation/
├── logging/
├── errors/
├── dates/
├── currency/
├── email/
├── storage/
├── ids/
└── utilities/
```

---

# 31. Business vs Infrastructure

A useful distinction:

```text
features/
→ business capabilities

lib/
→ reusable infrastructure/cross-cutting concerns
```

---

# 32. Authorization Library

Authorization helpers should be centralized.

Example conceptual APIs:

```text
requirePermission()
requireBranchAccess()
requireOrganizationAccess()
```

They must not replace RLS.

---

# 33. Authentication Library

Authentication utilities may provide:

```text
currentUser()
currentMembership()
currentSession()
```

Actual implementation follows Supabase architecture.

> **Implemented (Change 8, `create-admin-foundation`):** `lib/session/server.ts`
> remains the single session accessor; `middleware.ts` (repo root) refreshes
> Supabase session cookies and redirects unauthenticated `/admin/*` requests
> to `/login?next=<safe-path>` — UX-level protection only, with the admin
> layout guard, server actions, and RLS remaining the security boundary
> (SECURITY.md §14 record).

---

# 34. Error Handling

Centralized application error types should provide predictable handling.

Examples:

```text
ValidationError
AuthorizationError
NotFoundError
ConflictError
ProviderError
```

---

# 35. Date and Time Utilities

All business-critical date/time handling should use shared utilities.

Do not duplicate timezone logic throughout the application.

---

# 36. Currency Utilities

Money calculations should use appropriate decimal-safe representations.

Avoid floating-point arithmetic for authoritative monetary calculations.

---

# 37. IDs

Identifiers should use the database's canonical UUID strategy.

Do not generate arbitrary incompatible IDs in frontend code.

---

# 38. Configuration

`config/` contains application configuration that is not business data.

Examples:

```text
navigation configuration
feature defaults
environment configuration
application constants
```

Business configuration belongs in the database.

---

# 39. Environment Configuration

Environment parsing should validate required environment variables.

Zod may be used for environment validation.

---

# 40. Public Assets

`public/` contains static assets that are intentionally bundled with the application.

Do not store customer-uploaded operational media here.

---

# 41. Dynamic Media

Customer, branch, CMS, and operational media should use Supabase Storage according to the storage architecture.

---

# 42. Supabase Directory

`supabase/` contains database-related project artifacts.

Conceptually:

```text
supabase/
├── migrations/
├── seed/
├── functions/
└── config/
```

Only applicable directories need to exist.

---

# 43. Migrations

All database schema changes belong in:

```text
supabase/migrations/
```

Migrations are version-controlled.

---

# 44. Seed Data

Safe development/platform defaults may live in seed scripts.

Production business data must not be treated as seed data.

---

# 45. Database Functions

PostgreSQL functions/RPCs belong under the database source structure and must be version-controlled.

---

# 46. RLS Policies

RLS policies must be created and changed through migrations.

They must not exist only as undocumented dashboard configuration.

---

# 47. Tests

`tests/` contains cross-feature and integration/E2E tests.

Example:

```text
tests/
├── unit/
├── integration/
├── e2e/
├── security/
├── fixtures/
└── helpers/
```

Feature-local tests may also live inside `features/*/tests`.

---

# 48. Unit Tests

Unit tests should verify deterministic business logic.

Examples:

```text
pricing
discounts
date calculations
permissions
validation
```

---

# 49. Integration Tests

Integration tests verify interactions between:

```text
domain logic
database
RLS
external adapters
```

---

# 50. Security Tests

Security tests should specifically cover:

```text
RLS
authorization
branch isolation
customer isolation
magic links
storage
webhooks
rate limiting
```

---

# 51. E2E Tests

E2E tests should protect critical workflows:

```text
customer booking
customer management
HQ branch provisioning
branch operations
cleaner job completion
payment
```

---

# 52. Fixtures

Test fixtures should be reusable and deterministic.

Examples:

```text
organization
branch
HQ admin
branch manager
cleaner
customer
service
booking
employee
```

---

# 53. Documentation

`docs/` is the project source of truth for architecture and business rules.

Current documents include:

```text
README.md
docs/PROJECT_RULES.md
docs/VISION.md
docs/REQUIREMENTS.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/DESIGN_SYSTEM.md
docs/CONTENT_SYSTEM.md
docs/ADMIN_SYSTEM.md
docs/LOCALIZATION.md
docs/SECURITY.md
docs/SECURITY_PRIVACY.md
docs/BOOKING_SYSTEM.md
docs/PRICING_ENGINE.md
docs/SCHEDULING_SYSTEM.md
docs/WORKER_SYSTEM.md
docs/PAYMENT_SYSTEM.md
docs/NOTIFICATION_SYSTEM.md
docs/QUALITY_SYSTEM.md
docs/BRANCH_SYSTEM.md
docs/REPORTING_SYSTEM.md
docs/AUDIT_SYSTEM.md
docs/TESTING_STRATEGY.md
docs/DEPLOYMENT.md
docs/PROJECT_STRUCTURE.md
```

---

# 54. Documentation Rule

If implementation changes an architectural or business decision, the appropriate documentation must be updated.

Documentation drift is considered a defect.

---

# 55. OpenSpec

`openspec/` contains specification changes and related artifacts.

Conceptually:

```text
openspec/
├── changes/
├── specs/
└── archive/
```

The exact OpenSpec conventions should follow the project's configured workflow.

---

# 56. OpenSpec Changes

A change should define:

```text
problem
requirements
behavior
acceptance criteria
implementation impact
verification
```

where appropriate.

---

# 57. OpenSpec and Source Code

The coding agent must implement against the approved OpenSpec change.

It must not invent architecture that contradicts the source-of-truth documents.

---

# 58. Scripts

`scripts/` contains controlled development and operational scripts.

Examples:

```text
database verification
seed helpers
type generation
environment checks
test utilities
```

---

# 59. Production Scripts

Scripts capable of modifying production data require explicit safeguards.

Avoid destructive scripts without confirmation and appropriate authorization.

---

# 60. GitHub Configuration

`.github/` contains:

```text
workflows
issue templates
pull request templates
repository automation
```

where applicable.

---

# 61. CI Workflow

The GitHub workflow should verify:

```text
install
lint
typecheck
tests
build
```

and additional checks as required.

---

# 62. Feature Folder Standard

A feature may use:

```text
features/<feature>/
├── components/
├── schemas/
├── services/
├── queries/
├── actions/
├── types/
└── tests/
```

Only create directories that are actually needed.

---

# 63. Avoid Empty Abstractions

Do not create:

```text
service
repository
factory
adapter
```

layers solely because a pattern exists.

Introduce an abstraction when it provides real separation, reuse, testing value, or provider independence.

---

# 64. Business Domain Boundaries

The following domains should remain conceptually separate:

```text
Identity
Organization
Branches
Website/CMS
Localization
Services
Pricing
Booking
Availability
Workforce
Jobs
Payments/Finance
Notifications
Quality
Reporting
Audit
```

---

# 65. Domain Dependency Direction

Prefer:

```text
UI
 ↓
Feature/Application Layer
 ↓
Domain Logic
 ↓
Infrastructure
 ↓
Database / External Provider
```

Avoid infrastructure-specific logic leaking upward into UI components.

---

# 66. Cross-Domain Calls

Cross-domain interactions should occur through explicit interfaces/services/events.

Avoid direct manipulation of another domain's internal implementation.

---

# 67. Example: Booking

Booking may depend on:

```text
Customer
Branch
Service
Availability
Pricing
```

But it should not directly implement their internal rules.

---

# 68. Example: Payment

Payment depends on:

```text
Booking
Finance
Provider Adapter
```

The payment provider does not own booking state.

---

# 69. Example: Notification

Notification reacts to business events.

It should not become responsible for changing booking state.

---

# 70. Example: Reporting

Reporting reads domain data.

It should not modify booking, payment, employee, or pricing state.

---

# 71. Example: Audit

Audit records important actions.

It should not become the business source of truth.

---

# 72. Frontend Feature Architecture

A feature UI should generally follow:

```text
Route
 ↓
Feature Component
 ↓
Server Action / Query
 ↓
Domain Service
 ↓
Database
```

---

# 73. Client Components

Use client components only when browser interactivity requires them.

Prefer server components for data-heavy/server-authoritative screens where appropriate.

---

# 74. Server Components

Server components should not expose secrets.

They may safely access authorized server-side services.

---

# 75. Client State

Client state should contain UI state where possible.

Do not treat client state as authoritative business state.

---

# 76. Server State

Authoritative business state comes from server/database systems.

Examples:

```text
price
availability
booking status
payment status
employee assignment
```

---

# 77. Forms

Forms should generally use:

```text
React Hook Form
+
Zod
+
server validation
```

---

# 78. UI Validation

Client validation improves user experience.

Server validation remains mandatory.

---

# 79. Loading States

Every significant route/action should have appropriate loading behavior.

Examples:

```text
loading.tsx
skeleton
button pending state
```

---

# 80. Error States

Important routes should have clear error handling.

Do not expose technical internals.

---

# 81. Empty States

Operational dashboards should distinguish:

```text
no records
```

from:

```text
loading
```

or:

```text
error
```

---

# 82. Responsive Architecture

Shared components should support responsive layouts.

Cleaner workflows receive additional mobile optimization.

---

# 83. Design System Integration

UI components must follow `DESIGN_SYSTEM.md`.

The repository should avoid one-off visual systems.

---

# 84. Sora and Plus Jakarta Sans

The application should use:

```text
Sora
→ headings/display

Plus Jakarta Sans
→ body/UI
```

according to the design system.

---

# 85. Brand Tokens

CLENQO brand tokens remain centralized.

Core colors:

```text
Green
#07742F

Fresh Lemon
#F2E543

Clean Mist
#F3F8EE

Charcoal
#18211C
```

---

# 86. Animation

GSAP should be used selectively.

Animation must not become embedded business logic.

---

# 87. Accessibility

Shared components should provide accessible defaults.

Feature developers must preserve those behaviors.

---

# 88. SEO

Public website SEO functionality should be centralized where practical.

Branch-specific SEO values come from branch/content configuration.

---

# 89. Localization

Translation resources and localization utilities should be separated from business content.

---

# 90. UI Translation Files

UI translation resources may be stored in a version-controlled location such as:

```text
locales/
```

or the project's selected i18n structure.

---

# 91. CMS Content

Public content translations remain database-backed according to `LOCALIZATION.md` and `CONTENT_SYSTEM.md`.

---

# 92. No Hardcoded Branch Data

Never place production branch information directly into:

```text
React components
routes
configuration constants
seed assumptions
```

unless explicitly defined as platform defaults.

---

# 93. No Hardcoded Business Prices

Prices belong to the Pricing Engine/database.

Do not hardcode:

```text
€30
€35
€40
```

into UI components as authoritative values.

---

# 94. No Hardcoded Availability

Availability comes from the availability/scheduling domain.

---

# 95. No Hardcoded Permissions

Permissions should use centralized authorization definitions.

---

# 96. No Direct Client Database Authority

The browser must not be treated as an authoritative source for:

```text
pricing
booking state
payment state
availability
permissions
```

---

# 97. Background Processing

Future background jobs should live in a clearly defined server-side processing area.

Potential structure:

```text
jobs/
├── notifications/
├── provisioning/
├── recurring/
├── reporting/
└── maintenance/
```

The exact implementation depends on the selected execution mechanism.

---

# 98. Provider Adapters

External providers should be isolated.

Examples:

```text
providers/
├── payments/
├── email/
├── storage/
└── future/
```

The exact location may instead live within individual features.

---

# 99. Email Provider

Amazon SES should be accessed through an application email abstraction rather than scattered SDK calls.

---

# 100. Payment Providers

Payment provider implementations should not be embedded directly into booking UI.

---

# 101. Maps

Future map providers should use an adapter where multiple providers may eventually be supported.

---

# 102. Third-Party SDKs

Third-party SDK initialization should be centralized.

Avoid creating provider clients repeatedly throughout unrelated modules.

---

# 103. Dependency Rules

A module should depend only on what it needs.

Avoid circular dependencies between domains.

---

# 104. Circular Dependency Prevention

If:

```text
Booking → Pricing
Pricing → Booking
```

appears necessary, reconsider the boundary.

Use shared concepts, domain interfaces, or event-driven coordination where appropriate.

---

# 105. Shared Types

Shared types should represent genuinely shared concepts.

Do not create a giant global `types.ts` containing every domain type.

---

# 106. Naming

Names should reflect business meaning.

Prefer:

```text
calculateBookingPrice()
```

over:

```text
processData()
```

---

# 107. File Size

Large files should be split when responsibilities become difficult to understand.

Do not split purely to create more files.

---

# 108. Component Size

Components should remain focused.

A component that handles:

```text
pricing
booking
payment
notification
```

should be decomposed.

---

# 109. Utility Discipline

Shared utilities should remain small and well-defined.

Avoid a giant:

```text
utils.ts
```

containing unrelated functionality.

---

# 110. Configuration vs Code

Use code for:

```text
business algorithms
UI behavior
validation
domain rules
```

Use database configuration for:

```text
branch data
service availability
pricing configuration
website content
operating hours
localization content
```

---

# 111. Feature Flags

Feature flags should be centralized and typed.

They must not be scattered as arbitrary environment checks throughout the codebase.

---

# 112. Environment Checks

Environment-specific behavior should be isolated.

Avoid:

```text
if production
```

throughout business logic unless genuinely necessary.

---

# 113. Logging

Logging utilities should be centralized.

Sensitive information must be filtered.

---

# 114. Audit

Audit calls should use the shared audit service.

Do not invent separate audit formats inside each feature.

---

# 115. Testing Boundaries

Each feature should test its critical business behavior.

Cross-feature behavior belongs in integration/E2E tests.

---

# 116. Import Rules

Where practical, establish consistent import aliases.

Example:

```text
@/features/...
@/components/...
@/lib/...
@/types/...
```

---

# 117. Path Alias

The project should use one documented TypeScript path-alias strategy.

---

# 118. Absolute vs Relative Imports

Prefer the project's alias strategy for cross-module imports.

Use relative imports for tightly local files where readability is improved.

---

# 119. Generated Code

Generated files must be clearly identified.

Do not manually edit generated output unless explicitly required.

---

# 120. Database Type Generation

If database types are generated, regeneration must be documented and reproducible.

---

# 121. Code Generation

Future generators should produce deterministic output.

Generated code should not become an undocumented source of truth.

---

# 122. Documentation-Code Alignment

When a structural decision changes:

```text
PROJECT_STRUCTURE.md
ARCHITECTURE.md
```

and other affected documents should be updated.

---

# 123. Refactoring Rule

Refactoring must preserve domain boundaries.

A refactor that reduces file count but merges unrelated responsibilities is not considered an improvement.

---

# 124. Repository Growth

As CLENQO grows:

```text
small feature
 ↓
feature module
 ↓
domain module
 ↓
shared infrastructure
```

The structure should evolve based on actual complexity.

---

# 125. Avoid Premature Monorepo Complexity

The initial CLENQO application does not require a multi-package monorepo.

A single application repository is preferred unless actual requirements justify splitting packages.

---

# 126. Future Extraction

If a domain eventually requires independent deployment or reuse, it may be extracted later.

The current architecture should not optimize prematurely for that possibility.

---

# 127. Deployment Compatibility

The project structure must remain compatible with Vercel deployment.

Server-only code must not accidentally become client code.

---

# 128. Security Boundaries

Sensitive modules should have clear server-only boundaries.

Examples:

```text
payment secrets
SES credentials
service-role Supabase client
privileged operations
```

---

# 129. Server-Only Imports

Where supported, server-only modules should explicitly enforce server-only usage.

---

# 130. Client Bundle Protection

Never import modules containing secrets or privileged SDK clients into client components.

---

# 131. Database Access from Client

Client-side database access should only occur where explicitly designed and protected by RLS.

For sensitive business operations, prefer server-side domain services.

---

# 132. Business Number Generation

Booking/invoice numbers should be generated according to their domain rules.

Do not generate authoritative business numbers in React.

---

# 133. Public Route Security

Public routes may expose only intended public content.

Draft CMS data, internal notes, employee information, and private configuration must remain server-protected.

---

# 134. Admin Route Security

Admin routes require authentication and authorization.

Route protection is not sufficient without server-side checks inside the underlying operations.

---

# 135. Cleaner Route Security

Cleaner routes require:

```text
authenticated user
cleaner role
appropriate job/branch scope
```

---

# 136. Customer Route Security

Customer management routes require valid, appropriately scoped magic-link access.

---

# 137. Route Middleware

Middleware may help with:

* routing
* session handling
* broad access protection

but must not be treated as the only authorization mechanism.

---

# 138. Domain-Level Security

Every sensitive domain operation remains authorized at the server/domain layer.

---

# 139. Database-Level Security

RLS remains the final database protection boundary for applicable data.

---

# 140. Application Startup

Application startup should validate required configuration and fail clearly when critical configuration is missing.

---

# 141. Health Endpoints

Health endpoints must not expose secrets or detailed infrastructure internals.

---

# 142. Repository Cleanliness

Do not commit:

```text
build output
temporary files
logs
secrets
local databases
editor artifacts
```

unless explicitly required.

---

# 143. README

The root `README.md` should provide:

* project overview
* stack
* setup
* commands
* environment configuration
* development workflow
* testing
* documentation map

---

# 144. Developer Setup

A new developer should be able to understand:

```text
install
configure
run
test
build
```

from the repository documentation.

---

# 145. Command Consistency

Common commands should be documented consistently.

Examples:

```text
dev
build
lint
typecheck
test
test:e2e
```

Actual scripts should match `package.json`.

---

# 146. OpenSpec Development

Development should follow:

```text
Read Docs
 ↓
Define Change
 ↓
OpenSpec
 ↓
Implement
 ↓
Test
 ↓
Review
 ↓
Archive
```

---

# 147. Agent Rules

AI coding agents must:

* read relevant docs
* read relevant OpenSpec change
* preserve architecture
* avoid inventing dependencies
* avoid changing unrelated files
* run required tests
* report failures honestly
* update documentation when required

---

# 148. Agent Boundaries

An AI coding agent must not:

```text
invent branch architecture
invent payment rules
invent pricing behavior
bypass authorization
disable RLS
hardcode production data
remove tests to make CI pass
```

---

# 149. Change Scope

An implementation should modify only the files required by the approved change unless additional changes are justified.

---

# 150. Verification

Every implementation should report:

```text
files changed
tests run
build result
migration result
known limitations
```

---

# 151. Repository Health

The repository should remain:

```text
buildable
testable
documented
lint-clean
type-safe
```

---

# 152. MVP Structure

The initial implementation should prioritize:

```text
app/
components/
features/
lib/
types/
config/
supabase/
tests/
docs/
openspec/
scripts/
.github/
```

without creating unnecessary abstractions.

---

# 153. Future Structure

The repository may later evolve to include:

```text
workers/
packages/
analytics/
infrastructure/
```

only when justified by actual platform requirements.

---

# 154. Structural Golden Rules

The following rules are mandatory:

1. One centralized CLENQO application.
2. No branch-specific codebases.
3. Business logic belongs to domain/feature modules.
4. UI routes remain thin.
5. Server-side authorization is mandatory.
6. RLS protects database boundaries.
7. Pricing remains server-authoritative.
8. Booking remains server-authoritative.
9. External providers are isolated behind adapters where useful.
10. Database migrations are version-controlled.
11. Tests protect critical business rules.
12. Documentation remains synchronized with implementation.
13. OpenSpec changes define significant work before implementation.
14. Secrets never enter client bundles.
15. Avoid premature abstraction and infrastructure.

---

# 155. Final Architecture

The intended application structure is:

```text
                         CLENQO
                           │
          ┌────────────────┼────────────────┐
          │                │                │
        Public           Admin           Cleaner
        Website         Dashboard           PWA
          │                │                │
          └────────────────┼────────────────┘
                           ↓
                    Feature Modules
                           ↓
                     Domain Services
                           ↓
                ┌──────────┴──────────┐
                ↓                     ↓
           PostgreSQL            Providers
                │
               RLS
                │
        Centralized Data
                │
        ┌───────┼────────┐
        ↓       ↓        ↓
     Branch A Branch B Branch N
```

---

# 156. Golden Project Structure Rule

> **CLENQO's codebase must mirror the business architecture: one centralized application, clearly separated domain capabilities, thin routes, reusable UI, server-authoritative business logic, secure database boundaries, version-controlled infrastructure, and tests that protect critical behavior. Branches are data and configuration—not source-code copies.**
