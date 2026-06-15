import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { KnowledgeGrowthRecord, KnowledgeGrowthRecordDocument, KgsTrend } from "../models/KnowledgeGrowthRecord.js";
import { getEvidenceQualityStats } from "./evidenceQualityService.js";
import { computeVrsr, getValidationAccuracyStats } from "./intelligenceValidationService.js";
import { getOpportunityStats } from "./opportunityDiscoveryService.js";

// ── In-memory fallback ───────────────────────────────────────────────────────

interface MemKgsRecord {
  kgsId: string;
  periodStart: Date;
  periodEnd: Date;
  recommendationEffectivenessScore: number;
  evidenceQualityScore: number;
  behavioralIntelligenceScore: number;
  validationAccuracyScore: number;
  businessDnaCoverageScore: number;
  kgsScore: number;
  kgsTrend: KgsTrend;
  kgsDelta: number;
  vrsr: number;
  vrsrDelta: number;
  totalRecommendationsImplemented: number;
  totalRecommendationsValidated: number;
  totalRecommendationsSuccessful: number;
  totalScansThisPeriod: number;
  totalEvidenceGenerated: number;
  totalRecommendationsIssued: number;
  totalOpportunitiesDiscovered: number;
  totalOpportunitiesCompleted: number;
  highQualityEvidenceCount: number;
  verifiedEvidenceCount: number;
  avgConfidenceScore: number;
  snapshotAt: Date;
  createdAt: Date;
}

export const _memKgsRecords: MemKgsRecord[] = [];

// ── KGS computation ───────────────────────────────────────────────────────────
//
// KGS (0-100) = weighted average of 5 component scores:
//   recommendationEffectivenessScore  30%  — derived from VRSR
//   evidenceQualityScore              25%  — avg quality class distribution
//   behavioralIntelligenceScore       20%  — VIL session/archetype coverage
//   validationAccuracyScore           15%  — intelligence validation accuracy
//   businessDnaCoverageScore          10%  — % workspaces with DNA profiles

const KGS_WEIGHTS = {
  recommendationEffectiveness: 0.30,
  evidenceQuality: 0.25,
  behavioralIntelligence: 0.20,
  validationAccuracy: 0.15,
  businessDnaCoverage: 0.10
};

function computeKgsScore(components: {
  recommendationEffectivenessScore: number;
  evidenceQualityScore: number;
  behavioralIntelligenceScore: number;
  validationAccuracyScore: number;
  businessDnaCoverageScore: number;
}): number {
  return Math.round(
    components.recommendationEffectivenessScore * KGS_WEIGHTS.recommendationEffectiveness +
    components.evidenceQualityScore * KGS_WEIGHTS.evidenceQuality +
    components.behavioralIntelligenceScore * KGS_WEIGHTS.behavioralIntelligence +
    components.validationAccuracyScore * KGS_WEIGHTS.validationAccuracy +
    components.businessDnaCoverageScore * KGS_WEIGHTS.businessDnaCoverage
  );
}

function determineKgsTrend(current: number, previous: number | null): { trend: KgsTrend; delta: number } {
  if (previous === null) return { trend: "stable", delta: 0 };
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta >= 3) return { trend: "growing", delta };
  if (delta <= -3) return { trend: "declining", delta };
  return { trend: "stable", delta };
}

// ── Behavioral intelligence score computation ─────────────────────────────────
// Uses VIL behavioral evidence quality stats as a proxy

async function computeBehavioralIntelligenceScore(workspaceId: string): Promise<number> {
  try {
    const qualityStats = await getEvidenceQualityStats(workspaceId);
    const total = qualityStats.totalBehavioralEvidence;
    if (total === 0) return 0;

    const classified = qualityStats.classifiedBehavioralEvidence;
    const highOrVerified =
      qualityStats.behavioralQualityDistribution.high +
      qualityStats.behavioralQualityDistribution.verified;

    // Coverage score: proportion classified (0-50) + proportion high quality (0-50)
    const coverageScore = (classified / total) * 50;
    const qualityContrib = (highOrVerified / total) * 50;

    return Math.round(coverageScore + qualityContrib);
  } catch {
    return 0;
  }
}

// ── Evidence quality score computation ───────────────────────────────────────

async function computeEvidenceQualityScore(workspaceId: string): Promise<{
  score: number;
  highCount: number;
  verifiedCount: number;
}> {
  try {
    const stats = await getEvidenceQualityStats(workspaceId);
    const total = stats.totalEvidenceRecords + stats.totalBehavioralEvidence;
    if (total === 0) return { score: 0, highCount: 0, verifiedCount: 0 };

    const highCount =
      stats.qualityDistribution.high +
      stats.behavioralQualityDistribution.high;
    const verifiedCount =
      stats.qualityDistribution.verified +
      stats.behavioralQualityDistribution.verified;

    const mediumCount =
      stats.qualityDistribution.medium +
      stats.behavioralQualityDistribution.medium;

    const score = Math.round(
      ((verifiedCount * 100 + highCount * 70 + mediumCount * 40) / total)
    );

    return { score: Math.min(score, 100), highCount, verifiedCount };
  } catch {
    return { score: 0, highCount: 0, verifiedCount: 0 };
  }
}

