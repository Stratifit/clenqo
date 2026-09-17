# CLENQO Documentation Consistency Audit

**Date:** 2026-09-14
**Auditor:** Buffy (Codebuff agent)
**Scope:** All documentation under `docs/` and `README.md`. No `openspec/` directory exists yet; no root-level `PROJECT_RULES.md` exists (it lives at `docs/PROJECT_RULES.md`).

This audit does not modify any existing document, does not implement code, does not create migrations, and does not invent new architecture. Where two documents conflict and neither clearly supersedes the other, the conflict is reported rather than silently resolved.

**Resolution status update (post-audit):** CRITICAL-1 and CRITICAL-2 have since been resolved in the source documents — see SECURITY.md §14 (consolidated authoritative permission catalog) and DATABASE.md §16.3/§18.1/§64 + PRICING_ENGINE.md §35–36 (canonical single `pricing_snapshot` jsonb with `pricing_version_id`). The findings below are retained as the audit record.

---

# 1. Audit Scope

## 1.1 Documents audited (32)

All files were read from disk; findings reference actual content, not filenames.

| # | Document | Subject |
|---|----------|---------|
| 1 | `README.md` | Project overview, docs map, phases |
| 2 | `docs/PROJECT_RULES.md` | 47 foundational rules |
| 3 | `docs/VISION.md` | Product vision (28 sections incl. AI/Multilingual) |
| 4 | `docs/REQUIREMENTS.md` | System requirements (51 sections) |
| 5 | `docs/ARCHITECTURE.md` | Architecture (55 sections) |
| 6 | `docs/DATABASE.md` | Data model (74 sections) |
| 7 | `docs/DESIGN_SYSTEM.md` | Brand/typography/components (60 sections) |
| 8 | `docs/CONTENT_SYSTEM.md` | Content architecture (67 sections) |
| 9 | `docs/ADMIN_SYSTEM.md` | Dashboard-as-CMS (70 sections) |
| 10 | `docs/LOCALIZATION.md` | Localization (74 sections) |
| 11 | `docs/SECURITY.md` | Auth & authorization (87 sections) |
| 12 | `docs/SECURITY_PRIVACY.md` | Security & privacy (153 sections) |
| 13 | `docs/BOOKING_SYSTEM.md` | Booking lifecycle (95 sections) |
| 14 | `docs/PRICING_ENGINE.md` | Pricing (81 sections) |
| 15 | `docs/SCHEDULING_SYSTEM.md` | Availability & scheduling (83 sections) |
| 16 | `docs/WORKER_SYSTEM.md` | Workforce/jobs/cleaner PWA (89 sections) |
| 17 | `docs/PAYMENT_SYSTEM.md` | Payments & finance (87 sections) |
| 18 | `docs/NOTIFICATION_SYSTEM.md` | Notifications (99 sections) |
| 19 | `docs/QUALITY_SYSTEM.md` | Quality & reviews (77 sections) |
| 20 | `docs/BRANCH_SYSTEM.md` | HQ & branch administration (100 sections) |
| 21 | `docs/REPORTING_SYSTEM.md` | Reporting & analytics (108 sections) |
| 22 | `docs/AUDIT_SYSTEM.md` | Audit & activity (106 sections) |
| 23 | `docs/TESTING_STRATEGY.md` | Testing & QA (154 sections) |
| 24 | `docs/DEPLOYMENT.md` | Deployment & DevOps (135 sections) |
| 25 | `docs/PROJECT_STRUCTURE.md` | Repository structure (156 sections) |
| 26 | `docs/API_STANDARDS.md` | API & server contracts (75 sections) |
| 27 | `docs/OBSERVABILITY.md` | Observability (67 sections) |
| 28 | `docs/BACKGROUND_JOBS.md` | Background jobs & automation (68 sections) |
| 29 | `docs/SEARCH_DISCOVERY.md` | Search & discovery (74 sections) |
| 30 | `docs/MEDIA_STORAGE.md` | Media & storage (78 sections) |
| 31 | `docs/LEGAL_COMPLIANCE.md` | Legal & compliance (86 sections) |
| 32 | `docs/ROADMAP.md` | Product roadmap (87 sections) |

## 1.2 Documents referenced but not present

* `docs/ROLES_PERMISSIONS.md` — referenced by `ARCHITECTURE.md` §(doc-map, line 531). Not present.
* `README.md` docs list names `ROLES_PERMISSIONS.md`, `CUSTOMER_SYSTEM.md`, `COMPONENT_STANDARDS.md`, `WEBSITE_SYSTEM.md`, `OBSERVABILITY.md`, `ROADMAP.md` etc. — the README list is materially out of sync with the actual filenames (see LOW-1).
* `openspec/` — referenced by many docs as the change-control mechanism. Directory does not exist yet (expected pre-MVP, noted in ROADMAP Phase 0 exit criteria).

---

# 2. Executive Summary

## 2.1 Overall documentation health

**Good, with resolvable inconsistencies.** The documentation set is unusually comprehensive and internally consistent on the big architectural decisions: single codebase, one database, branches as data, server-authoritative pricing/booking, RLS + server-side authorization, resource.action permissions, outbox/background processing, and phased delivery. The cross-domain chain (branch → provisioning → website → CMS → services → pricing → availability → booking → job → assignment → completion → payment → invoice → notification → review → reporting → audit) is described coherently across ~20 documents.

The problems are concentrated in **cross-document detail drift** that was introduced as the documentation set was authored incrementally:

1. **Authorization is the weakest link.** Three documents (SECURITY, BRANCH_SYSTEM, PRICING_ENGINE) list permission catalogs, and they diverge (`employees.manage` vs `employees.edit`, `pricing.create/archive/override` missing from others, `quality.manage` vs `quality.manage_issue`, `payments.manage` vs `payments.*` split). There is no single authoritative permission catalog.
2. **State machines drift at the edges.** Booking, job, branch, payment lifecycles are consistent in their happy paths but REQUIREMENTS adds `FAILED` to booking; invoice has no documented status set in DATABASE; review lifecycle is prose-only.
3. **The pricing snapshot ↔ DATABASE representation mismatch** (verbatim `pricing_snapshot` vs split `pricing_version_id` + `pricing_inputs_snapshot` + `pricing_result_snapshot`) will cause an implementer to pick one arbitrarily.
4. **DATABASE's own "initial table set" omits tables its own body documents** (`pricing_versions` is described as required by PRICING_ENGINE but absent; `staffs`/`staffing` staffing model, `notification_recipients` concepts, `customer_magic_link_*` tables, `price_snapshot` as a distinct concept in §pricing are not reflected in the table inventory).
5. **`recurring_booking_plans` is labeled "a future recurring booking model may use"** in DATABASE while ROADMAP Phase 3 and BACKGROUND_JOBS treat recurring generation as an implemented background job.

## 2.2 Most important findings (top 5)

1. **CRITICAL-1:** No authoritative permission catalog; three conflicting permission lists.
2. **CRITICAL-2:** Pricing snapshot representation conflict between PRICING_ENGINE (§35) and DATABASE (§16.3/§18.1).
3. **HIGH-1:** `recurring_booking_plans` simultaneously "future" (DATABASE) and MVP-adjacent/implemented (ROADMAP, BACKGROUND_JOBS).
4. **HIGH-2:** DATABASE §64 "Initial Table Set" omits several tables its own earlier sections and other domain docs require.
5. **HIGH-4:** REQUIREMENTS adds booking state `FAILED` that no other document defines or consumes.

## 2.3 Counts

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 10 |
| LOW | 5 |

---

# 3. Critical Findings

## CRITICAL-1 — No authoritative permission catalog; three conflicting lists

* **ID:** CRITICAL-1
* **Severity:** CRITICAL
* **Documents involved:** `SECURITY.md` (§14–17), `BRANCH_SYSTEM.md` (§51), `PRICING_ENGINE.md` (§ permissions), `QUALITY_SYSTEM.md` (§55–56), `LOCALIZATION.md` (§ permissions), `ADMIN_SYSTEM.md` (§ permissions), `SEARCH_DISCOVERY.md` (§16), `PAYMENT_SYSTEM.md` (§ payments.*), `REPORTING_SYSTEM.md` (§94), `AUDIT_SYSTEM.md` (§28)
* **Exact concept affected:** `resource.action` permission identifiers and role→permission mapping.

