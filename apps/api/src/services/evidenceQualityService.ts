import { isMongoConnected } from "../db/mongoose.js";
import { EvidenceRecord } from "../models/EvidenceRecord.js";
import { BehavioralEvidence } from "../models/BehavioralEvidence.js";

// ── Evidence Quality Classification ──────────────────────────────────────────
//
// Quality score 0-100 built from 6 weighted factors:
//   dataVolume            0-25  how many sessions/samples back the evidence
//   statisticalSignif.    0-25  whether significance threshold is met
//   sourceReliability     0-20  derived-from-VIL vs derived-from-scan vs synthesized
//   behavioralConsistency 0-15  consistency of signals across time windows
//   validationHistory     0-10  proportion of prior validations that succeeded
//   completeness          0-5   all expected fields populated
//
// Classification thresholds (CIIF spec):
//   0-29   → low
//   30-59  → medium
//   60-84  → high
//   85-100 → verified

export type EvidenceQualityClass = "low" | "medium" | "high" | "verified";

export interface QualityFactors {
  sampleSize?: number;
  statisticalSignificance?: boolean;
  sourceType?: "behavioral" | "scan" | "synthesized" | "competitive";
  consistencyLevel?: "low" | "medium" | "high";
  priorValidations?: number;
  priorValidationSuccesses?: number;
  completenessFields?: number;
  totalExpectedFields?: number;
}

export interface QualityResult {
  qualityScore: number;
  qualityClass: EvidenceQualityClass;
  qualityReason: string;
  breakdown: {
    dataVolume: number;
    statisticalSignificance: number;
    sourceReliability: number;
    behavioralConsistency: number;
    validationHistory: number;
    completeness: number;
  };
}

