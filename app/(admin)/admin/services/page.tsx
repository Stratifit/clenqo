import Link from "next/link";
import {
  listEffectiveCatalogAction,
  findOrphanedAddonsAction,
} from "@/features/services/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../pageContext";
import CatalogActions from "./CatalogActions";

export const dynamic = "force-dynamic";

/**
 * `/admin/services` — branch-scoped catalog administration (Change 10,
 * design §4; BD-E3a). Consumes `listEffectiveCatalogAction` exclusively
 * (server-enforced `services.view` + branch scope). Renders the
 * category → service → variant → addon hierarchy plus standalone addons,
 * with the `EffectiveCatalog` localized display fallback (BD-E3d:
 * display-only). Mutations (CRUD, lifecycle, offering toggle, ordering,
 * compatibility, slug rename) ride the existing actions via the client
 * island; no pricing/duration logic, no translation editing, no seed tools.
 */

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-900",
  inactive: "bg-amber-100 text-amber-900",
  archived: "bg-red-100 text-red-900",
};

function label(row: { display_name?: unknown; name: string }): string {
  return typeof row.display_name === "string" && row.display_name.length > 0
    ? row.display_name
    : row.name;
}

export default async function ServicesPage() {
  const { ctx, branchId } = await requireBookingPageContext("services.view");
  const canEdit = hasPermission(ctx, "services.edit");

  const [catalog, orphans] = await Promise.allSettled([
    listEffectiveCatalogAction(branchId),
    findOrphanedAddonsAction(branchId),
  ]);
  const data = catalog.status === "fulfilled" && catalog.value.success ? catalog.value.data : null;
  const error = catalog.status === "fulfilled" && !catalog.value.success ? catalog.value.error.message : null;
  const orphanRows =
    orphans.status === "fulfilled" && orphans.value.success ? orphans.value.data : [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Service catalog</h1>
          <p className="text-sm text-gray-500">
            Branch <span className="font-mono text-xs">{branchId}</span> · lifecycle
            (draft/active/archived) and offering state (enabled) are separate concepts
          </p>
        </div>
        {!canEdit && (
          <p className="text-xs text-gray-400">
            Read-only — editing requires <code>services.edit</code>.
          </p>
        )}
      </header>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : data === null ? (
        <p className="mt-6 text-sm text-gray-500">Loading catalog…</p>
      ) : (
        <>
          <CatalogActions
            branchId={branchId}
            canEdit={canEdit}
            categories={data.categories.map((c) => ({ id: c.id, name: label(c) }))}
            services={data.services.map((s) => ({ id: s.id, name: label(s) }))}
            addons={[...data.services.flatMap((s) => s.addons), ...data.standaloneAddons].map((a) => ({
              id: a.id,
              name: label(a),
            }))}
          />

          {data.categories.length === 0 ? (
            <p className="mt-8 rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              No categories yet. Create the first category to start the catalog.
            </p>
          ) : (
            <div className="mt-6 space-y-6">
              {data.categories.map((cat) => (
                <section key={cat.id} className="rounded-lg border border-gray-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
                    <h2 className="text-sm font-semibold">
                      {label(cat)}{" "}
                      <span className={`ml-2 rounded px-2 py-0.5 text-xs ${STATUS_STYLES[cat.status] ?? ""}`}>
                        {cat.status}
                      </span>
                      {!cat.is_enabled && (
                        <span className="ml-1 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">offering off</span>
                      )}
                    </h2>
                    <span className="font-mono text-xs text-gray-400">{cat.slug}</span>
                  </div>
                  {data.services.filter((s) => s.category_id === cat.id).length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">No services in this category.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {data.services
                        .filter((s) => s.category_id === cat.id)
                        .map((svc) => (
                          <li key={svc.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium">{label(svc)}</span>
                                <span className={`ml-2 rounded px-2 py-0.5 text-xs ${STATUS_STYLES[svc.status] ?? ""}`}>
                                  {svc.status}
                                </span>
                                {!svc.is_enabled && (
                                  <span className="ml-1 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                    offering off
                                  </span>
                                )}
                                <span className="ml-2 font-mono text-xs text-gray-400">{svc.slug}</span>
                              </div>
                            </div>
                            {svc.variants.length > 0 && (
                              <p className="mt-1 text-xs text-gray-500">
                                Variants:{" "}
                                {svc.variants.map((v) => `${label(v)} (${v.status}${v.is_enabled ? "" : ", off"})`).join(" · ")}
                              </p>
                            )}
                            {svc.addons.length > 0 && (
                              <p className="mt-1 text-xs text-gray-500">
                                Add-ons:{" "}
                                {svc.addons.map((a) => `${label(a)} (${a.status}${a.is_enabled ? "" : ", off"})`).join(" · ")}
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              ))}
              {data.standaloneAddons.length > 0 && (
                <section className="rounded-lg border border-gray-200 px-4 py-3">
                  <h2 className="text-sm font-semibold">Standalone add-ons</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {data.standaloneAddons.map((a) => `${label(a)} (${a.status})`).join(" · ")}
                  </p>
                </section>
              )}
            </div>
          )}

          {orphanRows.length > 0 && (
            <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <h2 className="text-sm font-semibold text-amber-900">
                Orphaned add-ons ({orphanRows.length}) — not compatible with any service
              </h2>
              <p className="mt-1 text-xs text-amber-800">
                {orphanRows.map((a) => label(a)).join(" · ")}
              </p>
            </section>
          )}
        </>
      )}

      <p className="mt-8 text-xs text-gray-400">
        <Link href="/admin" className="hover:underline">
          ← Control Center
        </Link>
      </p>
    </main>
  );
}
