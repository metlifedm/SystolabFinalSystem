// Event Bus Service — persistent delivery, subscriber routing, replay, and dead-letter handling.
//
// Design: handler functions are registered by name via registerHandler(). The actual handler
// implementations live in eventHandlers.ts, which is imported for side effects in server.ts.
// This indirection prevents circular imports because eventHandlers.ts can safely import
// services (like iireService, alertService) that internally call publishIntelligenceEvent.

import type { IntelligenceLayerKey, SystolabEventEnvelope, SystolabEventType } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";
import { EventDeliveryRecord, type DeliveryStatus } from "../models/EventDeliveryRecord.js";
import { IntelligenceEvent } from "../models/IntelligenceEvent.js";
import { makeId } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

// ── Handler and subscriber types ────────────────────────────────────────────────

export interface DeliveryMeta {
  deliveryId: string;
  subscriptionId: string;
  subscriberId: string;
  attempt: number;
}

export type HandlerFn = (event: SystolabEventEnvelope, meta: DeliveryMeta) => Promise<void>;

export interface SubscriberConfig {
  subscriptionId: string;
  subscriberId: string;
  description: string;
  // Empty array = match all values
  eventTypes: SystolabEventType[];
  layers: IntelligenceLayerKey[];
  handlerName: string;
  deliveryMode: "sync" | "async";
  minSchemaVersion: number;
  maxAttempts: number;
  enabled: boolean;
}

