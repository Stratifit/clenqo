# Proposal: Service Catalog & Branch Service Configuration

**Change ID:** `create-service-catalog`
**Status:** Archived (completed 2026-09-14 — commit `2cc874a`; hosted Supabase verification 12/12 PASS). Note: task 12.4 (authoring concrete V1 catalog content) remains intentionally pending business approval per decision Q6 — the seed mechanism is structure-only by design.
**Roadmap phase:** Phase 1 — Core Booking Platform, Services (`ROADMAP.md` §9)
**Priority:** P1 — required before branch activation can ever succeed (the
readiness checklist implemented in Change 1 counts `active` services per
branch; `features/branches/activation.ts`) and before any pricing/booking work
can begin.

---

## Problem

The platform can create and provision branches (Change 1, archived), but a
provisioned branch has **nothing sellable**: the services domain does not
exist. Concretely:

* `DATABASE.md` §15 defines a services model, but it contradicts the approved
  Service Catalog architecture in two places: category is modeled as a
  `service_type` field on `services` instead of a first-class entity, and
  `service_addons` carries `pricing_type` / `default_price`, placing pricing
  responsibility inside the catalog.
* No tables exist for service categories, service/variant/add-on
  translations, add-on compatibility, or published-slug aliases.
* Branch configuration semantics (what a branch offers) are undefined in
  schema terms: `DATABASE.md` §15 permits nullable `branch_id` platform
  defaults, while the approved decision (Q9) requires explicit `branch_id` on
  every V1 row.
* The activation readiness gate can never pass because no service rows can
  exist.

## Motivation

Implement the **Service Catalog** capability exactly as decided in
`docs/SERVICE_CATALOG.md` (decisions Q1–Q9, 2026-09-14 review): the catalog
defines **WHAT** CLENQO sells — never **HOW MUCH** (Pricing Engine), **WHEN**
(Scheduling), or **WHO** (Workers). This change creates the schema, domain
operations, and branch-offering configuration so that:

* approved V1 catalog content can later be seeded deterministically (Q6 —
  content itself is **not** invented here);
* the pricing engine can reference stable catalog identities
  (`PRICING_ENGINE.md` §12–14);
* the booking engine can consume the effective branch catalog with
  compatibility validation (`BOOKING_SYSTEM.md` §8–11);
* branch activation readiness can eventually be satisfied.

## Scope

* **New capability** `service-catalog`:
  * First-class `service_categories` entity (Q4).
  * Services with first publication slug-freezing and audited alias/redirect
    mechanism (Q7); immutable internal identity.
  * Service variants and add-ons per `docs/SERVICE_CATALOG.md` §5–6.
  * Explicit **allow-list** add-on compatibility via a join-table relationship
    (Q3); absence = incompatible; no block-list; no code constants.
  * Per-branch catalog rows (Q1) with **explicit `branch_id` on every row**
    (Q9) and opt-in branch offering: missing configuration = NOT OFFERED (Q2).
  * Localization via `(entity_id, locale)` translation tables for categories,
    services, variants, add-ons (de/en/fr/es extensible).
  * Catalog lifecycle `draft → active → inactive → archived` with audited
    transitions.
  * HQ admin operations (create/update/lifecycle/compatibility/slug-rename)
    and branch configuration operations (enable/disable/reorder/visibility) —
    all server-side, authorized with the existing `services.view` /
    `services.edit` permissions only (Q8).
  * Transactional `resource.action` audit events (§19 of the source doc).
  * RLS on every new table, organization + branch scoped.
  * Idempotent, version-controlled seed mechanism — **structure only**;
    concrete V1 rows require separate business approval (Q6).
* **Documentation synchronization** (explicit obligation of this change):
  * `DATABASE.md` §15.1 — replace the `service_type` field model with the
    first-class `service_categories` entity (Q4).
  * `DATABASE.md` §15.4 — remove `pricing_type` / `default_price` as
    authoritative catalog pricing (Q5).
  * `DATABASE.md` §15 scope note — require `branch_id` on every catalog row
    in V1 (Q9).
  * Affected `SECURITY.md` / `API_STANDARDS.md` / `AUDIT_SYSTEM.md` wording
    only where it directly conflicts with the implemented capability.

## Non-goals

* No pricing engine, rates, profiles, or price snapshots (`PRICING_ENGINE.md`
  is a future change; the catalog exposes identities only).
* No booking flow, availability, or scheduling.
* No worker skills/capability records (one-way reference is designed for,
  §25 of the source doc; not implemented).
* No CMS presentation of services beyond what Change 1 seeded (service pages
  stay draft placeholders).
* **No concrete V1 commercial catalog content** — the
  "V1 Catalog — Pending Business Approval" section of
  `docs/SERVICE_CATALOG.md` §7 remains the gate; this change ships the seed
  *mechanism*, not invented business content (Q6).
* No master-catalog / branch-join architecture (Q1: future separate change).
* No new permission names (Q8) and no customer-facing UI beyond what admin
  screens require.

## Dependencies

* **Change 1 `create-branch-provisioning` (archived)** — provides
  organizations/branches, identity, RLS helpers, audit, observability, and the
  migration/test infrastructure this change builds on.
* **Approved decisions Q1–Q9** — recorded in `docs/SERVICE_CATALOG.md` §26.1.
* **Business approval of V1 catalog content** — required before seed rows are
  authored (tasks mark this explicitly); not a blocker for schema/domain work.

## Relationship to branch-management

* Extends the live `openspec/specs/branch-management/spec.md` contract
  without modifying it: catalog rows are branch-scoped data created *after*
  provisioning, consumed by the existing readiness checklist
  (`services` item becomes satisfiable once this change ships active services).
* Activation itself remains outside this change; this change only makes the
  `services` readiness item achievable.

## Relationship to future pricing / booking / scheduling / workers

| Domain | Consumes from this change |
|---|---|
| **Pricing** (future change) | Stable `service_id` / `service_variant_id` identities for `pricing_rules`; catalog carries no prices (Q5) |
| **Booking** (future change) | Effective branch catalog read model (`listEffectiveCatalog`), `validateSelection` (allow-list compatibility + quantity bounds), booking items referencing catalog IDs |
| **Scheduling** (future change) | Service/variant selection as duration inputs; catalog stores no availability |
| **Workers** (future change) | One-way skill → service-identity references; catalog never references workers |

All downstream domains must consume this catalog read-only through the
specified contracts; none may duplicate catalog data.

## Impact

* **Affected specs:** new capability spec
  `openspec/specs/service-catalog/spec.md` (created on archive).
* **Affected code areas (future):** `features/services/` (schemas, service,
  actions), `features/branches/` (branch-configuration operations),
  migrations `0008+`, RLS additions, admin UI for catalog + branch offering.
* **Affected docs (synchronized during implementation, per the DATABASE
  ALIGNMENT mandate):** `DATABASE.md` §15.1 (Q4), §15.4 (Q5), §15 scope note
  (Q9); minor alignment touches to `SECURITY.md`/`API_STANDARDS.md`/
  `AUDIT_SYSTEM.md` only where wording conflicts with the implemented
  capability.
* **Out of scope:** pricing, booking, scheduling, workers, CMS service-page
  content, concrete commercial seed content, master-catalog evolution.
