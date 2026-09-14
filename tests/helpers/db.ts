/**
 * Test database harness: one fresh in-process PostgreSQL per test FILE,
 * with the real migration chain (0000 shim → 0007 RLS) applied.
 *
 * Cross-file parallelism is safe because each file gets its own instance.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPglite, type PgliteHandle } from "@/lib/db/pglite";
import { runMigrations } from "@/lib/db/migrate";
import type { SimplePgClient } from "@/lib/db/types";

export interface TestDb {
  db: SimplePgClient;
  /** Raw exec for harness-level operations (role switching, etc.). */
  exec: PgliteHandle["exec"];
  close: () => Promise<void>;
  fx: ReturnType<typeof createFixtures>;
}

let singleton: TestDb | null = null;

/**
 * Bootstrap a fresh pglite: test-only auth shim pieces at the correct points
 * (schema/roles BEFORE migrations, auth.uid() + grants AFTER — 0007 policies
 * reference auth.uid(); never applied in hosted Supabase), then the real
 * migration chain.
 */
async function bootstrap(): Promise<PgliteHandle> {
  const handle = await createPglite();
  const shim = await readFile(
    join(process.cwd(), "tests", "helpers", "auth_shim.sql"),
    "utf8",
  );
  const [prePart, postPart] = shim.split("-- ===== Applied AFTER");
  const pre = prePart.replace(
    "-- ===== Applied BEFORE migrations =====",
    "",
  );
  await handle.exec(pre);
  await runMigrations(
    { query: handle.client.query, exec: handle.exec },
    { includeLocalShim: true },
  );
  // Post-migration piece: auth.uid()/auth.role() functions + grants.
  await handle.exec("-- ===== Applied AFTER" + postPart);
  return handle;
}

/** One database per test file (vitest forks isolate files). */
export async function getTestDb(): Promise<TestDb> {
  if (singleton) return singleton;

  const handle = await bootstrap();
  const db: SimplePgClient = handle.client;
  singleton = { db, exec: handle.exec, close: handle.close, fx: createFixtures(db) };
  return singleton;
}

/** Run the full bootstrap again on a fresh database (fresh-migration check). */
export async function withFreshDb<T>(
  fn: (db: SimplePgClient, exec: PgliteHandle["exec"]) => Promise<T>,
): Promise<T> {
  const handle = await bootstrap();
  try {
    return await fn(handle.client, handle.exec);
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function createFixtures(db: SimplePgClient) {
  return {
    /** Create a fake auth user; returns the user id. */
    async createUser(email: string): Promise<string> {
      const res = await db.query<{ id: string }>(
        `insert into auth.users (email) values ($1) returning id`,
        [email],
      );
      return res.rows[0].id;
    },

    /** Create a profile + organization membership. */
    async createMembership(
      userId: string,
      orgId: string,
      role: "hq_admin" | "hq_staff" | "branch_manager" | "cleaner",
    ): Promise<string> {
      const res = await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role)
         values ($1, $2, $3) returning id`,
        [orgId, userId, role],
      );
      return res.rows[0].id;
    },

    /** Grant branch scope to a membership. */
    async grantBranch(membershipId: string, branchId: string): Promise<void> {
      await db.query(
        `insert into public.membership_branches (membership_id, branch_id)
         values ($1, $2)`,
        [membershipId, branchId],
      );
    },

    /** Create an organization; returns the org id. */
    async createOrganization(name: string, slug: string): Promise<string> {
      const res = await db.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ($1, $2) returning id`,
        [name, slug],
      );
      return res.rows[0].id;
    },

    /** Insert a branch row directly (bypasses the service layer). */
    async createBranch(
      orgId: string,
      slug: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const res = await db.query<{ id: string }>(
        `insert into public.branches (
           organization_id, name, slug, status, provisioning_status,
           country_code, timezone, currency, locale, enabled_locales
         ) values (
           $1, $2, $3,
           coalesce($4::text, 'provisioning'),
           coalesce($5::text, 'pending'),
           'DE', 'Europe/Berlin', 'EUR', 'de', '["de"]'::jsonb
         ) returning id`,
        [
          orgId,
          overrides.name ?? `Branch ${slug}`,
          slug,
          overrides.status ?? null,
          overrides.provisioning_status ?? null,
        ],
      );
      return res.rows[0].id;
    },
  };
}

// ---------------------------------------------------------------------
// RLS test helpers — role switching inside pglite
// ---------------------------------------------------------------------

/**
 * pglite runs as a superuser, so RLS is bypassed by default. These helpers
 * temporarily switch to the `authenticated` role and set auth.uid() to
 * genuinely exercise the RLS policies.
 */

export async function beginRlsContext(
  db: SimplePgClient,
  userId: string | null,
): Promise<void> {
  await db.query(`begin`);
  await db.query(`set local role authenticated`);
  if (userId) {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId }),
    ]);
  }
}

export async function endRlsContext(db: SimplePgClient): Promise<void> {
  await db.query(`rollback`);
}

/**
 * Run `fn` as the `authenticated` role with auth.uid() set to userId.
 * pglite's auth.uid() shim reads request.jwt.claims (installed by the
 * harness below).
 */
export async function asAuthenticatedUser<T>(
  db: SimplePgClient,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await beginRlsContext(db, userId);
  try {
    return await fn();
  } finally {
    await endRlsContext(db);
  }
}
