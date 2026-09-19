"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ADMIN_CONTEXT_COOKIE, ADMIN_CONTEXT_ALL } from "@/features/admin/contextShared";

/**
 * Branch context selector (C8-1/BD-A3): enumerates only authorized branches
 * (supplied server-side); "All Branches" offered only to HQ roles. The
 * selection is a UI preference persisted via a non-sensitive cookie echo +
 * `?branch=` deep-link param; the server re-validates it on every request.
 */
export default function ContextSelector({
  branches,
  canUseAllBranches,
  current,
}: {
  branches: { id: string; name: string }[];
  canUseAllBranches: boolean;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(value: string) {
    document.cookie = `${ADMIN_CONTEXT_COOKIE}=${value}; path=/; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    if (value === ADMIN_CONTEXT_ALL) params.delete("branch");
    else params.set("branch", value);
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Branch context"
      value={current}
      disabled={pending}
      onChange={(e) => select(e.target.value)}
      className="rounded border border-gray-300 px-2 py-1 text-xs"
    >
      {canUseAllBranches && <option value="all">All Branches</option>}
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
