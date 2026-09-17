/**
 * Customer domain (Change 5, task 4.1–4.2; BD-4).
 *
 * Organization-scoped customer identity without accounts:
 *   - email normalized (trim + lowercase), phone normalized E.164 —
 *     normalized values are used for BOTH matching and storage;
 *   - matching: email first, then phone;
 *   - on a match with differing entered contact details: keep the stored
 *     canonical values, flag the conflict, record a
 *     `contact_conflict_flagged` booking event, let the booking proceed
 *     under the matched customer; staff resolve via customers.edit;
 *   - uniqueness is organization-wide (partial UNIQUE indexes, 0011).
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  normalizeEmail,
  normalizePhoneE164,
  updateCustomerSchema,
  type CustomerInput,
  type UpdateCustomerInput,
} from "./schemas/booking";

export interface CustomerRecord {
  id: string;
  organization_id: string;
  email_normalized: string;
  phone_e164: string | null;
  first_name: string;
  last_name: string;
  company: string | null;
  preferred_language: string | null;
  status: string;
  contact_conflict_flag: boolean;
  notes: string | null;
}

/** Normalized customer identity derived from checkout input (BD-4). */
export interface NormalizedCustomer {
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  company: string | null;
  preferredLanguage: string | null;
}

export function normalizeCustomerInput(input: CustomerInput): NormalizedCustomer {
  return {
    email: normalizeEmail(input.email),
    phone: input.phone ? normalizePhoneE164(input.phone) : null,
    firstName: input.first_name.trim(),
    lastName: input.last_name.trim(),
    company: input.company?.trim() || null,
    preferredLanguage: input.preferred_language?.trim() || null,
  };
}

/**
 * BD-4 upsert: match by normalized email first, then by normalized phone;
 * otherwise insert. Returns the customer plus whether a contact conflict
 * was flagged (the caller records the `contact_conflict_flagged` event
 * inside its own transaction).
 */
export async function upsertCustomer(
  organizationId: string,
  normalized: NormalizedCustomer,
  tx?: TransactionClient,
): Promise<{ customer: CustomerRecord; conflict: boolean }> {
  const client = tx ?? { query };

  // Match 1 — email (BD-4 order).
  const byEmail = await client.query<CustomerRecord>(
    `select id, organization_id, email_normalized, phone_e164, first_name, last_name,
            company, preferred_language, status, contact_conflict_flag, notes
     from public.customers where organization_id = $1 and email_normalized = $2`,
    [organizationId, normalized.email],
  );
  let existing = byEmail.rows[0];

  // Match 2 — phone (only when email did not match and a phone was given).
  if (!existing && normalized.phone) {
    const byPhone = await client.query<CustomerRecord>(
      `select id, organization_id, email_normalized, phone_e164, first_name, last_name,
              company, preferred_language, status, contact_conflict_flag, notes
       from public.customers where organization_id = $1 and phone_e164 = $2`,
      [organizationId, normalized.phone],
    );
    existing = byPhone.rows[0];
  }

  if (existing) {
    // BD-4: differing entered details NEVER overwrite stored canonical
    // values; flag the conflict for staff resolution.
    const emailDiffers = normalized.email !== existing.email_normalized;
    const phoneDiffers =
      normalized.phone !== null && normalized.phone !== existing.phone_e164;
    const conflict = emailDiffers || phoneDiffers;
    if (conflict) {
      await client.query(
        `update public.customers set contact_conflict_flag = true, updated_at = now()
         where id = $1`,
        [existing.id],
      );
      existing = { ...existing, contact_conflict_flag: true };
    }
    return { customer: existing, conflict };
  }

  // No match: insert the new organization-scoped customer.
  const inserted = await client.query<CustomerRecord>(
    `insert into public.customers
       (organization_id, email_normalized, phone_e164, first_name, last_name,
        company, preferred_language)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, organization_id, email_normalized, phone_e164, first_name, last_name,
               company, preferred_language, status, contact_conflict_flag, notes`,
    [
      organizationId,
      normalized.email,
      normalized.phone,
      normalized.firstName,
      normalized.lastName,
      normalized.company,
      normalized.preferredLanguage,
    ],
  );
  return { customer: inserted.rows[0], conflict: false };
}

// ---------------------------------------------------------------------------
// Customer CRUD (task 4.2; customers.view / customers.edit)
// ---------------------------------------------------------------------------