export interface EventDeliveryView {
  deliveryId: string;
  eventId: string;
  subscriptionId: string;
  subscriberId: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastAttemptAt?: Date;
  processedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

export interface EventBusStats {
  registeredSubscribers: number;
  pendingDeliveries: number;
  processingDeliveries: number;
  deliveredLast24h: number;
  failedDeliveries: number;
  deadLetterDeliveries: number;
  totalEventsStored: number;
}

export interface ProcessResult {
  processed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  skipped: number;
}

export interface ReplayOptions {
  eventTypes?: SystolabEventType[];
  layers?: IntelligenceLayerKey[];
  workspaceId?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
  subscriptionIds?: string[];
  limit?: number;
}

export interface ReplayResult {
  eventsFound: number;
  deliveriesQueued: number;
  deliveriesSkipped: number;
}

// ── In-memory registries ────────────────────────────────────────────────────────

const handlerRegistry = new Map<string, HandlerFn>();
const subscriberRegistry = new Map<string, SubscriberConfig>();
// Memory-mode delivery store (when MongoDB unavailable)
const memoryDeliveries = new Map<string, EventDeliveryView>();
const memoryProcessed = new Set<string>(); // deliveryId → processed idempotency

// ── Public registration API ─────────────────────────────────────────────────────

export function registerHandler(handlerName: string, fn: HandlerFn): void {
  handlerRegistry.set(handlerName, fn);
}

export function registerSubscriber(config: SubscriberConfig): void {
  subscriberRegistry.set(config.subscriptionId, config);
}

export function getRegisteredSubscriptions(): SubscriberConfig[] {
  return [...subscriberRegistry.values()];
}

export function setSubscriberEnabled(subscriptionId: string, enabled: boolean): void {
  const sub = subscriberRegistry.get(subscriptionId);
  if (sub) subscriberRegistry.set(subscriptionId, { ...sub, enabled });
}

// ── Routing predicate ────────────────────────────────────────────────────────────

function matchesSubscriber(sub: SubscriberConfig, event: SystolabEventEnvelope): boolean {
  if (!sub.enabled) return false;
  if (sub.eventTypes.length > 0 && !sub.eventTypes.includes(event.eventType)) return false;
  if (sub.layers.length > 0 && !sub.layers.includes(event.layer)) return false;
  const version = (event as SystolabEventEnvelope & { schemaVersion?: number }).schemaVersion ?? 1;
  if (version < sub.minSchemaVersion) return false;
  return true;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────────

export async function dispatchEvent(event: SystolabEventEnvelope): Promise<void> {
  const matching = [...subscriberRegistry.values()].filter((s) => matchesSubscriber(s, event));
  if (matching.length === 0) return;

  if (!isMongoConnected()) {
    // Memory mode: dispatch all synchronously right now
    for (const sub of matching) {
      await deliverMemory(sub, event);
    }
    return;
  }

  for (const sub of matching) {
    if (sub.deliveryMode === "sync") {
      await deliverWithTracking(sub, event);
    } else {
      // Create a pending delivery record (idempotent: skip on duplicate key)
      const deliveryId = makeId("dlv");
      await EventDeliveryRecord.create({
        deliveryId,
        eventId: event.eventId,
        subscriptionId: sub.subscriptionId,
        subscriberId: sub.subscriberId,
        status: "pending",
        attempts: 0,
        maxAttempts: sub.maxAttempts,
        nextRetryAt: new Date(),
        createdAt: new Date()
      }).catch((err: { code?: number }) => {
        if (err.code !== 11000) logger.warn("event_bus.create_delivery_failed", { eventId: event.eventId, subscriptionId: sub.subscriptionId, error: String(err) });
      });
    }
  }
}

// ── Memory-mode delivery ─────────────────────────────────────────────────────────

async function deliverMemory(sub: SubscriberConfig, event: SystolabEventEnvelope): Promise<void> {
  const deliveryId = makeId("dlv");
  const key = `${event.eventId}::${sub.subscriptionId}`;
  if (memoryProcessed.has(key)) return; // idempotency

  const delivery: EventDeliveryView = {
    deliveryId,
    eventId: event.eventId,
    subscriptionId: sub.subscriptionId,
    subscriberId: sub.subscriberId,
    status: "pending",
    attempts: 0,
    maxAttempts: sub.maxAttempts,
    nextRetryAt: new Date(),
    createdAt: new Date()
  };
  memoryDeliveries.set(deliveryId, delivery);

  const fn = handlerRegistry.get(sub.handlerName);
  const meta: DeliveryMeta = { deliveryId, subscriptionId: sub.subscriptionId, subscriberId: sub.subscriberId, attempt: 1 };

  try {
    if (fn) await fn(event, meta);
    memoryDeliveries.set(deliveryId, { ...delivery, status: "delivered", processedAt: new Date(), attempts: 1 });
    memoryProcessed.add(key);
  } catch (err) {
    memoryDeliveries.set(deliveryId, { ...delivery, status: "failed", attempts: 1, errorMessage: String(err) });
  }
}

// ── Sync delivery with DB tracking ───────────────────────────────────────────────

async function deliverWithTracking(sub: SubscriberConfig, event: SystolabEventEnvelope): Promise<void> {
  const deliveryId = makeId("dlv");
  const meta: DeliveryMeta = { deliveryId, subscriptionId: sub.subscriptionId, subscriberId: sub.subscriberId, attempt: 1 };
  const fn = handlerRegistry.get(sub.handlerName);
  const now = new Date();

  // Upsert record — if duplicate key it was already delivered; skip
  const existing = await EventDeliveryRecord.findOne({ eventId: event.eventId, subscriptionId: sub.subscriptionId }).lean();
  if (existing?.status === "delivered") return;

  const recordId = existing?.deliveryId ?? deliveryId;
  const attempts = (existing?.attempts ?? 0) + 1;

  try {
    if (!fn) throw new Error(`Handler '${sub.handlerName}' not registered`);
    await fn(event, meta);
    await EventDeliveryRecord.findOneAndUpdate(
      { eventId: event.eventId, subscriptionId: sub.subscriptionId },
      { $set: { deliveryId: recordId, eventId: event.eventId, subscriptionId: sub.subscriptionId, subscriberId: sub.subscriberId, status: "delivered", attempts, maxAttempts: sub.maxAttempts, nextRetryAt: now, processedAt: now, lastAttemptAt: now, createdAt: existing ? undefined : now } },
      { upsert: true }
    );
  } catch (err) {
    const isDeadLetter = attempts >= sub.maxAttempts;
    await EventDeliveryRecord.findOneAndUpdate(
      { eventId: event.eventId, subscriptionId: sub.subscriptionId },
      { $set: { deliveryId: recordId, eventId: event.eventId, subscriptionId: sub.subscriptionId, subscriberId: sub.subscriberId, status: isDeadLetter ? "dead_letter" : "failed", attempts, maxAttempts: sub.maxAttempts, nextRetryAt: now, lastAttemptAt: now, errorMessage: err instanceof Error ? err.message : String(err), createdAt: existing ? undefined : now } },
      { upsert: true }
    );
    throw err;
  }
}

// ── Async delivery processing (called by eventReplayWorker) ─────────────────────

export async function processDeliveries(limit = 20): Promise<ProcessResult> {
  if (!isMongoConnected()) return { processed: 0, delivered: 0, failed: 0, deadLettered: 0, skipped: 0 };

  const now = new Date();

  // Atomically claim pending/failed deliveries that are due
  const candidates = await EventDeliveryRecord.find({
    status: { $in: ["pending", "failed"] },
    nextRetryAt: { $lte: now }
  }).sort({ nextRetryAt: 1 }).limit(limit).lean();

  if (candidates.length === 0) return { processed: 0, delivered: 0, failed: 0, deadLettered: 0, skipped: 0 };

  const deliveryIds = candidates.map((d) => d.deliveryId);
  await EventDeliveryRecord.updateMany(
    { deliveryId: { $in: deliveryIds }, status: { $in: ["pending", "failed"] } },
    { $set: { status: "processing", lastAttemptAt: now } }
  );

  let delivered = 0, failed = 0, deadLettered = 0, skipped = 0;

  for (const record of candidates) {
    const sub = subscriberRegistry.get(record.subscriptionId);
    if (!sub) {
      await EventDeliveryRecord.updateOne({ deliveryId: record.deliveryId }, { $set: { status: "skipped" } });
      skipped++;
      continue;
    }

    const eventDoc = await IntelligenceEvent.findOne({ eventId: record.eventId }).lean();
    if (!eventDoc) {
      await EventDeliveryRecord.updateOne({ deliveryId: record.deliveryId }, { $set: { status: "skipped" } });
      skipped++;
      continue;
    }

    const event = docToEnvelope(eventDoc);
    const fn = handlerRegistry.get(sub.handlerName);
    const attempts = record.attempts + 1;
    const meta: DeliveryMeta = {
      deliveryId: record.deliveryId,
      subscriptionId: record.subscriptionId,
      subscriberId: record.subscriberId,
      attempt: attempts
    };

    try {
      if (!fn) throw new Error(`Handler '${sub.handlerName}' not registered`);
      await fn(event, meta);
      await EventDeliveryRecord.updateOne(
        { deliveryId: record.deliveryId },
        { $set: { status: "delivered", attempts, processedAt: now, lastAttemptAt: now } }
      );
      delivered++;
    } catch (err) {
      const isDeadLetter = attempts >= record.maxAttempts;
      // Exponential backoff: 1min → 5min → 15min (capped)
      const baseDelay = 60_000;
      const retryDelay = Math.min(15 * 60_000, baseDelay * Math.pow(5, attempts - 1));
      await EventDeliveryRecord.updateOne(
        { deliveryId: record.deliveryId },
        {
          $set: {
            status: isDeadLetter ? "dead_letter" : "failed",
            attempts,
            lastAttemptAt: now,
            nextRetryAt: isDeadLetter ? now : new Date(now.getTime() + retryDelay),
            errorMessage: err instanceof Error ? err.message : String(err)
          }
        }
      );
      if (isDeadLetter) {
        deadLettered++;
        logger.warn("event_bus.dead_letter", { deliveryId: record.deliveryId, eventId: record.eventId, subscriberId: record.subscriberId, attempts });
      } else {
        failed++;
      }
    }
  }

  return { processed: candidates.length, delivered, failed, deadLettered, skipped };
}

// ── Replay ────────────────────────────────────────────────────────────────────────

export async function replayEvents(options: ReplayOptions): Promise<ReplayResult> {
  const limit = Math.min(options.limit ?? 200, 500);

  // Query historical IntelligenceEvent records
  const query: Record<string, unknown> = {};
  if (options.eventTypes?.length) query.eventType = { $in: options.eventTypes };
  if (options.layers?.length) query.layer = { $in: options.layers };
  if (options.workspaceId) query.workspaceId = options.workspaceId;
  if (options.fromTimestamp || options.toTimestamp) {
    query.createdAt = {};
    if (options.fromTimestamp) (query.createdAt as Record<string, unknown>).$gte = options.fromTimestamp;
    if (options.toTimestamp) (query.createdAt as Record<string, unknown>).$lte = options.toTimestamp;
  }

  const events = isMongoConnected()
    ? await IntelligenceEvent.find(query).sort({ createdAt: -1 }).limit(limit).lean()
    : [];

  const targetSubs = options.subscriptionIds
    ? [...subscriberRegistry.values()].filter((s) => options.subscriptionIds!.includes(s.subscriptionId))
    : [...subscriberRegistry.values()];

  let deliveriesQueued = 0;
  let deliveriesSkipped = 0;

  for (const eventDoc of events) {
    const event = docToEnvelope(eventDoc);
    for (const sub of targetSubs) {
      if (!matchesSubscriber(sub, event)) continue;

      const existing = await EventDeliveryRecord.findOne({
        eventId: event.eventId,
        subscriptionId: sub.subscriptionId
      }).lean();

      if (existing?.status === "delivered") {
        deliveriesSkipped++;
        continue;
      }

      if (existing) {
        // Reset failed/dead_letter to pending for retry
        await EventDeliveryRecord.updateOne(
          { deliveryId: existing.deliveryId },
          { $set: { status: "pending", nextRetryAt: new Date(), errorMessage: undefined } }
        );
      } else {
        await EventDeliveryRecord.create({
          deliveryId: makeId("dlv"),
          eventId: event.eventId,
          subscriptionId: sub.subscriptionId,
          subscriberId: sub.subscriberId,
          status: "pending",
          attempts: 0,
          maxAttempts: sub.maxAttempts,
          nextRetryAt: new Date(),
          createdAt: new Date()
        }).catch((err: { code?: number }) => {
          if (err.code !== 11000) throw err;
        });
      }
      deliveriesQueued++;
    }
  }

  return { eventsFound: events.length, deliveriesQueued, deliveriesSkipped };
}

// ── Dead-letter manual retry ──────────────────────────────────────────────────────

export async function retryDeadLetterDelivery(deliveryId: string): Promise<EventDeliveryView | null> {
  const record = await EventDeliveryRecord.findOneAndUpdate(
    { deliveryId, status: "dead_letter" },
    { $set: { status: "pending", nextRetryAt: new Date(), attempts: 0, errorMessage: undefined } },
    { new: true }
  ).lean();

  return record ? toView(record) : null;
}

// ── Query API ─────────────────────────────────────────────────────────────────────

export async function listEventDeliveries(
  filter?: { status?: DeliveryStatus; subscriberId?: string; eventId?: string; subscriptionId?: string },
  limit = 50
): Promise<EventDeliveryView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryDeliveries.values()];
    if (filter?.status) results = results.filter((d) => d.status === filter.status);
    if (filter?.subscriberId) results = results.filter((d) => d.subscriberId === filter.subscriberId);
    if (filter?.eventId) results = results.filter((d) => d.eventId === filter.eventId);
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.subscriberId) query.subscriberId = filter.subscriberId;
  if (filter?.eventId) query.eventId = filter.eventId;
  if (filter?.subscriptionId) query.subscriptionId = filter.subscriptionId;

  const docs = await EventDeliveryRecord.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toView);
}

