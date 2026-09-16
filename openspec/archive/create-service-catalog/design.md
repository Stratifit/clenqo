# Design: Service Catalog & Branch Service Configuration

**Change ID:** `create-service-catalog`

Implementation considerations derived from `docs/SERVICE_CATALOG.md`
(decisions Q1–Q9) and the source-of-truth documents. No code or migrations are
written in this change.

---

## 1. Current implementation status (verified 2026-09-14)

| Area | Status |
|---|---|
| Identity, organizations, branches, website foundation, audit, RLS, authorization, session | **Implemented** (Change 1, archived — commits `b76db9b`, `394ed6a`; hosted verification 19/19 PASS) |
| Branch activation readiness checklist | **Implemented** — counts `active` services per branch; `services` item currently unsatisfiable (no services domain) |
| Services / categories / variants / add-ons | **Specified but not implemented** (`DATABASE.md` §15 defines a model that conflicts with approved decisions Q4/Q5/Q9; no tables exist in migrations `0001–0007`) |
| Service translations, compatibility, slug aliases | **Missing** (not in `DATABASE.md` §15 at all) |
| Branch service configuration (offering layer) | **Missing** (Q2 semantics undefined in schema) |
| Seed content | **Missing — deliberately** (Q6: business approval pending) |

This change specifies everything in rows 3–6 and does not recreate rows 1–2.
New migrations continue the existing chain at **`0008`**.

## 2. Authoritative sources

| Topic | Source |
|---|---|
| Domain model, boundaries, decisions Q1–Q9 | `docs/SERVICE_CATALOG.md` (§26.1 decision record) |
| Existing schema conventions | `DATABASE.md` §3 (UUIDs), §4 (timestamptz/UTC), §42 (constraints), §43 (indexes), §46 (JSONB), §54 (migrations), §55 (seeds) |
| Services model (pre-alignment) | `DATABASE.md` §15.1–15.4 — **alignment obligations in design §14** |
| Permissions | `SECURITY.md` §14 — `services.view` / `services.edit` only (Q8) |
| Audit architecture | `AUDIT_SYSTEM.md` §5–7, §21–26, §50, §101 — `resource.action`, transactional, fail-closed |
| API contract pattern | `API_STANDARDS.md` §4, §7–13, §19 (idempotency), §24 (stable errors), §50 (Result envelope) |
| Localization | `LOCALIZATION.md` §5–14 — `(entity_id, locale)` translations, single default, fallback rules |
| RLS | `DATABASE.md` §39–40, §57 (helpers), Change 1 established policy patterns |
| Capability context | `openspec/specs/branch-management/spec.md` (live contract — untouched by this change) |

## 3. Domain model (summary — full definitions in `docs/SERVICE_CATALOG.md` §2–9)

```text
Service Category  (first-class entity, Q4)
   └── Service
         ├── Service Variant
         └── Add-on ──(explicit allow-list join)──▶ Service/Variant

Branch offering attributes live on the branch-owned rows themselves (Q1/Q9):
enabled, customer visibility, branch-local sort order.
```

Key decided properties:

* **Per-branch rows (Q1):** every catalog entity is branch-owned.
  No master + join tables in this change.
* **Explicit `branch_id` NOT NULL on every catalog row (Q9):** the
  `DATABASE.md` §15 "nullable platform defaults" allowance is NOT used.
* **Opt-in offering (Q2):** a catalog row exists with
  `is_enabled = false, is_customer_visible = false` unless explicitly enabled;
  nothing is bookable merely by being created.
* **Allow-list compatibility (Q3):** absence of a compatibility row means
  incompatible. No block-list, no code constants.
* **First-class categories (Q4)** and **no catalog pricing (Q5)**.
* **Immutable internal identity + frozen published slugs (Q7)** via audited
  alias mechanism.
* **Existing permission vocabulary (Q8):** `services.view` / `services.edit`.

## 4. Database model

