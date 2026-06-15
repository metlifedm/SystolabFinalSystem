import { env } from "../config/env.js";
import { runDueInternalReportSchedules } from "./iireService.js";

let timer: NodeJS.Timeout | undefined;
let running = false;

export function startIireWorker(): void {
  if (!env.iireWorkerEnabled || timer) return;
  timer = setInterval(() => {
    void runIireWorkerCycle().catch((error) => {
      const message = error instanceof Error ? error.message : "unknown IIRE worker error";
      console.error(`SYSTOLAB IIRE worker failed: ${message}`);
    });
  }, env.iireWorkerIntervalMs);
  timer.unref?.();
}

export function stopIireWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

export async function runIireWorkerCycle(): Promise<{ processed: number; reportIds: string[]; failures: Array<{ scheduleId: string; reason: string }> }> {
  if (running) {
    return {
      processed: 0,
      reportIds: [],
      failures: [{ scheduleId: "iire-worker", reason: "IIRE worker cycle already running." }]
    };
  }
  running = true;
  try {
    return await runDueInternalReportSchedules();
  } finally {
    running = false;
  }
}
