import { env } from "../config/env.js";
import { recordHistogram, incrementCounter } from "./metricsService.js";
import { getTenantBranding } from "./tenantService.js";
import { runSystolabScan } from "./truth-engine/runScan.js";
import { findSnapshotHistoryForTarget, saveBenchmarkRecord, saveSnapshot } from "./persistenceService.js";
import { persistIntelligenceArtifacts, workspaceIdFor } from "./intelligencePersistenceService.js";
import {
  completePlatformJob,
  failPlatformJob,
  getDueScanJobs,
  markJobRunning,
  persistPlatformArtifacts,
  recordUserSearchActivity,
  updateJobProgress
} from "./platformControlPlaneService.js";
import { ensureWorkspaceMembership } from "./membershipService.js";
import { checkScanPayloadQuality } from "./dataQualityService.js";
import type { ScanMode, ScanRequest } from "@systolab/shared";

let timer: NodeJS.Timeout | undefined;
let cycleRunning = false;

export interface ScanWorkerCycleResult {
  processed: number;
  completed: string[];
  deadLettered: string[];
  failures: Array<{ jobId: string; targetUrl: string; reason: string }>;
  startedAt: string;
  finishedAt: string;
}

export function startScanWorker(): void {
  if (!env.scanWorkerEnabled || timer) return;
  timer = setInterval(() => {
    void runScanWorkerCycle().catch((error) => {
      const message = error instanceof Error ? error.message : "unknown scan worker error";
      console.error(`[scan-worker] cycle failed: ${message}`);
    });
  }, env.scanWorkerIntervalMs);
  timer.unref?.();

  // Run immediately on startup for faster first pickup
  void runScanWorkerCycle().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown scan worker startup error";
    console.error(`[scan-worker] startup cycle failed: ${message}`);
  });

  console.log(`[scan-worker] started (interval=${env.scanWorkerIntervalMs}ms, batch=${env.scanWorkerBatchSize})`);
}

export function stopScanWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  console.log("[scan-worker] stopped");
}

export function isScanWorkerRunning(): boolean {
  return timer != null;
}

