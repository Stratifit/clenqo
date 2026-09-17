## ADDED Requirements

### Requirement: Authoritative deterministic price calculation

The Pricing Engine SHALL compute prices server-side as a deterministic function of the
pricing version, explicit inputs, and date/time context (PRICING_ENGINE §34; P2, P13, P14).
Identical inputs SHALL produce identical results. No client-supplied price SHALL ever be
trusted or stored.

#### Scenario: Deterministic quote
* **WHEN** `calculateQuote` runs twice with identical version and inputs
* **THEN** both results are identical in every component and in `pricing_version_id`

#### Scenario: Client price never trusted
* **WHEN** a client submits a price value with a booking request (Change 4B)
* **THEN** the authoritative price is recalculated server-side and the client value is ignored

### Requirement: Single canonical pipeline with approved stage activity

Calculation SHALL follow the canonical pipeline: duration × rate × difficulty + add-ons +
surcharges − discounts + tax (P2), with stage activity exactly per the approved matrix:
base/duration/add-ons/Sunday active; minimums, Night/Emergency/Holiday surcharges, discounts,
and tax structures present but inactive in V1 (P3–P9, P5b).

#### Scenario: Inactive stage contributes zero
* **WHEN** a quote is calculated in V1
* **THEN** discount_amount and tax_amount are 0 and no Night/Emergency/Holiday surcharge
  component appears, regardless of date/time

#### Scenario: Sunday surcharge applied by branch-local date
* **WHEN** the scheduled service date is a Sunday in the branch timezone (§50)
* **THEN** the configured Sunday surcharge (value from the business value sheet) is the
  surcharge component

### Requirement: Immutable versioned configuration

Rules SHALL belong to immutable pricing versions (P1); lifecycle draft → published → archived
SHALL be DB-enforced with published immutability (P16); the applicable version SHALL be the
published version whose effective period contains the scheduled service date, with overlapping
published windows per profile rejected and latest `effective_from` as the documented secondary
rule (P17).

#### Scenario: Published version immutable
* **WHEN** an update is attempted against a published version or its rules
* **THEN** the operation is rejected and the version remains unchanged

#### Scenario: Effective-date selection
* **WHEN** two published versions have non-overlapping effective windows and a quote is
  requested for a date inside the second window
* **THEN** the quote reports the second version's `pricing_version_id`

#### Scenario: Overlapping publish rejected
* **WHEN** publishing a version whose effective window overlaps an already-published version
  of the same profile
* **THEN** the publish fails with a validation error and no state changes

### Requirement: Tax-exclusive money handling

Monetary components SHALL be computed in currency minor units with half-up rounding applied
exactly once per component; the total SHALL equal the exact component sum; storage SHALL be
tax-exclusive with an explicit tax component (P14, P15). Negative amounts SHALL be rejected
(§69–70).

#### Scenario: Breakdown sums to total
* **WHEN** any quote is calculated
* **THEN** base + addons + surcharge − discount + tax equals total exactly at minor-unit
  precision

### Requirement: Minimums affect money only

Minimum-charge and minimum-billable-duration structures SHALL exist in version configuration
but SHALL be inactive in V1 (P9); when active in the future they SHALL affect money only, and
the duration exposed to Scheduling SHALL always be the actual estimated duration.

#### Scenario: Scheduling duration independent of minimums
* **WHEN** a minimum billable duration exceeds the estimated duration in a future activation
* **THEN** the duration resolver still returns the actual estimated duration to Scheduling

### Requirement: Stateless quotes

`calculateQuote` SHALL be stateless (P13): no quote entity, no quote IDs, no persistence. The
booking confirmation transaction SHALL recalculate authoritatively and store
`pricing_version_id` + single `pricing_snapshot` (jsonb with `inputs`, `rules_applied`,
`result`) — the canonical model of DATABASE §16.3 (storage arrives with Change 4B).

#### Scenario: No quote artifacts persist
* **WHEN** quotes are calculated repeatedly
* **THEN** no quote rows, counters, or identifiers are created in any table

### Requirement: Single duration authority shared with Scheduling

Pricing SHALL be the only duration authority (P21); the duration resolver SHALL share the
quote rule engine; Scheduling SHALL consume it through the existing `DurationProvider` seam
and `placeholderDurationProvider` SHALL be deleted. The duration contract SHALL carry typed
optional `propertyDetails`, with rules declaring consumed factors and missing-details errors
only where required (P-D1).

#### Scenario: Placeholder gone
* **WHEN** the scheduling actions resolve availability
* **THEN** duration is produced by the pricing rule engine and no placeholder provider exists

#### Scenario: Property-aware duration
* **WHEN** a service's duration rules consume room/bathroom factors and a quote or slot
  request supplies propertyDetails
* **THEN** the computed duration reflects those factors; missing required details produce a
  validation error

### Requirement: Catalog read-only boundary

Pricing SHALL read catalog identities for rule targeting and validation only, and SHALL NOT
modify catalog rows or store pricing data in catalog tables (Q5); catalog sellability
remains owned by the catalog.

#### Scenario: No catalog mutation
* **WHEN** any pricing operation executes
* **THEN** catalog tables are unchanged

### Requirement: Branch isolation, RLS, and existing permissions

All pricing tables SHALL be organization/branch scoped with RLS enabled from the creation
migration (0006 definer helpers, no FORCE) (P12); authorization SHALL use only the existing
`pricing.*` family with the approved mapping (P20); no new permission names SHALL be
introduced.

#### Scenario: Cross-branch denial
* **WHEN** a branch manager of branch A attempts to read or mutate branch B's pricing
* **THEN** the request is denied or invisible via RLS

#### Scenario: Approved mapping enforced
* **WHEN** a cleaner attempts any pricing mutation
* **THEN** the request is denied server-side

### Requirement: Transactional audit for pricing mutations

Every pricing configuration mutation SHALL write transactional fail-closed
`resource.action` audit events (pricing.created/updated/published/archived) with actor,
organization, branch, request ID, and bounded redacted metadata.

#### Scenario: Publish audited
* **WHEN** a version is published
* **THEN** a pricing.published audit event exists in the same transaction

### Requirement: Idempotent branch pricing seed

A `seedPricingDefaults` operation SHALL provision per-branch pricing structure idempotently
and integrated with branch provisioning (P18), containing structure only — production
business values SHALL come exclusively from a separately approved business value sheet (P3),
and all test fixtures SHALL use explicit non-production values.

#### Scenario: Seed idempotency
* **WHEN** the seed runs twice for a branch
* **THEN** row counts and values are identical to a single run and contain no production
  money values

### Requirement: V1 scope exclusions

V1 SHALL NOT implement: booking creation or snapshot storage (Change 4B), availability/hold
behavior changes beyond provider wiring, worker selection, payments/invoices, UI (P19),
promotion codes, active discounts (P6), external tax providers, assessment/quote-required or
fixed_price/starting_from modes (P10), and org-level shared pricing rows (P12).

#### Scenario: No UI surface exists
* **WHEN** the pricing change is delivered
* **THEN** no `app/` route or component references pricing functionality
