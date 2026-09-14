/**
 * Server-side SQL executor over the privileged (service-role) connection.
 *
 * SECURITY: "server-only" guarantees this module never reaches browser code
 * (PROJECT_STRUCTURE.md §128–130). The privileged client is only usable from
 * server code that has already performed authentication + authorization.
 *
 * Production uses node-postgres over the Supabase pooler; tests inject a
 * pglite-backed executor via setExecutorForTests (never set in production).
 *
 * Transaction correctness: `withTransaction` checks out a dedicated client
 * for the whole transaction so `begin`/`commit`/`rollback` and every
 * statement run on the same connection (a shared `pool.query("begin")` would
 * allow statements to land on different pool clients, silently breaking
 * atomicity). On hosted Supabase (transaction-mode pooler) the explicit
 * transaction pins the session for its duration.
 */
import "server-only";
import { Pool } from "pg";
import type { QueryResult, SimplePgClient } from "./types";

let executor: SimplePgClient | null = null;
let pool: Pool | null = null;

/** True when the injected test executor is in use (no Pool available). */
function usingTestExecutor(): boolean {
  return pool === null && executor !== null;
}

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.SUPABASE_DB_URL
    ? process.env.SUPABASE_DB_URL
    : process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `postgresql://postgres:${process.env.SUPABASE_SERVICE_ROLE_KEY}@db.${new URL(
          process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
        ).hostname}:5432/postgres`
      : undefined;

  // Hosted Supabase (pooler or direct) requires TLS. The pooler presents a
  // certificate chain that is not always present in local trust stores
  // ("self-signed certificate in certificate chain"), so encryption is
  // enforced without CA validation — the pattern in the Supabase docs for
  // sslmode=require. Verify-full against the Supabase CA is future hardening.
  const isSupabaseRemote =
    !!connectionString && /pooler\.supabase\.com|\.supabase\.(co|com)/.test(connectionString);

  pool = new Pool({
    connectionString,
    max: 10,
    ssl: isSupabaseRemote ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

function getExecutor(): SimplePgClient {
  if (executor) return executor;

  const p = getPool();
  const exec: SimplePgClient = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      const res = await p.query(sql, params as never[]);
      return { rows: res.rows as unknown as T[], rowCount: res.rowCount ?? 0 };
    },
  };
  executor = exec;
  return exec;
}

/** Test-only executor injection (pglite). Never used in production. */
export function setExecutorForTests(client: SimplePgClient): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setExecutorForTests must never run in production");
  }
  executor = client;
  pool = null;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getExecutor().query<T>(sql, params);
}

export interface TransactionClient {
  query<K = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<K>>;
}

/**
 * Run `fn` inside a database transaction. On throw, the transaction is
 * rolled back and the error propagates (API_STANDARDS.md §18: atomic
 * operations must leave no partial state).
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  // Test executor path: single connection, begin/commit via the executor.
  if (usingTestExecutor()) {
    const client = executor!;
    await client.query("begin");
    try {
      const result = await fn(wrapTx(client));
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  // Production path: dedicated pool client for the whole transaction.
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("begin");
    const result = await fn({
      query: async <K = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<QueryResult<K>> => {
        const res = await client.query(sql, params as never[]);
        return { rows: res.rows as unknown as K[], rowCount: res.rowCount ?? 0 };
      },
    });
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // Connection already broken; release regardless.
    }
    throw err;
  } finally {
    client.release();
  }
}

function wrapTx(client: SimplePgClient): TransactionClient {
  return {
    query: <K = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<K>> => client.query<K>(sql, params),
  };
}
