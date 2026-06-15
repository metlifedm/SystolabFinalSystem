import type { ReportSnapshot } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";
import { BenchmarkRecord } from "../models/BenchmarkRecord.js";
import { OperationalControlRecord } from "../models/OperationalControlRecord.js";
import { makeId, stableStringify } from "../utils/crypto.js";
import { quarantinePayload } from "./quarantineService.js";
import { logger } from "../utils/logger.js";

export interface QualityCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface QualityGateResult {
  passed: boolean;
  score: number;
  checks: QualityCheck[];
  quarantineId?: string;
}

export interface DataQualitySummary {
  totalChecks: number;
  passing: number;
  failing: number;
  recentGateResults: Array<{ scope: string; passed: boolean; score: number; createdAt: Date }>;
}

const REQUIRED_DIMENSIONS = [
  "trust",
  "accessibility",
  "renderingQuality",
  "stability",
  "mobileExperience",
  "websiteHealth",
  "visibilityStructure",
  "conversionReadiness",
  "informationClarity"
] as const;

export async function checkScanPayloadQuality(
  report: ReportSnapshot,
  context?: { jobId?: string; tenantSlug?: string }
): Promise<QualityGateResult> {
  const checks: QualityCheck[] = [];
  let score = 100;

  // OSS score range
  const oss = report.oss?.score;
  const contentUnavailable = report.status === "content_unavailable" && report.oss?.scoringStatus === "not_scored" && oss === null;
  const ossValid = contentUnavailable || (typeof oss === "number" && oss >= 0 && oss <= 100);
  checks.push({ name: "oss_score_range", passed: ossValid, message: ossValid ? undefined : `OSS score ${oss} is out of range [0,100]` });
  if (!ossValid) score -= 25;

  // Required fields present
  const hasTargetUrl = typeof report.targetUrl === "string" && report.targetUrl.length > 0;
  checks.push({ name: "target_url_present", passed: hasTargetUrl, message: hasTargetUrl ? undefined : "targetUrl is missing" });
  if (!hasTargetUrl) score -= 15;

  const hasSnapshotId = typeof report.snapshotId === "string" && report.snapshotId.length > 0;
  checks.push({ name: "snapshot_id_present", passed: hasSnapshotId, message: hasSnapshotId ? undefined : "snapshotId is missing" });
  if (!hasSnapshotId) score -= 10;

  // Dimension scores populated (report.dimensions is DimensionScore[])
  const dimKeys = (report.dimensions ?? []).map((d) => d.key);
  const missingDims = REQUIRED_DIMENSIONS.filter((d) => !dimKeys.includes(d));
  const dimsOk = contentUnavailable || missingDims.length === 0;
  checks.push({
    name: "dimension_scores_populated",
    passed: dimsOk,
    message: dimsOk ? undefined : `Missing dimension scores: ${missingDims.join(", ")}`
  });
  if (!dimsOk) score -= Math.min(25, missingDims.length * 5);

  // Evidence objects not empty
  const evidenceCount = Array.isArray(report.evidenceObjects) ? report.evidenceObjects.length : 0;
  const hasEvidence = evidenceCount > 0;
  checks.push({ name: "evidence_objects_present", passed: hasEvidence, message: hasEvidence ? undefined : "evidenceObjects array is empty" });
  if (!hasEvidence) score -= 15;

  // Target URL is a plausible URL
  let urlOk = false;
  try {
    if (hasTargetUrl) new URL(report.targetUrl);
    urlOk = hasTargetUrl;
  } catch { /* invalid URL */ }
  checks.push({ name: "target_url_valid", passed: urlOk, message: urlOk ? undefined : `targetUrl "${report.targetUrl}" is not a valid URL` });
  if (!urlOk) score -= 10;

  score = Math.max(0, score);
  const passed = score >= 60 && ossValid && hasSnapshotId;

  let quarantineId: string | undefined;
  if (!passed) {
    const failedChecks = checks.filter((c) => !c.passed).map((c) => c.message).join("; ");
    try {
      const q = await quarantinePayload({
        quarantineType: "quality_gate_failure",
        sourceRoute: "scan_worker",
        sourceModel: "Snapshot",
        payload: {
          snapshotId: report.snapshotId,
          targetUrl: report.targetUrl,
          oss,
          jobId: context?.jobId,
          tenantSlug: context?.tenantSlug,
          checksummary: stableStringify(checks)
        },
        reason: `Scan quality gate failed (score ${score}): ${failedChecks}`
      });
      quarantineId = q.quarantineId;
    } catch (err) {
      logger.warn("data_quality.quarantine_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Persist as OperationalControlRecord for dashboard visibility
  if (isMongoConnected()) {
    await OperationalControlRecord.create({
      recordId: makeId("dq"),
      controlType: "data_quality",
      status: passed ? "passing" : "failing",
      scope: context?.tenantSlug ?? "global",
      score,
      payload: {
        source: "scan_worker",
        snapshotId: report.snapshotId,
        targetUrl: report.targetUrl,
        ossScore: oss,
        checks: checks.map((c) => ({ name: c.name, passed: c.passed })),
        quarantineId: quarantineId ?? null
      }
    }).catch(() => undefined);
  }

  return { passed, score, checks, quarantineId };
}

export async function checkBenchmarkQuality(record: {
  snapshotId: string;
  tenantSlug: string;
  dimensions: Partial<Record<string, number>>;
  oss: number;
}): Promise<QualityGateResult> {
  const checks: QualityCheck[] = [];
  let score = 100;

  const ossOk = typeof record.oss === "number" && record.oss >= 0 && record.oss <= 100;
  checks.push({ name: "oss_range", passed: ossOk, message: ossOk ? undefined : `OSS ${record.oss} out of [0,100]` });
  if (!ossOk) score -= 30;

  const hasSlug = typeof record.tenantSlug === "string" && record.tenantSlug.length > 0;
  checks.push({ name: "tenant_slug_present", passed: hasSlug, message: hasSlug ? undefined : "tenantSlug missing" });
  if (!hasSlug) score -= 20;

  const dimValues = Object.values(record.dimensions).filter((v) => v !== undefined);
  const allDimsInRange = dimValues.every((v) => typeof v === "number" && v >= 0 && v <= 100);
  checks.push({ name: "dimension_values_in_range", passed: allDimsInRange, message: allDimsInRange ? undefined : "One or more dimension values outside [0,100]" });
  if (!allDimsInRange) score -= 20;

  const hasDims = dimValues.length > 0;
  checks.push({ name: "dimensions_not_empty", passed: hasDims, message: hasDims ? undefined : "dimensions object is empty" });
  if (!hasDims) score -= 30;

  score = Math.max(0, score);
  const passed = score >= 60;

  let quarantineId: string | undefined;
  if (!passed) {
    const failedChecks = checks.filter((c) => !c.passed).map((c) => c.message).join("; ");
    const q = await quarantinePayload({
      quarantineType: "quality_gate_failure",
      sourceRoute: "benchmark_pipeline",
      sourceModel: "BenchmarkRecord",
      payload: { snapshotId: record.snapshotId, tenantSlug: record.tenantSlug, oss: record.oss },
      reason: `Benchmark quality gate failed (score ${score}): ${failedChecks}`
    }).catch(() => undefined);
    quarantineId = q?.quarantineId;
  }

  return { passed, score, checks, quarantineId };
}

export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  if (!isMongoConnected()) {
    return { totalChecks: 0, passing: 0, failing: 0, recentGateResults: [] };
  }

  const [total, passing, failing, recent] = await Promise.all([
    OperationalControlRecord.countDocuments({ controlType: "data_quality" }),
    OperationalControlRecord.countDocuments({ controlType: "data_quality", status: "passing" }),
    OperationalControlRecord.countDocuments({ controlType: "data_quality", status: "failing" }),
    OperationalControlRecord.find({ controlType: "data_quality" }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  return {
    totalChecks: total,
    passing,
    failing,
    recentGateResults: recent.map((r) => ({
      scope: r.scope,
      passed: r.status === "passing",
      score: r.score ?? 0,
      createdAt: r.createdAt
    }))
  };
}

export async function runBenchmarkDataQualityAudit(limit = 100): Promise<{
  audited: number;
  passed: number;
  failed: number;
  quarantined: number;
}> {
  if (!isMongoConnected()) return { audited: 0, passed: 0, failed: 0, quarantined: 0 };

  const records = await BenchmarkRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  let passed = 0;
  let failed = 0;
  let quarantined = 0;

  for (const rec of records) {
    const result = await checkBenchmarkQuality({
      snapshotId: rec.snapshotId,
      tenantSlug: rec.tenantSlug,
      dimensions: rec.dimensions as Record<string, number>,
      oss: rec.oss
    });
    if (result.passed) {
      passed++;
    } else {
      failed++;
      if (result.quarantineId) quarantined++;
    }
  }

  return { audited: records.length, passed, failed, quarantined };
}
