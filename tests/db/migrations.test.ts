/**
 * Migration & constraint tests (task 1.7, spec "Branch slug uniqueness").
 * The chain must build cleanly on a fresh database.
 */
import { describe, it, expect } from "vitest";
import { withFreshDb } from "../helpers/db";
import type { SimplePgClient } from "@/lib/db/types";

describe("migration chain", () => {
  it("applies cleanly to a fresh database", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ count: string }>(
        `select count(*)::text as count from public.branches`,
      );
      expect(res.rows[0].count).toBe("0");
    });
  });

  it("creates helper functions", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query(
        `select proname from pg_proc where proname in
         ('has_organization_access', 'has_branch_access', 'get_membership_role')`,
      );
      expect(res.rows).toHaveLength(3);
    });
  });
});

describe("constraints (DATABASE.md §42)", () => {
  it("enforces unique branch slug within an organization", async () => {
    await withFreshDb(async (db) => {
      const org = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O', 'o1') returning id`,
      );
      const orgId = org.rows[0].id;
      await db.query(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B1', 'berlin', 'DE', 'Europe/Berlin', 'EUR', 'de')`,
        [orgId],
      );
      await expect(
        db.query(
          `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
           values ($1, 'B2', 'berlin', 'DE', 'Europe/Berlin', 'EUR', 'de')`,
          [orgId],
        ),
      ).rejects.toThrow(/uq_branches_org_slug/);
    });
  });

  it("allows the same slug across different organizations", async () => {
    await withFreshDb(async (db: SimplePgClient) => {
      const o1 = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O1', 'org-1') returning id`,
      );
      const o2 = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O2', 'org-2') returning id`,
      );
      for (const org of [o1.rows[0].id, o2.rows[0].id]) {
        await db.query(
          `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
           values ($1, 'B', 'berlin', 'DE', 'Europe/Berlin', 'EUR', 'de')`,
          [org],
        );
      }
      const res = await db.query<{ count: string }>(`select count(*)::text as count from public.branches`);
      expect(res.rows[0].count).toBe("2");
    });
  });

  it("allows at most one default locale per website", async () => {
    await withFreshDb(async (db) => {
      const org = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O', 'o') returning id`,
      );
      const branch = await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B', 'b', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org.rows[0].id],
      );
      const site = await db.query<{ id: string }>(
        `insert into public.branch_websites (branch_id, default_locale) values ($1, 'de') returning id`,
        [branch.rows[0].id],
      );
      await db.query(
        `insert into public.website_locales (website_id, locale, is_default) values ($1, 'de', true)`,
        [site.rows[0].id],
      );
      await expect(
        db.query(
          `insert into public.website_locales (website_id, locale, is_default) values ($1, 'en', true)`,
          [site.rows[0].id],
        ),
      ).rejects.toThrow(/uq_website_locales_single_default/);
    });
  });

  it("enforces activation guard: active requires provisioning ready", async () => {
    await withFreshDb(async (db) => {
      const org = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O', 'o') returning id`,
      );
      await expect(
        db.query(
          `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale, status, activated_at)
           values ($1, 'B', 'b', 'DE', 'Europe/Berlin', 'EUR', 'de', 'active', now())`,
          [org.rows[0].id],
        ),
      ).rejects.toThrow(/ck_branches_activation_requires_ready/);
    });
  });

  it("enforces audit action naming (resource.action)", async () => {
    await withFreshDb(async (db) => {
      const org = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O', 'o') returning id`,
      );
      await expect(
        db.query(
          `insert into public.audit_logs (organization_id, action, resource_type)
           values ($1, 'not-nested-format', 'branch')`,
          [org.rows[0].id],
        ),
      ).rejects.toThrow(/ck_audit_action_format/);
    });
  });
});

// -------------------------------------------------------------------------
// Service catalog schema (task 2.3) — migration 0008
// -------------------------------------------------------------------------