New tables (conceptual; exact SQL is written at implementation, per OpenSpec
rules). All follow Change 1 conventions: UUID PKs via `gen_random_uuid()`,
`timestamptz` UTC timestamps, FK integrity, natural-key UNIQUEs, RLS from day
one. Every table carries `organization_id` (redundant with branch but kept for
org-wide RLS and indexes, same as existing branch-scoped tables) and
`branch_id NOT NULL` (Q9).

### 4.1 `service_categories`

```text
id, organization_id, branch_id NOT NULL (Q9)
slug          — unique (branch_id, slug)  [only one row per slug per branch]
status        — draft | active | inactive | archived  (CHECK constraint)
sort_order
is_enabled            — branch offering flag (Q2; default false)
is_customer_visible   — default false
created_at, updated_at
```

Categories are offered per branch like every other entity (per-branch MVP
mapping, `docs/SERVICE_CATALOG.md` §8.4): the offering attributes
(`is_enabled`, `is_customer_visible`, branch-local ordering) live **on the
rows themselves** — there is no separate configuration table in this change.

### 4.2 `services`

```text
id, organization_id, branch_id NOT NULL (Q9)
category_id   — FK → service_categories, NOT NULL (exactly one category)
slug          — unique (branch_id, slug)
name          — default-locale operational name
description
status        — draft | active | inactive | archived
sort_order, is_enabled, is_customer_visible   — offering flags (Q2)
published_at  — set on first activation; freezes the slug (Q7)
created_at, updated_at
```

The `service_type` field of `DATABASE.md` §15.1 is **replaced** by the
`category_id` FK (alignment obligation, design §14).

### 4.3 `service_variants`

```text
id, organization_id, branch_id NOT NULL (Q9)
service_id    — FK → services, NOT NULL
slug          — unique (service_id, slug)
name, description, status, sort_order
is_enabled, is_customer_visible   — variant-level offering flags
published_at  — slug freeze (Q7)
created_at, updated_at
```

### 4.4 `service_addons`

```text
id, organization_id, branch_id NOT NULL (Q9)
slug          — unique (branch_id, slug)
name, description, status, sort_order
min_quantity  — ≥ 1 (1 = single-select)
max_quantity  — ≥ min_quantity
is_enabled, is_customer_visible
published_at  — slug freeze (Q7)
created_at, updated_at
```

**No `pricing_type`, no `default_price`** (Q5; alignment obligation §14).
`DATABASE.md` §15.4 is the pre-alignment reference only.

### 4.5 Translation tables (one per localizable entity)

```text
service_category_translations (category_id, locale, name, description)
service_translations           (service_id,  locale, name, description)
service_variant_translations   (variant_id,  locale, name, description)
service_addon_translations     (addon_id,    locale, name, description)
```

* UNIQUE `(entity_id, locale)` per `DATABASE.md` §42 (service_translations
  already mandated there; the other three follow the same established pattern).
* Locale must be a supported locale (checked in validation; not a DB enum so
  new locales stay addable without schema changes — `docs/SERVICE_CATALOG.md`
  §10).
* Default-locale record is the fallback for every other locale
  (`LOCALIZATION.md` §11).

### 4.6 `service_addon_compatibility` (Q3 — explicit allow-list)

```text
id, organization_id, branch_id NOT NULL (Q9)
service_addon_id        — FK → service_addons, NOT NULL
service_id              — FK → services, NOT NULL
service_variant_id      — FK → service_variants, NULLABLE (NULL = applies to
                          all variants of the service)
created_at, updated_at
UNIQUE (service_addon_id, service_id, service_variant_id)
```

* Absence = incompatible. The join table is the **only** compatibility
  mechanism (Q3: no block-list columns, no JSONB rule blobs, no code
  constants).
* All three participants must share the same `branch_id` and
  `organization_id` (enforced by composite FKs or validation; the join cannot
  cross branch boundaries).
* Variant-granular restriction is expressed by a row with a non-null
  `service_variant_id`.

