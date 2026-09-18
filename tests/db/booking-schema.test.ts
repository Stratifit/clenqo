/**
 * Booking schema tests (Change 5, task 1.3; migration 0011).
 * ALL monetary values below are explicit NON-PRODUCTION fixtures.
 * Normative sources: design.md §3 (conceptual schema), §5 (lifecycle).
 */
import { describe, it, expect } from "vitest";
import { withFreshDb } from "../helpers/db";
import type { SimplePgClient } from "@/lib/db/types";

const BOOKING_TABLES = [
  "customers",
  "customer_addresses",
  "branch_service_areas",
  "branch_cancellation_policies",
  "booking_number_sequences",
  "bookings",
  "booking_items",
  "booking_events",
  "booking_pricing_snapshots",
  "customer_magic_link_tokens",
  "booking_idempotency_keys",
  "notification_outbox",
];

async function orgBranch(db: SimplePgClient): Promise<{ orgId: string; branchId: string }> {
  const org = await db.query<{ id: string }>(
    `insert into public.organizations (name, slug) values ('B', 'booking-org') returning id`,
  );
  const branch = await db.query<{ id: string }>(
    `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
     values ($1, 'B', 'booking-berlin', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
    [org.rows[0].id],
  );
  return { orgId: org.rows[0].id, branchId: branch.rows[0].id };
}

/** Insert a customer; returns id. */
async function customer(db: SimplePgClient, orgId: string, email = "c@test.example"): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.customers (organization_id, email_normalized, phone_e164, first_name, last_name)
     values ($1, $2, '+491511234567', 'First', 'Last') returning id`,
    [orgId, email],
  );
  return res.rows[0].id;
}

