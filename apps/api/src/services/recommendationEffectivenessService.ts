import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import {
  EffectivenessStatus,
  RecommendationEffectivenessDocument,
  RecommendationEffectivenessRecord
} from "../models/RecommendationEffectivenessRecord.js";

// ─── Recommendation Effectiveness Database ────────────────────────────────────
//
// Tracks whether applied recommendations actually improved visitor behavior.
// This becomes one of SYSTOLAB's most valuable datasets over time:
// aggregating success rates per recommendation type lets the system
// surface which interventions consistently work across workspaces.
//
//   Example aggregate:
//     Recommendation: "Move testimonials higher"
//     Applied: 1,243 times across workspaces
//     Improved: 812 times
//     Success Rate: 65.3%

type MemEffectivenessRecord = {
  effectivenessId: string;
  recommendationId: string;
  workspaceId: string;
  tenantSlug: string;
  recommendationType: string;
  recommendationSummary: string;
  appliedAt?: Date;
  appliedBy?: string;
  beforeEvidenceIds: string[];
  afterEvidenceIds: string[];
  baselineMetrics: Record<string, number>;
  outcomeMetrics: Record<string, number>;
  improved?: boolean;
  improvementDelta?: Record<string, number>;
  effectivenessScore?: number;
  globalApplicationCount?: number;
  globalSuccessCount?: number;
  globalSuccessRate?: number;
  status: EffectivenessStatus;
  validatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const _memEffectiveness = new Map<string, MemEffectivenessRecord>();

export async function recordRecommendationApplication(input: {
  recommendationId: string;
  workspaceId: string;
  tenantSlug: string;
  recommendationType: string;
  recommendationSummary: string;
  appliedBy?: string;
  beforeEvidenceIds?: string[];
}): Promise<{ record: MemEffectivenessRecord | RecommendationEffectivenessDocument }> {
  const now = new Date();
  const data: MemEffectivenessRecord = {
    effectivenessId: makeId("vil_eff"),
    recommendationId: input.recommendationId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    recommendationType: input.recommendationType,
    recommendationSummary: input.recommendationSummary,
    appliedAt: now,
    appliedBy: input.appliedBy,
    beforeEvidenceIds: input.beforeEvidenceIds ?? [],
    afterEvidenceIds: [],
    baselineMetrics: {},
    outcomeMetrics: {},
    status: "measuring",
    createdAt: now,
    updatedAt: now
  };

  if (!isMongoConnected()) {
    _memEffectiveness.set(data.effectivenessId, data);
    return { record: data };
  }

  const record = await RecommendationEffectivenessRecord.create(data);
  return { record };
}

export async function setBaselineMetrics(
  effectivenessId: string,
  baselineMetrics: Record<string, number>
): Promise<void> {
  if (!isMongoConnected()) {
    const rec = _memEffectiveness.get(effectivenessId);
    if (rec) { rec.baselineMetrics = baselineMetrics; rec.updatedAt = new Date(); }
    return;
  }
  await RecommendationEffectivenessRecord.updateOne({ effectivenessId }, { $set: { baselineMetrics } });
}

export async function recordOutcomeMetrics(
  effectivenessId: string,
  outcomeMetrics: Record<string, number>,
  afterEvidenceIds: string[] = []
): Promise<void> {
  if (!isMongoConnected()) {
    const rec = _memEffectiveness.get(effectivenessId);
    if (rec) {
      rec.outcomeMetrics = outcomeMetrics;
      rec.afterEvidenceIds = afterEvidenceIds;
      rec.updatedAt = new Date();
    }
    return;
  }
  await RecommendationEffectivenessRecord.updateOne(
    { effectivenessId },
    { $set: { outcomeMetrics, afterEvidenceIds } }
  );
}

export async function validateEffectiveness(
  effectivenessId: string
): Promise<MemEffectivenessRecord | RecommendationEffectivenessDocument | null> {
  if (!isMongoConnected()) {
    const rec = _memEffectiveness.get(effectivenessId);
    if (!rec) return null;

    const delta = computeImprovementDelta(rec.baselineMetrics, rec.outcomeMetrics);
    const improved = isImproved(delta);
    const effectivenessScore = computeEffectivenessScore(delta);

    rec.improved = improved;
    rec.improvementDelta = delta;
    rec.effectivenessScore = effectivenessScore;
    rec.status = "validated";
    rec.validatedAt = new Date();
    rec.updatedAt = new Date();

    // Update global aggregate stats for this recommendation type
    await updateGlobalAggregates(rec.recommendationType);

    return rec;
  }

  const rec = await RecommendationEffectivenessRecord.findOne({ effectivenessId }).lean();
  if (!rec) return null;

  const delta = computeImprovementDelta(
    rec.baselineMetrics as Record<string, number>,
    rec.outcomeMetrics as Record<string, number>
  );
  const improved = isImproved(delta);
  const effectivenessScore = computeEffectivenessScore(delta);

  await RecommendationEffectivenessRecord.updateOne(
    { effectivenessId },
    {
      $set: {
        improved,
        improvementDelta: delta,
        effectivenessScore,
        status: "validated",
        validatedAt: new Date()
      }
    }
  );

  return RecommendationEffectivenessRecord.findOne({ effectivenessId }).lean();
}

export async function getEffectivenessStats(
  opts: { recommendationType?: string; workspaceId?: string } = {}
): Promise<{
  totalApplications: number;
  validated: number;
  improved: number;
  successRate: number;
  avgEffectivenessScore: number;
  byType: Record<string, { applied: number; improved: number; successRate: number }>;
}> {
  const records = [..._memEffectiveness.values()].filter((r) => {
    if (opts.recommendationType && r.recommendationType !== opts.recommendationType) return false;
    if (opts.workspaceId && r.workspaceId !== opts.workspaceId) return false;
    return true;
  });

  const validated = records.filter((r) => r.status === "validated");
  const improved = validated.filter((r) => r.improved === true);
  const scores = validated.map((r) => r.effectivenessScore ?? 0);
  const avgEffectivenessScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const byType: Record<string, { applied: number; improved: number; successRate: number }> = {};
  for (const r of validated) {
    if (!byType[r.recommendationType]) byType[r.recommendationType] = { applied: 0, improved: 0, successRate: 0 };
    byType[r.recommendationType]!.applied++;
    if (r.improved) byType[r.recommendationType]!.improved++;
  }
  for (const type of Object.keys(byType)) {
    const t = byType[type]!;
    t.successRate = t.applied > 0 ? Math.round((t.improved / t.applied) * 100) : 0;
  }

  return {
    totalApplications: records.length,
    validated: validated.length,
    improved: improved.length,
    successRate: validated.length > 0 ? Math.round((improved.length / validated.length) * 100) : 0,
    avgEffectivenessScore: Math.round(avgEffectivenessScore),
    byType
  };
}

export async function getTopPerformingRecommendationTypes(
  limit = 10
): Promise<{ recommendationType: string; applied: number; improved: number; successRate: number }[]> {
  const stats = await getEffectivenessStats();
  return Object.entries(stats.byType)
    .map(([recommendationType, data]) => ({ recommendationType, ...data }))
    .sort((a, b) => b.successRate - a.successRate || b.applied - a.applied)
    .slice(0, limit);
}

export async function listEffectivenessRecords(
  workspaceId: string,
  opts: { status?: EffectivenessStatus; limit?: number; skip?: number } = {}
): Promise<{ records: (MemEffectivenessRecord | RecommendationEffectivenessDocument)[]; total: number }> {
  const limit = opts.limit ?? 50;
  const skip = opts.skip ?? 0;

  if (!isMongoConnected()) {
    const all = [..._memEffectiveness.values()].filter(
      (r) => r.workspaceId === workspaceId && (!opts.status || r.status === opts.status)
    );
    return { records: all.slice(skip, skip + limit), total: all.length };
  }

  const query: Record<string, unknown> = { workspaceId };
  if (opts.status) query["status"] = opts.status;
  const [records, total] = await Promise.all([
    RecommendationEffectivenessRecord.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    RecommendationEffectivenessRecord.countDocuments(query)
  ]);
  return { records, total };
}

// ─── Private helpers ───────────────────────────────────────────────────────────

function computeImprovementDelta(
  baseline: Record<string, number>,
  outcome: Record<string, number>
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(outcome)])) {
    const b = baseline[key] ?? 0;
    const o = outcome[key] ?? 0;
    delta[key] = Math.round((o - b) * 100) / 100;
  }
  return delta;
}