### 4.7 `service_slug_aliases` (Q7 — audited redirect mechanism)

```text
id, organization_id, branch_id NOT NULL
entity_type   — service | service_variant | service_addon  (CHECK)
entity_id     — FK to the current entity row
old_slug
locale_scope  — slugs are locale-independent (single routing namespace)
created_at
UNIQUE (branch_id, entity_type, old_slug)
```

* Created **only** by the audited rename operation after first publication.
* An alias must not point at an entity whose current slug equals the alias
  (no-op), must not create chains (an alias's old_slug must never equal
  another alias's old_slug for the same entity type+branch — uniqueness above
  enforces this), and aliases are never rewritten (append-only history).
* The effective-catalog read model resolves `includeAliases` lookups through
  this table; consumers never see broken references.

### 4.8 What is deliberately NOT created

* No `branch_service_configuration` table (Q1 — the offering attributes live
  on the branch-owned rows; that record shape is the future master+join
  model).
* No pricing columns anywhere in the catalog (Q5).
* No `service_type` enum (Q4).
* No `section_registry`-style table for compatibility (Q3 — plain relational
  join).
* No platform-default rows with NULL `branch_id` (Q9).

## 5. Branch scoping & RLS

Every table gets RLS following the Change 1 policy pattern (org-wide for HQ
roles, branch-scoped via `membership_branches` for branch roles), reusing the
existing `has_organization_access()` / `has_branch_access()` SECURITY DEFINER
helpers (`0006_authorization_helpers.sql`) — no new helper functions, no
second authorization mechanism:

* **Select:** members of the organization (HQ) or of the branch
  (branch-scoped) see catalog rows for their scope.
