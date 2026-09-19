# Change 10 — create-config-admin-ui (tasks)

> All tasks initially unchecked. Ordered groups; each independently checkable.
> No migration task, no permission-change task, no RLS-modification task, no
> translation-editor task, no seed-tool UI task, no payment task, no
> notification-delivery task (BD-E3 binding decisions).

## 1. Routes / nav / context

- [x] 1.1 Create `app/(admin)/admin/services/page.tsx` requiring a concrete
      branch context via `requireBookingPageContext("services.view")`.
- [x] 1.2 Create `app/(admin)/admin/pricing/page.tsx` (profiles list) via
      `requireBookingPageContext("pricing.view")`.
- [x] 1.3 Create `app/(admin)/admin/scheduling/page.tsx` via
      `requireAdminPageContext("branches.view")` with branch-scoped rendering.
- [x] 1.4 Add the three permission-aware navigation entries to
      `app/(admin)/admin/layout.tsx` (Services `services.view`, Pricing
      `pricing.view`, Scheduling `branches.view`); no other shell changes.
- [x] 1.5 Verify All-Branches context behavior: configuration pages redirect
      to branch selection (no aggregation) for branch-scoped surfaces.

## 2. Catalog tree/list

- [x] 2.1 Render the `EffectiveCatalog` hierarchy (category → service →
      variant → addon) plus standalone addons from
      `listEffectiveCatalogAction`.
- [x] 2.2 Render lifecycle status and `is_enabled` as separate visual states
      per row.
- [x] 2.3 Add loading / empty / error states (server error text verbatim).
- [x] 2.4 Render localized display fields where the read contract provides
      them (display-only; no editing UI — BD-E3d).

## 3. Catalog CRUD / lifecycle / ordering

- [x] 3.1 Category create/edit forms over `createCategoryAction` /
      `updateCategoryAction` (existing schema fields only).
- [x] 3.2 Service create/edit forms over `createServiceAction` /
      `updateServiceAction`.
- [x] 3.3 Variant create/edit forms over `createVariantAction` /
      `updateVariantAction`.
- [x] 3.4 Addon create/edit forms over `createAddonAction` /
      `updateAddonAction`.
- [x] 3.5 Lifecycle control via `changeStatusAction` with archive
      confirmation.
- [x] 3.6 Offering toggle via `setOfferingStateAction` (separate from
      lifecycle).
- [x] 3.7 Ordering controls via `reorderCatalogAction` within a parent.

## 4. Compatibility / orphan / slug

- [x] 4.1 Add-on compatibility editor via `setAddonCompatibilityAction` /
      `removeAddonCompatibilityAction`.
- [x] 4.2 Orphaned-addon inspection panel via `findOrphanedAddonsAction`
      (read-only listing).
- [x] 4.3 Published-slug rename via `renamePublishedSlugAction` for
      services/variants/addons, rendering the domain outcome verbatim.

## 5. Pricing profiles / versions

- [x] 5.1 Profile list (`listPricingProfilesAction`) with create/edit forms
      (`createPricingProfileAction` / `updatePricingProfileAction`).
- [x] 5.2 Version drill-down page (`app/(admin)/admin/pricing/[profileId]`)
      listing `listPricingVersionsAction` with status rendering
      (draft/published/archived).
- [x] 5.3 Version creation form (`createPricingVersionAction`) with
      effective-date inputs.

## 6. Pricing rule editor / publish / archive / quote sanity

- [x] 6.1 Draft-only rule editor over `createPricingRuleAction` with
      per-`rule_type` discriminated forms from the existing Zod payload
      schemas (`baseRate`, `duration`, `difficulty`, `surcharge`,
      `addonPrice`).
- [x] 6.2 Rule listing via `listPricingRulesAction`; published/archived
      versions render read-only (domain refuses mutations).
- [x] 6.3 Publish control via `publishPricingVersionAction` surfacing §47
      server validation errors verbatim.
- [x] 6.4 Archive control via `archivePricingVersionAction`.
- [x] 6.5 Quote sanity panel via `calculateQuoteAction` (display only; the
      UI never computes authoritative prices).

## 7. Scheduling config / hours

- [x] 7.1 Configuration editor over `getSchedulingConfigAction` /
      `updateSchedulingConfigAction` (existing schema fields only).
- [x] 7.2 Operating-hours editor over `listOperatingHoursAction` /
      `upsertOperatingHoursAction` (weekday intervals).
- [x] 7.3 Closure control via `closeOperatingHoursAction`.
- [x] 7.4 Render the scheduling sections read-only without `branches.edit`
      (BD-E3b) — mutation controls hidden AND every mutation refused
      server-side.

## 8. Scheduling exceptions / service rules

- [x] 8.1 Exceptions manager over `listScheduleExceptionsAction` /
      `createScheduleExceptionAction` / `deleteScheduleExceptionAction`
      (typed creation per existing schema).
- [x] 8.2 Per-service scheduling-rules editor via
      `upsertServiceSchedulingRuleAction` scoped to the branch's services.

## 9. Authorization / branch / RLS tests

- [x] 9.1 Domain suite `tests/domain/config-admin-ui.test.ts`: permission
      matrix through the real action chain (hq_staff catalog OK, pricing
      view-only denial; branch_manager catalog+pricing within scope,
      scheduling mutation denial; cleaner denial; outsider fail-closed).
- [x] 9.2 Branch-context isolation tests (BM denied cross-branch catalog
      read; service scheduling rule rejected for a foreign branch's
      service).
- [x] 9.3 Pricing draft-only enforcement test (rule creation on a published
      version refused server-side).
- [x] 9.4 Scheduling HQ-only boundary test (BD-E3b): branch_manager
      scheduling mutation refused, hq_admin succeeds.
- [x] 9.5 RLS regression test (policy inventory on touched tables
      unchanged; no new policy).
- [x] 9.6 Read-only rendering assertions (mutation actions absent from the
      tree for permission-less roles).

## 10. Verification / documentation

- [x] 10.1 Typecheck, lint, build, `git diff --check` all pass.
- [x] 10.2 Full local suite green (existing domain + hosted suites
      unchanged and passing; new Change 10 suite green).
- [x] 10.3 Full Changes 1–10 hosted regression green (no migration apply).
- [x] 10.4 Scope-leak self-check: no `upsertTranslationAction`,
      `seedCatalogAction`, `seedPricingDefaultsAction`, payment, or
      notification code anywhere in the new surface; no production
      catalog/pricing/hours values introduced.
- [x] 10.5 Documentation sync: `ADMIN_SYSTEM.md`, `PROJECT_STRUCTURE.md`,
      `ROADMAP.md` (§9/§10/§11), `SERVICE_CATALOG.md`,
      `PRICING_ENGINE.md`, `SCHEDULING_SYSTEM.md` (incl. BD-E3b deferred
      consideration), `DOCUMENTATION_AUDIT.md` (BD-E3 record).
- [x] 10.6 Mark this change's tasks complete only after verification.
