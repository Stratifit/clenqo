import Link from "next/link";
import {
  listPricingVersionsAction,
  listPricingRulesAction,
  calculateQuoteAction,
} from "@/features/pricing/actions";
import { listEffectiveCatalogAction } from "@/features/services/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../../../pageContext";
import PricingRuleEditor from "./PricingRuleEditor";

export const dynamic = "force-dynamic";

/**
 * `/admin/pricing/[profileId]/[versionId]` — draft rule editor + lifecycle +
 * quote sanity view (Change 10, design §5). Draft-only editing: published and
 * archived versions render read-only. Publishing uses the existing server-side
 * validation via `publishPricingVersionAction`; the UI never calculates
 * authoritative prices (`calculateQuoteAction` is a display-only sanity view
 * over an approved-structure example — no invented production values).
 */
export default async function AdminPricingVersionPage({
  params,
}: {
  params: Promise<{ profileId: string; versionId: string }>;
}) {
  const { profileId, versionId } = await params;
  const { ctx, branchId } = await requireBookingPageContext("pricing.view");
  const canEdit = hasPermission(ctx, "pricing.edit");
  const canPublish = hasPermission(ctx, "pricing.publish");
  const canArchive = hasPermission(ctx, "pricing.archive");

  const versions = await listPricingVersionsAction(profileId);
  const version = versions.success ? versions.data.find((v) => v.id === versionId) : undefined;
  if (!version) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Pricing version not found for this profile.
      </p>
    );
  }
  const isDraft = version.status === "draft";

  const rules = await listPricingRulesAction(versionId);
  if (!rules.success) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load rules: {rules.error.message}
      </p>
    );
  }

  // Quote sanity (display-only): server-calculated example quote for the
  // branch's bookable catalog. Uses the first active+enabled catalog service
  // when one exists; otherwise the view is omitted rather than inventing
  // catalog identity or client-side prices.
  let quoteTotals: { subtotal: string; total: string; currency: string } | null = null;
  let quoteNote: string | null = null;
  const catalog = await listEffectiveCatalogAction(branchId);
  const sampleService = catalog.success ? catalog.data.services[0] : undefined;
  if (sampleService) {
    const quote = await calculateQuoteAction({
      branch_id: branchId,
      service_id: sampleService.id,
      ...(sampleService.variants[0] ? { variant_id: sampleService.variants[0].id } : {}),
      scheduled_date: new Date().toISOString().slice(0, 10),
    });
    if (quote.success) {
      quoteTotals = { subtotal: quote.data.subtotal, total: quote.data.total, currency: quote.data.currency };
    } else {
      quoteNote = `Server rejected the sample quote for this configuration (${quote.error.message}).`;
    }
  } else {
    quoteNote = "No active catalog service on this branch yet — the sanity view needs a bookable service.";
  }

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
        <Link href="/admin/pricing" className="underline">Pricing</Link> /{" "}
        <Link href={`/admin/pricing/${profileId}`} className="underline">Profile</Link> /{" "}
        <span>Version {version.version_number}</span>
      </nav>
      <h1 className="mt-2 text-lg font-semibold">
        Version {version.version_number}{" "}
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${isDraft ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>
          {version.status}
        </span>
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        Effective {version.effective_from}
        {version.effective_until ? ` – ${version.effective_until}` : ""} ·{" "}
        {isDraft ? "editable draft" : "immutable"}
      </p>

      {!isDraft && (
        <p role="note" className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          This version is {version.status} and cannot be edited.
        </p>
      )}

      <PricingRuleEditor
        versionId={versionId}
        branchId={branchId}
        isDraft={isDraft}
        canEdit={canEdit}
        canPublish={canPublish}
        canArchive={canArchive}
        existingRules={rules.data.map((r) => ({
          id: r.id,
          rule_type: r.rule_type,
          configuration: r.configuration,
        }))}
      />

      <section className="mt-6 rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700">Quote sanity view (display-only)</h2>
        {quoteNote ? (
          <p className="mt-2 text-xs text-gray-500">{quoteNote}</p>
        ) : quoteTotals ? (
          <p className="mt-2 text-xs text-gray-700">
            Server-calculated example for the branch&apos;s resolved pricing context — subtotal{" "}
            {quoteTotals.subtotal} / total {quoteTotals.total} {quoteTotals.currency}. The UI never
            computes authoritative prices.
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            No active pricing profile resolves for this branch yet.
          </p>
        )}
      </section>
    </div>
  );
}
