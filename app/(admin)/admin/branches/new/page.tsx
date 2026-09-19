"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createBranchAction } from "@/features/branches/actions";
import { SUPPORTED_LOCALES } from "@/features/branches/schemas/create-branch";

export default function NewBranchPage() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setMessage(null);
    setFieldErrors({});
    const payload = {
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      country_code: String(formData.get("country_code") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
      currency: String(formData.get("currency") ?? ""),
      default_locale: String(formData.get("default_locale") ?? ""),
      enabled_locales: formData.getAll("enabled_locales").map(String),
    };
    startTransition(async () => {
      const result = await createBranchAction(payload);
      if (result.success) {
        setCreatedSlug(result.data.branch.slug);
        setMessage(
          result.data.created
            ? "Branch created and provisioned."
            : "Existing branch returned (idempotent request).",
        );
      } else {
        setMessage(`${result.error.code}: ${result.error.message}`);
        setFieldErrors(result.error.fieldErrors ?? {});
      }
    });
  }

  if (createdSlug) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
          <p className="font-medium text-green-800">
            Provisioning succeeded — branch is ready.
          </p>
          <p className="mt-1 text-sm text-green-700">Slug: /{createdSlug}</p>
        </div>
        <Link
          href="/admin/branches"
          className="mt-6 inline-flex rounded-lg bg-[#07742F] px-4 py-2 text-sm font-medium text-white"
        >
          Back to branches
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">Create branch</h1>
      <p className="mt-1 text-sm text-gray-500">
        Provisioning runs automatically after creation. Creating a branch does
        not activate it.
      </p>

      <form action={onSubmit} className="mt-8 space-y-4">
        <Field label="Name" name="name" placeholder="Berlin" error={fieldErrors["name"]} required />
        <Field
          label="Slug"
          name="slug"
          placeholder="berlin"
          error={fieldErrors["slug"]}
          hint="lowercase, URL-safe, unique within the organization"
          required
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country code" name="country_code" placeholder="DE" error={fieldErrors["country_code"]} required />
          <Field label="Currency" name="currency" placeholder="EUR" error={fieldErrors["currency"]} required />
        </div>
        <Field
          label="Timezone (IANA)"
          name="timezone"
          placeholder="Europe/Berlin"
          error={fieldErrors["timezone"]}
          required
        />

        <div>
          <label className="block text-sm font-medium">Default locale</label>
          <select
            name="default_locale"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {fieldErrors["default_locale"] && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors["default_locale"].join(", ")}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium">Enabled locales</span>
          <div className="mt-2 flex gap-4">
            {SUPPORTED_LOCALES.map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="enabled_locales"
                  value={l}
                  defaultChecked={l === "de"}
                  className="h-4 w-4"
                />
                {l}
              </label>
            ))}
          </div>
          {fieldErrors["enabled_locales"] && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors["enabled_locales"].join(", ")}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone (optional)" name="phone" error={fieldErrors["contact.phone"]} />
          <Field label="Email (optional)" name="email" type="email" error={fieldErrors["contact.email"]} />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[#07742F] px-4 py-2.5 font-medium text-white hover:bg-[#055c24] disabled:opacity-50"
        >
          {pending ? "Provisioning…" : "Create branch"}
        </button>

        {message && !pending && (
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">{message}</p>
        )}
      </form>
    </main>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  error?: string[];
  hint?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error.join(", ")}</p>}
    </div>
  );
}
