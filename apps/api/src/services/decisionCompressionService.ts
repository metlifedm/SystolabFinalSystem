import type { AiceBoundaryValidation, AiceDecisionObject, ReportSnapshot } from "@systolab/shared";
import { clampScore } from "@systolab/shared";

const DECISION_OBJECT_KEYS = new Set([
  "access_restriction_detected",
  "assessment_limitation",
  "scan_id",
  "target",
  "risk_level",
  "time_sensitivity",
  "evidence_summary",
  "coverage_score",
  "confidence_score",
  "revenue_impact_range",
  "if_not_fixed_outcome",
  "recommended_action_window",
  "final_recommendation",
  "impact",
  "evidence_heatmap_summary"
]);

const FORBIDDEN_CUSTOMER_KEYS = new Set([
  "architecturestate",
  "compatibilityintelligence",
  "confidenceengine",
  "confidencelayer",
  "crawlertelemetry",
  "datainputs",
  "diagnostics",
  "dimensions",
  "evidenceclusters",
  "evidencedatabase",
  "evidenceids",
  "evidenceobjects",
  "evidencetracereferences",
  "executionprovenance",
  "executiontrace",
  "executiontraceid",
  "failurememory",
  "failurememoryrecords",
  "groundtruthvalidationlog",
  "hash",
  "httpsnippet",
  "integrity",
  "internalintelligenceartifacts",
  "intermediatescoringmetrics",
  "normalizedinput",
  "operationalmemorygraph",
  "parseroutputs",
  "rawdomsnapshot",
  "rawsignaltelemetry",
  "rawvalue",
  "recoverylogs",
  "renderverification",
  "reportgovernance",
  "screenshotref",
  "selectorpath",
  "structureoutputschema",
  "structuredoutputschema",
  "systemdiagnostics",
  "telemetry",
  "trace",
  "traceid",
  "validationtrace",
  "validationtraceids"
]);

export function buildCustomerDecisionObject(report: ReportSnapshot): AiceDecisionObject {
  const coverageScore = buildCoverageScore(report);
  const accessRestricted = hasAccessRestriction(report, coverageScore);
  const evidenceSupported = hasSupportedEvidence(report, coverageScore);
  const recommendedActionWindow = buildRecommendedActionWindow(report, evidenceSupported, accessRestricted);
  return enforceCustomerDecisionBoundary({
    scan_id: report.snapshotId,
    target: report.targetUrl,
    risk_level: evidenceSupported ? report.businessRiskStatus.classification : "UNKNOWN",
    time_sensitivity: buildTimeSensitivity(recommendedActionWindow, evidenceSupported),
    evidence_summary: {
      overview: buildEvidenceOverview(report, evidenceSupported, accessRestricted),
      sampled_pages: report.scanCoverage.sampledPages,
      coverage_status: aggregateCoverageStatus(report),
      strongest_business_signal: evidenceSupported ? strongestDimension(report) : "Not assessed",
      weakest_business_signal: evidenceSupported ? weakestDimension(report) : "Not assessed"
    },
    coverage_score: coverageScore,
    confidence_score: buildConfidenceScore(report, coverageScore, evidenceSupported, accessRestricted),
    revenue_impact_range: buildRevenueImpactRange(report, coverageScore, evidenceSupported),
    if_not_fixed_outcome: buildIfNotFixedOutcome(report, evidenceSupported, accessRestricted),
    recommended_action_window: recommendedActionWindow,
    final_recommendation: buildFinalRecommendation(report, evidenceSupported, accessRestricted),
    access_restriction_detected: accessRestricted,
    assessment_limitation: buildAssessmentLimitation(evidenceSupported, accessRestricted),
    impact: buildCustomerImpact(evidenceSupported, accessRestricted),
    evidence_heatmap_summary: buildEvidenceHeatmapSummary(report, evidenceSupported, accessRestricted)
  });
}

export function enforceCustomerDecisionBoundary(candidate: AiceDecisionObject): AiceDecisionObject {
  const validation = validateCustomerDecisionObject(candidate);
  if (!validation.valid) {
    throw new Error(`AICE customer output boundary violation: ${validation.violations.join("; ")}`);
  }
  return candidate;
}