* **Problem:** The documents list permissions that overlap but do not agree:

  | Concept | SECURITY.md | BRANCH_SYSTEM.md | PRICING_ENGINE.md | QUALITY_SYSTEM.md |
  |---|---|---|---|---|
  | employees | `employees.view`, `employees.manage` | `employees.view`, `employees.edit` | — | — |
  | pricing | `pricing.view`, `pricing.edit` | `pricing.view`, `pricing.edit`, `pricing.publish` | `pricing.view`, `pricing.create`, `pricing.edit`, `pricing.publish`, `pricing.archive`, `pricing.override` | — |
  | quality | — | `quality.view`, `quality.manage` | — | `quality.view`, `quality.create_check`, `quality.manage_issue`, `quality.resolve_issue`, `quality.report` |
  | payments | `payments.view`, `payments.manage` | `payments.view`, `payments.refund` | — | — |
  | invoices | `invoices.view`, `invoices.manage` | — | — | — |
  | reports | `reports.view` | — | — | — |

  PAYMENT_SYSTEM uses a six-permission family (`payments.view/create/capture/refund/record_manual/reconcile`); AUDIT_SYSTEM uses `audit.view/view_branch/view_sensitive/export`; REPORTING_SYSTEM uses eight `reports.*` permissions — none of which appear in SECURITY's catalog. SECURITY itself warns against "ambiguous permissions" but its own catalog is the incomplete one.

* **Why it matters:** The permission model is the authorization backbone. Any implementer (human or AI) must pick one list; whichever they pick will silently deny or grant capabilities another document assumes. This directly affects RLS policy design, the admin UI, and the seed role definitions. SECURITY.md §17's example Branch Manager mapping includes `jobs.manage`, which appears nowhere else.

* **Recommended resolution:** Designate `SECURITY.md` as the single authoritative permission registry. Merge in the superset from the other documents (`pricing.create/archive/override`, `payments.*` family, `quality.*` family, `audit.*`, `reports.*`, `employees.edit` vs `employees.manage` — pick one verb), and mark every other document's list as "illustrative, see SECURITY.md".

## CRITICAL-2 — Pricing snapshot representation conflict

* **ID:** CRITICAL-2
* **Severity:** CRITICAL
* **Documents involved:** `PRICING_ENGINE.md` (§33, §35, §36), `DATABASE.md` (§16.3, §18.1), `BOOKING_SYSTEM.md` (§42), `LEGAL_COMPLIANCE.md` (§27), `REPORTING_SYSTEM.md` (§16/§90)
* **Exact concept affected:** Booking price snapshot.

* **Problem:** PRICING_ENGINE §33 defines the calculation result as returning `pricing_version_id` (and §35 states a confirmed booking stores `pricing_version_id`, `pricing_inputs_snapshot`, `pricing_result_snapshot` — three separate concepts). DATABASE §16.3 instead says booking pricing should store `pricing_profile_id`, `pricing_profile_version`, `price_snapshot` (a single blob named differently), and DATABASE §18.1 `bookings` has `pricing_profile_id` + `pricing_snapshot` columns with no version column. There is no `pricing_version_id` column in any DATABASE table, and no `pricing_versions` table exists in DATABASE §64's initial table set even though PRICING_ENGINE's entire versioning model (§"Pricing Profiles and Versioning", status `draft/published/archived`) depends on one.

* **Why it matters:** This is the highest-value financial invariant in the system ("never recalculate an old booking with today's rules" — DATABASE §16.3, PRICING_ENGINE §34–37, LEGAL_COMPLIANCE §27, ROADMAP rule 12). An implementer following DATABASE will build a versionless snapshot that cannot answer "which pricing version produced this?" — which PRICING_ENGINE §36 explicitly requires the snapshot to answer. A reporting/audit implementer will reach the opposite conclusion from a booking implementer.

* **Recommended resolution:** Choose one representation and propagate it. Either (a) add a `pricing_versions` table to DATABASE and change `bookings` to carry `pricing_version_id` + snapshot field(s) as PRICING_ENGINE specifies, or (b) declare `pricing_snapshot` in DATABASE to be the single JSONB container that embeds the version identifier and inputs/outputs, and restate PRICING_ENGINE §35 accordingly. Do not leave both.

---

# 4. High-Priority Findings

## HIGH-1 — `recurring_booking_plans`: future vs implemented

* **ID:** HIGH-1
* **Severity:** HIGH
* **Documents involved:** `DATABASE.md` (§22), `ROADMAP.md` (§32, Phase 3), `BACKGROUND_JOBS.md` (§26–28, job type `booking.recurring_generate`), `BOOKING_SYSTEM.md` (§41–43), `REPORTING_SYSTEM.md` (§30)
* **Exact concept affected:** Recurring booking plans and their generation.