* **Insert/update/delete:** performed by the application through the
  privileged server client (`lib/db/server.ts`, `server-only`) **after**
  application-level authorization — RLS is the second boundary, never the
  first (same as Change 1's website provisioning).
* The owner-exemption pattern (RLS enabled, not FORCE) is preserved exactly as
  established and verified in Change 1's hosted verification; the helpers must
  keep working for definer-context reads.
* No policy may derive authorization from client-supplied IDs; scope comes
  from the authenticated membership only.

## 6. Lifecycle & visibility

* Status CHECK constraints: `draft | active | inactive | archived` on all four
  entities.
* Transitions (enforced in the domain service, audited): draft → active →
  inactive → active; any non-archived → archived; archived is terminal.
* Activation preconditions (§21 invariants): category `active` before its
  services activate; default-locale translation exists before activation;
  `published_at` set on first activation (slug freeze, Q7).
* Bookability conjunction (never evaluated in catalog code — booking consumes
  `listEffectiveCatalog`): category enabled+visible ∧ entity `active` ∧
  `is_enabled` ∧ `is_customer_visible`.
* Seeded rows ship `draft` or `inactive` **and disabled** (Q2 — seeding must
  never auto-enable).

## 7. Authorization (Q8)

Exactly the existing catalog entries:

| Operation | Permission | Scope |
|---|---|---|
| Admin catalog reads | `services.view` | org-wide (HQ) / branch (branch roles) |
| Create/update/lifecycle catalog entities, compatibility, aliases | `services.edit` | HQ roles, org scope |
| Branch offering configuration (enable/disable/reorder/visibility) | `services.edit` | branch roles, branch scope only |

* Authorization chain identical to Change 1: `resolveActor` →
  `requirePermission` → `requireOrganizationAccess` → branch-scope check →
  domain service. Enforced server-side before any state change; UI context is
  never authorization.
* Branch-scoped users may toggle offering flags **only** for rows of their
  own branches; they cannot create/delete catalog entities or change
  lifecycle states (`docs/SERVICE_CATALOG.md` §8.3) — enforced in the domain
  service, not in the UI.
* No new permission names; if a split is ever needed, `SECURITY.md` §14 must
  be extended first (Q8; noted as future change, not this one).

## 8. Audit (existing architecture, no second mechanism)

Transactional `resource.action` events per `AUDIT_SYSTEM.md` §50 (written
inside the same transaction as the state change; fail-closed per §101) and
bounded/redacted metadata (§21–26):

```text
service_category.created / .updated / .status_changed / .archived
service.created / .updated / .status_changed / .archived
service_variant.created / .updated / .status_changed / .archived
service_addon.created / .updated / .status_changed / .archived
service_addon_compatibility.created / .removed
service_slug_alias.created          ← always paired with a slug rename
branch_service.enabled / .disabled / .updated
```

* `.status_changed` carries `from`/`to` states.
* `resourceType` values: `service_category`, `service`, `service_variant`,
  `service_addon`, `service_addon_compatibility`, `service_slug_alias`.
* Branch-scope rows carry `branch_id`; all carry `organization_id`.
* Bulk seeding writes one summary event per entity type with counts
  (`docs/SERVICE_CATALOG.md` §19).
* No secrets, no customer data, no pricing internals beyond IDs.

## 9. Transactional behavior

* Single-entity mutations: one transaction = state change + audit event(s)
  (fail-closed).
* **Slug rename:** one transaction = slug update + `published_at`-preserving
  checks + alias insert + `service_slug_alias.created` audit. If any part
  fails, nothing changes.
* **Seeding:** one transaction per branch per entity type (idempotent
  natural-key upserts), one summary audit event per type. Partial seed
  failure rolls back that type's transaction; already-committed types remain
  (idempotent re-run completes the rest).
* Telemetry (metrics/logs) outside transactions, diagnostic only — never
  business truth (same rule as Change 1).

## 10. Idempotent seed strategy (Q6)

* A seed runner keyed by deterministic natural keys
  (`(branch_id, slug)` / `(service_id, slug)`) performs existence-check
  upserts — running it twice produces identical row counts (same pattern as
  Change 1 provisioning and `DATABASE.md` §48/§55).
* Seed content is **not authored in this change**: the runner accepts a
  version-controlled catalog definition file (structure: categories →
  services → variants → add-ons → compatibility → translations) that remains
  empty/placeholder until the business approves V1 content per
  `docs/SERVICE_CATALOG.md` §7.4. A separate explicit task gates authoring
  that file on business approval (tasks §12).
* Seeded rows are created disabled and not customer-visible (Q2).
* No city/country names in any seed behavior (invariant §23-12).

## 11. API / domain contracts (specification only)

Domain operations (`features/services/`, per `API_STANDARDS.md` §4 chain —
authenticate → authorize → validate → domain service → transaction → audit →
typed `Result<T>`):

```text
listEffectiveCatalog(branchId, { locale, customerVisibleOnly })
resolveCatalogSlug(branchId, slug, { includeAliases })
createCategory / updateCategory / changeCategoryStatus   (+ Service/Variant/Addon analogues)
setAddonCompatibility(branchId, { addonId, serviceId, variantId? }) | removeAddonCompatibility(...)
renamePublishedSlug(branchId, { entityType, entityId, newSlug })
setBranchServiceState / reorderBranchCatalog / setBranchServiceVisibility   (offering flags only)
validateSelection({ serviceId, variantId, addonSelections })   — pure, consumable by booking later
seedCatalogFromDefinition(branchId, definition)   — idempotent, HQ-only, gated on approved content
```

* Stable error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`,
  `NOT_FOUND`, `CONFLICT` (duplicate slug / duplicate compatibility row /
  guarded-transition loss), `SLUG_IMMUTABLE` (rename attempt without alias
  path on a published entry) — extending the Change 1 `lib/errors.ts` enum
  with catalog-specific codes only where the existing set cannot express the
  condition.
* Zod schemas in `features/services/schemas/`: slug grammar (reuse branch
  slug rules), quantity bounds (`max ≥ min ≥ 1`), locale membership +
  default-locale-fallback rules, status transition legality.
* No business logic in Server Actions; actions are thin wrappers.
* `validateSelection` enforces: entity active + branch-enabled + visible,
  allow-list membership per add-on, quantity bounds, no exclusions — and
  nothing else (no pricing, no availability).

## 12. Migration strategy & backwards compatibility

* New migrations `0008+` appended to the existing chain — **no edits** to
  `0001–0007` (established rule; Change 1 migrations are verified and deployed
  to hosted Supabase).
* All new tables are additive; existing tables are untouched. No existing
  data can break (no services rows exist anywhere yet).
* RLS enabled in the same migration that creates each table (never a later
  "enable later" gap), matching Change 1's verified pattern.
* `DATABASE.md` §15.1/§15.4/§15-scope synchronization happens in the docs
  step of implementation, explicitly marked as the Q4/Q5/Q9 alignment
  (`docs/SERVICE_CATALOG.md` §20.3) — `DATABASE.md` is **not** modified in
  this design phase.
* Hosted Supabase compatibility: same conventions verified in Change 1
  (UUID gen, partial unique index where needed, SECURITY DEFINER helpers,
  RLS without FORCE, SSL-enabled pooler connection in `lib/db/server.ts`).
  Verification itself is a later task, not run now.

## 13. Testing strategy (same quality gate as Change 1)

* **Migration tests** (pglite executes the real chain): fresh-database build,
  constraints, natural-key uniquenesses, FK behavior, RLS enabled.
* **RLS/authorization tests:** cross-organization invisibility, cross-branch
  denial, branch-scoped offering rights, HQ vs branch-manager vs cleaner
  denial, manipulated-ID rejection — as real authenticated contexts.
* **Domain tests:** slug grammar/freeze/alias rules, lifecycle transition
  legality, default-locale requirements, compatibility closure, quantity
  bounds, opt-in semantics (new row never auto-enabled), idempotent seeding.
* **Audit tests:** required events, transactional co-commit, redaction,
  rename ↔ alias pairing.
* **Hosted Supabase verification:** a later implementation task
  (skipped-by-default suite as in Change 1) — specified, **not executed** in
  this phase.
* Gates: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

## 14. Documentation synchronization obligations (during implementation)

Explicit, per the approved decisions — executed as a numbered task, not
silently:

1. `DATABASE.md` §15.1 — replace `service_type` field with first-class
   `service_categories` entity; update the §15 scope note to require
   `branch_id` NOT NULL on every catalog row (Q4 + Q9).
2. `DATABASE.md` §15.4 — remove `pricing_type`/`default_price` as catalog
   fields; note pricing belongs to the Pricing Engine (Q5).
3. `DATABASE.md` §64 Services table set — add the new tables
   (categories, translations, compatibility, aliases).
4. Verify `SECURITY.md` §14 wording still matches usage (no changes expected
   — Q8 keeps `services.view`/`services.edit`); align `API_STANDARDS.md` /
   `AUDIT_SYSTEM.md` examples only if they contradict the implemented
   capability.
5. Mark `docs/SERVICE_CATALOG.md` §20.3 alignment obligations as resolved.

## 15. Risks / open decisions for implementation

* **V1 seed content is pending business approval (Q6)** — the schema, domain
  operations, and seed runner ship independently; the catalog remains empty
  until the approved definition file is authored. Branch activation readiness
  therefore remains unsatisfiable until content is approved **and** seeded —
  this is correct behavior, not a defect.
* **Slug uniqueness namespace:** slugs are unique per `(branch_id, slug)` per
  entity type; the branch website routing namespace (Change 1) is a different
  namespace — no collision handling is needed between them, but the booking/
  routing integration must be designed against `resolveCatalogSlug`.
* **Compatibility closure UX:** an add-on enabled for a branch but
  allow-listed against none of its enabled services is a configuration error
  surfaced in admin tooling (§21 invariant), not silently hidden.
* No unresolved documentation conflicts were discovered while drafting this
  change; the two known alignments (Q4/Q5) are carried as explicit
  obligations (design §14) rather than new conflicts.
