/**
 * Audit service (AUDIT_SYSTEM.md §5–9, §21–25).
 *
 * Audit is authoritative business accountability data. Domain events are
 * written transactionally with the state change they describe (§50); the
 * service returns a promise the caller must await inside the transaction.
 *
 * Metadata must remain bounded (§25): no full payloads, no entire rows.
 * Secrets, tokens, credentials, and payment data are prohibited (§21–23).
 */
import "server-only";
import { query, type TransactionClient } from "@/lib/db/server";

export type ActorType = "user" | "customer" | "system" | "automation" | "webhook" | "api";

export interface AuditEventInput {
  action: string; // resource.action, e.g. "branch.created"
  organizationId: string;
  branchId?: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  resourceType: string;
  resourceId?: string | null;
  result?: "success" | "failure";
  requestId?: string | null;
  /** Bounded, pre-redacted metadata. Callers are responsible for redaction. */
  metadata?: Record<string, unknown>;
}

/** Defensive redaction of keys that must never reach audit metadata. */
const FORBIDDEN_KEY_PATTERN =
  /(password|token|secret|key|credential|authorization|cookie|cvv|card_number)/i;

function redactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactMetadata(v as Record<string, unknown>);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Serialize bounded metadata — hard cap protects the audit trail size. */
function boundedMetadata(input: Record<string, unknown>): string {
  const redacted = redactMetadata(input);
  const json = JSON.stringify(redacted);
  // AUDIT_SYSTEM §25: metadata must remain bounded (4 KB cap).
  return json.length > 4096 ? JSON.stringify({ truncated: true }) : json;
}

export async function writeAuditEvent(
  event: AuditEventInput,
  tx?: TransactionClient,
): Promise<void> {
  const client = tx ?? { query };
  await client.query(
    `insert into public.audit_logs (
       organization_id, branch_id, actor_user_id, actor_type, action,
       resource_type, resource_id, result, metadata, request_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      event.organizationId,
      event.branchId ?? null,
      event.actorUserId ?? null,
      event.actorType ?? "user",
      event.action,
      event.resourceType,
      event.resourceId ?? null,
      event.result ?? "success",
      boundedMetadata(event.metadata ?? {}),
      event.requestId ?? null,
    ],
  );
}
