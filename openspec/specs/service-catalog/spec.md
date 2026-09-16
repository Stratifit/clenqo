# Service Catalog & Branch Service Configuration

**Capability:** `service-catalog`
**Status:** Active capability
**Established by:** `openspec/archive/create-service-catalog/` (implemented 2026-09-14, commit `2cc874a`; hosted Supabase verification 12/12 PASS)
**Sources:** `SERVICE_CATALOG.md`, `DATABASE.md`, `SECURITY.md`, `API_STANDARDS.md`, `AUDIT_SYSTEM.md`, `LOCALIZATION.md`, `BOOKING_SYSTEM.md` §8–11

The requirements below are the current capability contract, promoted from the
archived change. Future changes to this capability modify this file as deltas.
Requirement wording is normative and testable; WHERE/THEN scenarios are
acceptance criteria.

## Requirement: First-class service categories

The system SHALL model service categories as a first-class entity
(`service_categories`) with stable identity, branch-scoped slug, lifecycle
status, ordering, and translations (decision Q4). A service SHALL belong to
exactly one category. The former `service_type` field model of
`DATABASE.md` §15.1 SHALL be superseded by this entity during implementation.

#### Scenario: Category created and used

* **WHEN** an authorized HQ user creates a category with valid slug and
  default-locale name
* **THEN** the category exists with `status = draft`, disabled and not
  customer-visible, and can be assigned as the single category of a service

#### Scenario: Category with services cannot be hard-deleted

* **WHEN** archive is requested for a category that still has attached
  services that are not archived
* **THEN** the operation is rejected; the category can only be archived when
  its services are moved or archived first

## Requirement: Per-branch catalog rows with explicit branch ownership

Every catalog entity (category, service, variant, add-on) SHALL exist as a
branch-owned row with `branch_id` NOT NULL and `organization_id` set from the
authenticated context (decisions Q1, Q9). The platform SHALL NOT create
master + branch-join catalog structures in this change, and SHALL NOT use
nullable `branch_id` platform-default rows.

#### Scenario: No platform-default rows

* **WHEN** any catalog table is inspected after creation or seeding
* **THEN** every row has a non-null `branch_id` referencing a branch of the
  row's organization

#### Scenario: Branch creation does not auto-offer catalog entries

* **WHEN** a new branch is provisioned (Change 1 pipeline)
* **THEN** no catalog rows are auto-created for it by this capability; and
  when catalog rows are later created for the branch they are disabled and
  not customer-visible (decision Q2)

## Requirement: Opt-in branch offering

A catalog entry SHALL be offered by a branch only when explicitly enabled
(`is_enabled = true`); missing or disabled offering state SHALL mean NOT
OFFERED (decision Q2). A newly created catalog entry SHALL be disabled and
not customer-visible. No operation SHALL implicitly enable entries at any
branch.

#### Scenario: New service is not bookable anywhere by default

* **WHEN** an HQ user creates a service (even with `status = active` allowed
  only after activation preconditions)
* **THEN** the service row has `is_enabled = false` and
  `is_customer_visible = false` and does not appear in
  `listEffectiveCatalog` for any branch until explicitly enabled

#### Scenario: Explicit enablement is required and audited

* **WHEN** an authorized user sets `is_enabled = true` for a service of their
  branch
* **THEN** the service becomes part of the effective catalog (subject to
  lifecycle and visibility) and a `branch_service.enabled` audit event is
  written transactionally

## Requirement: Services, variants, and add-ons

The system SHALL support services with zero or more variants and optional
add-ons per `docs/SERVICE_CATALOG.md` §4–6. A service with variants SHALL
require variant selection at booking time; a service without variants SHALL
be bookable directly. Add-ons SHALL declare quantity bounds with
`1 ≤ min_quantity ≤ max_quantity`. Catalog entities SHALL NOT contain any
authoritative price or pricing-type data (decision Q5).

#### Scenario: Add-on quantity bounds validated

