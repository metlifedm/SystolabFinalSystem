import { describe, expect, it } from "vitest";
import { NOT_SCORED_VISUAL_STATE, visualStateForScore, type ReportSnapshot } from "@systolab/shared";
import { buildCustomerReportPayload } from "./services/customerReportService.js";
import { buildCustomerDecisionObject, validateCustomerDecisionObject } from "./services/decisionCompressionService.js";
import { buildDimensionScores, calculateOss } from "./services/truth-engine/scoring.js";

describe("AICE Decision Compression Layer", () => {
  it("compresses a full internal report into the locked customer Decision Object", () => {
    const decision = buildCustomerDecisionObject(makeReport());
    const keys = Object.keys(decision).sort();

    expect(keys).toEqual([
      "access_restriction_detected",
      "assessment_limitation",
      "confidence_score",
      "coverage_score",
      "evidence_heatmap_summary",
      "evidence_summary",
      "final_recommendation",
      "if_not_fixed_outcome",
      "impact",
      "recommended_action_window",
      "revenue_impact_range",
      "risk_level",
      "scan_id",
      "target",
      "time_sensitivity"
    ]);
    expect(decision.scan_id).toBe("snap_aice");
    expect(decision.risk_level).toBe("HIGH");
    expect(decision.recommended_action_window).toBe("FIX NOW");
    expect("execution_trace_id" in decision).toBe(false);

    const json = JSON.stringify(decision);
    expect(json).not.toContain("rawSignalTelemetry");
    expect(json).not.toContain("validationTrace");
    expect(json).not.toContain("evidenceObjects");
    expect(json).not.toContain("rawDomSnapshot");
    expect(json).not.toContain("evidenceIds");
    expect(json).not.toContain("trace");
  });

  it("downgrades conclusions when current-scan evidence is blocked or insufficient", () => {
    const report = makeReport();
    report.status = "analysis_limited";
    report.scanCoverage.sampledPages = 0;
    report.scanCoverage.robotsTxtStatus = "blocked";
    report.evidenceCoverageSummary.totalPagesSampled = 0;
    report.evidenceCoverageSummary.totalEvidenceObjects = 0;
    report.evidenceCoverageSummary.pages = [];

    const decision = buildCustomerDecisionObject(report);

    expect(decision.risk_level).toBe("UNKNOWN");
    expect(decision.access_restriction_detected).toBe(true);
    expect(decision.confidence_score).toBeLessThanOrEqual(15);
    expect(decision.revenue_impact_range.low).toBe(0);
    expect(decision.revenue_impact_range.high).toBe(0);
    expect(decision.impact).toBe("Website content could not be evaluated.");
    expect(decision.final_recommendation).toBe("Review website security configuration and allow analysis access before re-scanning.");
    expect(JSON.stringify(decision)).not.toMatch(/Cloudflare|JS Challenge|Recovery Attempts|Bot Protection|execution_trace/i);
  });

  it("rejects customer-plane payloads that include internal fields", () => {
    const decision = buildCustomerDecisionObject(makeReport());
    const validation = validateCustomerDecisionObject({
      ...decision,
      execution_trace_id: "internal-trace",
      evidenceObjects: [{ rawDomSnapshot: "<main>internal</main>" }]
    });

    expect(validation.valid).toBe(false);
    expect(validation.violations.some((item) => item.includes("Unexpected top-level field: execution_trace_id"))).toBe(true);
    expect(validation.violations.some((item) => item.includes("Unexpected top-level field: evidenceObjects"))).toBe(true);
    expect(validation.violations.some((item) => item.includes("Forbidden internal field"))).toBe(true);
  });
});

