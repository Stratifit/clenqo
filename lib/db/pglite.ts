/**
 * In-process PostgreSQL (pglite) adapter — TEST-ONLY.
 * Used to genuinely execute the SQL migration chain, RLS policies, and
 * transaction behavior without external infrastructure.
 */
import { PGlite } from "@electric-sql/pglite";

export interface PgliteHandle {
  client: {
    query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number }>;
  };
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createPglite(): Promise<PgliteHandle> {
  const db = new PGlite();

  const client = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number }> {
      const res = await db.query<T>(sql, params as never[]);
      // Match PostgreSQL semantics: rowCount is the number of rows affected
      // by INSERT/UPDATE/DELETE. pglite exposes that as affectedRows (SELECT
      // leaves it undefined); rows.length is the correct fallback.
      const affected = (res as { affectedRows?: number }).affectedRows;
      return { rows: res.rows, rowCount: affected ?? res.rows.length };
    },
  };

  return {
    client,
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

/** Advisory-lock keys used by the harness (fixed namespace 0xC1E). */
export const ADVISORY_LOCK_CREATE_BRANCH = 0xc1e0001;
export const ADVISORY_LOCK_RETRY = 0xc1e0002;