* **WHEN** a create/update operation declares `min_quantity = 0` or
  `max_quantity < min_quantity`
* **THEN** validation fails with `INVALID_INPUT` and no row is modified

#### Scenario: No catalog pricing fields

* **WHEN** the catalog schema and domain contracts are inspected
* **THEN** no catalog entity contains a price, default price, or pricing-type
  field; pricing references only stable catalog identities

## Requirement: Explicit allow-list compatibility

Add-on-to-service/variant compatibility SHALL be represented exclusively as
explicit allow-list rows in a join-table relationship
(`service_addon_compatibility`) (decision Q3). Absence of an allow-list row
SHALL mean incompatible. The system SHALL NOT implement block-lists, default
compatibility, or hardcoded compatibility rules in application code. All
three participants of a compatibility row SHALL belong to the same branch and
organization.

#### Scenario: Add-on not selectable without allow-list row

* **WHEN** `validateSelection` is called with an add-on that has no
  compatibility row for the selected service/variant
* **THEN** the selection is invalid with a compatibility violation; the
  add-on never appears as selectable for that service in the effective catalog

#### Scenario: Variant-granular restriction

* **WHEN** a compatibility row exists with a non-null `service_variant_id`
* **THEN** the add-on is allow-listed only for that variant, not for other
  variants of the same service

#### Scenario: Cross-branch compatibility rejected

* **WHEN** a compatibility insert references an add-on, service, or variant
  from a different branch or organization
* **THEN** the operation is rejected before any row is written

## Requirement: Compatibility closure is a surfaced configuration error

An add-on that is enabled for a branch but allow-listed against none of that
branch's enabled services SHALL be detectable as a configuration error in
admin tooling, not silently hidden.

#### Scenario: Orphaned add-on reported

* **WHEN** the compatibility closure check runs for a branch
* **THEN** the orphaned add-on is reported with its identity so an authorized
  user can fix the configuration

## Requirement: Catalog lifecycle

Catalog entities SHALL follow `draft → active → inactive → archived`:
reactivation from `inactive` is allowed; `archived` is terminal; archived
identities are never reused or renumbered. A service SHALL become `active`
only when its category is `active` and a default-locale translation exists.
Every transition SHALL be audited with from/to states.

#### Scenario: Activation preconditions enforced

* **WHEN** an active transition is requested for a service whose category is
  not `active`, or whose default-locale translation is missing
* **THEN** the transition is rejected with `INVALID_INPUT` and the status is
  unchanged

#### Scenario: Archived identity preserved

* **WHEN** a service is archived after historical references exist
* **THEN** the row and its identity remain; no new entity may claim its slug
  (except through the alias mechanism of a rename); historical references
  remain resolvable

## Requirement: Slug immutability and audited aliases

Internal entity identity SHALL be immutable forever (decision Q7). A
customer-facing slug SHALL be freely editable only while the entity is
`draft`; after first publication (`published_at` set), the slug SHALL be
frozen. Changing a published slug SHALL require an audited alias/redirect
record (`service_slug_alias.created` audit) and SHALL NOT create alias chains
or loops. An old slug alias SHALL never be assignable to a different entity.

#### Scenario: Draft slug editable

* **WHEN** a draft entity's slug is updated to a valid, unused value
* **THEN** the update succeeds without any alias record

#### Scenario: Published slug change requires alias

* **WHEN** a rename is requested for a published service
* **THEN** the operation atomically updates the slug, records the old slug as
  an alias, and writes `service_slug_alias.created` — or fails entirely
  leaving no partial state

#### Scenario: Alias chains and reuse are impossible

* **WHEN** a rename is attempted where the old slug equals another alias's
  old slug for the same entity type and branch, or the new slug equals the
  entity's current slug
* **THEN** the operation is rejected with `CONFLICT`/`SLUG_IMMUTABLE`
  respectively; no alias row is created

#### Scenario: Alias resolution

