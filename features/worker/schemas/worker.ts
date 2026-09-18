/**
 * Worker input schemas (Change 6, task 3.1).
 *
 * Validation mirrors the migration 0012 CHECK constraints so invalid input
 * fails at the boundary with stable INVALID_INPUT errors before the
 * privileged client touches the database (API_STANDARDS §46).
 *
 * Normative sources: design.md §1 (BD-W1…BD-W13), §3, §5–§8.
 * This file contains NO production business values (no employees, no
 * schedules, no skill seeds — structures only).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical vocabularies (BD-W2/W3/W11 — mirror the 0012 CHECKs exactly)
// ---------------------------------------------------------------------------

export const EMPLOYEE_STATUSES = ["active", "temporarily_unavailable", "on_leave", "inactive"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "minijob", "flexible"] as const;
export const SKILL_KEYS = [
  "home_cleaning",
  "deep_cleaning",
  "commercial_cleaning",
  "move_out_cleaning",
  "specialized_cleaning",
  "window_cleaning",
] as const;
export const JOB_STATUSES = [
  "pending",
  "assigned",
  "en_route",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const ASSIGNMENT_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "active",
  "completed",
  "cancelled",
] as const;
export const INCIDENT_TYPES = [
  "no_show",
  "property_damage",
  "access_problem",
  "customer_issue",
  "cleaner_issue",
  "safety_issue",
  "late_arrival",
] as const;
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

const utcInstant = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Employees (BD-W2/W3/W12)
// ---------------------------------------------------------------------------

export const createEmployeeSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(254).email().nullable().optional(),
  preferred_language: z.string().trim().min(2).max(10).nullable().optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  status: z.enum(EMPLOYEE_STATUSES).default("active"),
  hire_date: isoDate.nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(254).email().nullable().optional(),
  preferred_language: z.string().trim().min(2).max(10).nullable().optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  hire_date: isoDate.nullable().optional(),
  termination_date: isoDate.nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeIdSchema = z.object({ employee_id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Employee branches (BD-W1)
// ---------------------------------------------------------------------------

export const setEmployeeBranchesSchema = z.object({
  employee_id: z.string().uuid(),
  branch_ids: z.array(z.string().uuid()).max(200),
});
export type SetEmployeeBranchesInput = z.infer<typeof setEmployeeBranchesSchema>;

// ---------------------------------------------------------------------------
// Employee skills (BD-W11)
// ---------------------------------------------------------------------------

export const setEmployeeSkillSchema = z.object({
  employee_id: z.string().uuid(),
  skill_key: z.enum(SKILL_KEYS),
  qualification_status: z.enum(["pending", "qualified", "expired"]).nullable().optional(),
  qualification_date: isoDate.nullable().optional(),
  expiry_date: isoDate.nullable().optional(),
  level: z.number().int().min(0).max(10).nullable().optional(),
});
export type SetEmployeeSkillInput = z.infer<typeof setEmployeeSkillSchema>;

export const removeEmployeeSkillSchema = z.object({
  employee_id: z.string().uuid(),
  skill_key: z.enum(SKILL_KEYS),
});

// ---------------------------------------------------------------------------
// Availability (TD-W6)
// ---------------------------------------------------------------------------

const weekdaySchema = z.number().int().min(0).max(6);

export const setEmployeeAvailabilitySchema = z.object({
  employee_id: z.string().uuid(),
  /** Full replacement of the employee's recurring weekly windows. */
  windows: z
    .array(
      z
        .object({
          weekday: weekdaySchema,
          start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          effective_from: isoDate,
          effective_until: isoDate.nullable().optional(),
        })
        .refine((w) => w.end_time > w.start_time, { message: "end_time must be after start_time" }),
    )
    .max(200),
});
export type SetEmployeeAvailabilityInput = z.infer<typeof setEmployeeAvailabilitySchema>;

export const setEmployeeAvailabilityExceptionSchema = z.object({
  employee_id: z.string().uuid(),
  exception_type: z.enum(["unavailable", "available"]),
  start_at: utcInstant,
  end_at: utcInstant,
  reason: z.string().trim().max(500).nullable().optional(),
});
export type SetEmployeeAvailabilityExceptionInput = z.infer<typeof setEmployeeAvailabilityExceptionSchema>;

// ---------------------------------------------------------------------------
// Jobs (BD-W4/W5/W11/TD-W3)
// ---------------------------------------------------------------------------

export const jobIdSchema = z.object({ job_id: z.string().uuid() });

export const setJobSkillsSchema = z.object({
  job_id: z.string().uuid(),
  required_skills: z.array(z.enum(SKILL_KEYS)).max(SKILL_KEYS.length),
});
export type SetJobSkillsInput = z.infer<typeof setJobSkillsSchema>;

// ---------------------------------------------------------------------------
// Assignments (BD-W8/W9)
// ---------------------------------------------------------------------------

export const assignCleanerSchema = z.object({
  job_id: z.string().uuid(),
  employee_id: z.string().uuid(),
});
export type AssignCleanerInput = z.infer<typeof assignCleanerSchema>;

export const unassignCleanerSchema = z.object({
  job_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type UnassignCleanerInput = z.infer<typeof unassignCleanerSchema>;

// ---------------------------------------------------------------------------
// Incidents (BD-W7d, DATABASE §29)
// ---------------------------------------------------------------------------

export const reportIncidentSchema = z.object({
  job_id: z.string().uuid(),
  incident_type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type ReportIncidentInput = z.infer<typeof reportIncidentSchema>;

// ---------------------------------------------------------------------------
// Lists / search (WORKER §68)
// ---------------------------------------------------------------------------

export const listJobsSchema = z.object({
  branch_id: z.string().uuid().optional(),
  status: z.enum(JOB_STATUSES).optional(),
  /** Free-text search: job number, booking number, or customer name. */
  query: z.string().trim().max(100).optional(),
  scheduled_on: isoDate.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListJobsInput = z.infer<typeof listJobsSchema>;

export const listEmployeesSchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  branch_id: z.string().uuid().optional(),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type ListEmployeesInput = z.infer<typeof listEmployeesSchema>;
