import { isMongoConnected } from "../db/mongoose.js";
import { type HoldScope, type HoldStatus, LegalHoldRecord } from "../models/LegalHoldRecord.js";
import { makeId } from "../utils/crypto.js";

export type { HoldScope, HoldStatus };

export interface LegalHoldView {
  holdId: string;
  holdKey: string;
  scope: HoldScope;
  targetId: string;
  reason: string;
  heldAt: Date;
  releasedAt?: Date;
  status: HoldStatus;
  createdBy: string;
}

const memoryHolds = new Map<string, LegalHoldView>();
const memoryKeyIndex = new Map<string, string>();

function toView(doc: Record<string, unknown>): LegalHoldView {
  return {
    holdId: doc.holdId as string,
    holdKey: doc.holdKey as string,
    scope: doc.scope as HoldScope,
    targetId: doc.targetId as string,
    reason: doc.reason as string,
    heldAt: doc.heldAt as Date,
    releasedAt: doc.releasedAt as Date | undefined,
    status: doc.status as HoldStatus,
    createdBy: doc.createdBy as string
  };
}

export async function placeHold(input: {
  scope: HoldScope;
  targetId: string;
  reason: string;
  createdBy: string;
}): Promise<LegalHoldView> {
  const holdKey = `${input.scope}:${input.targetId}`;

  if (!isMongoConnected()) {
    const existing = memoryKeyIndex.get(holdKey);
    if (existing) {
      const view = memoryHolds.get(existing);
      if (view && view.status === "active") return view;
    }
    const holdId = makeId("hold");
    const view: LegalHoldView = {
      holdId,
      holdKey,
      scope: input.scope,
      targetId: input.targetId,
      reason: input.reason,
      heldAt: new Date(),
      status: "active",
      createdBy: input.createdBy
    };
    memoryHolds.set(holdId, view);
    memoryKeyIndex.set(holdKey, holdId);
    return view;
  }

  const existing = await LegalHoldRecord.findOne({ holdKey, status: "active" }).lean();
  if (existing) return toView(existing as unknown as Record<string, unknown>);

  const holdId = makeId("hold");
  const doc = await LegalHoldRecord.create({
    holdId,
    holdKey,
    scope: input.scope,
    targetId: input.targetId,
    reason: input.reason,
    heldAt: new Date(),
    status: "active",
    createdBy: input.createdBy
  });
  return toView(doc.toObject() as unknown as Record<string, unknown>);
}

export async function releaseHold(holdId: string): Promise<LegalHoldView | null> {
  if (!isMongoConnected()) {
    const view = memoryHolds.get(holdId);
    if (!view || view.status !== "active") return null;
    const updated = { ...view, status: "released" as HoldStatus, releasedAt: new Date() };
    memoryHolds.set(holdId, updated);
    return updated;
  }

  const doc = await LegalHoldRecord.findOneAndUpdate(
    { holdId, status: "active" },
    { $set: { status: "released", releasedAt: new Date() } },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function getHold(holdId: string): Promise<LegalHoldView | null> {
  if (!isMongoConnected()) return memoryHolds.get(holdId) ?? null;
  const doc = await LegalHoldRecord.findOne({ holdId }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function listHolds(
  filter?: { status?: HoldStatus; scope?: HoldScope },
  limit = 100
): Promise<LegalHoldView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryHolds.values()];
    if (filter?.status) results = results.filter((h) => h.status === filter.status);
    if (filter?.scope) results = results.filter((h) => h.scope === filter.scope);
    return results.sort((a, b) => b.heldAt.getTime() - a.heldAt.getTime()).slice(0, limit);
  }

  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.scope) query.scope = filter.scope;

  const docs = await LegalHoldRecord.find(query).sort({ heldAt: -1 }).limit(limit).lean();
  return docs.map((d) => toView(d as unknown as Record<string, unknown>));
}

/**
 * Returns the set of targetIds from candidates that are under an active legal hold.
 * Checks both individual holds (scope = recordScope) and cascade holds (tenant/workspace level).
 */
export async function findHeldIds(
  recordScope: HoldScope,
  candidates: Array<{ targetId: string; tenantSlug?: string; workspaceId?: string }>
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();

  if (!isMongoConnected()) {
    const held = new Set<string>();
    for (const c of candidates) {
      const key = `${recordScope}:${c.targetId}`;
      const holdId = memoryKeyIndex.get(key);
      if (holdId && memoryHolds.get(holdId)?.status === "active") {
        held.add(c.targetId);
        continue;
      }
      if (c.tenantSlug) {
        const tenantKey = `tenant:${c.tenantSlug}`;
        const tenantHoldId = memoryKeyIndex.get(tenantKey);
        if (tenantHoldId && memoryHolds.get(tenantHoldId)?.status === "active") {
          held.add(c.targetId);
          continue;
        }
      }
      if (c.workspaceId) {
        const wsKey = `workspace:${c.workspaceId}`;
        const wsHoldId = memoryKeyIndex.get(wsKey);
        if (wsHoldId && memoryHolds.get(wsHoldId)?.status === "active") {
          held.add(c.targetId);
        }
      }
    }
    return held;
  }

  const targetIds = candidates.map((c) => c.targetId);
  const tenantSlugs = [...new Set(candidates.flatMap((c) => c.tenantSlug ? [c.tenantSlug] : []))];
  const workspaceIds = [...new Set(candidates.flatMap((c) => c.workspaceId ? [c.workspaceId] : []))];

  const [directHolds, tenantHolds, wsHolds] = await Promise.all([
    LegalHoldRecord.find({ scope: recordScope, targetId: { $in: targetIds }, status: "active" }).select("targetId").lean(),
    tenantSlugs.length
      ? LegalHoldRecord.find({ scope: "tenant", targetId: { $in: tenantSlugs }, status: "active" }).select("targetId").lean()
      : Promise.resolve([]),
    workspaceIds.length
      ? LegalHoldRecord.find({ scope: "workspace", targetId: { $in: workspaceIds }, status: "active" }).select("targetId").lean()
      : Promise.resolve([])
  ]);

  const heldTenants = new Set(tenantHolds.map((h) => (h as unknown as Record<string, unknown>).targetId as string));
  const heldWorkspaces = new Set(wsHolds.map((h) => (h as unknown as Record<string, unknown>).targetId as string));
  const directlyHeld = new Set(directHolds.map((h) => (h as unknown as Record<string, unknown>).targetId as string));

  const result = new Set<string>();
  for (const c of candidates) {
    if (
      directlyHeld.has(c.targetId) ||
      (c.tenantSlug && heldTenants.has(c.tenantSlug)) ||
      (c.workspaceId && heldWorkspaces.has(c.workspaceId))
    ) {
      result.add(c.targetId);
    }
  }
  return result;
}

export async function isHeld(scope: HoldScope, targetId: string): Promise<boolean> {
  if (!isMongoConnected()) {
    const key = `${scope}:${targetId}`;
    const holdId = memoryKeyIndex.get(key);
    return !!(holdId && memoryHolds.get(holdId)?.status === "active");
  }
  const count = await LegalHoldRecord.countDocuments({ scope, targetId, status: "active" });
  return count > 0;
}
