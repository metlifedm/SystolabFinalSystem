import { SYSTOLAB_VERSION, type DecisionTimelineEvent, type DecisionTimelineOutput, type DecisionTimelinePoint, type ReportLifecycleState, type ReportSnapshot } from "@systolab/shared";
import { findSnapshotHistoryForTarget } from "./persistenceService.js";
import { sha256 } from "../utils/crypto.js";

const ETHICS_POLICY = "SYSTOLAB never fabricates evidence, never invents competitor behavior, never presents estimates as facts, and separates observed, inferred, and estimated conclusions.";

export async function buildDecisionTimelineForReport(report: ReportSnapshot, limit = 12): Promise<DecisionTimelineOutput> {
  const history = await findSnapshotHistoryForTarget(report.targetUrl, report.tenantBranding.slug, limit);
  const unique = dedupeSnapshots([...history, report])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit);
  const points = unique.map(buildTimelinePoint);
  const events = buildTimelineEvents(unique, points);
  const current = points.find((point) => point.snapshotId === report.snapshotId) ?? points.at(-1) ?? buildTimelinePoint(report);
  const scoredPoints = points.filter((point) => typeof point.oss === "number");
  const firstScored = scoredPoints[0];
  const latestScored = [...scoredPoints].reverse()[0];
  const scoreDelta = firstScored && latestScored ? Number(((latestScored.oss ?? 0) - (firstScored.oss ?? 0)).toFixed(1)) : null;
  const status = report.status === "content_unavailable" || report.oss?.scoringStatus === "not_scored"
    ? "content_unavailable"
    : points.length <= 1
      ? "baseline_only"
      : events.length <= 1
        ? "insufficient_history"
        : "active";

  return {
    status,
    targetUrl: report.targetUrl,
    tenantSlug: report.tenantBranding.slug,
    generatedAt: new Date().toISOString(),
    currentSnapshotId: report.snapshotId,
    currentLifecycle: current.reportLifecycle,
    summary: summarizeTimeline(status, points.length, scoreDelta, current),
    platformGovernance: {
      sourceOfTruth: "SYSTOLAB Intelligence Engine",
      mutationPolicy: "immutable_snapshot_history",
      ethicsPolicy: ETHICS_POLICY
    },
    versionLedger: buildVersionLedger(report),
    points,
    events,
    limitations: buildTimelineLimitations(report, points)
  };
}

function buildTimelinePoint(report: ReportSnapshot): DecisionTimelinePoint {
  const coverage = evidenceCoveragePercent(report);
  const confidence = Math.round(report.confidenceEngine?.overallConfidenceScore ?? average(report.dimensions?.map((item) => item.confidenceScore) ?? []) ?? 0);
  const strongest = [...(report.dimensions ?? [])].sort((a, b) => b.score - a.score)[0];
  const weakest = [...(report.dimensions ?? [])].sort((a, b) => a.score - b.score)[0];
  return {
    snapshotId: report.snapshotId,
    capturedAt: report.createdAt,
    scanDate: report.freshness?.capturedAt ?? report.createdAt,
    reportLifecycle: lifecycleForReport(report),
    status: report.status,
    oss: report.oss?.scoringStatus === "not_scored" ? null : report.oss?.score ?? null,
    visualStateLabel: report.oss?.visualState?.label ?? (report.oss?.scoringStatus === "not_scored" ? "Not Scored" : "Unknown"),
    businessRiskStatus: report.businessRiskStatus?.classification ?? "UNKNOWN",
    confidenceScore: confidence,
    evidenceCoveragePercent: coverage,
    totalPagesSampled: report.evidenceCoverageSummary?.totalPagesSampled ?? 0,
    totalEvidenceObjects: report.evidenceCoverageSummary?.totalEvidenceObjects ?? report.evidenceObjects?.length ?? 0,
    strongestSignal: strongest?.label ?? "Not enough evidence",
    weakestSignal: weakest?.label ?? "Not enough evidence",
    topDecision: report.decisions?.[0]?.decisionClassification ?? report.verdictCard?.topIssue ?? "No validated decision yet",
    topRecommendedAction: report.recommendationEngine?.recommendations?.[0]?.action ?? report.executiveClarity?.recommendedFirstAction ?? "Re-run scan after evidence is available",
    ...buildVersionLedger(report)
  };
}

