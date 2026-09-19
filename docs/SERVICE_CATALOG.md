# CLENQO — Service Catalog & Branch Service Configuration

**Status:** Source of Truth
**Revised:** 2026-09-14 — decisions Q1–Q7 from the Service Catalog documentation review applied (see §26)
**Scope:** Service catalog domain model, categories, services, variants, add-ons, branch service configuration, localization, lifecycles, visibility, compatibility, HQ/branch ownership, and the domain boundaries toward pricing, booking, scheduling, and workers
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase/PostgreSQL
**Primary Principle:** The Service Catalog defines **WHAT** CLENQO sells. It never defines **HOW MUCH** it costs, **WHEN** it can be performed, or **WHO** performs it.

---

## 1. Purpose & Scope

### 1.1 What the Service Catalog owns

The Service Catalog is the authoritative registry of sellable cleaning offerings:

* service categories;
* services;
* service variants;
* add-ons;
* their stable identities, descriptions, ordering, localization, status/lifecycle, visibility, and compatibility declarations;
* per-branch configuration of which of the above are offered.

### 1.2 What the Service Catalog explicitly does NOT own

* **Prices, rates, multipliers, surcharges, discounts, tax — and any authoritative pricing-type data** — Pricing Engine (`PRICING_ENGINE.md`).
* **Availability, schedules, capacity, blackout periods** — Scheduling (`SCHEDULING_SYSTEM.md`).
* **Bookings and their lifecycle** — Booking System (`BOOKING_SYSTEM.md`).
* **Workers, skills, assignment** — Worker domain (`WORKER_SYSTEM.md`).
* **Marketing presentation of services** (page layout, imagery placement, SEO of public pages) — CMS/Content System (`CONTENT_SYSTEM.md`); the CMS *references* catalog records, it does not redefine them.
* **Duration calculation** — derived by the Pricing Engine from service-specific rules (`PRICING_ENGINE.md` §13); the catalog stores no duration numbers.

### 1.3 Relationship to neighboring domains

```text
Service Catalog (WHAT is sold)
      │
      ├──→ Pricing Engine   references stable catalog identities to compute HOW MUCH
      ├──→ Booking Engine   consumes enabled, customer-visible catalog entries
      ├──→ Scheduling       may reference catalog attributes for duration/capability rules
      └──→ Worker domain    may reference catalog identities for future capabilities/skills
```

The catalog is upstream of all of them. It must remain consumable read-only by every downstream domain.

### 1.4 Relation to existing source-of-truth documents

This document consolidates and details what is already distributed across:

* `REQUIREMENTS.md` §9 (SV-001 Service Catalog, SV-002 Variants, SV-003 Add-ons, SV-004 Branch Availability);
* `DATABASE.md` §15 (services model: `services`, `service_translations`, `service_variants`, `service_addons`);
* `BOOKING_SYSTEM.md` §8–11 (branch catalog as booking source; disabled services not bookable);
* `CONTENT_SYSTEM.md` §26–28 (service/variant/add-on presentation vs operational data);
* `PRICING_ENGINE.md` §12–14 (service/variant/add-on as pricing inputs; duration rules);
* `BRANCH_SYSTEM.md` §35–36 (service management split from CMS presentation);
* `ROADMAP.md` §9 (Phase 1 services scope);
* `SECURITY.md` §14 (`services.view` / `services.edit`).

Where wording differed, this document states the reconciled rule. Two known alignment obligations against `DATABASE.md` §15 (category entity, add-on pricing fields) are recorded in §20.4 and §26.2 and must be resolved by the implementing OpenSpec change — this document does not modify `DATABASE.md`.

---

## 2. Domain Model

Conceptual hierarchy:

```text
Catalog Scope
   └── Service Category          (groups services for navigation & presentation)
         └── Service             (a sellable cleaning offering, e.g. "Deep Cleaning")
               ├── Service Variant     (a materially distinct way of delivering it)
               └── Add-on              (an optional extra attached at booking time)

Branch Service Configuration    (per-branch: what is offered/enabled, in what order)
```

**Physical scoping (decided, Q1):** for the MVP every catalog entity is a **per-branch row** (`DATABASE.md` §15 direction; audit resolution MEDIUM-3). The HQ-master + branch-availability-join model remains a **conceptual/future evolution only** and must not be introduced by OpenSpec Change 2 unless separately approved (§8.4, §26.1).

### 2.1 Service Category

* Groups services for customer navigation, admin organization, and reporting rollups.
* Configurable data — never a hardcoded enum of cities or offerings.
* Has its own identity, slug, status, ordering, and localized name/description.
* **First-class entity (decided, Q4)** — see §3.

### 2.2 Service

* The sellable unit a customer understands ("Home Cleaning", "Move-In / Move-Out").
* Owns identity, slug/code, localized name/description, included/excluded task declarations (via CMS presentation), status, ordering, category membership, and visibility flags.
* Is the unit that branch availability attaches to.

### 2.3 Service Variant

* A materially distinct delivery mode of one service that changes scope of work and therefore pricing/scheduling inputs (e.g. `Regular Cleaning` vs `Deep Cleaning` under `Home Cleaning`).
* Not a separate service when the customer still recognizes it as "the same kind of cleaning with a different intensity/scope" (see §5).
* The variant — not the service — is typically the pricing-relevant selection.

