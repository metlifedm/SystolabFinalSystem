import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@systolab/shared";
import { buildDecisionTimelineForReport } from "./services/decisionTimelineService.js";
import { saveSnapshot } from "./services/persistenceService.js";

function report(input: { id: string; tenant: string; target: string; createdAt: string; score: number | null; risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"; status?: ReportSnapshot["status"]; validated?: boolean }): ReportSnapshot {
  const scored = input.score !== null;
  return {
    snapshotId: input.id,
    createdAt: input.createdAt,
    status: input.status ?? (scored ? "completed" : "content_unavailable"),
    targetUrl: input.target,
    mode: "full_audit",
    tenantBranding: {
      tenantId: input.tenant,
      slug: input.tenant,
      publicName: input.tenant,
      primaryColor: "#17201d",
      accentColor: "#d6a84f",
      reportTitle: "SYSTOLAB",
      poweredByLabel: "SYSTOLAB",
      footerLabel: "SYSTOLAB"
    },
    evidenceCoverageSummary: {
      totalPagesSampled: scored ? 2 : 0,
      totalEvidenceObjects: scored ? 8 : 0,
      pages: scored ? [
        { url: input.target, role: "home", httpStatus: 200, evidenceCount: 5, coverageStatus: "Complete", keySignals: ["trust", "cta"] },
        { url: input.target + "/about", role: "about", httpStatus: 200, evidenceCount: 3, coverageStatus: "Partial", keySignals: ["proof"] }
      ] : []
    },
    evidenceObjects: scored ? Array.from({ length: 8 }, (_, index) => ({ evidenceId: "ev" + index })) : [],
    oss: {
      score: input.score,
      scoringStatus: scored ? "scored" : "not_scored",
      classification: scored ? "Stable" : "Not Scored",
      visualState: { label: scored ? "Stability Green" : "Not Scored" },
      explanation: scored ? "Scored from validated evidence." : "Content unavailable."
    },
    businessRiskStatus: {
      classification: input.risk,
      level: input.risk === "LOW" ? "Low Structural Risk" : input.risk === "MEDIUM" ? "Medium Structural Risk" : input.risk === "HIGH" ? "High Structural Risk" : input.risk === "CRITICAL" ? "Critical Structural Risk" : "Not Assessed",
      primaryRiskDriver: "Trust",
      explanation: "Evidence-bound risk.",
      evidenceIds: []
    },
    dimensions: scored ? [
      { key: "trust", label: "Trust", score: Math.max(0, (input.score ?? 0) - 5), confidenceScore: 82 },
      { key: "conversionReadiness", label: "Conversion Readiness", score: input.score ?? 0, confidenceScore: 78 }
    ] : [],
    confidenceEngine: { overallConfidenceScore: scored ? 82 : 12 },
    verdictCard: { topIssue: scored ? "Trust proof needs improvement" : "Content unavailable" },
    recommendationEngine: { recommendations: [{ recommendationId: "rec-1", action: "Add stronger trust proof near the main action path." }] },
    executiveClarity: { recommendedFirstAction: "Improve trust proof." },
    freshness: { capturedAt: input.createdAt },
    architectureState: { version: "AICE-enterprise-v1" },
    reportGovernance: { version: "SYSTOLAB Governance v1.0" },
    structuredOutputSchema: { schemaVersion: "report-template-v1" },
    recommendationOutcomeLoop: {
      status: input.validated ? "validated" : "baseline_pending",
      validations: input.validated ? [{
        recommendationId: "rec-1",
        recommendation: "Add stronger trust proof near the main action path.",
        implementedStatus: "validated",
        ossDelta: 12,
        dimensionDeltas: [],
        improvementStatus: "improved",
        revenueImpact: { label: "Opportunity", low: 0, high: 0, unit: "monthly_value_units", confidenceScore: 70, rationale: "Structural only.", evidenceIds: [] },
        confidenceScore: 82,
        confidenceReasons: ["Compared against previous immutable snapshot."],
        evidenceIds: []
      }] : [],
      summary: input.validated ? "Recommendation validated." : "Baseline pending."
    },
    competitiveThreatRadar: { status: "not_assessed", threatLevel: "UNKNOWN", threats: [], explanation: "No competitor movement assessed." },
    integrity: { snapshotHash: input.id }
  } as unknown as ReportSnapshot;
}

describe("Decision Timeline service", () => {
  it("builds business progress from immutable snapshot history", async () => {
    const tenant = "timeline-tenant-" + Date.now();
    const target = "https://timeline.example.com/" + tenant;
    const first = report({ id: tenant + "-1", tenant, target, createdAt: "2026-01-01T00:00:00.000Z", score: 62, risk: "MEDIUM" });
    const second = report({ id: tenant + "-2", tenant, target, createdAt: "2026-02-01T00:00:00.000Z", score: 78, risk: "LOW", validated: true });
    await saveSnapshot(first);
    await saveSnapshot(second);

    const timeline = await buildDecisionTimelineForReport(second);

    expect(timeline.status).toBe("active");
    expect(timeline.platformGovernance.sourceOfTruth).toBe("SYSTOLAB Intelligence Engine");
    expect(timeline.points).toHaveLength(2);
    expect(timeline.events.some((event) => event.eventType === "score_improved")).toBe(true);
    expect(timeline.events.some((event) => event.eventType === "risk_changed")).toBe(true);
    expect(timeline.events.some((event) => event.eventType === "recommendation_validated")).toBe(true);
    expect(timeline.versionLedger.decisionFrameworkVersion).toBe("SYSTOLAB Governance v1.0");
  });

  it("marks content-unavailable scans as limited instead of fake failures", async () => {
    const tenant = "timeline-limited-" + Date.now();
    const target = "https://limited.example.com/" + tenant;
    const limited = report({ id: tenant + "-1", tenant, target, createdAt: "2026-03-01T00:00:00.000Z", score: null, risk: "UNKNOWN" });

    const timeline = await buildDecisionTimelineForReport(limited);

    expect(timeline.status).toBe("content_unavailable");
    expect(timeline.points[0]?.oss).toBeNull();
    expect(timeline.limitations.some((item) => item.includes("did not assign a negative score"))).toBe(true);
  });
});