function buildTimelineEvents(reports: ReportSnapshot[], points: DecisionTimelinePoint[]): DecisionTimelineEvent[] {
  const events: DecisionTimelineEvent[] = [];
  if (!reports.length || !points.length) return events;
  events.push(makeEvent("baseline_created", reports[0]!, points[0]!, "Baseline created", "SYSTOLAB created the first immutable decision baseline for this website.", "Future scans can now show what improved, worsened, or stayed stable.", []));

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const currentReport = reports.find((item) => item.snapshotId === current.snapshotId) ?? reports[index]!;
    if (current.oss === null) {
      events.push(makeEvent("content_unavailable", currentReport, current, "Content unavailable", "Website content could not be collected for this scan.", "SYSTOLAB did not convert missing evidence into a negative business score.", []));
      continue;
    }
    if (typeof previous.oss === "number") {
      const delta = Number((current.oss - previous.oss).toFixed(1));
      if (delta >= 5) {
        events.push(makeEvent("score_improved", currentReport, current, "Business readiness improved", "Business Readiness moved +" + delta + " points since the previous scan.", "The validated website structure moved in a stronger direction.", []));
      } else if (delta <= -5) {
        events.push(makeEvent("score_declined", currentReport, current, "Business readiness declined", "Business Readiness moved " + delta + " points since the previous scan.", "The latest scan found weaker validated decision support than the previous scan.", []));
      }
    }
    if (previous.businessRiskStatus !== current.businessRiskStatus) {
      events.push(makeEvent("risk_changed", currentReport, current, "Risk status changed", "Risk moved from " + previous.businessRiskStatus + " to " + current.businessRiskStatus + ".", "SYSTOLAB detected a material change in the business risk classification.", []));
    }
    for (const validation of currentReport.recommendationOutcomeLoop?.validations ?? []) {
      if (validation.implementedStatus === "validated") {
        events.push(makeEvent("recommendation_validated", currentReport, current, "Recommendation validated", summarizeRecommendationValidation(validation), "A previously recommended improvement appears to have produced an observable positive change.", [validation.recommendationId]));
      }
      if (validation.implementedStatus === "regressed") {
        events.push(makeEvent("recommendation_regressed", currentReport, current, "Recommendation regressed", summarizeRecommendationValidation(validation), "A tracked recommendation area moved backward and should be reviewed.", [validation.recommendationId]));
      }
    }
    if (currentReport.competitiveThreatRadar?.status === "active" && ["HIGH", "MEDIUM"].includes(currentReport.competitiveThreatRadar.threatLevel)) {
      events.push(makeEvent("competitor_threat_detected", currentReport, current, "Competitive movement detected", currentReport.competitiveThreatRadar.explanation, "A competitor movement may require attention, limited to validated comparison evidence.", []));
    }
    if (current.evidenceCoveragePercent < 45 || current.confidenceScore < 55) {
      events.push(makeEvent("review_recommended", currentReport, current, "Review recommended", "Evidence coverage or confidence is limited for this scan.", "A SYSTOLAB admin or customer operator should review the scan boundary before making major decisions.", []));
    }
  }

  return dedupeEvents(events).slice(-40);
}

function makeEvent(
  eventType: DecisionTimelineEvent["eventType"],
  report: ReportSnapshot,
  point: DecisionTimelinePoint,
  title: string,
  summary: string,
  businessMeaning: string,
  relatedRecommendationIds: string[]
): DecisionTimelineEvent {
  return {
    eventId: "dt_" + sha256([eventType, report.snapshotId, title, summary].join(":" )).slice(0, 20),
    eventType,
    capturedAt: point.capturedAt,
    snapshotId: point.snapshotId,
    title,
    summary: customerSafe(summary),
    businessMeaning: customerSafe(businessMeaning),
    confidenceScore: point.confidenceScore,
    evidenceCoveragePercent: point.evidenceCoveragePercent,
    relatedRecommendationIds
  };
}