* **WHEN** `resolveCatalogSlug` is called with a published old slug and
  `includeAliases = true`
* **THEN** the current entity is returned with a redirect indicator; consumers
  never observe a broken reference

## Requirement: Localization of catalog entities

Each localizable entity (category, service, variant, add-on) SHALL support
translations via unique `(entity_id, locale)` records, initially for
`de/en/fr/es` and extensible without schema changes. Exactly one default
locale exists per branch context; the default-locale text SHALL be the
fallback for missing translations. Customer-facing rendering SHALL NOT fall
back to empty strings.

#### Scenario: Missing translation falls back

* **WHEN** the effective catalog is read for a locale lacking a translation
* **THEN** the default-locale text is returned, never an empty string

#### Scenario: Duplicate translation rejected

* **WHEN** a second translation is written for an existing `(entity_id, locale)`
* **THEN** the operation fails with `CONFLICT` (unique constraint backs it)

## Requirement: Effective catalog read model

The system SHALL expose `listEffectiveCatalog(branchId, { locale,
customerVisibleOnly })` returning entries satisfying the full conjunction:
category active and enabled (for services) ∧ entity `active` ∧
`is_enabled = true` ∧ (customer-visible when requested). Booking, CMS, and
search SHALL consume this read model; no downstream domain SHALL duplicate
catalog data or re-decide offering state.

#### Scenario: Inactive entity excluded

* **WHEN** an enabled, customer-visible service is set to `inactive`
* **THEN** it disappears from the customer-visible effective catalog without
  any branch-configuration mutation

#### Scenario: Opt-in gate enforced in read model

* **WHEN** a `draft` or archived entity, or one with `is_enabled = false`,
  is queried
* **THEN** it is absent from the effective catalog regardless of lifecycle
  shortcuts

## Requirement: Authorization uses the existing permission catalog

All catalog operations SHALL enforce server-side authorization using only
`services.view` and `services.edit` from `SECURITY.md` §14 (decision Q8) —
no new permission names. The chain SHALL be authentication → role →
permission → organization scope → branch scope before any state change.
Branch-scoped users SHALL only reconfigure offering flags of their own
branches; they SHALL NOT create/delete catalog entities, change lifecycle
states, or touch other branches' rows. UI context SHALL never constitute
authorization.

#### Scenario: Branch Manager configures own branch only

* **WHEN** a branch manager enables a service of their own branch
* **THEN** the operation succeeds (audit recorded)

#### Scenario: Branch Manager cannot create catalog entities

* **WHEN** a branch-scoped user attempts to create a service or edit a
  lifecycle status
* **THEN** the request is rejected with `FORBIDDEN` before any state change

#### Scenario: Cross-branch configuration rejected

* **WHEN** a branch manager of branch A targets branch B's catalog rows
* **THEN** the request is rejected with `FORBIDDEN` / invisible via RLS

## Requirement: Transactional audit for catalog mutations

Every catalog mutation SHALL write `resource.action` audit events
transactionally with the state change (fail-closed; `AUDIT_SYSTEM.md` §50,
§101): `service_category.*`, `service.*`, `service_variant.*`,
`service_addon.*` lifecycle events; `service_addon_compatibility.created/.removed`;
`service_slug_alias.created` (always paired with a rename);
`branch_service.enabled/.disabled/.updated`. Records SHALL carry actor,
organization, branch, resource, action, result, request ID, and bounded
redacted metadata; bulk seeding SHALL write one summary event per entity
type with counts. No secrets, customer data, or pricing internals beyond IDs
SHALL be recorded.

#### Scenario: Status change audit carries from/to

* **WHEN** a service transitions `active → inactive`
* **THEN** the `service.status_changed` record contains `from: active`,
  `to: inactive`, actor, and request ID

#### Scenario: Rename and alias are atomically audited

* **WHEN** a published slug rename completes
* **THEN** both the entity update and `service_slug_alias.created` exist in
  the same committed transaction; if the audit insert fails, the rename
  aborts

