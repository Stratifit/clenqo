# admin-config Specification

Admin configuration surfaces for Service Catalog, Pricing, and Scheduling
(OpenSpec Change 10 `create-config-admin-ui`, promoted). Pure consumer surface
over the existing domain contracts under the Change 8 admin shell; scheduling
mutations are HQ-Admin-only via the existing `branches.edit` (BD-E3b);
translation editing (BD-E3d) and seed tools (BD-E3e) are intentionally not
exposed. No migration, no new permissions, no RLS changes. Establishing
archive: `openspec/archive/create-config-admin-ui/` (commit `012950e`
feat: add config admin UI); verification: local 357 passed / 104 skipped /
0 failed, hosted Change 10 7/7, full hosted Changes 1–10 regression 104/104.

## Requirement: Catalog tree visibility

The system SHALL render the branch's catalog tree (category → service →
variant → addon, plus standalone addons) from
`listEffectiveCatalogAction` for any actor holding `services.view` and
branch scope.

#### Scenario: Staff views the catalog tree

* **Given** an authenticated `branch_manager` with `services.view` scoped to
  branch B
* **When** they open `/admin/services` with branch context B
* **Then** the page renders B's categories, services, variants, addons, and
  standalone addons exactly as returned by `listEffectiveCatalogAction`

#### Scenario: Catalog read requires branch scope

* **Given** a branch manager whose `membership_branches` excludes branch C
* **When** they request the catalog of branch C
* **Then** the server denies the read (`FORBIDDEN`) and the page renders no
  branch-C data

## Requirement: Branch scoping for configuration pages

Every configuration page SHALL resolve the Change 8 branch context
server-side per request, SHALL require a concrete branch for branch-scoped
surfaces (catalog, pricing), and SHALL NOT provide an All-Branches
aggregation view.

#### Scenario: All-Branches context prompts selection

* **Given** an HQ user whose context resolves to the org-wide
  "All Branches" scope
* **When** they open `/admin/services`
* **Then** they are redirected to select a concrete branch and no
  aggregated catalog query is issued

## Requirement: Catalog entity creation and editing

The system SHALL expose creation and editing of categories, services,
variants, and addons exclusively through the existing
`createCategoryAction` / `updateCategoryAction`, `createServiceAction` /
`updateServiceAction`, `createVariantAction` / `updateVariantAction`, and
`createAddonAction` / `updateAddonAction` contracts, with input validated
by the existing Zod schemas server-side.

#### Scenario: Service creation through the UI

* **Given** a staff member with `services.edit` for branch B
* **When** they submit a valid `createServiceSchema` payload
* **Then** the service is created `draft` and appears in the tree
* **And** the UI computed no field value itself

#### Scenario: Invalid payload is refused server-side

* **Given** a submitted payload violating the existing schema
* **When** the action executes
* **Then** the server returns the schema/contract error verbatim and no
  partial entity is created

## Requirement: Catalog lifecycle

The system SHALL expose the draft → active → archived lifecycle through the
existing `changeStatusAction` only; archived entities are terminal.

#### Scenario: Activating a draft service

* **Given** a draft service in branch B
* **When** an authorized user activates it via `changeStatusAction`
* **Then** the status becomes `active` and the tree reflects it

#### Scenario: Archived is terminal

* **Given** an archived entity
* **When** a status change is attempted
* **Then** the domain refuses the transition and the UI renders the error

## Requirement: Catalog offering toggle

The system SHALL expose `is_enabled` through `setOfferingStateAction` as a
state separate from lifecycle status.

#### Scenario: Disabling an active service

* **Given** an active service
* **When** the offering toggle is set to disabled via
  `setOfferingStateAction`
* **Then** `is_enabled` becomes false while `status` remains `active`

## Requirement: Catalog ordering

The system SHALL expose reordering within a parent through the existing
`reorderCatalogAction`.

#### Scenario: Reordering services in a category

* **Given** a category with multiple services
* **When** an authorized user submits a new order via
  `reorderCatalogAction`
* **Then** the persisted order updates and the tree reflects it

## Requirement: Add-on compatibility management

The system SHALL expose add-on compatibility through
`setAddonCompatibilityAction` and `removeAddonCompatibilityAction`.

#### Scenario: Attaching an addon to a service

* **Given** an active addon and a target service in the same branch
* **When** compatibility is set via `setAddonCompatibilityAction`
* **Then** the pairing is stored and rendered in the compatibility matrix

