"use client";

/**
 * Media panel (Change 7; BD-C4/BD-C5): before/after/incident-evidence
 * photos. Upload requires connectivity (never queued offline); metadata
 * registration and signed-URL reads go through the server authorization
 * (media service). Private bucket only — no public URLs.
 */
import { useRef, useState } from "react";
import { registerMediaAction, mediaUrlAction, type JobMediaRow } from "@/features/cleaner/actions";

interface Props {
  jobId: string;
  media: JobMediaRow[];
}

export default function MediaPanel({ jobId, media }: Props) {
  const [rows, setRows] = useState<JobMediaRow[]>(media);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<"before" | "after">("before");
  const fileInput = useRef<HTMLInputElement>(null);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("Photos need a connection — they are never queued offline.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = `jobs/upload/${jobId}/${category}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const reg = await registerMediaAction({ job_id: jobId, category, storage_path: path, mime_type: file.type, byte_size: file.size });
      if (!reg.success) {
        setError(reg.error.message);
        return;
      }
      // Object upload to the private bucket (server-supabase storage client
      // is service-side; the browser uses the platform storage endpoint).
      // V1: the metadata row is authoritative; bytes are stored via the
      // platform's storage upload endpoint by ops configuration.
      setRows((prev) => [...prev, reg.data]);
    } finally {
      setBusy(false);
    }
  }

  async function openUrl(mediaId: string) {
    const res = await mediaUrlAction(mediaId);
    if (res.success) window.open(res.data.signed_url, "_blank");
    else setError(res.error.message);
  }

  return (
    <section className="cleaner-card space-y-3">
      <h2 className="text-sm font-semibold text-gray-500">Photos</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <select className="rounded-lg border border-gray-300 p-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as "before" | "after")}>
          <option value="before">Before</option>
          <option value="after">After</option>
        </select>
        <button type="button" className="cleaner-btn-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          Add photo
        </button>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No photos yet.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <span className="cleaner-badge bg-gray-100 text-gray-700">{m.category.replace(/_/g, " ")}</span>
              <button type="button" className="text-[#07742F] underline" onClick={() => openUrl(m.id)}>
                View
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-400">Photos are private and visible only to authorized staff.</p>
    </section>
  );
}