describe("content-unavailable customer report mapping", () => {
  it("scores successful fixture evidence with non-zero dimensions and real OSS", () => {
    const evidence = successfulFixtureEvidence();
    const dimensions = buildDimensionScores(evidence);
    const oss = calculateOss(dimensions);

    expect(evidence.length).toBeGreaterThan(0);
    expect(dimensions.some((dimension) => dimension.score > 0)).toBe(true);
    expect(oss).toBeGreaterThan(0);
  });

  it("keeps successful fixture reports scored with non-zero evidence", () => {
    const report = makeScoredReport();
    const payload = buildCustomerReportPayload(report) as ReportSnapshot;

    expect(payload.oss.score).toBe(72);
    expect(payload.oss.scoringStatus).toBe("scored");
    expect(payload.evidenceObjects.length).toBeGreaterThan(0);
    expect(payload.scanCoverage.sampledPages).toBeGreaterThan(0);
  });

  it("maps failed fetch reports to Not Scored instead of 0/100", () => {
    const payload = buildCustomerReportPayload(makeUnavailableReport()) as Record<string, unknown>;
    const oss = payload["oss"] as { score: number | null; scoringStatus?: string; classification?: string };
    const customerAssessment = payload["customerAssessment"] as { oss: string; status: string };

    expect(oss.score).toBeNull();
    expect(oss.scoringStatus).toBe("not_scored");
    expect(customerAssessment.oss).toBe("Not Scored");
    expect(customerAssessment.status).toBe("Content Unavailable");
    expect(JSON.stringify(payload)).not.toContain("0/100");
  });

  it("downgrades confidence and avoids fake critical conclusions when evidence is missing", () => {
    const report = makeUnavailableReport();
    const decision = buildCustomerDecisionObject(report);

    expect(decision.risk_level).toBe("UNKNOWN");
    expect(decision.confidence_score).toBeLessThanOrEqual(15);
    expect(decision.impact).toBe("Website content could not be evaluated.");
    expect(report.businessRiskStatus.classification).toBe("UNKNOWN");
    expect(report.oss.visualState.key).toBe("not_scored");
  });

  it("does not leak internal crawler telemetry in the customer unavailable payload", () => {
    const payload = buildCustomerReportPayload(makeUnavailableReport());
    const json = JSON.stringify(payload);

    expect(json).not.toMatch(/rawSignalTelemetry|failedFetches|executionProvenance|systemHealthState|validationTrace/i);
    expect(json).not.toMatch(/HTTP fetch failed|parser success|parserSuccess|robots unavailable|crawler diagnostics|recovery logs/i);
  });

  it("does not expose undefined, null, or fake zero as the customer-facing OSS label", () => {
    const payload = buildCustomerReportPayload(makeUnavailableReport()) as Record<string, unknown>;
    const customerAssessment = payload["customerAssessment"] as { oss: string; confidence: string; evidenceCoverage: string };
    const oss = payload["oss"] as { score: number | null };

    expect(customerAssessment.oss).toBe("Not Scored");
    expect(customerAssessment.confidence).toBe("Very Limited");
    expect(customerAssessment.evidenceCoverage).toBe("0%");
    expect(oss.score).not.toBe(0);
  });

  it("keeps the Decision Intelligence Brief unable to assess when content is unavailable", () => {
    const payload = buildCustomerReportPayload(makeUnavailableReport()) as ReportSnapshot;

    expect(payload.decisionIntelligenceBrief.executiveActionBanner.classification).toBe("Unable to Assess");
    expect(payload.decisionIntelligenceBrief.executiveDecisionMatrix.executiveDecisionScore).toBeNull();
    expect(payload.decisionIntelligenceBrief.executiveDecisionMatrix.riskLevel).toBe("Unable to Assess");
    expect(payload.decisionIntelligenceBrief.executiveDecisionMatrix.potentialBusinessImpact).toMatch(/Unable to calculate/i);
    expect(JSON.stringify(payload.decisionIntelligenceBrief)).not.toMatch(/HTTP fetch failed|parser|crawler|rawSignalTelemetry|executionProvenance/i);
  });
});