#### Scenario: Cross-branch compatibility refused

* **Given** an addon from branch B and a service from branch C
* **When** compatibility is attempted
* **Then** the domain rejects the pairing and the error renders verbatim

## Requirement: Orphaned addon inspection

The system SHALL surface `findOrphanedAddonsAction` as a read-only
inspection panel.

#### Scenario: Listing orphaned addons

* **Given** addons with no compatibility links in branch B
* **When** the inspection panel loads
* **Then** the orphaned addons are listed with their branch scope

## Requirement: Published slug rename

The system SHALL expose `renamePublishedSlugAction` for published services,
variants, and addons where the existing contract allows, rendering the
domain outcome (including alias behavior) verbatim.

#### Scenario: Renaming a published service slug

* **Given** a published service with an existing slug
* **When** an authorized user submits a new slug via
  `renamePublishedSlugAction`
* **Then** the domain performs the rename per its contract and the result
  (or error) renders verbatim

## Requirement: Pricing profile management

The system SHALL expose pricing profile listing, creation, and update
through `listPricingProfilesAction`, `createPricingProfileAction`, and
`updatePricingProfileAction` for actors holding the canonical pricing
permissions.

#### Scenario: Creating a profile

* **Given** a branch manager with `pricing.create` for branch B
* **When** they create a profile with name and currency
* **Then** the profile is created via the existing contract and listed

## Requirement: Pricing version management

The system SHALL expose version listing and creation through
`listPricingVersionsAction` and `createPricingVersionAction`, including
effective-date inputs validated by the existing schemas.

#### Scenario: Creating a draft version

* **Given** an existing profile
* **When** a version is created with a valid effective window
* **Then** the version exists in `draft` status and is editable

## Requirement: Draft-only pricing rule editing

Rule creation SHALL be available only through `createPricingRuleAction` on
`draft` versions, using the existing per-`rule_type` discriminated Zod
payloads; published and archived versions SHALL render read-only.

#### Scenario: Rule added to a draft version

* **Given** a draft version
* **When** a `base_rate` rule is submitted with a valid
  `baseRateRuleConfigSchema` payload
* **Then** the rule is created and listed under the version

#### Scenario: Rule refused on a published version

* **Given** a published version
* **When** a rule creation is attempted
* **Then** the domain refuses (`Only draft versions…`) and the UI renders
  the error; the version remains immutable

## Requirement: Pricing publish and archive

The system SHALL expose `publishPricingVersionAction` and
`archivePricingVersionAction`; publish SHALL run the existing server-side
§47 validation, and the UI SHALL surface server validation errors verbatim
without client-side pre-validation.

#### Scenario: Publishing a valid draft

* **Given** a draft version with at least one rule
* **When** publish is invoked
* **Then** the version becomes `published` with the effective window
  enforced by the domain

#### Scenario: Publish refused without rules

