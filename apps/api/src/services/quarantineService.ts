import { isMongoConnected } from "../db/mongoose.js";
import { type QuarantineResolution, type QuarantineType, QuarantineRecord } from "../models/QuarantineRecord.js";
import { makeId, sha256, stableStringify } from "../utils/crypto.js";
import { env } from "../config/env.js";

export type { QuarantineType, QuarantineResolution };

export interface QuarantineView {
  quarantineId: string;
  quarantineType: QuarantineType;
  sourceRoute: string;
  sourceModel?: string;
  payloadHash: string;
  reason: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  resolution: QuarantineResolution;
  createdAt: Date;
}

export interface QuarantineSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byType: Record<string, number>;
}

const memoryQuarantine = new Map<string, QuarantineView & { payload: Record<string, unknown> }>();

function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= env.quarantineMaxPayloadBytes) return payload;
  return {
    _truncated: true,
    _originalBytes: serialized.length,
    _preview: serialized.slice(0, 512)
  };
}

function toView(doc: Record<string, unknown>): QuarantineView {
  return {
    quarantineId: doc.quarantineId as string,
    quarantineType: doc.quarantineType as QuarantineType,
    sourceRoute: doc.sourceRoute as string,
    sourceModel: doc.sourceModel as string | undefined,
    payloadHash: doc.payloadHash as string,
    reason: doc.reason as string,
    reviewedAt: doc.reviewedAt as Date | undefined,
    reviewedBy: doc.reviewedBy as string | undefined,
    resolution: doc.resolution as QuarantineResolution,
    createdAt: doc.createdAt as Date
  };
}

export async function quarantinePayload(input: {
  quarantineType: QuarantineType;
  sourceRoute: string;
  sourceModel?: string;
  payload: Record<string, unknown>;
  reason: string;
}): Promise<QuarantineView> {
  const payloadHash = sha256(stableStringify(input.payload)).slice(0, 32);
  const safePayload = truncatePayload(input.payload);

  if (!isMongoConnected()) {
    const quarantineId = makeId("qar");
    const view = {
      quarantineId,
      quarantineType: input.quarantineType,
      sourceRoute: input.sourceRoute,
      sourceModel: input.sourceModel,
      payloadHash,
      payload: safePayload,
      reason: input.reason,
      resolution: "pending" as QuarantineResolution,
      createdAt: new Date()
    };
    memoryQuarantine.set(quarantineId, view);
    return toView(view as unknown as Record<string, unknown>);
  }

  const quarantineId = makeId("qar");
  const doc = await QuarantineRecord.create({
    quarantineId,
    quarantineType: input.quarantineType,
    sourceRoute: input.sourceRoute,
    sourceModel: input.sourceModel,
    payloadHash,
    payload: safePayload,
    reason: input.reason,
    resolution: "pending"
  });
  return toView(doc.toObject() as unknown as Record<string, unknown>);
}

export async function resolveQuarantine(
  quarantineId: string,
  resolution: "approved" | "rejected",
  reviewedBy?: string
): Promise<QuarantineView | null> {
  if (!isMongoConnected()) {
    const record = memoryQuarantine.get(quarantineId);
    if (!record || record.resolution !== "pending") return null;
    const updated = { ...record, resolution: resolution as QuarantineResolution, reviewedAt: new Date(), reviewedBy };
    memoryQuarantine.set(quarantineId, updated);
    return toView(updated as unknown as Record<string, unknown>);
  }

  const doc = await QuarantineRecord.findOneAndUpdate(
    { quarantineId, resolution: "pending" },
    { $set: { resolution, reviewedAt: new Date(), reviewedBy: reviewedBy ?? "system" } },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function getQuarantineRecord(quarantineId: string): Promise<QuarantineView | null> {
  if (!isMongoConnected()) {
    const r = memoryQuarantine.get(quarantineId);
    return r ? toView(r as unknown as Record<string, unknown>) : null;
  }
  const doc = await QuarantineRecord.findOne({ quarantineId }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function listQuarantined(
  filter?: { quarantineType?: QuarantineType; resolution?: QuarantineResolution },
  limit = 50
): Promise<QuarantineView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryQuarantine.values()];
    if (filter?.quarantineType) results = results.filter((r) => r.quarantineType === filter.quarantineType);
    if (filter?.resolution) results = results.filter((r) => r.resolution === filter.resolution);
    return results
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => toView(r as unknown as Record<string, unknown>));
  }

  const query: Record<string, unknown> = {};
  if (filter?.quarantineType) query.quarantineType = filter.quarantineType;
  if (filter?.resolution) query.resolution = filter.resolution;

  const docs = await QuarantineRecord.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d) => toView(d as unknown as Record<string, unknown>));
}

export async function getQuarantineSummary(): Promise<QuarantineSummary> {
  if (!isMongoConnected()) {
    const all = [...memoryQuarantine.values()];
    const byType: Record<string, number> = {};
    for (const r of all) byType[r.quarantineType] = (byType[r.quarantineType] ?? 0) + 1;
    return {
      total: all.length,
      pending: all.filter((r) => r.resolution === "pending").length,
      approved: all.filter((r) => r.resolution === "approved").length,
      rejected: all.filter((r) => r.resolution === "rejected").length,
      byType
    };
  }

  const [total, pending, approved, rejected, byTypeAgg] = await Promise.all([
    QuarantineRecord.countDocuments({}),
    QuarantineRecord.countDocuments({ resolution: "pending" }),
    QuarantineRecord.countDocuments({ resolution: "approved" }),
    QuarantineRecord.countDocuments({ resolution: "rejected" }),
    QuarantineRecord.aggregate([{ $group: { _id: "$quarantineType", count: { $sum: 1 } } }])
  ]);

  const byType: Record<string, number> = {};
  for (const entry of byTypeAgg) byType[entry._id as string] = entry.count as number;

  return { total, pending, approved, rejected, byType };
}
