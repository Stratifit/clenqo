"use server";

/**
 * Cleaner server actions (Change 7; API_STANDARDS §4 — authenticate →
 * authorize → validate → domain service → typed result).
 *
 * ZERO business logic: every action delegates to the Worker-owned
 * execution contracts (features/worker/execution.ts), which enforce the
 * cleaner resolution chain, the transition matrix, idempotency, and the
 * completion gates. No Booking table is ever written here (BD-C9); no
 * location data is accepted (BD-C6); no signature exists (BD-C8).
 */
import { getAuthenticatedUserId } from "@/lib/session/server";
import { fail, ok, toAppError, type Result } from "@/lib/errors";
import {
  cleanerEnRoute,
  cleanerCheckIn,
  cleanerStartWork,
  cleanerCheckOut,
  completeCleanerJob,
  completeChecklistItem,
  reportCleanerIncident,
  getJobChecklist,
  type ExecutionJobRow,
  type ChecklistItemRow,
  type ChecklistSnapshotRow,
} from "@/features/worker/execution";
import { registerJobMedia, listJobMedia, getMediaSignedUrl, type JobMediaRow, type JobMediaCategory } from "@/features/worker/media";
import {
  getCleanerJobView,
  listCleanerJobs,
  listCleanerNotifications,
  type CleanerJobView,
  type CleanerJobBucket,
  type CleanerNotificationView,
} from "@/features/worker/cleanerView";
import type { IncidentRow } from "@/features/worker/incidents";

export type { CleanerJobView, CleanerJobBucket, CleanerNotificationView, ChecklistItemRow, ChecklistSnapshotRow, JobMediaRow, JobMediaCategory };

async function withAuth<T>(fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  try {
    const userId = await getAuthenticatedUserId();
    return ok(await fn(userId));
  } catch (err) {
    const appErr = toAppError(err);
    return fail(appErr.code, appErr.message, { fieldErrors: appErr.fieldErrors });
  }
}

// --- Reads (BD-C1 minimized views) ---------------------------------------

export async function cleanerHomeAction(): Promise<Result<{ today: CleanerJobView[]; tomorrow: CleanerJobView[]; upcoming: CleanerJobView[]; notifications: CleanerNotificationView[] }>> {
  return withAuth(async (userId) => {
    const [today, tomorrow, upcoming, notifications] = await Promise.all([
      listCleanerJobs(userId, "today"),
      listCleanerJobs(userId, "tomorrow"),
      listCleanerJobs(userId, "upcoming"),
      listCleanerNotifications(userId),
    ]);
    return { today, tomorrow, upcoming, notifications };
  });
}

export async function cleanerJobsAction(bucket: CleanerJobBucket): Promise<Result<CleanerJobView[]>> {
  return withAuth((userId) => listCleanerJobs(userId, bucket));
}

export async function cleanerJobAction(jobId: string): Promise<Result<CleanerJobView>> {
  return withAuth((userId) => getCleanerJobView(userId, jobId));
}

export async function cleanerChecklistAction(jobId: string): Promise<Result<{ snapshot: ChecklistSnapshotRow | null; items: ChecklistItemRow[] }>> {
  return withAuth((_userId) => getJobChecklist(jobId));
}

// --- Execution transitions (BD-C2; idempotent, server-authoritative) -----

export async function enRouteAction(jobId: string): Promise<Result<ExecutionJobRow>> {
  return withAuth((userId) => cleanerEnRoute(userId, jobId));
}

export async function checkInAction(jobId: string): Promise<Result<ExecutionJobRow>> {
  return withAuth((userId) => cleanerCheckIn(userId, jobId));
}

export async function startWorkAction(jobId: string): Promise<Result<ExecutionJobRow>> {
  return withAuth((userId) => cleanerStartWork(userId, jobId));
}

export async function checkOutAction(jobId: string): Promise<Result<ExecutionJobRow>> {
  return withAuth((userId) => cleanerCheckOut(userId, jobId));
}

export async function completeJobAction(jobId: string): Promise<Result<ExecutionJobRow>> {
  return withAuth((userId) => completeCleanerJob(userId, jobId));
}

// --- Checklist / incidents / media ---------------------------------------

export async function completeChecklistItemAction(input: { job_id: string; item_id: string; notes?: string | null }): Promise<Result<ChecklistItemRow>> {
  return withAuth((userId) => completeChecklistItem(userId, input));
}

export async function reportIncidentAction(input: { job_id: string; incident_type: string; severity?: string | null; description?: string | null }): Promise<Result<IncidentRow>> {
  return withAuth((userId) => reportCleanerIncident(userId, input));
}

export async function registerMediaAction(input: { job_id: string; category: JobMediaCategory; storage_path: string; mime_type?: string | null; byte_size?: number | null; incident_id?: string | null }): Promise<Result<JobMediaRow>> {
  return withAuth((userId) => registerJobMedia(userId, input));
}

export async function listMediaAction(jobId: string): Promise<Result<JobMediaRow[]>> {
  return withAuth((userId) => listJobMedia(userId, jobId));
}

export async function mediaUrlAction(mediaId: string): Promise<Result<{ signed_url: string; expires_in: number }>> {
  return withAuth((userId) => getMediaSignedUrl(userId, mediaId));
}
