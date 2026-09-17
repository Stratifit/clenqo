/**
 * Pricing Engine domain errors (Change 4A, task 3.2; PRICING_ENGINE §58).
 *
 * Stable codes extend the platform envelope (lib/errors.ts). Each code maps
 * to a controlled AppError the action layer returns as a typed result —
 * customer-facing messages stay understandable (BOOKING_SYSTEM §87).
 */
import { AppError, ErrorCode } from "@/lib/errors";

export const PricingErrorCode = {
  PROFILE_NOT_FOUND: "pricing_profile_not_found",
  VERSION_NOT_FOUND: "pricing_version_not_found",
  SERVICE_NOT_PRICED: "service_not_priced",
  INVALID_ADDON: "invalid_addon",
  INVALID_INPUT: "invalid_input",
  CONFIGURATION_INVALID: "pricing_configuration_invalid",
  CURRENCY_MISMATCH: "currency_mismatch",
} as const;

export type PricingErrorCodeValue = (typeof PricingErrorCode)[keyof typeof PricingErrorCode];

/** §58 error catalog: each code raises a controlled AppError. */
export function pricingError(
  code: PricingErrorCodeValue,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  // All pricing errors are domain-level: they surface as INVALID_INPUT,
  // NOT_FOUND, or CONFLICT per the platform envelope, with the stable
  // §58 code preserved in details for observability.
  const platformCode =
    code === PricingErrorCode.PROFILE_NOT_FOUND || code === PricingErrorCode.VERSION_NOT_FOUND
      ? ErrorCode.NOT_FOUND
      : code === PricingErrorCode.CURRENCY_MISMATCH || code === PricingErrorCode.SERVICE_NOT_PRICED
        ? ErrorCode.CONFLICT
        : ErrorCode.INVALID_INPUT;
  return new AppError(platformCode, message, undefined, { pricing_code: code, ...details });
}
