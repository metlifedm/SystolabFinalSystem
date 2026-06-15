import { isMongoConnected } from "../db/mongoose.js";
import { makeId, sha256 } from "../utils/crypto.js";
import { ConsentCategories, ConsentMethod, ConsentRecord, ConsentRecordDocument } from "../models/ConsentRecord.js";
import { logger } from "../utils/logger.js";

// ─── Behavioral Consent Framework ──────────────────────────────────────────────
//
// Required before any behavioral data is collected by the Visitor Intelligence Layer.
//
// Flow:
//   Visitor Arrives
//     ↓
//   Consent Validation   ← this service
//     ↓
//   Session Capture      ← vilSessionService (blocked until consent passes)
//     ↓
//   Behavior Tracking    ← vilEventService (blocked if consent revoked)
//
// Consent is keyed by visitorId + workspaceId.
// The consentGiven=true + behavioral=true combination is the gate.
// All consent state changes are recorded in an immutable audit trail.

export type ConsentValidationResult =
  | { allowed: true; consentId: string; consentVersion: string }
  | { allowed: false; code: ConsentDeniedCode; reason: string };

export type ConsentDeniedCode =
  | "CONSENT_REQUIRED"
  | "CONSENT_REVOKED"
  | "CONSENT_EXPIRED"
  | "BEHAVIORAL_CONSENT_NOT_GRANTED";

export interface RecordConsentInput {
  visitorId?: string;       // Generated if not provided
  workspaceId: string;
  tenantSlug: string;
  consentGiven: boolean;
  consentVersion?: string;
  consentMethod?: ConsentMethod;
  ipHashAtConsent?: string;
  userAgentHash?: string;
  categories?: Partial<ConsentCategories>;
  expiresInDays?: number;   // Default: 395 days (13 months — GDPR max)
}

