import { isMongoConnected } from "../db/mongoose.js";
import { BenchmarkRecord } from "../models/BenchmarkRecord.js";
import { OperationalControlRecord } from "../models/OperationalControlRecord.js";
import { type DimensionWeightMap, type ScoringThresholds, ScoringAlgorithmVersion } from "../models/ScoringAlgorithmVersion.js";
import { makeId } from "../utils/crypto.js";
import { env } from "../config/env.js";
import { quarantinePayload } from "./quarantineService.js";

export type { DimensionWeightMap, ScoringThresholds };

export interface ScoringAlgorithmVersionView {
  versionId: string;
  versionTag: string;
  algorithm: string;
  dimensionWeights: DimensionWeightMap;
  thresholds: ScoringThresholds;
  isCurrent: boolean;
  qualityCheckPassed?: boolean;
  qualityScore?: number;
  qualityNotes?: string;
  publishedAt: Date;
  deprecatedAt?: Date;
  notes?: string;
  createdAt: Date;
}

const DEFAULT_WEIGHTS: DimensionWeightMap = {
  trust: 1,
  accessibility: 1,
  renderingQuality: 1,
  stability: 1,
  mobileExperience: 1,
  websiteHealth: 1,
  visibilityStructure: 1,
  conversionReadiness: 1,
  informationClarity: 1
};

const DEFAULT_THRESHOLDS: ScoringThresholds = { excellent: 90, good: 75, fair: 60 };

const memoryVersions = new Map<string, ScoringAlgorithmVersionView>();
let memoryCurrentVersionId: string | null = null;

function toView(doc: Record<string, unknown>): ScoringAlgorithmVersionView {
  return {
    versionId: doc.versionId as string,
    versionTag: doc.versionTag as string,
    algorithm: doc.algorithm as string,
    dimensionWeights: doc.dimensionWeights as DimensionWeightMap,
    thresholds: doc.thresholds as ScoringThresholds,
    isCurrent: doc.isCurrent as boolean,
    qualityCheckPassed: doc.qualityCheckPassed as boolean | undefined,
    qualityScore: doc.qualityScore as number | undefined,
    qualityNotes: doc.qualityNotes as string | undefined,
    publishedAt: doc.publishedAt as Date,
    deprecatedAt: doc.deprecatedAt as Date | undefined,
    notes: doc.notes as string | undefined,
    createdAt: doc.createdAt as Date
  };
}

function applyWeights(dimensions: Partial<Record<string, number>>, weights: DimensionWeightMap): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const val = (dimensions as Record<string, number>)[key];
    if (typeof val === "number") {
      weightedSum += val * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

function validateWeights(weights: DimensionWeightMap): string[] {
  const errors: string[] = [];
  for (const [key, val] of Object.entries(weights)) {
    if (typeof val !== "number" || val <= 0) errors.push(`Weight for ${key} must be a positive number.`);
    if (val > 10) errors.push(`Weight for ${key} exceeds maximum of 10.`);
  }
  return errors;
}

function validateThresholds(t: ScoringThresholds): string[] {
  const errors: string[] = [];
  if (t.fair >= t.good) errors.push("fair threshold must be less than good.");
  if (t.good >= t.excellent) errors.push("good threshold must be less than excellent.");
  if (t.excellent > 100 || t.fair < 0) errors.push("thresholds must be in [0, 100].");
  return errors;
}

export async function publishVersion(input: {
  versionTag: string;
  algorithm?: string;
  dimensionWeights?: Partial<DimensionWeightMap>;
  thresholds?: Partial<ScoringThresholds>;
  notes?: string;
  setCurrent?: boolean;
}): Promise<ScoringAlgorithmVersionView> {
  const weights: DimensionWeightMap = { ...DEFAULT_WEIGHTS, ...(input.dimensionWeights ?? {}) };
  const thresholds: ScoringThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };

  const weightErrors = validateWeights(weights);
  const thresholdErrors = validateThresholds(thresholds);
  if (weightErrors.length || thresholdErrors.length) {
    throw new Error([...weightErrors, ...thresholdErrors].join(" | "));
  }

  if (!isMongoConnected()) {
    const versionId = makeId("ver");
    if (input.setCurrent) {
      for (const v of memoryVersions.values()) {
        memoryVersions.set(v.versionId, { ...v, isCurrent: false });
      }
      memoryCurrentVersionId = versionId;
    }
    const view: ScoringAlgorithmVersionView = {
      versionId,
      versionTag: input.versionTag,
      algorithm: input.algorithm ?? "weighted_average_v1",
      dimensionWeights: weights,
      thresholds,
      isCurrent: input.setCurrent ?? false,
      publishedAt: new Date(),
      notes: input.notes,
      createdAt: new Date()
    };
    memoryVersions.set(versionId, view);
    return view;
  }

  if (input.setCurrent) {
    await ScoringAlgorithmVersion.updateMany({ isCurrent: true }, { $set: { isCurrent: false } });
  }

  const versionId = makeId("ver");
  const doc = await ScoringAlgorithmVersion.create({
    versionId,
    versionTag: input.versionTag,
    algorithm: input.algorithm ?? "weighted_average_v1",
    dimensionWeights: weights,
    thresholds,
    isCurrent: input.setCurrent ?? false,
    publishedAt: new Date(),
    notes: input.notes
  });
  return toView(doc.toObject() as unknown as Record<string, unknown>);
}

