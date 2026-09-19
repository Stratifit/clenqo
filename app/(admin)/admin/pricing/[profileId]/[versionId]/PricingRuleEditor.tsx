"use client";

/**
 * Draft rule editor island (Change 10, design §5): rule-type-specific forms
 * over `createPricingRuleAction` with the shipped per-rule_type config schemas
 * (base_rate / duration_rule / difficulty / addon_price / surcharge /
 * minimum_charge / minimum_duration). Draft-only: the editor is disabled for
 * published/archived versions. Publish/archive call the existing lifecycle
 * actions; the UI never calculates authoritative prices.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPricingRuleAction,
  publishPricingVersionAction,
  archivePricingVersionAction,
} from "@/features/pricing/actions";

type RuleType =
  | "base_rate"
  | "duration_rule"
  | "difficulty"
  | "addon_price"
  | "surcharge"
  | "minimum_charge"
  | "minimum_duration";

const RULE_TYPES: { value: RuleType; label: string; hint: string }[] = [
  { value: "base_rate", label: "Base rate (hourly)", hint: "hourly_rate_minor in currency minor units (approved business value)." },
  { value: "duration_rule", label: "Duration rule", hint: "Declares consumed factors (base/rooms/bathrooms/floorAreaSqm/…); minutes are approved values." },
  { value: "difficulty", label: "Difficulty", hint: "level light/medium/heavy + multiplier (approved business value)." },
  { value: "addon_price", label: "Addon price", hint: "model fixed/per_unit/percentage + value; optional duration_minutes." },
  { value: "surcharge", label: "Surcharge", hint: "kind sunday/night/emergency/holiday + model percentage/fixed + value + stacking." },
  { value: "minimum_charge", label: "Minimum charge", hint: "minimum_minor in currency minor units." },
  { value: "minimum_duration", label: "Minimum duration", hint: "minimum_minutes." },
];

type ConfigForm = {
  hourly_rate_minor: string;
  consumed_factors: string[];
  base_minutes: string;
  level: "light" | "medium" | "heavy";
  multiplier: string;
  addon_model: "fixed" | "per_unit" | "percentage";
  value: string;
  kind: "sunday" | "night" | "emergency" | "holiday";
  surcharge_model: "percentage" | "fixed";
  stacking: "highest_only" | "additive";
  minimum_minor: string;
  minimum_minutes: string;
};

const EMPTY: ConfigForm = {
  hourly_rate_minor: "",
  consumed_factors: [],
  base_minutes: "",
  level: "medium",
  multiplier: "",
  addon_model: "fixed",
  value: "",
  kind: "sunday",
  surcharge_model: "percentage",
  stacking: "highest_only",
  minimum_minor: "",
  minimum_minutes: "",
};

export default function PricingRuleEditor({
  versionId,
  branchId,
  isDraft,
  canEdit,
  canPublish,
  canArchive,
  existingRules,
}: {
  versionId: string;
  branchId: string;
  isDraft: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canArchive: boolean;
  existingRules: { id: string; rule_type: string; configuration: Record<string, unknown> | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    rule_type: "base_rate" as RuleType,
    service_id: "",
    service_variant_id: "",
    service_addon_id: "",
    min_value: "",
    max_value: "",
    config: { ...EMPTY },
  });

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

  function buildConfiguration(): Record<string, unknown> {
    const c = form.config;
    switch (form.rule_type) {
      case "base_rate":
        return { model: "hourly", hourly_rate_minor: Number(c.hourly_rate_minor) };
      case "duration_rule": {
        const cfg: Record<string, unknown> = { consumed_factors: c.consumed_factors };
        if (c.base_minutes) cfg.base_minutes = Number(c.base_minutes);
        return cfg;
      }
      case "difficulty":
        return { level: c.level, multiplier: Number(c.multiplier) };
      case "addon_price": {
        const cfg: Record<string, unknown> = { model: c.addon_model, value: Number(c.value) };
        return cfg;
      }
      case "surcharge":
        return { kind: c.kind, model: c.surcharge_model, value: Number(c.value), stacking: c.stacking };
      case "minimum_charge":
        return { minimum_minor: Number(c.minimum_minor) };
      case "minimum_duration":
        return { minimum_minutes: Number(c.minimum_minutes) };
    }
  }

  const editable = isDraft && canEdit;
  const input = "mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm";
  const field = "block text-xs text-gray-600";
  const btn = "rounded bg-[#07742F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#055c24] disabled:opacity-50";

  const FACTORS = ["base", "rooms", "bathrooms", "floorAreaSqm", "condition"];

  return (
    <section className="mt-6 space-y-4 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-700">Rules</h2>
      {message && (
        <p role="status" className={`text-xs ${message.kind === "ok" ? "text-green-800" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      {existingRules.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-600">
          {existingRules.map((r) => (
            <li key={r.id}>
              <span className="font-mono">{r.rule_type}</span>{" "}
              {r.configuration ? `— ${Object.entries(r.configuration).slice(0, 3).map(([k, v]) => `${k}=${String(v)}`).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      )}

      <div className="max-w-xl">
        <h3 className="text-xs font-semibold">Add rule {editable ? "" : "(read-only — draft versions only)"}</h3>
        <label htmlFor="pr-type" className={field}>Rule type</label>
        <select
          id="pr-type"
          value={form.rule_type}
          disabled={!editable}
          onChange={(e) => setForm({ ...form, rule_type: e.target.value as RuleType, config: { ...EMPTY } })}
          className={input}
        >
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">{RULE_TYPES.find((t) => t.value === form.rule_type)?.hint}</p>

        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div>
            <label htmlFor="pr-service" className={field}>Service ID (optional)</label>
            <input id="pr-service" value={form.service_id} disabled={!editable} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className={input} />
          </div>
          <div>
            <label htmlFor="pr-variant" className={field}>Variant ID (requires service)</label>
            <input id="pr-variant" value={form.service_variant_id} disabled={!editable || !form.service_id} onChange={(e) => setForm({ ...form, service_variant_id: e.target.value })} className={input} />
          </div>
          <div>
            <label htmlFor="pr-addon" className={field}>Addon ID</label>
            <input id="pr-addon" value={form.service_addon_id} disabled={!editable} onChange={(e) => setForm({ ...form, service_addon_id: e.target.value })} className={input} />
          </div>
        </div>

        <div className="mt-2 space-y-2">
          {form.rule_type === "base_rate" && (
            <div>
              <label htmlFor="pr-rate" className={field}>Hourly rate (minor units) *</label>
              <input id="pr-rate" type="number" min={0} value={form.config.hourly_rate_minor} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, hourly_rate_minor: e.target.value } })} className={input} />
            </div>
          )}
          {form.rule_type === "duration_rule" && (
            <div>
              <span className={field}>Consumed factors *</span>
              <div className="mt-1 flex flex-wrap gap-3">
                {FACTORS.map((f) => (
                  <label key={f} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={form.config.consumed_factors.includes(f)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.config.consumed_factors, f]
                          : form.config.consumed_factors.filter((x) => x !== f);
                        setForm({ ...form, config: { ...form.config, consumed_factors: next } });
                      }}
                    />
                    {f}
                  </label>
                ))}
              </div>
              <label htmlFor="pr-base-min" className={field}>Base minutes (optional approved value)</label>
              <input id="pr-base-min" type="number" min={0} value={form.config.base_minutes} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, base_minutes: e.target.value } })} className={input} />
            </div>
          )}
          {form.rule_type === "difficulty" && (
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label htmlFor="pr-level" className={field}>Level</label>
                <select id="pr-level" value={form.config.level} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, level: e.target.value as ConfigForm["level"] } })} className={input}>
                  <option value="light">light</option>
                  <option value="medium">medium</option>
                  <option value="heavy">heavy</option>
                </select>
              </div>
              <div>
                <label htmlFor="pr-mult" className={field}>Multiplier *</label>
                <input id="pr-mult" type="number" min={0} step="0.01" value={form.config.multiplier} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, multiplier: e.target.value } })} className={input} />
              </div>
            </div>
          )}
          {(form.rule_type === "addon_price" || form.rule_type === "surcharge") && (
            <div className="grid gap-2 md:grid-cols-3">
              {form.rule_type === "addon_price" ? (
                <div>
                  <label htmlFor="pr-amodel" className={field}>Model</label>
                  <select id="pr-amodel" value={form.config.addon_model} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, addon_model: e.target.value as ConfigForm["addon_model"] } })} className={input}>
                    <option value="fixed">fixed</option>
                    <option value="per_unit">per_unit</option>
                    <option value="percentage">percentage</option>
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="pr-kind" className={field}>Kind</label>
                    <select id="pr-kind" value={form.config.kind} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, kind: e.target.value as ConfigForm["kind"] } })} className={input}>
                      <option value="sunday">sunday</option>
                      <option value="night">night</option>
                      <option value="emergency">emergency</option>
                      <option value="holiday">holiday</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pr-smodel" className={field}>Model</label>
                    <select id="pr-smodel" value={form.config.surcharge_model} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, surcharge_model: e.target.value as ConfigForm["surcharge_model"] } })} className={input}>
                      <option value="percentage">percentage</option>
                      <option value="fixed">fixed</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pr-stacking" className={field}>Stacking</label>
                    <select id="pr-stacking" value={form.config.stacking} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, stacking: e.target.value as ConfigForm["stacking"] } })} className={input}>
                      <option value="highest_only">highest_only</option>
                      <option value="additive">additive</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label htmlFor="pr-value" className={field}>Value *</label>
                <input id="pr-value" type="number" min={0} step="0.01" value={form.config.value} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, value: e.target.value } })} className={input} />
              </div>
            </div>
          )}
          {form.rule_type === "minimum_charge" && (
            <div>
              <label htmlFor="pr-minchg" className={field}>Minimum (minor units) *</label>
              <input id="pr-minchg" type="number" min={0} value={form.config.minimum_minor} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, minimum_minor: e.target.value } })} className={input} />
            </div>
          )}
          {form.rule_type === "minimum_duration" && (
            <div>
              <label htmlFor="pr-mindur" className={field}>Minimum minutes *</label>
              <input id="pr-mindur" type="number" min={0} value={form.config.minimum_minutes} disabled={!editable} onChange={(e) => setForm({ ...form, config: { ...form.config, minimum_minutes: e.target.value } })} className={input} />
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={!editable || busy}
          onClick={() =>
            run(
              () =>
                createPricingRuleAction({
                  version_id: versionId,
                  rule_type: form.rule_type,
                  ...(form.service_id ? { service_id: form.service_id } : {}),
                  ...(form.service_variant_id ? { service_variant_id: form.service_variant_id } : {}),
                  ...(form.service_addon_id ? { service_addon_id: form.service_addon_id } : {}),
                  ...(form.min_value ? { min_value: Number(form.min_value) } : {}),
                  ...(form.max_value ? { max_value: Number(form.max_value) } : {}),
                  configuration: buildConfiguration(),
                  branch_id: branchId,
                }),
              "Rule created.",
            )
          }
          className={`${btn} mt-3`}
        >
          Create rule
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-3">
        {isDraft && canPublish && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => publishPricingVersionAction({ version_id: versionId, branch_id: branchId }),
                "Version published (server-side validation applied).",
              )
            }
            className={btn}
          >
            Publish version
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => archivePricingVersionAction({ version_id: versionId }), "Version archived.")}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Archive version
          </button>
        )}
      </div>
    </section>
  );
}
