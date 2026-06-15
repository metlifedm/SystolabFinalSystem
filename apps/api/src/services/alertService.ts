import { isMongoConnected } from "../db/mongoose.js";
import { PlatformAlert, type PlatformAlertCategory, type PlatformAlertDocument, type PlatformAlertSeverity, type PlatformAlertStatus } from "../models/PlatformAlertRecord.js";
import { makeId } from "../utils/crypto.js";

export type { PlatformAlertSeverity, PlatformAlertCategory, PlatformAlertStatus };

export interface PlatformAlertView {
  alertId: string;
  alertKey: string;
  severity: PlatformAlertSeverity;
  category: PlatformAlertCategory;
  status: PlatformAlertStatus;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  autoResolved: boolean;
  createdAt: Date;
}

export interface AlertSummary {
  open: number;
  critical: number;
  warning: number;
  info: number;
  acknowledged: number;
  resolvedLast24h: number;
}

// ── In-memory stores ────────────────────────────────────────────────────────────

// Per-session dedup: alertKey -> alertId for currently open alerts
const openKeyIndex = new Map<string, string>();
const memoryAlerts = new Map<string, PlatformAlertView>();

// ── Helpers ─────────────────────────────────────────────────────────────────────

function toView(doc: PlatformAlertDocument): PlatformAlertView {
  return {
    alertId: doc.alertId,
    alertKey: doc.alertKey,
    severity: doc.severity,
    category: doc.category,
    status: doc.status,
    title: doc.title,
    message: doc.message,
    details: doc.details,
    acknowledgedAt: doc.acknowledgedAt,
    resolvedAt: doc.resolvedAt,
    autoResolved: doc.autoResolved,
    createdAt: doc.createdAt
  };
}

// ── Public API ──────────────────────────────────────────────────────────────────

export async function triggerAlert(input: {
  key: string;
  severity: PlatformAlertSeverity;
  category: PlatformAlertCategory;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}): Promise<PlatformAlertView> {
  // Dedup: if an open alert with this key already exists, return it
  const existingId = openKeyIndex.get(input.key);
  if (existingId) {
    if (!isMongoConnected()) {
      const existing = memoryAlerts.get(existingId);
      if (existing && existing.status === "open") return existing;
    } else {
      const existing = await PlatformAlert.findOne({ alertId: existingId, status: "open" }).lean();
      if (existing) return toView(existing as unknown as PlatformAlertDocument);
    }
    // If the existing alert was resolved/acked, fall through to create a new one
    openKeyIndex.delete(input.key);
  }

  const alertId = makeId("alrt");
  const record: PlatformAlertView = {
    alertId,
    alertKey: input.key,
    severity: input.severity,
    category: input.category,
    status: "open",
    title: input.title,
    message: input.message,
    details: input.details,
    autoResolved: false,
    createdAt: new Date()
  };

  openKeyIndex.set(input.key, alertId);

  if (!isMongoConnected()) {
    memoryAlerts.set(alertId, record);
    return record;
  }

  await PlatformAlert.create(record);
  return record;
}

export async function resolveAlertByKey(key: string): Promise<void> {
  const alertId = openKeyIndex.get(key);
  if (!alertId) return;
  openKeyIndex.delete(key);

  if (!isMongoConnected()) {
    const existing = memoryAlerts.get(alertId);
    if (existing && existing.status === "open") {
      memoryAlerts.set(alertId, { ...existing, status: "resolved", resolvedAt: new Date(), autoResolved: true });
    }
    return;
  }

  await PlatformAlert.updateOne(
    { alertId, status: "open" },
    { $set: { status: "resolved", resolvedAt: new Date(), autoResolved: true } }
  );
}

export async function acknowledgeAlert(alertId: string): Promise<PlatformAlertView | null> {
  if (!isMongoConnected()) {
    const existing = memoryAlerts.get(alertId);
    if (!existing || existing.status !== "open") return null;
    const updated = { ...existing, status: "acknowledged" as PlatformAlertStatus, acknowledgedAt: new Date() };
    memoryAlerts.set(alertId, updated);
    return updated;
  }

  const doc = await PlatformAlert.findOneAndUpdate(
    { alertId, status: "open" },
    { $set: { status: "acknowledged", acknowledgedAt: new Date() } },
    { new: true }
  ).lean();

  return doc ? toView(doc as unknown as PlatformAlertDocument) : null;
}

export async function resolveAlertById(alertId: string): Promise<PlatformAlertView | null> {
  openKeyIndex.forEach((id, key) => { if (id === alertId) openKeyIndex.delete(key); });

  if (!isMongoConnected()) {
    const existing = memoryAlerts.get(alertId);
    if (!existing || existing.status === "resolved") return null;
    const updated = { ...existing, status: "resolved" as PlatformAlertStatus, resolvedAt: new Date(), autoResolved: false };
    memoryAlerts.set(alertId, updated);
    return updated;
  }

  const doc = await PlatformAlert.findOneAndUpdate(
    { alertId, status: { $in: ["open", "acknowledged"] } },
    { $set: { status: "resolved", resolvedAt: new Date(), autoResolved: false } },
    { new: true }
  ).lean();

  return doc ? toView(doc as unknown as PlatformAlertDocument) : null;
}

export async function getAlert(alertId: string): Promise<PlatformAlertView | null> {
  if (!isMongoConnected()) {
    return memoryAlerts.get(alertId) ?? null;
  }
  const doc = await PlatformAlert.findOne({ alertId }).lean();
  return doc ? toView(doc as unknown as PlatformAlertDocument) : null;
}

export async function listAlerts(
  filter?: { status?: PlatformAlertStatus; category?: PlatformAlertCategory; severity?: PlatformAlertSeverity },
  limit = 50
): Promise<PlatformAlertView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryAlerts.values()];
    if (filter?.status) results = results.filter((a) => a.status === filter.status);
    if (filter?.category) results = results.filter((a) => a.category === filter.category);
    if (filter?.severity) results = results.filter((a) => a.severity === filter.severity);
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.category) query.category = filter.category;
  if (filter?.severity) query.severity = filter.severity;

  const docs = await PlatformAlert.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d) => toView(d as unknown as PlatformAlertDocument));
}

export async function getAlertSummary(): Promise<AlertSummary> {
  if (!isMongoConnected()) {
    const all = [...memoryAlerts.values()];
    const open = all.filter((a) => a.status === "open");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      open: open.length,
      critical: open.filter((a) => a.severity === "critical").length,
      warning: open.filter((a) => a.severity === "warning").length,
      info: open.filter((a) => a.severity === "info").length,
      acknowledged: all.filter((a) => a.status === "acknowledged").length,
      resolvedLast24h: all.filter((a) => a.status === "resolved" && a.resolvedAt && a.resolvedAt >= cutoff).length
    };
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [open, critical, warning, info, acknowledged, resolvedLast24h] = await Promise.all([
    PlatformAlert.countDocuments({ status: "open" }),
    PlatformAlert.countDocuments({ status: "open", severity: "critical" }),
    PlatformAlert.countDocuments({ status: "open", severity: "warning" }),
    PlatformAlert.countDocuments({ status: "open", severity: "info" }),
    PlatformAlert.countDocuments({ status: "acknowledged" }),
    PlatformAlert.countDocuments({ status: "resolved", resolvedAt: { $gte: cutoff } })
  ]);

  return { open, critical, warning, info, acknowledged, resolvedLast24h };
}
