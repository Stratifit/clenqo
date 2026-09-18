/**
 * Employee domain (Change 6, tasks 4.1–4.3; BD-W1/W2/W3/W11/W12).
 *
 * Organization-scoped employee records with:
 *   - many-to-many branch authorization via employee_branches (BD-W1) —
 *     the authoritative operational eligibility relationship;
 *   - canonical lifecycle statuses (BD-W2) — `inactive` blocks NEW
 *     assignments at the eligibility-validator level while all history
 *     is preserved;
 *   - canonical employment types (BD-W3);
 *   - skills with qualification metadata incl. expiry (BD-W11);
 *   - optional nullable Auth linkage (BD-W12) — records may exist
 *     without application access; Auth stays Auth-domain.
 *
 * EMP- numbers (BD-W5 discipline, DATABASE §58): ONE monotonic per-org
 * counter, row-locked transactional allocation, never reused.
 */
import "server-only";
import {
  requireOrganizationAccess,
  requirePermission,
  hasBranchScope,
  type AuthContext,
} from "@/lib/authorization/server";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { writeJobEvent, auditWorker } from "./events";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  setEmployeeBranchesSchema,
  setEmployeeSkillSchema,
  removeEmployeeSkillSchema,
  setEmployeeAvailabilitySchema,
  setEmployeeAvailabilityExceptionSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type SetEmployeeBranchesInput,
  type SetEmployeeSkillInput,
  type SetEmployeeAvailabilityInput,
  type SetEmployeeAvailabilityExceptionInput,
} from "./schemas/worker";

export interface EmployeeRow {
  id: string;
  organization_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  preferred_language: string | null;
  employment_type: string;
  status: string;
  hire_date: string | null;
  termination_date: string | null;
  user_id: string | null;
}

// ---------------------------------------------------------------------------
// EMP-number allocation (BD-W5 discipline)
// ---------------------------------------------------------------------------

