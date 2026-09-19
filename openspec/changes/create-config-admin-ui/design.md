# Change 10 — create-config-admin-ui (design)

Normative design for the combined configuration-admin surface. Business
logic remains in the existing server-side domain services; UI components are
consumers only.

## 1. BD-E3 decisions (binding)

- **BD-E3a — Packaging:** ONE combined Change 10, capability `admin-config`,
  covering the Service Catalog, Pricing, and Scheduling admin UIs.
- **BD-E3b — Scheduling authorization:** existing model KEPT. Scheduling
  mutations require `branches.edit`; the canonical permission catalog grants
  it only to `hq_admin`. No new permission, no `lib/permissions.ts`
  modification, no RLS modification, no grant to `branch_manager`, no
  backend authorization change. Scheduling mutation UI = HQ-Admin-only in
  V1. The SCHEDULING_SYSTEM documentation/role mismatch (branch-owned hours
  vs HQ-only `branches.edit`) is recorded as a **deferred architectural
  consideration** — not reopened unless a concrete existing contract makes
  implementation impossible.
- **BD-E3d — Translations:** `upsertTranslationAction` is NOT exposed.
  Localized display through existing read contracts is permitted.
- **BD-E3e — Seed tools:** `seedCatalogAction` and
  `seedPricingDefaultsAction` are NOT exposed; they remain
  script/hosted/developer operations.

## 2. Route architecture

```text
app/(admin)/admin/services/page.tsx              # catalog tree (branch context)
app/(admin)/admin/pricing/page.tsx               # profiles + versions
app/(admin)/admin/pricing/[profileId]/page.tsx   # version drill-down (rules, publish, quote sanity)
app/(admin)/admin/scheduling/page.tsx            # config + hours + exceptions + service rules
```

Existing URLs `/admin/branches`, `/admin/employees`, `/admin/jobs`,
`/admin/bookings`, `/admin/customers` are untouched. Client islands live
beside their pages (`*Actions.tsx` / `*Editor.tsx`), following the Change 9
`BookingActions.tsx` / `CustomerEditForm.tsx` pattern.

Navigation: three new permission-aware entries in `app/(admin)/admin/layout.tsx` —
Services (`services.view`), Pricing (`pricing.view`), Scheduling
(`branches.view` for the read surface; the page itself gates mutations on
`branches.edit`).

## 3. Branch-context architecture

Reuse `app/(admin)/admin/pageContext.ts` exactly:

- `requireAdminPageContext(permission)` — actor + server-resolved
  `resolveAdminContext` from the `?branch=` + cookie echo, revalidated
  against `membership_branches` on every request.
- `requireBookingPageContext(permission)` — the branch-scoped variant; **all
  three configuration surfaces require a concrete branch context** (they are
  branch-scoped domains). Under the org-wide "All Branches" context the
  caller is redirected back with a selection prompt — **no All-Branches
  aggregation** for branch configuration.

## 4. Service Catalog UI architecture

- **Read model:** `listEffectiveCatalogAction(branchId, { locale? })` →
  `EffectiveCatalog { categories, services: (CatalogRow & { variants,
  addons })[], standaloneAddons }`. The page renders the hierarchy
  category → service → variant → addon plus a standalone-addons section.
  Localized `display_name`/`display_description` may be rendered per the
  contract's existing fallback (BD-E3d display-only).
- **Entity forms:** draft-field create/edit for all four types via the
  existing `create*Action` / `update*Action` pairs; input shapes come from
  the existing Zod schemas in `features/services/schemas/catalog.ts`
  (`createCategorySchema`, `createServiceSchema`, `createVariantSchema`,
  `createAddonSchema`, `update*Schema`). The UI performs no validation
  beyond native input attributes; the server schema is authoritative.
- **Lifecycle:** `changeStatusAction` (draft → active → archived) exposed as
  a status control with confirmation on archive.
- **Offering state:** `setOfferingStateAction` (`is_enabled`) is rendered as
  a separate toggle — enabled/offering is NOT lifecycle status.