function makeReport(): ReportSnapshot {
  return {
    snapshotId: "snap_aice",
    targetUrl: "https://example.com",
    status: "completed",
    businessRiskStatus: {
      classification: "HIGH",
      level: "High Structural Risk",
      primaryRiskDriver: "Weak conversion path",
      explanation: "The website has high structural decision friction.",
      evidenceIds: ["EO-1"]
    },
    scanCoverage: {
      sampledPages: 2,
      discoveredPages: 3,
      coverageLabel: "2 of 3 pages sampled",
      robotsTxtStatus: "allowed",
      pageRoles: {}
    },
    evidenceCoverageSummary: {
      totalPagesSampled: 2,
      totalEvidenceObjects: 8,
      pages: [
        { url: "https://example.com", role: "home", httpStatus: 200, evidenceCount: 5, coverageStatus: "Complete", keySignals: ["cta"] },
        { url: "https://example.com/pricing", role: "pricing", httpStatus: 200, evidenceCount: 3, coverageStatus: "Partial", keySignals: ["pricing"] }
      ]
    },
    dimensions: [
      dimension("trust", "Trust", 42),
      dimension("conversionReadiness", "Conversion Readiness", 34),
      dimension("mobileExperience", "Mobile Experience", 68),
      dimension("informationClarity", "Information Clarity", 74),
      dimension("websiteHealth", "Website Health", 81)
    ],
    revenueIntelligence: {
      status: "estimated",
      confidenceScore: 74,
      confidenceBasis: "Internal estimate.",
      trafficRange: estimate("Traffic", 100, 300, "monthly_visits"),
      conversionPotentialRange: estimate("Conversion", 2, 5, "conversion_rate_percent"),
      revenueOpportunityRange: estimate("Recoverable value units", 20, 45, "monthly_value_units"),
      opportunityCostRange: estimate("Opportunity cost", 15, 40, "opportunity_cost_units"),
      competitorRevenuePressure: { status: "not_assessed", pressureLevel: "Unknown", explanation: "Not assessed.", evidenceIds: [] },
      limitations: []
    },
    businessDnaEngine: { status: "baseline_profile", strengths: [], weaknesses: [], growthStyle: "baseline_only", recurringPatterns: [], confidenceScore: 70 },
    benchmarkContext: {
      status: "available",
      datasetLabel: "Seeded benchmark",
      sampleSize: 40,
      geography: "self-owned",
      datasetAge: "current",
      comparativeConfidenceScore: 72,
      positions: []
    },
    confidenceLayer: [{ intelligenceArea: "Assessment", confidenceScore: 76, confidenceLevel: "Moderate", basis: "Sampled evidence." }],
    systemVerdict: {
      layer: "decision",
      line: "Conversion path is structurally weak.",
      primaryIssue: "Weak conversion path",
      businessConsequence: "Visitors may leave without taking action.",
      evidenceIds: ["EO-1"]
    },
    priorityTimeline: {
      fixNow: [{ actionId: "A1", action: "Clarify the primary CTA.", category: "FIX NOW", timeWindow: "0-7 days", structuralSeverity: "High", evidenceStrength: "Moderate", evidenceIds: ["EO-1"] }],
      thisMonth: [],
      monitor: []
    },
    actionFirstPanel: {
      layer: "decision",
      status: "actions_required",
      items: [
        {
          actionId: "A1",
          issue: "Weak conversion path",
          executableFix: "Clarify the primary CTA and place it near the top of the page.",
          businessReason: "Users need a clear next step.",
          effortLevel: "low",
          expectedDirectionalImpact: { informationClarity: "moderate", conversionReadiness: "high", trustStrength: "limited" },
          evidenceIds: ["EO-1"],
          evidenceClusterId: "ECL-1"
        }
      ],
      fallbackAction: "Review conversion structure."
    },
    recommendationEngine: {
      status: "generated",
      recommendations: [],
      mappingSystem: { rule: "one_recommendation_one_change_cluster", explanation: "Test mapping." }
    },
    integrity: {
      snapshotHash: "hash_aice",
      evidenceHashChain: ["evidence_hash"],
      immutableVerificationFingerprint: "fingerprint",
      snapshotIntegrityStatus: "sealed"
    }
  } as unknown as ReportSnapshot;
}

