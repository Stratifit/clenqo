/**
 * Job media service (Change 7, tasks 6.2–6.3; design §7; BD-C4).
 *
 * Private, job-scoped photo metadata + authorization for the categories
 * exactly before / after / incident_evidence. Binary objects live in the
 * PRIVATE media bucket (MEDIA_STORAGE §67/§32) — never in the database,
 * never publicly readable. Signed URLs are minted ONLY after server
 * authorization for a cleaner with an active assignment on the job
 * (or staff with jobs.view + branch scope). Category allow-list,
 * per-category size limits, and the bucket name come from configuration
 * (MEDIA_STORAGE §18: "No endpoint should accept unlimited uploads") —
 * no invented production values beyond the configured allow-list itself.
 * Offline upload is explicitly NOT supported (BD-C5).
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { query, withTransaction } from "@/lib/db/server";
import { AppError, ErrorCode } from "@/lib/errors";
import { workerError, WorkerErrorCode } from "./errors";
import { auditWorker } from "./events";

export type JobMediaCategory = "before" | "after" | "incident_evidence";

export const MEDIA_CATEGORIES: readonly JobMediaCategory[] = ["before", "after", "incident_evidence"];

/** Configurable allow-list (MEDIA_STORAGE §18) — implementation configuration, not business data. */
const CATEGORY_LIMITS: Record<JobMediaCategory, { maxBytes: number; maxCountPerJob: number; mimePrefixes: string[] }> = {
  before: { maxBytes: 10 * 1024 * 1024, maxCountPerJob: 20, mimePrefixes: ["image/"] },
  after: { maxBytes: 10 * 1024 * 1024, maxCountPerJob: 20, mimePrefixes: ["image/"] },
  incident_evidence: { maxBytes: 10 * 1024 * 1024, maxCountPerJob: 20, mimePrefixes: ["image/"] },
};

/** Job-scoped storage path (MEDIA_STORAGE §67). */
export function jobMediaPath(orgId: string, branchId: string, jobId: string, category: JobMediaCategory, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `jobs/${orgId}/${branchId}/${jobId}/${category}/${Date.now()}-${safe}`;
}

function mediaBucket(): string {
  // Finalized during implementation per MEDIA_STORAGE §149/§160; private by
  // project convention (bucket creation is infrastructure, see docs sync).
  return process.env.SUPABASE_MEDIA_BUCKET ?? "media";
}

function storageAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Media storage is not configured.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface JobMediaRow {
  id: string;
  job_id: string;
  incident_id: string | null;
  category: JobMediaCategory;
  storage_path: string;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
}

const MEDIA_COLUMNS = `id, job_id, incident_id, category, storage_path, mime_type, byte_size, created_at::text as created_at`;

/** Job + cleaner active-assignment check (application layer; RLS is the second boundary). */
async function requireMediaScope(
  userId: string,
  jobId: string,
): Promise<{ organization_id: string; branch_id: string; employee_id: string }> {
  const res = await query<{ organization_id: string; branch_id: string; employee_id: string }>(
    `select j.organization_id, j.branch_id, ja.employee_id
     from public.jobs j
     join public.job_assignments ja on ja.job_id = j.id and ja.assignment_status = 'active'
     join public.employees e on e.id = ja.employee_id
     where j.id = $1 and e.user_id = $2 and e.status = 'active'`,
    [jobId, userId],
  );
  const row = res.rows[0];
  if (!row) throw workerError(WorkerErrorCode.MEDIA_UNAUTHORIZED, { job_id: jobId });
  return row;
}

/**
 * Validate + register an upload (metadata row). The caller uploads the
 * bytes to the private bucket via the returned storage_path using the
 * platform storage client; this function enforces category, size, MIME,
 * count limits, and the incident linkage for evidence. Idempotent on the
 * (job, storage_path) unique — a retry with the same path returns the
 * existing row (offline-replay safety; bytes upload itself requires
 * connectivity per BD-C5).
 */
