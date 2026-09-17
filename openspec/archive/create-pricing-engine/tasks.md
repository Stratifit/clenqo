# Tasks: Pricing Engine (Change 4A)

> Status convention: `[x]` complete — implementation and verification done
> (local gates green; hosted suite 11/11, full hosted regression 54/54).
> Normative source: approved decision record P1–P22 (design.md §1).

## 1. Schema & migration
- [x] 1.1 Create `supabase/migrations/0010_pricing_engine.sql`: `pricing_profiles`,
      `pricing_versions`, `pricing_rules` per design §3 (UUID PKs, organization_id +
      branch_id NOT NULL, timestamptz UTC, composite same-branch FKs).
- [x] 1.2 Constraints: status CHECKs, version uniqueness per profile, effective-range CHECK,
      overlapping published-window rejection (P17), non-negative amounts (§70).
- [x] 1.3 Indexes per §43 conventions; verify chain 0001→0010 applies cleanly (pglite).

## 2. RLS & authorization
- [x] 2.1 RLS enabled in 0010 on all three tables; combined policies via 0006 definer
      helpers; no FORCE (P12, established pattern).
- [x] 2.2 Wire P20 role mapping into server-side authorization (existing pricing.* only).

## 3. Zod schemas & errors
- [x] 3.1 Configuration schemas (profile/version/rule per rule_type incl. duration-rule
      consumed-factor declaration and propertyDetails contract, P-D1).
- [x] 3.2 Quote input schema (branch, catalog identities, property details, scheduled date/
      time context) + §58 error catalog (design §7).

## 4. Configuration domain
- [x] 4.1 Profile/version CRUD services; draft editing only in draft status (P16).
- [x] 4.2 Publish operation: §47 validation set transactionally; immutability guards (P1, P16).
- [x] 4.3 Archive operation.
- [x] 4.4 Transactional fail-closed audit events pricing.created/updated/published/archived.
- [x] 4.5 Server actions (no UI, P19).

## 5. Quote engine
- [x] 5.1 Deterministic pipeline per design §4 incl. stage-activity matrix (P2, P4–P9, P14, P15).
- [x] 5.2 Effective-version resolution (P17) against the scheduled service date (§49).
- [x] 5.3 Result/snapshot_source contract per design §5 (§33/§16.3).
- [x] 5.4 Statelessness guaranteed — no persistence (P13).

## 6. Duration authority
- [x] 6.1 Pricing duration resolver sharing the rule engine (P21).
- [x] 6.2 Extend DurationSelection with typed optional propertyDetails (P-D1).
- [x] 6.3 Wire the real provider into scheduling actions; delete placeholderDurationProvider
      (P21); scheduling tests updated.

## 7. Seed & provisioning
- [x] 7.1 `seedPricingDefaults(branchId)` idempotent structure-only provisioning (P18, P3).

## 8. Tests
- [x] 8.1 Unit: determinism, rounding, effective dates, precedence, difficulty, add-ons,
      Sunday surcharge, stacking, tax-exclusive arithmetic, inactive stages, minimum
      structures money-only (P3/P4/P5/P5b/P6/P9/P14/P15).
- [x] 8.2 pglite domain: CRUD + P20 authorization boundaries, lifecycle/immutability/overlap,
      seed idempotency, audit fail-closed.
- [x] 8.3 Migration/RLS tests incl. cross-org invisibility and branch-scope enforcement.
- [x] 8.4 Duration-authority tests incl. propertyDetails handling and placeholder absence.
- [x] 8.5 All money fixtures explicitly non-production (P3).

## 9. Quality gates
- [x] 9.1 typecheck, lint, build, full local suite green; Changes 1–3 suites unaffected
      except provider wiring.

## 10. Hosted verification (later, per established HOSTED_VERIFY=1 workflow)
- [x] 10.1 Extend hosted suite with pricing coverage following Change 2/3 conventions.
- [x] 10.2 Apply 0010 on hosted staging; execute hosted suite; zero leftovers.

## 11. Documentation sync
- [x] 11.1 PRICING_ENGINE.md implementation status + decision annex reference.
- [x] 11.2 DATABASE.md §16/§64/§65 implemented model + table inventory.
- [x] 11.3 SCHEDULING_SYSTEM.md S6/§86 duration-authority note (placeholder deleted).
- [x] 11.4 DOCUMENTATION_AUDIT.md HIGH-2 pricing residue closure.
- [x] 11.5 API_STANDARDS.md §27 final contract shape; REQUIREMENTS.md PR-005 wording per P12.

## 12. Acceptance walkthrough
- [x] 12.1 Hosted demonstration: seed → configure draft version (fixture values) → publish →
      deterministic quote → effective-date re-selection → audit trail complete.