export function validateCustomerDecisionObject(candidate: unknown): AiceBoundaryValidation {
  const violations: string[] = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, violations: ["Decision object must be a JSON object."] };
  }

  const record = candidate as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of DECISION_OBJECT_KEYS) {
    if (!(key in record)) violations.push(`Missing required field: ${key}`);
  }
  for (const key of keys) {
    if (!DECISION_OBJECT_KEYS.has(key)) violations.push(`Unexpected top-level field: ${key}`);
  }

  collectForbiddenKeyViolations(record, violations);
  validateShape(record, violations);

  return { valid: violations.length === 0, violations };
}

function validateShape(record: Record<string, unknown>, violations: string[]): void {
  requireString(record, "scan_id", violations);
  requireString(record, "target", violations);
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(String(record["risk_level"] ?? ""))) {
    violations.push("risk_level must be LOW, MEDIUM, HIGH, CRITICAL, or UNKNOWN.");
  }
  requireString(record, "time_sensitivity", violations);
  requireScore(record, "coverage_score", violations);
  requireScore(record, "confidence_score", violations);
  requireString(record, "if_not_fixed_outcome", violations);
  if (!["FIX NOW", "THIS MONTH", "MONITOR"].includes(String(record["recommended_action_window"] ?? ""))) {
    violations.push("recommended_action_window must be FIX NOW, THIS MONTH, or MONITOR.");
  }
  requireString(record, "final_recommendation", violations);
  if (typeof record["access_restriction_detected"] !== "boolean") {
    violations.push("access_restriction_detected must be boolean.");
  }
  requireString(record, "assessment_limitation", violations);
  requireString(record, "impact", violations);

  const summary = record["evidence_summary"];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    violations.push("evidence_summary must be an object.");
  } else {
    const item = summary as Record<string, unknown>;
    requireString(item, "overview", violations);
    if (!Number.isFinite(Number(item["sampled_pages"]))) violations.push("evidence_summary.sampled_pages must be numeric.");
    if (!["Complete", "Partial", "Limited"].includes(String(item["coverage_status"] ?? ""))) {
      violations.push("evidence_summary.coverage_status must be Complete, Partial, or Limited.");
    }
    requireString(item, "strongest_business_signal", violations);
    requireString(item, "weakest_business_signal", violations);
  }

  const revenue = record["revenue_impact_range"];
  if (!revenue || typeof revenue !== "object" || Array.isArray(revenue)) {
    violations.push("revenue_impact_range must be an object.");
  } else {
    const item = revenue as Record<string, unknown>;
    requireString(item, "label", violations);
    if (!Number.isFinite(Number(item["low"]))) violations.push("revenue_impact_range.low must be numeric.");
    if (!Number.isFinite(Number(item["high"]))) violations.push("revenue_impact_range.high must be numeric.");
    if (!["monthly_visits", "conversion_rate_percent", "monthly_value_units", "opportunity_cost_units"].includes(String(item["unit"] ?? ""))) {
      violations.push("revenue_impact_range.unit is invalid.");
    }
  }

  const heatmap = record["evidence_heatmap_summary"];
  if (!Array.isArray(heatmap) || heatmap.length === 0) {
    violations.push("evidence_heatmap_summary must be a non-empty array.");
  }
}

function collectForbiddenKeyViolations(value: unknown, violations: string[], path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeyViolations(entry, violations, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenCustomerKey(key)) violations.push(`Forbidden internal field at ${path}.${key}`);
    collectForbiddenKeyViolations(entry, violations, `${path}.${key}`);
  }
}

function isForbiddenCustomerKey(key: string): boolean {
  return FORBIDDEN_CUSTOMER_KEYS.has(key.replace(/[\s_-]/g, "").toLowerCase());
}

function requireString(record: Record<string, unknown>, key: string, violations: string[]): void {
  if (typeof record[key] !== "string" || String(record[key]).trim().length === 0) {
    violations.push(`${key} must be a non-empty string.`);
  }
}

function requireScore(record: Record<string, unknown>, key: string, violations: string[]): void {
  const value = Number(record[key]);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    violations.push(`${key} must be a number from 0 to 100.`);
  }
}

function buildTimeSensitivity(window: AiceDecisionObject["recommended_action_window"], evidenceSupported: boolean): string {
  if (!evidenceSupported) return "Evidence is insufficient for urgency classification. Resolve access or coverage limitations and re-scan.";
  if (window === "FIX NOW") return "Immediate action recommended within 0-7 days.";
  if (window === "THIS MONTH") return "Action recommended within 7-30 days.";
  return "Monitor continuously and rescan after material site changes.";
}

