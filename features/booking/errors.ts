/**
 * Booking domain errors (Change 5, task 3.2; design.md §3.2/§6–§9).
 *
 * Stable codes extend the platform envelope (lib/errors.ts); each maps to a
 * controlled AppError the action layer returns as a typed result, with the
 * stable code preserved in `details` for observability. Customer-facing
 * messages stay understandable and enumeration-safe (SECURITY_PRIVACY §32).
 */
import { AppError, ErrorCode, type ErrorCodeValue } from "@/lib/errors";

export const BookingErrorCode = {
  PRICE_CHANGED: "price_changed",
  SLOT_UNAVAILABLE: "slot_unavailable",
  HOLD_INVALID: "hold_invalid",
  OUTSIDE_SERVICE_AREA: "outside_service_area",
  DEADLINE_PASSED: "deadline_passed",
  POST_START_PROHIBITED: "post_start_prohibited",
  STATE_INVALID: "booking_state_invalid",
  SERVICE_NOT_BOOKABLE: "service_not_bookable",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  POLICY_NOT_FOUND: "cancellation_policy_not_found",
  TOKEN_INVALID: "magic_link_token_invalid",
  TOKEN_EXPIRED: "magic_link_token_expired",
  RATE_LIMITED: "rate_limited",
  CONTACT_CONFLICT: "contact_conflict",
} as const;

export type BookingErrorCodeValue = (typeof BookingErrorCode)[keyof typeof BookingErrorCode];

/** Map a stable booking code onto the platform envelope (lib/errors.ts). */
function platformCodeFor(code: BookingErrorCodeValue): ErrorCodeValue {
  switch (code) {
    case BookingErrorCode.PRICE_CHANGED:
    case BookingErrorCode.SLOT_UNAVAILABLE:
    case BookingErrorCode.HOLD_INVALID:
    case BookingErrorCode.IDEMPOTENCY_CONFLICT:
      return ErrorCode.CONFLICT;
    case BookingErrorCode.STATE_INVALID:
      return ErrorCode.CONFLICT;
    case BookingErrorCode.POLICY_NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case BookingErrorCode.RATE_LIMITED:
      return ErrorCode.FORBIDDEN;
    // Everything else is a validation/boundary condition.
    default:
      return ErrorCode.INVALID_INPUT;
  }
}

/** Customer-safe messages per stable code (§87/§32: no internal detail). */
const SAFE_MESSAGES: Record<BookingErrorCodeValue, string> = {
  [BookingErrorCode.PRICE_CHANGED]: "The price has changed since you accepted it. Please review the new price and try again.",
  [BookingErrorCode.SLOT_UNAVAILABLE]: "That time slot is no longer available.",
  [BookingErrorCode.HOLD_INVALID]: "Your reservation expired. Please select a new time slot.",
  [BookingErrorCode.OUTSIDE_SERVICE_AREA]: "This address is outside our service area for this branch.",
  [BookingErrorCode.DEADLINE_PASSED]: "The deadline for this change has passed.",
  [BookingErrorCode.POST_START_PROHIBITED]: "This service has already started and can no longer be cancelled online.",
  [BookingErrorCode.STATE_INVALID]: "This booking cannot be changed in its current state.",
  [BookingErrorCode.SERVICE_NOT_BOOKABLE]: "This service is not available for online booking.",
  [BookingErrorCode.IDEMPOTENCY_CONFLICT]: "This request was already submitted with different details.",
  [BookingErrorCode.POLICY_NOT_FOUND]: "No cancellation policy is configured for this branch.",
  [BookingErrorCode.TOKEN_INVALID]: "This link is invalid or has already been used.",
  [BookingErrorCode.TOKEN_EXPIRED]: "This link has expired. Please request a new one.",
  [BookingErrorCode.RATE_LIMITED]: "Too many requests. Please try again later.",
  [BookingErrorCode.CONTACT_CONFLICT]: "We could not verify your contact details. Our team will confirm them with you.",
};

/** §58-style error factory: every code raises a controlled AppError. */
export function bookingError(
  code: BookingErrorCodeValue,
  details?: Record<string, unknown>,
): AppError {
  // Enumeration safety (SECURITY_PRIVACY §32): token errors share one
  // generic message surface — never reveal which part failed.
  const message = SAFE_MESSAGES[code];
  return new AppError(platformCodeFor(code), message, undefined, {
    booking_code: code,
    ...details,
  });
}
