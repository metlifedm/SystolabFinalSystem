import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import {
  IntelligenceValidationRecord,
  IntelligenceValidationRecordDocument,
  ValidationArtifactType,
  CalibrationStatus
} from "../models/IntelligenceValidationRecord.js";

// ── In-memory fallback ───────────────────────────────────────────────────────

interface MemValidationRecord {
  validationId: string;
  workspaceId: string;
  tenantSlug: string;
  artifactType: ValidationArtifactType;
  artifactId: string;
  predictedOutcome: Record<string, unknown>;
  actualOutcome: Record<string, unknown>;
  accuracyScore: number;
  predictionError?: number;
  calibrationStatus: CalibrationStatus;
  predictedConfidence: number;
  actualConfidence?: number;
  confidenceDrift: number;
  finding: string;
  actionRequired: boolean;
  adjustmentRecommended?: string;
  evidenceIds: string[];
  validatedAt: Date;
  createdAt: Date;
}

export const _memValidationRecords = new Map<string, MemValidationRecord>();

// ── Calibration determination ────────────────────────────────────────────────

function determineCalibration(
  predictedConfidence: number,
  accuracyScore: number
): CalibrationStatus {
  const confidenceDrift = predictedConfidence - accuracyScore;
  if (Math.abs(confidenceDrift) <= 10) return "well_calibrated";
  if (confidenceDrift > 10) return "overconfident";
  return "underconfident";
}

// Compute numeric accuracy for predicted vs actual outcome comparison
function computeNumericAccuracy(
  predicted: Record<string, unknown>,
  actual: Record<string, unknown>
): { accuracyScore: number; predictionError: number | undefined } {
  const numericKeys = Object.keys(predicted).filter(
    (k) => typeof predicted[k] === "number" && typeof actual[k] === "number"
  );

  if (numericKeys.length === 0) {
    // For non-numeric, use simple key match ratio as proxy
    const totalKeys = new Set([...Object.keys(predicted), ...Object.keys(actual)]).size;
    const matchedKeys = Object.keys(predicted).filter(
      (k) => JSON.stringify(predicted[k]) === JSON.stringify(actual[k])
    ).length;
    return { accuracyScore: totalKeys > 0 ? Math.round((matchedKeys / totalKeys) * 100) : 0, predictionError: undefined };
  }

  const errors = numericKeys.map((k) => {
    const p = predicted[k] as number;
    const a = actual[k] as number;
    const range = Math.max(Math.abs(a), 1);
    return Math.abs(p - a) / range;
  });

  const avgError = errors.reduce((s, e) => s + e, 0) / errors.length;
  const accuracyScore = Math.round(Math.max(0, (1 - avgError) * 100));
  const predictionError = Math.round(avgError * 100) / 100;

  return { accuracyScore, predictionError };
}

// ── Core operations ──────────────────────────────────────────────────────────

export interface RecordValidationInput {
  workspaceId: string;
  tenantSlug: string;
  artifactType: ValidationArtifactType;
  artifactId: string;
  predictedOutcome: Record<string, unknown>;
  actualOutcome: Record<string, unknown>;
  predictedConfidence: number;
  evidenceIds?: string[];
  adjustmentRecommended?: string;
}

export async function recordValidation(
  input: RecordValidationInput
): Promise<MemValidationRecord | IntelligenceValidationRecordDocument> {
  const { accuracyScore, predictionError } = computeNumericAccuracy(
    input.predictedOutcome,
    input.actualOutcome
  );

  const calibrationStatus = determineCalibration(input.predictedConfidence, accuracyScore);
  const confidenceDrift = input.predictedConfidence - accuracyScore;

  const finding = buildFinding(calibrationStatus, accuracyScore, input.artifactType);
  const actionRequired = calibrationStatus !== "well_calibrated" && Math.abs(confidenceDrift) > 20;

  const validationId = makeId("ciif_val");
  const now = new Date();

  const record: MemValidationRecord = {
    validationId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: input.actualOutcome,
    accuracyScore,
    predictionError,
    calibrationStatus,
    predictedConfidence: input.predictedConfidence,
    confidenceDrift,
    finding,
    actionRequired,
    adjustmentRecommended: input.adjustmentRecommended,
    evidenceIds: input.evidenceIds ?? [],
    validatedAt: now,
    createdAt: now
  };

  if (isMongoConnected()) {
    return IntelligenceValidationRecord.create(record);
  }

  _memValidationRecords.set(validationId, record);
  return record;
}

function buildFinding(status: CalibrationStatus, accuracy: number, artifactType: ValidationArtifactType): string {
  const typeLabel = artifactType.replace(/_/g, " ");
  if (status === "well_calibrated") return `${typeLabel} prediction was well-calibrated with ${accuracy}% accuracy`;
  if (status === "overconfident") return `${typeLabel} prediction was overconfident — stated confidence exceeded actual accuracy by more than 10 points`;
  if (status === "underconfident") return `${typeLabel} prediction was underconfident — stated confidence underestimated actual accuracy`;
  return `Insufficient data to assess ${typeLabel} calibration`;
}

export async function getValidation(
  validationId: string
): Promise<MemValidationRecord | IntelligenceValidationRecordDocument | null> {
  if (isMongoConnected()) {
    return IntelligenceValidationRecord.findOne({ validationId });
  }
  return _memValidationRecords.get(validationId) ?? null;
}