### 2.4 Add-on

* An optional extra selectable at booking time (e.g. "Inside Oven", "Laundry").
* Has availability scope, compatibility constraints, quantity rules, and branch enablement (§6).
* Never changes the identity of the booked service; it augments it.
* Carries **no** authoritative price or pricing-type data (decided, Q5 — §6.7).

### 2.5 Branch Service Configuration

* The per-branch layer that decides which catalog entries a branch actually offers, in what order, with which customer visibility (§9).
* Keeps the catalog definition and the branch's commercial decisions separate.
* **Absence semantics (decided, Q2):** a branch that has not opted in does not offer the entry — see §9.

---

## 3. Service Categories

Categories are **configurable records**, not code constants. They are a **first-class entity** (decided, Q4): `service_categories` with their own identity, slug, status, ordering, and translations — not a type field on `services`.

> **Alignment obligation (Q4):** `DATABASE.md` §15.1 currently models category information as a `service_type` value on `services` (e.g. `home_cleaning`). The first-class `service_categories` entity defined here is the decided target domain model. `DATABASE.md` is deliberately not modified by this document; replacing/augmenting the `service_type` field with the first-class entity is an explicit obligation of the OpenSpec change that implements the catalog schema, including the `DATABASE.md` documentation synchronization step of that change.

Initial seed set (per `REQUIREMENTS.md` §9, `ROADMAP.md` §9 — business configuration, not code; see §7 for approval status):

```text
Home Cleaning
Business / Commercial Cleaning
Deep Cleaning
Move-In / Move-Out Cleaning
```

Rules:

* Category management is an HQ-level responsibility exercised across branches; in the per-branch MVP mapping the category rows themselves are branch-scoped like the rest of the catalog (§8.4).
* A category with attached services cannot be hard-deleted; it is archived (§11).
* Every service belongs to exactly one category (re-categorization is a normal audited update).
* The four initial categories must exist as seed data for new branches — they must never be hardcoded into application logic, routing, or UI components.
* Category naming must stay city- and country-neutral; local market naming is a localization concern, not a new category per city.

---

## 4. Services

### 4.1 Definition

A service is the customer-recognizable offering. Conceptual fields:

```text
id                  — stable identity (UUID), immutable forever
organization_id     — owning organization
branch_id           — owning branch (MVP per-branch scoping, §8.4)
category_id         — exactly one category (first-class entity, §3)
slug / code         — URL-safe, stable, unique within its ownership scope
name                — default-locale name (authoritative operational name)
description         — operational description; public marketing copy lives in CMS/translations
status              — draft | active | inactive | archived (§11)
sort_order          — deterministic display ordering
visibility          — customer_visible | internal (§12)
created_at / updated_at
```

### 4.2 Slug / code rules (decided, Q7)

Two distinct identifiers must never be conflated:

* **Internal identity** (`id`): immutable forever, never reused, never human-visible in URLs. Pricing, bookings, and all domain references point at this.
* **Customer-facing slug:** appears in public URLs and booking flows.

Rules for the customer-facing slug:

* Lowercase, URL-safe, deterministic normalization (same grammar as branch slugs).
* Freely editable while the entry is `draft` and has never been published.
* **Immutable after publication** — once an entry has become `active` (or customer-visible at any branch), its slug must not be silently changed.
* If a published slug must change, a **redirect/alias mechanism** is used: the old slug is recorded as an alias mapping to the current entry, the alias is audited, and the old slug can never be assigned to a different offering. Alias resolution happens in the catalog read model; consumers never see a broken reference.
* Uniqueness is enforced within the ownership scope (branch scope in the MVP model — §8.4).

### 4.3 Localization

* `service_translations` pattern per `DATABASE.md` §15.2 — unique `(service_id, locale)`.
* Locales: `de`, `en`, `fr`, `es` initially, extensible (§10).
* The default-locale record is the fallback for every other locale (`LOCALIZATION.md` §11).

### 4.4 Customer visibility & branch availability

* A service is bookable only when: category active + service `active` + branch-enabled + `customer_visible` (§12).
* Branch availability is the branch configuration layer's decision (SV-004, `BOOKING_SYSTEM.md` §8: "The actual service catalog comes from the branch configuration. Disabled services must not be bookable.").
* **Opt-in rule (decided, Q2):** a newly created or newly activated catalog item does **not** automatically become bookable at any branch. Branches explicitly opt in (§9).

---

## 5. Service Variants

### 5.1 When a variant is appropriate

Create a **variant** when all of the following hold:

* The customer still recognizes the offering as the same service ("Deep Cleaning" of a home vs "Regular Cleaning" of a home).
* The difference changes scope of work / intensity / duration — i.e. it changes pricing and scheduling *inputs*, not the identity of the offering.
* The variant shares the service's category, booking flow, and property-detail inputs.

### 5.2 When a separate service is appropriate

Create a **separate service** when:

* The offering has its own customer identity and sales narrative (e.g. `Move-In / Move-Out` is not a variant of `Home Cleaning` — `REQUIREMENTS.md` SV-002 lists it as its own service).
* It has materially different property inputs, booking flow, or operational handling.
* It needs independent branch availability decisions at the service level.

### 5.3 Rules

