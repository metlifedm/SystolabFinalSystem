import type { ReportSnapshot } from "@systolab/shared";
import { AlertRecord } from "../models/AlertRecord.js";
import { isMongoConnected } from "../db/mongoose.js";
import { ChangeRecord } from "../models/ChangeRecord.js";
import { CompetitorRelationshipRecord } from "../models/CompetitorRelationshipRecord.js";
import { EvidenceRecord } from "../models/EvidenceRecord.js";
import { MonitoringSchedule } from "../models/MonitoringSchedule.js";
import { OutcomeValidationRecord } from "../models/OutcomeValidationRecord.js";
import { RecommendationRecord } from "../models/RecommendationRecord.js";
import { ScanHistory } from "../models/ScanHistory.js";
import { Workspace } from "../models/Workspace.js";
import { makeId, sha256 } from "../utils/crypto.js";
import { publishIntelligenceEvent } from "./intelligenceEventBus.js";
import { generateEventTriggeredInternalReport } from "./iireService.js";
import { queueAlertNotifications } from "./notificationService.js";
import { persistPlatformArtifacts } from "./platformControlPlaneService.js";

const memoryHistory: Array<{ workspaceId: string; report: ReportSnapshot }> = [];
const memoryEvidenceRecords: ReportSnapshot["evidenceDatabase"] = [];
const memoryAlertRecords: ReportSnapshot["alertEngine"]["alerts"] = [];
const memoryOutcomeRecords: Array<{ snapshotId: string; item: ReportSnapshot["recommendationOutcomeLoop"]["validations"][number] }> = [];
const memoryCompetitorRelationships: CompetitorRelationshipRecordInput[] = [];

export interface CompetitorRelationshipRecordInput {
  relationshipId: string;
  snapshotId: string;
  workspaceId: string;
  tenantSlug: string;
  businessUrl: string;
  competitorUrl: string;
  competitorLabel: string;
  industryType: string;
  geography: string;
  marketSegment: string;
  primaryOss: number;
  competitorOss: number | null;
  primaryTrustScore: number | null;
  competitorTrustScore: number | null;
  primaryConversionScore: number | null;
  competitorConversionScore: number | null;
  revenueOpportunityLow: number;
  revenueOpportunityHigh: number;
  threatLevel: string;
  observations: number;
  capturedAt: Date;
}

