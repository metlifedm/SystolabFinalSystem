import type { ReportSnapshot } from "@systolab/shared";
import { BenchmarkRecord } from "../models/BenchmarkRecord.js";
import { Snapshot } from "../models/Snapshot.js";
import { isMongoConnected } from "../db/mongoose.js";

const memorySnapshots = new Map<string, ReportSnapshot>();

export async function saveSnapshot(report: ReportSnapshot): Promise<void> {
  if (!isMongoConnected()) {
    memorySnapshots.set(report.snapshotId, report);
    return;
  }

  await Snapshot.create({
    snapshotId: report.snapshotId,
    tenantSlug: report.tenantBranding.slug,
    targetUrl: report.targetUrl,
    mode: report.mode,
    status: report.status,
    report,
    integrityHash: report.integrity.snapshotHash
  });
}

export async function findSnapshot(snapshotId: string): Promise<ReportSnapshot | null> {
  if (!isMongoConnected()) {
    return memorySnapshots.get(snapshotId) ?? null;
  }

  const snapshot = await Snapshot.findOne({ snapshotId });
  return snapshot?.report ?? null;
}

export async function findLatestSnapshotForTarget(targetUrl: string, tenantSlug: string): Promise<ReportSnapshot | null> {
  const history = await findSnapshotHistoryForTarget(targetUrl, tenantSlug, 1);
  return history[0] ?? null;
}

export async function findSnapshotHistoryForTarget(targetUrl: string, tenantSlug: string, limit = 12): Promise<ReportSnapshot[]> {
  const normalizedTarget = normalizeTargetUrl(targetUrl);
  if (!isMongoConnected()) {
    return [...memorySnapshots.values()]
      .filter((report) => report.tenantBranding.slug === tenantSlug && normalizeTargetUrl(report.targetUrl) === normalizedTarget)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  const snapshots = await Snapshot.find({
    tenantSlug,
    targetUrl: { $in: [targetUrl, normalizedTarget] }
  }).sort({ createdAt: -1 }).limit(limit);
  return snapshots.map((snapshot) => snapshot.report);
}

export async function saveBenchmarkRecord(report: ReportSnapshot): Promise<void> {
  if (!isMongoConnected() || report.status !== "completed" || report.oss.score === null) return;
  const score = report.oss.score;

  await BenchmarkRecord.create({
    snapshotId: report.snapshotId,
    tenantSlug: report.tenantBranding.slug,
    industryType: report.industryBenchmarkEngine.industryType,
    businessModel: "website_diagnostic",
    geography: "self_owned_dataset",
    dimensions: Object.fromEntries(report.dimensions.map((dimension) => [dimension.key, dimension.score])),
    oss: score
  }).catch(() => undefined);
}

function normalizeTargetUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}