* **Problem:** DATABASE §22 says "A future recurring booking model **may** use `recurring_booking_plans`" and excludes it from the MVP table priority (§65 includes it in the Bookings group but §65's prioritized list also contains it — while the narrative says "future"). ROADMAP Phase 3 lists "Recurring Services" as a deliverable; BACKGROUND_JOBS §26–28 and §63 define idempotency keys (`recurring-occurrence:{planId}:{occurrenceDate}`) and test requirements as if the feature exists. Neither STATE — future or MVP — is wrong per se, but the documents never agree on which one it is.

* **Why it matters:** An agent implementing Phase 1/2 foundations cannot tell whether to create the table now, and the background-jobs implementer will assume a table that may not exist yet.

* **Recommended resolution:** In DATABASE §22, replace "future ... may" with the roadmap position (planned for Phase 3, table created when Phase 3 opens, or created in the initial migration as dormant). Add a cross-reference in BACKGROUND_JOBS §26 to the roadmap phase.

## HIGH-2 — DATABASE §64 initial table set omits tables documented earlier in the same file and in domain docs

* **ID:** HIGH-2
* **Severity:** HIGH
* **Documents involved:** `DATABASE.md` (§16.3, §41, §64, §65), `PRICING_ENGINE.md`, `SECURITY.md`/`BOOKING_SYSTEM.md` (magic links), `PAYMENT_SYSTEM.md`, `NOTIFICATION_SYSTEM.md`, `SCHEDULING_SYSTEM.md`
* **Exact concept affected:** Initial table inventory.

* **Problem:** The "Initial Table Set" (§64) and "MVP Database Priority" (§65) omit:

  * `pricing_versions` (required by PRICING_ENGINE's versioning model; DATABASE §16.3 stores `pricing_profile_version` on the booking instead — see CRITICAL-2) — **RESOLVED (2026-09, implemented):** `pricing_profiles`, `pricing_versions`, and `pricing_rules` are created by migration `0010_pricing_engine.sql` (decision record P1–P22), listed in DATABASE §64/§65, and documented in DATABASE §16 with the canonical booking snapshot model (`pricing_version_id` + single `pricing_snapshot` jsonb);
  * any magic-link/token table or column (DATABASE §41 and BOOKING_SYSTEM §"Magic Link" describe tokens with expiry/scope/revocation, but no storage representation appears in §64);
  * `holds` / temporary slot holds (SCHEDULING_SYSTEM §"Temporary Holds" describes a hold record with expiry) — **RESOLVED (2026-09, implemented):** the scheduling table set appears in DATABASE §64/§65 and is created by migration `0009_scheduling_availability.sql` (`branch_operating_hours`, `branch_schedule_exceptions`, `branch_scheduling_configuration`, `service_scheduling_rules`, `slot_holds`);
  * `payment_attempts`/webhook events (PAYMENT_SYSTEM describes provider events, idempotency, and retries; only `payments` and `refunds` are listed);
  * `notification_outbox` or equivalent (NOTIFICATION_SYSTEM §"Outbox" and BACKGROUND_JOBS §11 require an outbox/job record; BACKGROUND_JOBS §6 defines the job record fields, but no table name appears in DATABASE);
  * `quality_checks`/`quality_issues` are listed in §64 under Quality but flagged "possible future tables" in §37 — acceptable, but the mixed signals should be cleaned up together with the above.

* **Why it matters:** §64/§65 are exactly the sections an implementer uses to build the first migrations. Omissions here become silently missing infrastructure (idempotency, holds, token security) that other documents mandate.

* **Recommended resolution:** Extend §64/§65 with the missing tables (or explicitly mark each as "deferred to phase X" so the omission is deliberate and visible).

## HIGH-3 — Payment method list conflicts on SEPA/PayPal and cash scope

* **ID:** HIGH-3
* **Severity:** HIGH
* **Documents involved:** `REQUIREMENTS.md` (§23), `ROADMAP.md` (§27), `PAYMENT_SYSTEM.md`, `LEGAL_COMPLIANCE.md`
* **Exact concept affected:** Supported payment methods.

* **Problem:** REQUIREMENTS §23 lists card, PayPal, SEPA, Apple Pay, Google Pay, bank transfer, "approved cash payments" — same as ROADMAP §27. Neither PAYMENT_SYSTEM nor LEGAL_COMPLIANCE defines which of these are in the MVP vs future, and "approved cash payments" contradicts the general financial-controls requirement that all money movements be auditable/provider-reconciled without a defined manual-cash workflow (PAYMENT_SYSTEM has `payments.record_manual` but no cash-handling policy). Also, REQUIREMENTS implies all seven methods are platform-supported; ROADMAP §27 correctly says "actual provider availability depends on market" — REQUIREMENTS lacks that caveat.

* **Why it matters:** Payment-method availability is branch/market configuration; an agent could hardcode the seven-method list as globally authoritative, violating the no-hardcoding rule.

* **Recommended resolution:** In REQUIREMENTS §23, align wording with ROADMAP ("potential methods; availability is branch/provider configuration") and add a pointer to PAYMENT_SYSTEM for the authoritative list.

## HIGH-4 — Booking state `FAILED` exists only in REQUIREMENTS

* **ID:** HIGH-4
* **Severity:** HIGH
* **Documents involved:** `REQUIREMENTS.md` (§12), `BOOKING_SYSTEM.md` (§29–30), `DATABASE.md` (§19), `PAYMENT_SYSTEM.md` (§10–11)
* **Exact concept affected:** Booking lifecycle states.

* **Problem:** REQUIREMENTS §12 lists booking states including `FAILED`; BOOKING_SYSTEM §29 and DATABASE §19 both define the state set as `draft/pending/confirmed/assigned/in_progress/completed/cancelled/no_show` — no `FAILED`. Nothing defines what a failed booking means, which transitions lead to it, or how it differs from `cancelled`. PAYMENT_SYSTEM explicitly separates payment failure from booking state.

* **Why it matters:** State machines must have exactly one definition. An implementer will either add an undefined state or drop a requirement.

* **Recommended resolution:** Either remove `FAILED` from REQUIREMENTS §12 (aligning with BOOKING_SYSTEM/DATABASE) or define its semantics in BOOKING_SYSTEM and add it to DATABASE §19. Given payment failure is deliberately not a booking state, removal is likely correct.

> **RESOLVED (2026-09, by owner decision BD-1 — Option A):** `FAILED` is not a
> persistent Booking lifecycle state in V1. `REQUIREMENTS.md` §12 and
> `ARCHITECTURE.md` §29 were corrected; the authoritative state set remains
> `BOOKING_SYSTEM.md` §29 / `DATABASE.md` §19 (draft, pending, confirmed,
> assigned, in_progress, completed, cancelled, no_show). A failed booking
> confirmation rolls back transactionally with no persisted booking and its
> slot hold released (SCHEDULING_SYSTEM §84; scheduling-availability spec);
> payment failure remains a payment-domain state (PAYMENT_SYSTEM §10–11).

## HIGH-5 — Cancellation fee presentation: percentage vs amount basis undefined

* **ID:** HIGH-5
* **Severity:** HIGH
* **Documents involved:** `BOOKING_SYSTEM.md` (§38–39), `LEGAL_COMPLIANCE.md` (§24), `PAYMENT_SYSTEM.md`, `REPORTING_SYSTEM.md` (§16)
* **Exact concept affected:** Cancellation fee tiers (`24h+ free / 12–24h 25% / 2–12h 50% / <2h 100%`).

* **Problem:** All three documents quote the same tier table, and LEGAL_COMPLIANCE §63 correctly requires "one authoritative business configuration." However, none defines whether the percentage applies to the booking total including tax and add-ons, whether tips are excluded, whether the fee becomes an invoice line, or how it interacts with payments already captured (refund vs charge). PAYMENT_SYSTEM's refund model assumes refunds of captured payments; a 25% fee on a not-yet-paid booking is a different flow.

* **Why it matters:** This is a money-calculation rule that multiple domains implement; ambiguity here produces incorrect refunds/charges.

* **Recommended resolution:** Add to BOOKING_SYSTEM §39 (or PAYMENT_SYSTEM): fee base (authoritative booking total from the price snapshot, excl. tips), behavior for unpaid vs paid bookings, and the requirement that the fee derive from the booking's stored cancellation-policy snapshot.

> **RESOLVED (2026-09, by owner decision BD-2):** the cancellation-fee basis
> is the booking's immutable pricing snapshot total (including applicable
> tax, excluding tips), rounded half-up to the currency minor unit; windows
> are measured to the scheduled service START with the confirmed interval
> reading (exactly 24h → 0%, exactly 12h → 25%, exactly 2h → 50%); the policy
> is branch-scoped, versioned, effective-dated, and snapshotted at booking
> confirmation; fee overrides use the dedicated `bookings.override`
> permission (HQ Admin only in V1) and are audited (actor, timestamp,
> booking, original fee, final fee, reason); customer cancellation is not
> permitted at/after the scheduled start (`no_show` is the post-start
> operational outcome); a non-zero fee on an unpaid cancelled booking becomes
> an amount owed by the customer — the collection mechanism remains deferred
> to Payment work. Normative text: `BOOKING_SYSTEM.md` §38–40, §83.

## Rescheduling policy drift — RESOLVED (2026-09, owner decision BD-3)

* **Concept:** Booking rescheduling — scope, states, deadlines, fees, pricing,
  and permission shape (`BOOKING_SYSTEM.md` §47–48, `REQUIREMENTS.md` BK-007,
  `ROADMAP.md` §13 vs §92 "rescheduling automation", `DATABASE.md` §19).
* **Problem:** Rescheduling was referenced across documents but never defined:
  no reschedule rows existed in the §30 transition table, §48's flow had no
  capacity-reservation step, ROADMAP listed reschedule as a Phase 1 magic-link
  capability while BOOKING_SYSTEM listed "rescheduling automation" as future
  without distinguishing the two, and BK-007 was permissive ("may include
  Reschedule").
* **Resolution (owner decisions BD-3.1–3.8, 2026-09):** rescheduling is V1 for
  both customers (magic link) and staff; reschedulable states are
  `confirmed`/`assigned` only; customer requests require ≥2h before the
  current `scheduled_start` (at/after start BD-2.5's prohibition and `no_show`
  apply); the target slot must satisfy the full 24-hour minimum-notice rule
  (no same-day targets); rescheduling is free (BD-2 tiers never apply to the
  reschedule operation) and unlimited; the cancellation window restarts from
  the new `scheduled_start`; price increases require explicit customer
  acceptance, decreases apply automatically with the new snapshot becoming
  authoritative (prior snapshots preserved as history); internal authority is
  the existing `bookings.edit` permission (hq_admin/hq_staff/branch_manager)
  — no `bookings.reschedule` permission was added, and `bookings.override`
  remains the HQ-Admin-only fee-override authority. `BOOKING_SYSTEM.md` §47–48
  are now normative; ROADMAP §13 now distinguishes manual V1 rescheduling from
  future automation. Normative text: `BOOKING_SYSTEM.md` §47–48.
* **Still open (technical, Change 5 design):** TD-3.1 hold strategy for the
  target slot (§48's flow as written has a check-then-commit gap), TD-3.2
  snapshot-history storage, TD-3.3 reschedule idempotency/concurrency scope,
  TD-3.4 event/audit payload schema, TD-3.5 notification trigger mapping.
  These remain open implementation-design items and are NOT resolved by the
  business policy decision.

## HIGH-6 — `employees.branch_id` single-branch column vs multi-branch employment

* **ID:** HIGH-6
* **Severity:** HIGH
* **Documents involved:** `DATABASE.md` (§23.1), `WORKER_SYSTEM.md`, `REQUIREMENTS.md` (§16, EM-003 "one or more authorized branches"), `SECURITY.md` (§ membership/branch model), `ROADMAP.md` (§53 international employment)
* **Exact concept affected:** Employee ↔ branch relationship.

* **Problem:** REQUIREMENTS EM-003 states employees "must be associated with one or more authorized branches." DATABASE §23.1 gives `employees` a single `branch_id` column, and PROJECT_RULES §3 lists `employees.branch_id` as the canonical branch-ownership example. Internal users get a many-to-many (`membership_branches`), but employees (who are the operationally multi-branch case per ROADMAP §53) get a scalar FK. WORKER_SYSTEM never resolves which model applies.

* **Why it matters:** RLS for cleaner job access and the assignment engine both derive branch authorization from the employee record; the two models produce different schemas and different policies.

* **Recommended resolution:** Decide now (a single nullable primary branch + a future `employee_branches` join table, or the join table from day one) and align DATABASE §23.1 with EM-003.

---

# 5. Medium Findings

## MEDIUM-1 — Notification event vocabulary drift

* **ID:** MEDIUM-1
* **Severity:** MEDIUM
* **Documents involved:** `NOTIFICATION_SYSTEM.md` (§ event catalog), `DATABASE.md` (§33.1), `BOOKING_SYSTEM.md` (§ events), `REQUIREMENTS.md` (§26), `QUALITY_SYSTEM.md` (§64), `AUDIT_SYSTEM.md`
* **Exact concept affected:** Domain event names (`booking_created` vs `booking.created`; `invoice_created` vs `invoice_issued`).

* **Problem:** NOTIFICATION_SYSTEM and DATABASE use underscore business-event names (`booking_confirmed`, `invoice_issued`); AUDIT_SYSTEM and BACKGROUND_JOBS use dotted names (`booking.created`, `invoice.issued`) for their own domains; QUALITY_SYSTEM §64 emits `complaint_created`, `quality_issue_created` (underscore) while the audit convention is dotted. REQUIREMENTS §26 adds `Cleaner Check-In` as a notification event that no other catalog includes. The dot-vs-underscore split is arguably two vocabularies by design (audit actions vs business events), but the documents never state that distinction explicitly, and `invoice_created` (DATABASE) vs `invoice_issued` (NOTIFICATION_SYSTEM) is a genuine name conflict within the underscore family.

* **Why it matters:** Event names are wire contracts between domains, outbox records, and templates; drift breaks routing.

* **Recommended resolution:** Add a short "event naming" note: audit actions use `resource.action` (dotted, AUDIT_SYSTEM is authoritative); business/notification events use the underscore catalog with NOTIFICATION_SYSTEM as authoritative; reconcile `invoice_created` → `invoice_issued`; add or drop `cleaner_check_in` deliberately.

## MEDIUM-2 — Two review-eligibility statements differ in strictness

* **ID:** MEDIUM-2
* **Severity:** MEDIUM
* **Documents involved:** `QUALITY_SYSTEM.md` (§6, §74), `REQUIREMENTS.md` (§22), `ROADMAP.md` (§24)
* **Exact concept affected:** Review eligibility timing.

* **Problem:** QUALITY_SYSTEM §6 requires "booking **completed**" and §74 MVP confirms; ROADMAP §24 says reviews "should become available after completed service" (consistent), but REQUIREMENTS §22 says only "after completed services" without the enforcement checklist (ownership, completion, uniqueness). Minor, but REQUIREMENTS is the requirements-of-record and omits the duplicate-review protection that QUALITY_SYSTEM §7 mandates.

* **Why it matters:** Duplicate-review prevention is a database uniqueness requirement; if it's absent from REQUIREMENTS, traceability (REQUIREMENTS §50) breaks.

* **Recommended resolution:** Add a duplicate-prevention/one-review-per-booking requirement bullet to REQUIREMENTS §22 referencing QUALITY_SYSTEM §7.

## MEDIUM-3 — `services` ownership: organization vs branch

* **ID:** MEDIUM-3
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§15.1, §62, §43), `PROJECT_RULES.md` (§3), `REQUIREMENTS.md` (§30), `BRANCH_SYSTEM.md` (§36), `SEARCH_DISCOVERY.md` (§7)
* **Exact concept affected:** Service catalog scope.

* **Problem:** DATABASE §15.1 gives `services` both `organization_id` and `branch_id` and indexes `services.branch_id`; PROJECT_RULES §3 lists `services.branch_id`; BRANCH_SYSTEM §36 says authorized administrators manage services with branch availability; SEARCH_DISCOVERY §7 says "a service existing globally does not automatically mean it is bookable at every branch" — implying a global catalog plus per-branch availability. The documents never define the actual model: service-per-branch rows vs global services + `branch_services` availability join.

* **Why it matters:** This is a core catalog model; the wrong guess requires a painful migration and affects pricing profile linkage.

* **Recommended resolution:** State the intended model in DATABASE §15 (recommended reading of the current text: per-branch service rows for MVP, with the global-catalog evolution noted as future).

## MEDIUM-4 — Locales: `branches.locale` singular vs multi-locale websites

* **ID:** MEDIUM-4
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§11.1, §13.2), `BRANCH_SYSTEM.md` (§14, branch creation fields incl. "default locale / enabled locales"), `LOCALIZATION.md`, `LEGAL_COMPLIANCE.md` (§67)
* **Exact concept affected:** Branch locale configuration.

* **Problem:** DATABASE `branches` has a single `locale` column while BRANCH_SYSTEM's branch-creation flow collects "default locale **and enabled locales**", and the multi-locale model properly lives in `website_locales` (DATABASE §13.2). The singular column invites implementers to skip `website_locales`.

* **Why it matters:** Two sources for "which languages does this branch support" produce divergent rendering and provisioning behavior.

* **Recommended resolution:** In DATABASE §11.1, mark `branches.locale` as the default locale only and cross-reference `website_locales` as the enabled-locale source of truth.

## MEDIUM-5 — Employment types: `on_call` appears only in DATABASE

* **ID:** MEDIUM-5
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§23.1), `WORKER_SYSTEM.md`, `REQUIREMENTS.md` (§38 of LEGAL_COMPLIANCE), `ROADMAP.md` (§19), `LEGAL_COMPLIANCE.md` (§38)
* **Exact concept affected:** Employment type enumeration.

