import { createHmac } from "node:crypto";
import { WebhookRecord } from "../models/WebhookRecord.js";
import { WebhookDeliveryLog, type WebhookDeliveryLogDocument, type WebhookDeliveryStatus } from "../models/WebhookDeliveryLog.js";
import { makeId } from "../utils/crypto.js";
import { recordWebhookDelivery } from "./usageTrackingService.js";
import { isMongoConnected } from "../db/mongoose.js";
import { _memWebhooks } from "./membershipService.js";

const MAX_RESPONSE_BODY_BYTES = 4096;

// ── In-memory delivery log (test / no-DB mode) ────────────────────────────────
export const _memDeliveriesForTest = new Map<string, WebhookDeliveryLogDocument>();

export function signPayload(payload: unknown, signingSecret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export async function dispatchWebhooks(
  tenantSlug: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!isMongoConnected()) {
    const webhooks = [..._memWebhooks.values()].filter(
      (wh) => {
        const whAny = wh as unknown as Record<string, unknown>;
        return whAny["tenantSlug"] === tenantSlug &&
               whAny["isActive"] &&
               (whAny["events"] as string[]).includes(eventType);
      }
    );
    if (!webhooks.length) return;
    const now = new Date();
    for (const wh of webhooks) {
      const whAny = wh as unknown as Record<string, unknown>;
      const deliveryId = makeId("wdl");
      const doc = {
        deliveryId, webhookId: whAny["webhookId"] as string, tenantSlug, eventType, payload,
        status: "pending" as WebhookDeliveryStatus, attempts: 0, maxAttempts: 5, nextRetryAt: now,
        createdAt: now, updatedAt: now,
        save: async function () { _memDeliveriesForTest.set(deliveryId, this as unknown as WebhookDeliveryLogDocument); }
      } as unknown as WebhookDeliveryLogDocument;
      _memDeliveriesForTest.set(deliveryId, doc);
    }
    return;
  }

  const webhooks = await WebhookRecord.find({
    tenantSlug,
    isActive: true,
    events: eventType
  });
  if (!webhooks.length) return;

  const now = new Date();
  const docs = webhooks.map((wh) => ({
    deliveryId: makeId("wdl"),
    webhookId: wh.webhookId,
    tenantSlug,
    eventType,
    payload,
    status: "pending" as WebhookDeliveryStatus,
    attempts: 0,
    maxAttempts: 5,
    nextRetryAt: now
  }));

  await WebhookDeliveryLog.insertMany(docs);
}

