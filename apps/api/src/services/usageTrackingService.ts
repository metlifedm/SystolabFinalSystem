import { UsageRecord, type UsageRecordDocument } from "../models/UsageRecord.js";
import { makeId } from "../utils/crypto.js";
import { getTenantPlanLimits } from "./billingService.js";
import { isMongoConnected } from "../db/mongoose.js";

// ── In-memory usage store ─────────────────────────────────────────────────────
// Key: `${tenantSlug}::${periodKey}`
const memoryUsage = new Map<string, UsageRecordDocument>();

export function getCurrentPeriodKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function memoryUpsert(
  tenantId: string,
  tenantSlug: string,
  periodKey: string,
  inc: Partial<Pick<UsageRecordDocument, "scansUsed" | "apiCallsUsed" | "storageUsedMb" | "seatsUsed" | "webhookDeliveriesCount" | "costCents">>
): void {
  const key = `${tenantSlug}::${periodKey}`;
  const existing = memoryUsage.get(key);
  if (existing) {
    const counters = existing as unknown as Record<string, number>;
    if (inc.scansUsed) counters["scansUsed"] = (counters["scansUsed"] ?? 0) + inc.scansUsed;
    if (inc.apiCallsUsed) counters["apiCallsUsed"] = (counters["apiCallsUsed"] ?? 0) + inc.apiCallsUsed;
    if (inc.storageUsedMb) counters["storageUsedMb"] = (counters["storageUsedMb"] ?? 0) + inc.storageUsedMb;
    if (inc.seatsUsed) counters["seatsUsed"] = (counters["seatsUsed"] ?? 0) + inc.seatsUsed;
    if (inc.webhookDeliveriesCount) counters["webhookDeliveriesCount"] = (counters["webhookDeliveriesCount"] ?? 0) + inc.webhookDeliveriesCount;
    if (inc.costCents) counters["costCents"] = (counters["costCents"] ?? 0) + inc.costCents;
  } else {
    memoryUsage.set(key, {
      usageId: makeId("use"),
      tenantId,
      tenantSlug,
      periodKey,
      scansUsed: inc.scansUsed ?? 0,
      apiCallsUsed: inc.apiCallsUsed ?? 0,
      storageUsedMb: inc.storageUsedMb ?? 0,
      seatsUsed: inc.seatsUsed ?? 0,
      webhookDeliveriesCount: inc.webhookDeliveriesCount ?? 0,
      costCents: inc.costCents ?? 0
    } as unknown as UsageRecordDocument);
  }
}

async function upsertUsage(
  tenantId: string,
  tenantSlug: string,
  periodKey: string,
  inc: Partial<Pick<UsageRecordDocument, "scansUsed" | "apiCallsUsed" | "storageUsedMb" | "seatsUsed" | "webhookDeliveriesCount" | "costCents">>
): Promise<void> {
  if (!isMongoConnected()) {
    memoryUpsert(tenantId, tenantSlug, periodKey, inc);
    return;
  }
  const $inc: Record<string, number> = {};
  if (inc.scansUsed) $inc["scansUsed"] = inc.scansUsed;
  if (inc.apiCallsUsed) $inc["apiCallsUsed"] = inc.apiCallsUsed;
  if (inc.storageUsedMb) $inc["storageUsedMb"] = inc.storageUsedMb;
  if (inc.seatsUsed) $inc["seatsUsed"] = inc.seatsUsed;
  if (inc.webhookDeliveriesCount) $inc["webhookDeliveriesCount"] = inc.webhookDeliveriesCount;
  if (inc.costCents) $inc["costCents"] = inc.costCents;

  const result = await UsageRecord.updateOne(
    { tenantSlug, periodKey },
    { $inc, $setOnInsert: { usageId: makeId("use"), tenantId, tenantSlug, periodKey } },
    { upsert: true }
  );
  void result;
}

export async function recordScanUsage(tenantId: string, tenantSlug: string, costCents = 0): Promise<void> {
  await upsertUsage(tenantId, tenantSlug, getCurrentPeriodKey(), { scansUsed: 1, costCents });
}

export async function recordApiCallUsage(tenantId: string, tenantSlug: string, count = 1): Promise<void> {
  await upsertUsage(tenantId, tenantSlug, getCurrentPeriodKey(), { apiCallsUsed: count });
}

export async function recordWebhookDelivery(tenantId: string, tenantSlug: string): Promise<void> {
  await upsertUsage(tenantId, tenantSlug, getCurrentPeriodKey(), { webhookDeliveriesCount: 1 });
}

export async function getUsageForPeriod(tenantSlug: string, periodKey?: string): Promise<UsageRecordDocument | null> {
  if (!isMongoConnected()) return memoryUsage.get(`${tenantSlug}::${periodKey ?? getCurrentPeriodKey()}`) ?? null;
  return UsageRecord.findOne({ tenantSlug, periodKey: periodKey ?? getCurrentPeriodKey() });
}

export async function getUsageHistory(tenantSlug: string, months = 12): Promise<UsageRecordDocument[]> {
  if (!isMongoConnected()) {
    return [...memoryUsage.values()]
      .filter((r) => r.tenantSlug === tenantSlug)
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
      .slice(0, months);
  }
  return UsageRecord.find({ tenantSlug }).sort({ periodKey: -1 }).limit(months);
}

export async function checkScanLimit(tenantSlug: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limits = await getTenantPlanLimits(tenantSlug);
  if (limits.scansPerMonth === -1) return { allowed: true, used: 0, limit: -1 };
  const usage = isMongoConnected()
    ? await UsageRecord.findOne({ tenantSlug, periodKey: getCurrentPeriodKey() })
    : memoryUsage.get(`${tenantSlug}::${getCurrentPeriodKey()}`);
  const used = usage?.scansUsed ?? 0;
  return { allowed: used < limits.scansPerMonth, used, limit: limits.scansPerMonth };
}

export async function checkApiCallLimit(tenantSlug: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limits = await getTenantPlanLimits(tenantSlug);
  if (limits.apiCallsPerMonth === -1) return { allowed: true, used: 0, limit: -1 };
  const usage = isMongoConnected()
    ? await UsageRecord.findOne({ tenantSlug, periodKey: getCurrentPeriodKey() })
    : memoryUsage.get(`${tenantSlug}::${getCurrentPeriodKey()}`);
  const used = usage?.apiCallsUsed ?? 0;
  return { allowed: used < limits.apiCallsPerMonth, used, limit: limits.apiCallsPerMonth };
}
