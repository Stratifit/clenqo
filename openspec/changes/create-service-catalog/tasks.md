# Tasks: Service Catalog & Branch Service Configuration

**Change ID:** `create-service-catalog`

Ordered so verification is possible at every step. No task starts before its
dependencies are complete. All checkboxes start unchecked — they are ticked
only after the corresponding implementation and verification actually succeed.

## 1. Database / schema alignment (design first, then SQL)

- [x] 1.1 Confirm target schema against `docs/SERVICE_CATALOG.md` §20 and
      design §4: `service_categories`, `services`, `service_variants`,
      `service_addons`, four translation tables,
      `service_addon_compatibility`, `service_slug_aliases` — all with
      `organization_id` + `branch_id NOT NULL` (Q9), lifecycle CHECKs,
      natural-key UNIQUEs
- [x] 1.2 Confirm the Q4/Q5 field decisions: `category_id` FK replaces
      `service_type`; no `pricing_type`/`default_price` anywhere
      (alignment obligations listed for task 15)

## 2. Migration

- [x] 2.1 Migration `0008_service_catalog_tables.sql`: all tables of task 1.1
      with UUID PKs, `timestamptz` UTC timestamps, FKs (composite where
      needed to keep compatibility rows same-branch), CHECK constraints
      (status enums, `1 ≤ min_quantity ≤ max_quantity`),
      UNIQUE constraints (`(branch_id, slug)` per entity,
      `(entity_id, locale)` translations,
      `(service_addon_id, service_id, service_variant_id)` compatibility,
      `(branch_id, entity_type, old_slug)` aliases)
- [x] 2.2 Indexes per `DATABASE.md` §43 conventions: `branch_id`,
      `status`, `category_id`, compatibility lookups, alias lookups
- [x] 2.3 Migration applies cleanly to a fresh database (pglite chain test)
      → `tests/db/migrations.test.ts` extension

## 3. RLS

- [x] 3.1 RLS enabled on every new table **in the creation migration**;
      policies follow the Change 1 pattern (org scope for HQ, branch scope
      via `membership_branches`), reusing the existing SECURITY DEFINER
      helpers; owner-exemption pattern preserved (no FORCE)
- [x] 3.2 RLS tests: cross-organization invisibility, cross-branch denial,
      branch-scoped reads, manipulated-ID rejection
      → `tests/db/rls.test.ts` extension

## 4. Authorization

- [x] 4.1 Domain authorization wiring: `services.view` for admin reads,
      `services.edit` for mutations (Q8 — no new permission names); HQ =
      entity CRUD/lifecycle/compatibility/aliases, branch roles = offering
      flags only, enforced server-side before any state change
- [x] 4.2 Authorization tests: HQ Admin full access; Branch Manager offering
      flags on own branch only; Branch Manager cannot create/lifecycle
      entities; Cleaner/unauthenticated denied; cross-branch and
      cross-organization denied
      → `tests/domain/authorization.test.ts` extension

## 5. Domain validation

- [x] 5.1 Zod schemas in `features/services/schemas/`: slug grammar (branch
      slug rules), quantity bounds, locale membership, status transitions,
      rename payloads
- [x] 5.2 Validation invariants: category `active` before service
      activation; default-locale translation required for activation;
      archived terminal; compatibility participants same-branch; alias
      no-chain/no-loop/no-reuse rules
      → unit tests

## 6. Service catalog operations

- [x] 6.1 Domain service `features/services/service.ts`:
      create/update/status/archive for categories, services, variants,
      add-ons — transactional with audit; stable error codes
- [x] 6.2 `listEffectiveCatalog` read model (full bookability conjunction)
      and `resolveCatalogSlug` (with `includeAliases`)
- [x] 6.3 Server Actions exposing the operations with the `Result<T>`
      envelope; no business logic in actions
- [x] 6.4 Domain tests: CRUD paths, effective-catalog conjunction, lifecycle
      transitions

## 7. Branch configuration (offering layer)

- [x] 7.1 `setBranchServiceState` / `reorderBranchCatalog` /
      `setBranchServiceVisibility` on branch-owned rows; created rows always
      disabled+invisible (Q2); explicit actions only
