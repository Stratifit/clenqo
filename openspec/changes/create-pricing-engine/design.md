# Design: Pricing Engine (Change 4A)

**Status:** Documentation/design only — no implementation has occurred. Migration 0010,
`features/pricing/`, and tests are created only after this change is approved and BUILD MODE
begins.

**Normative source:** the approved decision record **P1–P22** (2026-09 decision round),
reproduced in §1. Where wording below and the decision record could diverge, the record wins.

## 1. Approved decision record (normative)

| ID | Decision |
|---|---|
| P1 | Pricing rules belong to an immutable pricing version; published versions and their rules are never mutated; revisions are new versions. |
| P2 | Single canonical money pipeline: duration × rate × difficulty + add-ons + surcharges − discounts + tax. Service-specific behavior via typed rule rows and configurable duration behavior. No alternative money pipelines. |
| P3 | Engine + configuration structure + idempotent per-branch seed skeleton ship now. Production business values only from an approved business value sheet. All tests use explicit non-production fixtures. |
| P4 | Difficulty is explicit per-service configuration in the version (Light/Medium/Heavy levels reserved; multiplier values from the value sheet). Per-booking override deferred. |
| P5 | Active V1 surcharge: Sunday only. Night/Emergency/Holiday structures reserved but inactive while S10/S13/S9b hold. |
| P5b | Stacking: highest applicable surcharge only in V1 (explicit configuration per §23). |
| P6 | No discounts in V1. Discount stage defined but inert; snapshot schema accommodates future entries without schema change. |
| P7 | Single configured tax rate + jurisdiction label per version. No tax classes. |
| P7b | Tax jurisdiction/rate deferred to the business value sheet. |
| P8 | Currency stored per profile (EUR at launch), validated against configuration, never hardcoded in code paths. |
| P9 | Minimum-charge and minimum-billable-duration structures exist in version configuration, none active in V1. Minimums affect money ONLY; Scheduling always consumes actual estimated duration. |
| P10 | calculated_price services only. fixed_price / starting_from / quote_required and the assessment/call-out-fee workflow deferred. Display-mode metadata lives in pricing configuration, never catalog rows (Q5). |
| P11 | V1 resolution selects the branch's single active published profile; schema permits more; service/customer mapping deferred. |
| P12 | Pricing is branch-owned (`branch_id NOT NULL`). PR-005 "Global Default Pricing" is realized as an idempotent per-branch seed template. Org-level shared rows deferred. |
| P13 | `calculateQuote` is stateless. No quote entity is persisted. Booking confirmation recalculates authoritatively and stores the snapshot (S16 stage 5, Change 4B). |
| P14 | Monetary components in currency minor units; half-up rounding applied exactly once per component; total = exact component sum; decimal-safe intermediate arithmetic; duration in whole minutes (§14). |
| P15 | Tax-exclusive storage: net components + explicit tax component; gross total = their exact sum; presentation follows locale/compliance configuration. |
| P16 | Version lifecycle draft → published → archived enforced by DB constraints + status guards; published versions immutable; §47 validation set executed transactionally at publish. |
| P17 | Applicable version = published version whose effective period contains the scheduled service date (§49). Overlapping published effective periods per profile rejected by constraint; latest `effective_from` is the documented secondary rule. |
| P18 | `seedPricingDefaults(branchId)` — idempotent, integrated with branch provisioning, mirroring `seedSchedulingDefaults`. |
| P19 | No UI in this change: domain services, Zod schemas, server actions, migration, seed, tests only. |
| P20 | Role mapping (existing `pricing.*` family only, no new names): HQ admin — full `pricing.*` (override HQ-only; override flow NOT implemented in V1); HQ staff — `pricing.view`; branch managers — view/create/edit/publish/archive within branch scope; cleaners — none. |
| P21 | Pricing is the single duration authority, sharing its rule engine with `calculateQuote`. Scheduling consumes it through the existing `DurationProvider` seam; `placeholderDurationProvider` is deleted in this change. |
| P-D1 | The duration input contract carries typed optional `propertyDetails`; duration rules declare which factors they consume; missing details are a validation error only where the service's rules require them. |

## 2. Domain boundary