export async function listValidationsForWorkspace(
  workspaceId: string,
  opts: {
    artifactType?: ValidationArtifactType;
    calibrationStatus?: CalibrationStatus;
    actionRequiredOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Array<MemValidationRecord | IntelligenceValidationRecordDocument>> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (isMongoConnected()) {
    const query: Record<string, unknown> = { workspaceId };
    if (opts.artifactType) query.artifactType = opts.artifactType;
    if (opts.calibrationStatus) query.calibrationStatus = opts.calibrationStatus;
    if (opts.actionRequiredOnly) query.actionRequired = true;
    return IntelligenceValidationRecord.find(query)
      .sort({ validatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }

  return [..._memValidationRecords.values()]
    .filter((r) => {
      if (r.workspaceId !== workspaceId) return false;
      if (opts.artifactType && r.artifactType !== opts.artifactType) return false;
      if (opts.calibrationStatus && r.calibrationStatus !== opts.calibrationStatus) return false;
      if (opts.actionRequiredOnly && !r.actionRequired) return false;
      return true;
    })
    .sort((a, b) => b.validatedAt.getTime() - a.validatedAt.getTime())
    .slice(offset, offset + limit);
}

// ── VRSR — Validated Recommendation Success Rate ─────────────────────────────

export async function computeVrsr(workspaceId: string): Promise<{
  vrsr: number;
  totalImplemented: number;
  totalValidated: number;
  totalSuccessful: number;
}> {
  if (isMongoConnected()) {
    const { getEffectivenessStats } = await import("./recommendationEffectivenessService.js");
    const stats = await getEffectivenessStats({ workspaceId });
    return {
      vrsr: stats.successRate,
      totalImplemented: stats.totalApplications,
      totalValidated: stats.validated,
      totalSuccessful: stats.improved
    };
  }

  // Memory fallback: derive from validation records tagged as recommendation type
  const recs = [..._memValidationRecords.values()].filter(
    (r) => r.workspaceId === workspaceId && r.artifactType === "recommendation"
  );
  const successful = recs.filter((r) => r.accuracyScore >= 70).length;
  const vrsr = recs.length > 0 ? Math.round((successful / recs.length) * 100) : 0;
  return { vrsr, totalImplemented: recs.length, totalValidated: recs.length, totalSuccessful: successful };
}

// ── Platform-level validation accuracy stats ─────────────────────────────────

export async function getValidationAccuracyStats(workspaceId: string): Promise<{
  avgAccuracyScore: number;
  calibrationBreakdown: Record<CalibrationStatus, number>;
  actionRequiredCount: number;
  artifactTypeBreakdown: Record<string, number>;
}> {
  const statuses: CalibrationStatus[] = ["well_calibrated", "overconfident", "underconfident", "insufficient_data"];

  if (isMongoConnected()) {
    const agg = await IntelligenceValidationRecord.aggregate([
      { $match: { workspaceId } },
      {
        $group: {
          _id: null,
          avgAccuracy: { $avg: "$accuracyScore" },
          actionRequired: { $sum: { $cond: ["$actionRequired", 1, 0] } },
          well_calibrated: { $sum: { $cond: [{ $eq: ["$calibrationStatus", "well_calibrated"] }, 1, 0] } },
          overconfident: { $sum: { $cond: [{ $eq: ["$calibrationStatus", "overconfident"] }, 1, 0] } },
          underconfident: { $sum: { $cond: [{ $eq: ["$calibrationStatus", "underconfident"] }, 1, 0] } },
          insufficient_data: { $sum: { $cond: [{ $eq: ["$calibrationStatus", "insufficient_data"] }, 1, 0] } }
        }
      }
    ]);

    const typeAgg = await IntelligenceValidationRecord.aggregate([
      { $match: { workspaceId } },
      { $group: { _id: "$artifactType", count: { $sum: 1 } } }
    ]);

    const a = agg[0] ?? {};
    const calibrationBreakdown = Object.fromEntries(statuses.map((s) => [s, a[s] ?? 0])) as Record<CalibrationStatus, number>;
    const artifactTypeBreakdown = Object.fromEntries(typeAgg.map((t: { _id: string; count: number }) => [t._id, t.count]));

    return {
      avgAccuracyScore: Math.round((a.avgAccuracy ?? 0) * 10) / 10,
      calibrationBreakdown,
      actionRequiredCount: a.actionRequired ?? 0,
      artifactTypeBreakdown
    };
  }

  const records = [..._memValidationRecords.values()].filter((r) => r.workspaceId === workspaceId);
  const avgAccuracy = records.length > 0 ? records.reduce((s, r) => s + r.accuracyScore, 0) / records.length : 0;
  const calibrationBreakdown = Object.fromEntries(
    statuses.map((s) => [s, records.filter((r) => r.calibrationStatus === s).length])
  ) as Record<CalibrationStatus, number>;

  const typeMap = new Map<string, number>();
  for (const r of records) typeMap.set(r.artifactType, (typeMap.get(r.artifactType) ?? 0) + 1);

  return {
    avgAccuracyScore: Math.round(avgAccuracy * 10) / 10,
    calibrationBreakdown,
    actionRequiredCount: records.filter((r) => r.actionRequired).length,
    artifactTypeBreakdown: Object.fromEntries(typeMap)
  };
}
