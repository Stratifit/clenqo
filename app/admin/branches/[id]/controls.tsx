"use client";

import { useState, useTransition } from "react";
import {
  retryProvisioningAction,
  activateBranchAction,
} from "@/features/branches/actions";

export default function BranchAdminControls({
  branchId,
  provisioningStatus,
}: {
  branchId: string;
  provisioningStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: (id: string) => Promise<{ success: boolean; error?: { code: string; message: string } }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn(branchId);
      if (result.success) {
        setMessage("Success — refreshing…");
        window.location.reload();
      } else {
        setMessage(`${result.error?.code}: ${result.error?.message}`);
      }
    });
  }

  return (
    <div className="mt-6 flex items-center gap-3">
      {provisioningStatus === "failed" && (
        <button
          onClick={() => run(retryProvisioningAction)}
          disabled={pending}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Retrying…" : "Retry provisioning"}
        </button>
      )}
      <button
        onClick={() => run(activateBranchAction)}
        disabled={pending || provisioningStatus !== "ready"}
        title={
          provisioningStatus !== "ready"
            ? "Provisioning must be ready before activation"
            : undefined
        }
        className="rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white hover:bg-[#055c24] disabled:opacity-40"
      >
        {pending ? "Working…" : "Activate branch"}
      </button>
      {message && <span className="text-sm text-red-700">{message}</span>}
    </div>
  );
}
