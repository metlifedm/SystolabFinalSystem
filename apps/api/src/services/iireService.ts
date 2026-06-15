import PDFDocument from "pdfkit";
import type { InternalIntelligenceReport, InternalReportCadence, InternalReportExportFormat, ReportSnapshot } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";
import { AlertRecord } from "../models/AlertRecord.js";
import { CompetitorRelationshipRecord } from "../models/CompetitorRelationshipRecord.js";
import { EditEvent } from "../models/EditEvent.js";
import { EvidenceRecord } from "../models/EvidenceRecord.js";
import { InternalIntelligenceReportModel } from "../models/InternalIntelligenceReport.js";
import { InternalReportSchedule } from "../models/InternalReportSchedule.js";
import { NotificationOutbox } from "../models/NotificationOutbox.js";
import { OutcomeValidationRecord } from "../models/OutcomeValidationRecord.js";
import { Snapshot } from "../models/Snapshot.js";
import { getMemoryAlertRecords, getMemoryCompetitorRelationships, getMemoryEvidenceRecords, getMemoryHistory, getMemoryOutcomeRecords, type CompetitorRelationshipRecordInput } from "./intelligencePersistenceService.js";
import { listNotificationOutbox } from "./notificationService.js";
import { makeId, sha256 } from "../utils/crypto.js";

interface IireSourceBundle {
  snapshots: ReportSnapshot[];
  evidenceRows: Array<{ issue: string; evidenceType: string; confidenceScore: number }>;
  outcomeRows: Array<{ implementedStatus: string; improvementStatus: string; ossDelta: number | null; revenueImpactLow: number; revenueImpactHigh: number; confidenceScore: number }>;
  editEvents: Array<{ eventType: string; sessionFingerprint?: string; occurredAt?: Date }>;
  alerts: Array<{ type: string; severity: string; title: string; message: string; createdAt?: Date }>;
  notificationJobs: number;
  competitorRelationships: CompetitorRelationshipRecordInput[];
}

interface ReportPeriod {
  startAt: Date;
  endAt: Date;
  label: string;
}

const memoryInternalReports = new Map<string, InternalIntelligenceReport>();
const memoryInternalSchedules = new Map<string, { scheduleId: string; reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">; enabled: boolean; exportFormats: InternalReportExportFormat[]; lastRunAt?: Date; nextRunAt: Date }>();

type ScoredReportSnapshot = ReportSnapshot & { oss: ReportSnapshot["oss"] & { score: number } };

export async function generateInternalIntelligenceReport(input: {
  reportType: InternalReportCadence;
  startAt?: string | Date;
  endAt?: string | Date;
  generatedBy?: "scheduled" | "manual" | "event_triggered";
}): Promise<InternalIntelligenceReport> {
  const period = periodFor(input.reportType, input.startAt, input.endAt);
  const sources = await collectIireSources(period);
  const report = buildInternalReportFromSources(input.reportType, period, sources);
  await saveInternalReport(report, input.generatedBy ?? "manual");
  return report;
}

export async function getInternalReport(reportId: string): Promise<InternalIntelligenceReport | null> {
  if (!isMongoConnected()) return memoryInternalReports.get(reportId) ?? null;
  const row = await InternalIntelligenceReportModel.findOne({ reportId }).lean();
  return row?.report ?? null;
}

export async function listInternalReports(limit = 50): Promise<InternalIntelligenceReport[]> {
  if (!isMongoConnected()) return [...memoryInternalReports.values()].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, limit);
  const rows = await InternalIntelligenceReportModel.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => row.report);
}

export async function upsertInternalReportSchedule(input: {
  reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">;
  enabled?: boolean;
  exportFormats?: InternalReportExportFormat[];
  runNow?: boolean;
}): Promise<{ scheduleId: string; reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">; enabled: boolean; exportFormats: InternalReportExportFormat[]; lastRunAt?: Date; nextRunAt: Date }> {
  const scheduleId = `iire_${input.reportType}`;
  const schedule = {
    scheduleId,
    reportType: input.reportType,
    enabled: input.enabled !== false,
    exportFormats: input.exportFormats ?? ["pdf", "json"],
    nextRunAt: input.runNow ? new Date(Date.now() - 1000) : nextInternalRunFor(new Date(), input.reportType)
  };
  if (!isMongoConnected()) {
    memoryInternalSchedules.set(scheduleId, schedule);
    return schedule;
  }
  const saved = await InternalReportSchedule.findOneAndUpdate({ scheduleId }, schedule, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  }).lean();
  return normalizeInternalSchedule(saved);
}

export async function listInternalReportSchedules(): Promise<Array<{ scheduleId: string; reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">; enabled: boolean; exportFormats: InternalReportExportFormat[]; lastRunAt?: Date; nextRunAt: Date }>> {
  if (!isMongoConnected()) return [...memoryInternalSchedules.values()];
  const rows = await InternalReportSchedule.find({}).sort({ nextRunAt: 1 }).lean();
  return rows.map(normalizeInternalSchedule);
}

