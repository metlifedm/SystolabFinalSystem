import { logger } from "../utils/logger.js";
import { expireOldSessions, getSessionsReadyForJourneyReconstruction } from "./vilSessionService.js";
import { reconstructJourney } from "./vilJourneyService.js";
import { runEvidenceGeneration } from "./vilEvidenceService.js";
import { checkVilSlas, recordEvidenceSweepMs, recordJourneyReconstructionMs, recordSessionExpiryRun, recordWorkerHeartbeat } from "./vilSlaService.js";
import { listSessionsForWorkspace } from "./vilSessionService.js";
import { VisitorSession } from "../models/VisitorSession.js";
import { isMongoConnected } from "../db/mongoose.js";
import { _memVisitorSessions } from "./vilSessionService.js";

const HEARTBEAT_INTERVAL_MS = 60_000;        // 1 minute — journey reconstruction + heartbeat
const SESSION_EXPIRY_INTERVAL_MS = 30 * 60_000; // 30 minutes
const EVIDENCE_SWEEP_INTERVAL_MS = 5 * 60_000;  // 5 minutes
const SLA_CHECK_INTERVAL_MS = 5 * 60_000;       // 5 minutes

let _started = false;
let journeyRunning = false;
let sweepRunning = false;

export function startVilWorker(): void {
  if (_started) return;
  _started = true;

  // ── Heartbeat + Journey reconstruction (every 60s) ──────────────────────────
  const heartbeatTimer = setInterval(async () => {
    recordWorkerHeartbeat();
    if (journeyRunning) return;
    journeyRunning = true;
    try {
      await runJourneyReconstruction();
    } finally {
      journeyRunning = false;
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  // ── Session expiry (every 30 min) ────────────────────────────────────────────
  const expiryTimer = setInterval(async () => {
    try {
      const expired = await expireOldSessions();
      recordSessionExpiryRun(expired);
      if (expired > 0) {
        logger.info("vil.worker.session_expiry", { expired });
      }
    } catch (err) {
      logger.error("vil.worker.session_expiry.error", {
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, SESSION_EXPIRY_INTERVAL_MS);
  expiryTimer.unref();

  // ── Evidence generation sweep (every 5 min) ──────────────────────────────────
  const evidenceTimer = setInterval(async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      await runEvidenceSweep();
    } finally {
      sweepRunning = false;
    }
  }, EVIDENCE_SWEEP_INTERVAL_MS);
  evidenceTimer.unref();

  // ── SLA monitoring (every 5 min) ─────────────────────────────────────────────
  const slaTimer = setInterval(async () => {
    try {
      await checkVilSlas();
    } catch (err) {
      logger.error("vil.worker.sla_check.error", {
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, SLA_CHECK_INTERVAL_MS);
  slaTimer.unref();

  // Fire immediately on startup
  recordWorkerHeartbeat();
  logger.info("vil.worker.started", {
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    sessionExpiryIntervalMs: SESSION_EXPIRY_INTERVAL_MS,
    evidenceSweepIntervalMs: EVIDENCE_SWEEP_INTERVAL_MS
  });
}

// ─── Journey Reconstruction ────────────────────────────────────────────────────

async function runJourneyReconstruction(): Promise<void> {
  try {
    const sessionIds = await getSessionsReadyForJourneyReconstruction();
    if (sessionIds.length === 0) return;

    const t0 = Date.now();
    let reconstructed = 0;

    for (const sessionId of sessionIds) {
      try {
        await reconstructJourney(sessionId);
        reconstructed++;
      } catch (err) {
        logger.warn("vil.worker.journey_reconstruction.skip", {
          sessionId,
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    }

    const elapsedMs = Date.now() - t0;
    recordJourneyReconstructionMs(elapsedMs);

    if (reconstructed > 0) {
      logger.info("vil.worker.journey_reconstruction.done", { reconstructed, elapsedMs });
    }
  } catch (err) {
    logger.error("vil.worker.journey_reconstruction.error", {
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

// ─── Evidence Generation Sweep ─────────────────────────────────────────────────

async function runEvidenceSweep(): Promise<void> {
  try {
    const t0 = Date.now();
    const workspaces = await getActiveWorkspaceList();
    let totalGenerated = 0;

    for (const ws of workspaces) {
      try {
        const result = await runEvidenceGeneration(ws.workspaceId, ws.tenantSlug);
        totalGenerated += result.generated;
      } catch (err) {
        logger.warn("vil.worker.evidence_sweep.workspace_error", {
          workspaceId: ws.workspaceId,
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    }

    const elapsedMs = Date.now() - t0;
    recordEvidenceSweepMs(elapsedMs);

    if (totalGenerated > 0) {
      logger.info("vil.worker.evidence_sweep.done", {
        workspaces: workspaces.length,
        totalGenerated,
        elapsedMs
      });
    }
  } catch (err) {
    logger.error("vil.worker.evidence_sweep.error", {
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

// ─── Active workspace discovery ────────────────────────────────────────────────

interface WorkspaceRef {
  workspaceId: string;
  tenantSlug: string;
}

async function getActiveWorkspaceList(): Promise<WorkspaceRef[]> {
  if (!isMongoConnected()) {
    const seen = new Map<string, WorkspaceRef>();
    for (const s of _memVisitorSessions.values()) {
      if (!seen.has(s.workspaceId)) {
        seen.set(s.workspaceId, { workspaceId: s.workspaceId, tenantSlug: s.tenantSlug });
      }
    }
    return [...seen.values()];
  }

  // Find distinct workspaces that had sessions in the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pipeline = [
    { $match: { startedAt: { $gte: since } } },
    { $group: { _id: "$workspaceId", tenantSlug: { $first: "$tenantSlug" } } },
    { $limit: 100 }
  ];
  const results = await VisitorSession.aggregate(pipeline);
  return results.map((r: { _id: string; tenantSlug: string }) => ({
    workspaceId: r._id,
    tenantSlug: r.tenantSlug
  }));
}