- **Ordering:** `reorderCatalogAction` (order controls within a parent).
- **Compatibility:** per-addon target selectors via
  `setAddonCompatibilityAction` / `removeAddonCompatibilityAction`.
- **Orphans:** `findOrphanedAddonsAction` rendered as an inspection panel
  (read-only listing).
- **Slug rename:** `renamePublishedSlugAction` for published services /
  variants / addons — domain-gated; the UI renders the domain's
  outcome/error verbatim.

## 5. Pricing UI architecture

- **Drill-down:** profile list (`listPricingProfilesAction`) → version list
  (`listPricingVersionsAction`) → rule editor for the selected version.
- **Profile forms:** `createPricingProfileAction` /
  `updatePricingProfileAction` (name, currency — existing schema fields).
- **Versions:** `createPricingVersionAction` with effective-date inputs
  (validated by the existing schemas). **Draft-only editing:** rules may be
  created only while the version is `draft` (`listPricingRulesAction` +
  `createPricingRuleAction`); **published/archived versions are immutable**
  — the UI renders them read-only and the domain refuses mutations.
- **Publish / archive:** `publishPricingVersionAction` runs the existing
  §47 server-side validation (no empty versions; one published per window);
  `archivePricingVersionAction` is content-identical and DB-guarded. The UI
  surfaces the server's validation errors verbatim and never pre-validates
  on the client.
- **Rules:** per-`rule_type` discriminated forms driven by the existing Zod
  payloads in `features/pricing/schemas/pricing.ts`
  (`baseRateRuleConfigSchema`, `durationRuleConfigSchema`,
  `difficultyRuleConfigSchema`, `surchargeRuleConfigSchema`,
  `addonPriceRuleConfigSchema`). Monetary inputs are minor-unit integers;
  display formatting only.
- **Quote sanity:** a read-only panel invoking
  `calculateQuoteAction` with a chosen service/date — **display only; the
  UI never calculates authoritative prices** (TD-2 remains server-side).

## 6. Scheduling UI architecture

- **Sections on one page:** configuration, operating hours, exceptions,
  per-service scheduling rules.
- **Reads:** `getSchedulingConfigAction`, `listOperatingHoursAction`,
  `listScheduleExceptionsAction` — branch-access-gated
  (`requireBranchAccess`), so any authorized branch member may view.
- **Mutations:** `updateSchedulingConfigAction`,
  `upsertOperatingHoursAction`, `closeOperatingHoursAction`,
  `createScheduleExceptionAction`, `deleteScheduleExceptionAction`,
  `upsertServiceSchedulingRuleAction` — **all require `branches.edit`
  (hq_admin only; BD-E3b).** Without that permission the page renders
  read-only and the server refuses every mutation (fail-closed; the UI
  never relies on disabled controls alone).
- **Operating hours:** weekday interval editors over the existing
  `upsertOperatingHoursSchema` shapes; closures via
  `closeOperatingHoursSchema`. Back-dating is refused by the domain
  (hosted-verified behavior) and rendered verbatim.
- **Exceptions:** typed creation per `createScheduleExceptionSchema`;
  deletion via `deleteScheduleExceptionSchema`.
- **Service rules:** `upsertServiceSchedulingRuleSchema` forms scoped to the
  branch's services.
- **Deferred architectural consideration (recorded, not acted on):**
  SCHEDULING_SYSTEM documents branch-owned operating-hours configuration,
  while the contract authorization is HQ-only (`branches.edit`). Aligning
  them would require a canonical permission-catalog amendment — explicitly
  out of scope per BD-E3b; a future change may revisit it.

## 7. Permission matrix (canonical catalog, unchanged)

| Permission | hq_admin | hq_staff | branch_manager | cleaner |
|---|---|---|---|---|
| `services.view` / `services.edit` | ✔ | ✔ | ✔ | ✘ |
| `pricing.view` | ✔ | ✔ (view only, P20) | ✔ | ✘ |
| `pricing.create` / `edit` / `publish` / `archive` | ✔ | ✘ | ✔ (branch-scoped) | ✘ |
| `branches.edit` (all scheduling mutations) | ✔ | ✘ | ✘ | ✘ |
| `branches.view` (scheduling read page) | ✔ | ✔ | ✔ | ✘ |

