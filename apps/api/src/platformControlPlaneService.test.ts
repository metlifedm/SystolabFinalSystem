import { describe, expect, it } from "vitest";
import {
  enqueuePlatformJob,
  evaluateFeatureFlag,
  evaluateManagedWhiteLabelAccess,
  getManagedWhiteLabelGovernance,
  listApiGovernanceRecords,
  listManagedWhiteLabelWorkspaces,
  listPlatformModules,
  listWarehouseRecords,
  materializeAnalyticsWarehouse,
  recordApiGovernanceUsage,
  runDuePlatformJobs,
  runSandboxExperiment,
  upsertManagedWhiteLabelWorkspace,
  validatePlatformModules
} from "./services/platformControlPlaneService.js";

describe("SYSTOLAB platform control plane", () => {
  it("registers modules, validates dependencies, runs jobs, and records governance outputs", async () => {
    const modules = await listPlatformModules();
    expect(modules.length).toBeGreaterThanOrEqual(20);
    expect(modules.some((item) => item.moduleId === "module-registry")).toBe(true);
    expect(modules.some((item) => item.moduleId === "intelligence-sandbox")).toBe(true);
    expect(modules.some((item) => item.moduleId === "managed-white-label-control")).toBe(true);

    const validation = await validatePlatformModules();
    expect(validation.failures).toHaveLength(0);

    const job = await enqueuePlatformJob({ jobType: "warehouse.materialize", queue: "analytics", payload: { reason: "test" } });
    expect(job.status).toBe("queued");
    const run = await runDuePlatformJobs();
    expect(run.completed).toContain(job.jobId);

    const warehouseRecord = await materializeAnalyticsWarehouse({ grain: "daily" });
    expect(warehouseRecord.metrics.scans).toBeDefined();
    expect((await listWarehouseRecords()).length).toBeGreaterThan(0);

    const flag = await evaluateFeatureFlag("distributed_jobs.enabled", { workspaceId: "ws_test" });
    expect(flag.enabled).toBe(true);
    const whiteLabelFlag = await evaluateFeatureFlag("managed_white_label.enabled", { workspaceId: "ws_test" });
    expect(whiteLabelFlag.enabled).toBe(true);

    const sandbox = await runSandboxExperiment({ experimentName: "oss-shadow-test", sampleSize: 3 });
    expect(sandbox.controlType).toBe("sandbox");

    await recordApiGovernanceUsage({
      tenantSlug: "systolab",
      method: "GET",
      path: "/v1/snapshots/test",
      statusCode: 200,
      keyHashPrefix: "abc123"
    });
    expect((await listApiGovernanceRecords()).some((item) => item.recordType === "usage_audit")).toBe(true);
  });

  it("keeps white-label branding managed under SYSTOLAB platform ownership", async () => {
    const workspace = await upsertManagedWhiteLabelWorkspace({
      tenantSlug: "Partner Studio",
      workspaceName: "Partner Studio",
      enabledFeatures: ["business_decision_reports", "competitor_intelligence"],
      branding: { companyName: "Partner Studio", primaryColor: "#214f4b" }
    }, "owner_test");

    expect(workspace.tenantSlug).toBe("partner-studio");
    expect(workspace.approval.platformOwner).toBe("SYSTOLAB");
    expect(workspace.advancedEvidenceEnabled).toBe(false);
    expect(workspace.permissions).toMatchObject({ deniedForNonOwners: expect.arrayContaining(["modify_ai_models", "alter_scoring", "change_report_logic"]) });

    const governance = await getManagedWhiteLabelGovernance();
    expect(governance.platformOwner).toBe("SYSTOLAB");
    expect(governance.ownershipModel).toBe("managed_white_label");
    expect((governance.managedWorkspaces as unknown[]).length).toBeGreaterThan(0);

    const partnerDenied = await evaluateManagedWhiteLabelAccess({
      workspaceId: workspace.workspaceId,
      role: "partner",
      requestedPermission: "modify_ai_models"
    });
    expect(partnerDenied.platformOwner).toBe(false);
    expect(partnerDenied.allowed).toBe(false);

    const clientAllowed = await evaluateManagedWhiteLabelAccess({
      workspaceId: workspace.workspaceId,
      role: "client",
      requestedPermission: "view_reports",
      requestedFeature: "business_decision_reports"
    });
    expect(clientAllowed.allowed).toBe(true);
    expect(clientAllowed.unrestrictedControl).toBe(false);

    const ownerAllowed = await evaluateManagedWhiteLabelAccess({
      workspaceId: workspace.workspaceId,
      role: "super_admin",
      requestedPermission: "modify_ai_models"
    });
    expect(ownerAllowed.platformOwner).toBe(true);
    expect(ownerAllowed.allowed).toBe(true);

    expect((await listManagedWhiteLabelWorkspaces()).some((item) => item.workspaceId === workspace.workspaceId)).toBe(true);
  });
});