export function classifyQuality(score: number): EvidenceQualityClass {
  if (score >= 85) return "verified";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function computeEvidenceQuality(factors: QualityFactors): QualityResult {
  // Factor 1 — data volume (0-25)
  const sampleSize = factors.sampleSize ?? 0;
  const dataVolume = Math.min((sampleSize / 200) * 25, 25);

  // Factor 2 — statistical significance (0-25)
  const statisticalSignificance = factors.statisticalSignificance === true ? 25 : 0;

  // Factor 3 — source reliability (0-20)
  const sourceReliabilityMap: Record<string, number> = {
    behavioral: 20,
    scan: 15,
    synthesized: 10,
    competitive: 8
  };
  const sourceReliability = sourceReliabilityMap[factors.sourceType ?? "synthesized"] ?? 10;

  // Factor 4 — behavioral consistency (0-15)
  const consistencyMap: Record<string, number> = { high: 15, medium: 8, low: 2 };
  const behavioralConsistency = consistencyMap[factors.consistencyLevel ?? "low"] ?? 2;

  // Factor 5 — validation history (0-10)
  let validationHistory = 0;
  if (factors.priorValidations && factors.priorValidations > 0) {
    const successRate = (factors.priorValidationSuccesses ?? 0) / factors.priorValidations;
    validationHistory = Math.round(successRate * 10);
  }

  // Factor 6 — completeness (0-5)
  let completeness = 0;
  const total = factors.totalExpectedFields ?? 0;
  const filled = factors.completenessFields ?? 0;
  if (total > 0) {
    completeness = Math.round((filled / total) * 5);
  }

  const qualityScore = Math.min(
    Math.round(dataVolume + statisticalSignificance + sourceReliability + behavioralConsistency + validationHistory + completeness),
    100
  );
  const qualityClass = classifyQuality(qualityScore);

  const reasons: string[] = [];
  if (dataVolume < 5) reasons.push("low sample volume");
  if (!factors.statisticalSignificance) reasons.push("not statistically significant");
  if (sourceReliability < 12) reasons.push("lower-reliability source");
  if (behavioralConsistency < 8) reasons.push("low behavioral consistency");
  if (validationHistory === 0 && (factors.priorValidations ?? 0) === 0) reasons.push("no validation history");

  const qualityReason =
    reasons.length > 0
      ? `${qualityClass} quality due to: ${reasons.join(", ")}`
      : `${qualityClass} quality evidence`;

  return {
    qualityScore,
    qualityClass,
    qualityReason,
    breakdown: {
      dataVolume: Math.round(dataVolume),
      statisticalSignificance,
      sourceReliability,
      behavioralConsistency,
      validationHistory,
      completeness
    }
  };
}

// ── Classify and persist quality on EvidenceRecord ──────────────────────────

export async function classifyEvidenceRecord(
  evidenceId: string,
  factors: QualityFactors
): Promise<QualityResult> {
  const result = computeEvidenceQuality(factors);

  if (isMongoConnected()) {
    await EvidenceRecord.updateOne(
      { evidenceId },
      {
        $set: {
          qualityClass: result.qualityClass,
          qualityScore: result.qualityScore,
          qualityReason: result.qualityReason,
          qualityEvaluatedAt: new Date()
        }
      }
    );
  }

  return result;
}

// ── Classify and persist quality on BehavioralEvidence ──────────────────────

export async function classifyBehavioralEvidence(
  behavioralEvidenceId: string,
  factors: QualityFactors
): Promise<QualityResult> {
  const result = computeEvidenceQuality(factors);

  if (isMongoConnected()) {
    await BehavioralEvidence.updateOne(
      { behavioralEvidenceId },
      {
        $set: {
          qualityClass: result.qualityClass,
          qualityScore: result.qualityScore
        }
      }
    );
  }

  return result;
}

// ── Batch classify all unclassified behavioral evidence for a workspace ──────

export async function classifyUnclassifiedBehavioralEvidence(
  workspaceId: string
): Promise<{ classified: number }> {
  if (!isMongoConnected()) return { classified: 0 };

  const unclassified = await BehavioralEvidence.find({
    workspaceId,
    qualityClass: { $exists: false }
  })
    .select("behavioralEvidenceId sampleSize statisticalSignificance consistencyLevel")
    .lean();

  let classified = 0;
  for (const rec of unclassified) {
    const factors: QualityFactors = {
      sampleSize: rec.sampleSize as number,
      statisticalSignificance: rec.statisticalSignificance as boolean,
      sourceType: "behavioral",
      consistencyLevel: rec.consistencyLevel as "low" | "medium" | "high"
    };
    await classifyBehavioralEvidence(rec.behavioralEvidenceId as string, factors);
    classified++;
  }

  return { classified };
}

// ── Aggregate quality stats for a workspace ─────────────────────────────────

export async function getEvidenceQualityStats(workspaceId: string): Promise<{
  totalEvidenceRecords: number;
  classifiedEvidenceRecords: number;
  qualityDistribution: Record<EvidenceQualityClass, number>;
  avgQualityScore: number;
  totalBehavioralEvidence: number;
  classifiedBehavioralEvidence: number;
  behavioralQualityDistribution: Record<EvidenceQualityClass, number>;
}> {
  const empty = (): Record<EvidenceQualityClass, number> => ({
    low: 0,
    medium: 0,
    high: 0,
    verified: 0
  });

  if (!isMongoConnected()) {
    return {
      totalEvidenceRecords: 0,
      classifiedEvidenceRecords: 0,
      qualityDistribution: empty(),
      avgQualityScore: 0,
      totalBehavioralEvidence: 0,
      classifiedBehavioralEvidence: 0,
      behavioralQualityDistribution: empty()
    };
  }

  const [erAgg, beAgg] = await Promise.all([
    EvidenceRecord.aggregate([
      { $match: { workspaceId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          classified: { $sum: { $cond: [{ $ifNull: ["$qualityClass", false] }, 1, 0] } },
          avgScore: { $avg: { $ifNull: ["$qualityScore", 0] } },
          low: { $sum: { $cond: [{ $eq: ["$qualityClass", "low"] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ["$qualityClass", "medium"] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ["$qualityClass", "high"] }, 1, 0] } },
          verified: { $sum: { $cond: [{ $eq: ["$qualityClass", "verified"] }, 1, 0] } }
        }
      }
    ]),
    BehavioralEvidence.aggregate([
      { $match: { workspaceId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          classified: { $sum: { $cond: [{ $ifNull: ["$qualityClass", false] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ["$qualityClass", "low"] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ["$qualityClass", "medium"] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ["$qualityClass", "high"] }, 1, 0] } },
          verified: { $sum: { $cond: [{ $eq: ["$qualityClass", "verified"] }, 1, 0] } }
        }
      }
    ])
  ]);

  const er = erAgg[0] ?? {};
  const be = beAgg[0] ?? {};

  return {
    totalEvidenceRecords: er.total ?? 0,
    classifiedEvidenceRecords: er.classified ?? 0,
    qualityDistribution: { low: er.low ?? 0, medium: er.medium ?? 0, high: er.high ?? 0, verified: er.verified ?? 0 },
    avgQualityScore: Math.round((er.avgScore ?? 0) * 10) / 10,
    totalBehavioralEvidence: be.total ?? 0,
    classifiedBehavioralEvidence: be.classified ?? 0,
    behavioralQualityDistribution: { low: be.low ?? 0, medium: be.medium ?? 0, high: be.high ?? 0, verified: be.verified ?? 0 }
  };
}
