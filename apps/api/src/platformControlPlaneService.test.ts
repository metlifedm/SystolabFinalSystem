import { describe, expect, it } from "vitest";
import {
  enqueuePlatformJob,
  evaluateFeatureFlag,
  listApiGovernanceRecords,
  listPlatformModules,
  listWarehouseRecords,
  materializeAnalyticsWarehouse,
  recordApiGovernanceUsage,
  runDuePlatformJobs,
  runSandboxExperiment,
  validatePlatformModules
} from "./services/platformControlPlaneService.js";

describe("SYSTOLAB platform control plane", () => {
  it("registers modules, validates dependencies, runs jobs, and records governance outputs", async () => {
    const modules = await listPlatformModules();
    expect(modules.length).toBeGreaterThanOrEqual(20);
    expect(modules.some((item) => item.moduleId === "module-registry")).toBe(true);
    expect(modules.some((item) => item.moduleId === "intelligence-sandbox")).toBe(true);

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
});
