# Change 5 — Booking System (Booking MVP / Booking Hub)

**Change ID:** `create-booking`
**Status:** Draft — awaiting human approval
**Roadmap alignment:** Phase 1 §12–14 (Customer Booking, Magic Link, Booking Operations); REQUIREMENTS §11 BK-001–BK-007, §12–15.
**Predecessors:** Change 1 (Branch Provisioning), Change 2 (Service Catalog), Change 3 (Scheduling & Availability), Change 4A (Pricing Engine) — all archived, hosted-verified.

## Problem

The platform's core commercial capability does not exist. Migrations 0001–0010 contain no customers, bookings, booking_items, booking_events, magic-link tokens, or idempotency storage, and `features/` has no booking module — while Catalog, Scheduling, and Pricing are complete and expose exactly the contracts Booking must consume (sellability; feasibility + slot holds; `calculateQuote` + duration authority). Booking policy is now fixed by owner decisions BD-1–BD-3 (commits `542a94b`, `dbc78f9`, `f43e02d`) and the remaining scope questions by BD-4–BD-6, B-NEW-1, TD-1 (2026-09 decision round).

## Motivation

Deliver the transaction the platform exists for: a validated, reproducible, branch-scoped booking with authoritative price, authoritative availability, secure no-account customer management, and auditable history (BOOKING_SYSTEM §95 golden rule). Worker/Jobs, Payments, Invoices, and Reviews all consume confirmed bookings.

## Scope

- Migration `0011_booking.sql` (next in chain 0001–0010): `customers`, `customer_addresses`, `branch_service_areas`, `branch_cancellation_policies`, `booking_number_sequences`, `bookings`, `booking_items`, `booking_events`, `booking_pricing_snapshots`, `customer_magic_link_tokens`, `booking_idempotency_keys`, `notification_outbox` + RLS + constraints + indexes.
- `features/booking/`: Zod schemas, error codes, customer domain (dedup/normalization/addresses), booking configuration (cancellation policies, service areas, number sequence), confirmation flow (holds + pricing + snapshots + idempotency), cancellation + override, rescheduling, magic-link lifecycle, internal operations, server actions, minimal outbox writer.
- Transactional fail-closed audit + booking events; booking-number allocation per organization (BD-5).
- Full test suite (unit/domain/hosted) with explicit non-production fixtures.

## Non-goals

No jobs/employees/assignment tables or logic (TD-1: Worker change owns Jobs; handoff contract only) · no payment provider, payment records, or fee collection mechanism (BD-2.6 records the amount-owed outcome only) · no notification delivery worker/channels (outbox rows only) · no customer messaging/threads (B-NEW-1: contact info only) · no recurring-plan CRUD (S11) · no reviews/quality/invoices · no rescheduling automation · no production business pricing values (P3) · no new permission names (BD-3.8 reuses `bookings.edit`; `bookings.override` exists since BD-2).

## Dependencies

Change 1 (orgs/branches/memberships, RLS helpers 0002/0006, `branches.edit`) · Change 2 (catalog sellability + compatibility, read-only) · Change 3 (feasibility, slot holds, capacity, notice, DST; `consumeHoldInTx` contract) · Change 4A (`calculateQuote`, duration authority, P17 version resolution, snapshot model).

## Impact

Post-implementation documentation sync: BOOKING_SYSTEM (status), DATABASE §17–21, REQUIREMENTS BK notes, API_STANDARDS, NOTIFICATION_SYSTEM pointer, DOCUMENTATION_AUDIT.
