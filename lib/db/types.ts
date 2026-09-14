/**
 * Minimal SQL client interface shared by drivers.
 *
 * Production uses the privileged Supabase/PostgreSQL connection (server-only);
 * tests use pglite. Both speak the same `query(sql, params)` shape.
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SimplePgClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  /**
   * Execute a multi-statement SQL string (migrations). Optional: node-postgres
   * supports multi-statement strings natively; pglite requires `exec`.
   */
  exec?(sql: string): Promise<void>;
}
