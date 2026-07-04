import type { Request, Response } from "express";
import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authOptional } from "../middleware/authOptional.js";
import { authRequired } from "../middleware/authRequired.js";
import { scanRateLimit, scanStatusRateLimit } from "../middleware/rateLimits.js";
import { getPlatformJob, getScanQueueMetrics, listScanJobs } from "../services/platformControlPlaneService.js";
import { isScanWorkerRunning } from "../services/scanWorker.js";
import { createScan } from "./scanController.js";

export const scansRouter = Router();

scansRouter.use(authOptional);

// POST / - enqueue scan (async, returns 202 + jobId)
scansRouter.post("/", scanRateLimit, authRequired, asyncHandler(createScan));

// GET /queue/metrics - queue depth and worker health
scansRouter.get("/queue/metrics", scanStatusRateLimit, asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await getScanQueueMetrics();
  res.json({ ...metrics, workerRunning: isScanWorkerRunning(), polledAt: new Date().toISOString() });
}));

// GET /queue/jobs - recent scan jobs list
scansRouter.get("/queue/jobs", scanStatusRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const rawLimit = Number(req.query["limit"] ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 200) : 50;
  const jobs = await listScanJobs(limit);
  res.json({ items: jobs });
}));

// GET /:jobId - job status, progress, result
scansRouter.get("/:jobId", scanStatusRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const jobId = req.params["jobId"];
  if (!jobId) {
    res.status(400).json({ error: { message: "jobId is required." } });
    return;
  }
  const job = await getPlatformJob(jobId);
  if (!job) {
    res.status(404).json({ error: { message: "Scan job not found." } });
    return;
  }

  const response: Record<string, unknown> = {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    targetUrl: typeof job.payload.targetUrl === "string" ? job.payload.targetUrl : null,
    mode: typeof job.payload.mode === "string" ? job.payload.mode : null,
    tenantSlug: typeof job.payload.tenantSlug === "string" ? job.payload.tenantSlug : null,
    queue: job.queue,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    scheduledFor: job.scheduledFor,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    failedAt: job.failedAt ?? null,
    errorMessage: job.errorMessage ?? null,
    result: job.result ?? null,
    createdAt: job.createdAt ?? null
  };

  if (job.status === "completed" && job.result?.snapshotId) {
    response["reportUrl"] = `/reports/${job.result.snapshotId}`;
  }

  res.json(response);
}));