export async function getDeliveryRecord(deliveryId: string): Promise<EventDeliveryView | null> {
  if (!isMongoConnected()) return memoryDeliveries.get(deliveryId) ?? null;
  const doc = await EventDeliveryRecord.findOne({ deliveryId }).lean();
  return doc ? toView(doc) : null;
}

export async function listIntelligenceEvents(
  filter?: {
    eventTypes?: SystolabEventType[];
    layers?: IntelligenceLayerKey[];
    workspaceId?: string;
    snapshotId?: string;
  },
  limit = 50
): Promise<SystolabEventEnvelope[]> {
  const query: Record<string, unknown> = {};
  if (filter?.eventTypes?.length) query.eventType = { $in: filter.eventTypes };
  if (filter?.layers?.length) query.layer = { $in: filter.layers };
  if (filter?.workspaceId) query.workspaceId = filter.workspaceId;
  if (filter?.snapshotId) query.snapshotId = filter.snapshotId;

  if (!isMongoConnected()) {
    // Pull from intelligenceEventBus memory store via the model import
    return [];
  }

  const docs = await IntelligenceEvent.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(docToEnvelope);
}

export async function getIntelligenceEvent(eventId: string): Promise<SystolabEventEnvelope | null> {
  if (!isMongoConnected()) return null;
  const doc = await IntelligenceEvent.findOne({ eventId }).lean();
  return doc ? docToEnvelope(doc) : null;
}