function makeScoredReport(): ReportSnapshot {
  const report = makeReport();
  report.oss = {
    score: 72,
    scoringStatus: "scored",
    classification: "Growth Ready",
    visualState: visualStateForScore(72),
    explanation: "Fixture scored report."
  };
  report.evidenceObjects = [
    {
      evidenceId: "EO-1",
      sourceType: "html",
      url: "https://example.com",
      pageRole: "home",
      rawValue: "<h1>Example</h1>",
      normalizedInput: { signalKey: "h1_presence", value: 1 },
      validationMethod: "direct_extraction",
      confidenceBasis: "Fixture HTML contained a primary heading.",
      groundTruthConfidence: 95,
      dimensionRefs: ["informationClarity"],
      capturedAt: "2026-06-14T00:00:00.000Z"
    }
  ] as unknown as ReportSnapshot["evidenceObjects"];
  return report;
}

function makeUnavailableReport(): ReportSnapshot {
  const report = makeScoredReport();
  report.status = "content_unavailable";
  report.scanCoverage = {
    sampledPages: 0,
    discoveredPages: 0,
    coverageLabel: "0 pages sampled - content unavailable",
    robotsTxtStatus: "unavailable",
    pageRoles: {}
  };
  report.evidenceCoverageSummary = {
    totalPagesSampled: 0,
    totalEvidenceObjects: 0,
    pages: []
  } as unknown as ReportSnapshot["evidenceCoverageSummary"];
  report.evidenceObjects = [
    {
      evidenceId: "EO-FETCH",
      sourceType: "system",
      url: "https://example.com",
      pageRole: "scan",
      rawValue: "HTTP fetch failed",
      normalizedInput: { signalKey: "fetch_success_rate", value: 0 },
      validationMethod: "direct_extraction",
      confidenceBasis: "Internal crawler diagnostic",
      groundTruthConfidence: 95,
      dimensionRefs: ["stability"],
      capturedAt: "2026-06-14T00:00:00.000Z"
    }
  ] as unknown as ReportSnapshot["evidenceObjects"];
  report.rawSignalTelemetry = [
    { eventId: "evt-fetch", timestamp: "2026-06-14T00:00:00.000Z", stage: "http", level: "error", message: "HTTP fetch failed", data: { reason: "timeout" } }
  ];
  report.executionProvenance = {
    crawlerEngine: "internal-crawler",
    renderEngine: "playwright",
    parserVersion: "fixture",
    executionTimeMs: 1000,
    retryCount: 3,
    robotsTxtComplianceStatus: "unavailable",
    pagesFetched: [],
    failedFetches: [{ url: "https://example.com", reason: "HTTP fetch failed" }]
  } as unknown as ReportSnapshot["executionProvenance"];
  report.systemHealthState = {
    crawlerStability: "degraded",
    parserSuccessRate: 0,
    renderEngineStatus: "not_rendered",
    memoryUsageMb: 1,
    cpuLoadPercent: 1,
    errorRate: 1,
    queueLatencyMs: 0,
    overallReliability: "limited"
  } as unknown as ReportSnapshot["systemHealthState"];
  report.oss = {
    score: null,
    scoringStatus: "not_scored",
    classification: "Not Scored",
    visualState: NOT_SCORED_VISUAL_STATE,
    explanation: "OSS was not scored because website content could not be collected."
  };
  report.ossInterpretation = {
    layer: "decision",
    score: null,
    strictClassification: "not_scored",
    label: "Not Scored",
    range: "N/A",
    oneLineDiagnosis: "Website content could not be collected, so OSS was not scored.",
    meaning: "No structural conclusion was generated because validated page evidence was unavailable.",
    visualState: NOT_SCORED_VISUAL_STATE
  };
  report.businessRiskStatus = {
    classification: "UNKNOWN",
    level: "Not Assessed",
    primaryRiskDriver: "Website content could not be collected.",
    explanation: "Risk was not scored because no page content was available for validated structural analysis.",
    evidenceIds: []
  };
  report.confidenceLayer = [
    {
      intelligenceArea: "Evidence Coverage",
      confidenceScore: 0,
      confidenceLevel: "Limited",
      basis: "Very Limited: website content could not be collected, so structural scoring was not performed."
    }
  ];
  report.decisionIntelligenceBrief = {
    executiveVerdict: {
      currentSituation: "Website content could not be collected, so the current situation cannot be scored from validated page evidence.",
      seriousness: "No structural risk level or revenue impact was inferred because evidence coverage is 0%.",
      firstAction: "Review website access, security, and robots settings before re-running the assessment.",
      urgency: "Not Applicable",
      likelyBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      evidenceBasis: "0 sampled pages and 0 validated page evidence objects were available."
    },
    executiveActionBanner: {
      classification: "Unable to Assess",
      message: "Content was unavailable, so SYSTOLAB did not assign OSS, risk, competitor position, or revenue impact.",
      urgency: "Not Applicable"
    },
    executiveDecisionMatrix: {
      executiveDecisionScore: null,
      riskLevel: "Unable to Assess",
      executivePriority: "Not Applicable",
      timeSensitivity: "Not Applicable",
      competitivePosition: "Benchmark Data Unavailable",
      primaryBusinessConstraint: "Website content could not be collected.",
      potentialBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      ifNotAddressedOutcome: "No outcome projection was generated because page evidence was unavailable.",
      recommendedNextAction: "Review access/security/robots settings and re-run scan."
    },
    actionPlan: [
      {
        priority: "Priority 1",
        action: "Review website access and security settings.",
        rationale: "The assessment could not collect page content, so access must be reviewed before conclusions can be generated.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      }
    ],
    whyThisMatters: {
      overallCondition: "The report is limited to an access outcome, not a structural diagnosis.",
      strongestValidatedDimensions: [],
      weakestValidatedDimension: "Not assessed because website content was unavailable.",
      businessSignificance: "Business impact was not inferred because no current-scan page evidence was available."
    },
    competitivePositionAnalysis: {
      summary: "Benchmark and competitor position were not assessed because website content could not be collected.",
      benchmarkStatus: "Benchmark Data Unavailable",
      competitorStatus: "Competitor Data Unavailable",
      dimensionPositions: []
    },
    executiveReliabilityPanel: {
      evidenceCoverage: "0 sampled pages, 0 validated page evidence objects.",
      crawlCoverage: "0 pages sampled - content unavailable",
      assessmentConfidence: "0% (Limited)",
      benchmarkConfidence: "Not available",
      assessmentTrustSignals: "Not assessed because website content could not be collected.",
      overallReportReliability: "Limited",
      limitations: [
        "Website content could not be collected.",
        "OSS, business risk, revenue impact, and competitor position were not scored.",
        "Re-run the assessment after access is resolved."
      ]
    }
  };
  return report;
}

function successfulFixtureEvidence(): ReportSnapshot["evidenceObjects"] {
  const signalKeys = [
    "https_transport",
    "http_status_success",
    "h1_present",
    "title_present",
    "description_present",
    "viewport_present",
    "cta_present",
    "contact_signal_present",
    "form_or_contact_present",
    "text_density_score",
    "resource_weight_score",
    "metadata_quality_score",
    "security_headers_score",
    "robots_allowed",
    "fetch_success_rate"
  ];

  return signalKeys.map((signalKey, index) => ({
    evidenceId: `EO-FIXTURE-${index + 1}`,
    sourceType: "html",
    url: "https://example.com",
    pageRole: "home",
    rawValue: signalKey,
    normalizedInput: { signalKey, value: 100 },
    validationMethod: "direct_extraction",
    confidenceBasis: "Successful fixture evidence.",
    groundTruthConfidence: 92,
    dimensionRefs: [],
    capturedAt: "2026-06-14T00:00:00.000Z"
  })) as unknown as ReportSnapshot["evidenceObjects"];
}

function dimension(key: string, label: string, score: number) {
  return {
    key,
    label,
    score,
    classification: score < 40 ? "Critical" : score < 60 ? "Weak" : "Stable",
    visualState: { key: "test", label: "Test", range: [0, 100], color: "#000", indicator: "test", businessMeaning: "Test" },
    businessMeaning: "Test business meaning.",
    confidenceScore: 80,
    confidenceLevel: "High",
    evidenceIds: ["EO-1"],
    trace: []
  };
}

function estimate(label: string, low: number, high: number, unit: string) {
  return { label, low, high, unit, confidenceScore: 75, rationale: "Test rationale.", evidenceIds: ["EO-1"] };
}
