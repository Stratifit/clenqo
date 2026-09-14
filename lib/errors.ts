/**
 * Stable error codes (API_STANDARDS.md §24) and the typed result envelope
 * (§50). Error messages are safe for clients; internal details never leak.
 */
export const ErrorCode = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PROVISIONING_FAILED: "PROVISIONING_FAILED",
  BRANCH_INACTIVE: "BRANCH_INACTIVE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldErrors {
  [field: string]: string[];
}

/** Typed failure carrying a stable code + optional field errors/details. */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly fieldErrors?: FieldErrors;
  /** Safe, non-sensitive diagnostic details (e.g. failed provisioning stage). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    message: string,
    fieldErrors?: FieldErrors,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

export type Result<T> =
  | { success: true; data: T; requestId?: string }
  | {
      success: false;
      error: {
        code: ErrorCodeValue;
        message: string;
        requestId?: string;
        fieldErrors?: FieldErrors;
      };
    };

export function ok<T>(data: T, requestId?: string): Result<T> {
  return { success: true, data, requestId };
}

export function fail(
  code: ErrorCodeValue,
  message: string,
  opts: { fieldErrors?: FieldErrors; requestId?: string } = {},
): Result<never> {
  return {
    success: false,
    error: {
      code,
      message,
      fieldErrors: opts.fieldErrors,
      requestId: opts.requestId,
    },
  };
}

/** Convert an unknown thrown value into an AppError without leaking detail. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // Never surface internal error text to clients (API_STANDARDS.md §23).
  return new AppError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.");
}