export async function getEventBusStats(): Promise<EventBusStats> {
  if (!isMongoConnected()) {
    const deliveries = [...memoryDeliveries.values()];
    return {
      registeredSubscribers: subscriberRegistry.size,
      pendingDeliveries: deliveries.filter((d) => d.status === "pending").length,
      processingDeliveries: deliveries.filter((d) => d.status === "processing").length,
      deliveredLast24h: deliveries.filter((d) => d.status === "delivered").length,
      failedDeliveries: deliveries.filter((d) => d.status === "failed").length,
      deadLetterDeliveries: deliveries.filter((d) => d.status === "dead_letter").length,
      totalEventsStored: 0
    };
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pending, processing, delivered, failed, dead, total] = await Promise.all([
    EventDeliveryRecord.countDocuments({ status: "pending" }),
    EventDeliveryRecord.countDocuments({ status: "processing" }),
    EventDeliveryRecord.countDocuments({ status: "delivered", processedAt: { $gte: cutoff } }),
    EventDeliveryRecord.countDocuments({ status: "failed" }),
    EventDeliveryRecord.countDocuments({ status: "dead_letter" }),
    IntelligenceEvent.countDocuments({})
  ]);

  return {
    registeredSubscribers: subscriberRegistry.size,
    pendingDeliveries: pending,
    processingDeliveries: processing,
    deliveredLast24h: delivered,
    failedDeliveries: failed,
    deadLetterDeliveries: dead,
    totalEventsStored: total
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────

function docToEnvelope(doc: Record<string, unknown>): SystolabEventEnvelope {
  return {
    eventId: doc.eventId as string,
    eventType: doc.eventType as SystolabEventType,
    layer: doc.layer as IntelligenceLayerKey,
    snapshotId: doc.snapshotId as string | undefined,
    workspaceId: doc.workspaceId as string | undefined,
    userId: doc.userId as string | undefined,
    targetUrl: doc.targetUrl as string | undefined,
    timestamp: doc.timestamp as string ?? (doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date().toISOString()),
    payload: (doc.payload as Record<string, unknown>) ?? {},
    trace: (doc.trace as { source: string; evidenceIds: string[]; confidenceScore: number }) ?? { source: "unknown", evidenceIds: [], confidenceScore: 0 },
    // Pass through schemaVersion if present
    ...(typeof doc.schemaVersion === "number" ? { schemaVersion: doc.schemaVersion } : {})
  } as SystolabEventEnvelope & { schemaVersion?: number };
}

function toView(doc: Record<string, unknown>): EventDeliveryView {
  return {
    deliveryId: doc.deliveryId as string,
    eventId: doc.eventId as string,
    subscriptionId: doc.subscriptionId as string,
    subscriberId: doc.subscriberId as string,
    status: doc.status as DeliveryStatus,
    attempts: doc.attempts as number,
    maxAttempts: doc.maxAttempts as number,
    nextRetryAt: doc.nextRetryAt as Date,
    lastAttemptAt: doc.lastAttemptAt as Date | undefined,
    processedAt: doc.processedAt as Date | undefined,
    errorMessage: doc.errorMessage as string | undefined,
    createdAt: doc.createdAt as Date
  };
}
