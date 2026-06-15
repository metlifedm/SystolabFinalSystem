import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { retryPendingDeliveries } from "./webhookDeliveryService.js";

let workerTimer: ReturnType<typeof setInterval> | null = null;
let cycleRunning = false;

export function startWebhookWorker(): void {
  if (!env.webhookWorkerEnabled) return;
  if (workerTimer) return;

  workerTimer = setInterval(async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      const count = await retryPendingDeliveries(env.webhookWorkerBatchSize);
      if (count > 0) {
        logger.info("webhook_worker.tick", { processed: count });
      }
    } catch (err) {
      logger.warn("webhook_worker.error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      cycleRunning = false;
    }
  }, env.webhookWorkerIntervalMs);

  workerTimer.unref();
  logger.info("webhook_worker.started", { intervalMs: env.webhookWorkerIntervalMs });
}

export function stopWebhookWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
