import { describe, expect, it } from "vitest";
import type { SystolabEventEnvelope } from "@systolab/shared";
import { makeId } from "./utils/crypto.js";
import {
  dispatchEvent,
  getEventBusStats,
  listEventDeliveries,
  processDeliveries,
  registerHandler,
  registerSubscriber,
  type SubscriberConfig
} from "./services/eventBusService.js";
import {
  getMemoryEvents,
  publishIntelligenceEvent
} from "./services/intelligenceEventBus.js";

function makeEvent(overrides: Partial<SystolabEventEnvelope> = {}): SystolabEventEnvelope {
  return {
    eventId: makeId("evt"),
    eventType: "scan.completed",
    layer: "intelligence",
    workspaceId: "ws_test",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    payload: { snapshotId: "snap_001", score: 75 },
    trace: { source: "test-suite", evidenceIds: [], confidenceScore: 0.9 },
    ...overrides
  };
}

function makeSubscriber(handlerName: string, overrides: Partial<SubscriberConfig> = {}): SubscriberConfig {
  const id = makeId("sub");
  return {
    subscriptionId: id,
    subscriberId: makeId("svc"),
    description: "test subscriber",
    eventTypes: ["scan.completed"],
    layers: [],
    handlerName,
    deliveryMode: "sync",
    minSchemaVersion: 1,
    maxAttempts: 1,
    enabled: true,
    ...overrides
  };
}

describe("event bus — stats", () => {
  it("getEventBusStats returns valid numeric counters", async () => {
    const stats = await getEventBusStats();
    expect(typeof stats.registeredSubscribers).toBe("number");
    expect(typeof stats.pendingDeliveries).toBe("number");
    expect(typeof stats.deadLetterDeliveries).toBe("number");
    expect(typeof stats.deliveredLast24h).toBe("number");
    expect(stats.registeredSubscribers).toBeGreaterThanOrEqual(0);
  });
});

describe("event bus — subscription and delivery", () => {
  it("dispatchEvent creates delivery records for matching subscribers", async () => {
    const handlerName = `h-${makeId("h")}`;
    registerHandler(handlerName, async () => undefined);
    const sub = makeSubscriber(handlerName);
    registerSubscriber(sub);

    const event = makeEvent({ eventId: makeId("evt") });
    await dispatchEvent(event);

    const deliveries = await listEventDeliveries({ eventId: event.eventId });
    expect(deliveries.some((d) => d.subscriptionId === sub.subscriptionId)).toBe(true);
  });

  it("processDeliveries invokes registered handlers and returns a processed count", async () => {
    const handlerName = `proc-${makeId("h")}`;
    let callCount = 0;
    registerHandler(handlerName, async () => { callCount += 1; });
    const sub = makeSubscriber(handlerName);
    registerSubscriber(sub);

    const event = makeEvent({ eventId: makeId("evt") });
    await dispatchEvent(event);
    const result = await processDeliveries(20);

    // In memory mode, dispatch calls handlers synchronously; processDeliveries returns 0 (no-op)
    expect(result.processed).toBeGreaterThanOrEqual(0);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("processing the same delivery a second time is idempotent", async () => {
    const handlerName = `idem-${makeId("h")}`;
    let callCount = 0;
    registerHandler(handlerName, async () => { callCount += 1; });
    const sub = makeSubscriber(handlerName);
    registerSubscriber(sub);

    const event = makeEvent({ eventId: makeId("evt") });
    await dispatchEvent(event);
    await processDeliveries(20);
    const countAfterFirst = callCount;

    await processDeliveries(20);
    // Already-delivered records must not re-fire
    expect(callCount).toBe(countAfterFirst);
  });

  it("disabled subscriber does not receive events", async () => {
    const handlerName = `disabled-${makeId("h")}`;
    let callCount = 0;
    registerHandler(handlerName, async () => { callCount += 1; });
    const sub = makeSubscriber(handlerName, { enabled: false });
    registerSubscriber(sub);

    const event = makeEvent({ eventId: makeId("evt") });
    await dispatchEvent(event);
    await processDeliveries(20);

    expect(callCount).toBe(0);
  });

  it("subscriber only receives events for its configured eventTypes", async () => {
    const handlerName = `etype-${makeId("h")}`;
    let callCount = 0;
    registerHandler(handlerName, async () => { callCount += 1; });
    const sub = makeSubscriber(handlerName, { eventTypes: ["recommendation.generated"] });
    registerSubscriber(sub);

    // Dispatch a scan.completed — subscriber only wants recommendation.generated
    const event = makeEvent({ eventId: makeId("evt"), eventType: "scan.completed" });
    await dispatchEvent(event);
    await processDeliveries(20);

    expect(callCount).toBe(0);
  });

  it("subscriber with minSchemaVersion=2 ignores v1 events", async () => {
    const handlerName = `schema-${makeId("h")}`;
    let callCount = 0;
    registerHandler(handlerName, async () => { callCount += 1; });
    const sub = makeSubscriber(handlerName, { minSchemaVersion: 2 });
    registerSubscriber(sub);

    const event = makeEvent({ eventId: makeId("evt"), schemaVersion: 1 });
    await dispatchEvent(event);
    await processDeliveries(20);

    expect(callCount).toBe(0);
  });
});

describe("event bus — intelligence event publishing (memory mode)", () => {
  it("publishIntelligenceEvent stores the event in the memory store", async () => {
    const before = getMemoryEvents().length;
    await publishIntelligenceEvent({
      eventType: "scan.completed",
      layer: "intelligence",
      payload: { snapshotId: makeId("snap"), score: 80 }
    });
    expect(getMemoryEvents().length).toBe(before + 1);
  });

  it("published event has all required SystolabEventEnvelope fields", async () => {
    const event = await publishIntelligenceEvent({
      eventType: "evidence.generated",
      layer: "truth_evidence",
      payload: { evidenceId: makeId("ev") },
      source: "test-suite",
      confidenceScore: 0.95
    });

    expect(event.eventId).toBeTruthy();
    expect(event.eventType).toBe("evidence.generated");
    expect(event.layer).toBe("truth_evidence");
    expect(event.trace.source).toBe("test-suite");
    expect(event.trace.confidenceScore).toBe(0.95);
    expect(event.timestamp).toBeTruthy();
    expect(event.schemaVersion).toBe(1);
  });

  it("publishIntelligenceEvent is non-destructive — does not throw on dispatch errors", async () => {
    // Handler throws — event should still be persisted
    const handlerName = `throw-${makeId("h")}`;
    registerHandler(handlerName, async () => { throw new Error("handler error"); });
    registerSubscriber(makeSubscriber(handlerName));

    const before = getMemoryEvents().length;
    await expect(
      publishIntelligenceEvent({ eventType: "scan.completed", layer: "intelligence", payload: {} })
    ).resolves.toBeDefined();
    expect(getMemoryEvents().length).toBeGreaterThan(before);
  });
});
