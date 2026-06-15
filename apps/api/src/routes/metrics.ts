import { Router } from "express";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { getAlertSummary } from "../services/alertService.js";
import { renderPrometheusText, setGauge } from "../services/metricsService.js";
import { getScanQueueMetrics } from "../services/platformControlPlaneService.js";

export const metricsRouter = Router();

metricsRouter.get("/", async (req, res) => {
  // Optional bearer key protection
  if (env.metricsAuthKey) {
    const provided =
      (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined) ??
      (typeof req.query.key === "string" ? req.query.key : undefined);
    if (provided !== env.metricsAuthKey) {
      res.status(401).json({ error: { message: "Invalid metrics access key." } });
      return;
    }
  }

  // Refresh live gauges before rendering
  setGauge("systolab_uptime_seconds", Math.floor(process.uptime()));
  const mem = process.memoryUsage();
  setGauge("systolab_memory_heap_used_bytes", mem.heapUsed);
  setGauge("systolab_memory_heap_total_bytes", mem.heapTotal);
  setGauge("systolab_memory_rss_bytes", mem.rss);
  setGauge("systolab_mongo_connected", isMongoConnected() ? 1 : 0);

  try {
    const qm = await getScanQueueMetrics();
    setGauge("systolab_scan_queue_queued", qm.queued);
    setGauge("systolab_scan_queue_running", qm.running);
    setGauge("systolab_scan_queue_failed", qm.failed);
    setGauge("systolab_scan_queue_dead_letter", qm.deadLetter);
    if (qm.avgProcessingTimeMs !== null) setGauge("systolab_scan_avg_processing_ms", qm.avgProcessingTimeMs);
  } catch {
    // Non-fatal — metrics render without queue data
  }

  try {
    const alerts = await getAlertSummary();
    setGauge("systolab_alerts_open", alerts.open);
    setGauge("systolab_alerts_critical", alerts.critical);
    setGauge("systolab_alerts_warning", alerts.warning);
  } catch {
    // Non-fatal
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusText());
});