export async function persistIntelligenceArtifacts(report: ReportSnapshot): Promise<void> {
  const workspaceId = workspaceIdFor(report.tenantBranding.slug, report.targetUrl);
  const reportScore = report.oss.score;
  if (!isMongoConnected()) {
    memoryHistory.push({ workspaceId, report });
    memoryEvidenceRecords.push(...report.evidenceDatabase);
    memoryAlertRecords.push(...report.alertEngine.alerts);
    memoryOutcomeRecords.push(...report.recommendationOutcomeLoop.validations.map((item) => ({ snapshotId: report.snapshotId, item })));
    memoryCompetitorRelationships.push(...buildCompetitorRelationshipRecords(report, workspaceId));
  } else {
    await Workspace.findOneAndUpdate(
      { workspaceId },
      {
        workspaceId,
        tenantSlug: report.tenantBranding.slug,
        targetUrl: report.targetUrl,
        businessContext: {
          lastOss: reportScore,
          lastRisk: report.businessRiskStatus.classification,
          lastScanAt: report.createdAt
        },
        preferences: {
          monitoringMode: report.mode
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (reportScore !== null) {
      await ScanHistory.create({
        historyId: makeId("hist"),
        workspaceId,
        tenantSlug: report.tenantBranding.slug,
        targetUrl: report.targetUrl,
        snapshotId: report.snapshotId,
        oss: reportScore,
        dimensions: Object.fromEntries(report.dimensions.map((dimension) => [dimension.key, dimension.score])),
        competitorUrls: report.competitorComparison.map((comparison) => comparison.competitorUrl),
        evidenceCount: report.evidenceObjects.length
      }).catch(() => undefined);
    }

    await RecommendationRecord.insertMany(
      report.recommendationEngine.recommendations.map((recommendation) => ({
        recommendationId: recommendation.recommendationId,
        snapshotId: report.snapshotId,
        workspaceId,
        targetUrl: report.targetUrl,
        issue: recommendation.issue,
        action: recommendation.action,
        priority: recommendation.priority,
        evidenceIds: recommendation.evidenceIds,
        confidenceScore: recommendation.confidenceScore
      })),
      { ordered: false }
    ).catch(() => undefined);

    await EvidenceRecord.insertMany(
      report.evidenceDatabase.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        snapshotId: report.snapshotId,
        previousSnapshotId: evidence.lineage.previousSnapshotId,
        workspaceId,
        targetUrl: report.targetUrl,
        issue: evidence.issue,
        before: evidence.before,
        after: evidence.after,
        confidenceScore: evidence.confidenceScore,
        confidenceReason: evidence.confidenceReason,
        evidenceType: evidence.evidenceType,
        sourceEvidenceIds: evidence.lineage.sourceEvidenceIds,
        recommendationIds: evidence.lineage.recommendationIds,
        validationTraceIds: evidence.lineage.validationTraceIds,
        capturedAt: new Date(evidence.capturedAt)
      })),
      { ordered: false }
    ).catch(() => undefined);

    await OutcomeValidationRecord.insertMany(
      report.recommendationOutcomeLoop.validations.map((validation) => ({
        validationId: `${report.snapshotId}-${validation.recommendationId}`,
        recommendationId: validation.recommendationId,
        snapshotId: report.snapshotId,
        previousSnapshotId: report.recommendationOutcomeLoop.previousSnapshotId,
        workspaceId,
        targetUrl: report.targetUrl,
        implementedStatus: validation.implementedStatus,
        improvementStatus: validation.improvementStatus,
        ossDelta: validation.ossDelta,
        revenueImpactLow: validation.revenueImpact.low,
        revenueImpactHigh: validation.revenueImpact.high,
        confidenceScore: validation.confidenceScore,
        evidenceIds: validation.evidenceIds,
        detectedAt: validation.detectedAt ? new Date(validation.detectedAt) : undefined
      })),
      { ordered: false }
    ).catch(() => undefined);

    await ChangeRecord.insertMany(
      report.lightweightChangeDetection.changes.map((change) => ({
        changeId: `${report.snapshotId}-${change.changeId}`,
        snapshotId: report.snapshotId,
        comparedSnapshotId: report.lightweightChangeDetection.comparedSnapshotId,
        workspaceId,
        targetUrl: report.targetUrl,
        area: change.area,
        beforeState: change.beforeState,
        afterState: change.afterState,
        direction: change.direction,
        evidenceIds: change.evidenceIds,
        recommendationIds: change.recommendationIds,
        confidenceScore: change.confidenceScore
      })),
      { ordered: false }
    ).catch(() => undefined);

    await AlertRecord.insertMany(
      report.alertEngine.alerts.map((alert) => ({
        alertId: alert.alertId,
        snapshotId: report.snapshotId,
        workspaceId,
        targetUrl: report.targetUrl,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        trigger: alert.trigger,
        evidenceIds: alert.evidenceIds,
        acknowledged: alert.acknowledged
      })),
      { ordered: false }
    ).catch(() => undefined);

    await CompetitorRelationshipRecord.insertMany(
      buildCompetitorRelationshipRecords(report, workspaceId),
      { ordered: false }
    ).catch(() => undefined);

    await MonitoringSchedule.findOneAndUpdate(
      { scheduleId: report.monitoringScheduler.scheduleId },
      {
        scheduleId: report.monitoringScheduler.scheduleId,
        workspaceId,
        tenantSlug: report.tenantBranding.slug,
        targetUrl: report.targetUrl,
        cadence: report.monitoringScheduler.cadence,
        enabled: report.monitoringScheduler.enabled,
        competitorUrls: report.monitoringScheduler.competitorUrls,
        alertChannels: report.monitoringScheduler.alertChannels,
        lastRunAt: report.monitoringScheduler.lastRunAt ? new Date(report.monitoringScheduler.lastRunAt) : undefined,
        nextRunAt: new Date(report.monitoringScheduler.nextRunAt)
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(() => undefined);
  }

  await queueAlertNotifications(report, workspaceId);
  await persistPlatformArtifacts(report, workspaceId).catch(() => undefined);

  await publishIntelligenceEvent({
    eventType: "scan.completed",
    layer: "data",
    report,
    workspaceId,
    payload: { oss: reportScore, status: report.status, evidenceCount: report.evidenceObjects.length },
    evidenceIds: report.evidenceObjects.map((evidence) => evidence.evidenceId),
    confidenceScore: report.confidenceLayer[0]?.confidenceScore ?? 0,
    source: "scan-history-tracking"
  });
  await publishIntelligenceEvent({
    eventType: "confidence.scored",
    layer: "confidence",
    report,
    workspaceId,
    payload: { confidenceLayer: report.confidenceLayer, evidenceCoverageSummary: report.evidenceCoverageSummary },
    evidenceIds: report.evidenceObjects.map((evidence) => evidence.evidenceId),
    confidenceScore: report.confidenceLayer[0]?.confidenceScore ?? 0,
    source: "confidence-engine"
  });
  await publishIntelligenceEvent({
    eventType: "benchmark.compared",
    layer: "intelligence",
    report,
    workspaceId,
    payload: report.industryBenchmarkEngine as unknown as Record<string, unknown>,
    evidenceIds: [],
    confidenceScore: report.confidenceEngine.estimateExplanations.find((item) => item.area === "Benchmark")?.confidenceScore ?? 0,
    source: "industry-benchmark-engine"
  });
  await publishIntelligenceEvent({
    eventType: "revenue.estimated",
    layer: "revenue_intelligence",
    report,
    workspaceId,
    payload: report.revenueIntelligence as unknown as Record<string, unknown>,
    evidenceIds: report.revenueIntelligence.revenueOpportunityRange.evidenceIds,
    confidenceScore: report.revenueIntelligence.confidenceScore,
    source: "revenue-intelligence-engine"
  });
  await publishIntelligenceEvent({
    eventType: "recommendation.generated",
    layer: "intelligence",
    report,
    workspaceId,
    payload: report.recommendationEngine as unknown as Record<string, unknown>,
    evidenceIds: report.recommendationEngine.recommendations.flatMap((recommendation) => recommendation.evidenceIds),
    confidenceScore: report.recommendationEngine.recommendations[0]?.confidenceScore ?? 0,
    source: "recommendation-engine"
  });
  await publishIntelligenceEvent({
    eventType: "change.detected",
    layer: "truth_evidence",
    report,
    workspaceId,
    payload: report.lightweightChangeDetection as unknown as Record<string, unknown>,
    evidenceIds: report.lightweightChangeDetection.changes.flatMap((change) => change.evidenceIds),
    confidenceScore: report.lightweightChangeDetection.changes[0]?.confidenceScore ?? 0,
    source: "lightweight-change-detection"
  });
  await publishIntelligenceEvent({
    eventType: "outcome.validated",
    layer: "outcome_validation",
    report,
    workspaceId,
    payload: report.recommendationOutcomeLoop as unknown as Record<string, unknown>,
    evidenceIds: report.recommendationOutcomeLoop.validations.flatMap((validation) => validation.evidenceIds),
    confidenceScore: report.recommendationOutcomeLoop.validations[0]?.confidenceScore ?? 0,
    source: "outcome-validation-engine"
  });
  await publishIntelligenceEvent({
    eventType: "alert.generated",
    layer: "action_alert",
    report,
    workspaceId,
    payload: report.alertEngine as unknown as Record<string, unknown>,
    evidenceIds: report.alertEngine.alerts.flatMap((alert) => alert.evidenceIds),
    confidenceScore: report.alertEngine.alerts.length > 0 ? 80 : 100,
    source: "alert-engine"
  });
  await publishIntelligenceEvent({
    eventType: "monitoring.scheduled",
    layer: "automation",
    report,
    workspaceId,
    payload: report.monitoringScheduler as unknown as Record<string, unknown>,
    evidenceIds: [],
    confidenceScore: 100,
    source: "monitoring-scheduler"
  });

  void generateEventTriggeredInternalReport();
}

export function workspaceIdFor(tenantSlug: string, targetUrl: string): string {
  return `ws_${sha256(`${tenantSlug}:${targetUrl.toLowerCase()}`).slice(0, 20)}`;
}

export function getMemoryHistory(): Array<{ workspaceId: string; report: ReportSnapshot }> {
  return [...memoryHistory];
}

export function getMemoryEvidenceRecords(): ReportSnapshot["evidenceDatabase"] {
  return [...memoryEvidenceRecords];
}

export function getMemoryAlertRecords(): ReportSnapshot["alertEngine"]["alerts"] {
  return [...memoryAlertRecords];
}

export function getMemoryOutcomeRecords(): Array<{ snapshotId: string; item: ReportSnapshot["recommendationOutcomeLoop"]["validations"][number] }> {
  return [...memoryOutcomeRecords];
}

export function getMemoryCompetitorRelationships(): CompetitorRelationshipRecordInput[] {
  return [...memoryCompetitorRelationships];
}

function buildCompetitorRelationshipRecords(report: ReportSnapshot, workspaceId: string): CompetitorRelationshipRecordInput[] {
  const primaryOss = report.oss.score;
  if (primaryOss === null) return [];
  const industryType = report.industryBenchmarkEngine?.industryType ?? "unknown";
  const geography = inferGeographyFromUrl(report.targetUrl, report.tenantBranding.slug);
  const primaryTrustScore = report.dimensions.find((dimension) => dimension.key === "trust")?.score ?? null;
  const primaryConversionScore = report.dimensions.find((dimension) => dimension.key === "conversionReadiness")?.score ?? null;
  return (report.competitorComparison ?? []).map((competitor) => {
    const competitorTrustScore = competitor.evidenceTraceabilityMap.find((row) => row.dimension === "trust")?.competitorScore ?? null;
    const competitorConversionScore = competitor.evidenceTraceabilityMap.find((row) => row.dimension === "conversionReadiness")?.competitorScore ?? null;
    return {
      relationshipId: `crg_${sha256(`${report.tenantBranding.slug}:${report.targetUrl}:${competitor.competitorUrl}:${report.snapshotId}`).slice(0, 24)}`,
      snapshotId: report.snapshotId,
      workspaceId,
      tenantSlug: report.tenantBranding.slug,
      businessUrl: report.targetUrl,
      competitorUrl: competitor.competitorUrl,
      competitorLabel: competitor.competitorLabel,
      industryType,
      geography,
      marketSegment: `${industryType}:${geography}`,
      primaryOss,
      competitorOss: competitor.competitorOss,
      primaryTrustScore,
      competitorTrustScore,
      primaryConversionScore,
      competitorConversionScore,
      revenueOpportunityLow: report.revenueIntelligence?.revenueOpportunityRange.low ?? 0,
      revenueOpportunityHigh: report.revenueIntelligence?.revenueOpportunityRange.high ?? 0,
      threatLevel: report.competitiveThreatRadar?.threatLevel ?? "UNKNOWN",
      observations: 1,
      capturedAt: new Date(report.createdAt)
    };
  });
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
