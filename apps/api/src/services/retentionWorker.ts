import { env } from "../config/env.js";
import { runRetentionJob } from "./retentionService.js";
import { logger } from "../utils/logger.js";

let timer: NodeJS.Timeout | undefined;
let cycleRunning = false;

export function startRetentionWorker(): void {
  if (!env.retentionWorkerEnabled || timer) return;

  timer = setInterval(() => {
    if (cycleRunning) return;
    cycleRunning = true;
    runRetentionJob()
      .then((result) => {
        if (result.recordsPurged > 0 || result.recordsArchived > 0) {
          logger.info("retention_worker.cycle", {
            policiesApplied: result.policiesApplied,
            recordsPurged: result.recordsPurged,
            recordsArchived: result.recordsArchived,
            recordsSkipped: result.recordsSkipped
          });
        }
        if (result.errors.length > 0) {
          logger.warn("retention_worker.errors", { errors: result.errors });
        }
      })
      .catch((err) => {
        logger.error("retention_worker.error", { message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        cycleRunning = false;
      });
  }, env.retentionWorkerIntervalMs);

  timer.unref?.();
  logger.info("retention_worker.started", { interval: env.retentionWorkerIntervalMs });
}

export function stopRetentionWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  logger.info("retention_worker.stopped");
}

export function isRetentionWorkerRunning(): boolean {
  return timer != null;
}