export async function getCurrentVersion(): Promise<ScoringAlgorithmVersionView | null> {
  if (!isMongoConnected()) {
    if (!memoryCurrentVersionId) return null;
    return memoryVersions.get(memoryCurrentVersionId) ?? null;
  }
  const doc = await ScoringAlgorithmVersion.findOne({ isCurrent: true }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function getVersion(versionId: string): Promise<ScoringAlgorithmVersionView | null> {
  if (!isMongoConnected()) return memoryVersions.get(versionId) ?? null;
  const doc = await ScoringAlgorithmVersion.findOne({ versionId }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function listVersions(limit = 50): Promise<ScoringAlgorithmVersionView[]> {
  if (!isMongoConnected()) {
    return [...memoryVersions.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, limit);
  }
  const docs = await ScoringAlgorithmVersion.find({}).sort({ publishedAt: -1 }).limit(limit).lean();
  return docs.map((d) => toView(d as unknown as Record<string, unknown>));
}

export async function deprecateVersion(versionId: string): Promise<ScoringAlgorithmVersionView | null> {
  if (!isMongoConnected()) {
    const v = memoryVersions.get(versionId);
    if (!v) return null;
    const updated = { ...v, deprecatedAt: new Date(), isCurrent: false };
    memoryVersions.set(versionId, updated);
    if (memoryCurrentVersionId === versionId) memoryCurrentVersionId = null;
    return updated;
  }
  const doc = await ScoringAlgorithmVersion.findOneAndUpdate(
    { versionId },
    { $set: { deprecatedAt: new Date(), isCurrent: false } },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function rollbackToVersion(versionId: string): Promise<ScoringAlgorithmVersionView | null> {
  if (!isMongoConnected()) {
    const v = memoryVersions.get(versionId);
    if (!v || v.deprecatedAt) return null;
    for (const ver of memoryVersions.values()) {
      memoryVersions.set(ver.versionId, { ...ver, isCurrent: false });
    }
    const updated = { ...v, isCurrent: true };
    memoryVersions.set(versionId, updated);
    memoryCurrentVersionId = versionId;
    return updated;
  }
  await ScoringAlgorithmVersion.updateMany({ isCurrent: true }, { $set: { isCurrent: false } });
  const doc = await ScoringAlgorithmVersion.findOneAndUpdate(
    { versionId, deprecatedAt: { $exists: false } },
    { $set: { isCurrent: true } },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function runQualityCheck(versionId: string): Promise<ScoringAlgorithmVersionView | null> {
  const version = await getVersion(versionId);
  if (!version) return null;

  let qualityScore = 100;
  const notes: string[] = [];

  // Structural validation
  const weightErrors = validateWeights(version.dimensionWeights);
  const thresholdErrors = validateThresholds(version.thresholds);
  if (weightErrors.length) {
    qualityScore -= 50;
    notes.push(...weightErrors);
  }
  if (thresholdErrors.length) {
    qualityScore -= 20;
    notes.push(...thresholdErrors);
  }

  // Distribution stability check against recent BenchmarkRecords
  const currentVersion = await getCurrentVersion();
  if (isMongoConnected() && currentVersion && currentVersion.versionId !== versionId) {
    const samples = await BenchmarkRecord.find({}).sort({ createdAt: -1 }).limit(100).lean();
    if (samples.length > 0) {
      const currentScores = samples.map((s) => applyWeights(s.dimensions as Record<string, number>, currentVersion.dimensionWeights));
      const newScores = samples.map((s) => applyWeights(s.dimensions as Record<string, number>, version.dimensionWeights));
      const currentMean = currentScores.reduce((a, b) => a + b, 0) / currentScores.length;
      const newMean = newScores.reduce((a, b) => a + b, 0) / newScores.length;
      const drift = Math.abs(newMean - currentMean);

      if (drift > env.benchmarkMaxDrift) {
        qualityScore -= 30;
        notes.push(`Mean score drift of ${drift.toFixed(1)} pts exceeds threshold of ${env.benchmarkMaxDrift}.`);
      } else {
        notes.push(`Distribution stable: drift ${drift.toFixed(1)} pts across ${samples.length} samples.`);
      }
    } else {
      notes.push("No benchmark records available for distribution check.");
    }
  } else if (!currentVersion) {
    notes.push("No current version set; skipping distribution check.");
  }

  qualityScore = Math.max(0, qualityScore);
  const qualityCheckPassed = qualityScore >= env.benchmarkMinQualityScore;
  const qualityNotes = notes.join(" ") || "All checks passed.";

  if (!qualityCheckPassed) {
    await quarantinePayload({
      quarantineType: "benchmark_quality_failure",
      sourceRoute: "scoring_version_service",
      sourceModel: "ScoringAlgorithmVersion",
      payload: { versionId, versionTag: version.versionTag, qualityScore, notes },
      reason: `Benchmark version quality check failed (score ${qualityScore}): ${qualityNotes}`
    }).catch(() => undefined);
  }

  if (isMongoConnected()) {
    await OperationalControlRecord.create({
      recordId: makeId("bvq"),
      controlType: "benchmark_version",
      status: qualityCheckPassed ? "passing" : "failing",
      scope: versionId,
      score: qualityScore,
      payload: { versionTag: version.versionTag, qualityNotes, qualityCheckPassed }
    }).catch(() => undefined);
  }

  if (!isMongoConnected()) {
    const v = memoryVersions.get(versionId);
    if (v) memoryVersions.set(versionId, { ...v, qualityCheckPassed, qualityScore, qualityNotes });
    return memoryVersions.get(versionId) ?? null;
  }

  const doc = await ScoringAlgorithmVersion.findOneAndUpdate(
    { versionId },
    { $set: { qualityCheckPassed, qualityScore, qualityNotes } },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}