* **Problem:** DATABASE lists `full_time, part_time, minijob, flexible, on_call`; WORKER_SYSTEM, ROADMAP, and LEGAL_COMPLIANCE list only `part_time, minijob, flexible, full_time`. `on_call` is either a database-only extrapolation or an omission elsewhere.

* **Why it matters:** Small, but employment types feed legal/compliance categorization (LEGAL_COMPLIANCE §37–38); an unexplained extra value is a compliance question, not just a typo.

* **Recommended resolution:** Remove `on_call` from DATABASE or add it to the other three lists with a note that its legal validity is jurisdiction-dependent.

## MEDIUM-6 — Audit log payload style: `old_data/new_data` vs bounded metadata

* **ID:** MEDIUM-6
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§38.1), `AUDIT_SYSTEM.md` (§21–25)
* **Exact concept affected:** Audit record metadata.

* **Problem:** DATABASE's `audit_logs` sketch includes `old_data`/`new_data` columns; AUDIT_SYSTEM §24–25 mandates structured, bounded metadata and warns against copying "entire database rows" into audit records. Unbounded `old_data/new_data` JSONB invites exactly that.

* **Why it matters:** Direct tension between the schema sketch and the governance rule; an implementer following DATABASE will build the thing AUDIT_SYSTEM prohibits.

* **Recommended resolution:** Annotate DATABASE §38.1: `old_data/new_data` must hold only allowlisted field diffs per AUDIT_SYSTEM §22–25, not full rows.

## MEDIUM-7 — Customer identity model: `profiles` scope and customer↔auth linkage

* **ID:** MEDIUM-7
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§8 Identity, §17.1), `SECURITY.md`, `BOOKING_SYSTEM.md`, `REQUIREMENTS.md` (BK-002)
* **Exact concept affected:** `profiles` vs `customers`; magic-link identity.

* **Problem:** DATABASE defines `profiles`/`memberships` for internal users and `customers` (no `user_id`) for customers, which matches "no mandatory account." But nothing states whether a magic-link-verified customer may later be linked to an auth identity (rebooking convenience, saved addresses), and `customers.primary_branch_id` + organization-scoped customers leaves the "same person books in two branches" case (acknowledged in §17.1) without a dedup rule (email-unique per organization? per branch?).

* **Why it matters:** Customer dedup/linkage is hard to retrofit and affects RLS for customer-owned rows.

* **Recommended resolution:** Add a short DATABASE §17.3: customer uniqueness rule (e.g., unique `(organization_id, lower(email))`) and explicit statement that customer↔user linking is a future capability.

## MEDIUM-8 — Invoice status lifecycle undocumented

* **ID:** MEDIUM-8
* **Severity:** MEDIUM
* **Documents involved:** `DATABASE.md` (§32.1), `PAYMENT_SYSTEM.md` (§ invoices), `REQUIREMENTS.md` (§25), `REPORTING_SYSTEM.md` (§66), `LEGAL_COMPLIANCE.md` (§31)
* **Exact concept affected:** Invoice status values/lifecycle.

* **Problem:** Every document references invoice status (REPORTING_SYSTEM §66 even lists `issued/paid/overdue/cancelled/refunded`), but no document defines the authoritative invoice state machine. DATABASE §32.1 has a `status` column with no enumeration; PAYMENT_SYSTEM defines payment states but not invoice states.

* **Why it matters:** Invoice status drives overdue handling, reporting, and dunning reminders (BACKGROUND_JOBS §33).

* **Recommended resolution:** Add an invoice status section to PAYMENT_SYSTEM (draft/issued/paid/overdue/cancelled/voided + transitions) and reference it from DATABASE §32.1.

## MEDIUM-9 — Availability hold model vs booking draft/pending duplication

* **ID:** MEDIUM-9
* **Severity:** MEDIUM
* **Documents involved:** `SCHEDULING_SYSTEM.md` (§ holds), `BOOKING_SYSTEM.md` (§31–32), `API_STANDARDS.md` (§26)
* **Exact concept affected:** Slot reservation during checkout.

