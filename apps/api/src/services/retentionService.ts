import { isMongoConnected } from "../db/mongoose.js";
import { AuthAuditLog } from "../models/AuthAuditLog.js";
import { EventDeliveryRecord } from "../models/EventDeliveryRecord.js";
import { IntelligenceEvent } from "../models/IntelligenceEvent.js";
import { OperationalControlRecord } from "../models/OperationalControlRecord.js";
import { PlatformAlert } from "../models/PlatformAlertRecord.js";
import { type RetentionAction, type RetentionRecordType, RetentionPolicyRecord } from "../models/RetentionPolicyRecord.js";
import { Snapshot } from "../models/Snapshot.js";
import { makeId } from "../utils/crypto.js";
import { env } from "../config/env.js";
import { findHeldIds } from "./legalHoldService.js";
import { logger } from "../utils/logger.js";

export type { RetentionRecordType, RetentionAction };

export interface RetentionPolicyView {
  policyId: string;
  recordType: RetentionRecordType;
  retentionDays: number;
  archiveDays?: number;
  action: RetentionAction;
  scope: "global" | "tenant" | "workspace";
  tenantSlug?: string;
  workspaceId?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetentionJobResult {
  jobId: string;
  startedAt: Date;
  completedAt: Date;
  policiesApplied: number;
  recordsEvaluated: number;
  recordsPurged: number;
  recordsArchived: number;
  recordsSkipped: number;
  errors: string[];
}

const memoryPolicies = new Map<string, RetentionPolicyView>();

function toView(doc: Record<string, unknown>): RetentionPolicyView {
  return {
    policyId: doc.policyId as string,
    recordType: doc.recordType as RetentionRecordType,
    retentionDays: doc.retentionDays as number,
    archiveDays: doc.archiveDays as number | undefined,
    action: doc.action as RetentionAction,
    scope: doc.scope as "global" | "tenant" | "workspace",
    tenantSlug: doc.tenantSlug as string | undefined,
    workspaceId: doc.workspaceId as string | undefined,
    enabled: doc.enabled as boolean,
    createdAt: doc.createdAt as Date,
    updatedAt: (doc.updatedAt as Date) ?? (doc.createdAt as Date)
  };
}

export async function upsertRetentionPolicy(input: {
  policyId?: string;
  recordType: RetentionRecordType;
  retentionDays: number;
  archiveDays?: number;
  action?: RetentionAction;
  scope?: "global" | "tenant" | "workspace";
  tenantSlug?: string;
  workspaceId?: string;
  enabled?: boolean;
}): Promise<RetentionPolicyView> {
  const policyId = input.policyId ?? makeId("rp");
  const policy: RetentionPolicyView = {
    policyId,
    recordType: input.recordType,
    retentionDays: input.retentionDays,
    archiveDays: input.archiveDays,
    action: input.action ?? "purge",
    scope: input.scope ?? "global",
    tenantSlug: input.tenantSlug,
    workspaceId: input.workspaceId,
    enabled: input.enabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  if (!isMongoConnected()) {
    memoryPolicies.set(policyId, policy);
    return policy;
  }

  const doc = await RetentionPolicyRecord.findOneAndUpdate(
    { policyId },
    { $set: { ...policy } },
    { upsert: true, new: true }
  ).lean();
  return toView(doc as unknown as Record<string, unknown>);
}

export async function listRetentionPolicies(filter?: { recordType?: RetentionRecordType; enabled?: boolean }): Promise<RetentionPolicyView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryPolicies.values()];
    if (filter?.recordType) results = results.filter((p) => p.recordType === filter.recordType);
    if (filter?.enabled !== undefined) results = results.filter((p) => p.enabled === filter.enabled);
    return results;
  }
  const query: Record<string, unknown> = {};
  if (filter?.recordType) query.recordType = filter.recordType;
  if (filter?.enabled !== undefined) query.enabled = filter.enabled;
  const docs = await RetentionPolicyRecord.find(query).lean();
  return docs.map((d) => toView(d as unknown as Record<string, unknown>));
}