export async function getCustomer(ctx: AuthContext, customerId: string): Promise<CustomerRecord> {
  requirePermission(ctx, "customers.view");
  const res = await query<CustomerRecord>(
    `select id, organization_id, email_normalized, phone_e164, first_name, last_name,
            company, preferred_language, status, contact_conflict_flag, notes
     from public.customers where id = $1`,
    [customerId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Customer not found.");
  requireOrganizationAccess(ctx, row.organization_id);
  return row;
}

export interface ListCustomersOptions {
  search?: string;
  conflictsOnly?: boolean;
  limit?: number;
}

export async function listCustomers(
  ctx: AuthContext,
  organizationId: string,
  options: ListCustomersOptions = {},
): Promise<CustomerRecord[]> {
  requirePermission(ctx, "customers.view");
  requireOrganizationAccess(ctx, organizationId);
  const params: unknown[] = [organizationId];
  const conditions: string[] = ["organization_id = $1"];
  if (options.conflictsOnly) {
    conditions.push("contact_conflict_flag = true");
  }
  if (options.search && options.search.trim().length > 0) {
    params.push(`%${normalizeEmail(options.search)}%`);
    conditions.push(
      `(email_normalized ilike $${params.length} or lower(first_name || ' ' || last_name) ilike lower($${params.length}))`,
    );
  }
  params.push(Math.min(options.limit ?? 100, 500));
  const res = await query<CustomerRecord>(
    `select id, organization_id, email_normalized, phone_e164, first_name, last_name,
            company, preferred_language, status, contact_conflict_flag, notes
     from public.customers where ${conditions.join(" and ")}
     order by created_at desc limit $${params.length}`,
    params,
  );
  return res.rows;
}

/** Resolve a contact conflict (customers.edit; BD-4 staff correction path). */
export async function updateCustomer(
  ctx: AuthContext,
  customerId: string,
  raw: UpdateCustomerInput,
): Promise<CustomerRecord> {
  requirePermission(ctx, "customers.edit");
  const input = updateCustomerSchema.parse(raw);

  return withTransaction(async (tx) => {
    const res = await tx.query<CustomerRecord>(
      `select id, organization_id, email_normalized, phone_e164, first_name, last_name,
              company, preferred_language, status, contact_conflict_flag, notes
       from public.customers where id = $1 for update`,
      [customerId],
    );
    const existing = res.rows[0];
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "Customer not found.");
    requireOrganizationAccess(ctx, existing.organization_id);

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };

    if (input.email !== undefined) {
      // Organization-wide uniqueness must hold for the new email (BD-4).
      const dup = await tx.query<{ id: string }>(
        `select id from public.customers
         where organization_id = $1 and email_normalized = $2 and id <> $3`,
        [existing.organization_id, normalizeEmail(input.email), customerId],
      );
      if (dup.rows[0]) {
        throw new AppError(ErrorCode.CONFLICT, "Another customer already uses this email.");
      }
      push("email_normalized", normalizeEmail(input.email));
    }
    if (input.phone !== undefined) {
      push("phone_e164", input.phone === null ? null : normalizePhoneE164(input.phone));
    }
    if (input.first_name !== undefined) push("first_name", input.first_name.trim());
    if (input.last_name !== undefined) push("last_name", input.last_name.trim());
    if (input.company !== undefined) push("company", input.company);
    if (input.preferred_language !== undefined) push("preferred_language", input.preferred_language);
    if (input.status !== undefined) push("status", input.status);
    if (input.notes !== undefined) push("notes", input.notes);
    // Clearing the conflict flag is an explicit staff action (customers.edit).
    if (input.contact_conflict_flag !== undefined) push("contact_conflict_flag", input.contact_conflict_flag);
    if (sets.length === 0) {
      throw new AppError(ErrorCode.INVALID_INPUT, "No customer fields provided.");
    }

    const updated = await tx.query<CustomerRecord>(
      `update public.customers set ${sets.join(", ")}, updated_at = now()
       where id = $1
       returning id, organization_id, email_normalized, phone_e164, first_name, last_name,
                 company, preferred_language, status, contact_conflict_flag, notes`,
      [customerId, ...params],
    );

    await writeAuditEvent(
      {
        action: "customers.updated",
        organizationId: existing.organization_id,
        actorUserId: ctx.actor.userId,
        resourceType: "customers",
        resourceId: customerId,
        requestId: ctx.requestId ?? null,
        metadata: { fields: Object.keys(input) },
      },
      tx,
    );
    return updated.rows[0];
  });
}