const CATALOG_TABLES = [
  "service_categories",
  "services",
  "service_variants",
  "service_addons",
  "service_category_translations",
  "service_translations",
  "service_variant_translations",
  "service_addon_translations",
  "service_addon_compatibility",
  "service_slug_aliases",
];

/** Insert org + branch; returns ids. */
async function orgBranch(db: SimplePgClient): Promise<{ orgId: string; branchId: string }> {
  const org = await db.query<{ id: string }>(
    `insert into public.organizations (name, slug) values ('C', 'cat-org') returning id`,
  );
  const branch = await db.query<{ id: string }>(
    `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
     values ($1, 'B', 'cat-berlin', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
    [org.rows[0].id],
  );
  return { orgId: org.rows[0].id, branchId: branch.rows[0].id };
}

describe("service catalog schema (migration 0008, task 2.3)", () => {
  it("creates all ten catalog tables", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public'
            and table_name = any($1)`,
        [CATALOG_TABLES],
      );
      expect(res.rows.map((r) => r.table_name).sort()).toEqual([...CATALOG_TABLES].sort());
    });
  });

  it("has branch_id NOT NULL on every org-bearing catalog table (Q9)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string; is_nullable: string }>(
        `select table_name, is_nullable from information_schema.columns
          where table_schema = 'public'
            and column_name = 'branch_id'
            and table_name = any($1)`,
        [CATALOG_TABLES],
      );
      expect(res.rows).toHaveLength(6); // 4 entities + compatibility + aliases
      expect(res.rows.every((r) => r.is_nullable === "NO")).toBe(true);
    });
  });

  it("has no catalog pricing fields (Q5)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name in ('service_categories', 'services', 'service_variants', 'service_addons')
            and (column_name like '%price%' or column_name like '%pricing%')`,
      );
      expect(res.rows).toHaveLength(0);
    });
  });

  it("enforces services.category_id FK (Q4) and category lifecycle CHECKs", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      await expect(
        db.query(
          `insert into public.services (organization_id, branch_id, category_id, slug, name)
           values ($1, $2, $3, 'orphan', 'Orphan')`,
          [orgId, branchId, "00000000-0000-0000-0000-000000000000"],
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `insert into public.service_categories (organization_id, branch_id, slug, name, status)
           values ($1, $2, 'bad-status', 'Bad', 'published')`,
          [orgId, branchId],
        ),
      ).rejects.toThrow(/ck_service_categories_status/);
    });
  });

  it("enforces slug uniqueness per branch and translation uniqueness", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      await db.query(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         select $1, $2, id, 'dup-slug', 'A' from public.service_categories
          where branch_id = $2 limit 1`,
        [orgId, branchId],
      ).catch(async () => {
        // No category yet — create one first, then the service.
        const cat = await db.query<{ id: string }>(
          `insert into public.service_categories (organization_id, branch_id, slug, name)
           values ($1, $2, 'dup-cat', 'C') returning id`,
          [orgId, branchId],
        );
        await db.query(
          `insert into public.services (organization_id, branch_id, category_id, slug, name)
           values ($1, $2, $3, 'dup-slug', 'A')`,
          [orgId, branchId, cat.rows[0].id],
        );
      });
      // Need a category for the service insert path above; ensure one exists.
      const cat = await db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'dup-cat-2', 'C2') returning id`,
        [orgId, branchId],
      );
      await db.query(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'second-slug', 'B')`,
        [orgId, branchId, cat.rows[0].id],
      );
      await expect(
        db.query(
          `insert into public.services (organization_id, branch_id, category_id, slug, name)
           values ($1, $2, $3, 'second-slug', 'Dup')`,
          [orgId, branchId, cat.rows[0].id],
        ),
      ).rejects.toThrow(/uq_services_branch_slug/);
      await expect(
        db.query(
          `insert into public.service_translations (service_id, locale, name)
           select id, 'de', 'X' from public.services where slug = 'second-slug'`,
        ),
      );
      await expect(
        db.query(
          `insert into public.service_translations (service_id, locale, name)
           select id, 'de', 'Y' from public.services where slug = 'second-slug'`,
        ),
      ).rejects.toThrow(/uq_service_translations/);
    });
  });

  it("enforces add-on quantity bounds (1 ≤ min ≤ max)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      await expect(
        db.query(
          `insert into public.service_addons (organization_id, branch_id, slug, name, min_quantity, max_quantity)
           values ($1, $2, 'q0', 'Q0', 0, 1)`,
          [orgId, branchId],
        ),
      ).rejects.toThrow(/ck_service_addons_quantity_bounds/);
      await expect(
        db.query(
          `insert into public.service_addons (organization_id, branch_id, slug, name, min_quantity, max_quantity)
           values ($1, $2, 'q1', 'Q1', 3, 2)`,
          [orgId, branchId],
        ),
      ).rejects.toThrow(/ck_service_addons_quantity_bounds/);
    });
  });

  it("enforces same-branch composite FKs on compatibility rows (Q3)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const otherBranch = await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B2', 'cat-hamburg', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [orgId],
      );
      const cat = await db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'compat-cat', 'C') returning id`,
        [orgId, branchId],
      );
      const svc = await db.query<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'compat-svc', 'S') returning id`,
        [orgId, branchId, cat.rows[0].id],
      );
      const foreignAddon = await db.query<{ id: string }>(
        `insert into public.service_addons (organization_id, branch_id, slug, name)
         values ($1, $2, 'foreign-addon', 'F') returning id`,
        [orgId, otherBranch.rows[0].id],
      );
      await expect(
        db.query(
          `insert into public.service_addon_compatibility
             (organization_id, branch_id, service_addon_id, service_id)
           values ($1, $2, $3, $4)`,
          [orgId, branchId, foreignAddon.rows[0].id, svc.rows[0].id],
        ),
      ).rejects.toThrow(/fk_compat_addon_same_branch/);
    });
  });

  it("creates the catalog indexes (task 2.2)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ indexname: string }>(
        `select indexname from pg_indexes
          where schemaname = 'public' and indexname = any($1)`,
        [
          [
            "idx_service_categories_branch_id", "idx_service_categories_status",
            "idx_services_branch_id", "idx_services_status", "idx_services_category_id",
            "idx_service_variants_service_id", "idx_service_variants_branch_id", "idx_service_variants_status",
            "idx_service_addons_branch_id", "idx_service_addons_status",
            "idx_compat_addon", "idx_compat_service", "idx_compat_branch",
            "idx_slug_aliases_entity", "idx_slug_aliases_branch",
          ],
        ],
      );
      expect(res.rows).toHaveLength(15);
    });
  });

  it("enforces alias uniqueness per (branch, entity_type, old_slug) and entity_type CHECK", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchId } = await orgBranch(db);
      const eid = "00000000-0000-0000-0000-0000000000aa";
      await db.query(
        `insert into public.service_slug_aliases
           (organization_id, branch_id, entity_type, entity_id, old_slug)
         values ($1, $2, 'service', $3, 'old-slug')`,
        [orgId, branchId, eid],
      );
      await expect(
        db.query(
          `insert into public.service_slug_aliases
             (organization_id, branch_id, entity_type, entity_id, old_slug)
           values ($1, $2, 'service', $3, 'old-slug')`,
          [orgId, branchId, eid],
        ),
      ).rejects.toThrow(/uq_service_slug_aliases/);
      await expect(
        db.query(
          `insert into public.service_slug_aliases
             (organization_id, branch_id, entity_type, entity_id, old_slug)
           values ($1, $2, 'category', $3, 'other-slug')`,
          [orgId, branchId, eid],
        ),
      ).rejects.toThrow(/service_slug_aliases_entity_type_check/);
    });
  });

  it("keeps the migration chain file sequence intact (0001–0012)", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual([
      "0001_identity.sql",
      "0002_organizations_branches.sql",
      "0003_website_foundation.sql",
      "0004_audit_logs.sql",
      "0005_foreign_keys.sql",
      "0006_authorization_helpers.sql",
      "0007_rls_policies.sql",
      "0008_service_catalog.sql",
      "0009_scheduling_availability.sql",
      "0010_pricing_engine.sql",
      "0011_booking.sql",
      "0012_worker.sql",
    ]);
  });
});