* Variants belong to exactly one service; a service may have zero or more variants.
* A service without variants is bookable directly; a service with variants requires variant selection at booking time (booking flow decision, `BOOKING_SYSTEM.md` §9: "The selected variant becomes part of the booking.").
* Variants carry their own status, ordering, localization, visibility, and slug rules (including the Q7 immutability rules); they never bypass the parent service's lifecycle (a variant of an `inactive` service is not bookable).
* Variant examples from the source docs (`Regular`, `Deep`, `Recurring`, `Eco-Friendly`) are seed configuration, not hardcoded behavior. "Recurring" as a booking *plan* remains a Phase-3 concern (`ROADMAP.md` §32) — a `Recurring Cleaning` variant label must not imply subscription logic exists.

---

## 6. Add-ons

### 6.1 Identity

```text
id                  — stable identity
organization_id     — owning organization
branch_id           — owning branch (MVP; DATABASE.md §15.4 — "Branch-level ownership allows
                      different branches to enable different add-ons")
slug / code         — URL-safe, stable (immutability rules of §4.2 apply after publication)
name / description  — default-locale operational text (+ translations)
status              — draft | active | inactive | archived
min_quantity / max_quantity — selection bounds (§6.4)
```

No authoritative price or pricing-type field exists on this entity (§6.7, decided Q5).

Examples (`REQUIREMENTS.md` SV-003, `DATABASE.md` §15.4): Inside Oven, Inside Refrigerator, Window Cleaning, Interior Cabinets, Laundry, Extra Bathroom, Pet Hair Treatment. These are candidate seed configuration (§7) — never hardcoded.

### 6.2 Availability

* An add-on is available to a booking only when: add-on `active` + enabled for the branch + **explicitly allow-listed** as compatible with the selected service/variant (§13) + `customer_visible` if customer-selectable.
* `BOOKING_SYSTEM.md` §10: "Only add-ons available for the selected branch/service may be selected."

### 6.3 Compatibility

Declared as catalog data via the explicit allow-list mechanism (§13, decided Q3), not inferred in booking code.

### 6.4 Quantity rules

* An add-on declares whether it is single-select or quantity-based (`min_quantity`, `max_quantity`).
* Quantity is a booking-time input; the catalog only declares the bounds.
* Bounds must be enforced at booking validation; they carry no pricing meaning.

### 6.5 Localization

Same `(entity_id, locale)` translation pattern as services; default locale is the fallback.

### 6.6 Branch configuration

Branches enable/disable add-ons and set their display ordering (§9). Global add-on definitions are not duplicated per branch in content; the branch layer references stable add-on identities.

### 6.7 Relationship to pricing (decided, Q5)

* **The catalog contains no authoritative price and no authoritative pricing-type data.** Pricing belongs exclusively to the Pricing Engine (`PRICING_ENGINE.md`; `CONTENT_SYSTEM.md` §28: "Actual pricing should come from the pricing engine.").
* The catalog must not calculate, sum, or present final customer prices (§14).
* **Alignment obligation (Q5):** `DATABASE.md` §15.4 currently includes `pricing_type` and `default_price` on `service_addons`. This is a documentation/schema alignment that must be resolved by the OpenSpec change implementing the catalog (removal, or relocation to pricing configuration). `DATABASE.md` is deliberately not modified by this document. If any such field physically exists before that alignment lands, it is non-authoritative and must not be read by pricing or booking code.

---

## 7. V1 Catalog — Pending Business Approval

> **Status: PLACEHOLDER.** The concrete V1 catalog content has **not** been decided by the business. Nothing in this section is authoritative seed data, and no OpenSpec change may treat it as such. This section defines the *structure* the approved catalog must fill and records the candidate pool already supported by existing documentation.

### 7.1 Required structure per entity

Every V1 catalog decision must specify, per item:

* **Category:** slug; localized name/description (which locales ship — at minimum the default locale); status; sort order.
* **Service:** parent category; slug; localized name/description; included/excluded task declarations; whether it has variants; translations.
* **Variant:** parent service; slug; localized name/description; status; sort order.
* **Add-on:** slug; localized name/description; quantity rule (single-select vs bounds); compatibility allow-list entries (§13); translations; branch enablement defaults (expected: none — opt-in, §9).

### 7.2 Candidate pool (from existing documentation — non-authoritative)

* **Categories:** Home Cleaning · Business/Commercial Cleaning · Deep Cleaning · Move-In/Move-Out (`REQUIREMENTS.md` §9, `ROADMAP.md` §9).
* **Variant labels:** Regular · Deep · Recurring · Eco-Friendly (`DATABASE.md` §15.3; `PRICING_ENGINE.md`; `CONTENT_SYSTEM.md`).
* **Add-ons:** Inside Oven · Inside Refrigerator · Window Cleaning · Interior Cabinets · Laundry · Extra Bathroom · Pet Hair Treatment (`REQUIREMENTS.md` SV-003, `DATABASE.md` §15.4).

### 7.3 Known placement tension requiring business approval

The four documented names appear in the sources **both** as "initial services" (`REQUIREMENTS.md` SV-001, `ROADMAP.md` §9) **and** as category names (§3, per the documentation brief). Whether e.g. "Deep Cleaning" is a category containing services/variants, a service with variants, or both in specific cases, is a business decision that must be made as part of the V1 approval (§26.2-a).

### 7.4 Approval checklist before Change 2 seed data

