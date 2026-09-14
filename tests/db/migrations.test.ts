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
