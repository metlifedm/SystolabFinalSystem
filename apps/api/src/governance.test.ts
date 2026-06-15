import { describe, expect, it } from "vitest";
import { makeId, sha256, stableStringify } from "./utils/crypto.js";
import {
  findHeldIds,
  getHold,
  isHeld,
  listHolds,
  placeHold,
  releaseHold
} from "./services/legalHoldService.js";
import {
  getQuarantineRecord,
  getQuarantineSummary,
  listQuarantined,
  quarantinePayload,
  resolveQuarantine
} from "./services/quarantineService.js";
import {
  checkBenchmarkQuality,
  checkScanPayloadQuality,
  getDataQualitySummary
} from "./services/dataQualityService.js";
import type { ReportSnapshot } from "@systolab/shared";

// ── Legal hold tests ───────────────────────────────────────────────────────────

describe("legal holds — placement and release", () => {
  it("placeHold creates a hold record and isHeld returns true", async () => {
    const workspaceId = makeId("ws");
    const hold = await placeHold({
      scope: "workspace",
      targetId: workspaceId,
      reason: "Litigation hold — financial audit 2026",
      createdBy: makeId("usr")
    });

    expect(hold.holdId).toBeTruthy();
    expect(hold.scope).toBe("workspace");
    expect(hold.targetId).toBe(workspaceId);

    const held = await isHeld("workspace", workspaceId);
    expect(held).toBe(true);
  });

  it("isHeld returns false for a target that has no hold", async () => {
    const held = await isHeld("workspace", makeId("ws"));
    expect(held).toBe(false);
  });

  it("releaseHold removes the hold and isHeld returns false afterwards", async () => {
    const targetId = makeId("ws");
    const hold = await placeHold({
      scope: "workspace",
      targetId,
      reason: "Test hold",
      createdBy: makeId("usr")
    });

    await releaseHold(hold.holdId);
    const held = await isHeld("workspace", targetId);
    expect(held).toBe(false);
  });

  it("placeHold is idempotent — placing the same hold twice returns the same holdId", async () => {
    const targetId = makeId("ws");
    const input = { scope: "workspace" as const, targetId, reason: "Duplicate test", createdBy: makeId("usr") };
    const h1 = await placeHold(input);
    const h2 = await placeHold(input);
    expect(h1.holdId).toBe(h2.holdId);
  });

  it("listHolds returns holds filtered by scope", async () => {
    const tenantSlug = `hold-list-${makeId("t").slice(2, 8)}`;
    await placeHold({ scope: "tenant", targetId: tenantSlug, reason: "GDPR hold", createdBy: makeId("usr") });
    const holds = await listHolds({ scope: "tenant" });
    expect(holds.some((h) => h.scope === "tenant" && h.targetId === tenantSlug)).toBe(true);
  });

  it("findHeldIds filters out IDs that have active holds from a candidate list", async () => {
    const held1 = makeId("ws");
    const held2 = makeId("ws");
    const free1 = makeId("ws");

    await placeHold({ scope: "workspace", targetId: held1, reason: "Hold 1", createdBy: makeId("usr") });
    await placeHold({ scope: "workspace", targetId: held2, reason: "Hold 2", createdBy: makeId("usr") });

    const result = await findHeldIds("workspace", [
      { targetId: held1 },
      { targetId: held2 },
      { targetId: free1 }
    ]);
    expect(result.has(held1)).toBe(true);
    expect(result.has(held2)).toBe(true);
    expect(result.has(free1)).toBe(false);
  });
});

// ── Quarantine tests ───────────────────────────────────────────────────────────

