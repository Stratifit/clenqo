# Change 10 — create-config-admin-ui (proposal)

> **Capability:** `admin-config` · **Status:** Draft — awaiting owner approval before BUILD MODE implementation.

## Change ID

`create-config-admin-ui` — one combined Change 10 (BD-E3a).

## Problem

The CLENQO configuration backend is complete and verified — service catalog
(migration `0008_service_catalog.sql`), scheduling/availability
(`0009_scheduling_availability.sql`), and pricing engine
(`0010_pricing_engine.sql`) all expose full server-side action contracts —
but **no product surface can operate them**. A staff member cannot create a
service, publish a pricing version, or set operating hours through the
product; every configuration change requires direct script/API access. The
Change 8 activation-readiness model (BD-A4) mandates an active service and a
published pricing version before a branch can activate — requirements that
cannot currently be met through the product at all.

## Existing Backend Dependencies (all shipped; none new)

| Dependency | State |
|---|---|
| Change 1 branch-management (branches, provisioning, activation) | shipped, verified |
| Change 2 service-catalog backend contracts (`features/services/*`) | shipped, verified |
| Change 3 scheduling-availability backend contracts (`features/scheduling/*`) | shipped, verified |
| Change 4A pricing-engine backend contracts (`features/pricing/*`) | shipped, verified |
| Change 8 admin-foundation (shell, context, middleware, permission-aware nav) | shipped, verified |
| Change 9 admin-bookings (consumer-surface pattern, `pageContext.ts` guard) | shipped, verified |
| New backend contracts / migrations / permissions / RLS | **none required** |

All mutations ride existing server actions; the UI adds no authorization and
computes no authoritative value.

## Service Catalog Admin UI scope (`/admin/services`)

Branch-scoped catalog management over the `EffectiveCatalog` read model:

- **Hierarchy:** category → service → variant → addon (category, service,
  variant, addon CRUD via the existing `createCategoryAction`,
  `updateCategoryAction`, `createServiceAction`, `updateServiceAction`,
  `createVariantAction`, `updateVariantAction`, `createAddonAction`,
  `updateAddonAction`).
- **Lifecycle:** `changeStatusAction` (draft → active → archived).
- **Offering toggle:** `setOfferingStateAction` (`is_enabled`, separate from
  lifecycle status).
- **Ordering:** `reorderCatalogAction`.
- **Addon compatibility:** `setAddonCompatibilityAction`,
  `removeAddonCompatibilityAction`.
- **Orphan inspection:** `findOrphanedAddonsAction`.
- **Published slug rename:** `renamePublishedSlugAction` where the existing
  contract allows (domain-gated).

## Pricing Admin UI scope (`/admin/pricing`)

- **Profiles:** `listPricingProfilesAction`, `createPricingProfileAction`,
  `updatePricingProfileAction`.
- **Versions:** `listPricingVersionsAction`, `createPricingVersionAction`;
  effective-date inputs validated by the existing schemas.
- **Draft rules:** `listPricingRulesAction`, `createPricingRuleAction` —
  draft-only editing; published/archived versions are immutable (domain
  rule); per-`rule_type` discriminated forms from the existing Zod schemas.
- **Publish / archive:** `publishPricingVersionAction` (existing server-side
  §47 validation), `archivePricingVersionAction`.
- **Quote sanity display:** `calculateQuoteAction` — display only; the UI
  never calculates authoritative prices.

## Scheduling Admin UI scope (`/admin/scheduling`)

- **Configuration:** `getSchedulingConfigAction`,
  `updateSchedulingConfigAction`.
- **Operating hours:** `listOperatingHoursAction`,
  `upsertOperatingHoursAction`, `closeOperatingHoursAction`.
- **Exceptions:** `listScheduleExceptionsAction`,
  `createScheduleExceptionAction`, `deleteScheduleExceptionAction`.
- **Service scheduling rules:** `upsertServiceSchedulingRuleAction`.
- **Authorization:** reads are branch-access-gated; **mutations require
  `branches.edit` (held only by `hq_admin`) — the scheduling mutation UI is
  HQ-Admin-only in V1 (BD-E3b).**

## Binding Owner Decisions (BD-E3, resolved 2026-09)

- **BD-E3a — Packaging:** ONE combined Change 10 (`create-config-admin-ui`)
  with one capability package (`admin-config`) covering Service Catalog +
  Pricing + Scheduling admin UI. Not three sequential changes.