function buildEvidenceOverview(report: ReportSnapshot, evidenceSupported: boolean, accessRestricted: boolean): string {
  if (accessRestricted) {
    return "Access restriction detected: yes. The website restricted automated analysis before content could be collected.";
  }
  if (!evidenceSupported) {
    return "Validated evidence is incomplete or insufficient, so customer-facing conclusions are limited to observed structural coverage.";
  }
  const coverage = aggregateCoverageStatus(report).toLowerCase();
  return `${coverage} business evidence coverage across ${report.scanCoverage.sampledPages} sampled page(s), summarized into customer-safe decision intelligence.`;
}

function buildCoverageScore(report: ReportSnapshot): number {
  const pages = report.evidenceCoverageSummary.pages;
  if (pages.length === 0) return clampScore(report.scanCoverage.sampledPages > 0 ? 55 : 0);
  const total = pages.reduce((sum, page) => {
    if (page.coverageStatus === "Complete") return sum + 100;
    if (page.coverageStatus === "Partial") return sum + 65;
    return sum + 35;
  }, 0);
  return clampScore(total / pages.length);
}

function buildConfidenceScore(report: ReportSnapshot, coverageScore: number, evidenceSupported: boolean, accessRestricted: boolean): number {
  const confidenceScores = [
    report.revenueIntelligence.confidenceScore,
    report.businessDnaEngine.confidenceScore,
    report.benchmarkContext.comparativeConfidenceScore,
    ...report.confidenceLayer.map((item) => item.confidenceScore)
  ].filter((value) => Number.isFinite(value));
  if (confidenceScores.length === 0) return 0;
  const base = confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length;
  if (accessRestricted) return clampScore(Math.min(15, coverageScore));
  if (!evidenceSupported) return clampScore(Math.min(30, coverageScore));
  return clampScore(Math.min(base, base * (coverageScore / 100)));
}

function buildRevenueImpactRange(report: ReportSnapshot, coverageScore: number, evidenceSupported: boolean): AiceDecisionObject["revenue_impact_range"] {
  if (!evidenceSupported) {
    return {
      label: "Not estimated because validated evidence was insufficient",
      low: 0,
      high: 0,
      unit: "monthly_value_units"
    };
  }
  const factor = coverageScore / 100;
  return {
    label: "Evidence-supported structural opportunity range",
    low: Math.max(0, Math.round(report.revenueIntelligence.revenueOpportunityRange.low * factor)),
    high: Math.max(0, Math.round(report.revenueIntelligence.revenueOpportunityRange.high * factor)),
    unit: report.revenueIntelligence.revenueOpportunityRange.unit
  };
}

function buildIfNotFixedOutcome(report: ReportSnapshot, evidenceSupported: boolean, accessRestricted: boolean): string {
  if (accessRestricted) {
    return "The system cannot evaluate website content from the current scan. Business impact, user behavior, conversion effect, and revenue effect remain unverified until access allows analysis.";
  }
  if (!evidenceSupported) {
    return "Validated evidence is insufficient to support a business impact, conversion effect, user intent, or revenue conclusion.";
  }
  return `The observed structural issue may remain present if unchanged. Actual user behavior, conversion loss, and revenue loss are not asserted without verified first-party evidence.`;
}

function buildRecommendedActionWindow(
  report: ReportSnapshot,
  evidenceSupported: boolean,
  accessRestricted: boolean
): AiceDecisionObject["recommended_action_window"] {
  if (accessRestricted) return "FIX NOW";
  if (!evidenceSupported) return "MONITOR";
  if (report.priorityTimeline.fixNow.length > 0 || ["HIGH", "CRITICAL"].includes(report.businessRiskStatus.classification)) return "FIX NOW";
  if (report.priorityTimeline.thisMonth.length > 0 || report.businessRiskStatus.classification === "MEDIUM") return "THIS MONTH";
  return "MONITOR";
}

function buildFinalRecommendation(report: ReportSnapshot, evidenceSupported: boolean, accessRestricted: boolean): string {
  if (accessRestricted) return "Review website security configuration and allow analysis access before re-scanning.";
  if (!evidenceSupported) return "Improve assessment coverage and re-scan before making business-impact decisions.";
  const action = report.actionFirstPanel.items[0]?.executableFix ?? report.recommendationEngine.recommendations[0]?.action;
  return action ?? report.actionFirstPanel.fallbackAction ?? report.verdictCard.highestLeverageAction;
}