* [ ] Final category/service/variant/add-on list with placements (resolves §7.3).
* [ ] Locale coverage per item (default locale mandatory; which additional locales ship in v1).
* [ ] Compatibility allow-lists per add-on (§13).
* [ ] Quantity bounds per add-on (§6.4).
* [ ] Sort orders.
* [ ] Confirmation that no city/country-specific items enter the global seed (§23).

---

## 8. HQ vs Branch Ownership

### 8.1 What HQ controls (organization scope)

* The existence and identity of categories, services, variants, and add-ons (managed across branches).
* Lifecycle transitions that remove offerings (archive).
* Default ordering, default visibility, and the initial seed set applied to new branches (seeded rows are created **disabled**, per §9).
* Localization completeness of the master definitions.

### 8.2 What branches can override / decide (branch scope)

* Whether an offered service/variant/add-on is **enabled** for their branch (SV-004) — explicit opt-in (§9).
* Branch-local **display ordering** within their enabled catalog.
* Branch-local **customer visibility** (e.g. offer a service internally for phone bookings only).
* Which enabled add-ons appear for which of their enabled services (within the compatibility allow-lists).

### 8.3 What branches cannot override

* Catalog identities, published slugs, and the definition of an offering.
* Another branch's configuration.
* Compatibility declarations (§13) — a branch can only choose *within* what the allow-lists allow.
* Lifecycle states of catalog records (a branch cannot `archive` a catalog entry; they can only disable it locally).

### 8.4 Scoping model (decided, Q1)

**Per-branch rows for the MVP**, carrying forward the documented decision in `DATABASE.md` §15 (audit resolution MEDIUM-3): each catalog entity — categories included — exists as branch-scoped rows; `branch_id` is the owning branch — explicit `branch_id NOT NULL` on every catalog row (Q9; the earlier "nullable platform defaults" allowance is NOT used). A new branch receives its own seeded, self-contained catalog.

The HQ-master catalog + separate branch-availability join table is a **conceptual/future evolution only** (§2, §9): it is *not* implemented by OpenSpec Change 2 and must not be introduced unless separately approved. Any future evolution must preserve every rule in this document, including the Q2 opt-in semantics.

### 8.5 Propagation of updates

* Edits to a catalog definition are visible to the owning branch immediately for non-breaking fields (descriptions, added translations, ordering defaults).
* Because catalog rows are per-branch (Q1), cross-branch "global updates" are HQ operations applied per branch; they must be explicit, audited, and must never silently re-enable or disable branch configuration.
* Breaking changes (retiring a variant, narrowing a compatibility allow-list, archiving) must not silently mutate branch configuration: enablement decisions remain auditable history; archived entries stop being bookable everywhere by lifecycle, not by mutation of branch rows.
* There is no branch-specific fork of a definition: a branch's enablement is configuration *about* a catalog entry, never a second copy *of* it. **A newly created or newly activated catalog item is not automatically offered or bookable at any branch (Q2).**

---

## 9. Branch Configuration

A branch must be able to configure its offered catalog without modifying catalog definitions.

**Absence semantics (decided, Q2): missing configuration means NOT OFFERED.** Branches explicitly opt in to every service, variant, and add-on they offer. A newly created catalog item must not automatically become customer-bookable at any branch.

Conceptual branch configuration record:

```text
branch_service_configuration
├── id
├── organization_id
├── branch_id
├── service_id            — stable reference into the catalog
├── service_variant_id    — nullable; variant-level enablement
├── addon_id              — nullable; add-on enablement
├── is_enabled            — offered by this branch? (opt-in)
├── is_customer_visible   — bookable online vs internal/admin only (§12)
├── sort_order            — branch-local ordering
├── created_at / updated_at
```

**Physical representation in the MVP mapping (Q1):** with per-branch rows, the branch-configuration attributes (enabled, customer visibility, branch-local ordering) are carried by the branch-owned catalog rows themselves; the record above describes the logical layer and remains the target shape only if the master+join evolution is ever separately approved.

Rules:

* Opt-in only: no row / not enabled ⇒ not offered ⇒ not bookable, not rendered, not selectable.
* Provisioning-time seeding may pre-create catalog rows for a new branch for convenience, but seeded entries must ship **disabled and not customer-visible**; enabling them is an explicit branch/HQ action.
* Booking, search, CMS, and reporting read the *effective* catalog for a branch = active catalog entry **∧** explicitly enabled **∧** customer-visible (§12).
* One configuration per (branch, catalog entry) — unique natural key; idempotent to update.
* The activation readiness check implemented in Change 1 (`features/branches/activation.ts`) counts services with `status = 'active'` scoped to the branch — the lifecycle states in §11 are the contract it consumes; lifecycle status and branch enablement are orthogonal concerns.

---

## 10. Localization

Supported initially: `de`, `en`, `fr`, `es` (platform launch locales, `LOCALIZATION.md`; `create-branch` schema). Additional locales must be addable **without schema changes**:

* Translation tables use `(entity_id, locale)` unique keys; new locales are rows, not columns.
* Exactly one default locale per organization/branch context; default-locale text is the fallback for missing translations.
* A translation is display data; enabling a locale for a branch never changes what is sellable.
* Missing translations must not break booking flows: fall back to the default locale, never to an empty string in customer-facing UI.
* Machine translation may assist, but legally relevant service descriptions (e.g. scope-of-work promises) require review per `LEGAL_COMPLIANCE.md` §67.

