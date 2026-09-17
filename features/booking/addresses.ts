/**
 * Customer address management (Change 5, task 4.2; TD-4).
 *
 * Addresses are reusable REFERENCE data owned by the customer record.
 * Confirmed bookings capture an immutable `service_address` snapshot
 * (TD-4), so editing or deleting an address never mutates booking
 * history. Access instructions are sensitive (BOOKING_SYSTEM §13) and
 * protected by organization-scoped RLS.
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  type AuthContext,
} from "@/lib/authorization/server";
import { writeAuditEvent } from "@/lib/audit/service";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { addressInputSchema, type AddressInput } from "./schemas/booking";

export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string | null;
  street: string;
  house_number: string;
  postal_code: string;
  city: string;
  country: string;
  access_instructions: string | null;
}

const ADDRESS_COLUMNS = `id, customer_id, label, street, house_number, postal_code, city, country, access_instructions`;

export async function listAddresses(
  ctx: AuthContext,
  customerId: string,
): Promise<CustomerAddress[]> {
  requirePermission(ctx, "customers.view");
  const res = await query<CustomerAddress>(
    `select ${ADDRESS_COLUMNS} from public.customer_addresses where customer_id = $1 order by created_at`,
    [customerId],
  );
  const customer = await query<{ organization_id: string }>(
    `select organization_id from public.customers where id = $1`,
    [customerId],
  );
  if (customer.rows[0]) requireOrganizationAccess(ctx, customer.rows[0].organization_id);
  return res.rows;
}

export async function createAddress(
  ctx: AuthContext,
  customerId: string,
  raw: unknown,
): Promise<CustomerAddress> {
  requirePermission(ctx, "customers.edit");
  const input = addressInputSchema.parse(raw) as AddressInput;
  return withTransaction(async (tx) => {
    const customer = await tx.query<{ organization_id: string }>(
      `select organization_id from public.customers where id = $1`,
      [customerId],
    );
    const org = customer.rows[0];
    if (!org) throw new AppError(ErrorCode.NOT_FOUND, "Customer not found.");
    requireOrganizationAccess(ctx, org.organization_id);

    const res = await tx.query<CustomerAddress>(
      `insert into public.customer_addresses
         (organization_id, customer_id, label, street, house_number, postal_code, city, country, access_instructions)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning ${ADDRESS_COLUMNS}`,
      [
        org.organization_id,
        customerId,
        input.label ?? null,
        input.street,
        input.house_number,
        input.postal_code,
        input.city,
        input.country,
        input.access_instructions ?? null,
      ],
    );
    await writeAuditEvent(
      {
        action: "customers.updated",
        organizationId: org.organization_id,
        actorUserId: ctx.actor.userId,
        resourceType: "customer_addresses",
        resourceId: res.rows[0].id,
        requestId: ctx.requestId ?? null,
        metadata: { kind: "address_created", customer_id: customerId },
      },
      tx,
    );
    return res.rows[0];
  });
}

export async function deleteAddress(ctx: AuthContext, addressId: string): Promise<void> {
  requirePermission(ctx, "customers.edit");
  await withTransaction(async (tx) => {
    const res = await tx.query<{ organization_id: string }>(
      `delete from public.customer_addresses where id = $1 returning organization_id`,
      [addressId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Address not found.");
    requireOrganizationAccess(ctx, row.organization_id);
    await writeAuditEvent(
      {
        action: "customers.updated",
        organizationId: row.organization_id,
        actorUserId: ctx.actor.userId,
        resourceType: "customer_addresses",
        resourceId: addressId,
        requestId: ctx.requestId ?? null,
        metadata: { kind: "address_deleted" },
      },
      tx,
    );
  });
}