#### Scenario: Bulk seed produces summary events

* **WHEN** the seed runner provisions a branch's catalog definition
* **THEN** one summary audit event per entity type records the row count,
  not one event per row

## Requirement: Idempotent seed mechanism (structure only)

The system SHALL provide an idempotent, version-controlled seed runner that
applies a catalog definition file (categories → services → variants →
add-ons → compatibility → translations) per branch using natural-key
existence checks, producing identical row counts on repeated runs. Seeded
rows SHALL be disabled and not customer-visible (decision Q2). Concrete V1
content SHALL NOT be authored until business approval per
`docs/SERVICE_CATALOG.md` §7 (decision Q6).

#### Scenario: Seed rerun creates no duplicates

* **WHEN** the seed runner executes twice against the same branch with the
  same definition
* **THEN** row counts and row identities are identical to a single run

#### Scenario: Seeded rows are not offered

* **WHEN** a catalog definition is seeded to a branch
* **THEN** all created rows have `is_enabled = false` and
  `is_customer_visible = false`

## Requirement: RLS organization and branch isolation

Every new catalog table SHALL have Row Level Security enabled from its
creation migration, enforcing organization scope for HQ roles and branch
scope via `membership_branches` for branch-scoped roles, reusing the
established SECURITY DEFINER helpers and the owner-exemption pattern
verified in Change 1 (no FORCE RLS). A user of one organization SHALL never
observe another organization's catalog rows, regardless of supplied
identifiers.

#### Scenario: Cross-organization invisibility

* **WHEN** any user of organization A queries catalog rows of organization B
  with known IDs
* **THEN** no rows are returned (RLS)

#### Scenario: Helpers keep working in definer context

* **WHEN** privileged server operations read catalog tables inside
  application transactions
* **THEN** the existing authorization helpers behave as in Change 1 without
  RLS recursion (owner-exemption pattern preserved)

## Requirement: Booking-boundary validation primitive

The system SHALL expose `validateSelection({ serviceId, variantId,
addonSelections })` as a pure validation of: lifecycle/effective-availability
conjunction, allow-list membership per add-on, quantity bounds, and variant
requirement — with no pricing and no availability logic embedded.

#### Scenario: Quantity violation rejected

* **WHEN** a selection includes an add-on with quantity above `max_quantity`
* **THEN** validation fails identifying the add-on and the bound

#### Scenario: Variant required when present

* **WHEN** a selection names a service that has enabled variants but no
  variant
* **THEN** validation fails requiring variant selection

## Requirement: Database documentation synchronization

Implementation SHALL synchronize the affected documentation as an explicit
task: `DATABASE.md` §15.1 (first-class `service_categories` replacing
`service_type`, Q4), §15.4 (removal of authoritative `pricing_type`/
`default_price`, Q5), §15 scope note and §64 table set (branch_id NOT NULL
per Q9; new tables), and mark `docs/SERVICE_CATALOG.md` §20.3 obligations
resolved. No contradictory `service_type`-based or catalog-pricing wording
SHALL remain after synchronization.

#### Scenario: Documentation no longer contradicts the implemented schema

* **WHEN** the documentation synchronization task completes
* **THEN** `DATABASE.md` §15 describes categories as an entity, add-ons
  without pricing fields, and catalog rows with required `branch_id`

## Test/verification requirements (applies to the capability)

* Migration chain (0008+) applies cleanly to a fresh database; constraints,
  uniquenesses, and RLS verified by automated tests.
* RLS/authorization verified as real authenticated contexts (unit-level
  emulation locally; hosted verification executed as part of the implementing
  change — `tests/hosted/catalog-hosted-verification.test.ts`, skipped by
  default, run with `HOSTED_VERIFY=1`).
* Note: concrete V1 catalog business content (decision Q6) remains pending
  business approval and is NOT part of this capability contract; the seed
  mechanism is structure-only by design.