* **Given** a draft version with no rules
* **When** publish is invoked
* **Then** the domain refuses ("A version without rules cannot be
  published") and the error renders verbatim

## Requirement: Quote sanity display

The system SHALL expose a read-only quote sanity panel through
`calculateQuoteAction`; the UI SHALL NOT calculate authoritative prices,
durations, or availability client-side.

#### Scenario: Sanity-checking a service date

* **Given** a published pricing configuration
* **When** a staff member requests a quote for a service and date
* **Then** the server-computed quote renders with its version number, and
  no price originates from the client

## Requirement: Scheduling configuration

The system SHALL expose scheduling configuration reads via
`getSchedulingConfigAction` (branch-access-gated) and mutation via
`updateSchedulingConfigAction` (requires `branches.edit`).

#### Scenario: HQ admin updates the slot grid

* **Given** an hq_admin with `branches.edit`
* **When** a valid `updateSchedulingConfigSchema` payload is submitted
* **Then** the configuration updates and re-renders

#### Scenario: Configuration read by a branch manager

* **Given** a branch manager without `branches.edit`
* **When** they view `/admin/scheduling` for their branch
* **Then** the configuration renders read-only

## Requirement: Operating hours management

The system SHALL expose operating-hours reads
(`listOperatingHoursAction`) and mutations (`upsertOperatingHoursAction`,
`closeOperatingHoursAction`) under the existing effective-dating rules;
back-dating is refused by the domain.

#### Scenario: Setting weekday hours

* **Given** an hq_admin
* **When** weekday intervals are submitted via
  `upsertOperatingHoursAction`
* **Then** the intervals persist and render

#### Scenario: Back-dated hours refused

* **Given** an effective date in the past
* **When** hours are submitted
* **Then** the domain refuses and the error renders verbatim

## Requirement: Schedule exceptions management

The system SHALL expose schedule-exception reads
(`listScheduleExceptionsAction`), typed creation
(`createScheduleExceptionAction`), and deletion
(`deleteScheduleExceptionAction`).

#### Scenario: Creating a closed-day exception

* **Given** an hq_admin
* **When** a valid `createScheduleExceptionSchema` payload is submitted
* **Then** the exception is created and listed

#### Scenario: Deleting an exception

* **Given** an existing exception
* **When** deletion is invoked via `deleteScheduleExceptionAction`
* **Then** the exception is removed and no longer listed

## Requirement: Service scheduling rules

The system SHALL expose per-service scheduling rule upserts via
`upsertServiceSchedulingRuleAction`, scoped to the branch's own services.

#### Scenario: Upserting a service rule

* **Given** an hq_admin and a service in branch B
* **When** a valid `upsertServiceSchedulingRuleSchema` payload is submitted
* **Then** the rule persists for that service

#### Scenario: Foreign-branch service rule refused

* **Given** a service belonging to another branch
* **When** a rule upsert references it
* **Then** the domain rejects the cross-branch reference

## Requirement: HQ-only scheduling mutations

All scheduling mutations SHALL require `branches.edit` (canonical catalog:
`hq_admin` only) — enforced by the existing server contracts, not the UI
(BD-E3b). No permission, catalog, RLS, or backend authorization change is
made.

#### Scenario: HQ admin mutates scheduling

* **Given** an hq_admin
* **When** any scheduling mutation action executes
* **Then** it succeeds under the existing contract

#### Scenario: Non-HQ scheduling mutation refused

* **Given** an hq_staff or branch_manager (no `branches.edit`)
* **When** any scheduling mutation action executes
* **Then** the server refuses it (`FORBIDDEN`) regardless of UI state

## Requirement: Branch Manager scheduling read-only behavior

Branch Managers SHALL see the scheduling surface read-only for branches
within `membership_branches`, with mutation controls absent from the UI and
every mutation refused server-side.

#### Scenario: Read-only scheduling for a branch manager

* **Given** a branch manager viewing `/admin/scheduling` for their branch
* **When** the page renders
* **Then** configuration/hours/exceptions/rules are visible read-only and
  no mutation control is actionable
* **And** a direct action invocation is still refused by the server

## Requirement: Permission and context enforcement

Every configuration page SHALL revalidate authentication, organization
access, and branch scope server-side per request through the Change 8
context resolution; navigation visibility is convenience only and the
server contracts remain the authorization boundary.

#### Scenario: Direct URL access without permission

* **Given** an authenticated user without `pricing.view`
* **When** they request `/admin/pricing` directly
* **Then** the page denies access (redirect with denial context per the
  Change 8/9 convention) and no pricing data is returned

## Requirement: Cleaner denial

Cleaners SHALL have no access to any configuration-admin surface.

#### Scenario: Cleaner opens a configuration page

* **Given** an authenticated cleaner (`jobs.view`, `search.use` only)
* **When** they request `/admin/services`, `/admin/pricing`, or
  `/admin/scheduling`
* **Then** access is denied server-side and no configuration data is
  returned

## Requirement: Outsider denial

Actors without an active organization membership SHALL fail closed before
any configuration data is resolved.

#### Scenario: Outsider requests a configuration page

* **Given** an authenticated Supabase user with no membership
* **When** they request any configuration-admin page
* **Then** actor resolution fails (`No active organization membership.`)
  and no data is returned

## Requirement: Translation editor exclusion

The system SHALL NOT expose `upsertTranslationAction` or any translation
workflow in Change 10 (BD-E3d); localized display through existing read
contracts is permitted.

#### Scenario: No translation surface exists

* **Given** the implemented Change 10 UI
* **When** the surface is inspected
* **Then** no route, form, or action binding references
  `upsertTranslationAction`

## Requirement: Seed-tool exclusion

The system SHALL NOT expose `seedCatalogAction` or
`seedPricingDefaultsAction` in any UI surface (BD-E3e); seeding remains a
script/hosted operation.

#### Scenario: No seed surface exists

* **Given** the implemented Change 10 UI
* **When** the surface is inspected
* **Then** no route, button, or action binding references either seed
  action
