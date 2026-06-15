import { env } from "../config/env.js";
import { processDeliveries } from "./eventBusService.js";
import { logger } from "../utils/logger.js";

let timer: NodeJS.Timeout | undefined;
let cycleRunning = false;

export function startEventReplayWorker(): void {
  if (!env.eventBusWorkerEnabled || timer) return;

  timer = setInterval(() => {
    if (cycleRunning) return;
    cycleRunning = true;
    processDeliveries(env.eventBusWorkerBatchSize)
      .then((result) => {
        if (result.processed > 0) {
          logger.debug("event_replay_worker.cycle", result as unknown as Record<string, unknown>);
        }
        if (result.deadLettered > 0) {
          logger.warn("event_replay_worker.dead_letters", { count: result.deadLettered });
        }
      })
      .catch((err) => {
        logger.error("event_replay_worker.error", {
          message: err instanceof Error ? err.message : String(err)
        });
      })
      .finally(() => {
        cycleRunning = false;
      });
  }, env.eventBusWorkerIntervalMs);

  timer.unref?.();
  logger.info("event_replay_worker.started", {
    interval: env.eventBusWorkerIntervalMs,
    batch: env.eventBusWorkerBatchSize
  });
}

export function stopEventReplayWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  logger.info("event_replay_worker.stopped");
}

export function isEventReplayWorkerRunning(): boolean {
  return timer != null;
}
