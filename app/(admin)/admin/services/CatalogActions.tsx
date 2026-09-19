"use client";

/**
 * Catalog mutations client island (Change 10, design §4): create/edit,
 * lifecycle (`changeStatusAction`), offering toggle (`setOfferingStateAction`),
 * ordering (`reorderCatalogAction`), add-on compatibility
 * (`setAddonCompatibilityAction` / `removeAddonCompatibilityAction`), and
 * published-slug rename (`renamePublishedSlugAction`). The UI implements NO
 * domain rules — every mutation calls the existing server action and renders
 * the authoritative result/error verbatim. No translation editing (BD-E3d);
 * no seed tools (BD-E3e); no pricing/duration logic.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCategoryAction,
  updateCategoryAction,
  createServiceAction,
  updateServiceAction,
  createVariantAction,
  updateVariantAction,
  createAddonAction,
  updateAddonAction,
  changeStatusAction,
  setOfferingStateAction,
  reorderCatalogAction,
  setAddonCompatibilityAction,
  removeAddonCompatibilityAction,
  renamePublishedSlugAction,
} from "@/features/services/actions";

type Opt = { id: string; name: string };
type EntityType = "service_category" | "service" | "service_variant" | "service_addon";

export default function CatalogActions({
  branchId,
  canEdit,
  categories,
  services,
  addons,
}: {
  branchId: string;
  canEdit: boolean;
  categories: Opt[];
  services: Opt[];
  addons: Opt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Create forms (one section per entity type; minimal draft fields).
  const [newCat, setNewCat] = useState({ slug: "", name: "", locale: "de" });
  const [newSvc, setNewSvc] = useState({ categoryId: "", slug: "", name: "", locale: "de" });
  const [newVar, setNewVar] = useState({ serviceId: "", slug: "", name: "", locale: "de" });
  const [newAdd, setNewAdd] = useState({ slug: "", name: "", min_quantity: "", max_quantity: "", locale: "de" });

  // Management inputs.
  const [entityId, setEntityId] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("service");
  const [updateName, setUpdateName] = useState("");
  const [updateDescription, setUpdateDescription] = useState("");
  const [newStatus, setNewStatus] = useState("active");
  const [renameSlug, setRenameSlug] = useState("");
  const [reorderEntityType, setReorderEntityType] = useState<EntityType>("service");
  const [orderedIds, setOrderedIds] = useState("");
  const [compat, setCompat] = useState({ addonId: "", serviceId: "", variantId: "" });
  const [removeCompatId, setRemoveCompatId] = useState("");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = (await fn()) as { success: boolean; error?: { message: string } };
      if (res.success) {
        setMessage({ kind: "ok", text: ok });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error?.message ?? "Request failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  const translations = (locale: string, name: string) => [{ locale, name }];

  if (!canEdit) return null;

  const input = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm";
  const field = "block text-xs text-gray-600";
  const btn = "rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50";

  return (
    <section className="mt-6 space-y-4 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Catalog management</h2>
      {message && (
        <p role="status" className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      <details className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-gray-700">Create entities</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold">Category</h3>
            <label htmlFor="nc-slug" className={field}>Slug</label>
            <input id="nc-slug" value={newCat.slug} onChange={(e) => setNewCat({ ...newCat, slug: e.target.value })} className={input} />
            <label htmlFor="nc-name" className={field}>Name *</label>
            <input id="nc-name" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} className={input} />
            <label htmlFor="nc-loc" className={field}>Default locale</label>
            <input id="nc-loc" value={newCat.locale} onChange={(e) => setNewCat({ ...newCat, locale: e.target.value })} className={input} />
            <button
              type="button"
              disabled={busy || !newCat.slug || !newCat.name}
              onClick={() =>
                run(
                  () =>
                    createCategoryAction({
                      branchId,
                      slug: newCat.slug,
                      name: newCat.name,
                      translations: translations(newCat.locale, newCat.name),
                    }),
                  "Category created (draft).",
                )
              }
              className={`${btn} mt-2`}
            >
              Create category
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Service</h3>
            <label htmlFor="ns-cat" className={field}>Category *</label>
            <select id="ns-cat" value={newSvc.categoryId} onChange={(e) => setNewSvc({ ...newSvc, categoryId: e.target.value })} className={input}>
              <option value="">— select —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label htmlFor="ns-slug" className={field}>Slug</label>
            <input id="ns-slug" value={newSvc.slug} onChange={(e) => setNewSvc({ ...newSvc, slug: e.target.value })} className={input} />
            <label htmlFor="ns-name" className={field}>Name *</label>
            <input id="ns-name" value={newSvc.name} onChange={(e) => setNewSvc({ ...newSvc, name: e.target.value })} className={input} />
            <button
              type="button"
              disabled={busy || !newSvc.categoryId || !newSvc.slug || !newSvc.name}
              onClick={() =>
                run(
                  () =>
                    createServiceAction({
                      branchId,
                      categoryId: newSvc.categoryId,
                      slug: newSvc.slug,
                      name: newSvc.name,
                      translations: translations(newSvc.locale, newSvc.name),
                    }),
                  "Service created (draft).",
                )
              }
              className={`${btn} mt-2`}
            >
              Create service
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Variant</h3>
            <label htmlFor="nv-svc" className={field}>Service *</label>
            <select id="nv-svc" value={newVar.serviceId} onChange={(e) => setNewVar({ ...newVar, serviceId: e.target.value })} className={input}>
              <option value="">— select —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <label htmlFor="nv-slug" className={field}>Slug</label>
            <input id="nv-slug" value={newVar.slug} onChange={(e) => setNewVar({ ...newVar, slug: e.target.value })} className={input} />
            <label htmlFor="nv-name" className={field}>Name *</label>
            <input id="nv-name" value={newVar.name} onChange={(e) => setNewVar({ ...newVar, name: e.target.value })} className={input} />
            <button
              type="button"
              disabled={busy || !newVar.serviceId || !newVar.slug || !newVar.name}
              onClick={() =>
                run(
                  () =>
                    createVariantAction({
                      branchId,
                      serviceId: newVar.serviceId,
                      slug: newVar.slug,
                      name: newVar.name,
                      translations: translations(newVar.locale, newVar.name),
                    }),
                  "Variant created (draft).",
                )
              }
              className={`${btn} mt-2`}
            >
              Create variant
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Add-on</h3>
            <label htmlFor="na-slug" className={field}>Slug</label>
            <input id="na-slug" value={newAdd.slug} onChange={(e) => setNewAdd({ ...newAdd, slug: e.target.value })} className={input} />
            <label htmlFor="na-name" className={field}>Name *</label>
            <input id="na-name" value={newAdd.name} onChange={(e) => setNewAdd({ ...newAdd, name: e.target.value })} className={input} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="na-min" className={field}>Min qty</label>
                <input id="na-min" type="number" min={1} value={newAdd.min_quantity} onChange={(e) => setNewAdd({ ...newAdd, min_quantity: e.target.value })} className={input} />
              </div>
              <div>
                <label htmlFor="na-max" className={field}>Max qty</label>
                <input id="na-max" type="number" min={1} value={newAdd.max_quantity} onChange={(e) => setNewAdd({ ...newAdd, max_quantity: e.target.value })} className={input} />
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !newAdd.slug || !newAdd.name}
              onClick={() =>
                run(
                  () =>
                    createAddonAction({
                      branchId,
                      slug: newAdd.slug,
                      name: newAdd.name,
                      ...(newAdd.min_quantity ? { min_quantity: Number(newAdd.min_quantity) } : {}),
                      ...(newAdd.max_quantity ? { max_quantity: Number(newAdd.max_quantity) } : {}),
                      translations: translations(newAdd.locale, newAdd.name),
                    }),
                  "Add-on created (draft).",
                )
              }
              className={`${btn} mt-2`}
            >
              Create add-on
            </button>
          </div>
        </div>
      </details>

      <details className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-gray-700">Lifecycle · offering · ordering · slug rename</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold">Update entity (draft fields)</h3>
            <label htmlFor="up-type" className={field}>Entity type</label>
            <select id="up-type" value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} className={input}>
              <option value="service_category">category</option>
              <option value="service">service</option>
              <option value="service_variant">variant</option>
              <option value="service_addon">addon</option>
            </select>
            <label htmlFor="up-id" className={field}>Entity ID</label>
            <input id="up-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={input} />
            <label htmlFor="up-name" className={field}>Name (creates/updates default-locale translation)</label>
            <input id="up-name" value={updateName} onChange={(e) => setUpdateName(e.target.value)} className={input} />
            <label htmlFor="up-desc" className={field}>Description</label>
            <input id="up-desc" value={updateDescription} onChange={(e) => setUpdateDescription(e.target.value)} className={input} />
            <button
              type="button"
              disabled={busy || !entityId || (!updateName && !updateDescription)}
              onClick={() => {
                const namePatch = updateName
                  ? { name: updateName, translations: translations("de", updateName) }
                  : {};
                const descPatch = updateDescription ? { description: updateDescription } : {};
                if (entityType === "service_category") {
                  void run(
                    () => updateCategoryAction({ branchId, categoryId: entityId, ...namePatch, ...descPatch }),
                    "Category updated.",
                  );
                } else if (entityType === "service") {
                  void run(
                    () => updateServiceAction({ branchId, serviceId: entityId, ...namePatch, ...descPatch }),
                    "Service updated.",
                  );
                } else if (entityType === "service_variant") {
                  void run(
                    () => updateVariantAction({ branchId, variantId: entityId, ...namePatch, ...descPatch }),
                    "Variant updated.",
                  );
                } else {
                  void run(
                    () =>
                      updateAddonAction({
                        branchId,
                        addonId: entityId,
                        ...namePatch,
                        ...descPatch,
                      }),
                    "Add-on updated.",
                  );
                }
              }}
              className={`${btn} mt-2`}
            >
              Update entity
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Lifecycle status</h3>
            <label htmlFor="ls-type" className={field}>Entity type</label>
            <select id="ls-type" value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} className={input}>
              <option value="service_category">category</option>
              <option value="service">service</option>
              <option value="service_variant">variant</option>
              <option value="service_addon">addon</option>
            </select>
            <label htmlFor="ls-id" className={field}>Entity ID</label>
            <input id="ls-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={input} />
            <label htmlFor="ls-status" className={field}>New status</label>
            <select id="ls-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className={input}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="archived">archived</option>
            </select>
            <button
              type="button"
              disabled={busy || !entityId}
              onClick={() =>
                run(
                  () =>
                    changeStatusAction({ branchId, entityType, entityId, status: newStatus }),
                  `Status set to ${newStatus}.`,
                )
              }
              className={`${btn} mt-2`}
            >
              Set status
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Offering state (separate from status)</h3>
            <label htmlFor="of-type" className={field}>Entity type</label>
            <select
              id="of-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              className={input}
            >
              <option value="service_category">category</option>
              <option value="service">service</option>
              <option value="service_variant">variant</option>
              <option value="service_addon">addon</option>
            </select>
            <label htmlFor="of-id" className={field}>Entity ID (same field as above)</label>
            <input value={entityId} readOnly className={`${input} bg-gray-50`} />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy || !entityId}
                onClick={() =>
                  run(
                    () =>
                      setOfferingStateAction({ branchId, entityType, entityId, is_enabled: true }),
                    "Offering enabled.",
                  )
                }
                className={btn}
              >
                Enable
              </button>
              <button
                type="button"
                disabled={busy || !entityId}
                onClick={() =>
                  run(
                    () =>
                      setOfferingStateAction({ branchId, entityType, entityId, is_enabled: false }),
                    "Offering disabled.",
                  )
                }
                className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Reorder</h3>
            <label htmlFor="ro-type" className={field}>Entity type</label>
            <select id="ro-type" value={reorderEntityType} onChange={(e) => setReorderEntityType(e.target.value as EntityType)} className={input}>
              <option value="service_category">category</option>
              <option value="service">service</option>
              <option value="service_variant">variant</option>
              <option value="service_addon">addon</option>
            </select>
            <label htmlFor="ro-ids" className={field}>Ordered IDs (comma-separated, in desired order)</label>
            <textarea id="ro-ids" rows={2} value={orderedIds} onChange={(e) => setOrderedIds(e.target.value)} className={input} />
            <button
              type="button"
              disabled={busy || !orderedIds.trim()}
              onClick={() =>
                run(
                  () =>
                    reorderCatalogAction({
                      branchId,
                      entityType: reorderEntityType,
                      orderedIds: orderedIds.split(",").map((s) => s.trim()).filter(Boolean),
                    }),
                  "Order updated.",
                )
              }
              className={`${btn} mt-2`}
            >
              Apply order
            </button>
          </div>

          <div>
            <h3 className="text-xs font-semibold">Published slug rename</h3>
            <p className="text-xs text-gray-400">Entity type/ID shared with lifecycle above (service/variant/addon only).</p>
            <label htmlFor="rs-slug" className={field}>New slug</label>
            <input id="rs-slug" value={renameSlug} onChange={(e) => setRenameSlug(e.target.value)} className={input} />
            <button
              type="button"
              disabled={busy || !entityId || !renameSlug || entityType === "service_category"}
              onClick={() =>
                run(
                  () =>
                    renamePublishedSlugAction({ branchId, entityType, entityId, newSlug: renameSlug }),
                  "Slug renamed.",
                )
              }
              className={`${btn} mt-2`}
            >
              Rename slug
            </button>
          </div>
        </div>
      </details>

      <details className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-gray-700">Add-on compatibility</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold">Set compatibility</h3>
            <label htmlFor="cp-add" className={field}>Add-on *</label>
            <select id="cp-add" value={compat.addonId} onChange={(e) => setCompat({ ...compat, addonId: e.target.value })} className={input}>
              <option value="">— select —</option>
              {addons.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <label htmlFor="cp-svc" className={field}>Service *</label>
            <select id="cp-svc" value={compat.serviceId} onChange={(e) => setCompat({ ...compat, serviceId: e.target.value })} className={input}>
              <option value="">— select —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !compat.addonId || !compat.serviceId}
              onClick={() =>
                run(
                  () =>
                    setAddonCompatibilityAction({
                      branchId,
                      addonId: compat.addonId,
                      serviceId: compat.serviceId,
                      ...(compat.variantId ? { variantId: compat.variantId } : {}),
                    }),
                  "Compatibility set.",
                )
              }
              className={`${btn} mt-2`}
            >
              Set compatibility
            </button>
          </div>
          <div>
            <h3 className="text-xs font-semibold">Remove compatibility</h3>
            <label htmlFor="cp-rem" className={field}>Compatibility ID</label>
            <input id="cp-rem" value={removeCompatId} onChange={(e) => setRemoveCompatId(e.target.value)} className={input} />
            <button
              type="button"
              disabled={busy || !removeCompatId}
              onClick={() =>
                run(
                  () =>
                    removeAddonCompatibilityAction({ branchId, compatibilityId: removeCompatId }),
                  "Compatibility removed.",
                )
              }
              className={`${btn} mt-2`}
            >
              Remove
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
