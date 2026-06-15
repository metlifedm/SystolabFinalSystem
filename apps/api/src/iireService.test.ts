import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@systolab/shared";
import { buildInternalReportFromSources, flattenInternalReportRows } from "./services/iireService.js";

describe("SYSTOLAB IIRE", () => {
  it("builds internal executive intelligence from aggregate source data", () => {
    const snapshot = {
      snapshotId: "snap_test",
      createdAt: "2026-06-07T00:00:00.000Z",
      status: "completed",
      targetUrl: "https://example.com/",
      tenantBranding: { slug: "systolab" },
      oss: { score: 52 },
      dimensions: [
        { label: "Trust", score: 42 },
        { label: "Conversion Readiness", score: 48 }
      ],
      industryBenchmarkEngine: { industryType: "dentist" },
      revenueIntelligence: { revenueOpportunityRange: { low: 10, high: 40 } },
      recommendationEngine: {
        recommendations: [
          { issue: "Trust: Weak", recommendationId: "REC-001" }
        ]
      },
      competitorIntelligenceEngine: { competitors: [] },
      competitiveThreatRadar: { threatLevel: "LOW", threats: [] },
      monitoringScheduler: { enabled: true },
      businessDnaEngine: { strengths: ["Website Health"], weaknesses: ["Trust"] }
    } as unknown as ReportSnapshot;

    const report = buildInternalReportFromSources(
      "weekly",
      {
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-07T00:00:00.000Z"),
        label: "weekly test"
      },
      {
        snapshots: [snapshot],
        evidenceRows: [{ issue: "Trust: Weak", evidenceType: "issue_state", confidenceScore: 80 }],
        outcomeRows: [{ implementedStatus: "validated", improvementStatus: "improved", ossDelta: 5, revenueImpactLow: 2, revenueImpactHigh: 8, confidenceScore: 82 }],
        editEvents: [{ eventType: "scan_started", sessionFingerprint: "s1" }, { eventType: "report_viewed", sessionFingerprint: "s1" }],
        alerts: [],
        notificationJobs: 0,
        competitorRelationships: [
          {
            relationshipId: "crg_test",
            snapshotId: "snap_test",
            workspaceId: "ws_test",
            tenantSlug: "systolab",
            businessUrl: "https://example.com/",
            competitorUrl: "https://competitor.example/",
            competitorLabel: "competitor.example",
            industryType: "dentist",
            geography: "miami",
            marketSegment: "dentist:miami",
            primaryOss: 52,
            competitorOss: 68,
            primaryTrustScore: 42,
            competitorTrustScore: 70,
            primaryConversionScore: 48,
            competitorConversionScore: 66,
            revenueOpportunityLow: 10,
            revenueOpportunityHigh: 40,
            threatLevel: "HIGH",
            observations: 1,
            capturedAt: new Date("2026-06-07T00:00:00.000Z")
          }
        ]
      }
    );

    expect(report.accessScope).toBe("internal_admin_only");
    expect(report.sourceSummary.scans).toBe(1);
    expect(report.marketIntelligence[0]?.industryType).toBe("dentist");
    expect(report.revenueLeakageTrends.estimatedHighUnits).toBe(40);
    expect(report.competitorRelationshipGraph.status).toBe("limited");
    expect(report.competitorRelationshipGraph.nodes.length).toBeGreaterThan(0);
    expect(report.knowledgeGrowthScore.overallScore).toBeGreaterThan(0);
    expect(report.intelligenceDiscoveryInsights.length).toBeGreaterThan(0);
    expect(report.opportunityDiscoveries.length).toBeGreaterThan(0);
    expect(flattenInternalReportRows(report)[0]).toEqual(["section", "metric", "value"]);
  });
});
