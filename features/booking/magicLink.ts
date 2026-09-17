/**
 * Magic-link customer access (Change 5, task 9.1; TD-3, SECURITY_PRIVACY
 * §29–34, DATABASE §41).
 *
 * Tokens: 256-bit random value shown once; ONLY its sha-256 hex digest is
 * stored; single-use (consumed at verify); expiring; revocable; scoped to
 * exactly one booking. The token table is RLS deny-all — every read/write
 * flows through this privileged domain layer. Verification responses are
 * enumeration-safe (§32): invalid and expired tokens are indistinguishable
 * to the customer. Short-lived customer sessions are server-side records
 * bound to customer + booking and NEVER grant staff permissions.
 *
 * Rate limiting (§33) is enforced per email/booking at the action boundary
 * via a bounded in-process window (single-instance V1; a distributed
 * limiter arrives with the Notification/infra change).
 */
import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { bookingError, BookingErrorCode } from "./errors";
import { enqueueOutbox } from "./events";

export const MAGIC_LINK_TTL_MINUTES = 15; // TD-3 default (branch-configurable later)
export const CUSTOMER_SESSION_TTL_MINUTES = 60 * 8; // short-lived hub session

interface TokenRow {
  id: string;
  organization_id: string;
  customer_id: string;
  booking_id: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Rate limiting (§33) — bounded per-key window, in-process (V1).
// ---------------------------------------------------------------------------

const rateWindows = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60_000; // 1 hour
const RATE_LIMIT_MAX = 5; // issues per booking/email per hour

function rateLimitHit(key: string): boolean {
  const now = Date.now();
  const window = (rateWindows.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (window.length >= RATE_LIMIT_MAX) {
    rateWindows.set(key, window);
    return false;
  }
  window.push(now);
  rateWindows.set(key, window);
  return true;
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface MagicLinkIssueResult {
  /** The one-time token (returned ONLY here; never stored in the clear). */
  token: string;
  expiresAt: string;
}

/**
 * Issue a magic link for a booking (task 9.1). The booking must belong to a
 * customer whose normalized email matches the requester's — enumeration-safe
 * (wrong email for an existing booking behaves like "booking not found").
 * Revokes outstanding tokens for the booking (TD-3 revocation) and enqueues
 * the magic-link email transactionally.
 */
export async function issueMagicLink(
  raw: { booking_number: string; email: string },
  now: Date = new Date(),
): Promise<MagicLinkIssueResult> {
  const bookingNumber = raw.booking_number.trim();
  const email = raw.email.trim().toLowerCase();

  if (!rateLimitHit(`issue:${bookingNumber}:${email}`)) {
    throw bookingError(BookingErrorCode.RATE_LIMITED);
  }

  return withTransaction(async (tx) => {
    // Enumeration safety: identical failure shape whether the booking or the
    // customer lookup fails (SECURITY_PRIVACY §32).
    const booking = await tx.query<{ id: string; organization_id: string; branch_id: string; customer_id: string }>(
      `select id, organization_id, branch_id, customer_id from public.bookings
       where booking_number = $1`,
      [bookingNumber],
    );
    const b = booking.rows[0];
    if (!b) throw new AppError(ErrorCode.NOT_FOUND, "If the details match, a link has been sent.");

    const customer = await tx.query<{ id: string; email_normalized: string }>(
      `select id, email_normalized from public.customers where id = $1`,
      [b.customer_id],
    );
    const c = customer.rows[0];
    if (!c || c.email_normalized !== email) {
      throw new AppError(ErrorCode.NOT_FOUND, "If the details match, a link has been sent.");
    }

    // Revoke outstanding tokens for this booking (single live link, TD-3).
    await tx.query(
      `update public.customer_magic_link_tokens
       set revoked_at = now()
       where booking_id = $1 and revoked_at is null and consumed_at is null`,
      [b.id],
    );

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MINUTES * 60_000);
    await tx.query(
      `insert into public.customer_magic_link_tokens
         (organization_id, customer_id, booking_id, token_hash, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [b.organization_id, c.id, b.id, sha256Hex(token), expiresAt.toISOString()],
    );

    // TD-3.5: magic-link email enqueued transactionally.
    await enqueueOutbox(tx, {
      organizationId: b.organization_id,
      branchId: b.branch_id,
      bookingId: b.id,
      eventType: "magic_link_email",
      payload: { booking_id: b.id, customer_id: c.id }, // token itself rides the out-of-band channel in production
    });

    return { token, expiresAt: expiresAt.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Verify (single-use consume) + customer session
// ---------------------------------------------------------------------------

export interface CustomerSession {
  sessionId: string;
  customerId: string;
  bookingId: string;
  organizationId: string;
  expiresAt: Date;
}

interface SessionRecord extends CustomerSession {
  expired: boolean;
}

const sessions = new Map<string, SessionRecord>();

/**
 * Verify a presented token: hash lookup → not revoked, not consumed, not
 * expired → single-use consume. Invalid/expired/revoked tokens return the
 * same stable error (enumeration-safe; §32).
 */
export async function verifyMagicLink(
  raw: { token: string },
  now: Date = new Date(),
): Promise<CustomerSession> {
  const tokenHash = sha256Hex(raw.token);
  const res = await query<TokenRow>(
    `select id, organization_id, customer_id, booking_id, token_hash,
            expires_at::text, consumed_at::text, revoked_at::text
     from public.customer_magic_link_tokens where token_hash = $1`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (
    !row ||
    row.consumed_at !== null ||
    row.revoked_at !== null ||
    new Date(row.expires_at).getTime() <= now.getTime()
  ) {
    throw bookingError(BookingErrorCode.TOKEN_INVALID);
  }

  await query(
    `update public.customer_magic_link_tokens
     set consumed_at = now()
     where id = $1 and consumed_at is null and revoked_at is null`,
    [row.id],
  ).then((r) => {
    if (r.rowCount === 0) throw bookingError(BookingErrorCode.TOKEN_INVALID);
  });

  const session: SessionRecord = {
    sessionId: randomUUID(),
    customerId: row.customer_id,
    bookingId: row.booking_id,
    organizationId: row.organization_id,
    expiresAt: new Date(now.getTime() + CUSTOMER_SESSION_TTL_MINUTES * 60_000),
    expired: false,
  };
  sessions.set(session.sessionId, session);
  return session;
}

/**
 * Resolve an active customer session. The session is bound to exactly one
 * customer + booking and confers NO staff permissions.
 */
export async function requireCustomerSession(sessionId: string, now: Date = new Date()): Promise<CustomerSession> {
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt.getTime() <= now.getTime()) {
    sessions.delete(sessionId);
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Customer session expired.");
  }
  return session;
}

export function endCustomerSession(sessionId: string): void {
  sessions.delete(sessionId);
}