* **Problem:** SCHEDULING_SYSTEM defines temporary slot holds; BOOKING_SYSTEM defines `draft` and `pending` booking states ("pending ... depends on the selected payment/confirmation model"). The relationship — does a hold create a draft booking? does `pending` hold the slot? — is never stated, so two overlapping reservation mechanisms could both be built.

* **Why it matters:** Double reservation logic causes subtle availability bugs and ghost slots.

* **Recommended resolution:** Add one paragraph to BOOKING_SYSTEM §32: whether `pending` bookings place a hold, and that holds expire independently of booking drafts.

> **RESOLVED (2026-09, by decision — implemented and hosted-verified in Change 3):** the approved
> scheduling decision record resolves this in favor of a single mechanism:
> scheduling-owned temporary slot holds are the only capacity-blocking
> reservation in V1; booking drafts do not block; no persisted blocking
> `pending` state exists. Normative text: `SCHEDULING_SYSTEM.md` §84
> (decision S1). Implemented by migration `0009_scheduling_availability.sql`
> and `features/scheduling/` (hold lifecycle: idempotent creation, one active
> hold per session, DB-clock TTL, read-time expiry + sweep, atomic
> consumption); hosted verification passed (Change 3 task 13:
> 12/12 scheduling tests, 43/43 full hosted suite).

## MEDIUM-10 — README/docs filename drift and dead references

* **ID:** MEDIUM-10
* **Severity:** MEDIUM
* **Documents involved:** `README.md` (§7), `ARCHITECTURE.md` (doc map), `ROADMAP.md` (§5 Phase 0), `PROJECT_STRUCTURE.md` (§53)
* **Exact concept affected:** Document map / cross-references.

* **Problem:** README §7 lists `ROLES_PERMISSIONS.md`, `CUSTOMER_SYSTEM.md`, `COMPONENT_STANDARDS.md`, `WEBSITE_SYSTEM.md`, `DEPLOYMENT.md`, `OBSERVABILITY.md`, `ROADMAP.md` — but the set on disk uses different names for several of these (e.g., no `ROLES_PERMISSIONS.md`, no `CUSTOMER_SYSTEM.md`, no `COMPONENT_STANDARDS.md`, no `WEBSITE_SYSTEM.md`), and omits files that exist (`API_STANDARDS.md`, `BACKGROUND_JOBS.md`, `SEARCH_DISCOVERY.md`, `MEDIA_STORAGE.md`, `LEGAL_COMPLIANCE.md`, `PROJECT_STRUCTURE.md`, `SECURITY_PRIVACY.md`, etc.). `ARCHITECTURE.md` line 531 references `docs/ROLES_PERMISSIONS.md`, which does not exist.

* **Why it matters:** Agents navigate by these maps; dead references cause wrong-context implementations.

* **Recommended resolution:** Regenerate README §7 and ARCHITECTURE's doc map from the actual `docs/` listing; decide whether `ROLES_PERMISSIONS.md` should be extracted from SECURITY.md (then fix the reference) or SECURITY.md remains authoritative (then fix the reference to point there).

---

# 6. Low Findings

## LOW-1 — Project numbering style inconsistency

* **ID:** LOW-1
* **Severity:** LOW
* **Documents involved:** `REQUIREMENTS.md`, `AUDIT_SYSTEM.md`, `API_STANDARDS.md`, `OBSERVABILITY.md`, `BACKGROUND_JOBS.md`, `SEARCH_DISCOVERY.md`, `MEDIA_STORAGE.md`, `LEGAL_COMPLIANCE.md`, `ROADMAP.md`, `PROJECT_STRUCTURE.md` (use `# 1.` style); `PROJECT_RULES.md`, `VISION.md`, `ARCHITECTURE.md`, `DATABASE.md` etc. (use `## 1.` / `# 1.` mixed)
* **Exact concept affected:** Heading hierarchy.
* **Problem:** Some documents use `# N.` for sections directly under the title, others use `## N.`; a few mix both (`DATABASE.md` uses `# 10.` and `## 10.1` correctly, others vary).
* **Why it matters:** Purely cosmetic; no architectural impact.
* **Recommended resolution:** Optional lint pass; do not block anything.

## LOW-2 — `VISION.md` retains §18 AI / §19 Multilingual numbering duplicated with earlier sections

* **ID:** LOW-2
* **Severity:** LOW
* **Documents involved:** `VISION.md`
* **Exact concept affected:** Section numbering after the merge of the two vision revisions.
* **Problem:** The merged document contains overlapping section themes between the original 17 sections and the appended AI/Multilingual sections; some cross-references inside VISION may be ambiguous.
* **Why it matters:** Readability only.
* **Recommended resolution:** Optional renumber pass.

## LOW-3 — Currency examples mix EUR and XAF/USD

* **ID:** LOW-3
* **Severity:** LOW
* **Documents involved:** `REPORTING_SYSTEM.md` (§14), `PRICING_ENGINE.md` (§30), `PAYMENT_SYSTEM.md` (§13)
* **Exact concept affected:** Example currencies.
* **Problem:** REPORTING_SYSTEM uses `EUR/XAF/USD` as multi-country examples while other docs use EUR-only examples. All documents correctly forbid hardcoding currency, so this is example drift only.
* **Why it matters:** None architecturally.
* **Recommended resolution:** None required; optionally standardize examples.

## LOW-4 — `SEARCH_DISCOVERY.md` branch URL example `/clenqo/berlin` vs `/berlin`

* **ID:** LOW-4
* **Severity:** LOW
* **Documents involved:** `SEARCH_DISCOVERY.md` (§6), `DATABASE.md` (§11.1), `BRANCH_SYSTEM.md` (§23)
* **Exact concept affected:** Public branch route.
* **Problem:** SEARCH_DISCOVERY shows both `/clenqo/berlin` and `/berlin`; BRANCH_SYSTEM/DATABASE establish `clenqo.com/{branch-slug}` (i.e., `/berlin`) with the domain as environment configuration. The dual example could be read as a route prefix decision.
* **Why it matters:** Minor routing ambiguity.
* **Recommended resolution:** Trim SEARCH_DISCOVERY §6 to the canonical `/berlin` example.

## LOW-5 — `QUALITY_SYSTEM.md` §24 target "4.7★" and ROADMAP §68 repeat business KPIs in different phrasing

* **ID:** LOW-5
* **Severity:** LOW
* **Documents involved:** `QUALITY_SYSTEM.md` (§24), `ROADMAP.md` (§68)
* **Exact concept affected:** Business KPI values.
* **Problem:** Both correctly mark these as business targets rather than application constants; the phrasing differs slightly. No conflict.
* **Why it matters:** None.
* **Recommended resolution:** None.

---

# 7. Cross-Domain Consistency Matrix

Authoritative document (A) = the document that should win when documents disagree. Dependencies list the upstream documents each domain relies on.

