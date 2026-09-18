"use server";

/**
 * Server Actions for the Worker domain (Change 6; API_STANDARDS §4:
 * authenticate → authorize → validate → domain service → typed result).
 * No business logic lives here — everything delegates to features/worker/*.
 *
 * Internal staff surface only (BD-W10): NO cleaner routes, NO customer
 * surface. Permissions enforced inside the domain (employees.view/manage,
 * jobs.view/assign/manage — existing catalog permissions only).
 */
import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { resolveActor, type AuthContext } from "@/lib/authorization/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
import { createEmployee, updateEmployee, getEmployee, listEmployees, setEmployeeBranches, setEmployeeSkill, removeEmployeeSkill, setEmployeeAvailability, setEmployeeAvailabilityException, listEmployeeSkills, listEmployeeAvailability, listEmployeeExceptions, type EmployeeRow } from "./employees";
import { assignCleaner, unassignCleaner, type AssignmentRow } from "./assignments";
import { completeJob } from "./jobs";
import { reportIncident, listIncidentsForJob } from "./incidents";
import { getJob, listJobs, listJobAssignments, setJobSkills, type JobRow, type AssignmentRowLite } from "./jobsQuery";
import type { ListEmployeesInput, ListJobsInput } from "./schemas/worker";
export type { ListEmployeesInput, ListJobsInput };

async function currentContext(): Promise<AuthContext> {
  const userId = await getAuthenticatedUserId();
  const ctx = await resolveActor(userId);
  ctx.requestId = randomUUID();
  return ctx;
}

function run<T>(fn: (ctx: AuthContext) => Promise<T>): Promise<Result<T>> {
  return (async () => {
    try {
      const ctx = await currentContext();
      return ok(await fn(ctx), ctx.requestId);
    } catch (err) {
      const appErr = toAppError(err);
      return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
    }
  })();
}

// ---------------------------------------------------------------------------
// Employees (employees.view / employees.manage)
// ---------------------------------------------------------------------------

export async function createEmployeeAction(input: unknown): Promise<Result<EmployeeRow>> {
  return run((ctx) => createEmployee(ctx, input));
}

export async function updateEmployeeAction(input: { employee_id: string } & Record<string, unknown>): Promise<Result<EmployeeRow>> {
  return run((ctx) => updateEmployee(ctx, input));
}

export async function getEmployeeAction(employeeId: string): Promise<Result<EmployeeRow & { branches: string[] }>> {
  return run((ctx) => getEmployee(ctx, employeeId));
}

export async function listEmployeesAction(input: unknown): Promise<Result<EmployeeRow[]>> {
  return run((ctx) => listEmployees(ctx, input));
}

export async function setEmployeeBranchesAction(input: unknown): Promise<Result<string[]>> {
  return run((ctx) => setEmployeeBranches(ctx, input));
}

export async function setEmployeeSkillAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await setEmployeeSkill(ctx, input);
    return null;
  });
}

export async function removeEmployeeSkillAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await removeEmployeeSkill(ctx, input);
    return null;
  });
}

export async function setEmployeeAvailabilityAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await setEmployeeAvailability(ctx, input);
    return null;
  });
}

export async function setEmployeeAvailabilityExceptionAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await setEmployeeAvailabilityException(ctx, input);
    return null;
  });
}

export async function getEmployeeSkillsAction(employeeId: string) {
  return run((ctx) => listEmployeeSkills(ctx, employeeId));
}

export async function getEmployeeAvailabilityAction(employeeId: string) {
  return run((ctx) => listEmployeeAvailability(ctx, employeeId));
}

export async function getEmployeeExceptionsAction(employeeId: string) {
  return run((ctx) => listEmployeeExceptions(ctx, employeeId));
}

// ---------------------------------------------------------------------------
// Jobs (jobs.view / jobs.manage / jobs.assign)
// ---------------------------------------------------------------------------

export async function getJobAction(jobId: string): Promise<Result<JobRow>> {
  return run((ctx) => getJob(ctx, jobId));
}

export async function listJobsAction(input: unknown): Promise<Result<JobRow[]>> {
  return run((ctx) => listJobs(ctx, input));
}

export async function setJobSkillsAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await setJobSkills(ctx, input);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Assignments (jobs.assign)
// ---------------------------------------------------------------------------

export async function assignCleanerAction(input: unknown): Promise<Result<AssignmentRow>> {
  return run((ctx) => assignCleaner(ctx, input));
}

export async function unassignCleanerAction(input: unknown): Promise<Result<null>> {
  return run(async (ctx) => {
    await unassignCleaner(ctx, input);
    return null;
  });
}

export async function getJobAssignmentsAction(jobId: string): Promise<Result<AssignmentRowLite[]>> {
  return run((ctx) => listJobAssignments(ctx, jobId));
}

// ---------------------------------------------------------------------------
// Lifecycle + incidents (staff-authoritative; WORKER §65)
// ---------------------------------------------------------------------------

export async function completeJobAction(jobId: string): Promise<Result<JobRow>> {
  return run((ctx) => completeJob({ userId: ctx.actor.userId }, jobId));
}

export async function reportIncidentAction(input: unknown) {
  return run((ctx) => reportIncident(ctx, input));
}

export async function getJobIncidentsAction(jobId: string) {
  return run((ctx) => listIncidentsForJob(ctx, jobId));
}
