/**
 * Worker domain errors (Change 6, task 3.2; design.md §3/§7).
 *
 * Stable codes extend the platform envelope (lib/errors.ts); each maps to a
 * controlled AppError the action layer returns as a typed result, with the
 * stable code preserved in `details` for observability. Staff-facing
 * messages stay understandable (WORKER_SYSTEM §68) and enumeration-safe.
 */
import { AppError, ErrorCode, type ErrorCodeValue } from "@/lib/errors";

export const WorkerErrorCode = {
  EMPLOYEE_NOT_FOUND: "employee_not_found",
  EMPLOYEE_INACTIVE: "employee_inactive",
  NOT_BRANCH_AUTHORIZED: "employee_not_branch_authorized",
  SKILL_MISSING: "skill_missing",
  QUALIFICATION_EXPIRED: "qualification_expired",
  EMPLOYEE_UNAVAILABLE: "employee_unavailable",
  ASSIGNMENT_CONFLICT: "assignment_conflict",
  ASSIGNMENT_EXISTS: "assignment_exists",
  JOB_STATE_INVALID: "job_state_invalid",
  JOB_ALREADY_EXISTS: "job_already_exists",
  JOB_NOT_FOUND: "job_not_found",
  BOOKING_NOT_CONFIRMED: "booking_not_confirmed",
  AVAILABILITY_CONFLICT: "availability_conflict",
} as const;

export type WorkerErrorCodeValue = (typeof WorkerErrorCode)[keyof typeof WorkerErrorCode];

/** Map a stable worker code onto the platform envelope (lib/errors.ts). */
function platformCodeFor(code: WorkerErrorCodeValue): ErrorCodeValue {
  switch (code) {
    case WorkerErrorCode.EMPLOYEE_INACTIVE:
    case WorkerErrorCode.NOT_BRANCH_AUTHORIZED:
    case WorkerErrorCode.SKILL_MISSING:
    case WorkerErrorCode.QUALIFICATION_EXPIRED:
    case WorkerErrorCode.EMPLOYEE_UNAVAILABLE:
    case WorkerErrorCode.ASSIGNMENT_CONFLICT:
    case WorkerErrorCode.ASSIGNMENT_EXISTS:
    case WorkerErrorCode.JOB_STATE_INVALID:
    case WorkerErrorCode.JOB_ALREADY_EXISTS:
    case WorkerErrorCode.BOOKING_NOT_CONFIRMED:
    case WorkerErrorCode.AVAILABILITY_CONFLICT:
      return ErrorCode.CONFLICT;
    case WorkerErrorCode.EMPLOYEE_NOT_FOUND:
    case WorkerErrorCode.JOB_NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    default:
      return ErrorCode.INVALID_INPUT;
  }
}

/** Staff-safe messages per stable code (no internal detail leakage). */
const SAFE_MESSAGES: Record<WorkerErrorCodeValue, string> = {
  [WorkerErrorCode.EMPLOYEE_NOT_FOUND]: "Employee not found.",
  [WorkerErrorCode.EMPLOYEE_INACTIVE]: "This employee is not active and cannot be assigned new work.",
  [WorkerErrorCode.NOT_BRANCH_AUTHORIZED]: "This employee is not authorized for this branch.",
  [WorkerErrorCode.SKILL_MISSING]: "This employee does not have a required skill for this job.",
  [WorkerErrorCode.QUALIFICATION_EXPIRED]: "A required skill qualification has expired.",
  [WorkerErrorCode.EMPLOYEE_UNAVAILABLE]: "This employee is not available during the job window.",
  [WorkerErrorCode.ASSIGNMENT_CONFLICT]: "This employee already has an overlapping assignment.",
  [WorkerErrorCode.ASSIGNMENT_EXISTS]: "This job already has an active assignment.",
  [WorkerErrorCode.JOB_STATE_INVALID]: "This job cannot be changed in its current state.",
  [WorkerErrorCode.JOB_ALREADY_EXISTS]: "This booking already has a job.",
  [WorkerErrorCode.JOB_NOT_FOUND]: "Job not found.",
  [WorkerErrorCode.BOOKING_NOT_CONFIRMED]: "The booking must be confirmed before work can be scheduled.",
  [WorkerErrorCode.AVAILABILITY_CONFLICT]: "This employee's availability does not cover the job window.",
};

/** §58-style error factory: every code raises a controlled AppError. */
export function workerError(
  code: WorkerErrorCodeValue,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(platformCodeFor(code), SAFE_MESSAGES[code], undefined, {
    worker_code: code,
    ...details,
  });
}