export async function runScanWorkerCycle(): Promise<ScanWorkerCycleResult> {
  const startedAt = new Date();
  if (cycleRunning) {
    return { processed: 0, completed: [], deadLettered: [], failures: [], startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }
  cycleRunning = true;
  const completed: string[] = [];
  const deadLettered: string[] = [];
  const failures: ScanWorkerCycleResult["failures"] = [];

  try {
    const now = new Date();
    const jobs = await getDueScanJobs(now, env.scanWorkerBatchSize, env.scanWorkerLockTimeoutMs);

    for (const job of jobs) {
      const targetUrl = typeof job.payload.targetUrl === "string" ? job.payload.targetUrl : "unknown";
      let jobId = job.jobId;

      try {
        // Atomically claim the job
        const claimed = await markJobRunning(jobId);
        if (!claimed) continue; // another worker claimed it first

        jobId = claimed.jobId;
        await updateJobProgress(jobId, 5);

        const t0 = Date.now();
        const result = await executeOneScanJob(claimed);
        const scanDurationMs = Date.now() - t0;
        recordHistogram("systolab_scan_duration_ms", scanDurationMs);
        incrementCounter("systolab_scan_jobs_total", { outcome: "completed" });
        await completePlatformJob(jobId, result);
        completed.push(jobId);
      } catch (error) {
        await failPlatformJob(jobId, error);
        const message = error instanceof Error ? error.message : "Unknown scan failure";
        failures.push({ jobId, targetUrl, reason: message });

        // Check if it went to dead letter
        try {
          const updated = await getDueScanJobs(new Date(0), 1, 0); // won't match
          // We can't easily check here without another lookup; use the failure count
          void updated; // unused — dead letter is already handled in failPlatformJob
        } catch { /* ignore */ }

        incrementCounter("systolab_scan_jobs_total", { outcome: "failed" });
        console.error(`[scan-worker] job ${jobId} failed (${targetUrl}): ${message}`);
      }
    }
  } finally {
    cycleRunning = false;
  }

  return {
    processed: completed.length + failures.length,
    completed,
    deadLettered,
    failures,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString()
  };
}

async function executeOneScanJob(job: Awaited<ReturnType<typeof markJobRunning>>): Promise<Record<string, unknown>> {
  if (!job) throw new Error("Job claim returned null.");
  const { jobId, payload } = job;

  const targetUrl = String(payload.targetUrl ?? "");
  const tenantSlug = typeof payload.tenantSlug === "string" ? payload.tenantSlug : undefined;
  const mode: ScanMode = payload.mode === "full_audit" ? "full_audit" : "fast_scan";
  const competitorUrls = Array.isArray(payload.competitorUrls)
    ? (payload.competitorUrls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 5)
    : [];

  const scanRequest: ScanRequest = {
    targetUrl,
    mode,
    includeSeo: Boolean(payload.includeSeo),
    gbpUrl: typeof payload.gbpUrl === "string" && payload.gbpUrl ? payload.gbpUrl : undefined,
    competitorUrls,
    monthlyLeadVolume: typeof payload.monthlyLeadVolume === "number" ? payload.monthlyLeadVolume : undefined,
    industryType: typeof payload.industryType === "string" && payload.industryType ? payload.industryType : undefined,
    tenantSlug
  };

  // Progress: 10% — fetching branding + scan history
  await updateJobProgress(jobId, 10);
  const tenantBranding = await getTenantBranding(tenantSlug);
  const snapshotHistory = await findSnapshotHistoryForTarget(targetUrl, tenantBranding.slug, 12);
  const previousSnapshot = snapshotHistory[0] ?? null;

  // Progress: 20% — scan starting
  await updateJobProgress(jobId, 20);
  const report = await runSystolabScan(scanRequest, tenantBranding, previousSnapshot, snapshotHistory);

  // Progress: 70% — scan complete, persisting
  await updateJobProgress(jobId, 70);

  // Quality gate: always runs for quarantine/audit side-effects; critical failures block persistence.
  await checkScanPayloadQuality(report, { jobId, tenantSlug: tenantBranding.slug }).catch(() => undefined);

  const snapshotIdOk = typeof report.snapshotId === "string" && report.snapshotId.length > 0;
  const score = report.oss?.score;
  const ossOk =
    (typeof score === "number" && score >= 0 && score <= 100) ||
    (score === null && report.oss?.scoringStatus === "not_scored" && report.status === "content_unavailable");

  if (!snapshotIdOk) {
    throw new Error("Scan output critical failure: snapshotId is missing. Snapshot not persisted.");
  }
  if (!ossOk) {
    throw new Error(`Scan output critical failure: OSS score is invalid (${score}). Snapshot not persisted.`);
  }

  await saveSnapshot(report);
  await saveBenchmarkRecord(report);

  // Progress: 80% — intelligence artifacts
  await updateJobProgress(jobId, 80);
  await persistIntelligenceArtifacts(report);

  // Progress: 90% — platform artifacts
  await updateJobProgress(jobId, 90);
  const workspaceId = workspaceIdFor(tenantBranding.slug, report.targetUrl);
  await persistPlatformArtifacts(report, workspaceId);

  await recordUserSearchActivity({
    report,
    workspaceId,
    scanRequest: payload,
    user: typeof payload.userId === "string" ? { userId: payload.userId } : undefined,
    session: undefined
  });

  // Upsert workspace membership if we have a userId and a real tenant
  if (typeof payload.userId === "string" && tenantBranding.tenantId && tenantBranding.tenantId !== "default") {
    ensureWorkspaceMembership(payload.userId, workspaceId, tenantBranding.tenantId, tenantBranding.slug, "owner").catch(() => {});
  }

  // Progress: 95% — wrapping up (completePlatformJob will set 100)
  await updateJobProgress(jobId, 95);

  return { snapshotId: report.snapshotId, oss: score, targetUrl: report.targetUrl, tenantSlug: tenantBranding.slug };
}
