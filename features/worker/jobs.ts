/**
 * Job domain (Change 6, tasks 6.1–6.4, 8.1; design §4 TD-W1/W3/W5, §5, §6).
 *
 * Worker-owned contracts invoked BY the Booking actions AFTER their
 * transaction commits (BD-W6/W7): creation (idempotent/convergent),
 * reschedule propagation (retain+revalidate, flag-not-unassign),
 * cancellation propagation (job cancelled, assignments released),
 * no-show propagation (cancelled + no_show incident).
 */
import "server-only";
import { query, withTransaction, type TransactionClient } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { writeJobEvent, enqueueWorkerOutbox, auditWorker } from "./events";
import { validateAssignmentEligibility } from "./eligibility";
import { applyJobDerivedBookingTransition } from "@/features/booking/workerContract";

export interface JobRow {
  id: string;
  organization_id: string;
  branch_id: string;
  booking_id: string | null;
  job_number: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  job_snapshot: Record<string, unknown>;
  required_skills: string[];
  assignment_flag_reason: string | null;
}

const BOOKING_COLUMNS = `id, organization_id, branch_id, customer_id, booking_number, status,
  scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
  timezone, service_address, customer_notes, pricing_version_id`;

interface BookingSource {
  id: string;
  organization_id: string;
  branch_id: string;
  customer_id: string;
  booking_number: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  timezone: string;
  service_address: Record<string, unknown> | null;
  customer_notes: string | null;
  pricing_version_id: string | null;
}

/** Minimal customer display per WORKER §29–30 (first name only). */
async function loadCustomerDisplay(booking: BookingSource): Promise<{ first_name: string; last_initial: string }> {
  const res = await query<{ first_name: string; last_name: string }>(
    `select first_name, last_name from public.customers where id = $1`,
    [booking.customer_id],
  );
  const c = res.rows[0];
  if (!c) throw new AppError(ErrorCode.NOT_FOUND, "Customer not found for booking.");
  return { first_name: c.first_name, last_initial: c.last_name.charAt(0) };
}

/** Service/variant labels from the booking items (read-only catalog facts). */
async function loadServiceFacts(bookingId: string): Promise<{ service_label: string; variant_label: string | null; addon_labels: string[] }> {
  const res = await query<{ kind: string; label: string }>(
    `select kind, label from public.booking_items where booking_id = $1 order by created_at`,
    [bookingId],
  );
  const service = res.rows.find((r) => r.kind === "service");
  if (!service) throw new AppError(ErrorCode.INTERNAL_ERROR, "Booking has no service item.");
  return {
    service_label: service.label,
    variant_label: res.rows.find((r) => r.kind === "variant")?.label ?? null,
    addon_labels: res.rows.filter((r) => r.kind === "addon").map((r) => r.label),
  };
}

/**
 * BD-W5/TD-W5: derive the JOB-number year from the branch-local service
 * start. Uses the scheduling timezone helpers (no second engine).
 */
async function branchLocalYear(timeZone: string, scheduledStartIso: string): Promise<number> {
  const { localDateString } = await import("@/features/scheduling/timezone");
  return Number(localDateString(new Date(scheduledStartIso), timeZone).slice(0, 4));
}

// ---------------------------------------------------------------------------
// TD-W5: JOB-number allocation (row-locked, monotonic, never resets)
// ---------------------------------------------------------------------------

