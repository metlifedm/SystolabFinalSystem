import type { SystolabEventEnvelope, SystolabEventType, IntelligenceLayerKey, ReportSnapshot } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";
import { IntelligenceEvent } from "../models/IntelligenceEvent.js";
import { makeId } from "../utils/crypto.js";
import { dispatchEvent } from "./eventBusService.js";

const memoryEvents: SystolabEventEnvelope[] = [];

export async function publishIntelligenceEvent(input: {
  eventType: SystolabEventType;
  layer: IntelligenceLayerKey;
  report?: ReportSnapshot;
  workspaceId?: string;
  userId?: string;
  targetUrl?: string;
  payload: Record<string, unknown>;
  evidenceIds?: string[];
  confidenceScore?: number;
  source?: string;
  schemaVersion?: number;
}): Promise<SystolabEventEnvelope> {
  const event: SystolabEventEnvelope & { schemaVersion: number } = {
    eventId: makeId("evt"),
    eventType: input.eventType,
    layer: input.layer,
    snapshotId: input.report?.snapshotId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    targetUrl: input.report?.targetUrl ?? input.targetUrl,
    timestamp: new Date().toISOString(),
    schemaVersion: input.schemaVersion ?? 1,
    payload: input.payload,
    trace: {
      source: input.source ?? "systolab-core",
      evidenceIds: input.evidenceIds ?? [],
      confidenceScore: input.confidenceScore ?? 0
    }
  };

  if (!isMongoConnected()) {
    memoryEvents.push(event);
    // Non-blocking dispatch — failure does not affect the caller
    void dispatchEvent(event).catch(() => undefined);
    return event;
  }

  await IntelligenceEvent.create({
    ...event,
    createdAt: new Date(event.timestamp)
  }).catch(() => undefined);

  void dispatchEvent(event).catch(() => undefined);
  return event;
}

export function getMemoryEvents(): SystolabEventEnvelope[] {
  return [...memoryEvents];
}