function isImproved(delta: Record<string, number>): boolean {
  // Higher click rates, lower abandon rates, lower VFS = improvement
  const positiveKeys = ["clickRate", "completionRate", "engagementScore"];
  const negativeKeys = ["abandonRate", "vfsScore", "exitConcentrationRate", "rageClickCount"];

  let positiveSum = 0, negativeSum = 0;

  for (const k of positiveKeys) {
    if (k in delta) positiveSum += delta[k]!;
  }
  for (const k of negativeKeys) {
    if (k in delta) negativeSum -= delta[k]!; // Negative delta on bad metrics = improvement
  }

  const neutral = positiveSum + negativeSum;
  return neutral > 0;
}

function computeEffectivenessScore(delta: Record<string, number>): number {
  let score = 50; // Neutral baseline
  const impacts: number[] = [];

  for (const [key, change] of Object.entries(delta)) {
    const positive = ["clickRate", "completionRate", "engagementScore"];
    const negative = ["abandonRate", "vfsScore", "exitConcentrationRate", "rageClickCount"];
    if (positive.includes(key)) impacts.push(change);
    if (negative.includes(key)) impacts.push(-change);
  }

  if (impacts.length > 0) {
    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
    score = Math.min(Math.max(50 + avgImpact * 2, 0), 100);
  }

  return Math.round(score);
}

async function updateGlobalAggregates(recommendationType: string): Promise<void> {
  const all = [..._memEffectiveness.values()].filter(
    (r) => r.recommendationType === recommendationType && r.status === "validated"
  );
  const improved = all.filter((r) => r.improved === true).length;
  const globalSuccessRate = all.length > 0 ? Math.round((improved / all.length) * 100) : 0;

  for (const r of _memEffectiveness.values()) {
    if (r.recommendationType === recommendationType) {
      r.globalApplicationCount = all.length;
      r.globalSuccessCount = improved;
      r.globalSuccessRate = globalSuccessRate;
    }
  }
}
