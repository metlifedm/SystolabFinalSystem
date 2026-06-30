import { describe, expect, it } from "vitest";
import { visualStateForScore } from "@systolab/shared";
import { specCoverage } from "./specCoverage.js";

describe("SYSTOLAB governance rules", () => {
  it("assigns an allowed status to every specification coverage item", () => {
    const allowed = new Set(["Implemented", "Partially Implemented", "Planned", "Deprecated"]);
    expect(specCoverage.length).toBeGreaterThan(0);
    for (const item of specCoverage) {
      expect(allowed.has(item.status)).toBe(true);
    }
  });

  it("keeps the canonical Visual Intelligence Framework ranges stable", () => {
    expect(visualStateForScore(0).label).toBe("Signal Red");
    expect(visualStateForScore(40).label).toBe("Attention Amber");
    expect(visualStateForScore(60).label).toBe("Visibility Gold");
    expect(visualStateForScore(75).label).toBe("Stability Green");
    expect(visualStateForScore(90).label).toBe("Assurance Emerald");
    expect(visualStateForScore(95).label).toBe("Integrity Sapphire");
  });

  it("tracks the implemented moat systems in the specification registry", () => {
    const ids = new Set(specCoverage.map((item) => item.id));
    expect(ids.has("SYSTOLAB-OUTCOME-LOOP-001")).toBe(true);
    expect(ids.has("SYSTOLAB-MONITOR-001")).toBe(true);
    expect(ids.has("SYSTOLAB-ALERT-001")).toBe(true);
    expect(ids.has("SYSTOLAB-EDIT-001")).toBe(true);
    expect(ids.has("SYSTOLAB-MODULE-REGISTRY-001")).toBe(true);
    expect(ids.has("SYSTOLAB-JOBS-001")).toBe(true);
    expect(ids.has("SYSTOLAB-WAREHOUSE-001")).toBe(true);
    expect(ids.has("SYSTOLAB-API-GOVERNANCE-001")).toBe(true);
    expect(ids.has("SYSTOLAB-FEATURE-FLAGS-001")).toBe(true);
    expect(ids.has("SYSTOLAB-SANDBOX-001")).toBe(true);
    expect(ids.has("SYSTOLAB-ADMIN-DASHBOARD-001")).toBe(true);
    expect(ids.has("SYSTOLAB-ADMIN-RBAC-001")).toBe(true);
    expect(ids.has("SYSTOLAB-ADMIN-PDF-001")).toBe(true);
    expect(ids.has("SYSTOLAB-ADMIN-USER-INTEL-001")).toBe(true);
    expect(ids.has("SYSTOLAB-CANONICAL-ISSUE-001")).toBe(true);
    expect(ids.has("SYSTOLAB-OUTCOME-ATTRIBUTION-001")).toBe(true);
  });
});
