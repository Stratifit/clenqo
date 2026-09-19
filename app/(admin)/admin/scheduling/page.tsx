import {
  getSchedulingConfigAction,
  listOperatingHoursAction,
  listScheduleExceptionsAction,
} from "@/features/scheduling/actions";
import { hasPermission } from "@/lib/authorization/server";
import { requireBookingPageContext } from "../pageContext";
import SchedulingConfigEditor from "./SchedulingConfigEditor";
import OperatingHoursEditor from "./OperatingHoursEditor";
import ScheduleExceptionsManager from "./ScheduleExceptionsManager";
import ServiceSchedulingRulesManager from "./ServiceSchedulingRulesManager";

export const dynamic = "force-dynamic";

/**
 * `/admin/scheduling` — scheduling configuration surface (Change 10, design
 * §6). Reads are branch-access-gated by the existing contracts; mutations
 * require `branches.edit`, which the canonical catalog grants to hq_admin
 * only (BD-E3b): HQ-Admin-only mutation UI, read-only rendering otherwise.
 * The SCHEDULING_SYSTEM role mismatch is recorded in design §6 as a deferred
 * architectural consideration — not reopened here. No All-Branches
 * aggregation: configuration is always rendered per concrete branch.
 */
export default async function AdminSchedulingPage() {
  const { ctx, branchId } = await requireBookingPageContext("branches.view");
  const canEditScheduling = hasPermission(ctx, "branches.edit");

  const [config, hours, exceptions] = await Promise.allSettled([
    getSchedulingConfigAction(branchId),
    listOperatingHoursAction(branchId),
    listScheduleExceptionsAction(branchId),
  ]);

  const configData =
    config.status === "fulfilled" && config.value.success ? config.value.data : null;
  const hoursData =
    hours.status === "fulfilled" && hours.value.success ? hours.value.data : [];
  const exceptionData =
    exceptions.status === "fulfilled" && exceptions.value.success
      ? exceptions.value.data
      : [];
  const errors = [config, hours, exceptions]
    .map((r) => (r.status === "fulfilled" && !r.value.success ? r.value.error.message : null))
    .filter(Boolean) as string[];

  return (
    <div>
      <h1 className="text-lg font-semibold">Scheduling</h1>
      <p className="mt-1 text-sm text-gray-600">
        Configuration, operating hours and schedule exceptions for branch{" "}
        <span className="font-medium">{branchId}</span>.
        {canEditScheduling
          ? " You can edit this configuration."
          : " Mutations are restricted to HQ administrators (branches.edit); this view is read-only for your role."}
      </p>

      {errors.length > 0 && (
        <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load scheduling data: {errors.join("; ")}
        </p>
      )}

      {configData && (
        <SchedulingConfigEditor
          branchId={branchId}
          canEdit={canEditScheduling}
          config={configData}
        />
      )}

      <OperatingHoursEditor branchId={branchId} canEdit={canEditScheduling} hours={hoursData} />

      <ScheduleExceptionsManager
        branchId={branchId}
        canEdit={canEditScheduling}
        exceptions={exceptionData}
      />

      {/* Service scheduling rules (S18): upsert-only contract exists; rules
          render in the catalog surface where service context is available.
          The island is mounted here for mutation access via the existing
          `upsertServiceSchedulingRuleAction`. */}
      <ServiceSchedulingRulesManager branchId={branchId} canEdit={canEditScheduling} />
    </div>
  );
}