describe("scheduling schema (migration 0009, Change 3 task 2.3)", () => {
  it("creates all five scheduling tables", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name in
          ('branch_operating_hours', 'branch_schedule_exceptions',
           'branch_scheduling_configuration', 'service_scheduling_rules', 'slot_holds')
          order by table_name`,
      );
      expect(res.rows.map((r) => r.table_name)).toEqual([
        "branch_operating_hours",
        "branch_schedule_exceptions",
        "branch_scheduling_configuration",
        "service_scheduling_rules",
        "slot_holds",
      ]);
    });
  });

  it("enforces branch_id NOT NULL and organization scope on every scheduling table (Q9)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string; is_nullable: string }>(
        `select c.table_name, c.is_nullable from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name in ('branch_operating_hours', 'branch_schedule_exceptions',
                                 'branch_scheduling_configuration', 'service_scheduling_rules', 'slot_holds')
            and c.column_name = 'branch_id'
          order by c.table_name`,
      );
      expect(res.rows).toHaveLength(5);
      expect(res.rows.every((r) => r.is_nullable === "NO")).toBe(true);
    });
  });

  it("enforces the S13 no-wrap rule on operating hours and service rules", async () => {
    await withFreshDb(async (db) => {
      const org = (await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O', 'sched-o') returning id`,
      )).rows[0].id;
      const branch = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B', 'sched-berlin', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org],
      )).rows[0].id;

      // Overnight interval rejected (S13).
      await expect(
        db.query(
          `insert into public.branch_operating_hours
             (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
           values ($1, $2, 1, 0, '20:00', '02:00', '2026-01-01')`,
          [org, branch],
        ),
      ).rejects.toThrow(/ck_branch_hours_no_wrap/);

      // Zero-length interval rejected too.
      await expect(
        db.query(
          `insert into public.branch_operating_hours
             (organization_id, branch_id, weekday, interval_index, start_time, end_time, effective_from)
           values ($1, $2, 1, 0, '08:00', '08:00', '2026-01-01')`,
          [org, branch],
        ),
      ).rejects.toThrow(/ck_branch_hours_no_wrap/);
    });
  });

  it("enforces the S3 grid divisibility and approved config defaults", async () => {
    await withFreshDb(async (db) => {
      const org = (await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O2', 'sched-o2') returning id`,
      )).rows[0].id;
      const branch = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B', 'sched-hamburg', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org],
      )).rows[0].id;

      // Defaults = approved S4/S5/S3/S6b/S7b/S12/S1b values.
      const cfg = (await db.query<Record<string, number>>(
        `insert into public.branch_scheduling_configuration (organization_id, branch_id)
         values ($1, $2) returning *`,
        [org, branch],
      )).rows[0];
      expect(cfg.minimum_notice_minutes).toBe(1440);
      expect(cfg.maximum_advance_days).toBe(90);
      expect(cfg.slot_grid_minutes).toBe(15);
      expect(cfg.operational_buffer_minutes).toBe(15);
      expect(cfg.travel_buffer_minutes).toBe(30);
      expect(cfg.concurrency_cap).toBe(3);
      expect(cfg.customer_horizon_days).toBe(14);
      expect(cfg.hold_ttl_minutes).toBe(15);

      // Grid must divide the hour (S3 determinism) — a fresh branch avoids the
      // default-configuration unique collision.
      const branch2 = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B2', 'sched-kiel', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org],
      )).rows[0].id;
      await expect(
        db.query(
          `insert into public.branch_scheduling_configuration
             (organization_id, branch_id, slot_grid_minutes)
           values ($1, $2, 25)`,
          [org, branch2],
        ),
      ).rejects.toThrow(/ck_config_grid_divides_hour/);

      // Cap must be >= 1 (S7).
      await expect(
        db.query(
          `insert into public.branch_scheduling_configuration
             (organization_id, branch_id, concurrency_cap)
           values ($1, $2, 0)`,
          [org, branch2],
        ),
      ).rejects.toThrow(/ck_config_cap_positive/);
    });
  });

  it("enforces hold status CHECK, expiry shape, and one-active-hold-per-session (S1)", async () => {
    await withFreshDb(async (db) => {
      const org = (await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('O3', 'sched-o3') returning id`,
      )).rows[0].id;
      const branch = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'B', 'sched-dresden', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org],
      )).rows[0].id;
      const svc = (await db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'cat', 'Cat') returning id`,
        [org, branch],
      )).rows[0].id;
      const service = (await db.query<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'svc', 'Svc') returning id`,
        [org, branch, svc],
      )).rows[0].id;

      const mkHold = (session: string, key: string) =>
        db.query(
          `insert into public.slot_holds
             (organization_id, branch_id, service_id, start_time, end_time, session_id, idempotency_key, expires_at)
           values ($1, $2, $3, '2027-06-01T08:00Z', '2027-06-01T11:00Z', $4, $5, '2027-06-01T08:15Z')`,
          [org, branch, service, session, key],
        );

      await mkHold("sess-1", "key-1");

      // S1: second ACTIVE hold for the same session rejected by the partial
      // unique index.
      await expect(mkHold("sess-1", "key-2")).rejects.toThrow(/uq_slot_holds_one_active_per_session/);

      // Idempotency key uniqueness.
      await expect(mkHold("sess-2", "key-1")).rejects.toThrow(/uq_slot_holds_idempotency/);

      // A different session may hold concurrently (holds are carts, S1).
      await expect(mkHold("sess-2", "key-3")).resolves.toBeTruthy();

      // After the first hold is consumed, its session may hold again.
      await db.query(
        `update public.slot_holds set status = 'consumed' where session_id = 'sess-1' and idempotency_key = 'key-1'`,
      );
      await expect(mkHold("sess-1", "key-4")).resolves.toBeTruthy();

      // Invalid status rejected by the CHECK.
      await expect(
        db.query(
          `insert into public.slot_holds
             (organization_id, branch_id, service_id, start_time, end_time, session_id, idempotency_key, expires_at, status)
           values ($1, $2, $3, '2027-06-02T08:00Z', '2027-06-02T11:00Z', 'sess-9', 'key-9', '2027-06-02T08:15Z', 'frozen')`,
          [org, branch, service],
        ),
      ).rejects.toThrow(/slot_holds_status_check/);
    });
  });

  it("rejects service scheduling rules referencing another branch's service (same-branch FK)", async () => {
    await withFreshDb(async (db) => {
      const orgA = (await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('OA', 'sched-oa') returning id`,
      )).rows[0].id;
      const branchA = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'BA', 'sched-a', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [orgA],
      )).rows[0].id;
      const branchB = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'BB', 'sched-b', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [orgA],
      )).rows[0].id;
      const cat = (await db.query<{ id: string }>(
        `insert into public.service_categories (organization_id, branch_id, slug, name)
         values ($1, $2, 'cat-a', 'Cat') returning id`,
        [orgA, branchA],
      )).rows[0].id;
      const svcA = (await db.query<{ id: string }>(
        `insert into public.services (organization_id, branch_id, category_id, slug, name)
         values ($1, $2, $3, 'svc-a', 'Svc') returning id`,
        [orgA, branchA, cat],
      )).rows[0].id;      // branchB's rule cannot reference branchA's service (composite FK).
      await expect(
        db.query(
          `insert into public.service_scheduling_rules (organization_id, branch_id, service_id)
           values ($1, $2, $3)`,
          [orgA, branchB, svcA],
        ),
      ).rejects.toThrow(/fk_service_rules_service_same_branch/);
    });
  });
});