| Domain | Authoritative doc(s) | Depends on | Consistency status |
|--------|---------------------|------------|--------------------|
| Branches | `BRANCH_SYSTEM.md` + `DATABASE.md` §10–12 | PROJECT_RULES, ARCHITECTURE | **Consistent** (lifecycle `draft→provisioning→ready→active→suspended→archived` matches across BRANCH_SYSTEM, AUDIT_SYSTEM, TESTING_STRATEGY, ROADMAP; provisioning fields differ slightly — MEDIUM-4 locale) |
| Authorization | `SECURITY.md` (intended) | BRANCH_SYSTEM, all domains | **Conflict** — three permission catalogs (CRITICAL-1); membership/branch model consistent (`memberships` + `membership_branches`) |
| Website/CMS | `CONTENT_SYSTEM.md` + `ADMIN_SYSTEM.md` + `DATABASE.md` §13 | DESIGN_SYSTEM, BRANCH_SYSTEM | **Consistent** (section registry, draft/publish, inheritance Platform→Org→Branch→Page stated identically in CONTENT_SYSTEM, ADMIN_SYSTEM, BRANCH_SYSTEM §27/§69) |
| Localization | `LOCALIZATION.md` + `DATABASE.md` §13.2 | CONTENT_SYSTEM, BRANCH_SYSTEM | **Mostly consistent** (fallback chain identical everywhere; branches.locale vs website_locales — MEDIUM-4) |
| Services | `DATABASE.md` §15 + `BRANCH_SYSTEM.md` §36 | PRICING, SCHEDULING | **Ambiguous ownership model** (MEDIUM-3) |
| Pricing | `PRICING_ENGINE.md` | DATABASE, BOOKING, LEGAL_COMPLIANCE | **Conflict on snapshot representation** (CRITICAL-2); determinism/versioning otherwise consistent |
| Availability | `SCHEDULING_SYSTEM.md` | WORKER_SYSTEM, BOOKING, BRANCH_SYSTEM | **Consistent** (server-side calculation, DST/timezone, concurrency re-check in SCHEDULING_SYSTEM, BOOKING_SYSTEM §"Availability Recheck", API_STANDARDS §28) |
| Booking | `BOOKING_SYSTEM.md` + `DATABASE.md` §18–21 | PRICING, SCHEDULING, CUSTOMERS | **Conflict on `FAILED` state** (HIGH-4); state machine otherwise consistent |
| Workforce | `WORKER_SYSTEM.md` + `DATABASE.md` §23–25 | SECURITY (branch scope) | **Ambiguity** on employee↔branch model (HIGH-6); employment types drift (MEDIUM-5) |
| Jobs | `WORKER_SYSTEM.md` + `DATABASE.md` §26–29 | BOOKING, SCHEDULING | **Consistent** (job states `pending→assigned→en_route→checked_in→in_progress→completed/cancelled` identical in both; incidents table matches) |
| Payments | `PAYMENT_SYSTEM.md` + `DATABASE.md` §30–31 | PRICING, BOOKING | **Consistent** (states `pending→authorized→paid→partially_refunded→refunded/failed/cancelled`; amount from price snapshot; no card storage) — method list caveat HIGH-3 |
| Finance | `PAYMENT_SYSTEM.md` | BOOKING, LEGAL_COMPLIANCE | **Gap**: invoice status lifecycle undefined (MEDIUM-8) |
| Notifications | `NOTIFICATION_SYSTEM.md` + `DATABASE.md` §33–35 | All domains (event producers) | **Vocabulary drift** (MEDIUM-1); outbox/job storage missing from DATABASE table set (HIGH-2) |
| Quality | `QUALITY_SYSTEM.md` + `DATABASE.md` §36–37 | BOOKING, WORKER | **Consistent**; permission naming diverges (CRITICAL-1); duplicate-review requirement missing from REQUIREMENTS (MEDIUM-2) |
| Reporting | `REPORTING_SYSTEM.md` | All domains (read-only) | **Consistent** (read-oriented, domain-authoritative, sample-size rules); permission family not in SECURITY (CRITICAL-1) |
| Audit | `AUDIT_SYSTEM.md` + `DATABASE.md` §38 | All domains | **Consistent** (`resource.action`, append-only, actor types); payload style tension (MEDIUM-6) |
| Security/Privacy | `SECURITY_PRIVACY.md` (broad) + `SECURITY.md` (authz) | All | **Consistent** after cross-reference fixes; see CRITICAL-1 for the permission catalog |
| Storage/Media | `MEDIA_STORAGE.md` + `DATABASE.md` §14 | SECURITY, WORKER, CONTENT | **Consistent** (private-by-default, server-controlled paths, signed URLs; `media_assets` matches `media_asset` field sketch) |
| Background jobs | `BACKGROUND_JOBS.md` | NOTIFICATION, BRANCH, PAYMENT | **Consistent** (outbox vs job distinction, idempotency keys, dead-letter); underlying tables missing in DATABASE (HIGH-2); recurring linkage HIGH-1 |
| API | `API_STANDARDS.md` | All domains | **Consistent** (thin routes → domain services; typed errors; idempotency checklist); search-endpoint guidance matches SEARCH_DISCOVERY §60 |
| Deployment | `DEPLOYMENT.md` | PROJECT_STRUCTURE, TESTING | **Consistent** (Vercel/Supabase, migration workflow, smoke tests); no Docker — matches ROADMAP §81 |
| Project structure | `PROJECT_STRUCTURE.md` | ARCHITECTURE | **Consistent** (feature modules, domain list matches DATABASE §63 domain boundaries) |

---

# 8. State Machine Review

## 8.1 Documented lifecycles

**Branch lifecycle** (BRANCH_SYSTEM §18–19, AUDIT_SYSTEM §45, DATABASE §11.1, TESTING_STRATEGY §67, ROADMAP §36):

```text
draft → provisioning → ready → active → suspended → archived
```

Provisioning sub-status (BRANCH_SYSTEM §18): `pending / provisioning / ready / failed`. **Consistent** across all five documents. Note `failed` exists only in the provisioning sub-lifecycle, not the branch lifecycle — intentional and coherent.

**Booking lifecycle** (BOOKING_SYSTEM §29–30, DATABASE §19):

```text
draft → pending → confirmed → assigned → in_progress → completed
cancelled (from pending/confirmed/assigned)
no_show
```

REQUIREMENTS §12 adds `FAILED` — **mismatch (HIGH-4)**. `no_show` appears in both BOOKING_SYSTEM and DATABASE but has no transition rules anywhere; REQUIREMENTS doesn't list it. **Flag: define no_show transitions in BOOKING_SYSTEM §30.**

**Job lifecycle** (WORKER_SYSTEM §19–20, DATABASE §26):

```text
pending → assigned → en_route → checked_in → in_progress → completed
cancelled (permitted states)
```

**Consistent** between the two documents. Booking↔job mapping: booking `assigned` ↔ job `assigned`; booking `in_progress` ↔ job `checked_in/in_progress`; booking `completed` ↔ job `completed`. The booking state is driven by job state per WORKER_SYSTEM §35 (check-in triggers in_progress) — consistent with BOOKING_SYSTEM §35. **Consistent.**

**Assignment lifecycle** (WORKER_SYSTEM §22, DATABASE §27.1):

```text
pending → accepted → active → completed
                ↘ declined
cancelled (from permitted states)
```

**Consistent** (WORKER_SYSTEM prose = DATABASE columns `assigned_at/accepted_at/declined_at`). Minor flag: neither document defines whether `active` begins at check-in or at acceptance — one sentence would remove ambiguity.

**Payment lifecycle** (PAYMENT_SYSTEM §10–11, DATABASE §30.1):

```text
pending → authorized → paid
pending → failed
paid → partially_refunded → refunded
cancelled
```

**Consistent.** Payment state explicitly separate from booking state (PAYMENT_SYSTEM §51) — consistent with BOOKING_SYSTEM and API_STANDARDS §29.

**Invoice lifecycle** (REPORTING_SYSTEM §66 implies `issued/paid/overdue/cancelled/refunded`; DATABASE §32.1 has `status` with no values): **No authoritative definition (MEDIUM-8).**

**Notification delivery lifecycle** (NOTIFICATION_SYSTEM § lifecycle, DATABASE §35.1):

```text
queued → sending → sent → delivered
queued → failed → retry(→ dead-letter) → failed
```

BACKGROUND_JOBS §7 job states (`pending/processing/completed/failed/retrying/cancelled/dead_letter`) align with the delivery/retry model. **Consistent.**

**Review lifecycle** (QUALITY_SYSTEM §12: `pending/published/hidden/flagged/removed`, "exact lifecycle may evolve"; DATABASE §36.1 has `status` + `published_at` with no enumeration): **Documented in QUALITY_SYSTEM only; DATABASE should reference it.** Minor.

**Provisioning lifecycle** (BRANCH_SYSTEM §17–18, BACKGROUND_JOBS §29–30, AUDIT_SYSTEM §46–48):

```text
pending → provisioning → ready
                    ↘ failed → (retry, idempotent) → provisioning → ready
```

**Consistent** including failure/retry semantics and the rule that `ready` must not be assigned on partial failure.

**Background job lifecycle** (BACKGROUND_JOBS §7–8):

```text
pending → processing → completed
pending → processing → failed → retrying → processing (bounded)
processing → failed → dead_letter
cancelled
```

**Internally consistent**; matches observability §46 and manual-recovery §57.

## 8.2 Mismatches flagged

1. Booking `FAILED` (HIGH-4).
2. Booking `no_show` transitions undefined.
3. Invoice statuses undefined (MEDIUM-8).
4. Review status enumeration not reflected in DATABASE (minor).
5. Assignment `active` start condition ambiguous (minor).

---

# 9. Data Model Coverage

Legend: ✅ documented with fields · ⚠️ concept documented, representation missing/ambiguous · ❌ not represented.

## 9.1 Concept → database representation