- **BD-E3b — Scheduling authorization:** the existing authorization model is
  KEPT. Scheduling mutations require `branches.edit` (canonical catalog
  grants it only to `hq_admin`). NO new permission, NO
  `lib/permissions.ts` modification, NO RLS modification, NO grant of
  `branches.edit` to `branch_manager`, NO backend authorization change.
  Branch Managers may view/use whatever existing read contracts permit but
  cannot perform scheduling mutations through this UI. The existing
  documentation/role mismatch (SCHEDULING_SYSTEM describing branch-owned
  hours vs HQ-only `branches.edit`) is recorded as a **deferred
  architectural consideration**, not changed now.
- **BD-E3d — Translations:** catalog translation editing is DEFERRED.
  `upsertTranslationAction` is NOT exposed. Existing localized/catalog data
  may be displayed where already supported by existing read contracts
  (`listEffectiveCatalogAction` locale fallback), but no translation
  workflow is introduced — it belongs to the future CMS/localization
  capability.
- **BD-E3e — Seed tools:** `seedCatalogAction` and
  `seedPricingDefaultsAction` remain scripts/hosted/developer operations.
  No UI buttons for structural seeding.

## Affected Existing Capabilities

- `admin-foundation`: navigation gains three permission-aware entries
  (shell extension only; no semantic change; `lib/permissions.ts` untouched).
- `service-catalog`, `pricing-engine`, `scheduling-availability`: consumed
  as-is; their live specs are NOT modified — the new `admin-config` delta
  describes only the consumption surface.
- `admin-bookings`: untouched (pattern reuse only).

## Explicit Non-Goals

New permissions · permission-catalog changes · RLS changes · migrations
(none required; if implementation proves one genuinely is, STOP and report
rather than silently expanding scope) · production catalog values ·
production pricing values · production hours · translation editor (BD-E3d) ·
seed-tool UI (BD-E3e) · CMS · public website · customer booking UI ·
notifications/email · payments · Worker/Cleaner changes · booking lifecycle
changes · customer deduplication · new pricing/business rules · client-side
authoritative pricing calculations · multi-organization support ·
slug-scoped `/<branch-slug>/admin` routes.

## Security Considerations

Three-layer defense preserved: middleware/admin shell → server-side
authorization (each domain service performs `requirePermission` +
`requireOrganizationAccess` + `hasBranchScope`) → PostgreSQL RLS. Pages
revalidate the Change 8 branch context server-side on every request
(`requireAdminPageContext`); branch-scoped configuration pages require a
concrete branch (no All-Branches aggregation — BD-B1 interplay). Permission
gates: `services.view`/`services.edit` (catalog), `pricing.view` +
`pricing.create/edit/publish/archive` (pricing, per canonical P20 mapping),
`branches.edit` (scheduling mutations). The UI can never widen a grant.
No secrets; tests use non-production fixtures only (P3).

## Testing / Verification Strategy

- New Change 10 domain test suite: branch-context isolation, permission
  matrix (hq_staff / branch_manager / hq_admin; cleaner and outsider
  denials), scheduling HQ-only mutation boundary (BD-E3b), read-only
  rendering without mutation permissions, RLS no-new-policy regression.
- Existing domain + hosted suites must remain green (no backend changes).
- Typecheck, lint, build, `git diff --check`.
- No migration apply; hosted verification = full Changes 1–10 hosted
  regression (+ dedicated Change 10 hosted suite if the reviewer requires
  it — no schema objects exist to verify).

## Documentation Impact

`ADMIN_SYSTEM.md` (module records), `PROJECT_STRUCTURE.md` (routes now
implemented), `ROADMAP.md` (§9/§10/§11 implementation records),
`SERVICE_CATALOG.md`, `PRICING_ENGINE.md`, `SCHEDULING_SYSTEM.md`
(admin-surface notes + BD-E3b deferred-consideration record),
`DOCUMENTATION_AUDIT.md` (BD-E3 decision record + implementation record).
No BD-A/BD-B/BD-W decision is rewritten.

## Acceptance Criteria

1. All three surfaces are reachable via permission-aware navigation and
   render branch-scoped data exclusively through existing read contracts.
2. A permitted staff member can complete the full configuration lifecycle
   in-product: category/service/variant/addon → activate → enable → order →
   compatibility; pricing profile → draft version → rules → publish;
   scheduling config/hours/exceptions/service-rules (HQ-Admin) — with no
   direct database access.
3. Every mutation invokes an existing server action; the UI computes no
   authoritative value (price, duration, availability, feasibility).
4. Branch Managers operate catalog and pricing within their
   `membership_branches`; every scheduling mutation is refused for them
   server-side (BD-E3b), and the UI renders scheduling read-only.
5. No `upsertTranslationAction`, `seedCatalogAction`, or
   `seedPricingDefaultsAction` call exists in the Change 10 UI (BD-E3d/e).
6. No migration, no permission change, no RLS change; local + hosted suites
   green; `git diff --check` clean.