export async function runDueInternalReportSchedules(now = new Date()): Promise<{ processed: number; reportIds: string[]; failures: Array<{ scheduleId: string; reason: string }> }> {
  const due = isMongoConnected()
    ? (await InternalReportSchedule.find({ enabled: true, nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).limit(5).lean()).map(normalizeInternalSchedule)
    : [...memoryInternalSchedules.values()].filter((schedule) => schedule.enabled && schedule.nextRunAt.getTime() <= now.getTime()).slice(0, 5);
  const failures: Array<{ scheduleId: string; reason: string }> = [];
  const reportIds: string[] = [];
  for (const schedule of due) {
    try {
      const report = await generateInternalIntelligenceReport({ reportType: schedule.reportType, generatedBy: "scheduled" });
      reportIds.push(report.reportId);
      const updated = { ...schedule, lastRunAt: new Date(report.generatedAt), nextRunAt: nextInternalRunFor(new Date(report.generatedAt), schedule.reportType) };
      if (isMongoConnected()) {
        await InternalReportSchedule.findOneAndUpdate({ scheduleId: schedule.scheduleId }, { lastRunAt: updated.lastRunAt, nextRunAt: updated.nextRunAt });
      } else {
        memoryInternalSchedules.set(schedule.scheduleId, updated);
      }
    } catch (error) {
      failures.push({ scheduleId: schedule.scheduleId, reason: error instanceof Error ? error.message : "Unknown IIRE schedule failure" });
    }
  }
  return { processed: reportIds.length, reportIds, failures };
}

export async function generateEventTriggeredInternalReport(): Promise<InternalIntelligenceReport | null> {
  try {
    return await generateInternalIntelligenceReport({ reportType: "event_triggered", generatedBy: "event_triggered" });
  } catch {
    return null;
  }
}

export async function exportInternalReport(report: InternalIntelligenceReport, format: InternalReportExportFormat): Promise<{ body: Buffer | string; contentType: string; filename: string }> {
  if (format === "json" || format === "dashboard") {
    return {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
      filename: `${report.reportId}.json`
    };
  }
  if (format === "pdf") {
    return {
      body: await renderInternalReportPdf(report),
      contentType: "application/pdf",
      filename: `${report.reportId}.pdf`
    };
  }
  const rows = flattenInternalReportRows(report);
  if (format === "spreadsheet") {
    return {
      body: rowsToSpreadsheetHtml(rows),
      contentType: "application/vnd.ms-excel",
      filename: `${report.reportId}.xls`
    };
  }
  return {
    body: rowsToCsv(rows),
    contentType: "text/csv",
    filename: `${report.reportId}.csv`
  };
}

export function buildInternalReportFromSources(reportType: InternalReportCadence, period: ReportPeriod, sources: IireSourceBundle): InternalIntelligenceReport {
  const scans = sources.snapshots;
  const completedScans = scans.filter((scan) => scan.status === "completed");
  const scoredScans = scans.filter(isScoredSnapshot);
  const averageOss = average(scoredScans.map((scan) => scan.oss.score));
  const industries = groupBy(scans, (scan) => scan.industryBenchmarkEngine?.industryType ?? "unknown");
  const competitors = new Map<string, { observations: number; latestOssDelta: number | null; threatLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; reasons: string[] }>();
  for (const scan of scans) {
    for (const competitor of scan.competitorIntelligenceEngine?.competitors ?? []) {
      const existing = competitors.get(competitor.competitorUrl) ?? { observations: 0, latestOssDelta: null, threatLevel: "UNKNOWN" as const, reasons: [] };
      existing.observations += 1;
      existing.latestOssDelta = competitor.latestMovement.ossDelta;
      existing.reasons.push(...competitor.latestMovement.changedDimensions.map((item) => item.suspectedReason));
      competitors.set(competitor.competitorUrl, existing);
    }
    for (const threat of scan.competitiveThreatRadar?.threats ?? []) {
      const existing = competitors.get(threat.competitorUrl) ?? { observations: 0, latestOssDelta: null, threatLevel: "UNKNOWN" as const, reasons: [] };
      existing.threatLevel = threat.severity === "high" ? "HIGH" : threat.severity === "medium" && existing.threatLevel !== "HIGH" ? "MEDIUM" : existing.threatLevel === "UNKNOWN" ? "LOW" : existing.threatLevel;
      existing.reasons.push(threat.reason);
      competitors.set(threat.competitorUrl, existing);
    }
  }

  const recommendationGroups = groupBy(scans.flatMap((scan) => scan.recommendationEngine?.recommendations ?? []), (recommendation) => recommendation.issue.split(":")[0] ?? recommendation.issue);
  const outcomeGroups = groupBy(sources.outcomeRows, (outcome) => outcome.implementedStatus);
  const eventCounts = countBy(sources.editEvents, (event) => event.eventType);
  const funnelSteps = ["scan_started", "scan_completed", "report_viewed", "recommendation_viewed", "report_downloaded"];
  const funnelCounts = funnelSteps.map((step) => eventCounts[step] ?? 0);
  const commonWeaknesses = countBy(scans.flatMap((scan) => scan.dimensions.filter((dimension) => dimension.score < 60).map((dimension) => dimension.label)), (label) => label);
  const topWeaknesses = topEntries(commonWeaknesses, 5).map(([label]) => label);
  const revenueLow = sum(scans.map((scan) => scan.revenueIntelligence?.revenueOpportunityRange.low ?? 0));
  const revenueHigh = sum(scans.map((scan) => scan.revenueIntelligence?.revenueOpportunityRange.high ?? 0));
  const validatedLow = sum(sources.outcomeRows.map((outcome) => outcome.revenueImpactLow));
  const validatedHigh = sum(sources.outcomeRows.map((outcome) => outcome.revenueImpactHigh));
  const alignmentScore = revenueHigh > 0 ? clampPercent(100 - Math.abs(revenueHigh - validatedHigh) / Math.max(1, revenueHigh) * 100) : 0;
  const sessions = new Set(sources.editEvents.map((event) => event.sessionFingerprint).filter(Boolean));
  const reportViews = eventCounts.report_viewed ?? 0;
  const recommendationViews = eventCounts.recommendation_viewed ?? 0;
  const downloads = eventCounts.report_downloaded ?? 0;
  const abandonments = Math.max(0, (eventCounts.scan_started ?? 0) - (eventCounts.scan_completed ?? 0));
  const threatHighCount = scans.filter((scan) => scan.competitiveThreatRadar?.threatLevel === "HIGH").length;
  const competitorRelationshipGraph = buildCompetitorRelationshipGraph(sources.competitorRelationships, scans);

  const reportId = makeId("iire");
  const industryTrendAnalysis = Object.entries(industries).map(([industryType, industryScans]) => {
    const dimensionAverages = dimensionAveragesFor(industryScans);
    const sorted = Object.entries(dimensionAverages).sort((a, b) => b[1] - a[1]);
    const leakage = sum(industryScans.map((scan) => scan.revenueIntelligence?.revenueOpportunityRange.high ?? 0));
    return {
      industryType,
      strongestDimension: sorted[0]?.[0] ?? "Unknown",
      weakestDimension: sorted.at(-1)?.[0] ?? "Unknown",
      revenueLeakageUnits: leakage,
      opportunityScore: clampPercent((100 - average(scoredOssValues(industryScans))) + leakage / 10)
    };
  });

  const recommendationEffectiveness = Object.entries(recommendationGroups).map(([pattern, items]) => {
    const relatedOutcomes = sources.outcomeRows.filter((outcome) => outcome.implementedStatus === "validated");
    const averageDelta = average(relatedOutcomes.map((outcome) => outcome.ossDelta ?? 0));
    return {
      recommendationPattern: pattern,
      generatedCount: items.length,
      validatedCount: relatedOutcomes.length,
      averageOssDelta: averageDelta,
      effectivenessScore: clampPercent((relatedOutcomes.length / Math.max(1, items.length)) * 70 + Math.max(0, averageDelta) * 3)
    };
  }).sort((a, b) => b.effectivenessScore - a.effectivenessScore).slice(0, 12);

  const intelligenceDiscoveryInsights = buildDiscoveryInsights(scans, topWeaknesses, eventCounts, industryTrendAnalysis, threatHighCount);
  const opportunityDiscoveries = buildOpportunityDiscoveries(topWeaknesses, industryTrendAnalysis, recommendationEffectiveness, scans.length);
  const anomalyAlerts = buildInternalAnomalies(scans, sources.alerts, abandonments, period.endAt);
  const knowledgeGrowthScore = buildKnowledgeGrowthScore({
    scans,
    industryCount: Object.keys(industries).length,
    competitorRelationshipGraph,
    revenueAlignmentScore: alignmentScore,
    recommendationEffectiveness,
    outcomeRows: sources.outcomeRows,
    editEvents: sources.editEvents,
    intelligenceDiscoveryInsights
  });

  return {
    reportId,
    reportType,
    title: `SYSTOLAB Internal Intelligence Report - ${period.label}`,
    generatedAt: new Date().toISOString(),
    period: {
      startAt: period.startAt.toISOString(),
      endAt: period.endAt.toISOString(),
      label: period.label
    },
    accessScope: "internal_admin_only",
    sourceSummary: {
      scans: scans.length,
      completedScans: completedScans.length,
      industries: Object.keys(industries).length,
      competitorsTracked: competitors.size,
      evidenceRows: sources.evidenceRows.length,
      outcomeValidations: sources.outcomeRows.length,
      editEvents: sources.editEvents.length,
      alerts: sources.alerts.length
    },
    executiveSummary: [
      `${scans.length} scan(s) were analyzed for ${period.label}; ${completedScans.length} completed successfully.`,
      `Average OSS is ${averageOss}, with ${topWeaknesses[0] ?? "no dominant"} as the most common weakness.`,
      `Revenue leakage range totals ${revenueLow}-${revenueHigh} structural value units; validated impact totals ${validatedLow}-${validatedHigh}.`,
      `${sources.alerts.length} alert(s), ${competitors.size} tracked competitor(s), and ${sources.editEvents.length} first-party behavior event(s) contributed to this report.`
    ],
    marketIntelligence: Object.entries(industries).map(([industryType, industryScans]) => ({
      industryType,
      scanCount: industryScans.length,
      averageOss: average(scoredOssValues(industryScans)),
      trend: trendForSnapshots(industryScans),
      commonWeaknesses: topEntries(countBy(industryScans.flatMap((scan) => scan.dimensions.filter((dimension) => dimension.score < 60).map((dimension) => dimension.label)), (label) => label), 3).map(([label]) => label)
    })),
    industryTrendAnalysis,
    revenueLeakageTrends: {
      estimatedLowUnits: revenueLow,
      estimatedHighUnits: revenueHigh,
      validatedLowUnits: validatedLow,
      validatedHighUnits: validatedHigh,
      alignmentScore,
      notes: [
        "Alignment compares structural value-unit estimates with validated outcome value units.",
        "Currency accuracy requires first-party business value inputs."
      ]
    },
    competitorMovementReport: [...competitors.entries()].map(([competitorUrl, value]) => ({ competitorUrl, ...value, reasons: value.reasons.slice(0, 5) })),
    competitorRelationshipGraph,
    recommendationEffectiveness,
    ossDistribution: {
      critical: scoredScans.filter((scan) => scan.oss.score < 40).length,
      friction: scoredScans.filter((scan) => scan.oss.score >= 40 && scan.oss.score < 75).length,
      optimization: scoredScans.filter((scan) => scan.oss.score >= 75).length,
      averageOss
    },
    behavioralAnalytics: {
      eventsByType: eventCounts,
      abandonmentSignals: abandonments,
      reportDownloadRate: reportViews ? Number(((downloads / reportViews) * 100).toFixed(2)) : 0,
      recommendationViewRate: reportViews ? Number(((recommendationViews / reportViews) * 100).toFixed(2)) : 0
    },
    churnIntelligence: {
      possibleChurnSignals: abandonments,
      highAbandonmentSessions: sessions.size ? Math.min(sessions.size, abandonments) : 0,
      notes: abandonments > 0 ? ["Scan starts exceeded scan completions during this period."] : ["No platform-level abandonment anomaly was detected."]
    },
    conversionFunnelAnalysis: funnelSteps.map((step, index) => {
      const observedCount = funnelCounts[index] ?? 0;
      const previousCount = index === 0 ? observedCount : funnelCounts[index - 1] ?? 0;
      return {
        step,
        observedCount,
        conversionFromPreviousPercent: index === 0 ? 100 : previousCount ? Number(((observedCount / previousCount) * 100).toFixed(2)) : 0
      };
    }),
    businessDnaDiscoveries: topEntries(countBy(scans.flatMap((scan) => [...(scan.businessDnaEngine?.strengths ?? []), ...(scan.businessDnaEngine?.weaknesses ?? [])]), (pattern) => pattern), 8).map(([pattern, frequency]) => ({
      pattern,
      frequency,
      affectedIndustries: Object.entries(industries).filter(([, industryScans]) => industryScans.some((scan) => [...(scan.businessDnaEngine?.strengths ?? []), ...(scan.businessDnaEngine?.weaknesses ?? [])].includes(pattern))).map(([industry]) => industry)
    })),
    outcomeValidationFindings: Object.entries(outcomeGroups).map(([status, items]) => ({
      status,
      count: items.length,
      averageOssDelta: average(items.map((item) => item.ossDelta ?? 0)),
      evidenceStrength: confidenceLabel(average(items.map((item) => item.confidenceScore)))
    })),
    intelligenceAccuracyMetrics: [
      {
        metric: "Revenue Intelligence Alignment",
        score: alignmentScore,
        basis: `${revenueHigh} estimated high units compared with ${validatedHigh} validated high units.`,
        recalibrationRecommendation: alignmentScore < 60 ? "Lower default revenue opportunity ranges for under-validated segments." : "Keep current structural value-unit calibration."
      },
      {
        metric: "Outcome Validation Confidence",
        score: average(sources.outcomeRows.map((outcome) => outcome.confidenceScore)),
        basis: `${sources.outcomeRows.length} outcome validation row(s).`,
        recalibrationRecommendation: sources.outcomeRows.length < 10 ? "Collect more repeat-scan outcome records before model adjustment." : "Use validated outcomes to tune recommendation lift ranges."
      }
    ],
    knowledgeGrowthScore,
    platformGrowthIndicators: {
      scanGrowthRate: scanGrowthRate(scans),
      activeWorkspaceCount: new Set(scans.map((scan) => `${scan.tenantBranding.slug}:${scan.targetUrl}`)).size,
      monitoredTargets: scans.filter((scan) => scan.monitoringScheduler?.enabled).length,
      generatedAlerts: sources.alerts.length,
      notificationJobs: sources.notificationJobs
    },
    intelligenceDiscoveryInsights,
    opportunityDiscoveries,
    anomalyAlerts
  };
}

export function flattenInternalReportRows(report: InternalIntelligenceReport): string[][] {
  const rows: string[][] = [["section", "metric", "value"]];
  rows.push(["summary", "title", report.title]);
  rows.push(["summary", "period", report.period.label]);
  for (const [key, value] of Object.entries(report.sourceSummary)) rows.push(["sourceSummary", key, String(value)]);
  for (const line of report.executiveSummary) rows.push(["executiveSummary", "line", line]);
  for (const item of report.marketIntelligence) rows.push(["marketIntelligence", item.industryType, `scans=${item.scanCount}; averageOss=${item.averageOss}; trend=${item.trend}; weaknesses=${item.commonWeaknesses.join("|")}`]);
  for (const item of report.recommendationEffectiveness) rows.push(["recommendationEffectiveness", item.recommendationPattern, `generated=${item.generatedCount}; validated=${item.validatedCount}; score=${item.effectivenessScore}`]);
  rows.push(["competitorRelationshipGraph", "nodes", String(report.competitorRelationshipGraph.nodes.length)]);
  rows.push(["competitorRelationshipGraph", "edges", String(report.competitorRelationshipGraph.edges.length)]);
  for (const item of report.competitorRelationshipGraph.influenceLeaders) rows.push(["competitorInfluence", item.competitorUrl, `references=${item.referencedByBusinesses}; score=${item.influenceScore}; velocity=${item.growthVelocity}`]);
  rows.push(["knowledgeGrowthScore", "overall", `${report.knowledgeGrowthScore.overallScore}; ${report.knowledgeGrowthScore.trend}`]);
  for (const item of report.knowledgeGrowthScore.dimensions) rows.push(["knowledgeGrowthScore", item.dimension, `${item.score}; ${item.evidenceGains.join("|")}`]);
  for (const item of report.intelligenceDiscoveryInsights) rows.push(["discovery", item.title, item.finding]);
  for (const item of report.opportunityDiscoveries) rows.push(["opportunity", item.title, `${item.priority}; impactUnits=${item.estimatedImpactUnits}; ${item.rationale}`]);
  for (const item of report.anomalyAlerts) rows.push(["anomaly", item.title, `${item.severity}; ${item.explanation}`]);
  return rows;
}

async function collectIireSources(period: ReportPeriod): Promise<IireSourceBundle> {
  if (!isMongoConnected()) {
    const reports = getMemoryHistory().map((item) => item.report).filter((report) => isWithin(report.createdAt, period));
    return {
      snapshots: reports,
      evidenceRows: getMemoryEvidenceRecords().filter((row) => isWithin(row.capturedAt, period)).map((row) => ({ issue: row.issue, evidenceType: row.evidenceType, confidenceScore: row.confidenceScore })),
      outcomeRows: getMemoryOutcomeRecords().filter((row) => reports.some((report) => report.snapshotId === row.snapshotId)).map((row) => ({
        implementedStatus: row.item.implementedStatus,
        improvementStatus: row.item.improvementStatus,
        ossDelta: row.item.ossDelta,
        revenueImpactLow: row.item.revenueImpact.low,
        revenueImpactHigh: row.item.revenueImpact.high,
        confidenceScore: row.item.confidenceScore
      })),
      editEvents: [],
      alerts: getMemoryAlertRecords().map((alert) => ({ type: alert.type, severity: alert.severity, title: alert.title, message: alert.message })),
      notificationJobs: (await listNotificationOutbox()).length,
      competitorRelationships: getMemoryCompetitorRelationships().filter((row) => row.capturedAt >= period.startAt && row.capturedAt <= period.endAt)
    };
  }

  const [snapshotRows, evidenceRows, outcomeRows, editRows, alertRows, notifications, competitorRelationshipRows] = await Promise.all([
    Snapshot.find({ createdAt: { $gte: period.startAt, $lte: period.endAt } }).sort({ createdAt: 1 }).lean(),
    EvidenceRecord.find({ capturedAt: { $gte: period.startAt, $lte: period.endAt } }).lean(),
    OutcomeValidationRecord.find({ createdAt: { $gte: period.startAt, $lte: period.endAt } }).lean(),
    EditEvent.find({ occurredAt: { $gte: period.startAt, $lte: period.endAt } }).lean(),
    AlertRecord.find({ createdAt: { $gte: period.startAt, $lte: period.endAt } }).lean(),
    NotificationOutbox.countDocuments({ queuedAt: { $gte: period.startAt, $lte: period.endAt } }),
    CompetitorRelationshipRecord.find({ capturedAt: { $gte: period.startAt, $lte: period.endAt } }).lean()
  ]);

  return {
    snapshots: snapshotRows.map((row) => row.report),
    evidenceRows: evidenceRows.map((row) => ({ issue: row.issue, evidenceType: row.evidenceType, confidenceScore: row.confidenceScore })),
    outcomeRows: outcomeRows.map((row) => ({
      implementedStatus: row.implementedStatus,
      improvementStatus: row.improvementStatus,
      ossDelta: row.ossDelta,
      revenueImpactLow: row.revenueImpactLow,
      revenueImpactHigh: row.revenueImpactHigh,
      confidenceScore: row.confidenceScore
    })),
    editEvents: editRows.map((row) => ({ eventType: row.eventType, sessionFingerprint: row.sessionFingerprint, occurredAt: row.occurredAt })),
    alerts: alertRows.map((row) => ({ type: row.type, severity: row.severity, title: row.title, message: row.message, createdAt: row.createdAt })),
    notificationJobs: notifications,
    competitorRelationships: competitorRelationshipRows.map((row) => ({
      relationshipId: row.relationshipId,
      snapshotId: row.snapshotId,
      workspaceId: row.workspaceId,
      tenantSlug: row.tenantSlug,
      businessUrl: row.businessUrl,
      competitorUrl: row.competitorUrl,
      competitorLabel: row.competitorLabel,
      industryType: row.industryType,
      geography: row.geography,
      marketSegment: row.marketSegment,
      primaryOss: row.primaryOss,
      competitorOss: row.competitorOss,
      primaryTrustScore: row.primaryTrustScore,
      competitorTrustScore: row.competitorTrustScore,
      primaryConversionScore: row.primaryConversionScore,
      competitorConversionScore: row.competitorConversionScore,
      revenueOpportunityLow: row.revenueOpportunityLow,
      revenueOpportunityHigh: row.revenueOpportunityHigh,
      threatLevel: row.threatLevel,
      observations: row.observations,
      capturedAt: row.capturedAt
    }))
  };
}

async function saveInternalReport(report: InternalIntelligenceReport, generatedBy: "scheduled" | "manual" | "event_triggered"): Promise<void> {
  if (!isMongoConnected()) {
    memoryInternalReports.set(report.reportId, report);
    return;
  }
  await InternalIntelligenceReportModel.create({
    reportId: report.reportId,
    reportType: report.reportType,
    periodStartAt: new Date(report.period.startAt),
    periodEndAt: new Date(report.period.endAt),
    report,
    generatedBy
  });
}

function periodFor(reportType: InternalReportCadence, startAt?: string | Date, endAt?: string | Date): ReportPeriod {
  const end = endAt ? new Date(endAt) : new Date();
  const start = startAt ? new Date(startAt) : new Date(end);
  if (!startAt) {
    if (reportType === "daily" || reportType === "event_triggered") start.setUTCDate(end.getUTCDate() - 1);
    if (reportType === "weekly") start.setUTCDate(end.getUTCDate() - 7);
    if (reportType === "monthly") start.setUTCMonth(end.getUTCMonth() - 1);
    if (reportType === "quarterly") start.setUTCMonth(end.getUTCMonth() - 3);
    if (reportType === "annual") start.setUTCFullYear(end.getUTCFullYear() - 1);
  }
  return {
    startAt: start,
    endAt: end,
    label: `${reportType.replaceAll("_", " ")} ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
  };
}

function nextInternalRunFor(from: Date, reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">): Date {
  const next = new Date(from);
  if (reportType === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (reportType === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (reportType === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  if (reportType === "quarterly") next.setUTCMonth(next.getUTCMonth() + 3);
  if (reportType === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

async function renderInternalReportPdf(report: InternalIntelligenceReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 44, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fillColor("#17201d").fontSize(18).text(report.title).fontSize(9).fillColor("#52605a").text(`Internal only | ${report.generatedAt}`).moveDown();
    for (const line of report.executiveSummary) doc.fillColor("#17201d").fontSize(10).text(`- ${line}`);
    writePdfSection(doc, "Market Intelligence", report.marketIntelligence.map((item) => `${item.industryType}: scans ${item.scanCount}, OSS ${item.averageOss}, trend ${item.trend}, weaknesses ${item.commonWeaknesses.join(", ")}`));
    writePdfSection(doc, "Recommendation Effectiveness", report.recommendationEffectiveness.map((item) => `${item.recommendationPattern}: generated ${item.generatedCount}, validated ${item.validatedCount}, score ${item.effectivenessScore}`));
    writePdfSection(doc, "Revenue Leakage Trends", [`Estimated ${report.revenueLeakageTrends.estimatedLowUnits}-${report.revenueLeakageTrends.estimatedHighUnits}; validated ${report.revenueLeakageTrends.validatedLowUnits}-${report.revenueLeakageTrends.validatedHighUnits}; alignment ${report.revenueLeakageTrends.alignmentScore}%`]);
    writePdfSection(doc, "Competitor Relationship Graph", [
      `Nodes ${report.competitorRelationshipGraph.nodes.length}; edges ${report.competitorRelationshipGraph.edges.length}; clusters ${report.competitorRelationshipGraph.marketClusters.length}.`,
      ...report.competitorRelationshipGraph.influenceLeaders.slice(0, 8).map((item) => `${item.competitorUrl}: influence ${item.influenceScore}, references ${item.referencedByBusinesses}, velocity ${item.growthVelocity}`)
    ]);
    writePdfSection(doc, "Knowledge Growth Score", [
      `Overall ${report.knowledgeGrowthScore.overallScore}; trend ${report.knowledgeGrowthScore.trend}. ${report.knowledgeGrowthScore.interpretation}`,
      ...report.knowledgeGrowthScore.dimensions.map((item) => `${item.dimension}: ${item.score} - ${item.evidenceGains.join("; ")}`)
    ]);
    writePdfSection(doc, "Discovery Insights", report.intelligenceDiscoveryInsights.map((item) => `${item.title}: ${item.finding}`));
    writePdfSection(doc, "Opportunity Discoveries", report.opportunityDiscoveries.map((item) => `${item.priority}: ${item.title} - ${item.rationale}`));
    writePdfSection(doc, "Anomalies", report.anomalyAlerts.map((item) => `${item.severity}: ${item.title} - ${item.explanation}`));
    doc.end();
  });
}

function writePdfSection(doc: PDFKit.PDFDocument, title: string, lines: string[]): void {
  doc.moveDown(0.8).fillColor("#17201d").fontSize(13).text(title);
  if (lines.length === 0) doc.fillColor("#52605a").fontSize(9).text("No records for this period.");
  for (const line of lines.slice(0, 16)) doc.fillColor("#52605a").fontSize(9).text(line);
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
}

function rowsToSpreadsheetHtml(rows: string[][]): string {
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${body}</table></body></html>`;
}

function buildDiscoveryInsights(scans: ReportSnapshot[], topWeaknesses: string[], eventCounts: Record<string, number>, trends: InternalIntelligenceReport["industryTrendAnalysis"], threatHighCount: number): InternalIntelligenceReport["intelligenceDiscoveryInsights"] {
  const insights: InternalIntelligenceReport["intelligenceDiscoveryInsights"] = [];
  if (topWeaknesses[0]) {
    insights.push({
      insightId: `IDE-${sha256(topWeaknesses[0]).slice(0, 8)}`,
      category: "industry_gap",
      title: `${topWeaknesses[0]} is the most repeated weakness`,
      finding: `${topWeaknesses[0]} appears repeatedly across scanned businesses and should guide productized remediation playbooks.`,
      confidenceScore: scans.length >= 10 ? 82 : 64,
      evidenceBasis: [`${scans.length} scan(s) analyzed`, "Dimension scores below 60 were counted."]
    });
  }
  const highestLeakage = [...trends].sort((a, b) => b.revenueLeakageUnits - a.revenueLeakageUnits)[0];
  if (highestLeakage) {
    insights.push({
      insightId: `IDE-${sha256(highestLeakage.industryType).slice(0, 8)}`,
      category: "market_shift",
      title: `${highestLeakage.industryType} shows the largest structural leakage`,
      finding: `${highestLeakage.industryType} produced ${highestLeakage.revenueLeakageUnits} opportunity units in this period.`,
      confidenceScore: highestLeakage.opportunityScore,
      evidenceBasis: ["Revenue Intelligence structural value units", "Industry benchmark grouping"]
    });
  }
  if ((eventCounts.scan_started ?? 0) > (eventCounts.scan_completed ?? 0)) {
    insights.push({
      insightId: "IDE-BEHAVIOR-ABANDONMENT",
      category: "behavioral_pattern",
      title: "Scan abandonment signal detected",
      finding: "Scan starts exceeded scan completions, suggesting friction in the scan setup or wait state.",
      confidenceScore: 70,
      evidenceBasis: ["Edit Intelligence first-party events"]
    });
  }
  if (threatHighCount > 0) {
    insights.push({
      insightId: "IDE-COMP-HIGH-THREAT",
      category: "competitor_pattern",
      title: "High threat competitor landscapes observed",
      finding: `${threatHighCount} scan(s) showed HIGH competitive threat levels.`,
      confidenceScore: 76,
      evidenceBasis: ["Competitive Threat Radar outputs"]
    });
  }
  return insights;
}

function buildOpportunityDiscoveries(topWeaknesses: string[], trends: InternalIntelligenceReport["industryTrendAnalysis"], effectiveness: InternalIntelligenceReport["recommendationEffectiveness"], scanCount: number): InternalIntelligenceReport["opportunityDiscoveries"] {
  const opportunities: InternalIntelligenceReport["opportunityDiscoveries"] = [];
  for (const weakness of topWeaknesses.slice(0, 3)) {
    opportunities.push({
      opportunityId: `ODE-${sha256(weakness).slice(0, 8)}`,
      opportunityType: "service",
      title: `${weakness} remediation package`,
      rationale: `${weakness} is recurring enough to justify a standardized service/playbook.`,
      priority: scanCount >= 10 ? "high" : "medium",
      estimatedImpactUnits: 100 + scanCount * 5
    });
  }
  const strongest = [...effectiveness].sort((a, b) => b.effectivenessScore - a.effectivenessScore)[0];
  if (strongest) {
    opportunities.push({
      opportunityId: `ODE-AUTO-${sha256(strongest.recommendationPattern).slice(0, 8)}`,
      opportunityType: "automation",
      title: `Automate ${strongest.recommendationPattern} fixes`,
      rationale: "Recommendation effectiveness suggests this pattern may support automated implementation assistance.",
      priority: strongest.effectivenessScore >= 70 ? "high" : "medium",
      estimatedImpactUnits: strongest.effectivenessScore * 3
    });
  }
  const topTrend = [...trends].sort((a, b) => b.opportunityScore - a.opportunityScore)[0];
  if (topTrend) {
    opportunities.push({
      opportunityId: `ODE-MARKET-${sha256(topTrend.industryType).slice(0, 8)}`,
      opportunityType: "market_segment",
      title: `${topTrend.industryType} growth segment`,
      rationale: `${topTrend.industryType} combines high opportunity score with visible structural gaps.`,
      priority: topTrend.opportunityScore >= 70 ? "high" : "medium",
      estimatedImpactUnits: topTrend.revenueLeakageUnits
    });
  }
  return opportunities;
}

function buildInternalAnomalies(scans: ReportSnapshot[], alerts: IireSourceBundle["alerts"], abandonments: number, detectedAt: Date): InternalIntelligenceReport["anomalyAlerts"] {
  const anomalies: InternalIntelligenceReport["anomalyAlerts"] = [];
  const criticalScans = scans.filter(isScoredSnapshot).filter((scan) => scan.oss.score < 40).length;
  if (criticalScans > 0) anomalies.push({ anomalyId: "ANOM-CRITICAL-OSS", severity: "high", title: "Critical OSS cluster", explanation: `${criticalScans} scan(s) were below 40 OSS.`, detectedAt: detectedAt.toISOString() });
  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical").length;
  if (criticalAlerts > 0) anomalies.push({ anomalyId: "ANOM-CRITICAL-ALERTS", severity: "critical", title: "Critical platform alerts", explanation: `${criticalAlerts} critical alert(s) were generated.`, detectedAt: detectedAt.toISOString() });
  if (abandonments >= 3) anomalies.push({ anomalyId: "ANOM-FUNNEL-ABANDONMENT", severity: "medium", title: "Funnel abandonment spike", explanation: `${abandonments} scan-start events did not reach scan completion.`, detectedAt: detectedAt.toISOString() });
  return anomalies;
}

function buildCompetitorRelationshipGraph(relationshipRows: CompetitorRelationshipRecordInput[], scans: ReportSnapshot[]): InternalIntelligenceReport["competitorRelationshipGraph"] {
  const rows = relationshipRows.length > 0 ? relationshipRows : competitorRowsFromSnapshots(scans);
  const graph: InternalIntelligenceReport["competitorRelationshipGraph"] = {
    status: rows.length === 0 ? "empty" : rows.length >= 2 ? "active" : "limited",
    nodes: [],
    edges: [],
    marketClusters: [],
    influenceLeaders: [],
    insights: []
  };
  if (rows.length === 0) {
    graph.insights.push("No competitor relationships were available in this period.");
    return graph;
  }

  const nodes = new Map<string, InternalIntelligenceReport["competitorRelationshipGraph"]["nodes"][number]>();
  const edgeGroups = new Map<string, Array<CompetitorRelationshipRecordInput & { latestOssDelta: number | null }>>();

  for (const row of rows) {
    const businessNode = crgNodeId("business", row.businessUrl);
    const competitorNode = crgNodeId("competitor", row.competitorUrl);
    const industryNode = crgNodeId("industry", row.industryType);
    const segmentNode = crgNodeId("market_segment", row.marketSegment);
    const locationNode = row.geography && row.geography !== "unknown" ? crgNodeId("location", row.geography) : null;
    const latestOssDelta = row.competitorOss === null ? null : row.competitorOss - row.primaryOss;

    upsertCrgNode(nodes, {
      nodeId: businessNode,
      type: "business",
      label: row.businessUrl,
      prominenceScore: clampPercent(row.primaryOss),
      metadata: {
        tenantSlug: row.tenantSlug,
        workspaceId: row.workspaceId,
        latestOss: row.primaryOss,
        trustScore: row.primaryTrustScore,
        conversionScore: row.primaryConversionScore
      }
    });
    upsertCrgNode(nodes, {
      nodeId: competitorNode,
      type: "competitor",
      label: row.competitorLabel || row.competitorUrl,
      prominenceScore: competitorProminence([row]),
      metadata: {
        competitorUrl: row.competitorUrl,
        latestOss: row.competitorOss,
        trustScore: row.competitorTrustScore,
        conversionScore: row.competitorConversionScore,
        threatLevel: row.threatLevel
      }
    });
    upsertCrgNode(nodes, {
      nodeId: industryNode,
      type: "industry",
      label: row.industryType,
      prominenceScore: 50,
      metadata: { industryType: row.industryType }
    });
    upsertCrgNode(nodes, {
      nodeId: segmentNode,
      type: "market_segment",
      label: row.marketSegment,
      prominenceScore: 50,
      metadata: { industryType: row.industryType, geography: row.geography }
    });
    if (locationNode) {
      upsertCrgNode(nodes, {
        nodeId: locationNode,
        type: "location",
        label: row.geography,
        prominenceScore: 45,
        metadata: { geography: row.geography }
      });
    }

    addCrgEdge(edgeGroups, businessNode, competitorNode, "competes_with", row, latestOssDelta);
    addCrgEdge(edgeGroups, businessNode, industryNode, "belongs_to_industry", row, null);
    addCrgEdge(edgeGroups, competitorNode, industryNode, "belongs_to_industry", row, null);
    addCrgEdge(edgeGroups, businessNode, segmentNode, "overlaps_with", row, latestOssDelta);
    addCrgEdge(edgeGroups, competitorNode, segmentNode, "overlaps_with", row, latestOssDelta);
    if (locationNode) {
      addCrgEdge(edgeGroups, businessNode, locationNode, "operates_in_location", row, null);
      addCrgEdge(edgeGroups, competitorNode, locationNode, "operates_in_location", row, null);
    }
  }

  const competitorGroups = groupBy(rows, (row) => row.competitorUrl);
  for (const items of Object.values(competitorGroups)) {
    const node = nodes.get(crgNodeId("competitor", items[0]!.competitorUrl));
    if (node) node.prominenceScore = competitorProminence(items);
  }
  const clusterGroups = groupBy(rows, (row) => row.marketSegment || `${row.industryType}:${row.geography}`);
  graph.marketClusters = Object.entries(clusterGroups).map(([clusterKey, items]) => {
    const competitorCounts = countBy(items, (item) => item.competitorUrl);
    const topCompetitors = topEntries(competitorCounts, 5);
    const highVelocity = topCompetitors
      .map(([competitorUrl]) => {
        const velocity = growthVelocityFor(items.filter((item) => item.competitorUrl === competitorUrl));
        return { competitorUrl, velocity };
      })
      .filter((item) => item.velocity > 0)
      .sort((a, b) => b.velocity - a.velocity)
      .map((item) => item.competitorUrl);
    const topShare = topCompetitors[0]?.[1] ?? 0;
    return {
      clusterId: `cluster_${sha256(clusterKey).slice(0, 12)}`,
      industryType: items[0]?.industryType ?? "unknown",
      location: items[0]?.geography ?? "unknown",
      businessCount: new Set(items.map((item) => item.businessUrl)).size,
      competitorCount: new Set(items.map((item) => item.competitorUrl)).size,
      concentrationScore: clampPercent((topShare / Math.max(1, items.length)) * 100),
      dominantCompetitors: topCompetitors.slice(0, 3).map(([competitorUrl]) => competitorUrl),
      emergingChallengers: highVelocity.slice(0, 3)
    };
  }).sort((a, b) => b.concentrationScore - a.concentrationScore);

  graph.influenceLeaders = Object.entries(competitorGroups).map(([competitorUrl, items]) => {
    const growthVelocity = growthVelocityFor(items);
    return {
      competitorUrl,
      referencedByBusinesses: new Set(items.map((item) => item.businessUrl)).size,
      industries: [...new Set(items.map((item) => item.industryType))].sort(),
      locations: [...new Set(items.map((item) => item.geography))].filter((location) => location !== "unknown").sort(),
      influenceScore: competitorProminence(items),
      growthVelocity
    };
  }).sort((a, b) => b.influenceScore - a.influenceScore).slice(0, 12);

  graph.nodes = [...nodes.values()].sort((a, b) => b.prominenceScore - a.prominenceScore || a.label.localeCompare(b.label));
  graph.edges = [...edgeGroups.entries()].map(([edgeKey, items]) => {
    const [from, to, relationship] = edgeKey.split("|") as [string, string, InternalIntelligenceReport["competitorRelationshipGraph"]["edges"][number]["relationship"]];
    const deltas = items.map((item) => item.latestOssDelta).filter((value): value is number => value !== null);
    return {
      edgeId: `edge_${sha256(edgeKey).slice(0, 16)}`,
      from,
      to,
      relationship,
      weight: clampPercent(items.length * 12 + Math.abs(average(deltas)) * 2),
      observations: items.length,
      latestOssDelta: deltas.length ? deltas.at(-1)! : null
    };
  }).sort((a, b) => b.weight - a.weight);

  const topLeader = graph.influenceLeaders[0];
  const topCluster = graph.marketClusters[0];
  graph.insights.push(`${rows.length} competitor relationship observation(s) connected ${graph.nodes.length} node(s) through ${graph.edges.length} weighted edge(s).`);
  if (topLeader) graph.insights.push(`${topLeader.competitorUrl} is the current top influence leader with score ${topLeader.influenceScore}.`);
  if (topCluster) graph.insights.push(`${topCluster.industryType}/${topCluster.location} is the strongest market cluster with ${topCluster.competitorCount} competitor(s) and concentration ${topCluster.concentrationScore}.`);
  if (graph.influenceLeaders.some((leader) => leader.growthVelocity > 0)) graph.insights.push("At least one competitor shows positive growth velocity across observed relationships.");
  return graph;
}

function buildKnowledgeGrowthScore(input: {
  scans: ReportSnapshot[];
  industryCount: number;
  competitorRelationshipGraph: InternalIntelligenceReport["competitorRelationshipGraph"];
  revenueAlignmentScore: number;
  recommendationEffectiveness: InternalIntelligenceReport["recommendationEffectiveness"];
  outcomeRows: IireSourceBundle["outcomeRows"];
  editEvents: IireSourceBundle["editEvents"];
  intelligenceDiscoveryInsights: InternalIntelligenceReport["intelligenceDiscoveryInsights"];
}): InternalIntelligenceReport["knowledgeGrowthScore"] {
  const uniqueTargets = new Set(input.scans.map((scan) => scan.targetUrl)).size;
  const validatedOutcomes = input.outcomeRows.filter((outcome) => outcome.implementedStatus === "validated").length;
  const averageRecommendationScore = average(input.recommendationEffectiveness.map((item) => item.effectivenessScore));
  const eventTypes = new Set(input.editEvents.map((event) => event.eventType)).size;
  const clusters = input.competitorRelationshipGraph.marketClusters.length;
  const leaders = input.competitorRelationshipGraph.influenceLeaders.length;
  const dimensions: InternalIntelligenceReport["knowledgeGrowthScore"]["dimensions"] = [
    {
      dimension: "industry_knowledge",
      score: clampPercent(input.industryCount * 18 + input.intelligenceDiscoveryInsights.filter((item) => item.category === "industry_gap" || item.category === "market_shift").length * 14 + uniqueTargets * 4),
      evidenceGains: [`${input.industryCount} industry segment(s) observed`, `${uniqueTargets} unique target(s) contributed scan evidence`],
      limitation: input.industryCount < 3 ? "Broader industry coverage will improve benchmark learning." : "Industry learning has usable breadth for internal decisions."
    },
    {
      dimension: "competitor_intelligence",
      score: clampPercent(input.competitorRelationshipGraph.edges.length * 6 + clusters * 12 + leaders * 8),
      evidenceGains: [`${input.competitorRelationshipGraph.edges.length} competitor graph edge(s)`, `${clusters} market cluster(s)`, `${leaders} influence leader(s)`],
      limitation: input.competitorRelationshipGraph.status === "empty" ? "No competitor observations were available." : "Competitor learning improves with repeated scans across the same markets."
    },
    {
      dimension: "revenue_prediction_confidence",
      score: clampPercent(input.revenueAlignmentScore * 0.75 + validatedOutcomes * 4),
      evidenceGains: [`Revenue alignment score ${input.revenueAlignmentScore}`, `${validatedOutcomes} validated outcome row(s)`],
      limitation: validatedOutcomes < 5 ? "Revenue calibration is still limited by outcome validation volume." : "Revenue calibration has enough validation evidence for trend review."
    },
    {
      dimension: "recommendation_accuracy",
      score: clampPercent(averageRecommendationScore * 0.7 + validatedOutcomes * 5),
      evidenceGains: [`Average recommendation effectiveness ${averageRecommendationScore}`, `${validatedOutcomes} validated recommendation outcome(s)`],
      limitation: input.recommendationEffectiveness.length === 0 ? "No recommendation patterns were available for accuracy learning." : "Recommendation accuracy is tied to repeat-scan validation depth."
    },
    {
      dimension: "behavioral_understanding",
      score: clampPercent(eventTypes * 14 + input.editEvents.length * 2),
      evidenceGains: [`${eventTypes} first-party event type(s)`, `${input.editEvents.length} dashboard/edit/funnel event(s)`],
      limitation: input.editEvents.length < 10 ? "Behavioral learning needs more first-party event capture." : "Behavioral learning has enough signal for funnel diagnosis."
    },
    {
      dimension: "market_coverage",
      score: clampPercent(input.industryCount * 12 + clusters * 10 + uniqueTargets * 5 + input.scans.filter((scan) => scan.monitoringScheduler?.enabled).length * 6),
      evidenceGains: [`${uniqueTargets} active target(s)`, `${clusters} CRG market cluster(s)`, `${input.scans.filter((scan) => scan.monitoringScheduler?.enabled).length} monitored target(s)`],
      limitation: uniqueTargets < 10 ? "Market coverage remains early-stage and should be treated as directional." : "Market coverage has enough breadth for internal trend discovery."
    }
  ];
  const overallScore = clampPercent(average(dimensions.map((dimension) => dimension.score)));
  const trend: InternalIntelligenceReport["knowledgeGrowthScore"]["trend"] =
    input.scans.length === 0 ? "insufficient_signal" : overallScore >= 75 ? "learning_fast" : overallScore >= 50 ? "learning_steadily" : "flat";
  return {
    overallScore,
    trend,
    dimensions,
    evidenceBasis: [
      `${input.scans.length} scan snapshot(s) analyzed`,
      `${input.outcomeRows.length} recommendation outcome validation row(s)`,
      `${input.competitorRelationshipGraph.nodes.length} CRG node(s) and ${input.competitorRelationshipGraph.edges.length} CRG edge(s)`,
      `${input.editEvents.length} first-party behavior event(s)`
    ],
    interpretation:
      trend === "insufficient_signal"
        ? "SYSTOLAB has insufficient fresh intelligence to score knowledge growth for this period."
        : trend === "learning_fast"
          ? "Validated outcomes, competitor relationships, and market coverage are compounding quickly."
          : trend === "learning_steadily"
            ? "SYSTOLAB is gaining useful knowledge, with the next lift coming from deeper validation volume."
            : "Learning is present but thin; prioritize repeated scans, outcomes, and first-party behavior events."
  };
}

function competitorRowsFromSnapshots(scans: ReportSnapshot[]): CompetitorRelationshipRecordInput[] {
  return scans.flatMap((scan) => {
    const primaryOss = scan.oss.score;
    if (primaryOss === null) return [];
    const industryType = scan.industryBenchmarkEngine?.industryType ?? "unknown";
    const geography = inferGeographyFromUrl(scan.targetUrl, scan.tenantBranding.slug);
    const primaryTrustScore = scan.dimensions.find((dimension) => dimension.key === "trust")?.score ?? null;
    const primaryConversionScore = scan.dimensions.find((dimension) => dimension.key === "conversionReadiness")?.score ?? null;
    return (scan.competitorComparison ?? []).map((competitor) => ({
      relationshipId: `crg_fallback_${sha256(`${scan.snapshotId}:${scan.targetUrl}:${competitor.competitorUrl}`).slice(0, 20)}`,
      snapshotId: scan.snapshotId,
      workspaceId: `ws_${sha256(`${scan.tenantBranding.slug}:${scan.targetUrl.toLowerCase()}`).slice(0, 20)}`,
      tenantSlug: scan.tenantBranding.slug,
      businessUrl: scan.targetUrl,
      competitorUrl: competitor.competitorUrl,
      competitorLabel: competitor.competitorLabel,
      industryType,
      geography,
      marketSegment: `${industryType}:${geography}`,
      primaryOss,
      competitorOss: competitor.competitorOss,
      primaryTrustScore,
      competitorTrustScore: competitor.evidenceTraceabilityMap.find((row) => row.dimension === "trust")?.competitorScore ?? null,
      primaryConversionScore,
      competitorConversionScore: competitor.evidenceTraceabilityMap.find((row) => row.dimension === "conversionReadiness")?.competitorScore ?? null,
      revenueOpportunityLow: scan.revenueIntelligence?.revenueOpportunityRange.low ?? 0,
      revenueOpportunityHigh: scan.revenueIntelligence?.revenueOpportunityRange.high ?? 0,
      threatLevel: scan.competitiveThreatRadar?.threatLevel ?? "UNKNOWN",
      observations: 1,
      capturedAt: new Date(scan.createdAt)
    }));
  });
}

function crgNodeId(type: InternalIntelligenceReport["competitorRelationshipGraph"]["nodes"][number]["type"], value: string): string {
  return `node_${type}_${sha256(value.toLowerCase()).slice(0, 14)}`;
}

function upsertCrgNode(nodes: Map<string, InternalIntelligenceReport["competitorRelationshipGraph"]["nodes"][number]>, node: InternalIntelligenceReport["competitorRelationshipGraph"]["nodes"][number]): void {
  const existing = nodes.get(node.nodeId);
  if (!existing) {
    nodes.set(node.nodeId, node);
    return;
  }
  existing.prominenceScore = Math.max(existing.prominenceScore, node.prominenceScore);
  existing.metadata = { ...existing.metadata, ...node.metadata };
}

function addCrgEdge(
  edgeGroups: Map<string, Array<CompetitorRelationshipRecordInput & { latestOssDelta: number | null }>>,
  from: string,
  to: string,
  relationship: InternalIntelligenceReport["competitorRelationshipGraph"]["edges"][number]["relationship"],
  row: CompetitorRelationshipRecordInput,
  latestOssDelta: number | null
): void {
  const key = `${from}|${to}|${relationship}`;
  const rows = edgeGroups.get(key) ?? [];
  rows.push({ ...row, latestOssDelta });
  edgeGroups.set(key, rows);
}

function competitorProminence(items: CompetitorRelationshipRecordInput[]): number {
  const averageOss = average(items.map((item) => item.competitorOss ?? 0));
  const averageTrust = average(items.map((item) => item.competitorTrustScore ?? 0));
  const averageConversion = average(items.map((item) => item.competitorConversionScore ?? 0));
  const threatBonus = items.some((item) => item.threatLevel === "HIGH") ? 12 : items.some((item) => item.threatLevel === "MEDIUM") ? 6 : 0;
  return clampPercent(items.length * 14 + averageOss * 0.35 + averageTrust * 0.12 + averageConversion * 0.12 + growthVelocityFor(items) * 2 + threatBonus);
}

function growthVelocityFor(items: CompetitorRelationshipRecordInput[]): number {
  const sorted = [...items].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  if (sorted.length < 2) return 0;
  const first = sorted[0]?.competitorOss ?? sorted[0]?.primaryOss ?? 0;
  const last = sorted.at(-1)?.competitorOss ?? sorted.at(-1)?.primaryOss ?? first;
  return Number((last - first).toFixed(2));
}

function normalizeInternalSchedule(row: unknown): { scheduleId: string; reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">; enabled: boolean; exportFormats: InternalReportExportFormat[]; lastRunAt?: Date; nextRunAt: Date } {
  const schedule = row as { scheduleId: string; reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">; enabled: boolean; exportFormats?: InternalReportExportFormat[]; lastRunAt?: string | Date; nextRunAt: string | Date };
  return {
    scheduleId: schedule.scheduleId,
    reportType: schedule.reportType,
    enabled: schedule.enabled,
    exportFormats: schedule.exportFormats ?? ["pdf", "json"],
    lastRunAt: schedule.lastRunAt ? new Date(schedule.lastRunAt) : undefined,
    nextRunAt: new Date(schedule.nextRunAt)
  };
}

function isWithin(value: string, period: ReportPeriod): boolean {
  const date = new Date(value);
  return date >= period.startAt && date <= period.endAt;
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

function isScoredSnapshot(scan: ReportSnapshot): scan is ScoredReportSnapshot {
  return scan.oss.score !== null;
}

function scoredOssValues(scans: ReportSnapshot[]): number[] {
  return scans.filter(isScoredSnapshot).map((scan) => scan.oss.score);
}

function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const name = key(item);
    groups[name] = groups[name] ?? [];
    groups[name]!.push(item);
    return groups;
  }, {});
}

function topEntries(counts: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function dimensionAveragesFor(scans: ReportSnapshot[]): Record<string, number> {
  const labels = new Set(scans.flatMap((scan) => scan.dimensions.map((dimension) => dimension.label)));
  return Object.fromEntries([...labels].map((label) => [label, average(scans.flatMap((scan) => scan.dimensions.filter((dimension) => dimension.label === label).map((dimension) => dimension.score)))]));
}

function trendForSnapshots(scans: ReportSnapshot[]): "improving" | "declining" | "stable" | "insufficient_history" {
  const sorted = scans.filter(isScoredSnapshot).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sorted.length < 2) return "insufficient_history";
  const delta = sorted.at(-1)!.oss.score - sorted[0]!.oss.score;
  if (delta >= 5) return "improving";
  if (delta <= -5) return "declining";
  return "stable";
}

function scanGrowthRate(scans: ReportSnapshot[]): number {
  if (scans.length < 2) return scans.length > 0 ? 100 : 0;
  const midpoint = Math.floor(scans.length / 2);
  const first = scans.slice(0, midpoint).length;
  const second = scans.slice(midpoint).length;
  return first ? Number((((second - first) / first) * 100).toFixed(2)) : 100;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function confidenceLabel(score: number): string {
  if (score >= 85) return "High";
  if (score >= 65) return "Moderate";
  return "Limited";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inferGeographyFromUrl(url: string, fallback = ""): string {
  const source = `${url} ${fallback}`.toLowerCase();
  const cityHints = ["miami", "delhi", "mumbai", "london", "dubai", "new-york", "newyork", "chicago", "toronto", "lahore", "karachi", "sydney", "melbourne"];
  const city = cityHints.find((hint) => source.includes(hint));
  if (city) return city.replace("-", " ");
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".in")) return "india";
    if (host.endsWith(".uk")) return "united kingdom";
    if (host.endsWith(".ca")) return "canada";
    if (host.endsWith(".au")) return "australia";
    if (host.endsWith(".ae")) return "united arab emirates";
  } catch {
    return "unknown";
  }
  return "unknown";
}
