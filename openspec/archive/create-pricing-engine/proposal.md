# Change 4A — Pricing Engine

**Change ID:** `create-pricing-engine`
**Status:** Draft — awaiting human approval
**Roadmap alignment:** Phase 1 §10 (Pricing Engine); ROADMAP orders Pricing before Customer
Booking; REQUIREMENTS §48 lists "Basic pricing" before "Booking". Resolves booking dependency
**B0** from the Change 4 Booking Readiness Audit.
**Predecessors:** Change 1 (Branch Provisioning), Change 2 (Service Catalog, archived),
Change 3 (Scheduling & Availability, archived — consumes the duration authority delivered here)

## Problem

Booking confirmation is contractually required to store an authoritative pricing snapshot
(`pricing_version_id` + single `pricing_snapshot` jsonb — DATABASE §16.3, CRITICAL-2 canonical
model), but no Pricing Engine exists: migrations 0001–0009 contain no pricing tables and
`features/` has no pricing module. Scheduling currently consumes a placeholder
`DurationProvider` (60 minutes) that is explicitly documented for deletion when the real
provider arrives. A placeholder price on a confirmed booking would be wrong money on a
permanent record — unacceptable.

## Motivation

Deliver the platform's central financial invariant (PRICING_ENGINE §81): every price computed
by an authoritative server-side engine using an identifiable pricing version, explicit inputs,
deterministic rules, and a preserved snapshot. This change makes the future Booking change (4B)
a pure consumer and retires Change 3's designed placeholder seam.

## Scope

- Migration `0010_pricing_engine.sql`: `pricing_profiles`, `pricing_versions`, `pricing_rules`
  + RLS + constraints + indexes (next number in chain 0001–0009).
- `features/pricing/`: Zod schemas, stateless quote engine (approved pipeline), config CRUD
  services, server actions, duration resolver shared with the quote engine.
- Duration-authority replacement: scheduling actions wire the real provider;
  `placeholderDurationProvider` deleted in the same change (P21). `DurationSelection` gains
  typed optional `propertyDetails` (P-D1).
- Idempotent per-branch `seedPricingDefaults` integrated with branch provisioning (P18),
  structure only.
- Full test suite with explicit non-production fixtures.

## Non-goals

No Booking or snapshot storage (4B) · no availability/hold/scheduling behavior change beyond
provider wiring · no worker selection · no payments/invoices · no `app/` UI (P19) · no
promotion codes, no active discounts (P6) · no external tax providers (P7) · no production
business values (P3) · no assessment/quote-required or fixed_price/starting_from modes (P10) ·
no new permission names (P20).

## Dependencies

- Change 1: branches, organizations, memberships, RLS helpers (0002, 0006), provisioning.
- Change 2: catalog identities (`services`, `service_variants`, `service_addons`) — read-only,
  same-branch composite FKs per 0008 conventions.
- Change 3: `DurationProvider` seam contract and scheduling action wiring (the only production
  touch outside `features/pricing/`).

## Domain relationship boundaries

- **Catalog owns sellability.** Pricing reads catalog identities only — never mutates them,
  never stores pricing data in catalog rows (Q5).
- **Pricing owns price and duration.**
- **Scheduling owns availability, capacity, conflicts, slot holds** and consumes Pricing
  duration through the existing seam; it never calculates price or duration.
- **Booking consumes** the quote/snapshot (`pricing_version_id` + `pricing_snapshot`); it never
  calculates price.
- **Worker owns** eligibility/assignment — untouched.
- Pricing does not determine availability, create bookings, create slot holds, or select workers.

## Impact

- **Code:** new `features/pricing/`; migration 0010; minimal `features/scheduling/` edit
  (provider wiring + placeholder deletion, no behavior change); test extensions.
- **Docs:** PRICING_ENGINE.md, DATABASE.md (§16/§64/§65), SCHEDULING_SYSTEM.md (S6/§86 note),
  DOCUMENTATION_AUDIT.md (HIGH-2 pricing residue), REQUIREMENTS.md (PR-005 per P12),
  API_STANDARDS.md (§27 contract shape).
- **Database:** three new pricing tables; no catalog/scheduling schema changes.
