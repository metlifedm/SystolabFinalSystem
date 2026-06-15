import { env } from "../config/env.js";
import { getTenantBranding } from "./tenantService.js";
import { runSystolabScan } from "./truth-engine/runScan.js";
import { findSnapshotHistoryForTarget, saveBenchmarkRecord, saveSnapshot } from "./persistenceService.js";
import { persistIntelligenceArtifacts } from "./intelligencePersistenceService.js";
import { findDueMonitoringSchedules, markMonitoringScheduleRun } from "./monitoringService.js";

let timer: NodeJS.Timeout | undefined;
let running = false;

export interface MonitoringCycleResult {
  processed: number;
  failures: Array<{ scheduleId: string; targetUrl: string; reason: string }>;
  startedAt: string;
  finishedAt: string;
}

export function startMonitoringWorker(): void {
  if (!env.monitoringWorkerEnabled || timer) return;
  timer = setInterval(() => {
    void runMonitoringCycle().catch((error) => {
      const message = error instanceof Error ? error.message : "unknown monitoring worker error";
      console.error(`SYSTOLAB monitoring worker failed: ${message}`);
    });
  }, env.monitoringWorkerIntervalMs);
  timer.unref?.();

  void runMonitoringCycle().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown monitoring worker startup error";
    console.error(`SYSTOLAB monitoring startup cycle failed: ${message}`);
  });
}

export function stopMonitoringWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

export async function runMonitoringCycle(): Promise<MonitoringCycleResult> {
  const startedAt = new Date();
  if (running) {
    return {
      processed: 0,
      failures: [{ scheduleId: "worker", targetUrl: "all", reason: "Monitoring cycle already running." }],
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString()
    };
  }

  running = true;
  const failures: MonitoringCycleResult["failures"] = [];
  let processed = 0;
  try {
    const dueSchedules = await findDueMonitoringSchedules(startedAt, env.monitoringWorkerBatchSize);
    for (const schedule of dueSchedules) {
      try {
        const tenantBranding = await getTenantBranding(schedule.tenantSlug);
        const snapshotHistory = await findSnapshotHistoryForTarget(schedule.targetUrl, tenantBranding.slug, 12);
        const previousSnapshot = snapshotHistory[0] ?? null;
        const report = await runSystolabScan(
          {
            targetUrl: schedule.targetUrl,
            mode: "full_audit",
            includeSeo: false,
            competitorUrls: schedule.competitorUrls,
            tenantSlug: schedule.tenantSlug
          },
          tenantBranding,
          previousSnapshot,
          snapshotHistory
        );

        await saveSnapshot(report);
        await saveBenchmarkRecord(report);
        await persistIntelligenceArtifacts(report);
        await markMonitoringScheduleRun(schedule, new Date(report.createdAt));
        processed += 1;
      } catch (error) {
        failures.push({
          scheduleId: schedule.scheduleId,
          targetUrl: schedule.targetUrl,
          reason: error instanceof Error ? error.message : "Unknown monitoring scan failure"
        });
        await markMonitoringScheduleRun(schedule, new Date());
      }
    }
  } finally {
    running = false;
  }

  return {
    processed,
    failures,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString()
  };
}
