# Pricing Engine

**Capability:** `pricing-engine`
**Status:** Active capability
**Established by:** `openspec/archive/create-pricing-engine/` (implemented 2026-09-17, commit `12b27bc`; hosted Supabase verification 11/11 PASS, full hosted suite 54/54 PASS)
**Sources:** `PRICING_ENGINE.md` §82, `DATABASE.md` §16/§64/§65, `API_STANDARDS.md` §27, `REQUIREMENTS.md` PR-005, `SCHEDULING_SYSTEM.md` S6/§86, `SECURITY.md`, `SERVICE_CATALOG.md` Q5

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.
Requirement wording is normative and testable; WHERE/THEN scenarios are
acceptance criteria. The authoritative V1 decision record is P1–P22 (+P-D1);
no production money values are approved yet (P3 — structure now, values later
via a separate business value sheet).

## Requirement: Authoritative deterministic price calculation

The Pricing Engine SHALL compute prices server-side as a deterministic function of the
pricing version, explicit inputs, and date/time context (PRICING_ENGINE §34; P2, P13, P14).
Identical inputs SHALL produce identical results. No client-supplied price SHALL ever be
trusted or stored.

#### Scenario: Deterministic quote
* **WHEN** `calculateQuote` runs twice with identical version and inputs
* **THEN** both results are identical in every component and in `pricing_version_id`

## Requirement: Single canonical pipeline with approved stage activity

Prices SHALL be produced by one canonical pipeline: duration × rate × difficulty
+ add-ons + surcharges − discounts + tax. In V1 the active stages are duration,
base rate, difficulty, add-ons, and the Sunday surcharge; minimum charge,
minimum billable duration, night/emergency/holiday surcharges, discounts, and
tax remain structure-only until approved business values exist (P2–P9).
Surcharge stacking is highest-applicable-only (P5b). Minimums affect money
only and never inflate Scheduling's duration (P9).

#### Scenario: Sunday surcharge applies, highest only
* **WHEN** a quote is calculated for a Sunday with a published Sunday-surcharge rule
* **THEN** exactly one surcharge component is applied, computed from the highest
  applicable surcharge, and the total equals the exact sum of components

#### Scenario: Inactive stage produces zero component
* **WHEN** a quote is calculated while discount/tax/minimum business values are unapproved
* **THEN** the corresponding components are zero/null and the snapshot records the
  stage as inactive rather than omitting it

## Requirement: Immutable versioned configuration

Pricing rules SHALL attach to immutable pricing versions (P1). A published
version SHALL NOT be editable or deletable; the only lifecycle transition is
publish → archive, enforced by DB constraints and triggers (P16). Publishing
requires the §47 validation set; overlapping published effective windows per
profile SHALL be rejected (P17); version selection resolves by branch, active
profile, and scheduled service date.

#### Scenario: Published version immutable
* **WHEN** a direct UPDATE or DELETE targets rules of a published or archived version
* **THEN** the database rejects the mutation

#### Scenario: Overlapping published windows rejected
* **WHEN** a second version with an effective window overlapping a published one is published in the same profile
* **THEN** the publish is rejected with a stable configuration error

## Requirement: Tax-exclusive money handling

All money SHALL be represented in currency minor units with half-up rounding
applied exactly once per component, the total equal to the exact component
sum, and tax-exclusive storage with an explicit tax component (P14, P15,
P8 — currency configuration-driven, EUR at launch).

#### Scenario: Component sum invariant
* **WHEN** any quote is calculated
* **THEN** base + addons + surcharges − discounts + tax equals `total` exactly

## Requirement: Single duration authority shared with Scheduling

Pricing SHALL be the single duration authority (P21). `calculateQuote` and
the scheduling `DurationProvider` seam SHALL share one duration-rule engine.
`DurationSelection` accepts typed optional `propertyDetails` validated with
Zod; duration rules declare their consumed factors and missing required
details produce a validation error (P-D1). Scheduling performs no duration
calculation of its own.

#### Scenario: Missing required property details rejected
* **WHEN** a duration rule declares a consumed factor and the request omits it
* **THEN** a stable validation error is raised, not a default duration

## Requirement: Catalog read-only boundary

The Pricing Engine SHALL read catalog identities (service/variant/add-on) and
SHALL NOT modify them; catalog owns sellability, Pricing owns price and
duration (Q5, SERVICE_CATALOG §Q5). Pricing creates no bookings, holds, or
worker selections.

#### Scenario: Cross-branch catalog rule rejected
* **WHEN** a pricing rule references a catalog entity of a different branch
* **THEN** creation is rejected via the same-branch composite foreign keys

## Requirement: Branch isolation, RLS, and existing permissions

All pricing tables SHALL carry `organization_id` + `branch_id` NOT NULL with
same-branch composite FKs and RLS using the established 0006 definer helpers
without FORCE (P12). Authorization uses only the existing `pricing.*`
permission family per the approved P20 role mapping (HQ admin: full family;
HQ staff: `pricing.view`; branch managers: view/create/edit/publish/archive
within branch scope; cleaners: none). The `pricing.override` flow is not
implemented in V1.

#### Scenario: Cross-org invisibility
* **WHEN** an authenticated user of another organization queries pricing rows
* **THEN** no rows of the foreign organization are visible or writable

#### Scenario: Branch-scope enforcement
* **WHEN** a branch manager acts on another branch within the same organization
* **THEN** the action is denied by the authorization layer

## Requirement: Transactional audit for pricing mutations

Pricing mutations SHALL write dotted audit events (`pricing.created`,
`pricing.updated`, `pricing.published`, `pricing.archived`) transactionally;
a failing audit write SHALL abort the mutation (fail-closed, established
audit convention).

#### Scenario: Audit failure blocks the mutation
* **WHEN** the audit write fails during a pricing mutation
* **THEN** the mutation rolls back and no partial state persists

## Requirement: Idempotent branch pricing seed

`seedPricingDefaults(branchId)` SHALL be idempotent, branch-owned, and
structure-only: it creates the draft profile/template version but never any
rule values (P18, P3). No production money values are ever seeded.

#### Scenario: Repeated seed run
* **WHEN** `seedPricingDefaults` runs twice for the same branch
* **THEN** the second run inserts nothing new and reports idempotent results

## Requirement: V1 scope exclusions

The capability SHALL NOT implement: a pricing UI (P19), the
`pricing.override` flow, the assessment/quote-required path (P10), active
discounts (P6), external tax providers, booking creation, slot holds, or
worker assignment. Production pricing values require a separately approved
business value sheet (P3, P7b).

#### Scenario: No pricing UI surface
* **WHEN** the implementation is inspected for admin/customer pricing screens
* **THEN** none exist; pricing is exercised only through server actions/domain services