| Business concept | Source doc(s) | Expected representation | Status |
|---|---|---|---|
| Organization | DATABASE §10 | `organizations` | ✅ |
| Branch | DATABASE §11 | `branches` | ✅ |
| Internal user identity | DATABASE §8 | `profiles` | ✅ |
| Membership / role | SECURITY §20, DATABASE §8 | `memberships` | ✅ |
| Branch scope for staff | SECURITY §20, DATABASE §9 | `membership_branches` | ✅ |
| Employee | DATABASE §23 | `employees` | ⚠️ multi-branch model unresolved (HIGH-6) |
| Employee skills / availability / exceptions | DATABASE §24–25 | `employee_skills`, `employee_availability`, `employee_availability_exceptions` | ✅ |
| Customer | DATABASE §17 | `customers`, `customer_addresses` | ⚠️ uniqueness/linkage rule missing (MEDIUM-7) |
| Service catalog | DATABASE §15 | `services`, `service_translations`, `service_variants`, `service_addons` | ⚠️ per-branch vs global model ambiguous (MEDIUM-3) |
| Pricing profile | DATABASE §16, PRICING_ENGINE | `pricing_profiles`, `pricing_rules` | ✅ |
| Pricing version | PRICING_ENGINE §versioning | `pricing_versions` | ✅ implemented (Change 4A, migration 0010; HIGH-2 pricing residue closed) |
| Booking | DATABASE §18 | `bookings` | ⚠️ snapshot columns conflict (CRITICAL-2) |
| Booking items | DATABASE §20 | `booking_items` | ✅ |
| Booking events | DATABASE §21 | `booking_events` | ✅ |
| Recurring plans | DATABASE §22 | `recurring_booking_plans` | ⚠️ future-vs-MVP status unclear (HIGH-1) |
| Slot holds | SCHEDULING_SYSTEM § holds | hold table/record | ❌ **not in DATABASE table set** (HIGH-2) |
| Jobs / assignments | DATABASE §26–27 | `jobs`, `job_assignments` | ✅ |
| Incidents | DATABASE §29 | `incidents` | ✅ |
| Payments / refunds | DATABASE §30–31 | `payments`, `refunds` | ✅ |
| Provider events / payment retries | PAYMENT_SYSTEM §webhooks/retries | provider-event or attempt records | ❌ **not represented** (HIGH-2) |
| Invoices | DATABASE §32 | `invoices` | ⚠️ status enumeration missing (MEDIUM-8) |
| Notification events/templates/deliveries | DATABASE §33–35 | `notification_events`, `notification_templates`, `notification_deliveries` | ✅ |
| Outbox / background jobs | BACKGROUND_JOBS §6, §11 | job/outbox table | ❌ **not in DATABASE table set** (HIGH-2) |
| Magic-link tokens | DATABASE §41, BOOKING_SYSTEM | token storage (hash, expiry, scope) | ❌ **not represented** (HIGH-2) |
| Reviews | DATABASE §36 | `reviews` | ✅ |
| Quality checks/issues | DATABASE §37, QUALITY_SYSTEM | `quality_checks`, `quality_check_items`, `quality_issues` | ✅ (flagged future) |
| Complaints | QUALITY_SYSTEM §26 | complaint record | ⚠️ QUALITY_SYSTEM defines fields; DATABASE §37 lists quality tables without a complaints table — clarify whether complaints are quality_issues rows or separate |
| Audit logs | DATABASE §38 | `audit_logs` | ⚠️ payload style tension (MEDIUM-6) |
| Media | DATABASE §14, MEDIA_STORAGE §7 | `media_assets` | ✅ |
| Website content | DATABASE §13 | `branch_websites`, `website_locales`, `website_pages`, `website_page_translations`, `website_sections` | ✅ |
| CMS section registry | CONTENT_SYSTEM, ADMIN_SYSTEM | section registry (config/code) + `website_sections.content` jsonb | ✅ |
| Consent records | LEGAL_COMPLIANCE §13 | consent record | ❌ not in DATABASE (acceptable for MVP per LEGAL_COMPLIANCE §82 — mark as future) |
| Feature flags | BRANCH_SYSTEM §84, PROJECT_STRUCTURE §111 | flag storage | ⚠️ explicitly future; fine, but no owner document |

## 9.2 Concepts that should **not** be persisted (confirmed correct)

* Cleaner check-in locations — WORKER_SYSTEM §32 correctly keeps this optional/purpose-limited.
* Raw card data/CVV — prohibited everywhere (PAYMENT_SYSTEM §8, SECURITY_PRIVACY, LEGAL_COMPLIANCE §29). Consistent.
* Raw magic-link token values — DATABASE §41 says store hash. Consistent.
* Image binaries — DATABASE §14/§28 and WORKER_SYSTEM §40 keep bytes in Storage. Consistent.

## 9.3 Duplicated ownership risks

* **Booking totals vs payments/invoices:** DATABASE `bookings` stores `subtotal/.../total` while PAYMENT_SYSTEM §52 prefers deriving financial state from financial records. Not a contradiction (booking total = commercial quote snapshot; payments = money movement), but the docs should state that `bookings.total` is the snapshot of the price snapshot, never independently mutable.
* **Branch locale:** `branches.locale` vs `website_locales` (MEDIUM-4).
* **Audit vs activity timeline:** correctly separated in AUDIT_SYSTEM §3; DATABASE has only `audit_logs` — activity views are derived, no extra table needed. Consistent.

---

# 10. Authorization Coverage

Baseline model (consistent across SECURITY, DATABASE §39–40, PROJECT_RULES, API_STANDARDS §7–11): Supabase Auth → `memberships` (org) → `membership_branches` (branch scope) → `resource.action` permissions → server-side checks → RLS as defense in depth. Active branch context is explicitly not authorization (BRANCH_SYSTEM §11, API_STANDARDS §9, SECURITY_PRIVACY §10). This chain is well-aligned.

Per-domain gaps:

| Domain | Role access | Branch scope | Org scope | Resource scope | RLS expectations | Server-side authz | Gap |
|--------|------------|--------------|-----------|----------------|------------------|-------------------|-----|
| Bookings | HQ/BranchManager/Cleaner(assigned)/Customer(own) | ✅ | ✅ | ✅ | ✅ (bookings.branch_id, customer_id) | ✅ | permission verb conflicts (CRITICAL-1) |
| Customers | HQ/BranchManager | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Services/pricing | HQ (+branch where delegated) | ✅ | ✅ | n/a | ✅ (pricing_profiles.branch_id) | ✅ | CRITICAL-1 pricing verbs |
| Workforce/jobs | Manager/Cleaner(assigned) | ✅ | ✅ | ✅ (assigned job) | ⚠️ | ✅ | **RLS for `employees`/`jobs` rows is described only generically** ("assigned jobs / permitted operational records", DATABASE §39); no concrete policy sketch for job_assignments. One paragraph would help. |
| Payments/invoices | HQ/Branch(finance) | ✅ | ✅ | ✅ | ✅ | ✅ | verb conflicts (CRITICAL-1) |
| Notifications | system/branch | ✅ | ✅ | n/a | ⚠️ | ✅ | no RLS note for `notification_deliveries` (contains recipient emails) — add to DATABASE §35 |
| Quality/reviews | Manager moderation | ✅ | ✅ | ✅ | ✅ | ✅ | CRITICAL-1 quality verbs |
| Website/CMS | HQ global / branch content | ✅ | ✅ | draft vs published | ⚠️ | ✅ | no explicit RLS note for `website_sections` drafts — ADMIN_SYSTEM relies on server checks; one line in DATABASE §13 would close it |
| Media/storage | role+purpose | ✅ | ✅ | owner-scoped | ✅ via storage policies | ✅ | consistent |
| Audit | HQ/view_branch | ✅ | ✅ | resource-linked | ✅ append-only | ✅ | consistent |
| Reporting | permission families | ✅ | ✅ | n/a | aggregate access | ✅ | CRITICAL-1 reports verbs |
| Search | mirrors source domain | ✅ | ✅ | ✅ | ✅ (must be RLS-compatible) | ✅ | consistent |
| Background jobs | automation actors | ✅ | ✅ | ✅ | ✅ (must not bypass) | ✅ (actor_type audit) | consistent |

**Summary:** The authorization *architecture* is consistent; the *catalog* is not (CRITICAL-1), and three tables lack even generic RLS notes (jobs/assignments, notification_deliveries, website drafts).

---

# 11. API Coverage

Cross-check of important workflows against `API_STANDARDS.md` (domain services + thin Server Actions/Route Handlers):

