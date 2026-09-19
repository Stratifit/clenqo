import Link from "next/link";
import {
  listPricingProfilesAction,
  listPricingVersionsAction,
} from "@/features/pricing/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../pageContext";
import PricingProfileActions from "./PricingProfileActions";

export const dynamic = "force-dynamic";

/**
 * `/admin/pricing` — pricing profile + version management (Change 10, design
 * §5). Consumes `listPricingProfilesAction` / `listPricingVersionsAction`
 * exclusively; the UI never calculates authoritative pricing. Profile edits
 * are gated by `pricing.edit` server-side (the island hides the update form
 * without it). Branch-scoped via `requireBookingPageContext` (BD-E3b
 * branch-isolation; no All-Branches aggregation).
 */
export default async function AdminPricingPage() {
  const { ctx, branchId } = await requireBookingPageContext("pricing.view");
  const canEdit = hasPermission(ctx, "pricing.edit");

  const profiles = await listPricingProfilesAction(branchId);
  if (!profiles.success) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load pricing profiles: {profiles.error.message}
      </p>
    );
  }

  const versionLists = await Promise.all(
    profiles.data.map(async (p) => {
      const v = await listPricingVersionsAction(p.id);
      return [p.id, v.success ? v.data : []] as const;
    }),
  );
  const byProfile = new Map(versionLists);

  return (
    <div>
      <h1 className="text-lg font-semibold">Pricing</h1>
      <p className="mt-1 text-sm text-gray-600">
        Profiles, versions and draft rules for branch <span className="font-medium">{branchId}</span>. Only
        draft versions are editable; published and archived versions are immutable.
      </p>

      {profiles.data.length === 0 ? (
        <p className="mt-6 rounded border border-gray-200 p-6 text-sm text-gray-500">
          No pricing profiles yet for this branch.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {profiles.data.map((p) => {
            const pvs = byProfile.get(p.id) ?? [];
            return (
              <li key={p.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    <Link href={`/admin/pricing/${p.id}`} className="underline">
                      {p.name}
                    </Link>{" "}
                    <span className="font-normal text-gray-500">({p.currency})</span>
                  </h2>
                  <span className="text-xs text-gray-500">profile status: {p.status}</span>
                </div>
                {pvs.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">No versions yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    {pvs.map((v) => (
                      <li key={v.id}>
                        version{" "}
                        <Link href={`/admin/pricing/${p.id}/${v.id}`} className="underline">
                          {v.version_number}
                        </Link>{" "}
                        — {v.status}
                        {v.effective_from ? ` · effective ${v.effective_from}` : ""}
                        {v.effective_until ? ` – ${v.effective_until}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PricingProfileActions branchId={branchId} canEdit={canEdit} />
    </div>
  );
}