export async function deliverOne(deliveryId: string): Promise<void> {
  if (!isMongoConnected()) {
    const delivery = _memDeliveriesForTest.get(deliveryId);
    if (!delivery) return;
    const deliveryAny = delivery as unknown as Record<string, unknown>;
    const wh = [..._memWebhooks.values()].find(
      (w) => (w as unknown as Record<string, unknown>)["webhookId"] === deliveryAny["webhookId"]
    );
    if (!wh) {
      deliveryAny["status"] = "failed";
      deliveryAny["errorMessage"] = "Webhook record not found";
      return;
    }
    const whAny = wh as unknown as Record<string, unknown>;
    const sigKey = (whAny["signingSecret"] ?? whAny["secretHash"]) as string;
    const signature = signPayload(deliveryAny["payload"], sigKey);
    deliveryAny["attempts"] = ((deliveryAny["attempts"] as number) ?? 0) + 1;
    deliveryAny["lastAttemptAt"] = new Date();
    try {
      const response = await fetch(whAny["url"] as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Systolab-Signature": signature,
          "X-Systolab-Event": deliveryAny["eventType"] as string,
          "X-Systolab-Delivery": deliveryId
        },
        body: JSON.stringify(deliveryAny["payload"]),
        signal: AbortSignal.timeout(10_000)
      });
      const rawBody = await response.text().catch(() => "");
      deliveryAny["responseStatus"] = response.status;
      deliveryAny["responseBody"] = rawBody.slice(0, MAX_RESPONSE_BODY_BYTES);
      if (response.ok) {
        deliveryAny["status"] = "delivered";
        deliveryAny["deliveredAt"] = new Date();
        deliveryAny["nextRetryAt"] = undefined;
      } else {
        applyRetryScheduleRaw(deliveryAny, deliveryAny["maxAttempts"] as number);
      }
    } catch (err) {
      deliveryAny["errorMessage"] = err instanceof Error ? err.message : String(err);
      applyRetryScheduleRaw(deliveryAny, deliveryAny["maxAttempts"] as number);
    }
    return;
  }

  const delivery = await WebhookDeliveryLog.findOne({ deliveryId });
  if (!delivery) return;

  const webhook = await WebhookRecord.findOne({ webhookId: delivery.webhookId });
  if (!webhook) {
    delivery.status = "failed";
    delivery.errorMessage = "Webhook record not found";
    await delivery.save();
    return;
  }

  const sigKey = webhook.signingSecret ?? webhook.secretHash;
  const signature = signPayload(delivery.payload, sigKey);

  delivery.attempts += 1;
  delivery.lastAttemptAt = new Date();

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Systolab-Signature": signature,
        "X-Systolab-Event": delivery.eventType,
        "X-Systolab-Delivery": delivery.deliveryId
      },
      body: JSON.stringify(delivery.payload),
      signal: AbortSignal.timeout(10_000)
    });

    const rawBody = await response.text().catch(() => "");
    delivery.responseStatus = response.status;
    delivery.responseBody = rawBody.slice(0, MAX_RESPONSE_BODY_BYTES);

    if (response.ok) {
      delivery.status = "delivered";
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = undefined;
      webhook.lastDeliveredAt = new Date();
      webhook.failureCount = 0;
      await webhook.save();
      void recordWebhookDelivery(webhook.tenantId.toString(), webhook.tenantSlug).catch(() => undefined);
    } else {
      applyRetrySchedule(delivery);
      webhook.failureCount += 1;
      await webhook.save();
    }
  } catch (err) {
    delivery.errorMessage = err instanceof Error ? err.message : String(err);
    applyRetrySchedule(delivery);
    webhook.failureCount += 1;
    await webhook.save();
  }

  await delivery.save();
}

function applyRetryScheduleRaw(delivery: Record<string, unknown>, maxAttempts: number): void {
  const attempts = delivery["attempts"] as number;
  if (attempts >= maxAttempts) {
    delivery["status"] = "failed";
    delivery["nextRetryAt"] = undefined;
  } else {
    delivery["status"] = "retrying";
    const delaySec = Math.min(900, 60 * Math.pow(5, attempts - 1));
    delivery["nextRetryAt"] = new Date(Date.now() + delaySec * 1000);
  }
}

function applyRetrySchedule(delivery: WebhookDeliveryLogDocument): void {
  if (delivery.attempts >= delivery.maxAttempts) {
    delivery.status = "failed";
    delivery.nextRetryAt = undefined;
  } else {
    delivery.status = "retrying";
    const delaySec = Math.min(900, 60 * Math.pow(5, delivery.attempts - 1));
    delivery.nextRetryAt = new Date(Date.now() + delaySec * 1000);
  }
}

export async function retryPendingDeliveries(batchSize = 20): Promise<number> {
  if (!isMongoConnected()) return 0;
  const now = new Date();
  const pending = await WebhookDeliveryLog.find({
    status: { $in: ["pending", "retrying"] },
    nextRetryAt: { $lte: now }
  }).limit(batchSize);

  let processed = 0;
  for (const d of pending) {
    await deliverOne(d.deliveryId).catch(() => undefined);
    processed += 1;
  }
  return processed;
}

export async function listDeliveries(
  webhookId: string,
  limit = 50,
  offset = 0
): Promise<{ deliveries: WebhookDeliveryLogDocument[]; total: number }> {
  if (!isMongoConnected()) {
    const all = [..._memDeliveriesForTest.values()].filter(
      (d) => (d as unknown as Record<string, unknown>)["webhookId"] === webhookId
    );
    all.sort((a, b) => {
      const aDate = (a as unknown as Record<string, unknown>)["createdAt"] as Date;
      const bDate = (b as unknown as Record<string, unknown>)["createdAt"] as Date;
      return bDate.getTime() - aDate.getTime();
    });
    return { deliveries: all.slice(offset, offset + limit), total: all.length };
  }
  const [deliveries, total] = await Promise.all([
    WebhookDeliveryLog.find({ webhookId }).sort({ createdAt: -1 }).skip(offset).limit(limit),
    WebhookDeliveryLog.countDocuments({ webhookId })
  ]);
  return { deliveries, total };
}
