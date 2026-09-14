/**
 * Branch creation input validation (API_STANDARDS.md §12; spec "Branch input
 * validation" requirement). Server-authoritative: the client schema is the
 * same one the domain service runs.
 */
import { z } from "zod";

/** Platform-supported launch locales (LOCALIZATION.md §3/§16) — config, not hardcode. */
export const SUPPORTED_LOCALES = ["de", "en", "fr", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Reserved path segments that must never become branch slugs. */
export const RESERVED_SLUGS = [
  "admin", "api", "cleaner", "manage", "booking", "book", "_next", "static",
  "public", "login", "auth", "settings", "clenqo",
] as const;

/** Deterministic slug normalization (spec: lowercase, URL-safe). */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const slugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters")
  .max(63, "Slug must be at most 63 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase URL-safe segments")
  .refine((s) => !RESERVED_SLUGS.includes(s as (typeof RESERVED_SLUGS)[number]), {
    message: "Slug uses a reserved path segment",
  });

const localeSchema = z.enum(SUPPORTED_LOCALES);

// ISO 4217 alpha-3 currency codes (configurable list — not hardcoded per branch).
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "PLN", "CZK"] as const;
const COUNTRY_CODES = new Set([
  "DE", "AT", "CH", "FR", "ES", "US", "GB", "PL", "CZ", "NL", "BE", "IT",
]);

export const createBranchInputSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
    slug: slugSchema,
    country_code: z
      .string()
      .trim()
      .length(2)
      .transform((s) => s.toUpperCase())
      .refine((s) => COUNTRY_CODES.has(s), { message: "Unsupported country code" }),
    timezone: z.string().trim().min(3),
    currency: z.enum(CURRENCIES),
    default_locale: localeSchema,
    enabled_locales: z.array(localeSchema).min(1),
    contact: z
      .object({
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().email().optional(),
      })
      .optional(),
    service_area: z
      .object({
        cities: z.array(z.string().trim().min(1)).max(50).optional(),
        postal_codes: z.array(z.string().trim().min(1)).max(100).optional(),
      })
      .optional(),
  })
  .strict()
  .refine((data) => data.enabled_locales.includes(data.default_locale), {
    message: "default_locale must be included in enabled_locales",
    path: ["default_locale"],
  })
  .refine(
    (data) => {
      const tz = data.timezone;
      return /^[A-Za-z]+\/[A-Za-z_]+/.test(tz) || tz === "UTC";
    },
    { message: "Timezone must be an IANA identifier (e.g. Europe/Berlin)", path: ["timezone"] },
  );

export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;
