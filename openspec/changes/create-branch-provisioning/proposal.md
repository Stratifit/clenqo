# Proposal: Branch Creation with Automatic Provisioning

**Change ID:** `create-branch-provisioning`
**Status:** Draft (awaiting approval — do not implement)
**Roadmap phase:** Phase 1 — Core Booking Platform (`ROADMAP.md` §6.1–6.2)
**Priority:** P0 (first functional milestone, `README.md` §13)

---

## Why

CLENQO's first functional milestone is:

> **An HQ administrator can create a branch, and CLENQO automatically provisions the branch's website configuration and operational dashboard context within the same centralized platform.** (`README.md` §13, `REQUIREMENTS.md` §51)

Today the platform exists only as documentation. This change turns the
documented milestone into a verifiable capability: HQ Admins create branches,
the platform deterministically provisions each branch's website (locales,
pages, translations, sections, navigation, SEO) and dashboard context, and the
whole operation is authorized, transactional, idempotent, audited, and
observable — without any branch-specific code.

## What Changes

* **New capability** — `Branch Management → Creation & Provisioning`:
  * Server contract `branchService.createAndProvision(input)` exposed via an
    HQ-only Server Action / route handler (`API_STANDARDS.md` §32).
  * Deterministic provisioning pipeline: branch record → website → locales →
    pages (+ translations) → sections → navigation → SEO defaults.
  * Provisioning lifecycle on the branch record
    (`pending → provisioning → ready | failed`) with idempotent retry.
  * Branch lifecycle formalized as
    `draft → provisioning → ready → active → suspended → archived`
    (`BRANCH_SYSTEM.md` §19, `AUDIT_SYSTEM.md` §45) — creation never auto-activates.
  * Activation as a separate authorized operation with a readiness checklist.
* **Database additions** (migration defined by this change, written later):
  * `organizations`, `branches` (+ provisioning status/lifecycle fields),
    `profiles`, `memberships`, `membership_branches`,
    `branch_websites`, `website_locales`, `website_pages`,
    `website_page_translations`, `website_sections`, `audit_logs`
    — all per `DATABASE.md` §64 Initial Table Set.
  * RLS policies for all of the above.
* **Authorization** — `branches.create` / `branches.view` / `branches.edit` /
  `branches.activate` (HQ-only) per the consolidated catalog in
  `SECURITY.md` §14 (audit fix CRITICAL-1).
* **Audit events** — `branch.created`, `website.provisioned`,
  `locales.provisioned`, `pages.provisioned`, `configuration.provisioned`,
  `provisioning.failed`, `provisioning.retry_started`, `branch.ready`,
  `branch.activated` (`AUDIT_SYSTEM.md` §5, §46–48).
* **Observability** — provisioning metrics/events per `OBSERVABILITY.md` §17.

## Impact

* **Affected specs:** new capability spec under
  `openspec/specs/branch-management/` (created on archive).
* **Affected code areas (future):** `features/branches/` (schemas, services,
  actions), `features/website/` (provisioning helpers), `lib/supabase/`
  (server/privileged clients), `lib/authorization/`, `app/(admin)/admin/branches/`.
* **Affected docs:** none modified by this proposal. Documentation is the input;
  any deviation discovered during implementation must be resolved by updating
  the source docs first (`PROJECT_STRUCTURE.md` §54).
* **Out of scope:** services/pricing provisioning (Phase 1 §9–10), booking,
  CMS editing UI beyond seeded content, manager assignment UI, notifications,
  test-booking mode (`BRANCH_SYSTEM.md` §76), custom domains (`§24`).