---

## 11. Service Lifecycle

States (per the documented status pattern; `DATABASE.md` §15.1):

```text
draft ──→ active ──→ inactive ──→ archived
   ▲          │          │
   └──────────┘          │
        (reactivate)     └──→ active (reactivation is allowed only while not archived)
```

* **draft** — being defined; not selectable anywhere, not visible to customers, not bookable, not enabled by branch configuration. Slug may still be edited (§4.2).
* **active** — the only state from which an offering can be branch-enabled and (with visibility) booked. First activation freezes the customer-facing slug (§4.2).
* **inactive** — temporarily withdrawn; retains identity and configuration; not bookable; can return to `active` without re-creation.
* **archived** — terminal. No longer selectable, no longer branch-enableable; historical bookings and pricing snapshots keep referencing the archived identity (never renumber or reuse identities).

Transition rules:

* Only authorized users may transition state; every transition is audited (§19).
* Archiving a service archives nothing automatically about historical data; it only stops future enablement/booking.
* Archiving a category requires its services to be moved or archived first (no orphan services).
* Activation readiness in the implemented branch activation check treats only `active` services as satisfying readiness — consistent with the above.

---

## 12. Visibility

Four distinct concerns that must not be conflated:

| Layer | Question | Decided by |
|---|---|---|
| Globally available | Does the offering exist in the catalog (for this branch)? | Catalog lifecycle (`status = active`) |
| Branch available | Does this branch offer it? | Branch configuration — **explicit opt-in (§9); absence = not offered** |
| Customer visible | Can a customer see/select it online? | `is_customer_visible` on branch configuration (+ catalog-level `visibility`) |
| Internal / admin only | Staff-visible but not online-bookable? | `is_customer_visible = false` |

Rules:

* Customer visibility requires **all** upper layers to be true; it can never exceed them.
* A missing or disabled branch configuration is equivalent to `is_enabled = false` — there is no opt-out default.
* Internal-only offerings appear in admin tooling and may be attached to manually created bookings; they are never rendered on public websites or in customer booking flows.
* A service must never be publicly rendered while `draft`/`inactive`/`archived`, regardless of branch configuration.

---

## 13. Compatibility Rules (decided, Q3)

The catalog expresses structural compatibility as **explicit allow-list data implemented through a join-table relationship**. It embeds no pricing logic and no scattered code constants.

* **Mechanism:** an add-on is selectable for a service/variant only when an explicit allow-list row links the add-on to that service (or, at finer granularity, to a specific variant). Conceptually:

  ```text
  service_addon_compatibility
  ├── service_addon_id      — the add-on
  ├── service_id            — compatible service
  └── service_variant_id    — nullable; variant-granular restriction
  ```

* **Absence means incompatible.** No allow-list row ⇒ the add-on cannot be selected for that service/variant. There is no block-list and no default-compatibility rule.
* **Mutual exclusion** between add-ons (if the business needs it in v1) must likewise be explicit catalog data in the same declarative structure — never inferred in booking code.
* **Quantity bounds** (§6.4) are part of compatibility data.
* Compatibility is HQ-owned (§8.3); branches select within it.
* **Booking-time enforcement:** the Booking Engine validates the final selection against the allow-list data; it must not re-implement compatibility rules in code constants.
* Every compatibility mutation is audited (§19).

---

## 14. Pricing Boundary

* The Service Catalog defines **WHAT** is sold. The Pricing Engine defines **HOW MUCH** it costs (`PRICING_ENGINE.md`; `BRANCH_SYSTEM.md` §35: "Service Price → Pricing Domain").
* The catalog must not calculate final customer prices, must not know tax, must not embed rates or multipliers, and must **not contain authoritative price or pricing-type data** (decided, Q5 — §6.7).
* Pricing rules reference **stable catalog identities** — `pricing_rules.service_id` and `pricing_rules.service_variant_id` per `DATABASE.md` §16.2 — never names or slugs, so renaming never breaks pricing.
* Any legacy `pricing_type`/`default_price` fields on `service_addons` (`DATABASE.md` §15.4) are a flagged alignment obligation, not a permission to read prices from the catalog (§6.7, §26.2).
* Bookings store the pricing snapshot at confirmation (`DATABASE.md` §16.3); later catalog changes must not alter historical prices.

---

## 15. Booking Boundary

The Booking Engine consumes from the catalog:

* the effective branch catalog (explicitly enabled + customer-visible services/variants/add-ons, §12);
* stable identities to reference on `bookings`/`booking_items`;
* the compatibility allow-lists and quantity bounds to validate the selection (§13);
* localized display text for the selection UI;
* slug resolution for published entries, including published aliases (§4.2).

The Booking Engine must NOT duplicate:

* catalog definitions, names, or descriptions (reference by ID; render from translations);
* pricing logic (it calls the pricing engine with catalog identities, `PRICING_ENGINE.md`);
* availability logic (`SCHEDULING_SYSTEM.md`);
* branch enablement decisions (it reads the effective catalog; it does not re-decide it).

Disabled services must not be bookable (`BOOKING_SYSTEM.md` §8) — enforcement lives in booking validation reading the effective catalog, where absence of opt-in is equivalent to disabled (§9).

---

## 16. Scheduling Boundary

