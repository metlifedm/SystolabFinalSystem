import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import {
  OpportunityRecord,
  OpportunityRecordDocument,
  OpportunityType,
  OpportunityStatus,
  EffortLevel,
  OpportunitySource
} from "../models/OpportunityRecord.js";

// ── In-memory fallback ───────────────────────────────────────────────────────

interface MemOpportunity {
  opportunityId: string;
  workspaceId: string;
  tenantSlug: string;
  opportunityType: OpportunityType;
  title: string;
  description: string;
  priorityScore: number;
  estimatedRevenueImpact?: number;
  effortLevel: EffortLevel;
  evidenceIds: string[];
  behavioralEvidenceIds: string[];
  confidenceScore: number;
  qualityClass: "low" | "medium" | "high" | "verified";
  status: OpportunityStatus;
  dismissedReason?: string;
  dismissedAt?: Date;
  completedAt?: Date;
  inProgressSince?: Date;
  discoveredBy: OpportunitySource;
  relatedRecommendationIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const _memOpportunities = new Map<string, MemOpportunity>();

// ── Priority scoring ─────────────────────────────────────────────────────────
//
// priorityScore (0-100) = revenue weight (0-40) + confidence (0-30) + effort inverse (0-20) + type bonus (0-10)

function computePriorityScore(
  estimatedRevenueImpact: number | undefined,
  confidenceScore: number,
  effortLevel: EffortLevel,
  opportunityType: OpportunityType
): number {
  const revenueImpact = estimatedRevenueImpact ?? 0;
  const revenueScore = Math.min((revenueImpact / 10000) * 40, 40);

  const confidenceContrib = (confidenceScore / 100) * 30;

  const effortScore: Record<EffortLevel, number> = { low: 20, medium: 12, high: 4 };
  const effortContrib = effortScore[effortLevel];

  const typeBonuses: Record<OpportunityType, number> = {
    quick_win: 10,
    high_impact: 8,
    revenue: 8,
    behavioral: 6,
    conversion: 6,
    competitive: 4,
    trust: 4,
    long_term: 2
  };
  const typeBonus = typeBonuses[opportunityType] ?? 0;

  return Math.min(Math.round(revenueScore + confidenceContrib + effortContrib + typeBonus), 100);
}

function deriveQualityClass(confidenceScore: number): "low" | "medium" | "high" | "verified" {
  if (confidenceScore >= 85) return "verified";
  if (confidenceScore >= 60) return "high";
  if (confidenceScore >= 30) return "medium";
  return "low";
}

// ── Core operations ──────────────────────────────────────────────────────────

export interface CreateOpportunityInput {
  workspaceId: string;
  tenantSlug: string;
  opportunityType: OpportunityType;
  title: string;
  description: string;
  estimatedRevenueImpact?: number;
  effortLevel?: EffortLevel;
  evidenceIds?: string[];
  behavioralEvidenceIds?: string[];
  confidenceScore: number;
  discoveredBy: OpportunitySource;
  relatedRecommendationIds?: string[];
}

export async function createOpportunity(
  input: CreateOpportunityInput
): Promise<MemOpportunity | OpportunityRecordDocument> {
  const effortLevel = input.effortLevel ?? "medium";
  const priorityScore = computePriorityScore(
    input.estimatedRevenueImpact,
    input.confidenceScore,
    effortLevel,
    input.opportunityType
  );
  const qualityClass = deriveQualityClass(input.confidenceScore);
  const opportunityId = makeId("ciif_opp");
  const now = new Date();

  const record: MemOpportunity = {
    opportunityId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    opportunityType: input.opportunityType,
    title: input.title,
    description: input.description,
    priorityScore,
    estimatedRevenueImpact: input.estimatedRevenueImpact,
    effortLevel,
    evidenceIds: input.evidenceIds ?? [],
    behavioralEvidenceIds: input.behavioralEvidenceIds ?? [],
    confidenceScore: input.confidenceScore,
    qualityClass,
    status: "active",
    discoveredBy: input.discoveredBy,
    relatedRecommendationIds: input.relatedRecommendationIds ?? [],
    createdAt: now,
    updatedAt: now
  };

  if (isMongoConnected()) {
    return OpportunityRecord.create(record);
  }

  _memOpportunities.set(opportunityId, record);
  return record;
}

export async function updateOpportunityStatus(
  opportunityId: string,
  status: OpportunityStatus,
  reason?: string
): Promise<void> {
  const now = new Date();
  const statusDates: Partial<Record<OpportunityStatus, keyof MemOpportunity>> = {
    dismissed: "dismissedAt",
    completed: "completedAt",
    in_progress: "inProgressSince"
  };

  if (isMongoConnected()) {
    const update: Record<string, unknown> = { $set: { status, updatedAt: now } };
    const dateField = statusDates[status];
    if (dateField) (update.$set as Record<string, unknown>)[dateField as string] = now;
    if (status === "dismissed" && reason) (update.$set as Record<string, unknown>).dismissedReason = reason;
    await OpportunityRecord.updateOne({ opportunityId }, update);
    return;
  }

  const opp = _memOpportunities.get(opportunityId);
  if (!opp) return;
  opp.status = status;
  opp.updatedAt = now;
  if (status === "dismissed") { opp.dismissedAt = now; if (reason) opp.dismissedReason = reason; }
  if (status === "completed") opp.completedAt = now;
  if (status === "in_progress") opp.inProgressSince = now;
}

export async function getOpportunity(
  opportunityId: string
): Promise<MemOpportunity | OpportunityRecordDocument | null> {
  if (isMongoConnected()) {
    return OpportunityRecord.findOne({ opportunityId });
  }
  return _memOpportunities.get(opportunityId) ?? null;
}

export async function listOpportunities(
  workspaceId: string,
  opts: {
    status?: OpportunityStatus;
    opportunityType?: OpportunityType;
    minPriorityScore?: number;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Array<MemOpportunity | OpportunityRecordDocument>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (isMongoConnected()) {
    const query: Record<string, unknown> = { workspaceId };
    if (opts.status) query.status = opts.status;
    if (opts.opportunityType) query.opportunityType = opts.opportunityType;
    if (opts.minPriorityScore !== undefined) query.priorityScore = { $gte: opts.minPriorityScore };
    return OpportunityRecord.find(query)
      .sort({ priorityScore: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }

  return [..._memOpportunities.values()]
    .filter((o) => {
      if (o.workspaceId !== workspaceId) return false;
      if (opts.status && o.status !== opts.status) return false;
      if (opts.opportunityType && o.opportunityType !== opts.opportunityType) return false;
      if (opts.minPriorityScore !== undefined && o.priorityScore < opts.minPriorityScore) return false;
      return true;
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(offset, offset + limit);
}

// ── Discovery: derive opportunities from existing evidence and behavioral data ─

export interface DiscoveryContext {
  workspaceId: string;
  tenantSlug: string;
  ossScore?: number;
  weaknesses?: string[];
  avgVfsScore?: number;
  topExitPages?: string[];
  behavioralEvidenceIds?: string[];
  evidenceIds?: string[];
  competitorGaps?: string[];
}

export async function discoverOpportunities(ctx: DiscoveryContext): Promise<number> {
  const created: Array<Promise<unknown>> = [];

  // Quick-win: low VFS target pages from behavioral evidence
  if (ctx.avgVfsScore !== undefined && ctx.avgVfsScore > 40 && ctx.behavioralEvidenceIds?.length) {
    created.push(
      createOpportunity({
        workspaceId: ctx.workspaceId,
        tenantSlug: ctx.tenantSlug,
        opportunityType: "quick_win",
        title: "Reduce visitor frustration on high-friction pages",
        description: `Average VFS score of ${ctx.avgVfsScore.toFixed(1)} indicates significant friction. Addressing the top friction points can improve conversion.`,
        effortLevel: "low",
        confidenceScore: Math.min(50 + ctx.avgVfsScore / 2, 90),
        discoveredBy: "behavioral",
        behavioralEvidenceIds: ctx.behavioralEvidenceIds
      })
    );
  }

  // High-impact: low OSS score with known weaknesses
  if (ctx.ossScore !== undefined && ctx.ossScore < 50 && ctx.weaknesses?.length) {
    created.push(
      createOpportunity({
        workspaceId: ctx.workspaceId,
        tenantSlug: ctx.tenantSlug,
        opportunityType: "high_impact",
        title: `Address ${ctx.weaknesses.length} recurring platform weaknesses`,
        description: `OSS score of ${ctx.ossScore} with recurring weaknesses in: ${ctx.weaknesses.slice(0, 3).join(", ")}. Systematic improvement will drive meaningful OSS lift.`,
        effortLevel: "high",
        confidenceScore: 65,
        discoveredBy: "scan",
        evidenceIds: ctx.evidenceIds
      })
    );
  }

  // Conversion: exit pages signal
  if (ctx.topExitPages?.length && ctx.topExitPages.length > 0) {
    created.push(
      createOpportunity({
        workspaceId: ctx.workspaceId,
        tenantSlug: ctx.tenantSlug,
        opportunityType: "conversion",
        title: `Optimise top ${ctx.topExitPages.length} exit pages`,
        description: `Visitors are leaving from: ${ctx.topExitPages.slice(0, 3).join(", ")}. Exit intent improvements on these pages can recover revenue.`,
        effortLevel: "medium",
        confidenceScore: 55,
        discoveredBy: "behavioral",
        behavioralEvidenceIds: ctx.behavioralEvidenceIds
      })
    );
  }

  // Competitive: competitor gaps
  if (ctx.competitorGaps?.length) {
    created.push(
      createOpportunity({
        workspaceId: ctx.workspaceId,
        tenantSlug: ctx.tenantSlug,
        opportunityType: "competitive",
        title: "Close identified competitive gaps",
        description: `Analysis reveals ${ctx.competitorGaps.length} areas where competitors outperform. Closing these gaps improves competitive position.`,
        effortLevel: "medium",
        confidenceScore: 60,
        discoveredBy: "competitive"
      })
    );
  }

  await Promise.all(created);
  return created.length;
}

export async function getOpportunityStats(workspaceId: string): Promise<{
  totalActive: number;
  totalCompleted: number;
  totalDismissed: number;
  avgPriorityScore: number;
  byType: Record<string, number>;
  byEffort: Record<EffortLevel, number>;
}> {
  if (isMongoConnected()) {
    const agg = await OpportunityRecord.aggregate([
      { $match: { workspaceId } },
      {
        $group: {
          _id: null,
          totalActive: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          totalCompleted: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          totalDismissed: { $sum: { $cond: [{ $eq: ["$status", "dismissed"] }, 1, 0] } },
          avgPriority: { $avg: "$priorityScore" }
        }
      }
    ]);
    const typeAgg = await OpportunityRecord.aggregate([
      { $match: { workspaceId } },
      { $group: { _id: "$opportunityType", count: { $sum: 1 } } }
    ]);
    const effortAgg = await OpportunityRecord.aggregate([
      { $match: { workspaceId } },
      { $group: { _id: "$effortLevel", count: { $sum: 1 } } }
    ]);

    const a = agg[0] ?? {};
    return {
      totalActive: a.totalActive ?? 0,
      totalCompleted: a.totalCompleted ?? 0,
      totalDismissed: a.totalDismissed ?? 0,
      avgPriorityScore: Math.round((a.avgPriority ?? 0) * 10) / 10,
      byType: Object.fromEntries(typeAgg.map((t: { _id: string; count: number }) => [t._id, t.count])),
      byEffort: Object.fromEntries(effortAgg.map((t: { _id: string; count: number }) => [t._id, t.count])) as Record<EffortLevel, number>
    };
  }

  const records = [..._memOpportunities.values()].filter((o) => o.workspaceId === workspaceId);
  const avgPriority = records.length > 0 ? records.reduce((s, o) => s + o.priorityScore, 0) / records.length : 0;
  const typeMap = new Map<string, number>();
  const effortMap = new Map<EffortLevel, number>();
  for (const o of records) {
    typeMap.set(o.opportunityType, (typeMap.get(o.opportunityType) ?? 0) + 1);
    effortMap.set(o.effortLevel, (effortMap.get(o.effortLevel) ?? 0) + 1);
  }

  return {
    totalActive: records.filter((o) => o.status === "active").length,
    totalCompleted: records.filter((o) => o.status === "completed").length,
    totalDismissed: records.filter((o) => o.status === "dismissed").length,
    avgPriorityScore: Math.round(avgPriority * 10) / 10,
    byType: Object.fromEntries(typeMap),
    byEffort: Object.fromEntries(effortMap) as Record<EffortLevel, number>
  };
}
