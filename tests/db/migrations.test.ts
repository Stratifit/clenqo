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

  it("keeps the migration chain file sequence intact (0001–0008)", async () => {
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
    ]);
  });
});
