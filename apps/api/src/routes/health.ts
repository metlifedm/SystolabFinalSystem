import { Router } from "express";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import { SYSTOLAB_VERSION } from "@systolab/shared";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { getCrawlerHealthSummary } from "../services/crawlerHealthService.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "systolab-api",
    version: SYSTOLAB_VERSION,
    environment: env.deploymentEnvironment,
    mongo: mongoose.connection.readyState === 1 || isMongoConnected() ? "connected" : "disconnected",
    persistence: isMongoConnected() ? "mongodb" : env.memoryStore ? "memory-dev" : "unavailable"
  });
});

// Detailed health check — probes real dependencies and reports component status.
// Returns 200 if all required deps are healthy, 503 if any are degraded.
healthRouter.get("/detailed", async (_req, res) => {
  const checks: Array<{
    name: string;
    status: "healthy" | "degraded" | "unavailable";
    latencyMs?: number;
    detail?: string;
  }> = [];

  // ── MongoDB probe ──────────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      if (isMongoConnected() && mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        checks.push({ name: "mongodb", status: "healthy", latencyMs: Date.now() - t0 });
      } else if (env.memoryStore) {
        checks.push({ name: "mongodb", status: "degraded", detail: "using in-memory store (development)" });
      } else {
        checks.push({ name: "mongodb", status: "unavailable", detail: "not connected" });
      }
    } catch (err) {
      checks.push({ name: "mongodb", status: "unavailable", latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : "ping failed" });
    }
  }

  // ── Artifact storage probe ─────────────────────────────────────────────────
  if (env.artifactDir) {
    try {
      await fs.access(env.artifactDir, fs.constants.W_OK);
      checks.push({ name: "artifact_storage", status: "healthy", detail: env.artifactDir });
    } catch {
      checks.push({ name: "artifact_storage", status: "degraded", detail: `${env.artifactDir} not writable` });
    }
  } else {
    checks.push({ name: "artifact_storage", status: "healthy", detail: "mongodb base64 mode" });
  }

  // ── Backup storage probe ───────────────────────────────────────────────────
  {
    try {
      await fs.access(env.backupDir, fs.constants.W_OK);
      checks.push({ name: "backup_storage", status: "healthy", detail: env.backupDir });
    } catch {
      checks.push({ name: "backup_storage", status: "degraded", detail: `${env.backupDir} not writable or does not exist` });
    }
  }

  // ── Memory probe ───────────────────────────────────────────────────────────
  {
    const mem = process.memoryUsage();
    const heapPercent = mem.heapUsed / mem.heapTotal;
    checks.push({
      name: "memory",
      status: heapPercent > 0.95 ? "degraded" : "healthy",
      detail: `heap ${Math.round(heapPercent * 100)}% — ${Math.round(mem.heapUsed / 1_048_576)}MB / ${Math.round(mem.heapTotal / 1_048_576)}MB`
    });
  }

  // ── Workers probe (configuration-level) ───────────────────────────────────
  checks.push({ name: "scan_worker", status: "healthy", detail: env.scanWorkerEnabled ? "enabled" : "disabled" });
  checks.push({ name: "monitoring_worker", status: "healthy", detail: env.monitoringWorkerEnabled ? "enabled" : "disabled" });
  checks.push({ name: "iire_worker", status: "healthy", detail: env.iireWorkerEnabled ? "enabled" : "disabled" });

  const hasUnavailable = checks.some((c) => c.status === "unavailable");
  const hasDegraded = checks.some((c) => c.status === "degraded");
  const overallStatus = hasUnavailable ? "unhealthy" : hasDegraded ? "degraded" : "ok";

  res.status(hasUnavailable ? 503 : 200).json({
    status: overallStatus,
    service: "systolab-api",
    version: SYSTOLAB_VERSION,
    environment: env.deploymentEnvironment,
    uptimeSeconds: Math.round(process.uptime()),
    checks,
    checkedAt: new Date().toISOString()
  });
});

// Crawler health — rolling window of recent fetch outcomes
healthRouter.get("/crawler", (_req, res) => {
  const summary = getCrawlerHealthSummary();
  res.status(summary.status === "unhealthy" ? 503 : 200).json(summary);
});