// -------------------------------------------------------------------------
// Pricing engine schema (migration 0010, Change 4A task 1.x)
// ALL monetary values below are NON-PRODUCTION test fixtures (P3).
// -------------------------------------------------------------------------

const PRICING_TABLES = ["pricing_profiles", "pricing_versions", "pricing_rules"];

/** Insert org + two branches + a category/service/add-on; returns ids. */
async function pricingOrgBranches(db: SimplePgClient) {
  const orgId = (await db.query<{ id: string }>(
    `insert into public.organizations (name, slug) values ('P', 'pricing-org') returning id`,
  )).rows[0].id;
  const branchA = (await db.query<{ id: string }>(
    `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
     values ($1, 'BA', 'pricing-a', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
    [orgId],
  )).rows[0].id;
  const branchB = (await db.query<{ id: string }>(
    `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
     values ($1, 'BB', 'pricing-b', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
    [orgId],
  )).rows[0].id;
  const cat = (await db.query<{ id: string }>(
    `insert into public.service_categories (organization_id, branch_id, slug, name)
     values ($1, $2, 'p-cat', 'Cat') returning id`,
    [orgId, branchA],
  )).rows[0].id;
  const svc = (await db.query<{ id: string }>(
    `insert into public.services (organization_id, branch_id, category_id, slug, name)
     values ($1, $2, $3, 'p-svc', 'Svc') returning id`,
    [orgId, branchA, cat],
  )).rows[0].id;
  const addon = (await db.query<{ id: string }>(
    `insert into public.service_addons (organization_id, branch_id, slug, name)
     values ($1, $2, 'p-addon', 'Addon') returning id`,
    [orgId, branchA],
  )).rows[0].id;
  return { orgId, branchA, branchB, svc, addon };
}

describe("pricing schema (migration 0010, Change 4A task 1.x)", () => {
  it("creates the three pricing tables", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name = any($1)`,
        [PRICING_TABLES],
      );
      expect(res.rows.map((r) => r.table_name).sort()).toEqual([...PRICING_TABLES].sort());
    });
  });

  it("enforces branch_id NOT NULL + org scope on every pricing table (P12/Q9)", async () => {
    await withFreshDb(async (db) => {
      const res = await db.query<{ table_name: string; is_nullable: string }>(
        `select table_name, is_nullable from information_schema.columns
          where table_schema = 'public' and column_name = 'branch_id'
            and table_name = any($1)`,
        [PRICING_TABLES],
      );
      expect(res.rows).toHaveLength(3);
      expect(res.rows.every((r) => r.is_nullable === "NO")).toBe(true);
    });
  });

  it("enforces lifecycle CHECKs, version uniqueness, effective range, tax shape", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA } = await pricingOrgBranches(db);
      const profile = (await db.query<{ id: string }>(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency)
         values ($1, $2, 'Fixture Profile', 'EUR') returning id`,
        [orgId, branchA],
      )).rows[0].id;

      // Invalid status rejected.
      await expect(
        db.query(
          `insert into public.pricing_profiles (organization_id, branch_id, name, currency, status)
           values ($1, $2, 'Bad', 'EUR', 'published')`,
          [orgId, branchA],
        ),
      ).rejects.toThrow(/pricing_profiles_status_check/);

      await db.query(
        `insert into public.pricing_versions
           (organization_id, branch_id, pricing_profile_id, version_number, effective_from)
         values ($1, $2, $3, 1, '2026-01-01')`,
        [orgId, branchA, profile],
      );
      // Version number unique per profile.
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, effective_from)
           values ($1, $2, $3, 1, '2026-02-01')`,
          [orgId, branchA, profile],
        ),
      ).rejects.toThrow(/uq_pricing_versions_profile_number/);
      // effective_until < effective_from rejected.
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, effective_from, effective_until)
           values ($1, $2, $3, 2, '2026-03-01', '2026-02-01')`,
          [orgId, branchA, profile],
        ),
      ).rejects.toThrow(/ck_pricing_versions_effective_range/);
      // Tax shape: rate without jurisdiction rejected. (Value 19 overflows
      // numeric(5,4) first — use 1.9 to reach the CHECK.)
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, effective_from, tax_rate_percent)
           values ($1, $2, $3, 2, '2026-03-01', 1.9)`,
          [orgId, branchA, profile],
        ),
      ).rejects.toThrow(/ck_pricing_versions_tax_shape/);
    });
  });

  it("enforces P17: overlapping PUBLISHED windows rejected, drafts unaffected", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA } = await pricingOrgBranches(db);
      const profile = (await db.query<{ id: string }>(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency)
         values ($1, $2, 'Overlap Profile', 'EUR') returning id`,
        [orgId, branchA],
      )).rows[0].id;
      await db.query(
        `insert into public.pricing_versions
           (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from, effective_until)
         values ($1, $2, $3, 1, 'published', '2026-01-01', '2026-06-30')`,
        [orgId, branchA, profile],
      );
      // Overlapping published window rejected by the EXCLUDE constraint.
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from, effective_until)
           values ($1, $2, $3, 2, 'published', '2026-06-01', '2026-12-31')`,
          [orgId, branchA, profile],
        ),
      ).rejects.toThrow(/ex_pricing_versions_published_no_overlap/);
      // Overlapping DRAFT window is fine (drafts are not published).
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from, effective_until)
           values ($1, $2, $3, 2, 'draft', '2026-06-01', '2026-12-31')`,
          [orgId, branchA, profile],
        ),
      ).resolves.toBeTruthy();
      // Non-overlapping published window is fine (adjacent day).
      await expect(
        db.query(
          `insert into public.pricing_versions
             (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from)
           values ($1, $2, $3, 3, 'published', '2026-07-01')`,
          [orgId, branchA, profile],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("enforces P11: at most one ACTIVE profile per branch, drafts unconstrained", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA } = await pricingOrgBranches(db);
      await db.query(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency, status)
         values ($1, $2, 'Active One', 'EUR', 'active')`,
        [orgId, branchA],
      );
      await expect(
        db.query(
          `insert into public.pricing_profiles (organization_id, branch_id, name, currency, status)
           values ($1, $2, 'Active Two', 'EUR', 'active')`,
          [orgId, branchA],
        ),
      ).rejects.toThrow(/uq_pricing_profiles_one_active_per_branch/);
      // Multiple drafts/archived profiles remain allowed (P11).
      await expect(
        db.query(
          `insert into public.pricing_profiles (organization_id, branch_id, name, currency, status)
           values ($1, $2, 'Draft Two', 'EUR', 'draft')`,
          [orgId, branchA],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("enforces P16: published versions immutable; only publish→archive allowed", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA } = await pricingOrgBranches(db);
      const profile = (await db.query<{ id: string }>(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency)
         values ($1, $2, 'Immutable Profile', 'EUR') returning id`,
        [orgId, branchA],
      )).rows[0].id;
      const version = (await db.query<{ id: string }>(
        `insert into public.pricing_versions
           (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from)
         values ($1, $2, $3, 1, 'published', '2026-01-01') returning id`,
        [orgId, branchA, profile],
      )).rows[0].id;

      // Content mutation rejected.
      await expect(
        db.query(`update public.pricing_versions set effective_from = '2026-02-01' where id = $1`, [version]),
      ).rejects.toThrow(/published pricing versions are immutable/);
      // Status mutation other than archive rejected.
      await expect(
        db.query(`update public.pricing_versions set status = 'draft' where id = $1`, [version]),
      ).rejects.toThrow(/published pricing versions are immutable/);
      // DELETE rejected.
      await expect(
        db.query(`delete from public.pricing_versions where id = $1`, [version]),
      ).rejects.toThrow(/published or archived pricing versions cannot be deleted/);
      // Archive transition (content-identical) is allowed.
      await db.query(`update public.pricing_versions set status = 'archived' where id = $1`, [version]);
      // Archived rows are fully immutable.
      await expect(
        db.query(`update public.pricing_versions set status = 'published' where id = $1`, [version]),
      ).rejects.toThrow(/archived pricing versions are immutable/);
    });
  });

  it("enforces P1: rules of published/archived versions are immutable", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA, svc } = await pricingOrgBranches(db);
      const profile = (await db.query<{ id: string }>(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency)
         values ($1, $2, 'Rule Profile', 'EUR') returning id`,
        [orgId, branchA],
      )).rows[0].id;
      const version = (await db.query<{ id: string }>(
        `insert into public.pricing_versions
           (organization_id, branch_id, pricing_profile_id, version_number, status, effective_from)
         values ($1, $2, $3, 1, 'published', '2026-01-01') returning id`,
        [orgId, branchA, profile],
      )).rows[0].id;
      // NON-PRODUCTION fixture rule (P3).
      const rule = (await db.query<{ id: string }>(
        `insert into public.pricing_rules
           (organization_id, branch_id, pricing_version_id, rule_type, service_id, configuration)
         values ($1, $2, $3, 'base_rate', $4, '{"model":"hourly","hourly_rate_minor":100}'::jsonb)
         returning id`,
        [orgId, branchA, version, svc],
      )).rows[0].id;

      await expect(
        db.query(
          `update public.pricing_rules set configuration = '{"model":"hourly","hourly_rate_minor":999}'::jsonb where id = $1`,
          [rule],
        ),
      ).rejects.toThrow(/rules of published or archived versions are immutable/);
      await expect(db.query(`delete from public.pricing_rules where id = $1`, [rule])).rejects.toThrow(
        /rules of published or archived versions are immutable/,
      );
      // Same-branch composite FK: a cross-branch rule is rejected. (New org
      // slug — the fixture helper runs inside one shared fresh DB.)
      const org2 = (await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('P2', 'pricing-org-2') returning id`,
      )).rows[0].id;
      const branchC = (await db.query<{ id: string }>(
        `insert into public.branches (organization_id, name, slug, country_code, timezone, currency, locale)
         values ($1, 'BC', 'pricing-c', 'DE', 'Europe/Berlin', 'EUR', 'de') returning id`,
        [org2],
      )).rows[0].id;
      await expect(
        db.query(
          `insert into public.pricing_rules
             (organization_id, branch_id, pricing_version_id, rule_type, service_id, configuration)
           values ($1, $2, $3, 'base_rate', $4, '{"model":"hourly","hourly_rate_minor":100}'::jsonb)`,
          [org2, branchC, version, svc],
        ),
      ).rejects.toThrow(/fk_pricing_rules_(version|service_same_branch)/);
    });
  });

  it("rejects rules referencing another branch's catalog identities (Q5 composite FKs)", async () => {
    await withFreshDb(async (db) => {
      const { orgId, branchA, branchB, svc, addon } = await pricingOrgBranches(db);
      const profile = (await db.query<{ id: string }>(
        `insert into public.pricing_profiles (organization_id, branch_id, name, currency)
         values ($1, $2, 'X-Branch Profile', 'EUR') returning id`,
        [orgId, branchA],
      )).rows[0].id;
      const version = (await db.query<{ id: string }>(
        `insert into public.pricing_versions
           (organization_id, branch_id, pricing_profile_id, version_number, effective_from)
         values ($1, $2, $3, 1, '2026-01-01') returning id`,
        [orgId, branchA, profile],
      )).rows[0].id;
      // branchB rule cannot target branchA's service or add-on.
      await expect(
        db.query(
          `insert into public.pricing_rules
             (organization_id, branch_id, pricing_version_id, rule_type, service_id)
           values ($1, $2, $3, 'base_rate', $4)`,
          [orgId, branchB, version, svc],
        ),
      ).rejects.toThrow(/fk_pricing_rules_(version|service_same_branch)/);
      await expect(
        db.query(
          `insert into public.pricing_rules
             (organization_id, branch_id, pricing_version_id, rule_type, service_addon_id)
           values ($1, $2, $3, 'addon_price', $4)`,
          [orgId, branchB, version, addon],
        ),
      ).rejects.toThrow(/fk_pricing_rules_(version|addon_same_branch)/);
    });
  });


});