Catalog = sellability · Pricing = price + duration · Scheduling = availability/capacity/
conflicts/holds · Booking = quote consumption + snapshot storage · Worker = eligibility/
assignment. Pricing never determines availability, creates bookings, creates holds, or selects
workers; it never writes catalog rows.

## 3. Data model (conceptual; implemented by migration 0010)

UUID PKs, `organization_id` + `branch_id NOT NULL` everywhere (P12, Q9), `timestamptz` UTC,
audit columns per §43 conventions.

### 3.1 `pricing_profiles`
Grouping container. Fields: `id`, `organization_id`, `branch_id` (composite same-branch FK
convention), `name`, `description`, `currency` (CHECK against configured currency list; EUR at
launch), `status` (draft/active/archived CHECK), `sort_order`, `created_at`, `updated_at`.
Mutable. Indexes `(branch_id)`, `(status)`.

### 3.2 `pricing_versions`
The immutable published unit (P1). Fields: `id`, `organization_id`, `branch_id`,
`pricing_profile_id` (same-branch composite FK), `version_number` (unique per profile),
`status` (draft/published/archived CHECK), `effective_from date NOT NULL`,
`effective_until date` (nullable open end), `published_at`, `created_at`, `updated_at`.
Constraints: uniqueness per `(pricing_profile_id, version_number)`; partial unique index
enforcing at most one overlapping published effective window per profile (P17 — pattern
consistent with 0008/0009); CHECK `effective_until IS NULL OR effective_until >= effective_from`.
Immutability: UPDATE/DELETE of published rows rejected by status guards (trigger-free guards of
the 0009 style; enforcement detail at implementation, verification by tests).

### 3.3 `pricing_rules`
Attached to versions (P1). Fields: `id`, `organization_id`, `branch_id`, `pricing_version_id`
(same-branch composite FK), `rule_type` (CHECK: `base_rate`, `duration_rule`, `difficulty`,
`addon_price`, `surcharge`), target refs `service_id` / `service_variant_id` / `service_addon_id`
(nullable per rule semantics; composite same-branch FKs to catalog tables), `min_value`/
`max_value` (numeric, property-factor scoping), `multiplier` numeric, `fixed_amount` numeric
CHECK ≥ 0, `configuration` jsonb (Zod-validated per `rule_type` — duration-rule consumed
factors, surcharge model percentage|fixed, stacking flag), `created_at`, `updated_at`.
No pricing data ever written to catalog tables (Q5). Indexes `(pricing_version_id)`,
`(branch_id)`, target-ref indexes.

No snapshot columns here: `pricing_version_id` + `pricing_snapshot` live on future `bookings`
(Change 4B). No quote table exists (P13).

## 4. Canonical calculation pipeline (P2, P14, P15)

Deterministic function of explicit inputs (no wall-clock reads — the scheduling explicit-`now`
pattern). Stage order (§24):

1. Resolve profile — branch's single active published profile (P11).
2. Resolve version — published, effective period contains the scheduled service date (P17, §49).
3. Validate inputs (Zod §56): catalog identities exist and belong to the same branch;
   property details present where the service's duration rules require them (P-D1).
4. Compute duration (minutes, §14) from the version's duration rules; distinguish actual
   estimated vs minimum billable duration (§17) — Scheduling always receives the ACTUAL value (P9).
5. Base = actual_duration × hourly_rate × difficulty_multiplier (P4).
6. Add-ons: eligibility validated (§19), priced per configured method (§18), duration
   contributions included in step 4's inputs (§20).
7. Minimum-charge application point: if active, raise the pre-tax subtotal and record in the
   breakdown (§16) — structure exists, INACTIVE in V1 (P9).
8. Surcharges: Sunday evaluated against the scheduled date/time in the branch timezone (§50);
   model percentage|fixed; stacking = highest applicable only (P5, P5b). Night/Emergency/
   Holiday stages defined but INACTIVE (P5).
9. Discounts: stage defined but INACTIVE — contributes zero (P6).
10. Tax: single configured rate + jurisdiction (P7); tax-exclusive — tax component added last
    to the net subtotal (P15). INACTIVE until the value sheet provides the rate (P7b); a
    version without tax configuration yields explicit zero-tax results.