- [x] 7.2 Tests: opt-in semantics (new entries never auto-enabled/effective),
      branch-scope limits, `branch_service.*` audits

## 8. Compatibility

- [x] 8.1 `setAddonCompatibility` / `removeAddonCompatibility` with
      same-branch enforcement and transactional audits
- [x] 8.2 Compatibility closure check surfacing orphaned enabled add-ons in
      admin tooling
- [x] 8.3 Tests: absence = incompatible; variant-granular rows; cross-branch
      rejection; closure reporting

## 9. Localization

- [x] 9.1 Translation CRUD for all four entities with `(entity_id, locale)`
      uniqueness and default-locale fallback in read models
- [x] 9.2 Tests: fallback rendering data, duplicate rejection, default-locale
      activation gate

## 10. Slug alias handling

- [x] 10.1 `renamePublishedSlug`: atomic slug update + alias insert +
      `service_slug_alias.created` audit; draft renames without alias;
      `SLUG_IMMUTABLE`/`CONFLICT` rules per spec
- [x] 10.2 Tests: draft rename free; published rename requires alias; chain/
      loop/reuse rejection; alias resolution

## 11. Audit

- [x] 11.1 Wire all events of design §8 through the existing audit service
      (transactional, fail-closed, redacted metadata, request IDs)
- [x] 11.2 Audit tests: required events per mutation, from/to states,
      rename↔alias pairing, no sensitive metadata

## 12. Seed mechanism (structure only — Q6)

- [x] 12.1 Catalog definition file format (version-controlled; categories →
      services → variants → add-ons → compatibility → translations),
      **content empty/pending business approval**
- [x] 12.2 Idempotent seed runner (natural-key existence-check upserts,
      per-type transactions, summary audit events, rows disabled+invisible)
- [x] 12.3 Seed tests: rerun produces identical counts; seeded rows not
      offered
- [ ] 12.4 **BLOCKED ON BUSINESS APPROVAL:** author the actual V1 definition
      per `docs/SERVICE_CATALOG.md` §7.4 checklist — do not invent content;
      stop and obtain approval before ticking

## 13. Tests (full quality gate)

- [x] 13.1 Migration + constraint + RLS suites green
- [x] 13.2 Domain suites green (authorization, provisioning unaffected,
      catalog operations, compatibility, localization, aliases, audit,
      seeds)
- [x] 13.3 `npm test` / `npm run lint` / `npm run typecheck` /
      `npm run build` all pass

## 14. Hosted Supabase verification (later task — do NOT run now)

- [x] 14.1 Extend the skipped-by-default hosted suite (`HOSTED_VERIFY=1`)
      with catalog coverage: real Auth authorization, RLS isolation as real
      roles, definer-helper behavior, transactional audits, idempotent seed
      rerun, alias/constraint behavior on real PostgreSQL
- [x] 14.2 Execute the hosted suite against the staging project; clean up
      all hosted test data; record results in the implementation report

## 15. Documentation synchronization (explicit obligations)

- [x] 15.1 `DATABASE.md` §15.1: replace `service_type` model with first-class
      `service_categories` (Q4)
- [x] 15.2 `DATABASE.md` §15.4: remove authoritative `pricing_type`/
      `default_price` from `service_addons` (Q5)
- [x] 15.3 `DATABASE.md` §15 scope note + §64: require `branch_id` NOT NULL
      on catalog rows (Q9); add the new tables to the Services set
- [x] 15.4 Check `SECURITY.md` §14 / `API_STANDARDS.md` /
      `AUDIT_SYSTEM.md` for wording conflicts with the implemented
      capability; align only where directly required (no new permissions, Q8)
- [x] 15.5 Mark `docs/SERVICE_CATALOG.md` §20.3 alignment obligations
      resolved; verify no contradictory `service_type`/catalog-pricing
      wording remains

## 16. Acceptance walkthrough

- [x] 16.1 Demonstrate: HQ creates category → service → translation →
      activate → branch manager enables it → appears in effective catalog;
      unauthorized attempts rejected; audit trail complete
- [x] 16.2 Demonstrate: published slug rename produces alias + audit; old
      slug resolves via alias; archived identity preserved
