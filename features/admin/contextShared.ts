/**
 * Admin context shared constants (Change 8, C8-1) — CLIENT-SAFE.
 *
 * Contains no server imports (no "server-only", no db, no Supabase) so it
 * can be imported by both server modules (features/admin/context.ts) and
 * client components (contextSelector.tsx). The server-side resolver lives
 * in features/admin/context.ts and re-validates every echo on the server;
 * this module only defines the wire format of the context echo.
 */

/** Non-sensitive context-echo cookie name (design §8). Holds a branch UUID or "all". */
export const ADMIN_CONTEXT_COOKIE = "clenqo_admin_branch";

/** The reserved organization-wide context value (HQ roles only, enforced server-side). */
export const ADMIN_CONTEXT_ALL = "all";

/** Validate a cookie/query echo value before use (defense in depth). */
export function isValidContextEcho(value: string | undefined | null): value is string {
  if (!value) return false;
  if (value === ADMIN_CONTEXT_ALL) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