* The catalog is not responsible for availability, capacity, or calendars.
* Catalog information that may influence scheduling later: the selected service/variant/add-on combination (pricing-derived duration already consumes these, `PRICING_ENGINE.md` §13) and future structural attributes (e.g. "requires two cleaners") if the business needs them.
* If such attributes are added, they are *inputs* that scheduling rules reference — the catalog stores the attribute, never the resulting schedule, duration commitment, or availability window.

---

## 17. Worker / Capability Boundary

* Future worker capability/skill records may reference stable service identities (and optionally variants) so managers can see "who can perform Deep Cleaning".
* The catalog must not reference workers, store coverage, or participate in assignment (`WORKER_SYSTEM.md` owns skills/assignment).
* The reference direction is one-way: worker capability → catalog identity. A service must never require a worker record to exist.

---

## 18. Authorization

The authoritative permission catalog is `SECURITY.md` §14. This document introduces **no new permission names**.

Applicable existing permissions:

| Operation | Permission | Scope |
|---|---|---|
| View catalog (admin surfaces) | `services.view` | org-wide for HQ roles; branch-scoped for branch roles |
| Create/update/lifecycle catalog entries (categories, services, variants, add-ons) | `services.edit` | HQ roles at organization scope |
| Branch configuration (enable/disable, ordering, visibility) | `services.edit` | branch roles at branch scope only |

Rules:

* Enforcement is server-side, before any state change, per the established chain (authentication → role → permission → organization scope → branch scope → resource scope).
* The UI can never grant or widen these permissions; branch context in the dashboard is never authorization.
* If finer granularity is ever needed (e.g. separating "edit master catalog" from "configure branch catalog"), `SECURITY.md` §14 must be extended **first**; this document must not spawn a competing vocabulary (see §26.2-b).

---

## 19. Audit

Following the `resource.action` format and transactional-audit rules of `AUDIT_SYSTEM.md` (§5, §21–26, §50):

| Event | Trigger |
|---|---|
| `service_category.created` / `.updated` / `.archived` | category lifecycle |
| `service.created` / `.updated` / `.status_changed` / `.archived` | service lifecycle (`.status_changed` carries from/to states) |
| `service_variant.created` / `.updated` / `.status_changed` / `.archived` | variant lifecycle |
| `service_addon.created` / `.updated` / `.status_changed` / `.archived` | add-on lifecycle |
| `service_addon_compatibility.created` / `.removed` | compatibility allow-list changes (§13) |
| `service_slug_alias.created` | published-slug change via the alias mechanism (§4.2) |
| `branch_service.enabled` / `.disabled` / `.updated` | branch configuration changes (explicit opt-in/opt-out actions, §9) |

Rules:

* Audit records are transactional with the state change they describe (§50); metadata is bounded and redacted (no customer data, no pricing internals beyond IDs, no secrets) per §21–25.
* Branch-scope events carry `branch_id`; organization-level events carry `organization_id` only.
* Bulk operations (e.g. seeding a new branch's catalog) produce one summary audit event per resource type with counts, not thousands of rows.
* A slug change on a published entry is only valid together with its `service_slug_alias.created` audit record.

---

## 20. Database Requirements (conceptual only — no migrations in this document)

### 20.1 Entities

Aligned with `DATABASE.md` §15 and its uniqueness conventions (§42), under the decided per-branch MVP scoping (§8.4):

* `service_categories` — branch-scoped rows (MVP); unique slug within ownership scope; status; sort_order.
* `services` — per `DATABASE.md` §15.1; branch-owned rows; FK to category; unique slug within ownership scope; status; visibility flag; sort_order.
* `service_translations` — per §15.2; unique `(service_id, locale)`.
* `service_variants` — per §15.3; unique `(service_id, slug)`; status; sort_order.
* `service_variant_translations` — same pattern as service translations.
* `service_addons` — per §15.4 minus pricing fields (§20.3); branch-scoped; unique slug within ownership scope; quantity bounds; status.
* `service_addon_translations` — same pattern.
* `service_addon_compatibility` — explicit allow-list join (§13); unique `(service_addon_id, service_id[, service_variant_id])`.
* `service_slug_aliases` — published-slug redirect/alias mapping (§4.2); unique old slug within ownership scope; FK to the current entry; audited creation.
* Branch-configuration attributes (enabled, customer visibility, ordering) — carried by the branch-owned rows themselves in the per-branch mapping; the conceptual `branch_service_configuration` record (§9) is the future master+join shape and is **not** a Change 2 table (§8.4).

### 20.2 Cross-cutting requirements

* Every table carries `organization_id`; branch-scoped tables carry `branch_id` (RLS foundation, §24).
* FK integrity to organizations/branches; cascades follow the existing migration patterns (website foundation precedent).
* Natural-key uniqueness backs idempotent provisioning/seeding (same pattern as the website foundation migrations).
* All tables get RLS with organization and branch isolation from day one.
* Seed data must be version-controlled and idempotent — deterministic slugs, no city names — and must ship **disabled/not customer-visible** per §9, pending the approved V1 content (§7).

### 20.3 Alignment obligations for the implementing OpenSpec change

These are recorded decisions, not open questions. `DATABASE.md` is not modified by this document; the implementing change must reconcile the schema and synchronize `DATABASE.md`.

**Status: RESOLVED by the `create-service-catalog` change** (migration `0008_service_catalog.sql` + `DATABASE.md` §15 synchronization):

1. **§15.1 `service_type` field → first-class `service_categories` entity** (Q4) — **RESOLVED**: `DATABASE.md` §15.0 now documents the entity; `services.category_id` FK replaces the field.
2. **§15.4 `pricing_type`/`default_price` on `service_addons` → removed/relocated to pricing** (Q5) — **RESOLVED**: `DATABASE.md` §15.4 no longer lists any pricing fields; pricing belongs to §16.
3. New structures this document introduces that §15 did not yet define: `service_addon_compatibility` (§13), `service_slug_aliases` (§4.2), and branch-configuration attributes on per-branch rows (§9) — **RESOLVED**: documented in `DATABASE.md` §15.5–§15.7, with `branch_id NOT NULL` (Q9) noted throughout §15.

---

## 21. API / Domain Requirements (specification only — no implementation)

Domain operations expected (each: authenticated → authorized → validated → domain service → transaction → audit → typed result, per `API_STANDARDS.md` §4):

* `listEffectiveCatalog(branchId, { locale, customerVisibleOnly })` — the read model consumed by booking/CMS/search; applies the §9 opt-in semantics and §12 visibility rules.
* `resolveCatalogSlug(slug, { includeAliases })` — resolves published slugs, including published aliases; never silently renames (§4.2).
* `createService / updateService / changeServiceStatus / archiveService` (+ category/variant/add-on analogues) — HQ scope.
* `setAddonCompatibility / removeAddonCompatibility` — allow-list management (§13).
* `renamePublishedSlug(entryId, newSlug)` — creates an alias for the old slug; rejected if the old slug was never published (§4.2, §19).
* `getBranchConfiguration / setBranchServiceState / reorderBranchCatalog / setBranchServiceVisibility` — branch scope; explicit opt-in/opt-out only (§9).
* `validateSelection({ serviceId, variantId, addonSelections })` — pure validation of compatibility allow-lists + quantity bounds + effective availability, consumable by booking before pricing.

Validation invariants to enforce server-side:

* Slug grammar and reserved segments (reuse the branch slug rules).
* **Published-slug immutability:** renaming a published entry requires the alias path; an alias target must exist and must not create chains/loops (§4.2).
* Locale membership in supported locales; default-locale translation must exist before a service becomes `active`.
* No booking-facing state transition that leaves required translations missing.
* Category must be `active` for its services to become `active`.
* Archiving rules of §11.
* Compatibility closure: an add-on enabled for a branch but allow-listed against none of its enabled services is a configuration error, surfaced in admin tooling.
* Branch configuration changes are always explicit; no operation may bulk-enable newly created items (§9).
* All mutations produce the audit events of §19.

---

## 22. Multi-Branch / Multi-Country

* The same catalog architecture must serve 1 → 5 → 20 → 100+ branches without structural change (`ROADMAP.md` §39, §69).
* Branch count must never change row shapes, code paths, or produce per-branch copies of catalog *definitions* (configuration is per branch by design; definitions are referenced, not forked — §8.5).
* Multi-country readiness: identities and slugs are country-neutral; currency never appears in the catalog (pricing concern); per-country service assortments are expressed through the same branch configuration layer, not new entity types (`ROADMAP.md` §49–54).
* Seed data ships once per organization; branches differ by explicit configuration, never by forked definitions.

---

## 23. Invariants

1. Every catalog entity has a stable, immutable internal identity, never reused. Customer-facing slugs are immutable after publication; slug changes go through audited aliases (§4.2).
2. A service belongs to exactly one category; a variant to exactly one service; categories are first-class entities (§3).
3. An offering is bookable only when: category active ∧ entry `active` ∧ **explicitly branch-enabled** ∧ customer-visible (§12).
4. **Missing branch configuration means not offered** (§9). New catalog items are never automatically bookable at any branch.
5. Disabled or unoffered offerings are never bookable, never rendered publicly.
6. The catalog never calculates prices, tax, totals, or duration commitments, never encodes availability, and contains **no authoritative price or pricing-type data** (§6.7, §14).
7. Pricing and bookings reference catalog IDs, never names/slugs.
8. Branches configure; they do not fork catalog definitions.
9. Compatibility is an explicit allow-list backed by join-table data (§13); absence of an allow-list row means incompatible; booking validates against it; no code constants re-state it.
10. Every catalog mutation is authorized server-side and audited (§18, §19).
11. All catalog tables are organization- and branch-scoped with RLS from day one.
12. No city, region, or country name is hardcoded in catalog logic or seed behavior.
13. Historical bookings keep referencing archived identities; identities are never reused.

---

## 24. Security / Data Isolation

* Organization boundary: all catalog entities are organization-owned; cross-organization reads return no rows (RLS), regardless of known identifiers — same guarantees verified for branch data in OpenSpec Change 1's hosted verification.
* Branch boundary: branch-scoped roles see and configure only their branches (`membership_branches`); HQ roles operate organization-wide across branch-scoped catalog rows.
* Catalog data is `internal` classification in the data model of `LEGAL_COMPLIANCE.md` §8 — not personal data, but commercially sensitive; no public unauthenticated catalog API exists. Public exposure happens only through published branch website content (CMS), which references the catalog.
* The privileged DB path, `server-only` boundaries, and stable error codes follow the patterns established in Change 1 (`lib/db/server.ts`, `lib/errors.ts`).

---

## 25. Future Extensibility

Designed for, not implemented:

* **Recurring services / subscriptions** — a `Recurring Cleaning` variant label must not imply plan logic; recurring *plans* are a Phase-3 booking concern (`ROADMAP.md` §32).
* **Commercial contracts / enterprise accounts** — contract-scoped assortments can layer on branch configuration (`ROADMAP.md` §56).
* **Packages / bundles** — a package would reference existing service/variant identities; it must not be a hidden third hierarchy.
* **Promotions / discounts** — belong to pricing; the catalog only supplies the identities promotions may target.
* **Country-specific services** — expressed through branch/country configuration, not new entity types.
* **Different units of pricing** (per hour, per m², per item) — pricing engine concern; catalog stays unit-agnostic except that add-on quantity bounds (§6.4) already anticipate per-item selling.
* **HQ master catalog + branch-availability join** — the documented future evolution of §8.4; requires separate approval and must re-derive branch semantics (including §9 opt-in) explicitly.
* **AI tagging/alt-text, duplicate detection** — media concerns (`MEDIA_STORAGE.md` §75); catalog entities are just referenceable subjects.

Each future capability must pass the OpenSpec workflow and the prioritization framework (`ROADMAP.md` §60) before implementation.

---

## 26. Decisions & Remaining Open Questions

### 26.1 Decisions applied (2026-09-14, Service Catalog documentation review)

| ID | Decision | Where applied |
|---|---|---|
| Q1 | **Per-branch rows for MVP.** `DATABASE.md` §15 per-branch direction is authoritative; HQ-master + branch-configuration join is conceptual/future evolution only; no master+join physical tables in Change 2 unless separately approved. | §2, §8.4, §9, §20.1, §25 |
| Q2 | **Missing branch configuration = NOT OFFERED.** Branches explicitly opt in; a newly created catalog item never automatically becomes customer-bookable at any branch. | §4.4, §8.1–8.5, §9, §12, §15, §20.2, §23-4 |
| Q3 | **Explicit allow-list compatibility via join-table relationship.** No scattered code constants; compatibility is catalog data enforced during booking validation; absence = incompatible. | §6.2–6.3, §13, §19, §20.1, §21, §23-9 |
| Q4 | **First-class `service_categories` entity** is the target domain model; `DATABASE.md` §15.1 `service_type` flagged as documentation/schema alignment for the implementing OpenSpec change. | §2.1, §3, §20.1, §20.3 |
| Q5 | **Pricing responsibility removed from the catalog** — no authoritative price/pricing-type data; `DATABASE.md` §15.4 flagged as alignment obligation. | §1.2, §2.4, §6.1, §6.7, §14, §20.1, §20.3, §23-6 |
| Q6 | **V1 catalog content not invented.** Structure defined; documented candidate pool marked non-authoritative; business approval required before seed data. | §7 |
| Q7 | **Customer-facing slugs immutable after publication;** changes only via audited redirect/alias mechanism; internal identity and URL slug are distinct concepts. | §4.2, §5.3, §11, §19, §20.1, §21, §23-1 |

### 26.2 Remaining items requiring a decision before OpenSpec Change 2

* **a — V1 catalog content (business approval, per Q6).** The concrete category/service/variant/add-on list, the placement of the four documented names (§7.3 — they appear as both services and categories in the sources), locale coverage, compatibility allow-lists, and quantity bounds. The structure is defined in §7; the content is not.
* **b — Permission granularity (optional).** Whether the single `services.edit` permission is acceptable for v1 or whether "edit catalog definitions" and "configure branch offering" should be split. Current catalog is sufficient; a split requires extending `SECURITY.md` §14 first (§18).
* **c — Platform-default rows (minor).** `DATABASE.md` §15 permits `branch_id` to be nullable for organization-wide platform defaults. Whether v1 actually uses nullable platform-default rows or requires `branch_id` on every row should be settled when the Change 2 spec is drafted (a schema detail, not an architectural conflict).

---

## 27. Admin UI Implementation Status (Change 10 — `create-config-admin-ui`)

The catalog administration surface described in §§1–26 is exposed to staff as
of OpenSpec Change 10 under the Change 8 admin shell:

* `/admin/services` renders the `EffectiveCatalog` tree
  (category → service → variant → addon plus standalone addons) and consumes
  **only** the existing services actions: `create*/update*` draft-field
  editing, `changeStatusAction` (draft/active/archived lifecycle incl. the
  archive guard and activation preconditions), `setOfferingStateAction`
  (`is_enabled`/`is_customer_visible` — separate from lifecycle, Q2),
  `reorderCatalogAction`, `setAddonCompatibilityAction`/
  `removeAddonCompatibilityAction` (Q3), `findOrphanedAddonsAction`
  (§26/Q2 orphans surfaced, never hidden), and `renamePublishedSlugAction`
  (Q7 alias mechanism). Mutations require `services.edit`
  (`requireHqActor` server-side).
* Translation editing (`upsertTranslationAction`) is intentionally **not**
  exposed (BD-E3d — display-only fallback via the read model); seed tools
  (`seedCatalogAction`) remain script/hosted-only (BD-E3e).
* No migration, no new permissions, no RLS change.
