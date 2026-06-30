import { Router } from "express";
import { isMongoConnected } from "../db/mongoose.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authOptional } from "../middleware/authOptional.js";
import { authRequired } from "../middleware/authRequired.js";
import { AlertRecord } from "../models/AlertRecord.js";
import { EditEvent } from "../models/EditEvent.js";
import { EvidenceRecord } from "../models/EvidenceRecord.js";
import { OutcomeValidationRecord } from "../models/OutcomeValidationRecord.js";
import {
  getMemoryAlertRecords,
  getMemoryEvidenceRecords,
  getMemoryOutcomeRecords,
} from "../services/intelligencePersistenceService.js";
import { publishIntelligenceEvent } from "../services/intelligenceEventBus.js";
import { listUserWorkspaces } from "../services/membershipService.js";
import { listMonitoringSchedules, upsertMonitoringSchedule } from "../services/monitoringService.js";
import { runMonitoringCycle } from "../services/monitoringWorker.js";
import { listNotificationOutbox } from "../services/notificationService.js";
import { assertPublicHttpUrl } from "../services/truth-engine/network.js";
import { makeId, sha256 } from "../utils/crypto.js";

export const intelligenceRouter = Router();

intelligenceRouter.get("/evidence/:snapshotId", asyncHandler(async (req, res) => {
  const snapshotId = req.params.snapshotId;
  if (!snapshotId) {
    res.status(400).json({ error: { message: "snapshotId is required." } });
    return;
  }

  if (!isMongoConnected()) {
    res.json({ items: getMemoryEvidenceRecords().filter((item) => item.lineage.snapshotId === snapshotId) });
    return;
  }

  const items = await EvidenceRecord.find({ snapshotId }).sort({ createdAt: 1 }).lean();
  res.json({ items });
}));

intelligenceRouter.get("/outcomes/:snapshotId", asyncHandler(async (req, res) => {
  const snapshotId = req.params.snapshotId;
  if (!snapshotId) {
    res.status(400).json({ error: { message: "snapshotId is required." } });
    return;
  }

  if (!isMongoConnected()) {
    res.json({ items: getMemoryOutcomeRecords().filter((item) => item.snapshotId === snapshotId).map((item) => item.item) });
    return;
  }

  const items = await OutcomeValidationRecord.find({ snapshotId }).sort({ createdAt: 1 }).lean();
  res.json({ items });
}));

intelligenceRouter.get("/alerts", authOptional, asyncHandler(async (req, res) => {
  const targetUrl = typeof req.query.targetUrl === "string" ? req.query.targetUrl : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;

  if (!isMongoConnected()) {
    const items = getMemoryAlertRecords().filter((item) => !targetUrl || item.message.includes(targetUrl));
    res.json({ items });
    return;
  }

  let userWorkspaceIds: string[] | undefined;
  if (req.auth?.user) {
    const memberships = await listUserWorkspaces(req.auth.user.userId);
    userWorkspaceIds = memberships.map((m) => m.workspaceId);
  }

  const query: Record<string, unknown> = {};
  if (targetUrl) query["targetUrl"] = targetUrl;
  if (workspaceId) {
    query["workspaceId"] = workspaceId;
  } else if (userWorkspaceIds) {
    query["workspaceId"] = { $in: userWorkspaceIds };
  }
  const items = await AlertRecord.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items });
}));

intelligenceRouter.get("/notifications", asyncHandler(async (_req, res) => {
  res.json({ items: await listNotificationOutbox() });
}));

intelligenceRouter.get("/monitoring/schedules", authOptional, asyncHandler(async (req, res) => {
  let workspaceIds: string[] | undefined;
  if (req.auth?.user) {
    const memberships = await listUserWorkspaces(req.auth.user.userId);
    workspaceIds = memberships.map((m) => m.workspaceId);
  }
  const items = await listMonitoringSchedules(workspaceIds);
  res.json({ items });
}));

intelligenceRouter.post("/monitoring/schedules", authRequired, asyncHandler(async (req, res) => {
  const input = req.body as {
    targetUrl?: string;
    tenantSlug?: string;
    cadence?: "daily" | "weekly" | "monthly";
    enabled?: boolean;
    competitorUrls?: string[];
    alertChannels?: string[];
    nextRunAt?: string;
    runNow?: boolean;
  };
  if (!input.targetUrl) {
    res.status(400).json({ error: { message: "targetUrl is required." } });
    return;
  }
  await assertPublicHttpUrl(input.targetUrl);
  await Promise.all((input.competitorUrls ?? []).filter(Boolean).slice(0, 5).map((url) => assertPublicHttpUrl(url)));

  const item = await upsertMonitoringSchedule({
    targetUrl: input.targetUrl,
    tenantSlug: input.tenantSlug,
    cadence: input.cadence,
    enabled: input.enabled,
    competitorUrls: input.competitorUrls,
    alertChannels: input.alertChannels as ("dashboard" | "email_simulated")[] | undefined,
    nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : undefined,
    runNow: Boolean(input.runNow)
  });

  await publishIntelligenceEvent({
    eventType: "monitoring.scheduled",
    layer: "automation",
    workspaceId: item.workspaceId,
    targetUrl: input.targetUrl,
    payload: { scheduleId: item.scheduleId, cadence: item.cadence, enabled: item.enabled, nextRunAt: item.nextRunAt.toISOString() },
    source: "monitoring-api",
    confidenceScore: 100
  });
  res.status(201).json({ item });
}));

intelligenceRouter.post("/monitoring/run-due", asyncHandler(async (_req, res) => {
  res.json(await runMonitoringCycle());
}));

intelligenceRouter.post("/edit/events", asyncHandler(async (req, res) => {
  const input = req.body as {
    workspaceId?: string;
    snapshotId?: string;
    sessionFingerprint?: string;
    eventType?: string;
    metadata?: Record<string, unknown>;
  };
  const eventType = input.eventType ?? "recommendation_viewed";
  const sessionFingerprint = input.sessionFingerprint ?? sha256(`${input.snapshotId ?? "anonymous"}:${req.ip ?? "local"}`).slice(0, 24);
  const eventId = makeId("edit");
  const occurredAt = new Date();

  if (isMongoConnected()) {
    await EditEvent.create({
      eventId,
      workspaceId: input.workspaceId,
      snapshotId: input.snapshotId,
      sessionFingerprint,
      eventType,
      metadata: input.metadata ?? {},
      occurredAt
    });
  }

  await publishIntelligenceEvent({
    eventType: "edit.event_collected",
    layer: "automation",
    workspaceId: input.workspaceId,
    payload: { eventId, snapshotId: input.snapshotId, sessionFingerprint, eventType, metadata: input.metadata ?? {} },
    source: "edit-intelligence-collector",
    confidenceScore: 100
  });

  res.status(201).json({ eventId, sessionFingerprint, eventType, occurredAt: occurredAt.toISOString() });
}));
