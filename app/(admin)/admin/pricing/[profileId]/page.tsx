import Link from "next/link";
import {
  listPricingProfilesAction,
  listPricingVersionsAction,
} from "@/features/pricing/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../../pageContext";
import PricingVersionActions from "./PricingVersionActions";

export const dynamic = "force-dynamic";

/**
 * `/admin/pricing/[profileId]` — version list for one pricing profile
 * (Change 10, design §5). Versions are created via `createPricingVersionAction`
 * only; effective dates and lifecycle are server-authoritative. Draft version
 * editing is the only mutable path (design: draft-only editing).
 */
export default async function AdminPricingProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const { ctx, branchId } = await requireBookingPageContext("pricing.view");
  const canEdit = hasPermission(ctx, "pricing.edit");
  const canCreate = hasPermission(ctx, "pricing.create");

  const profiles = await listPricingProfilesAction(branchId);
  const profile = profiles.success ? profiles.data.find((p) => p.id === profileId) : undefined;
  if (!profile) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Pricing profile not found in this branch.
      </p>
    );
  }

  const versions = await listPricingVersionsAction(profileId);
  if (!versions.success) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load versions: {versions.error.message}
      </p>
    );
  }

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
        <Link href="/admin/pricing" className="underline">
          Pricing
        </Link>{" "}
        / <span>{profile.name}</span>
      </nav>
      <h1 className="mt-2 text-lg font-semibold">
        {profile.name} <span className="text-sm font-normal text-gray-500">({profile.currency})</span>
      </h1>

      {versions.data.length === 0 ? (
        <p className="mt-6 rounded border border-gray-200 p-6 text-sm text-gray-500">
          No versions yet for this profile.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {versions.data.map((v) => (
            <li key={v.id} className="rounded-lg border border-gray-200 p-3 text-sm">
              <Link href={`/admin/pricing/${profileId}/${v.id}`} className="font-medium underline">
                Version {v.version_number}
              </Link>{" "}
              — {v.status}
              {v.effective_from ? ` · effective ${v.effective_from}` : ""}
              {v.effective_until ? ` – ${v.effective_until}` : ""}
            </li>
          ))}
        </ul>
      )}

      <PricingVersionActions
        profileId={profileId}
        branchId={branchId}
        canCreate={canCreate}
        canEdit={canEdit}
      />
    </div>
  );
}
