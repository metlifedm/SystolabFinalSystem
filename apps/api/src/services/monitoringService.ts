import type { MonitoringSchedulerState } from "@systolab/shared";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { MonitoringSchedule } from "../models/MonitoringSchedule.js";
import { workspaceIdFor } from "./intelligencePersistenceService.js";

export interface MonitoringScheduleRecord {
  scheduleId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  cadence: MonitoringSchedulerState["cadence"];
  enabled: boolean;
  competitorUrls: string[];
  alertChannels: MonitoringSchedulerState["alertChannels"];
  lastRunAt?: Date;
  nextRunAt: Date;
}

const memorySchedules = new Map<string, MonitoringScheduleRecord>();

export async function upsertMonitoringSchedule(input: {
  targetUrl: string;
  tenantSlug?: string;
  cadence?: MonitoringSchedulerState["cadence"];
  enabled?: boolean;
  competitorUrls?: string[];
  alertChannels?: MonitoringSchedulerState["alertChannels"];
  nextRunAt?: Date;
  runNow?: boolean;
}): Promise<MonitoringScheduleRecord> {
  const tenantSlug = input.tenantSlug ?? "default";
  const cadence = input.cadence ?? "weekly";
  const workspaceId = workspaceIdFor(tenantSlug, input.targetUrl);
  const scheduleId = scheduleIdFor(tenantSlug, input.targetUrl, cadence);
  const nextRunAt = input.runNow ? new Date(Date.now() - 1000) : input.nextRunAt ?? nextRunFor(new Date(), cadence);
  const record: MonitoringScheduleRecord = {
    scheduleId,
    workspaceId,
    tenantSlug,
    targetUrl: input.targetUrl,
    cadence,
    enabled: input.enabled !== false,
    competitorUrls: (input.competitorUrls ?? []).slice(0, 5),
    alertChannels: input.alertChannels ?? ["dashboard"],
    nextRunAt
  };

  if (!isMongoConnected()) {
    memorySchedules.set(scheduleId, record);
    return record;
  }

  const saved = await MonitoringSchedule.findOneAndUpdate({ scheduleId }, record, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  }).lean();
  return fromMongoSchedule(saved);
}

export async function listMonitoringSchedules(workspaceIds?: string[], limit = 100): Promise<MonitoringScheduleRecord[]> {
  if (!isMongoConnected()) {
    let all = [...memorySchedules.values()];
    if (workspaceIds) all = all.filter((s) => workspaceIds.includes(s.workspaceId));
    return all.sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime()).slice(0, limit);
  }
  const filter = workspaceIds ? { workspaceId: { $in: workspaceIds } } : {};
  const rows = await MonitoringSchedule.find(filter).sort({ nextRunAt: 1 }).limit(limit).lean();
  return rows.map(fromMongoSchedule);
}

export async function findDueMonitoringSchedules(now = new Date(), limit = env.monitoringWorkerBatchSize): Promise<MonitoringScheduleRecord[]> {
  if (!isMongoConnected()) {
    return [...memorySchedules.values()]
      .filter((schedule) => schedule.enabled && schedule.nextRunAt.getTime() <= now.getTime())
      .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())
      .slice(0, limit);
  }
  const rows = await MonitoringSchedule.find({ enabled: true, nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).limit(limit).lean();
  return rows.map(fromMongoSchedule);
}

export async function markMonitoringScheduleRun(schedule: MonitoringScheduleRecord, lastRunAt: Date): Promise<MonitoringScheduleRecord> {
  const updated = {
    ...schedule,
    lastRunAt,
    nextRunAt: nextRunFor(lastRunAt, schedule.cadence)
  };
  if (!isMongoConnected()) {
    memorySchedules.set(schedule.scheduleId, updated);
    return updated;
  }

  const row = await MonitoringSchedule.findOneAndUpdate(
    { scheduleId: schedule.scheduleId },
    {
      lastRunAt: updated.lastRunAt,
      nextRunAt: updated.nextRunAt,
      enabled: updated.enabled,
      competitorUrls: updated.competitorUrls,
      alertChannels: updated.alertChannels
    },
    { new: true }
  ).lean();
  return fromMongoSchedule(row ?? updated);
}

export function nextRunFor(from: Date, cadence: MonitoringSchedulerState["cadence"]): Date {
  const next = new Date(from);
  if (cadence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (cadence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function scheduleIdFor(tenantSlug: string, targetUrl: string, cadence: MonitoringSchedulerState["cadence"]): string {
  return `mon_${Buffer.from(`${tenantSlug}:${targetUrl}:${cadence}`).toString("base64url").slice(0, 18)}`;
}

function fromMongoSchedule(row: unknown): MonitoringScheduleRecord {
  const schedule = row as MonitoringScheduleRecord & { lastRunAt?: string | Date; nextRunAt: string | Date };
  return {
    scheduleId: schedule.scheduleId,
    workspaceId: schedule.workspaceId,
    tenantSlug: schedule.tenantSlug,
    targetUrl: schedule.targetUrl,
    cadence: schedule.cadence,
    enabled: schedule.enabled,
    competitorUrls: schedule.competitorUrls ?? [],
    alertChannels: schedule.alertChannels ?? ["dashboard"],
    lastRunAt: schedule.lastRunAt ? new Date(schedule.lastRunAt) : undefined,
    nextRunAt: new Date(schedule.nextRunAt)
  };
}