| Workflow | Server contract documented? | Where | Gap |
|---|---|---|---|
| Branch creation/provisioning | ✅ | API_STANDARDS §32 (`branchService.createAndProvision`), BRANCH_SYSTEM §15, DATABASE §12 | Idempotency and status behavior consistent |
| CMS editing/publishing | ✅ | API_STANDARDS §31, ADMIN_SYSTEM, CONTENT_SYSTEM | Publish includes cache invalidation + audit — consistent |
| Pricing quote | ✅ | API_STANDARDS §27 (`pricingService.calculateQuote`), PRICING_ENGINE §33 | Result fields match PRICING_ENGINE's contract — good |
| Availability check | ✅ | API_STANDARDS §28, SCHEDULING_SYSTEM | "informational until final confirmation" stated in both — good |
| Booking creation | ✅ | API_STANDARDS §26 (full server-side chain), BOOKING_SYSTEM | Consistent incl. price snapshot |
| Booking state transitions | ✅ | API_STANDARDS §29 (`create/confirm/reschedule/cancel/assign/start/complete/markNoShow`) | `markNoShow` present here and in neither state machine doc — add `no_show` transitions (see §8) |
| Assignment | ⚠️ | API_STANDARDS §71 (Cleaner + Admin priorities), WORKER_SYSTEM §24 | No dedicated "assignment contract" section in API_STANDARDS (validation rules live in WORKER_SYSTEM §23) — acceptable, minor |
| Payments | ✅ | API_STANDARDS §33 (adapter isolation), PAYMENT_SYSTEM | Consistent |
| Webhooks | ✅ | API_STANDARDS §34 (9-step webhook contract), PAYMENT_SYSTEM §webhooks, BACKGROUND_JOBS §32 | Three consistent descriptions |
| Customer magic links | ✅ | API_STANDARDS §30, BOOKING_SYSTEM, DATABASE §41 | Consistent (scope, expiry, rate limit) |
| Notifications | ✅ | API_STANDARDS §35 (event → notification pipeline), NOTIFICATION_SYSTEM | Consistent |
| Search | ✅ | API_STANDARDS §54–57 (reporting/search/pagination/sort), SEARCH_DISCOVERY §60 | Consistent |
| Media upload | ✅ | API_STANDARDS §40, MEDIA_STORAGE §45–46 | Consistent upload flow |
| Reporting | ✅ | API_STANDARDS §54, REPORTING_SYSTEM §86 | Consistent |

**Overall:** API coverage is good. The only structural gap is the missing assignment-contract section, and `markNoShow` appearing in the API contract before the booking state machine defines the state's transitions.

---

# 12. Roadmap Dependency Review

Assessed against ROADMAP phases vs architectural dependencies:

* **Phase 0 (Foundation):** correctly precedes everything; exit criteria match DEPLOYMENT/PROJECT_STRUCTURE/TESTING_STRATEGY baselines. ✅
* **Phase 1 (Core Booking):** includes provisioning, website, CMS, services, pricing, availability, booking, magic links, basic notifications, branch dashboard. Dependencies are satisfied in order. **One ordering risk:** Phase 1 includes "basic reminder" notifications (§15) which require the background/outbox foundation from BACKGROUND_JOBS §64 — that foundation is listed as MVP background processing, not explicitly placed in a phase. Recommend Phase 1 explicitly claims "database-backed outbox/job records + email retries" as a Phase 1 deliverable.
* **Phase 2 (Operational):** workforce → jobs → PWA → manual assignment → alerts → quality. Correct order; "manual assignment first" (§22) matches ROADMAP principle 8 and BACKGROUND_JOBS automation-gating (§43–44). ✅
* **Phase 3 (Financial):** payments → invoices → refunds → customer expansion → recurring. **Flag (HIGH-1):** recurring appears here while DATABASE labels it future — resolve per HIGH-1. Payment methods caveat should mirror HIGH-3 resolution. ✅ otherwise
* **Phase 4 (Multi-branch scale):** HQ administration depth + lifecycle formalization + cross-branch reporting. Note: basic HQ branch management already exists in Phase 1 (MVP per REQUIREMENTS §48); Phase 4 adds activation/suspension/archive depth — coherent, no contradiction. ✅
* **Phase 5 (Automation):** automation engine, automated assignment, scheduling intelligence, AI assistance. Correctly gated behind Phase 2 operational data (§82 quality gate). ✅
* **Phase 6 (International):** currencies/tax/locales/country activation. Matches LEGAL_COMPLIANCE §68–69 (compliance readiness before activation). ✅
* **Phase 7 (Network):** explicitly future. ✅

**Verdict:** The roadmap follows the documented dependencies. Two adjustments recommended: (1) place the outbox/background foundation explicitly in Phase 1; (2) resolve recurring-bookings phase placement (HIGH-1).

---

# 13. Recommended Fix Order

1. **CRITICAL-2 — Pricing snapshot representation.** Decide and propagate across DATABASE §16.3/§18.1/§64 and PRICING_ENGINE §33–36. (Money correctness.)
2. **CRITICAL-1 — Permission catalog.** Consolidate into SECURITY.md; mark other lists illustrative. (Blocks RLS + UI + seeds.)
3. **HIGH-2 — DATABASE table set completeness.** Add `pricing_versions` (per fix 1), outbox/job, holds, magic-link token storage, provider events; or mark deferrals explicitly.
4. **HIGH-4 — Booking `FAILED` state.** Remove or define; while editing, define `no_show` transitions and reconcile API_STANDARDS `markNoShow`.
5. **HIGH-6 — Employee↔branch model.** Choose scalar + future join vs join now; align DATABASE §23.1 with EM-003.
6. **HIGH-1 — Recurring plans status.** Align DATABASE §22 with ROADMAP Phase 3 and BACKGROUND_JOBS.
7. **HIGH-5 — Cancellation fee basis.** Define fee base, unpaid/paid behavior, snapshot linkage.
8. **HIGH-3 — Payment method list caveat.** Align REQUIREMENTS §23 with ROADMAP/PAYMENT_SYSTEM.
9. **MEDIUM-8 — Invoice status lifecycle.** Add to PAYMENT_SYSTEM; reference from DATABASE §32.1.
10. **MEDIUM-1 — Event naming note.** Dotted audit actions vs underscore business events; fix `invoice_created`↔`invoice_issued`.
11. **MEDIUM-3 / MEDIUM-4 — Service catalog model; branches.locale vs website_locales.** One paragraph each in DATABASE.
12. **MEDIUM-5/6/7/9 — Employment types, audit payload note, customer uniqueness, hold↔pending relationship.**
13. **MEDIUM-10 — README/ARCHITECTURE doc maps.** Regenerate from disk.
14. **LOW items** — optional cleanup, no blocking effect.

Items 1–2 should precede the first OpenSpec change; 3–8 should precede the features that touch them; 9–13 can ride along with the relevant feature's OpenSpec change.

---

# 14. OpenSpec Readiness

**Is the documentation ready for OpenSpec?**

**Conditionally yes.** The architecture, boundaries, security model, and domain responsibilities are stable and cross-validated. However, the two CRITICAL findings sit directly on the critical path of the first OpenSpec change (branch provisioning touches roles/permissions; everything downstream touches pricing snapshots), so they should be resolved **before** writing the first specification, not after.

**Must be fixed first:**

1. CRITICAL-1 (permission catalog) — the first change provisions branches and assigns managers, which requires `branches.*`/`users.*` permissions to be defined once.
2. CRITICAL-2 (price snapshot representation) — not needed by the *first* change itself, but by the second (services/pricing); resolving it now avoids two migrations.
3. HIGH-2 table-set completeness for the tables the foundation creates (memberships, branches, website tables are fine; add outbox/job + token storage notes).

**Can safely wait:**

* HIGH-3, HIGH-5 (payment/cancellation details) — Phase 3.
* MEDIUM-1..10 and all LOW items — ride along with their domains' changes.
* QUALITY, REPORTING, SEARCH deep-dives — Phase 2+.

**Which feature should become the first OpenSpec change?**

**"HQ Admin creates a branch → automatic provisioning → branch website + dashboard context available"** — this is the README §13 milestone, REQUIREMENTS §51 priority, ROADMAP Phase 1 §6.1–6.2, and BRANCH_SYSTEM §14–18 all agree on it. It exercises: auth/memberships, RLS, provisioning idempotency, audit events, and the website/CMS tables — without depending on pricing/bookings. Its acceptance criteria are already fully specified across those documents.

---

# 15. Summary

1. **Documents audited:** 32 (all files under `docs/` + `README.md`); `openspec/` absent; root `PROJECT_RULES.md` absent (located at `docs/PROJECT_RULES.md`).
2. **CRITICAL findings:** 2 (CRITICAL-1 permission catalog conflicts; CRITICAL-2 pricing snapshot representation conflict).
3. **HIGH findings:** 6 (recurring-plan status; DATABASE table-set omissions; payment-method list; booking `FAILED` state; cancellation-fee basis; employee↔branch model).
4. **MEDIUM findings:** 10 (event naming, review eligibility, service ownership, branch locale, employment types, audit payload style, customer identity, invoice lifecycle, hold/draft duplication, doc-map drift).
5. **LOW findings:** 5 (heading style, VISION numbering, currency examples, route example, KPI phrasing).
6. **OpenSpec ready:** Conditionally — resolve CRITICAL-1 and CRITICAL-2 first; then proceed.
7. **Recommended first OpenSpec change:** *Branch creation with automatic provisioning* (HQ admin creates branch → website/locales/pages/sections/navigation/SEO/dashboard context provisioned idempotently, audited, and branch becomes ready).

*End of audit. No implementation, migrations, or OpenSpec changes were created.*
