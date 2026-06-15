import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { runBackup, verifyBackup } from "./backupService.js";
import { triggerAlert, resolveAlertByKey } from "./alertService.js";

let workerTimer: ReturnType<typeof setInterval> | null = null;
let cycleRunning = false;

export function startBackupWorker(): void {
  if (!env.backupWorkerEnabled) return;
  if (workerTimer) return;

  workerTimer = setInterval(async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      const result = await runBackup({ trigger: "scheduled" });
      logger.info("backup_worker.backup_complete", { backupId: result.backupId, sizeBytes: result.sizeBytes });

      if (env.backupWorkerAutoVerify) {
        const verification = await verifyBackup(result.backupId);
        if (verification.verificationStatus !== "pass") {
          logger.warn("backup_worker.verification_failed", { backupId: result.backupId, errorMessage: verification.errorMessage });
          await triggerAlert({
            key: "backup_worker_verification_failure",
            severity: "critical",
            category: "backup",
            title: "Backup verification failed",
            message: `Backup ${result.backupId} failed verification: ${verification.errorMessage ?? "unknown"}`
          });
        } else {
          logger.info("backup_worker.verification_passed", { backupId: result.backupId });
          await resolveAlertByKey("backup_worker_verification_failure");
        }
      }

      await resolveAlertByKey("backup_worker_failure");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("backup_worker.error", { message });
      await triggerAlert({
        key: "backup_worker_failure",
        severity: "critical",
        category: "backup",
        title: "Scheduled backup failed",
        message
      });
    } finally {
      cycleRunning = false;
    }
  }, env.backupWorkerIntervalMs);

  workerTimer.unref();
  logger.info("backup_worker.started", { intervalMs: env.backupWorkerIntervalMs, autoVerify: env.backupWorkerAutoVerify });
}

export function stopBackupWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
