/**
 * CLI bootstrap fallback (BD-A1, design §6): enforces the EXACT same
 * zero-active-HQ-admin invariant and SETUP_TOKEN check as the /setup flow.
 * Recovery path only — never a repeatable bootstrap.
 *
 * Usage: node --env-file=.env.local scripts/setup-admin.ts <userId> [orgName]
 * Token comes from SETUP_TOKEN in the environment.
 */
import { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";

async function main() {
  const [userId, orgName] = process.argv.slice(2);
  if (!userId) {
    console.error("usage: node --env-file=.env.local scripts/setup-admin.ts <userId> [orgName]");
    process.exit(1);
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("SUPABASE_DB_URL missing");
    process.exit(1);
  }

  const expected = process.env.SETUP_TOKEN;
  const presented = process.argv.includes("--token")
    ? process.argv[process.argv.indexOf("--token") + 1]
    : process.env.SETUP_TOKEN_PROMPT;
  const a = Buffer.from(expected ?? "", "utf8");
  const b = Buffer.from(presented ?? "", "utf8");
  if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    console.error("invalid setup token");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const dup = await client.query(
        `select 1 from public.memberships where role = 'hq_admin' and status = 'active' limit 1`,
      );
      if (dup.rowCount) {
        throw new Error("setup permanently disabled after bootstrap");
      }
      const user = await client.query(`select id from auth.users where id = $1`, [userId]);
      if (!user.rowCount) {
        throw new Error("user does not exist in Supabase Auth");
      }
      let org = await client.query(`select id from public.organizations order by created_at asc limit 1`);
      if (!org.rowCount) {
        org = await client.query(`insert into public.organizations (name) values ($1) returning id`, [
          orgName || "CLENQO",
        ]);
      }
      const organizationId = org.rows[0].id as string;
      await client.query(
        `insert into public.memberships (organization_id, user_id, role, status)
         values ($1, $2, 'hq_admin', 'active')`,
        [organizationId, userId],
      );
      await client.query(
        `insert into public.audit_logs (
           organization_id, actor_user_id, actor_type, action, resource_type, resource_id, result, metadata
         ) values ($1, $2, 'user', 'admin.setup_completed', 'organization', $1, 'success', '{"cli":true}'::jsonb)`,
        [organizationId, userId],
      );
      await client.query("commit");
      console.log("bootstrap complete:", organizationId);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