export async function getRetentionPolicy(policyId: string): Promise<RetentionPolicyView | null> {
  if (!isMongoConnected()) return memoryPolicies.get(policyId) ?? null;
  const doc = await RetentionPolicyRecord.findOne({ policyId }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function deleteRetentionPolicy(policyId: string): Promise<boolean> {
  if (!isMongoConnected()) return memoryPolicies.delete(policyId);
  const result = await RetentionPolicyRecord.deleteOne({ policyId });
  return (result.deletedCount ?? 0) > 0;
}

// ── Core retention job ─────────────────────────────────────────────────────────

async function applyPolicyToCollection(
  policy: RetentionPolicyView,
  batchSize: number
): Promise<{ evaluated: number; purged: number; archived: number; skipped: number; errors: string[] }> {
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 3600 * 1000);
  const result = { evaluated: 0, purged: 0, archived: 0, skipped: 0, errors: [] as string[] };

  // Determine archive cutoff: records between retentionDays and archiveDays are candidates
  // Records older than archiveDays are purged (if archiveDays is set)
  // For simplicity: if action=archive, log IDs then purge; if action=purge, just purge
  const scopeQuery: Record<string, unknown> = { createdAt: { $lt: cutoff } };
  if (policy.scope === "tenant" && policy.tenantSlug) scopeQuery.tenantSlug = policy.tenantSlug;
  if (policy.scope === "workspace" && policy.workspaceId) scopeQuery.workspaceId = policy.workspaceId;

  try {
    let candidateIds: Array<{ id: string; tenantSlug?: string; workspaceId?: string }> = [];

    switch (policy.recordType) {
      case "snapshot": {
        const docs = await Snapshot.find(scopeQuery).select("snapshotId tenantSlug").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: d.snapshotId, tenantSlug: d.tenantSlug }));
        break;
      }
      case "intelligence_event": {
        const docs = await IntelligenceEvent.find(scopeQuery).select("eventId workspaceId").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: d.eventId as string, workspaceId: d.workspaceId as string | undefined }));
        break;
      }
      case "auth_audit_log": {
        const docs = await AuthAuditLog.find(scopeQuery).select("auditId").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: (d as unknown as Record<string, unknown>).auditId as string }));
        break;
      }
      case "event_delivery": {
        const deliveredCutoff = { ...scopeQuery, status: { $in: ["delivered", "dead_letter"] } };
        const docs = await EventDeliveryRecord.find(deliveredCutoff).select("deliveryId").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: (d as unknown as Record<string, unknown>).deliveryId as string }));
        break;
      }
      case "platform_alert": {
        const resolvedCutoff = { ...scopeQuery, status: "resolved" };
        const docs = await PlatformAlert.find(resolvedCutoff).select("alertId").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: (d as unknown as Record<string, unknown>).alertId as string }));
        break;
      }
      case "analytics_warehouse": {
        const docs = await OperationalControlRecord.find({ controlType: "observability", ...scopeQuery }).select("recordId").limit(batchSize).lean();
        candidateIds = docs.map((d) => ({ id: d.recordId }));
        break;
      }
      default:
        return result;
    }

    result.evaluated = candidateIds.length;
    if (candidateIds.length === 0) return result;

    // Check for legal holds
    const scopeForHold = policy.recordType === "snapshot" ? "snapshot" :
      policy.recordType === "intelligence_event" ? "intelligence_event" : "snapshot";

    const heldIds = await findHeldIds(scopeForHold as import("../models/LegalHoldRecord.js").HoldScope, candidateIds.map((c) => ({
      targetId: c.id,
      tenantSlug: c.tenantSlug,
      workspaceId: c.workspaceId
    })));

    const toDelete = candidateIds.filter((c) => !heldIds.has(c.id)).map((c) => c.id);
    result.skipped = heldIds.size;

    if (toDelete.length === 0) return result;

    // Archive: log IDs in OperationalControlRecord before deletion
    if (policy.action === "archive") {
      await OperationalControlRecord.create({
        recordId: makeId("ret"),
        controlType: "retention_job",
        status: "informational",
        scope: `${policy.recordType}:${policy.policyId}`,
        score: undefined,
        payload: {
          policyId: policy.policyId,
          action: "archive",
          recordType: policy.recordType,
          archivedIds: toDelete.slice(0, 200),
          totalArchived: toDelete.length,
          archivedAt: new Date().toISOString()
        }
      }).catch(() => undefined);
      result.archived = toDelete.length;
    }

    // Purge from source collection
    switch (policy.recordType) {
      case "snapshot":
        await Snapshot.deleteMany({ snapshotId: { $in: toDelete } });
        break;
      case "intelligence_event":
        await IntelligenceEvent.deleteMany({ eventId: { $in: toDelete } });
        break;
      case "auth_audit_log":
        await AuthAuditLog.deleteMany({ auditId: { $in: toDelete } });
        break;
      case "event_delivery":
        await EventDeliveryRecord.deleteMany({ deliveryId: { $in: toDelete } });
        break;
      case "platform_alert":
        await PlatformAlert.deleteMany({ alertId: { $in: toDelete } });
        break;
      case "analytics_warehouse":
        await OperationalControlRecord.deleteMany({ recordId: { $in: toDelete } });
        break;
    }

    if (policy.action === "purge") result.purged = toDelete.length;
    else result.purged = toDelete.length;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Policy ${policy.policyId} (${policy.recordType}): ${msg}`);
    logger.warn("retention_service.policy_error", { policyId: policy.policyId, error: msg });
  }

  return result;
}

export async function runRetentionJob(options?: {
  policyId?: string;
  batchSize?: number;
}): Promise<RetentionJobResult> {
  const jobId = makeId("retjob");
  const startedAt = new Date();
  const batchSize = options?.batchSize ?? env.retentionWorkerBatchSize;

  const result: RetentionJobResult = {
    jobId,
    startedAt,
    completedAt: new Date(),
    policiesApplied: 0,
    recordsEvaluated: 0,
    recordsPurged: 0,
    recordsArchived: 0,
    recordsSkipped: 0,
    errors: []
  };

  if (!isMongoConnected()) {
    result.completedAt = new Date();
    return result;
  }

  const policies = options?.policyId
    ? (await getRetentionPolicy(options.policyId) ? [await getRetentionPolicy(options.policyId)!] : [])
    : await listRetentionPolicies({ enabled: true });

  for (const policy of policies) {
    if (!policy) continue;
    const r = await applyPolicyToCollection(policy, batchSize);
    result.policiesApplied++;
    result.recordsEvaluated += r.evaluated;
    result.recordsPurged += r.purged;
    result.recordsArchived += r.archived;
    result.recordsSkipped += r.skipped;
    result.errors.push(...r.errors);
  }

  result.completedAt = new Date();

  // Log the overall job result
  await OperationalControlRecord.create({
    recordId: makeId("retlog"),
    controlType: "retention_job",
    status: result.errors.length === 0 ? "passing" : "warning",
    scope: "global",
    score: undefined,
    payload: {
      jobId,
      policiesApplied: result.policiesApplied,
      recordsEvaluated: result.recordsEvaluated,
      recordsPurged: result.recordsPurged,
      recordsArchived: result.recordsArchived,
      recordsSkipped: result.recordsSkipped,
      errors: result.errors,
      durationMs: result.completedAt.getTime() - result.startedAt.getTime()
    }
  }).catch(() => undefined);

  logger.info("retention_job.completed", {
    jobId,
    policiesApplied: result.policiesApplied,
    recordsPurged: result.recordsPurged,
    recordsSkipped: result.recordsSkipped
  });

  return result;
}

export async function getRetentionStatus(): Promise<{
  policiesEnabled: number;
  lastJobAt?: Date;
  lastJobResult?: Record<string, unknown>;
}> {
  if (!isMongoConnected()) {
    return { policiesEnabled: memoryPolicies.size };
  }
  const [enabled, lastLog] = await Promise.all([
    RetentionPolicyRecord.countDocuments({ enabled: true }),
    OperationalControlRecord.findOne({ controlType: "retention_job", scope: "global" }).sort({ createdAt: -1 }).lean()
  ]);
  return {
    policiesEnabled: enabled,
    lastJobAt: lastLog?.createdAt,
    lastJobResult: lastLog?.payload as Record<string, unknown> | undefined
  };
}