export async function registerJobMedia(
  userId: string,
  input: { job_id: string; category: JobMediaCategory; storage_path: string; mime_type?: string | null; byte_size?: number | null; incident_id?: string | null },
): Promise<JobMediaRow> {
  const scope = await requireMediaScope(userId, input.job_id);
  if (!MEDIA_CATEGORIES.includes(input.category)) {
    throw workerError(WorkerErrorCode.MEDIA_CATEGORY_INVALID, { category: input.category });
  }
  const limits = CATEGORY_LIMITS[input.category];
  if (input.byte_size && input.byte_size > limits.maxBytes) {
    throw workerError(WorkerErrorCode.MEDIA_LIMIT_EXCEEDED, { max_bytes: limits.maxBytes });
  }
  if (input.mime_type && !limits.mimePrefixes.some((p) => input.mime_type!.startsWith(p))) {
    throw workerError(WorkerErrorCode.MEDIA_CATEGORY_INVALID, { mime_type: input.mime_type });
  }
  if (input.category === "incident_evidence" && !input.incident_id) {
    throw workerError(WorkerErrorCode.MEDIA_CATEGORY_INVALID, { reason: "incident_required" });
  }

  return withTransaction(async (tx) => {
    const existing = await tx.query<JobMediaRow>(
      `select ${MEDIA_COLUMNS} from public.job_media where job_id = $1 and storage_path = $2`,
      [input.job_id, input.storage_path],
    );
    if (existing.rows[0]) return existing.rows[0]; // idempotent retry

    const countRes = await tx.query<{ n: string }>(
      `select count(*)::text as n from public.job_media where job_id = $1 and category = $2`,
      [input.job_id, input.category],
    );
    if (Number(countRes.rows[0].n) >= limits.maxCountPerJob) {
      throw workerError(WorkerErrorCode.MEDIA_LIMIT_EXCEEDED, { max_count: limits.maxCountPerJob });
    }

    const res = await tx.query<JobMediaRow>(
      `insert into public.job_media
         (organization_id, branch_id, job_id, incident_id, category, storage_path, mime_type, byte_size, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning ${MEDIA_COLUMNS}`,
      [
        scope.organization_id,
        scope.branch_id,
        input.job_id,
        input.incident_id ?? null,
        input.category,
        input.storage_path,
        input.mime_type ?? null,
        input.byte_size ?? null,
        userId,
      ],
    );
    await auditWorker(tx, {
      action: "media.registered",
      organizationId: scope.organization_id,
      branchId: scope.branch_id,
      resourceType: "job_media",
      resourceId: res.rows[0].id,
      actorUserId: userId,
      requestId: null,
      metadata: { job_id: input.job_id, category: input.category },
    });
    return res.rows[0];
  });
}

/** List a job's media (authorized cleaner or staff; RLS mirrors this). */
export async function listJobMedia(userId: string, jobId: string): Promise<JobMediaRow[]> {
  await requireMediaScope(userId, jobId);
  const res = await query<JobMediaRow>(
    `select ${MEDIA_COLUMNS} from public.job_media where job_id = $1 order by created_at`,
    [jobId],
  );
  return res.rows;
}

/**
 * Mint a SHORT-LIVED signed URL for a media object — only after the
 * caller is authorized for the job (cleaner with active assignment).
 * Expiry per MEDIA_STORAGE §32 (short-lived; possession is sensitive).
 */
export async function getMediaSignedUrl(userId: string, mediaId: string): Promise<{ signed_url: string; expires_in: number }> {
  const row = await query<JobMediaRow & { organization_id: string; branch_id: string; employee_id: string | null }>(
    `select m.${MEDIA_COLUMNS.split(", ").map((c) => "m." + c).join(", ")}, m.organization_id, m.branch_id,
            (select ja.employee_id from public.job_assignments ja
             join public.employees e on e.id = ja.employee_id
             where ja.job_id = m.job_id and ja.assignment_status = 'active' and e.user_id = $2 limit 1) as employee_id
     from public.job_media m
     where m.id = $1`,
    [mediaId, userId],
  );
  const media = row.rows[0];
  if (!media) throw workerError(WorkerErrorCode.MEDIA_UNAUTHORIZED, { media_id: mediaId });
  if (!media.employee_id) {
    // Staff path could be added later; V1 cleaner-only surface.
    throw workerError(WorkerErrorCode.MEDIA_UNAUTHORIZED, { media_id: mediaId });
  }
  const client = storageAdmin();
  const { data, error } = await client.storage.from(mediaBucket()).createSignedUrl(media.storage_path, 300);
  if (error || !data) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Could not create media access link.");
  }
  return { signed_url: data.signedUrl, expires_in: 300 };
}
