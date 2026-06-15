import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { BusinessDnaRecord, BusinessDnaRecordDocument, BusinessMaturityLevel, ScoreTrend } from "../models/BusinessDnaRecord.js";

// ── In-memory fallback ───────────────────────────────────────────────────────

interface MemBusinessDna {
  dnaId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  businessType?: string;
  industry?: string;
  maturityLevel: BusinessMaturityLevel;
  totalScans: number;
  firstScannedAt?: Date;
  lastScannedAt?: Date;
  recurringStrengths: string[];
  recurringWeaknesses: string[];
  growthPatterns: string[];
  operationalTendencies: string[];
  totalRecommendationsReceived: number;
  totalRecommendationsImplemented: number;
  implementationRate: number;
  avgEffectivenessScore: number;
  topEffectiveRecommendationTypes: string[];
  scoreHistory: Array<{ date: Date; oss: number; snapshotId: string }>;
  avgOssScore: number;
  peakOssScore: number;
  scoreTrend: ScoreTrend;
  dominantVisitorArchetype?: string;
  avgVisitorFrustrationScore?: number;
  topExitPages: string[];
  topConversionPaths: string[];
  competitorCount?: number;
  businessInsights: string[];
  openOpportunityCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export const _memBusinessDna = new Map<string, MemBusinessDna>();
const _workspaceIndex = new Map<string, string>(); // workspaceId → dnaId

function _defaultDna(workspaceId: string, tenantSlug: string, targetUrl: string): MemBusinessDna {
  const dnaId = makeId("ciif_dna");
  return {
    dnaId,
    workspaceId,
    tenantSlug,
    targetUrl,
    maturityLevel: "early",
    totalScans: 0,
    recurringStrengths: [],
    recurringWeaknesses: [],
    growthPatterns: [],
    operationalTendencies: [],
    totalRecommendationsReceived: 0,
    totalRecommendationsImplemented: 0,
    implementationRate: 0,
    avgEffectivenessScore: 0,
    topEffectiveRecommendationTypes: [],
    scoreHistory: [],
    avgOssScore: 0,
    peakOssScore: 0,
    scoreTrend: "stable",
    topExitPages: [],
    topConversionPaths: [],
    businessInsights: [],
    openOpportunityCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeScoreTrend(scoreHistory: Array<{ oss: number }>): ScoreTrend {
  if (scoreHistory.length < 3) return "stable";
  const recent = scoreHistory.slice(-6);
  const deltas = recent.slice(1).map((s, i) => s.oss - recent[i]!.oss);
  const positive = deltas.filter((d) => d > 0).length;
  const negative = deltas.filter((d) => d < 0).length;
  const variance = deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;

  if (variance > 15) return "volatile";
  if (positive > negative + 1) return "improving";
  if (negative > positive + 1) return "declining";
  return "stable";
}

function computeMaturityLevel(totalScans: number, avgOss: number, implementationRate: number): BusinessMaturityLevel {
  if (totalScans >= 12 && avgOss >= 70 && implementationRate >= 0.5) return "optimized";
  if (totalScans >= 6 && avgOss >= 50 && implementationRate >= 0.25) return "mature";
  if (totalScans >= 3) return "developing";
  return "early";
}

function mergeStringList(existing: string[], incoming: string[], limit = 10): string[] {
  const merged = [...new Set([...incoming, ...existing])];
  return merged.slice(0, limit);
}

// ── Core operations ──────────────────────────────────────────────────────────

export async function getOrCreateBusinessDna(
  workspaceId: string,
  tenantSlug: string,
  targetUrl: string
): Promise<MemBusinessDna | BusinessDnaRecordDocument> {
  if (isMongoConnected()) {
    let record = await BusinessDnaRecord.findOne({ workspaceId });
    if (!record) {
      const dnaId = makeId("ciif_dna");
      record = await BusinessDnaRecord.create({
        dnaId,
        workspaceId,
        tenantSlug,
        targetUrl,
        maturityLevel: "early",
        totalScans: 0,
        implementationRate: 0,
        avgEffectivenessScore: 0,
        avgOssScore: 0,
        peakOssScore: 0,
        scoreTrend: "stable",
        openOpportunityCount: 0
      });
    }
    return record;
  }

  const existingId = _workspaceIndex.get(workspaceId);
  if (existingId) {
    const existing = _memBusinessDna.get(existingId);
    if (existing) return existing;
  }

  const dna = _defaultDna(workspaceId, tenantSlug, targetUrl);
  _memBusinessDna.set(dna.dnaId, dna);
  _workspaceIndex.set(workspaceId, dna.dnaId);
  return dna;
}

export interface ScanUpdateInput {
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  snapshotId: string;
  ossScore: number;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  businessType?: string;
  industry?: string;
  competitorCount?: number;
}

export async function updateDnaFromScan(input: ScanUpdateInput): Promise<void> {
  const now = new Date();

  if (isMongoConnected()) {
    const current = await BusinessDnaRecord.findOne({ workspaceId: input.workspaceId });
    const scoreHistory = [
      ...((current?.scoreHistory ?? []) as Array<{ date: Date; oss: number; snapshotId: string }>),
      { date: now, oss: input.ossScore, snapshotId: input.snapshotId }
    ];
    const avgOss = scoreHistory.reduce((s, h) => s + h.oss, 0) / scoreHistory.length;
    const peakOss = Math.max(...scoreHistory.map((h) => h.oss));
    const totalScans = (current?.totalScans ?? 0) + 1;
    const scoreTrend = computeScoreTrend(scoreHistory);
    const maturityLevel = computeMaturityLevel(totalScans, avgOss, current?.implementationRate ?? 0);
    const totalReceived = (current?.totalRecommendationsReceived ?? 0) + (input.recommendations?.length ?? 0);

    await BusinessDnaRecord.updateOne(
      { workspaceId: input.workspaceId },
      {
        $set: {
          tenantSlug: input.tenantSlug,
          targetUrl: input.targetUrl,
          lastScannedAt: now,
          scoreHistory,
          avgOssScore: Math.round(avgOss * 10) / 10,
          peakOssScore: peakOss,
          scoreTrend,
          maturityLevel,
          totalRecommendationsReceived: totalReceived,
          ...(input.businessType && { businessType: input.businessType }),
          ...(input.industry && { industry: input.industry }),
          ...(input.competitorCount !== undefined && { competitorCount: input.competitorCount })
        },
        $inc: { totalScans: 1 },
        $addToSet: {
          recurringStrengths: { $each: input.strengths?.slice(0, 5) ?? [] },
          recurringWeaknesses: { $each: input.weaknesses?.slice(0, 5) ?? [] }
        },
        $setOnInsert: { firstScannedAt: now }
      },
      { upsert: true }
    );
    return;
  }

  const dna = (await getOrCreateBusinessDna(input.workspaceId, input.tenantSlug, input.targetUrl)) as MemBusinessDna;
  dna.scoreHistory.push({ date: now, oss: input.ossScore, snapshotId: input.snapshotId });
  dna.totalScans++;
  dna.lastScannedAt = now;
  if (!dna.firstScannedAt) dna.firstScannedAt = now;
  dna.avgOssScore = Math.round((dna.scoreHistory.reduce((s, h) => s + h.oss, 0) / dna.scoreHistory.length) * 10) / 10;
  dna.peakOssScore = Math.max(...dna.scoreHistory.map((h) => h.oss));
  dna.scoreTrend = computeScoreTrend(dna.scoreHistory);
  dna.maturityLevel = computeMaturityLevel(dna.totalScans, dna.avgOssScore, dna.implementationRate);
  dna.totalRecommendationsReceived += input.recommendations?.length ?? 0;
  if (input.strengths) dna.recurringStrengths = mergeStringList(dna.recurringStrengths, input.strengths);
  if (input.weaknesses) dna.recurringWeaknesses = mergeStringList(dna.recurringWeaknesses, input.weaknesses);
  if (input.businessType) dna.businessType = input.businessType;
  if (input.industry) dna.industry = input.industry;
  if (input.competitorCount !== undefined) dna.competitorCount = input.competitorCount;
  dna.updatedAt = now;
}

export interface BehavioralUpdateInput {
  workspaceId: string;
  dominantArchetype?: string;
  avgVfsScore?: number;
  topExitPages?: string[];
  topConversionPaths?: string[];
  openOpportunityCount?: number;
  businessInsights?: string[];
}

export async function updateDnaFromBehavioralData(input: BehavioralUpdateInput): Promise<void> {
  if (isMongoConnected()) {
    const updates: Record<string, unknown> = {};
    if (input.dominantArchetype) updates.dominantVisitorArchetype = input.dominantArchetype;
    if (input.avgVfsScore !== undefined) updates.avgVisitorFrustrationScore = input.avgVfsScore;
    if (input.topExitPages) updates.topExitPages = input.topExitPages.slice(0, 10);
    if (input.topConversionPaths) updates.topConversionPaths = input.topConversionPaths.slice(0, 10);
    if (input.openOpportunityCount !== undefined) updates.openOpportunityCount = input.openOpportunityCount;
    if (input.businessInsights) updates.businessInsights = input.businessInsights.slice(0, 20);

    await BusinessDnaRecord.updateOne({ workspaceId: input.workspaceId }, { $set: updates });
    return;
  }

  const existingId = _workspaceIndex.get(input.workspaceId);
  if (!existingId) return;
  const dna = _memBusinessDna.get(existingId);
  if (!dna) return;

  if (input.dominantArchetype) dna.dominantVisitorArchetype = input.dominantArchetype;
  if (input.avgVfsScore !== undefined) dna.avgVisitorFrustrationScore = input.avgVfsScore;
  if (input.topExitPages) dna.topExitPages = input.topExitPages.slice(0, 10);
  if (input.topConversionPaths) dna.topConversionPaths = input.topConversionPaths.slice(0, 10);
  if (input.openOpportunityCount !== undefined) dna.openOpportunityCount = input.openOpportunityCount;
  if (input.businessInsights) dna.businessInsights = input.businessInsights.slice(0, 20);
  dna.updatedAt = new Date();
}

export async function recordRecommendationImplementation(
  workspaceId: string,
  effectivenessScore?: number
): Promise<void> {
  if (isMongoConnected()) {
    const current = await BusinessDnaRecord.findOne({ workspaceId }).select(
      "totalRecommendationsImplemented totalRecommendationsReceived avgEffectivenessScore"
    );
    if (!current) return;

    const newImplemented = (current.totalRecommendationsImplemented ?? 0) + 1;
    const implementationRate =
      current.totalRecommendationsReceived > 0
        ? newImplemented / current.totalRecommendationsReceived
        : 0;

    let newAvg = current.avgEffectivenessScore ?? 0;
    if (effectivenessScore !== undefined && newImplemented > 0) {
      newAvg = ((newAvg * (newImplemented - 1)) + effectivenessScore) / newImplemented;
    }

    await BusinessDnaRecord.updateOne(
      { workspaceId },
      {
        $set: {
          totalRecommendationsImplemented: newImplemented,
          implementationRate: Math.round(implementationRate * 1000) / 1000,
          avgEffectivenessScore: Math.round(newAvg * 10) / 10
        }
      }
    );
    return;
  }

  const existingId = _workspaceIndex.get(workspaceId);
  if (!existingId) return;
  const dna = _memBusinessDna.get(existingId);
  if (!dna) return;

  dna.totalRecommendationsImplemented++;
  dna.implementationRate =
    dna.totalRecommendationsReceived > 0
      ? dna.totalRecommendationsImplemented / dna.totalRecommendationsReceived
      : 0;

  if (effectivenessScore !== undefined) {
    const n = dna.totalRecommendationsImplemented;
    dna.avgEffectivenessScore = Math.round(((dna.avgEffectivenessScore * (n - 1) + effectivenessScore) / n) * 10) / 10;
  }
  dna.updatedAt = new Date();
}

export async function getBusinessDna(workspaceId: string): Promise<MemBusinessDna | BusinessDnaRecordDocument | null> {
  if (isMongoConnected()) {
    return BusinessDnaRecord.findOne({ workspaceId });
  }
  const id = _workspaceIndex.get(workspaceId);
  return id ? (_memBusinessDna.get(id) ?? null) : null;
}

export async function listBusinessDnas(
  tenantSlug: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Array<MemBusinessDna | BusinessDnaRecordDocument>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (isMongoConnected()) {
    return BusinessDnaRecord.find({ tenantSlug })
      .sort({ lastScannedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }

  return [..._memBusinessDna.values()]
    .filter((d) => d.tenantSlug === tenantSlug)
    .sort((a, b) => (b.lastScannedAt?.getTime() ?? 0) - (a.lastScannedAt?.getTime() ?? 0))
    .slice(offset, offset + limit);
}