// ── Business DNA coverage score ───────────────────────────────────────────────

async function computeBusinessDnaCoverageScore(totalWorkspaces: number): Promise<number> {
  if (!isMongoConnected() || totalWorkspaces === 0) return 0;
  try {
    const { BusinessDnaRecord } = await import("../models/BusinessDnaRecord.js");
    const count = await BusinessDnaRecord.countDocuments();
    return Math.round(Math.min((count / totalWorkspaces) * 100, 100));
  } catch {
    return 0;
  }
}

// ── Main KGS snapshot ─────────────────────────────────────────────────────────

export interface ComputeKgsInput {
  workspaceId: string;
  tenantSlug?: string;
  totalWorkspaces?: number;
  periodStart: Date;
  periodEnd: Date;
  // Optional override metrics (supplied by caller from platform aggregation)
  totalScansThisPeriod?: number;
  totalEvidenceGenerated?: number;
  totalRecommendationsIssued?: number;
  totalOpportunitiesDiscovered?: number;
  totalOpportunitiesCompleted?: number;
}

export async function computeAndSnapshotKgs(input: ComputeKgsInput): Promise<MemKgsRecord | KnowledgeGrowthRecordDocument> {
  const [
    vrsrData,
    validationStats,
    opportunityStats,
    evidenceQuality,
    behavioralScore
  ] = await Promise.all([
    computeVrsr(input.workspaceId),
    getValidationAccuracyStats(input.workspaceId),
    getOpportunityStats(input.workspaceId),
    computeEvidenceQualityScore(input.workspaceId),
    computeBehavioralIntelligenceScore(input.workspaceId)
  ]);

  const businessDnaCoverageScore = await computeBusinessDnaCoverageScore(input.totalWorkspaces ?? 1);

  const recommendationEffectivenessScore = vrsrData.vrsr;
  const evidenceQualityScore = evidenceQuality.score;
  const validationAccuracyScore = validationStats.avgAccuracyScore;

  const components = {
    recommendationEffectivenessScore,
    evidenceQualityScore,
    behavioralIntelligenceScore: behavioralScore,
    validationAccuracyScore,
    businessDnaCoverageScore
  };
  const kgsScore = computeKgsScore(components);

  // Look up previous snapshot for trend
  let previousKgs: number | null = null;
  let previousVrsr: number | null = null;

  if (isMongoConnected()) {
    const prev = await KnowledgeGrowthRecord.findOne({ workspaceId: input.workspaceId ?? undefined })
      .sort({ snapshotAt: -1 })
      .select("kgsScore vrsr")
      .lean();
    if (prev) {
      previousKgs = (prev as unknown as { kgsScore: number }).kgsScore;
      previousVrsr = (prev as unknown as { vrsr: number }).vrsr;
    }
  } else {
    const sorted = [..._memKgsRecords].sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime());
    if (sorted.length > 0) {
      previousKgs = sorted[0]!.kgsScore;
      previousVrsr = sorted[0]!.vrsr;
    }
  }

  const { trend: kgsTrend, delta: kgsDelta } = determineKgsTrend(kgsScore, previousKgs);
  const vrsrDelta = previousVrsr !== null ? Math.round((vrsrData.vrsr - previousVrsr) * 10) / 10 : 0;

  const now = new Date();
  const kgsId = makeId("ciif_kgs");

  const record: MemKgsRecord = {
    kgsId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    ...components,
    kgsScore,
    kgsTrend,
    kgsDelta,
    vrsr: vrsrData.vrsr,
    vrsrDelta,
    totalRecommendationsImplemented: vrsrData.totalImplemented,
    totalRecommendationsValidated: vrsrData.totalValidated,
    totalRecommendationsSuccessful: vrsrData.totalSuccessful,
    totalScansThisPeriod: input.totalScansThisPeriod ?? 0,
    totalEvidenceGenerated: input.totalEvidenceGenerated ?? 0,
    totalRecommendationsIssued: input.totalRecommendationsIssued ?? 0,
    totalOpportunitiesDiscovered: input.totalOpportunitiesDiscovered ?? opportunityStats.totalActive,
    totalOpportunitiesCompleted: input.totalOpportunitiesCompleted ?? opportunityStats.totalCompleted,
    highQualityEvidenceCount: evidenceQuality.highCount,
    verifiedEvidenceCount: evidenceQuality.verifiedCount,
    avgConfidenceScore: validationStats.avgAccuracyScore,
    snapshotAt: now,
    createdAt: now
  };

  if (isMongoConnected()) {
    return KnowledgeGrowthRecord.create(record);
  }

  _memKgsRecords.push(record);
  return record;
}