async function allocateJobNumber(tx: { query: TransactionClient["query"] }, organizationId: string, year: number): Promise<string> {
  const res = await tx.query<{ last_sequence: string }>(
    `insert into public.job_number_sequences (organization_id, last_sequence)
     values ($1, 1)
     on conflict (organization_id) do update
       set last_sequence = public.job_number_sequences.last_sequence + 1,
           updated_at = now()
     returning last_sequence`,
    [organizationId],
  );
  const seq = BigInt(res.rows[0].last_sequence);
  return `JOB-${year}-${seq.toString().padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// BD-W6/TD-W1: post-commit idempotent job creation
// ---------------------------------------------------------------------------

/**
 * Ensure exactly one job exists for the confirmed booking. Called by the
 * booking confirmation action AFTER its transaction commits; also the retry
 * entry point (staff re-invocation). Failure modes:
 *  - booking not confirmed → BOOKING_NOT_CONFIRMED (caller bug; loud).
 *  - transient DB failure → throws; caller surfaces, booking unaffected.
 *  - concurrent creation → unique index arbitration; both paths converge.
 */
export async function ensureJobForBooking(bookingId: string): Promise<JobRow> {
  // Fast path: already exists (retry / re-invocation).
  const existing = await query<JobRow>(
    `select id, organization_id, branch_id, booking_id, job_number, status,
            scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
            timezone, job_snapshot, required_skills, assignment_flag_reason
     from public.jobs where booking_id = $1`,
    [bookingId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const bookingRes = await query<BookingSource>(
    `select ${BOOKING_COLUMNS} from public.bookings where id = $1`,
    [bookingId],
  );
  const booking = bookingRes.rows[0];
  if (!booking) throw new AppError(ErrorCode.NOT_FOUND, "Booking not found.");
  if (booking.status !== "confirmed" && booking.status !== "assigned") {
    throw workerError(WorkerErrorCode.BOOKING_NOT_CONFIRMED, { booking_status: booking.status });
  }

  const customerDisplay = await loadCustomerDisplay(booking);
  const facts = await loadServiceFacts(bookingId);

  // BD-W5: year from the branch-local service start. The booking stores
  // the branch timezone; derive the local year (TD-W5) rather than the UTC
  // year so a New Year boundary inside the branch's UTC offset stays
  // consistent with the displayed local service date.
  const localYear = await branchLocalYear(booking.timezone, booking.scheduled_start);

  return withTransaction(async (tx) => {
    // Re-check inside the transaction (race with another creation).
    const existingInTx = await tx.query<JobRow>(
      `select id from public.jobs where booking_id = $1`,
      [bookingId],
    );
    if (existingInTx.rows[0]) {
      return (await query<JobRow>(
        `select id, organization_id, branch_id, booking_id, job_number, status,
                scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
                timezone, job_snapshot, required_skills, assignment_flag_reason
         from public.jobs where booking_id = $1`,
        [bookingId],
      )).rows[0];
    }

    const jobNumber = await allocateJobNumber(tx, booking.organization_id, localYear);

    const jobSnapshot = {
      booking_number: booking.booking_number,
      service_label: facts.service_label,
      variant_label: facts.variant_label,
      addon_labels: facts.addon_labels,
      service_address: booking.service_address,
      customer_display: customerDisplay,
      property_details: null,
      instructions: booking.customer_notes,
      scheduled_start: booking.scheduled_start,
      scheduled_end: booking.scheduled_end,
    };

    const res = await tx.query<JobRow>(
      `insert into public.jobs
         (organization_id, branch_id, booking_id, job_number, status,
          scheduled_start, scheduled_end, timezone, job_snapshot, pricing_version_id)
       values ($1, $2, $3, $4, 'pending', $5::timestamptz, $6::timestamptz, $7, $8::jsonb, $9)
       returning id, organization_id, branch_id, booking_id, job_number, status,
                 scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
                 timezone, job_snapshot, required_skills, assignment_flag_reason`,
      [
        booking.organization_id,
        booking.branch_id,
        bookingId,
        jobNumber,
        booking.scheduled_start,
        booking.scheduled_end,
        booking.timezone,
        JSON.stringify(jobSnapshot),
        booking.pricing_version_id,
      ],
    );
    const job = res.rows[0];

    await writeJobEvent(
      {
        organizationId: booking.organization_id,
        branchId: booking.branch_id,
        jobId: job.id,
        eventType: "job_created",
        metadata: { booking_number: booking.booking_number, job_number: jobNumber },
        actorType: "system",
      },
      tx,
    );
    await enqueueWorkerOutbox(
      tx,
      {
        organizationId: booking.organization_id,
        branchId: booking.branch_id,
        jobId: job.id,
        eventType: "job_created",
        payload: { job_number: jobNumber, booking_number: booking.booking_number },
      },
    );
    await auditWorker(tx, {
      action: "job.created",
      organizationId: booking.organization_id,
      branchId: booking.branch_id,
      resourceType: "jobs",
      resourceId: job.id,
      actorUserId: null,
      metadata: { booking_id: bookingId, job_number: jobNumber, actor_type: "system" },
    });

    return job;
  });
}

// ---------------------------------------------------------------------------
// BD-W7b: reschedule propagation (same job, retain + revalidate)
// ---------------------------------------------------------------------------

export async function propagateRescheduleToJob(
  bookingId: string,
  newStart: string,
  newEnd: string,
): Promise<void> {
  const jobRes = await query<JobRow & { id: string }>(
    `select id, organization_id, branch_id, booking_id, job_number, status,
            scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
            timezone, job_snapshot, required_skills, assignment_flag_reason
     from public.jobs where booking_id = $1`,
    [bookingId],
  );
  const job = jobRes.rows[0];
  if (!job) return; // no job yet (creation pending) — nothing to propagate

  if (!["pending", "assigned"].includes(job.status)) {
    throw workerError(WorkerErrorCode.JOB_STATE_INVALID, { status: job.status });
  }

  await withTransaction(async (tx) => {
    const previous = { start: job.scheduled_start, end: job.scheduled_end };

    await tx.query(
      `update public.jobs
       set scheduled_start = $2::timestamptz, scheduled_end = $3::timestamptz, updated_at = now()
       where id = $1`,
      [job.id, newStart, newEnd],
    );

    // BD-W7b: retain the assignment, revalidate against the new interval.
    const activeRes = await tx.query<{ id: string; employee_id: string }>(
      `select id, employee_id from public.job_assignments
       where job_id = $1 and assignment_status = 'active'`,
      [job.id],
    );
    const active = activeRes.rows[0];
    if (active) {
      try {
        await validateAssignmentEligibility(tx, {
          employeeId: active.employee_id,
          jobId: job.id,
          branchId: job.branch_id,
          organizationId: job.organization_id,
          scheduledStart: newStart,
          scheduledEnd: newEnd,
          requiredSkills: job.required_skills,
          timeZone: job.timezone,
        });
        await tx.query(`update public.jobs set assignment_flag_reason = null where id = $1`, [job.id]);
      } catch (err) {
        // Flag for manager replacement — NEVER silently unassign (BD-W7b).
        const reason = err instanceof AppError ? (err.details?.worker_code as string) : "revalidation_failed";
        await tx.query(`update public.jobs set assignment_flag_reason = $2 where id = $1`, [job.id, reason]);
        await writeJobEvent(
          {
            organizationId: job.organization_id,
            branchId: job.branch_id,
            jobId: job.id,
            eventType: "assignment_flagged",
            metadata: { employee_id: active.employee_id, reason },
            actorType: "system",
          },
          tx,
        );
      }
    }

    await writeJobEvent(
      {
        organizationId: job.organization_id,
        branchId: job.branch_id,
        jobId: job.id,
        eventType: "job_rescheduled",
        metadata: {
          previous_scheduled_start: previous.start,
          previous_scheduled_end: previous.end,
          new_scheduled_start: newStart,
          new_scheduled_end: newEnd,
        },
        actorType: "system",
      },
      tx,
    );
    await enqueueWorkerOutbox(tx, {
      organizationId: job.organization_id,
      branchId: job.branch_id,
      jobId: job.id,
      eventType: "job_created", // no dedicated reschedule email type in V1 outbox vocabulary
      payload: { kind: "job_rescheduled", job_number: job.job_number, new_scheduled_start: newStart },
    });
  });
}

// ---------------------------------------------------------------------------
// BD-W7c: cancellation propagation (job cancelled, assignments released)
// ---------------------------------------------------------------------------

export async function propagateCancellationToJob(bookingId: string, reason: string): Promise<void> {
  const jobRes = await query<JobRow>(
    `select id, organization_id, branch_id, booking_id, job_number, status,
            scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
            timezone, job_snapshot, required_skills, assignment_flag_reason
     from public.jobs where booking_id = $1`,
    [bookingId],
  );
  const job = jobRes.rows[0];
  if (!job) return;

  await withTransaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `update public.jobs
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = $2, updated_at = now()
       where id = $1 and status in ('pending', 'assigned')
       returning id`,
      [job.id, reason],
    );
    if (!res.rows[0]) return; // already cancelled/completed — idempotent no-op

    // Release assignments (history preserved — rows become `cancelled`).
    await tx.query(
      `update public.job_assignments
       set assignment_status = 'cancelled', updated_at = now()
       where job_id = $1 and assignment_status in ('active', 'pending')`,
      [job.id],
    );

    await writeJobEvent(
      {
        organizationId: job.organization_id,
        branchId: job.branch_id,
        jobId: job.id,
        eventType: "job_cancelled",
        metadata: { reason },
        actorType: "system",
      },
      tx,
    );
    await enqueueWorkerOutbox(tx, {
      organizationId: job.organization_id,
      branchId: job.branch_id,
      jobId: job.id,
      eventType: "job_cancelled",
      payload: { job_number: job.job_number, reason },
    });
  });
}

// ---------------------------------------------------------------------------
// BD-W7d: no-show propagation (cancelled + no_show incident)
// ---------------------------------------------------------------------------

export async function propagateNoShowToJob(bookingId: string, reason: string): Promise<void> {
  const jobRes = await query<JobRow>(
    `select id, organization_id, branch_id, booking_id, job_number, status,
            scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
            timezone, job_snapshot, required_skills, assignment_flag_reason
     from public.jobs where booking_id = $1`,
    [bookingId],
  );
  const job = jobRes.rows[0];
  if (!job) return;

  await withTransaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `update public.jobs
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = $2, updated_at = now()
       where id = $1 and status in ('pending', 'assigned')
       returning id`,
      [job.id, reason],
    );
    if (res.rows[0]) {
      await tx.query(
        `update public.job_assignments
         set assignment_status = 'cancelled', updated_at = now()
         where job_id = $1 and assignment_status in ('active', 'pending')`,
        [job.id],
      );
      await writeJobEvent(
        {
          organizationId: job.organization_id,
          branchId: job.branch_id,
          jobId: job.id,
          eventType: "job_cancelled",
          metadata: { reason: "no_show" },
          actorType: "system",
        },
        tx,
      );
    }

    // The no_show incident is created regardless (idempotency guard: one
    // open no_show incident per job).
    const incidentRes = await tx.query<{ id: string }>(
      `insert into public.incidents
         (organization_id, branch_id, job_id, incident_type, description, status)
       select $1, $2, $3, 'no_show', $4, 'open'
       where not exists (
         select 1 from public.incidents
         where job_id = $3 and incident_type = 'no_show'
       )
       returning id`,
      [job.organization_id, job.branch_id, job.id, reason],
    );

    if (incidentRes.rows[0]) {
      await writeJobEvent(
        {
          organizationId: job.organization_id,
          branchId: job.branch_id,
          jobId: job.id,
          eventType: "incident_reported",
          metadata: { incident_type: "no_show" },
          actorType: "system",
        },
        tx,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Staff-authoritative lifecycle surface (design §5) + derived booking mirror
// ---------------------------------------------------------------------------

/**
 * Authorized staff completion of an assigned job (WORKER §65 server
 * authority). Then the Booking-owned transition contract reflects the
 * completion on the booking (post-Worker-commit; TD-W4).
 */
export async function completeJob(ctx: { userId: string }, jobId: string): Promise<JobRow> {
  const bookingIdRes = await query<{ booking_id: string | null }>(
    `select booking_id from public.jobs where id = $1`,
    [jobId],
  );
  const jobBookingId = bookingIdRes.rows[0]?.booking_id ?? null;

  const completed = await withTransaction(async (tx) => {
    const jobRes = await tx.query<JobRow & { status: string }>(
      `select id, organization_id, branch_id, booking_id, job_number, status,
              scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
              timezone, job_snapshot, required_skills, assignment_flag_reason
       from public.jobs where id = $1 for update`,
      [jobId],
    );
    const job = jobRes.rows[0];
    if (!job) throw workerError(WorkerErrorCode.JOB_NOT_FOUND);
    if (job.status !== "assigned") {
      throw workerError(WorkerErrorCode.JOB_STATE_INVALID, { status: job.status });
    }

    const res = await tx.query<JobRow>(
      `update public.jobs
       set status = 'completed', completed_at = now(), updated_at = now()
       where id = $1
       returning id, organization_id, branch_id, booking_id, job_number, status,
                 scheduled_start::text as scheduled_start, scheduled_end::text as scheduled_end,
                 timezone, job_snapshot, required_skills, assignment_flag_reason`,
      [jobId],
    );
    const completed = res.rows[0];

    // Release the active assignment as `completed` (history preserved).
    await tx.query(
      `update public.job_assignments
       set assignment_status = 'completed', updated_at = now()
       where job_id = $1 and assignment_status = 'active'`,
      [jobId],
    );

    await writeJobEvent(
      {
        organizationId: job.organization_id,
        branchId: job.branch_id,
        jobId: jobId,
        eventType: "job_completed",
        metadata: { completed_by: ctx.userId },
        actorType: "staff",
        actorUserId: ctx.userId,
      },
      tx,
    );
    await auditWorker(tx, {
      action: "job.completed",
      organizationId: job.organization_id,
      branchId: job.branch_id,
      resourceType: "jobs",
      resourceId: jobId,
      actorUserId: ctx.userId,
      metadata: { job_number: job.job_number },
    });

    return completed;
  });

  // BD-W7a/TD-W4: derived booking completion AFTER the Worker transaction
  // commits. The booking walks assigned→in_progress→completed through the
  // Booking-owned contract (each step writes its own event).
  if (jobBookingId) {
    await applyJobDerivedBookingTransition(jobBookingId, "completed");
  }
  return completed;
}