describe("quarantine — malformed payload handling", () => {
  it("quarantinePayload stores the record and payloadHash is sha256 of the payload", async () => {
    const payload = { bad: "data", missing: null, nested: { broken: true } };
    const record = await quarantinePayload({
      quarantineType: "malformed_payload",
      sourceRoute: "test-suite",
      sourceModel: "ScanResult",
      payload,
      reason: "Schema validation failed"
    });

    expect(record.quarantineId).toBeTruthy();
    expect(record.payloadHash).toBe(sha256(stableStringify(payload)).slice(0, 32));
    expect(record.resolution).toBe("pending");
  });

  it("same payload stored twice produces records with identical payloadHash", async () => {
    const payload = { duplicate: true };
    const r1 = await quarantinePayload({ quarantineType: "malformed_payload", sourceRoute: "test-suite", payload, reason: "Dup test" });
    const r2 = await quarantinePayload({ quarantineType: "malformed_payload", sourceRoute: "test-suite", payload, reason: "Dup test" });
    expect(r1.payloadHash).toBe(r2.payloadHash);
  });

  it("resolveQuarantine marks the record as resolved", async () => {
    const record = await quarantinePayload({
      quarantineType: "schema_violation",
      sourceRoute: "test-suite",
      payload: { something: "wrong" },
      reason: "Resolve test"
    });

    const resolved = await resolveQuarantine(record.quarantineId, "approved", "Manually corrected by operator");
    expect(resolved?.resolution).toBe("approved");
    expect(resolved?.reviewedBy).toBeTruthy();
  });

  it("listQuarantined filters by resolution status", async () => {
    await quarantinePayload({
      quarantineType: "policy_violation",
      sourceRoute: "test-suite",
      payload: { listed: true },
      reason: "List filter test"
    });

    const pending = await listQuarantined({ resolution: "pending" });
    expect(pending.some((r) => r.resolution === "pending")).toBe(true);
  });

  it("getQuarantineSummary returns numeric totals", async () => {
    const summary = await getQuarantineSummary();
    expect(typeof summary.total).toBe("number");
    expect(typeof summary.pending).toBe("number");
    expect(summary.pending).toBeGreaterThanOrEqual(0);
  });
});

// ── Data quality tests ─────────────────────────────────────────────────────────

describe("data quality — scan payload checks", () => {
  function makeMinimalReport(ossScore: number): ReportSnapshot {
    return {
      snapshotId: makeId("snap"),
      createdAt: new Date().toISOString(),
      status: "completed",
      targetUrl: "https://quality-test.example.com",
      oss: { score: ossScore, classification: "test", visualState: { label: "Test", color: "#000", colorHex: "#000", tier: 1, band: "low", description: "test", cssClass: "test" }, explanation: "test" },
      dimensions: [
        { dimensionKey: "trust", label: "Trust", score: ossScore, weight: 0.3, visualState: { label: "Test", color: "#000", colorHex: "#000", tier: 1, band: "low", description: "test", cssClass: "test" }, justification: "test", evidenceItems: [] },
        { dimensionKey: "conversion", label: "Conversion", score: ossScore, weight: 0.3, visualState: { label: "Test", color: "#000", colorHex: "#000", tier: 1, band: "low", description: "test", cssClass: "test" }, justification: "test", evidenceItems: [] }
      ]
    } as unknown as ReportSnapshot;
  }

  it("checkScanPayloadQuality produces a report with a numeric score", async () => {
    const report = makeMinimalReport(72);
    const quality = await checkScanPayloadQuality(report, { jobId: makeId("job"), tenantSlug: "quality-test" });
    expect(typeof quality.score).toBe("number");
    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.score).toBeLessThanOrEqual(100);
  });

  it("checkBenchmarkQuality flags a low-score benchmark", async () => {
    const result = await checkBenchmarkQuality({
      snapshotId: makeId("snap"),
      tenantSlug: "",
      oss: 150,
      dimensions: {}
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("checkBenchmarkQuality passes for a high-score benchmark", async () => {
    const result = await checkBenchmarkQuality({
      snapshotId: makeId("snap"),
      tenantSlug: "benchmark-test",
      oss: 85,
      dimensions: { trust: 85, conversion: 90 }
    });
    expect(result.passed).toBe(true);
  });

  it("getDataQualitySummary returns structured totals", async () => {
    const summary = await getDataQualitySummary();
    expect(typeof summary.totalChecks).toBe("number");
    expect(typeof summary.passing).toBe("number");
  });
});
