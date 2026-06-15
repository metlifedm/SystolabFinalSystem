import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { BehavioralEvent, BehavioralEventDocument, BehavioralEventType, EngineSource } from "../models/BehavioralEvent.js";
import { addPageToSession } from "./vilSessionService.js";

export interface IngestEventInput {
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  engineSource: EngineSource;
  eventType: BehavioralEventType;
  page: string;
  timestamp?: Date;
  data?: Record<string, unknown>;
}

export type MemBehavioralEvent = {
  eventId: string;
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  engineSource: EngineSource;
  eventType: BehavioralEventType;
  page: string;
  timestamp: Date;
  data: Record<string, unknown>;
  processedAt?: Date;
  behavioralEvidenceId?: string;
};

export const _memBehavioralEvents = new Map<string, MemBehavioralEvent>();

export async function ingestEvent(
  input: IngestEventInput
): Promise<{ event: MemBehavioralEvent | BehavioralEventDocument }> {
  const eventId = makeId("vil_evt");
  const timestamp = input.timestamp ?? new Date();

  const data: MemBehavioralEvent = {
    eventId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    engineSource: input.engineSource,
    eventType: input.eventType,
    page: input.page,
    timestamp,
    data: input.data ?? {}
  };

  if (input.eventType === "page_view") {
    await addPageToSession(input.sessionId, input.page);
  }

  if (!isMongoConnected()) {
    _memBehavioralEvents.set(eventId, data);
    return { event: data };
  }

  const event = await BehavioralEvent.create(data);
  return { event };
}

export async function ingestEventBatch(
  inputs: IngestEventInput[]
): Promise<{ count: number }> {
  await Promise.all(inputs.map((i) => ingestEvent(i)));
  return { count: inputs.length };
}

export async function getEventsForSession(
  sessionId: string
): Promise<(MemBehavioralEvent | BehavioralEventDocument)[]> {
  if (!isMongoConnected()) {
    return [..._memBehavioralEvents.values()]
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  return BehavioralEvent.find({ sessionId }).sort({ timestamp: 1 }).lean();
}

export async function getEventsForWorkspace(
  workspaceId: string,
  opts: {
    eventType?: BehavioralEventType;
    engineSource?: EngineSource;
    since?: Date;
    limit?: number;
  } = {}
): Promise<(MemBehavioralEvent | BehavioralEventDocument)[]> {
  const limit = opts.limit ?? 500;

  if (!isMongoConnected()) {
    return [..._memBehavioralEvents.values()]
      .filter((e) => {
        if (workspaceId && e.workspaceId !== workspaceId) return false;
        if (opts.eventType && e.eventType !== opts.eventType) return false;
        if (opts.engineSource && e.engineSource !== opts.engineSource) return false;
        if (opts.since && e.timestamp < opts.since) return false;
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  const query: Record<string, unknown> = {};
  if (workspaceId) query["workspaceId"] = workspaceId;
  if (opts.eventType) query["eventType"] = opts.eventType;
  if (opts.engineSource) query["engineSource"] = opts.engineSource;
  if (opts.since) query["timestamp"] = { $gte: opts.since };
  return BehavioralEvent.find(query).sort({ timestamp: -1 }).limit(limit).lean();
}

export async function getEventCountsByType(
  workspaceId: string,
  since: Date
): Promise<Record<string, number>> {
  if (!isMongoConnected()) {
    const counts: Record<string, number> = {};
    for (const e of _memBehavioralEvents.values()) {
      if (e.workspaceId !== workspaceId || e.timestamp < since) continue;
      counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
    }
    return counts;
  }

  const pipeline = [
    { $match: { workspaceId, timestamp: { $gte: since } } },
    { $group: { _id: "$eventType", count: { $sum: 1 } } }
  ];
  const results = await BehavioralEvent.aggregate(pipeline);
  return Object.fromEntries(results.map((r: { _id: string; count: number }) => [r._id, r.count]));
}
