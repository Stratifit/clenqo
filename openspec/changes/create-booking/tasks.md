# Tasks: Booking System (Change 5)

> All checkboxes remain `[ ]` until implementation and verification complete.
> Normative source: design.md §1 (BD-1…BD-6, B-NEW-1, TD-1).

## 1. Schema & migration
- [x] 1.1 `supabase/migrations/0011_booking.sql` per design §3 (12 tables, UUID PKs, org+branch scoping, composite same-branch FKs, timestamptz UTC).
- [x] 1.2 Constraints: status/type/source CHECKs, booking-number UNIQUE per org, policy overlap exclusion, snapshot single-`is_current`, append-only event guard.
- [x] 1.3 Indexes per §3; migration-chain test 0001→0011 (pglite).

## 2. RLS & authorization
- [x] 2.1 RLS combined policies on all tables; token table deny-all to app roles; no FORCE.
- [x] 2.2 Server-side authorization wiring (`bookings.*`, `customers.*`, `branches.edit` for service areas).

## 3. Zod schemas & errors
- [x] 3.1 Booking/customer/address/reschedule/cancel/override schemas incl. propertyDetails passthrough (P-D1).
- [x] 3.2 Stable error codes (PRICE_CHANGED, SLOT_UNAVAILABLE, OUTSIDE_SERVICE_AREA, DEADLINE_PASSED, STATE_INVALID, …) mapped to the platform envelope.

## 4. Customer domain
- [x] 4.1 Normalization (email lowercase/trim; phone E.164) + match (email→phone) + conflict flag (BD-4).
- [x] 4.2 Customer CRUD actions (`customers.view/edit`); addresses.

## 5. Booking configuration
- [x] 5.1 Cancellation-policy CRUD: versioned, effective-dated, overlap-rejected, publish immutability (BD-2, P17 pattern) + audited.
- [x] 5.2 Branch service-area allowlist CRUD via `branches.edit` (BD-6).
- [x] 5.3 Booking-number sequence allocation (BD-5) + idempotent per-branch seed integration (cancellation policy default tiers).

## 6. Confirmation flow
- [x] 6.1 Full confirmation transaction per design §6 (re-check, hold consumption, quote compare, number allocation, snapshots, items, events, audit, outbox).
- [x] 6.2 Idempotency (key table, replay, retry-after-failure) (TD-5).
- [x] 6.3 Rollback semantics: no persisted booking; hold released (BD-1).

## 7. Cancellation & override
- [x] 7.1 Customer/staff cancellation per design §7 (deadline, tiers, fee, amount-owed) (BD-2).
- [x] 7.2 Fee override via `bookings.override` with 6-field audit (BD-2.4).

## 8. Rescheduling
- [x] 8.1 Reschedule flow per design §8 (deadline, target notice, hold swap, acceptance/decrease, snapshot history, unlimited repeats) (BD-3, TD-3.1–3.3).

## 9. Magic link & Booking Hub
- [x] 9.1 Token lifecycle: issue/hash/verify/single-use/expiry/revoke/rate-limit (TD-3).
- [x] 9.2 Hub actions: view/timeline/reschedule/cancel/rebook/contact-info-only (B-NEW-1).

## 10. Internal operations
- [x] 10.1 List/detail/search (branch-scoped), staff create-on-behalf, staff cancel/reschedule.

## 11. Events/audit/outbox
- [x] 11.1 Event writer + payloads (TD-3.4); fail-closed transactional audit; outbox rows (TD-3.5, TD-6).

## 12. Tests, docs, verification
- [x] 12.1 Unit tests (design §12 unit list incl. DST edges).
- [x] 12.2 Domain tests (design §12 domain list incl. RLS denial, rollback, concurrency, idempotency).
- [x] 12.3 Hosted suite `booking-hosted-verification.test.ts` + full regression Changes 1–5 (after local gates).
- [x] 12.4 Quality gates: typecheck, lint, build, full local suite.
- [x] 12.5 Documentation sync (design §13).
- [x] 12.6 Acceptance walkthrough: book → pay-later cancel (owed) → reschedule (price up accept / down auto) → staff override → magic-link security checks.
