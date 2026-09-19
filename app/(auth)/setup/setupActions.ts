"use server";

/**
 * Setup server action (BD-A1, design §6): thin wrapper — invariant, token
 * compare, and transactional bootstrap live in features/admin/auth.ts.
 * Failure reasons are enumeration-stable and audited server-side.
 */
import { redirect } from "next/navigation";
import { getAuthenticatedUserId } from "@/lib/session/server";
import { performSetup } from "@/features/admin/auth";
import { AppError, toAppError } from "@/lib/errors";

export async function performSetupAction(formData: FormData): Promise<void> {
  const userId = await getAuthenticatedUserId();
  const setupToken = String(formData.get("setup_token") ?? "");
  const organizationName = String(formData.get("organization_name") ?? "").trim();

  try {
    await performSetup({ setupToken, userId, organizationName });
  } catch (err) {
    const appErr: AppError = toAppError(err);
    const reason =
      appErr.message.includes("disabled after bootstrap") ? "already_bootstrapped" : "invalid_token";
    redirect(`/setup?error=${reason}`);
  }
  redirect("/admin");
}