/** Row-locked monotonic allocation inside the caller's transaction. */
export async function allocateEmployeeNumber(tx: TransactionClient, organizationId: string): Promise<string> {
  const res = await tx.query<{ last_sequence: string }>(
    `insert into public.employee_number_sequences (organization_id, last_sequence)
     values ($1, 1)
     on conflict (organization_id) do update
       set last_sequence = public.employee_number_sequences.last_sequence + 1,
           updated_at = now()
     returning last_sequence`,
    [organizationId],
  );
  const seq = BigInt(res.rows[0].last_sequence);
  return `EMP-${seq.toString().padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Employee CRUD (employees.view / employees.manage)
// ---------------------------------------------------------------------------

export async function createEmployee(ctx: AuthContext, raw: unknown): Promise<EmployeeRow> {
  requirePermission(ctx, "employees.manage");
  const input = createEmployeeSchema.parse(raw) as CreateEmployeeInput;

  return withTransaction(async (tx) => {
    const employeeNumber = await allocateEmployeeNumber(tx, ctx.actor.organizationId);
    const res = await tx.query<EmployeeRow>(
      `insert into public.employees
         (organization_id, employee_number, first_name, last_name, phone, email,
          preferred_language, employment_type, status, hire_date, user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11)
       returning id, organization_id, employee_number, first_name, last_name, phone, email,
                 preferred_language, employment_type, status, hire_date::text,
                 termination_date::text, user_id`,
      [
        ctx.actor.organizationId,
        employeeNumber,
        input.first_name,
        input.last_name,
        input.phone ?? null,
        input.email ?? null,
        input.preferred_language ?? null,
        input.employment_type,
        input.status,
        input.hire_date ?? null,
        input.user_id ?? null,
      ],
    );
    const employee = res.rows[0];
    await auditWorker(tx, {
      action: "employee.created",
      organizationId: ctx.actor.organizationId,
      resourceType: "employees",
      resourceId: employee.id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { employee_number: employeeNumber, employment_type: input.employment_type, status: input.status },
    });
    return employee;
  });
}

export async function updateEmployee(
  ctx: AuthContext,
  raw: unknown & { employee_id?: string },
): Promise<EmployeeRow> {
  requirePermission(ctx, "employees.manage");
  const input = updateEmployeeSchema.parse(raw) as UpdateEmployeeInput;
  const employeeId = (raw as { employee_id?: string }).employee_id as string;
  const fields = input;

  return withTransaction(async (tx) => {
    const existing = await tx.query<EmployeeRow>(
      `select id, organization_id, employee_number, first_name, last_name, phone, email,
              preferred_language, employment_type, status, hire_date::text,
              termination_date::text, user_id
       from public.employees where id = $1`,
      [employeeId],
    );
    const current = existing.rows[0];
    if (!current) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, current.organization_id);
    // Employee records are organization-scoped (no branch column, BD-W1).
    // Branch managers must be branch-authorized for at least one of the
    // employee's branches to manage it.
    if (ctx.actor.role === "branch_manager") {
      const scoped = await tx.query<{ exists: boolean }>(
        `select exists(
           select 1 from public.employee_branches eb
           where eb.employee_id = $1
             and public.has_branch_access(auth.uid(), eb.branch_id)
         ) as exists`,
        [employeeId],
      );
      if (!scoped.rows[0]?.exists) {
        throw new AppError(ErrorCode.FORBIDDEN, "No access to this employee.");
      }
    }

    const sets: string[] = [];
    const vals: unknown[] = [employeeId];
    let i = 2;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      sets.push(`${key} = $${i}`);
      vals.push(key.endsWith("_date") ? (value as string) : value);
      i += 1;
    }
    if (sets.length === 0) return current;
    sets.push(`updated_at = now()`);
    const res = await tx.query<EmployeeRow>(
      `update public.employees set ${sets.join(", ")}
       where id = $1
       returning id, organization_id, employee_number, first_name, last_name, phone, email,
                 preferred_language, employment_type, status, hire_date::text,
                 termination_date::text, user_id`,
      vals,
    );
    await auditWorker(tx, {
      action: "employee.updated",
      organizationId: current.organization_id,
      resourceType: "employees",
      resourceId: employeeId,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { fields: Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined) },
    });
    return res.rows[0];
  });
}

export async function getEmployee(ctx: AuthContext, employeeId: string): Promise<EmployeeRow & { branches: string[] }> {
  requirePermission(ctx, "employees.view");
  const res = await query<EmployeeRow>(
    `select id, organization_id, employee_number, first_name, last_name, phone, email,
            preferred_language, employment_type, status, hire_date::text,
            termination_date::text, user_id
     from public.employees where id = $1`,
    [employeeId],
  );
  const employee = res.rows[0];
  if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
  requireOrganizationAccess(ctx, employee.organization_id);

  const branchRes = await query<{ branch_id: string }>(
    `select branch_id from public.employee_branches where employee_id = $1 order by created_at`,
    [employeeId],
  );
  return { ...employee, branches: branchRes.rows.map((r) => r.branch_id) };
}

export async function listEmployees(ctx: AuthContext, raw: unknown): Promise<EmployeeRow[]> {
  requirePermission(ctx, "employees.view");
  const input = (await import("./schemas/worker")).listEmployeesSchema.parse(raw);

  const conditions: string[] = [`e.organization_id = $1`];
  const vals: unknown[] = [ctx.actor.organizationId];
  let i = 2;
  if (input.status) {
    conditions.push(`e.status = $${i++}`);
    vals.push(input.status);
  }
  if (input.branch_id) {
    if (!(await hasBranchScope(ctx, input.branch_id))) {
      throw new AppError(ErrorCode.FORBIDDEN, "No access to this branch.");
    }
    conditions.push(
      `exists (select 1 from public.employee_branches eb where eb.employee_id = e.id and eb.branch_id = $${i++})`,
    );
    vals.push(input.branch_id);
  }
  if (input.query) {
    conditions.push(`(e.first_name ilike $${i} or e.last_name ilike $${i} or e.employee_number ilike $${i})`);
    vals.push(`%${input.query}%`);
    i += 1;
  }

  const res = await query<EmployeeRow>(
    `select e.id, e.organization_id, e.employee_number, e.first_name, e.last_name, e.phone,
            e.email, e.preferred_language, e.employment_type, e.status, e.hire_date::text,
            e.termination_date::text, e.user_id
     from public.employees e
     where ${conditions.join(" and ")}
     order by e.employee_number asc limit ${input.limit}`,
    vals,
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Branch memberships (BD-W1)
// ---------------------------------------------------------------------------

export async function setEmployeeBranches(ctx: AuthContext, raw: unknown): Promise<string[]> {
  requirePermission(ctx, "employees.manage");
  const input = setEmployeeBranchesSchema.parse(raw) as SetEmployeeBranchesInput;

  return withTransaction(async (tx) => {
    const empRes = await tx.query<{ organization_id: string; employee_number: string }>(
      `select organization_id, employee_number from public.employees where id = $1`,
      [input.employee_id],
    );
    const employee = empRes.rows[0];
    if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, employee.organization_id);

    // Every branch must belong to the employee's organization.
    if (input.branch_ids.length > 0) {
      const check = await tx.query<{ count: string }>(
        `select count(*)::text as count from public.branches
         where organization_id = $1 and id = any($2::uuid[])`,
        [employee.organization_id, input.branch_ids],
      );
      if (Number(check.rows[0].count) !== input.branch_ids.length) {
        throw new AppError(ErrorCode.INVALID_INPUT, "All branches must belong to the employee's organization.");
      }
    }

    await tx.query(`delete from public.employee_branches where employee_id = $1`, [input.employee_id]);
    if (input.branch_ids.length > 0) {
      await tx.query(
        `insert into public.employee_branches (organization_id, employee_id, branch_id)
         select $1, $2, x from unnest($3::uuid[]) as t(x)
         on conflict (employee_id, branch_id) do nothing`,
        [employee.organization_id, input.employee_id, input.branch_ids],
      );
    }

    await auditWorker(tx, {
      action: "employee.branches_updated",
      organizationId: employee.organization_id,
      resourceType: "employee_branches",
      resourceId: input.employee_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { branch_count: input.branch_ids.length },
    });
    return input.branch_ids;
  });
}

// ---------------------------------------------------------------------------
// Skills + qualifications (BD-W11)
// ---------------------------------------------------------------------------

export async function setEmployeeSkill(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "employees.manage");
  const input = setEmployeeSkillSchema.parse(raw) as SetEmployeeSkillInput;

  await withTransaction(async (tx) => {
    const empRes = await tx.query<{ organization_id: string }>(
      `select organization_id from public.employees where id = $1`,
      [input.employee_id],
    );
    const employee = empRes.rows[0];
    if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, employee.organization_id);

    await tx.query(
      `insert into public.employee_skills
         (organization_id, employee_id, skill_key, qualification_status, qualification_date, expiry_date, level)
       values ($1, $2, $3, $4, $5::date, $6::date, $7)
       on conflict (employee_id, skill_key) do update
         set qualification_status = excluded.qualification_status,
             qualification_date = excluded.qualification_date,
             expiry_date = excluded.expiry_date,
             level = excluded.level,
             updated_at = now()`,
      [
        employee.organization_id,
        input.employee_id,
        input.skill_key,
        input.qualification_status ?? null,
        input.qualification_date ?? null,
        input.expiry_date ?? null,
        input.level ?? null,
      ],
    );
    await auditWorker(tx, {
      action: "employee.skill_updated",
      organizationId: employee.organization_id,
      resourceType: "employee_skills",
      resourceId: input.employee_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { skill_key: input.skill_key },
    });
  });
}

export async function removeEmployeeSkill(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "employees.manage");
  const input = removeEmployeeSkillSchema.parse(raw);

  await withTransaction(async (tx) => {
    const empRes = await tx.query<{ organization_id: string }>(
      `select organization_id from public.employees where id = $1`,
      [input.employee_id],
    );
    const employee = empRes.rows[0];
    if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, employee.organization_id);

    await tx.query(`delete from public.employee_skills where employee_id = $1 and skill_key = $2`, [
      input.employee_id,
      input.skill_key,
    ]);
    await auditWorker(tx, {
      action: "employee.skill_removed",
      organizationId: employee.organization_id,
      resourceType: "employee_skills",
      resourceId: input.employee_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { skill_key: input.skill_key },
    });
  });
}

// ---------------------------------------------------------------------------
// Availability (TD-W6)
// ---------------------------------------------------------------------------

export async function setEmployeeAvailability(ctx: AuthContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "employees.manage");
  const input = setEmployeeAvailabilitySchema.parse(raw) as SetEmployeeAvailabilityInput;

  await withTransaction(async (tx) => {
    const empRes = await tx.query<{ organization_id: string }>(
      `select organization_id from public.employees where id = $1`,
      [input.employee_id],
    );
    const employee = empRes.rows[0];
    if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, employee.organization_id);

    await tx.query(`delete from public.employee_availability where employee_id = $1`, [input.employee_id]);
    for (const w of input.windows) {
      await tx.query(
        `insert into public.employee_availability
           (organization_id, employee_id, weekday, start_time, end_time, effective_from, effective_until)
         values ($1, $2, $3, $4::time, $5::time, $6::date, $7::date)`,
        [
          employee.organization_id,
          input.employee_id,
          w.weekday,
          w.start_time,
          w.end_time,
          w.effective_from,
          w.effective_until ?? null,
        ],
      );
    }
    await auditWorker(tx, {
      action: "employee.availability_updated",
      organizationId: employee.organization_id,
      resourceType: "employee_availability",
      resourceId: input.employee_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { window_count: input.windows.length },
    });
  });
}

export async function setEmployeeAvailabilityException(
  ctx: AuthContext,
  raw: unknown,
): Promise<void> {
  requirePermission(ctx, "employees.manage");
  const input = setEmployeeAvailabilityExceptionSchema.parse(raw) as SetEmployeeAvailabilityExceptionInput;

  await withTransaction(async (tx) => {
    const empRes = await tx.query<{ organization_id: string }>(
      `select organization_id from public.employees where id = $1`,
      [input.employee_id],
    );
    const employee = empRes.rows[0];
    if (!employee) throw workerError(WorkerErrorCode.EMPLOYEE_NOT_FOUND);
    requireOrganizationAccess(ctx, employee.organization_id);

    await tx.query(
      `insert into public.employee_availability_exceptions
         (organization_id, employee_id, exception_type, start_at, end_at, reason)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)`,
      [employee.organization_id, input.employee_id, input.exception_type, input.start_at, input.end_at, input.reason ?? null],
    );
    await auditWorker(tx, {
      action: "employee.availability_exception_created",
      organizationId: employee.organization_id,
      resourceType: "employee_availability_exceptions",
      resourceId: input.employee_id,
      actorUserId: ctx.actor.userId,
      requestId: ctx.requestId ?? null,
      metadata: { exception_type: input.exception_type },
    });
  });
}

export async function listEmployeeSkills(ctx: AuthContext, employeeId: string) {
  requirePermission(ctx, "employees.view");
  const res = await query<{
    id: string;
    skill_key: string;
    qualification_status: string | null;
    qualification_date: string | null;
    expiry_date: string | null;
    level: number | null;
  }>(
    `select id, skill_key, qualification_status, qualification_date::text, expiry_date::text, level
     from public.employee_skills where employee_id = $1 order by skill_key`,
    [employeeId],
  );
  return res.rows;
}

export async function listEmployeeAvailability(ctx: AuthContext, employeeId: string) {
  requirePermission(ctx, "employees.view");
  const res = await query<{
    id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    effective_from: string;
    effective_until: string | null;
  }>(
    `select id, weekday, start_time::text, end_time::text, effective_from::text, effective_until::text
     from public.employee_availability where employee_id = $1 order by weekday, start_time`,
    [employeeId],
  );
  return res.rows;
}

export async function listEmployeeExceptions(ctx: AuthContext, employeeId: string) {
  requirePermission(ctx, "employees.view");
  const res = await query<{
    id: string;
    exception_type: string;
    start_at: string;
    end_at: string;
    reason: string | null;
  }>(
    `select id, exception_type, start_at::text, end_at::text, reason
     from public.employee_availability_exceptions
     where employee_id = $1 order by start_at desc limit 200`,
    [employeeId],
  );
  return res.rows;
}

// Re-export writeJobEvent for internal flows that need job events alongside
// employee mutations (kept here to avoid a circular import in service.ts).
export { writeJobEvent };