`lib/permissions.ts` is NOT modified. All enforcement stays inside the
domain services; nav visibility is convenience only.

## 8. Branch isolation

Every page resolves the Change 8 branch context server-side per request;
queries and mutations carry the resolved `branchId`. `hasBranchScope` inside
each domain service constrains branch managers to `membership_branches`.
Cross-branch identifiers submitted through the UI are rejected by the
services (not the UI). No page issues an unscoped query; no All-Branches
aggregation view exists for configuration.

## 9. UI-consumer rule

The UI implements no business rules: no lifecycle transition logic, no
publish-window logic, no price/duration/availability computation, no
exception-overlap logic. It renders server results and surfaces server
errors verbatim. Any place a rule appears to be needed client-side is a
design error — the contract owns it.

## 10. Idempotency / concurrency behavior

Existing server contracts keep their semantics: catalog mutations are
transactional with domain validation; pricing publish remains guarded
(one published version per profile window; content-identical archive);
operating hours remain effective-dated with back-dating refused. Concurrent
stale-state submissions surface the domain's conflict errors
(`ErrorCode.CONFLICT` / domain error codes) verbatim. No new idempotency
mechanism is introduced (configuration mutations are naturally retried by
re-submission under server validation).

## 11. Localization (display-only)

Catalog pages may render `display_name`/`display_description` provided by
`listEffectiveCatalogAction`'s locale fallback (requested locale → default
locale → operational base text). No translation editing, no
`upsertTranslationAction`, no locale-management UI (BD-E3d). Date/number
formatting follows the existing admin UI conventions; branch timezone
remains the operational context.

## 12. Seed exclusion

`seedCatalogAction` and `seedPricingDefaultsAction` do not appear in any UI
surface, route, or client island (BD-E3e). Structural seeding stays a
script/hosted operation; tests may continue to use the seed mechanisms
directly.

## 13. Explicit exclusions

No migration · no new permission · no `lib/permissions.ts` change · no RLS
change · no backend authorization change · no translation editor (BD-E3d) ·
no seed UI (BD-E3e) · no CMS · no public website · no customer booking UI ·
no notifications/email · no payments · no Worker/Cleaner changes · no
booking lifecycle changes · no customer deduplication · no production
catalog/pricing/hours values · no client-side authoritative pricing · no
multi-org · no slug-scoped admin routes.

## 14. Testing strategy

- **Change 10 domain suite** (`tests/domain/config-admin-ui.test.ts`):
  - permission matrix through the real action chain (hq_staff catalog OK /
    pricing view-only denial; branch_manager catalog+pricing OK within
    scope / scheduling mutation denial; cleaner denial; outsider
    fail-closed);
  - branch-context isolation (BM denied cross-branch catalog read; service
    rules rejected for a foreign branch's service);
  - pricing draft-only enforcement (rule creation on a published version
    refused server-side);
  - scheduling HQ-only boundary (BD-E3b): branch_manager scheduling
    mutation refused, hq_admin succeeds;
  - RLS regression: policy inventory on touched tables unchanged.
- **Existing suites:** all domain + hosted suites remain green (no backend
  changes).
- **Gates:** typecheck, lint, build, `git diff --check`.
- **Hosted:** no migration apply; full Changes 1–10 hosted regression; a
  dedicated Change 10 hosted suite is optional (no new schema objects) —
  include only if review requires it.

## 15. Documentation synchronization

`ADMIN_SYSTEM.md` (three module records), `PROJECT_STRUCTURE.md` (routes
now implemented), `ROADMAP.md` (§9/§10/§11 implementation notes),
`SERVICE_CATALOG.md` / `PRICING_ENGINE.md` / `SCHEDULING_SYSTEM.md`
(admin-surface notes; SCHEDULING §993 area records the BD-E3b deferred
consideration), `DOCUMENTATION_AUDIT.md` (§4 BD-E3 decision record +
implementation record). No resolved decision outside BD-E3 is rewritten.