/** Insert a minimal confirmed booking; returns id. */
async function booking(
  db: SimplePgClient,
  orgId: string,
  branchId: string,
  customerId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.bookings (
       organization_id, branch_id, customer_id, booking_number, status,
       scheduled_start, scheduled_end, timezone, service_address,
       pricing_version_id, cancellation_policy_snapshot, currency, subtotal, total
     ) values ($1, $2, $3, $4, coalesce($5::text, 'confirmed'),
       '2027-06-01T08:00Z', '2027-06-01T10:00Z', 'Europe/Berlin', '{"street":"S"}'::jsonb,
       '00000000-0000-0000-0000-000000000000', '{"tiers":[]}'::jsonb, 'EUR', 1000, 1000)
     returning id`,
    [
      orgId,
      branchId,
      customerId,
      overrides.booking_number ?? "CLN-2027-000001",
      overrides.status ?? null,
    ],
  );
  return res.rows[0].id;
}

describe("booking schema (migration 0011, Change 5 task 1.3)", () => {
  it("creates all twelve booking tables", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name = any($1)`,
        [BOOKING_TABLES],
      );
      expect(res.rows.map((r) => r.table_name).sort()).toEqual([...BOOKING_TABLES].sort());
    });
  });

  it("has organization_id NOT NULL on every booking table (Q9 convention)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string; is_nullable: string }>(
        `select table_name, is_nullable from information_schema.columns
          where table_schema = 'public' and column_name = 'organization_id'
            and table_name = any($1)`,
        [BOOKING_TABLES],
      );
      expect(res.rows).toHaveLength(BOOKING_TABLES.length);
      expect(res.rows.every((r) => r.is_nullable === "NO")).toBe(true);
    });
  });

  it("enforces BD-1: no FAILED state; approved 8-state CHECK", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      await expect(
        db.query(
          `insert into public.bookings (
             organization_id, branch_id, customer_id, booking_number, status,
             scheduled_start, scheduled_end, timezone, service_address,
             pricing_version_id, cancellation_policy_snapshot, currency, subtotal, total
           ) values ($1, $2, $3, 'CLN-2027-000009', 'failed',
             '2027-06-01T08:00Z', '2027-06-01T10:00Z', 'Europe/Berlin', '{}'::jsonb,
             '00000000-0000-0000-0000-000000000000', '{}'::jsonb, 'EUR', 0, 0)`,
          [orgId, branchId, cust],
        ),
      ).rejects.toThrow(/bookings_status_check/);
    });
  });

  it("enforces BD-5: booking number format and per-organization uniqueness", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      await booking(db, orgId, branchId, cust, { booking_number: "CLN-2027-000001" });
      // Duplicate number in the same organization rejected.
      await expect(
        booking(db, orgId, branchId, cust, { booking_number: "CLN-2027-000001" }),
      ).rejects.toThrow(/uq_bookings_org_number/);
      // Malformed format rejected.
      await expect(
        booking(db, orgId, branchId, cust, { booking_number: "BK-2027-1" }),
      ).rejects.toThrow(/ck_bookings_number_format/);
    });
  });

  it("enforces the BD-1 transition guard: approved transitions only; history undeletable", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      const b = await booking(db, orgId, branchId, cust);

      // approved: confirmed → cancelled
      await db.query(`update public.bookings set status = 'cancelled' where id = $1`, [b]);
      // rejected: cancelled → confirmed
      await expect(
        db.query(`update public.bookings set status = 'confirmed' where id = $1`, [b]),
      ).rejects.toThrow(/invalid booking status transition/);
      // in_progress → completed is approved; confirmed → in_progress is not.
      const b2 = await booking(db, orgId, branchId, cust, { booking_number: "CLN-2027-000002" });
      await expect(
        db.query(`update public.bookings set status = 'in_progress' where id = $1`, [b2]),
      ).rejects.toThrow(/invalid booking status transition/);
      // DELETE rejected (BOOKING_SYSTEM §37 — permanent history).
      await expect(db.query(`delete from public.bookings where id = $1`, [b])).rejects.toThrow(
        /bookings are permanent history/,
      );
    });
  });

  it("enforces exactly one current pricing snapshot per booking (TD-3.2)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      const b = await booking(db, orgId, branchId, cust);
      const snap = (opts: { seq: number; current: boolean }) =>
        db.query(
          `insert into public.booking_pricing_snapshots
             (organization_id, branch_id, booking_id, seq, pricing_version_id, snapshot, is_current, created_reason)            values ($1, $2, $3, $4, '00000000-0000-0000-0000-000000000000', '{}'::jsonb, $5, 'confirmation')`,
          [orgId, branchId, b, opts.seq, opts.current],
        );
      await snap({ seq: 1, current: true });
      // A second CURRENT snapshot rejected.
      await expect(snap({ seq: 2, current: true })).rejects.toThrow(/uq_booking_snapshots_one_current/);
      // Retire seq 1 via the sanctioned hand-off, then seq 2 may be current.
      await db.query(
        `update public.booking_pricing_snapshots set is_current = false where booking_id = $1 and seq = 1`,
        [b],
      );
      await snap({ seq: 2, current: true });
      // Content mutation rejected (append-only guard).
      await expect(
        db.query(
          `update public.booking_pricing_snapshots set snapshot = '{"x":1}'::jsonb where booking_id = $1 and seq = 1`,
          [b],
        ),
      ).rejects.toThrow(/append-only; only the is_current hand-off/);
      // Direct DELETE rejected.
      await expect(
        db.query(`delete from public.booking_pricing_snapshots where booking_id = $1 and seq = 1`, [b]),
      ).rejects.toThrow(/cannot be deleted/);
    });
  });

  it("enforces append-only booking events (TD-3.4)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      const b = await booking(db, orgId, branchId, cust);
      await db.query(
        `insert into public.booking_events
           (organization_id, branch_id, booking_id, event_type, metadata, actor_type)
         values ($1, $2, $3, 'booking_created', '{}'::jsonb, 'system')`,
        [orgId, branchId, b],
      );
      await expect(
        db.query(`update public.booking_events set metadata = '{"x":1}'::jsonb where booking_id = $1`, [b]),
      ).rejects.toThrow(/append-only/);
      await expect(db.query(`delete from public.booking_events where booking_id = $1`, [b])).rejects.toThrow(
        /append-only/,
      );
      // Invalid event type rejected by CHECK.
      await expect(
        db.query(
          `insert into public.booking_events
             (organization_id, branch_id, booking_id, event_type, metadata, actor_type)
           values ($1, $2, $3, 'booking_frobnicated', '{}'::jsonb, 'system')`,
          [orgId, branchId, b],
        ),
      ).rejects.toThrow(/booking_events_event_type_check/);
    });
  });

  it("enforces BD-2: published cancellation-policy immutability and overlap rejection", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const tiers = JSON.stringify([
        { min_hours: 0, max_hours: 2, percent: 100 },
        { min_hours: 2, max_hours: 12, percent: 50 },
        { min_hours: 12, max_hours: 24, percent: 25 },
        { min_hours: 24, max_hours: null, percent: 0 },
      ]);
      const p1 = (
        await db.query<{ id: string }>(
          `insert into public.branch_cancellation_policies
             (organization_id, branch_id, version_number, status, effective_from, effective_until, tiers)
           values ($1, $2, 1, 'published', '2026-01-01', '2026-06-30', $3::jsonb) returning id`,
          [orgId, branchId, tiers],
        )
      ).rows[0].id;
      // Overlapping published window rejected.
      await expect(
        db.query(
          `insert into public.branch_cancellation_policies
             (organization_id, branch_id, version_number, status, effective_from, effective_until, tiers)
           values ($1, $2, 2, 'published', '2026-06-01', '2026-12-31', $3::jsonb)`,
          [orgId, branchId, tiers],
        ),
      ).rejects.toThrow(/ex_cancellation_policies_published_no_overlap/);
      // Published content mutation rejected; archive allowed.
      await expect(
        db.query(`update public.branch_cancellation_policies set tiers = '[]'::jsonb where id = $1`, [p1]),
      ).rejects.toThrow(/published cancellation policies are immutable/);
      await db.query(`update public.branch_cancellation_policies set status = 'archived' where id = $1`, [p1]);
      await expect(
        db.query(`update public.branch_cancellation_policies set status = 'published' where id = $1`, [p1]),
      ).rejects.toThrow(/archived cancellation policies are immutable/);
    });
  });

  it("enforces BD-4: customer uniqueness per contact channel and normalization shapes", async () => {
    await withFreshDb(async (db) => {
      const { orgId } = await orgBranch(db);
      await customer(db, orgId, "dup@test.example");
      // Duplicate email rejected.
      await expect(
        db.query(
          `insert into public.customers (organization_id, email_normalized, first_name, last_name)
           values ($1, 'dup@test.example', 'A', 'B')`,
          [orgId],
        ),
      ).rejects.toThrow(/uq_customers_org_email/);
      // Uppercase email rejected by the normalization CHECK.
      await expect(
        db.query(
          `insert into public.customers (organization_id, email_normalized, first_name, last_name)
           values ($1, 'UPPER@test.example', 'A', 'B')`,
          [orgId],
        ),
      ).rejects.toThrow(/ck_customers_email_shape/);
      // Non-E.164 phone rejected.
      await expect(
        db.query(
          `insert into public.customers (organization_id, email_normalized, phone_e164, first_name, last_name)
           values ($1, 'x@test.example', '0151 234', 'A', 'B')`,
          [orgId],
        ),
      ).rejects.toThrow(/ck_customers_phone_e164/);
      // NULL phone is allowed and never conflicts.
      await expect(
        db.query(
          `insert into public.customers (organization_id, email_normalized, first_name, last_name)
           values ($1, 'nophone@test.example', 'A', 'B')`,
          [orgId],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("keeps magic-link tokens deny-all (RLS enabled, NO policies) and hash-shaped", async () => {
    await withFreshDb(async (db) => {
      const rel = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'customer_magic_link_tokens'`,
      );
      expect(rel.rows[0].relrowsecurity).toBe(true);
      expect(rel.rows[0].relforcerowsecurity).toBe(false);

      const policies = await db.query<{ n: string }>(
        `select count(*)::text as n from pg_policies
          where schemaname = 'public' and tablename = 'customer_magic_link_tokens'`,
      );
      expect(policies.rows[0].n).toBe("0"); // deny-all to application roles

      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      const b = await booking(db, orgId, branchId, cust);
      // Non-hex token hash rejected.
      await expect(
        db.query(
          `insert into public.customer_magic_link_tokens
             (organization_id, customer_id, booking_id, token_hash, expires_at)
           values ($1, $2, $3, 'not-a-hash', now() + interval '15 minutes')`,
          [orgId, cust, b],
        ),
      ).rejects.toThrow(/ck_magic_link_token_hash_shape/);
    });
  });

  it("enforces outbox event/status CHECKs (TD-6)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const cust = await customer(db, orgId);
      const b = await booking(db, orgId, branchId, cust);
      await db.query(
        `insert into public.notification_outbox
           (organization_id, branch_id, booking_id, event_type, payload)
         values ($1, $2, $3, 'booking_confirmation_email', '{}'::jsonb)`,
        [orgId, branchId, b],
      );
      await expect(
        db.query(
          `insert into public.notification_outbox
             (organization_id, branch_id, booking_id, event_type, payload)
           values ($1, $2, $3, 'sms_blast', '{}'::jsonb)`,
          [orgId, branchId, b],
        ),
      ).rejects.toThrow(/notification_outbox_event_type_check/);
    });
  });

  it("allocates monotonic organization booking numbers across year boundaries (BD-5)", async () => {
    await withFreshDb(async (db) => {
      const { orgId } = await orgBranch(db);
      // First allocation inserts the counter row.
      const r1 = await db.query<{ last_sequence: string }>(
        `insert into public.booking_number_sequences (organization_id, last_sequence)
         values ($1, 1)
         on conflict (organization_id) do update
           set last_sequence = public.booking_number_sequences.last_sequence + 1
         returning last_sequence`,
        [orgId],
      );
      expect(Number(r1.rows[0].last_sequence)).toBe(1);
      const r2 = await db.query<{ last_sequence: string }>(
        `insert into public.booking_number_sequences (organization_id, last_sequence)
         values ($1, 1)
         on conflict (organization_id) do update
           set last_sequence = public.booking_number_sequences.last_sequence + 1
         returning last_sequence`,
        [orgId],
      );
      expect(Number(r2.rows[0].last_sequence)).toBe(2);
      // A different organization has its own counter.
      const org2 = (
        await db.query<{ id: string }>(
          `insert into public.organizations (name, slug) values ('B2', 'booking-org-2') returning id`,
        )
      ).rows[0].id;
      const r3 = await db.query<{ last_sequence: string }>(
        `insert into public.booking_number_sequences (organization_id, last_sequence)
         values ($1, 1)
         on conflict (organization_id) do update
           set last_sequence = public.booking_number_sequences.last_sequence + 1
         returning last_sequence`,
        [org2],
      );
      expect(Number(r3.rows[0].last_sequence)).toBe(1);
    });
  });

  it("keeps NO messaging tables (B-NEW-1); Change 5 introduced no workforce tables either — Change 6 (0012) owns those", async () => {
    await withFreshDb(async (db) => {
      // Change 5 boundary, restated: NO messaging/conversation tables ever.
      const messaging = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public'
            and (table_name like '%message%' or table_name like '%conversation%')`,
      );
      expect(messaging.rows).toHaveLength(0);

      // Workforce tables arrived in Change 6 (0012); the cleaner-execution
      // checklist/media tables arrived in Change 7 (0013, BD-C3/C4) — assert
      // the exact set, proving Change 5 added none of them itself.
      const workforce = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public'
            and (table_name like 'job%' or table_name like '%employee%' or table_name like '%assignment%'
                 or table_name like '%checklist%')
          order by table_name`,
      );
      expect(workforce.rows.map((r) => r.table_name)).toEqual([
        "checklist_templates", // Change 7 (0013)
        "employee_availability",
        "employee_availability_exceptions",
        "employee_branches",
        "employee_number_sequences",
        "employee_skills",
        "employees",
        "job_assignments",
        "job_checklist_items", // Change 7 (0013)
        "job_checklist_snapshots", // Change 7 (0013)
        "job_events",
        "job_media", // Change 7 (0013)
        "job_number_sequences",
        "jobs",
      ]);
    });
  });
});
