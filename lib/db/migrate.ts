/**
 * SQL migration runner (DATABASE.md §63: migrations are versioned SQL files
 * applied in lexicographic order; DEPLOYMENT.md §38: the chain must build on
 * a clean database).
 *
 * - Production chain: `supabase/migrations/*.sql` ONLY — these are safe for
 *   hosted Supabase and are what `supabase db push` applies.
 * - Local/test environments additionally need the auth-schema shim from
 *   `supabase/migrations-local/` (hosted Supabase provides `auth` natively).
 *   Set `localShimDir` to include it; production tooling must never do so.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SimplePgClient } from "@/lib/db/types";

export const MIGRATIONS_DIR = "supabase/migrations";
export const LOCAL_SHIM_DIR = "supabase/migrations-local";

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

function readSqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(
  client: SimplePgClient,
  opts: { includeLocalShim?: boolean } = {},
): Promise<MigrationResult> {
  const applied: string[] = [];
  let skipped = 0;

  // Opt-in local shim lives OUTSIDE the production chain; it is only applied
  // when explicitly requested (tests), never as part of the default chain.
  if (opts.includeLocalShim) {
    for (const file of readSqlFiles(LOCAL_SHIM_DIR)) {
      const sql = readFileSync(join(process.cwd(), LOCAL_SHIM_DIR, file), "utf8");
      if (typeof client.exec === "function") {
        await client.exec(sql);
      } else {
        await client.query(sql);
      }
      applied.push(`${LOCAL_SHIM_DIR}/${file}`);
    }
  } else {
    skipped += readSqlFiles(join(process.cwd(), LOCAL_SHIM_DIR)).length;
  }

  // Production chain — the only directory hosted Supabase tooling touches.
  for (const file of readSqlFiles(join(process.cwd(), MIGRATIONS_DIR))) {
    const sql = readFileSync(join(process.cwd(), MIGRATIONS_DIR, file), "utf8");
    if (typeof client.exec === "function") {
      await client.exec(sql); // pglite path: multi-statement via exec
    } else {
      await client.query(sql); // node-postgres: simple query protocol
    }
    applied.push(file);
  }

  return { applied, skipped };
}