type MemConsentRecord = {
  consentId: string;
  visitorId: string;
  workspaceId: string;
  tenantSlug: string;
  consentGiven: boolean;
  consentVersion: string;
  consentMethod: ConsentMethod;
  consentGivenAt?: Date;
  consentRevokedAt?: Date;
  isActive: boolean;
  ipHashAtConsent?: string;
  userAgentHash?: string;
  consentCategories: ConsentCategories;
  auditTrail: { action: string; timestamp: Date; metadata?: Record<string, unknown> }[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export const _memConsentRecords = new Map<string, MemConsentRecord>();
const _visitorConsentIndex = new Map<string, string>(); // `${visitorId}:${workspaceId}` → consentId

// ─── Record Consent ───────────────────────────────────────────────────────────

export async function recordConsent(
  input: RecordConsentInput
): Promise<{ record: MemConsentRecord | ConsentRecordDocument; visitorId: string }> {
  const visitorId = input.visitorId ?? makeId("vil_vis");
  const now = new Date();
  const expiresAt = input.expiresInDays !== undefined
    ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() + 395 * 24 * 60 * 60 * 1000); // 13 months default

  const categories: ConsentCategories = {
    behavioral: input.categories?.behavioral ?? input.consentGiven,
    analytics: input.categories?.analytics ?? input.consentGiven,
    marketing: input.categories?.marketing ?? false
  };

  const data: MemConsentRecord = {
    consentId: makeId("vil_con"),
    visitorId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    consentGiven: input.consentGiven,
    consentVersion: input.consentVersion ?? "1.0",
    consentMethod: input.consentMethod ?? "explicit",
    consentGivenAt: input.consentGiven ? now : undefined,
    isActive: true,
    ipHashAtConsent: input.ipHashAtConsent,
    userAgentHash: input.userAgentHash,
    consentCategories: categories,
    auditTrail: [
      {
        action: input.consentGiven ? "granted" : "revoked",
        timestamp: now,
        metadata: { consentVersion: input.consentVersion ?? "1.0", method: input.consentMethod ?? "explicit" }
      }
    ],
    expiresAt,
    createdAt: now,
    updatedAt: now
  };

  const lookupKey = `${visitorId}:${input.workspaceId}`;

  // Deactivate any previous active consent for this visitor+workspace
  const existingId = _visitorConsentIndex.get(lookupKey);
  if (existingId) {
    const existing = _memConsentRecords.get(existingId);
    if (existing) existing.isActive = false;
  }

  if (!isMongoConnected()) {
    _memConsentRecords.set(data.consentId, data);
    _visitorConsentIndex.set(lookupKey, data.consentId);
    logger.info("vil.consent.recorded", {
      consentId: data.consentId,
      visitorId,
      workspaceId: input.workspaceId,
      consentGiven: input.consentGiven,
      method: data.consentMethod
    });
    return { record: data, visitorId };
  }

  // Deactivate previous in DB
  if (existingId) {
    await ConsentRecord.updateOne({ consentId: existingId }, { $set: { isActive: false } });
  }
  const record = await ConsentRecord.create(data);
  _visitorConsentIndex.set(lookupKey, data.consentId);

  logger.info("vil.consent.recorded", {
    consentId: data.consentId,
    visitorId,
    workspaceId: input.workspaceId,
    consentGiven: input.consentGiven
  });
  return { record, visitorId };
}

// ─── Revoke Consent ───────────────────────────────────────────────────────────

export async function revokeConsent(
  visitorId: string,
  workspaceId: string,
  ipHashAtRevocation?: string
): Promise<void> {
  const lookupKey = `${visitorId}:${workspaceId}`;
  const consentId = _visitorConsentIndex.get(lookupKey);

  const now = new Date();
  const auditEntry = { action: "revoked" as const, timestamp: now, metadata: { ipHashAtRevocation } };

  if (!isMongoConnected()) {
    if (consentId) {
      const rec = _memConsentRecords.get(consentId);
      if (rec) {
        rec.consentGiven = false;
        rec.consentRevokedAt = now;
        rec.consentCategories = { behavioral: false, analytics: false, marketing: false };
        rec.auditTrail.push(auditEntry);
        rec.updatedAt = now;
      }
    }
  } else {
    if (consentId) {
      await ConsentRecord.updateOne(
        { consentId },
        {
          $set: {
            consentGiven: false,
            consentRevokedAt: now,
            consentCategories: { behavioral: false, analytics: false, marketing: false }
          },
          $push: { auditTrail: auditEntry }
        }
      );
    }
  }

  logger.info("vil.consent.revoked", { visitorId, workspaceId, consentId });
}

// ─── Upgrade Consent Version ──────────────────────────────────────────────────
// Called when the privacy policy changes and re-consent is required.

export async function upgradeConsentVersion(
  visitorId: string,
  workspaceId: string,
  newVersion: string
): Promise<boolean> {
  const lookupKey = `${visitorId}:${workspaceId}`;
  const consentId = _visitorConsentIndex.get(lookupKey);
  if (!consentId) return false;

  const auditEntry = {
    action: "version_upgraded" as const,
    timestamp: new Date(),
    metadata: { newVersion }
  };

  if (!isMongoConnected()) {
    const rec = _memConsentRecords.get(consentId);
    if (rec) {
      rec.consentVersion = newVersion;
      rec.auditTrail.push(auditEntry);
      rec.updatedAt = new Date();
    }
  } else {
    await ConsentRecord.updateOne(
      { consentId },
      { $set: { consentVersion: newVersion }, $push: { auditTrail: auditEntry } }
    );
  }
  return true;
}

// ─── Validate Consent ─────────────────────────────────────────────────────────
// The single gate for all VIL data collection.

export async function validateConsentForTracking(
  visitorId: string,
  workspaceId: string
): Promise<ConsentValidationResult> {
  const record = await getConsentRecord(visitorId, workspaceId);

  if (!record) {
    return { allowed: false, code: "CONSENT_REQUIRED", reason: "No consent record found for this visitor" };
  }

  const rec = record as Record<string, unknown>;

  const expiresAt = rec["expiresAt"] as Date | undefined;
  if (expiresAt && expiresAt < new Date()) {
    return { allowed: false, code: "CONSENT_EXPIRED", reason: "Visitor consent has expired and must be re-collected" };
  }

  if (!(rec["consentGiven"] as boolean)) {
    if (rec["consentRevokedAt"]) {
      return { allowed: false, code: "CONSENT_REVOKED", reason: "Visitor has revoked consent for behavioral tracking" };
    }
    return { allowed: false, code: "BEHAVIORAL_CONSENT_NOT_GRANTED", reason: "Visitor has not granted consent for behavioral tracking" };
  }

  const categories = rec["consentCategories"] as { behavioral: boolean } | undefined;
  if (!categories?.behavioral) {
    return {
      allowed: false,
      code: "BEHAVIORAL_CONSENT_NOT_GRANTED",
      reason: "Visitor has not granted consent for the behavioral tracking category specifically"
    };
  }

  return {
    allowed: true,
    consentId: rec["consentId"] as string,
    consentVersion: rec["consentVersion"] as string
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getConsentRecord(
  visitorId: string,
  workspaceId: string
): Promise<MemConsentRecord | ConsentRecordDocument | null> {
  if (!isMongoConnected()) {
    const key = `${visitorId}:${workspaceId}`;
    const id = _visitorConsentIndex.get(key);
    return id ? (_memConsentRecords.get(id) ?? null) : null;
  }
  return ConsentRecord.findOne({ visitorId, workspaceId, isActive: true }).sort({ createdAt: -1 }).lean();
}

export async function getConsentById(
  consentId: string
): Promise<MemConsentRecord | ConsentRecordDocument | null> {
  if (!isMongoConnected()) {
    return _memConsentRecords.get(consentId) ?? null;
  }
  return ConsentRecord.findOne({ consentId }).lean();
}

export async function listConsentRecords(
  workspaceId: string,
  opts: { consentGiven?: boolean; limit?: number; skip?: number } = {}
): Promise<{ records: (MemConsentRecord | ConsentRecordDocument)[]; total: number }> {
  const limit = opts.limit ?? 50;
  const skip = opts.skip ?? 0;

  if (!isMongoConnected()) {
    const all = [..._memConsentRecords.values()].filter((r) => {
      if (r.workspaceId !== workspaceId) return false;
      if (opts.consentGiven !== undefined && r.consentGiven !== opts.consentGiven) return false;
      return true;
    });
    return { records: all.slice(skip, skip + limit), total: all.length };
  }

  const query: Record<string, unknown> = { workspaceId };
  if (opts.consentGiven !== undefined) query["consentGiven"] = opts.consentGiven;
  const [records, total] = await Promise.all([
    ConsentRecord.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ConsentRecord.countDocuments(query)
  ]);
  return { records, total };
}

export async function getConsentSummary(workspaceId: string): Promise<{
  total: number;
  granted: number;
  revoked: number;
  expired: number;
  grantRate: number;
  byMethod: Record<string, number>;
}> {
  const now = new Date();

  if (!isMongoConnected()) {
    const all = [..._memConsentRecords.values()].filter((r) => r.workspaceId === workspaceId);
    const granted = all.filter((r) => r.consentGiven && (!r.expiresAt || r.expiresAt > now));
    const revoked = all.filter((r) => r.consentRevokedAt);
    const expired = all.filter((r) => r.expiresAt && r.expiresAt <= now);
    const byMethod: Record<string, number> = {};
    for (const r of all) {
      byMethod[r.consentMethod] = (byMethod[r.consentMethod] ?? 0) + 1;
    }
    return {
      total: all.length,
      granted: granted.length,
      revoked: revoked.length,
      expired: expired.length,
      grantRate: all.length > 0 ? Math.round((granted.length / all.length) * 100) : 0,
      byMethod
    };
  }

  const [total, granted, revoked, expired] = await Promise.all([
    ConsentRecord.countDocuments({ workspaceId }),
    ConsentRecord.countDocuments({ workspaceId, consentGiven: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    ConsentRecord.countDocuments({ workspaceId, consentRevokedAt: { $exists: true } }),
    ConsentRecord.countDocuments({ workspaceId, expiresAt: { $lte: now } })
  ]);

  const methodAgg = await ConsentRecord.aggregate([
    { $match: { workspaceId } },
    { $group: { _id: "$consentMethod", count: { $sum: 1 } } }
  ]);
  const byMethod = Object.fromEntries(methodAgg.map((r: { _id: string; count: number }) => [r._id, r.count]));

  return {
    total,
    granted,
    revoked,
    expired,
    grantRate: total > 0 ? Math.round((granted / total) * 100) : 0,
    byMethod
  };
}

// ─── Purge revoked consent data ───────────────────────────────────────────────
// Called when a visitor revokes consent — removes their behavioral event data
// while retaining the consent record itself (required for audit/compliance).

export async function purgeVisitorData(
  visitorId: string,
  workspaceId: string
): Promise<{ sessionsMarked: number; eventsMarked: number }> {
  // Import lazily to avoid circular deps
  const { VisitorSession } = await import("../models/VisitorSession.js");
  const { BehavioralEvent } = await import("../models/BehavioralEvent.js");
  const { _memVisitorSessions } = await import("./vilSessionService.js");
  const { _memBehavioralEvents } = await import("./vilEventService.js");

  if (!isMongoConnected()) {
    let sessionsMarked = 0, eventsMarked = 0;

    const sessionIds: string[] = [];
    for (const s of _memVisitorSessions.values()) {
      if (s.visitorId === visitorId && s.workspaceId === workspaceId) {
        s.status = "expired";
        sessionIds.push(s.sessionId);
        sessionsMarked++;
      }
    }
    for (const e of _memBehavioralEvents.values()) {
      if (sessionIds.includes(e.sessionId)) {
        // Mark as purged by clearing data payload
        (e as Record<string, unknown>)["data"] = { _purged: true };
        eventsMarked++;
      }
    }
    logger.info("vil.consent.purge", { visitorId, workspaceId, sessionsMarked, eventsMarked });
    return { sessionsMarked, eventsMarked };
  }

  const sessions = await VisitorSession.find({ visitorId, workspaceId }, { sessionId: 1, _id: 0 }).lean();
  const sessionIds = sessions.map((s) => s.sessionId);

  const [sessRes, evtRes] = await Promise.all([
    VisitorSession.updateMany({ visitorId, workspaceId }, { $set: { status: "expired" } }),
    BehavioralEvent.updateMany({ sessionId: { $in: sessionIds } }, { $set: { data: { _purged: true } } })
  ]);

  logger.info("vil.consent.purge", {
    visitorId,
    workspaceId,
    sessionsMarked: sessRes.modifiedCount,
    eventsMarked: evtRes.modifiedCount
  });

  return { sessionsMarked: sessRes.modifiedCount, eventsMarked: evtRes.modifiedCount };
}