function summarizeRecommendationValidation(validation: { recommendation: string; ossDelta: number | null; improvementStatus: string; confidenceReasons: string[] }): string {
  const delta = validation.ossDelta === null ? "OSS movement was not scored" : "OSS delta " + (validation.ossDelta >= 0 ? "+" : "") + validation.ossDelta;
  const reason = validation.confidenceReasons[0] ? " Reason: " + validation.confidenceReasons[0] : "";
  return validation.recommendation + ". " + delta + "; status " + validation.improvementStatus + "." + reason;
}

function buildVersionLedger(report: ReportSnapshot): DecisionTimelineOutput["versionLedger"] {
  return {
    engineVersion: SYSTOLAB_VERSION,
    intelligenceModelVersion: report.executionProvenance?.systemVersion ?? SYSTOLAB_VERSION,
    decisionFrameworkVersion: report.reportGovernance?.version ?? "SYSTOLAB Governance v1.0",
    reportTemplateVersion: report.structuredOutputSchema?.schemaVersion ?? "report-template-v1",
    currentScanDate: report.freshness?.capturedAt ?? report.createdAt
  };
}

function lifecycleForReport(report: ReportSnapshot): ReportLifecycleState {
  if (report.status === "completed") return "available";
  if (report.status === "analysis_limited" || report.status === "content_unavailable") return "limited";
  if (report.status === "failed") return "limited";
  return "available";
}

function evidenceCoveragePercent(report: ReportSnapshot): number {
  const pages = report.evidenceCoverageSummary?.pages ?? [];
  if (!pages.length) return report.evidenceCoverageSummary?.totalEvidenceObjects ? 35 : 0;
  const weighted = pages.map((page) => page.coverageStatus === "Complete" ? 100 : page.coverageStatus === "Partial" ? 60 : 25);
  return Math.round(average(weighted));
}

function summarizeTimeline(status: DecisionTimelineOutput["status"], count: number, scoreDelta: number | null, current: DecisionTimelinePoint): string {
  if (status === "content_unavailable") return "Decision Timeline is limited because current website content could not be collected.";
  if (count <= 1) return "Decision Timeline baseline has been created. Run future scans to measure business progress over time.";
  if (scoreDelta === null) return "Decision Timeline is active, but score movement is limited because one or more scans were not scored.";
  const direction = scoreDelta > 0 ? "improved" : scoreDelta < 0 ? "declined" : "remained stable";
  return "Across " + count + " scan(s), Business Readiness " + direction + " by " + (scoreDelta >= 0 ? "+" : "") + scoreDelta + " points. Current top decision: " + current.topDecision + ".";
}

function buildTimelineLimitations(report: ReportSnapshot, points: DecisionTimelinePoint[]): string[] {
  const limitations = [
    "Timeline conclusions are derived only from immutable SYSTOLAB snapshots for the same tenant and target URL.",
    "Revenue, conversion, ranking, or customer-intent changes are not claimed unless supported by validated evidence."
  ];
  if (points.length <= 1) limitations.push("Only one snapshot is available, so trend direction is not yet validated.");
  if (report.status === "content_unavailable" || report.oss?.scoringStatus === "not_scored") limitations.push("Current content was unavailable, so SYSTOLAB did not assign a negative score or infer business failure.");
  if (points.some((point) => point.evidenceCoveragePercent < 50)) limitations.push("One or more timeline points have limited evidence coverage, reducing confidence in movement interpretation.");
  return limitations;
}

function dedupeSnapshots(reports: ReportSnapshot[]): ReportSnapshot[] {
  const byId = new Map<string, ReportSnapshot>();
  for (const report of reports) byId.set(report.snapshotId, report);
  return [...byId.values()];
}

function dedupeEvents(events: DecisionTimelineEvent[]): DecisionTimelineEvent[] {
  const byId = new Map<string, DecisionTimelineEvent>();
  for (const event of events) byId.set(event.eventId, event);
  return [...byId.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

function customerSafe(value: string): string {
  return String(value ?? "")
    .replace(/evidenceId|traceId|raw DOM|selector|parser|crawler|headless|Cloudflare|JS Challenge/gi, "validated evidence")
    .trim();
}

function average(values: number[]): number {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return 0;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}