11. Rounding: minor units, half-up, exactly once per component; total = exact component sum (P14).

### Stage activity matrix (approved V1)

| Stage | Active? | Notes |
|---|---|---|
| Base (rate × duration × difficulty) | YES | values from value sheet only (P3) |
| Duration rules | YES | structure live; values pending (P3) |
| Add-on pricing | YES | values pending (P3) |
| Minimum charge / min duration | STRUCTURE ONLY | inactive (P9) |
| Sunday surcharge | YES | percentage pending value sheet (P5, P3) |
| Night / Emergency / Holiday surcharge | STRUCTURE ONLY | inactive (P5; S10/S13/S9b) |
| Discounts | STRUCTURE ONLY | inactive (P6) |
| Tax | STRUCTURE ONLY | inactive until P7b value (P7/P7b) |

## 5. Result contract (§33)

`calculateQuote(input) → { currency, duration_minutes, actual_duration_minutes,
base_amount, addon_amount, surcharge_amount, discount_amount, tax_amount, subtotal, total,
pricing_profile_id, pricing_version_id, breakdown, snapshot_source }`.
`snapshot_source` carries exactly the §16.3 members Booking will store: profile id, version id,
version number, `inputs`, `rules_applied`, `result`. Determinism (§34): identical version +
inputs + context ⇒ identical result. Statelessness (P13): no persistence, no quote IDs.

## 6. Duration authority (P21, P-D1)

`features/pricing/` exposes a duration resolver sharing the quote rule engine (no money
computed). Scheduling's `DurationProvider` seam keeps its interface; the real provider is
implemented and wired in scheduling actions; `placeholderDurationProvider` is deleted. The
`DurationSelection` type gains optional typed `propertyDetails` (Zod-validated); duration
rules declare consumed factors (e.g. `rooms`, `bathrooms`, `floor_area`, `condition`); missing
details error only where required. Exactly one duration authority survives.

## 7. Errors (§58, Zod §56)

`pricing_profile_not_found`, `pricing_version_not_found`, `service_not_priced`,
`invalid_addon`, `invalid_input`, `pricing_configuration_invalid`, `currency_mismatch` —
stable domain errors; customer-facing messages stay understandable (BOOKING §87).

## 8. Authorization, RLS, audit

- Permissions (P20): existing `pricing.view/create/edit/publish/archive/override` only;
  mapping per §1; authorization before business logic (SECURITY §32–33); no new names.
- RLS: enabled in 0010 on all three tables, one combined policy each via the 0006 SECURITY
  DEFINER helpers (`get_membership_role` org-wide for HQ, `has_branch_access` for branch
  roles), owner-exemption, no FORCE — the 0007/0008/0009 pattern.
- Audit: transactional fail-closed `pricing.created/updated/published/archived`
  (`resource.action` dotted format, MEDIUM-1) with actor/organization/branch/request-id/bounded
  redacted metadata. Published-version immutability and lifecycle guards verified by tests.

## 9. Seed (P18, P3)

`seedPricingDefaults(branchId)`: idempotent structure provisioning (one active profile, one
draft version skeleton, rule scaffolding) integrated with branch provisioning. NO production
values. Hosted verification may exercise the engine only with explicit non-production fixture
values.

## 10. Testing strategy

- Unit: determinism (same inputs ⇒ same result), rounding (per-component half-up, sum
  invariant), effective-date selection incl. boundary dates, precedence order, difficulty
  configuration, add-on pricing methods, Sunday surcharge + highest-applicable, tax-exclusive
  arithmetic, inactive stages yield zero, minimum structures money-only.
- pglite domain tests: config CRUD + authorization boundaries (P20 mapping, cross-branch
  denial), version lifecycle (publish validation §47, immutability, overlap rejection),
  seed idempotency, audit fail-closed.
- Migration/RLS tests: chain 0001→0010 applies cleanly; constraints; RLS isolation.
- Duration authority: real provider returns rule-derived durations; scheduling wiring tests;
  placeholder deletion verified by absence.
- Regression: full local suite + hosted suite remain green (Changes 1–3 untouched except the
  provider wiring).
- All money fixtures explicitly labeled non-production (P3).
