/**
 * Idempotent catalog seed mechanism (openspec/changes/create-service-catalog
 * task 12; docs/SERVICE_CATALOG.md §10 + §20.2; decision Q6).
 *
 * The definition file format is: categories → services → variants → add-ons
 * → compatibility → translations. The runner performs natural-key
 * existence-check upserts — running it twice produces identical row counts
 * (same guarantees as Change 1 provisioning; DATABASE.md §48/§55).
 *
 * Q6 GATE: `V1_CATALOG_DEFINITION` is a PLACEHOLDER. The concrete V1
 * commercial catalog has NOT been approved by the business
 * (docs/SERVICE_CATALOG.md §7 "V1 Catalog — Pending Business Approval").
 * Task 12.4 is explicitly blocked on business approval — do not populate
 * this with invented content.
 *
 * Seeded rows are always disabled and not customer-visible (Q2).
 */
import "server-only";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/features/branches/schemas/create-branch";
import { writeAuditEvent } from "@/lib/audit/service";
import { withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";

// ---------------------------------------------------------------------
// Definition schema (the structure the approved catalog must fill —
// docs/SERVICE_CATALOG.md §7.1)
// ---------------------------------------------------------------------

const translationSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
});

export const catalogDefinitionSchema = z
  .object({
    categories: z
      .array(
        z.object({
          slug: z.string().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).optional(),
          sort_order: z.number().int().min(0).default(0),
          translations: z.array(translationSchema).min(1),
          services: z
            .array(
              z.object({
                slug: z.string().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
                name: z.string().trim().min(1).max(200),
                description: z.string().trim().max(4000).optional(),
                sort_order: z.number().int().min(0).default(0),
                translations: z.array(translationSchema).min(1),
                variants: z
                  .array(
                    z.object({
                      slug: z.string().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
                      name: z.string().trim().min(1).max(200),
                      sort_order: z.number().int().min(0).default(0),
                      translations: z.array(translationSchema).min(1),
                    }),
                  )
                  .default([]),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
    addons: z
      .array(
        z.object({
          slug: z.string().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).optional(),
          sort_order: z.number().int().min(0).default(0),
          min_quantity: z.number().int().min(1).default(1),
          max_quantity: z.number().int().min(1).default(1),
          translations: z.array(translationSchema).min(1),
          /** Allow-list: slugs of services (and optional variant slugs). */
          compatible_with: z
            .array(
              z.object({
                service_slug: z.string(),
                variant_slug: z.string().optional(),
              }),
            )
            .default([]),
        }),
    )
      .default([]),
  })
  .strict();

export type CatalogDefinition = z.infer<typeof catalogDefinitionSchema>;

/**
 * Q6 PENDING BUSINESS APPROVAL — intentionally empty.
 * Fill ONLY after the §7.4 checklist is approved. See
 * docs/SERVICE_CATALOG.md §7 ("V1 Catalog — Pending Business Approval").
 */
export const V1_CATALOG_DEFINITION: CatalogDefinition = {
  categories: [],
  addons: [],
};

// ---------------------------------------------------------------------
// Runner — idempotent per-entity-type transactions with summary audits
// ---------------------------------------------------------------------

export interface SeedResult {
  service_categories: number;
  services: number;
  service_variants: number;
  service_addons: number;
  service_addon_compatibility: number;
}

export async function seedCatalogFromDefinition(
  branchId: string,
  organizationId: string,
  definition: CatalogDefinition,
): Promise<SeedResult> {
  const parsed = catalogDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_INPUT, "Invalid catalog definition.");
  }
  const def = parsed.data;
  const result: SeedResult = {
    service_categories: 0,
    services: 0,
    service_variants: 0,
    service_addons: 0,
    service_addon_compatibility: 0,
  };

  // -- Categories (per-type transaction; natural key (branch_id, slug)) ----
  if (def.categories.length > 0) {
    await withTransaction(async (tx) => {
      for (const c of def.categories) {
        const existing = await tx.query<{ id: string }>(
          `select id from public.service_categories where branch_id = $1 and slug = $2`,
          [branchId, c.slug],
        );
        let id: string;
        if (existing.rows[0]) {
          id = existing.rows[0].id;
          await tx.query(
            `update public.service_categories
                set name = $3, description = $4, sort_order = $5, updated_at = now()
              where id = $1 and branch_id = $2`,
            [id, branchId, c.name, c.description ?? null, c.sort_order],
          );
        } else {
          const res = await tx.query<{ id: string }>(
            `insert into public.service_categories
               (organization_id, branch_id, slug, name, description, sort_order, status)
             values ($1, $2, $3, $4, $5, $6, 'draft')
             returning id`,
            [organizationId, branchId, c.slug, c.name, c.description ?? null, c.sort_order],
          );
          id = res.rows[0].id;
          result.service_categories++;
        }
        for (const t of c.translations) {
          await tx.query(
            `insert into public.service_category_translations (category_id, locale, name, description)
             values ($1, $2, $3, $4)
             on conflict (category_id, locale) do update
               set name = excluded.name, description = excluded.description, updated_at = now()`,
            [id, t.locale, t.name, t.description ?? null],
          );
        }
      }
      await writeAuditEvent(
        {
          action: "service_category.created", organizationId, branchId,
          resourceType: "service_category", resourceId: null,
          metadata: { seed_summary: true, count: def.categories.length },
        },
        tx,
      );
    });
  }

  // -- Services + variants (variants ride the services transaction) --------
  const serviceIds = new Map<string, string>();
  const variantIds = new Map<string, string>();
  const servicesFlat = def.categories.flatMap((c) => c.services.map((s) => ({ ...s, category: c })));
  const variantCount = servicesFlat.reduce((n, s) => n + s.variants.length, 0);

  if (servicesFlat.length > 0 || def.addons.length > 0) {
    await withTransaction(async (tx) => {
      for (const s of servicesFlat) {
        let svcId: string;
        const existing = await tx.query<{ id: string }>(
          `select id from public.services where branch_id = $1 and slug = $2`,
          [branchId, s.slug],
        );
        if (existing.rows[0]) {
          svcId = existing.rows[0].id;
          const catRow = await tx.query<{ id: string }>(
            `select id from public.service_categories where branch_id = $1 and slug = $2`,
            [branchId, s.category.slug],
          );
          if (!catRow.rows[0]) {
            throw new AppError(
              ErrorCode.INVALID_INPUT,
              `Definition references unknown category slug '${s.category.slug}'.`,
            );
          }
          await tx.query(
            `update public.services
                set name = $3, description = $4, sort_order = $5,
                    category_id = $6, updated_at = now()
              where id = $1 and branch_id = $2`,
            [svcId, branchId, s.name, s.description ?? null, s.sort_order, catRow.rows[0].id],
          );
        } else {
          const catRow = await tx.query<{ id: string }>(
            `select id from public.service_categories where branch_id = $1 and slug = $2`,
            [branchId, s.category.slug],
          );
          if (!catRow.rows[0]) {
            throw new AppError(
              ErrorCode.INVALID_INPUT,
              `Definition references unknown category slug '${s.category.slug}'.`,
            );
          }
          const res = await tx.query<{ id: string }>(
            `insert into public.services
               (organization_id, branch_id, category_id, slug, name, description, sort_order, status)
             values ($1, $2, $3, $4, $5, $6, $7, 'draft')
             returning id`,
            [organizationId, branchId, catRow.rows[0].id, s.slug, s.name, s.description ?? null, s.sort_order],
          );
          svcId = res.rows[0].id;
          result.services++;
        }
        serviceIds.set(s.slug, svcId);
        for (const t of s.translations) {
          await tx.query(
            `insert into public.service_translations (service_id, locale, name, description)
             values ($1, $2, $3, $4)
             on conflict (service_id, locale) do update
               set name = excluded.name, description = excluded.description, updated_at = now()`,
            [svcId, t.locale, t.name, t.description ?? null],
          );
        }
        for (const v of s.variants) {
          let variantId: string;
          const vExisting = await tx.query<{ id: string }>(
            `select id from public.service_variants where service_id = $1 and slug = $2`,
            [svcId, v.slug],
          );
          if (vExisting.rows[0]) {
            variantId = vExisting.rows[0].id;
            // Parameters must exactly match placeholders ($1 = id, $2 = name,
            // $3 = sort_order) — a mismatch here previously broke idempotent
            // re-seeding with "could not determine data type of parameter $2".
            await tx.query(
              `update public.service_variants
                  set name = $2, sort_order = $3, updated_at = now()
                where id = $1`,
              [variantId, v.name, v.sort_order],
            );
          } else {
            const vr = await tx.query<{ id: string }>(
              `insert into public.service_variants
                 (organization_id, branch_id, service_id, slug, name, sort_order, status)
               values ($1, $2, $3, $4, $5, $6, 'draft')
               returning id`,
              [organizationId, branchId, svcId, v.slug, v.name, v.sort_order],
            );
            variantId = vr.rows[0].id;
            result.service_variants++;
          }
          variantIds.set(`${s.slug}/${v.slug}`, variantId);
          for (const t of v.translations) {
            await tx.query(
              `insert into public.service_variant_translations (variant_id, locale, name, description)
               values ($1, $2, $3, $4)
               on conflict (variant_id, locale) do update
                 set name = excluded.name, description = excluded.description, updated_at = now()`,
              [variantId, t.locale, t.name, t.description ?? null],
            );
          }
        }
      }
      if (servicesFlat.length > 0) {
        await writeAuditEvent(
          {
            action: "service.created", organizationId, branchId,
            resourceType: "service", resourceId: null,
            metadata: { seed_summary: true, count: servicesFlat.length, variant_count: variantCount },
          },
          tx,
        );
      }

      // -- Add-ons + compatibility (Q2: seeded rows disabled) -------------
      for (const a of def.addons) {
        let addonId: string;
        const aExisting = await tx.query<{ id: string }>(
          `select id from public.service_addons where branch_id = $1 and slug = $2`,
          [branchId, a.slug],
        );
        if (aExisting.rows[0]) {
          addonId = aExisting.rows[0].id;
          await tx.query(
            `update public.service_addons
                set name = $3, description = $4, sort_order = $5,
                    min_quantity = $6, max_quantity = $7, updated_at = now()
              where id = $1 and branch_id = $2`,
            [addonId, branchId, a.name, a.description ?? null, a.sort_order,
             a.min_quantity, a.max_quantity],
          );
        } else {
          const ar = await tx.query<{ id: string }>(
            `insert into public.service_addons
               (organization_id, branch_id, slug, name, description, sort_order,
                min_quantity, max_quantity, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
             returning id`,
            [organizationId, branchId, a.slug, a.name, a.description ?? null, a.sort_order,
             a.min_quantity, a.max_quantity],
          );
          addonId = ar.rows[0].id;
          result.service_addons++;
        }
        for (const t of a.translations) {
          await tx.query(
            `insert into public.service_addon_translations (addon_id, locale, name, description)
             values ($1, $2, $3, $4)
             on conflict (addon_id, locale) do update
               set name = excluded.name, description = excluded.description, updated_at = now()`,
            [addonId, t.locale, t.name, t.description ?? null],
          );
        }
        for (const comp of a.compatible_with) {
          const svcId = serviceIds.get(comp.service_slug) ??
            (await tx.query<{ id: string }>(
              `select id from public.services where branch_id = $1 and slug = $2`,
              [branchId, comp.service_slug],
            )).rows[0]?.id;
          if (!svcId) continue;
          const variantId = comp.variant_slug
            ? (variantIds.get(`${comp.service_slug}/${comp.variant_slug}`) ??
              (await tx.query<{ id: string }>(
                `select id from public.service_variants
                  where branch_id = $1 and service_id = $2 and slug = $3`,
                [branchId, svcId, comp.variant_slug],
              )).rows[0]?.id)
            : null;
          const cExisting = await tx.query<{ id: string }>(
            `select id from public.service_addon_compatibility
              where service_addon_id = $1 and service_id = $2
                and service_variant_id is not distinct from $3`,
            [addonId, svcId, variantId ?? null],
          );
          if (cExisting.rows[0]) {
            await tx.query(
              `update public.service_addon_compatibility set updated_at = now() where id = $1`,
              [cExisting.rows[0].id],
            );
          } else {
            await tx.query(
              `insert into public.service_addon_compatibility
                 (organization_id, branch_id, service_addon_id, service_id, service_variant_id)
               values ($1, $2, $3, $4, $5)`,
              [organizationId, branchId, addonId, svcId, variantId ?? null],
            );
            result.service_addon_compatibility++;
          }
        }
      }
      if (def.addons.length > 0) {
        await writeAuditEvent(
          {
            action: "service_addon.created", organizationId, branchId,
            resourceType: "service_addon", resourceId: null,
            metadata: { seed_summary: true, count: def.addons.length },
          },
          tx,
        );
      }
    });
  }

  return result;
}