function buildAssessmentLimitation(evidenceSupported: boolean, accessRestricted: boolean): string {
  if (accessRestricted) return "The website restricted automated analysis before content could be collected.";
  if (!evidenceSupported) return "Evidence was incomplete, inaccessible, blocked, inferred, or unverified in the current scan, so confidence was reduced.";
  return "No material access limitation detected in the current customer-safe evidence summary.";
}

function buildCustomerImpact(evidenceSupported: boolean, accessRestricted: boolean): string {
  if (accessRestricted) return "Website content could not be evaluated.";
  if (!evidenceSupported) return "Business impact, user behavior, conversion effect, and revenue effect could not be verified from the current evidence.";
  return "Only evidence-supported structural impact is reported; actual user intent, conversion loss, or revenue loss is not asserted without verified first-party data.";
}

function buildEvidenceHeatmapSummary(
  report: ReportSnapshot,
  evidenceSupported: boolean,
  accessRestricted: boolean
): AiceDecisionObject["evidence_heatmap_summary"] {
  if (accessRestricted) {
    return CUSTOMER_AREAS.map((area) => ({
      area,
      coverage: "blocked",
      business_meaning: "Website content could not be evaluated."
    }));
  }
  if (!evidenceSupported) {
    return CUSTOMER_AREAS.map((area) => ({
      area,
      coverage: "limited",
      business_meaning: "Validated evidence was insufficient for a stronger customer conclusion."
    }));
  }
  const summaries = [
    heatmapArea("Trust Signals", dimensionScore(report, "trust"), "Customer confidence signals and credibility cues."),
    heatmapArea("Conversion Path", dimensionScore(report, "conversionReadiness"), "CTA, form, and action-path readiness."),
    heatmapArea("Mobile Experience", dimensionScore(report, "mobileExperience"), "Small-screen usability and viewport readiness."),
    heatmapArea("Information Clarity", dimensionScore(report, "informationClarity"), "Headline, structure, and decision clarity."),
    heatmapArea("Website Health", dimensionScore(report, "websiteHealth"), "Basic reliability and accessible page coverage.")
  ];
  return summaries;
}

function heatmapArea(area: string, score: number, businessMeaning: string): AiceDecisionObject["evidence_heatmap_summary"][number] {
  return {
    area,
    coverage: score >= 80 ? "full" : score >= 60 ? "partial" : score >= 35 ? "limited" : "blocked",
    business_meaning: businessMeaning
  };
}

function aggregateCoverageStatus(report: ReportSnapshot): "Complete" | "Partial" | "Limited" {
  const score = buildCoverageScore(report);
  if (score >= 80) return "Complete";
  if (score >= 45) return "Partial";
  return "Limited";
}

function strongestDimension(report: ReportSnapshot): string {
  return [...report.dimensions].sort((a, b) => b.score - a.score)[0]?.label ?? "Not assessed";
}

function weakestDimension(report: ReportSnapshot): string {
  return [...report.dimensions].sort((a, b) => a.score - b.score)[0]?.label ?? "Not assessed";
}

function dimensionScore(report: ReportSnapshot, key: string): number {
  return report.dimensions.find((dimension) => dimension.key === key)?.score ?? 0;
}

const CUSTOMER_AREAS = ["Trust Signals", "Conversion Path", "Mobile Experience", "Information Clarity", "Website Health"];

function hasSupportedEvidence(report: ReportSnapshot, coverageScore: number): boolean {
  return report.status === "completed" &&
    !hasAccessRestriction(report, coverageScore) &&
    coverageScore >= 45 &&
    report.evidenceCoverageSummary.totalEvidenceObjects > 0 &&
    report.scanCoverage.sampledPages > 0;
}

function hasAccessRestriction(report: ReportSnapshot, coverageScore: number): boolean {
  return report.status === "failed" ||
    report.scanCoverage.robotsTxtStatus === "blocked" ||
    report.scanCoverage.sampledPages === 0 ||
    report.evidenceCoverageSummary.totalEvidenceObjects === 0 ||
    coverageScore < 25;
}