export async function getLatestKgs(workspaceId?: string): Promise<MemKgsRecord | KnowledgeGrowthRecordDocument | null> {
  if (isMongoConnected()) {
    const query = workspaceId ? { workspaceId } : {};
    return KnowledgeGrowthRecord.findOne(query).sort({ snapshotAt: -1 }).lean();
  }
  const sorted = [..._memKgsRecords].sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime());
  return sorted[0] ?? null;
}

export async function listKgsHistory(
  opts: { limit?: number; offset?: number } = {}
): Promise<Array<MemKgsRecord | KnowledgeGrowthRecordDocument>> {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;

  if (isMongoConnected()) {
    return KnowledgeGrowthRecord.find({})
      .sort({ snapshotAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }

  return [..._memKgsRecords]
    .sort((a, b) => b.snapshotAt.getTime() - a.snapshotAt.getTime())
    .slice(offset, offset + limit);
}

// ── Agency Intelligence Report ────────────────────────────────────────────────
// Human-readable CIIF summary for agency/client reporting

export interface AgencyIntelligenceReport {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  headline: string;
  kgsScore: number;
  kgsTrend: KgsTrend;
  vrsr: number;
  keyMetrics: Array<{ label: string; value: string; trend?: "up" | "down" | "stable" }>;
  topInsights: string[];
  actionItems: string[];
  confidenceTransparency: {
    overallCalibrationStatus: string;
    overconfidentArtifacts: number;
    adjustmentsRecommended: number;
  };
}

export async function generateAgencyIntelligenceReport(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<AgencyIntelligenceReport> {
  const [kgsSnapshot, validationStats, oppStats] = await Promise.all([
    computeAndSnapshotKgs({
      workspaceId,
      periodStart,
      periodEnd
    }),
    getValidationAccuracyStats(workspaceId),
    getOpportunityStats(workspaceId)
  ]);

  const snap = kgsSnapshot as MemKgsRecord;
  const trendLabel = snap.kgsTrend === "growing" ? "↑ Growing" : snap.kgsTrend === "declining" ? "↓ Declining" : "→ Stable";
  const vrsrTrend: "up" | "down" | "stable" = snap.vrsrDelta > 2 ? "up" : snap.vrsrDelta < -2 ? "down" : "stable";

  const topInsights: string[] = [
    `Platform intelligence has ${snap.kgsTrend === "growing" ? "improved" : snap.kgsTrend === "declining" ? "declined" : "remained stable"} with a KGS of ${snap.kgsScore}/100.`,
    `${snap.vrsr}% of implemented recommendations produced validated positive outcomes (VRSR).`,
    `${snap.verifiedEvidenceCount} pieces of evidence reached 'verified' quality classification.`,
    `${oppStats.totalActive} active opportunities identified, ${oppStats.totalCompleted} completed this period.`
  ];

  const actionItems: string[] = [];
  if (validationStats.calibrationBreakdown.overconfident > 0) {
    actionItems.push(`Review ${validationStats.calibrationBreakdown.overconfident} overconfident intelligence artifacts — confidence scores need recalibration.`);
  }
  if (snap.kgsTrend === "declining") {
    actionItems.push("KGS declining — prioritise evidence quality improvement and recommendation implementation to reverse trend.");
  }
  if (snap.vrsr < 50) {
    actionItems.push("VRSR below 50% — review recommendation generation logic and outcome measurement methodology.");
  }
  if (oppStats.totalActive > 10) {
    actionItems.push(`${oppStats.totalActive} active opportunities backlogged — consider prioritising by effort level.`);
  }

  return {
    generatedAt: new Date(),
    periodStart,
    periodEnd,
    headline: `Intelligence ${trendLabel} — KGS ${snap.kgsScore}/100, VRSR ${snap.vrsr}%`,
    kgsScore: snap.kgsScore,
    kgsTrend: snap.kgsTrend,
    vrsr: snap.vrsr,
    keyMetrics: [
      { label: "Knowledge Growth Score", value: `${snap.kgsScore}/100`, trend: snap.kgsTrend === "growing" ? "up" : snap.kgsTrend === "declining" ? "down" : "stable" },
      { label: "Validated Recommendation Success Rate", value: `${snap.vrsr}%`, trend: vrsrTrend },
      { label: "Evidence Quality Score", value: `${snap.evidenceQualityScore}/100` },
      { label: "Validation Accuracy", value: `${snap.validationAccuracyScore}/100` },
      { label: "Active Opportunities", value: `${oppStats.totalActive}` },
      { label: "Completed Opportunities", value: `${oppStats.totalCompleted}` }
    ],
    topInsights,
    actionItems,
    confidenceTransparency: {
      overallCalibrationStatus:
        validationStats.calibrationBreakdown.well_calibrated > validationStats.calibrationBreakdown.overconfident
          ? "well_calibrated"
          : "overconfident",
      overconfidentArtifacts: validationStats.calibrationBreakdown.overconfident,
      adjustmentsRecommended: validationStats.actionRequiredCount
    }
  };
}
