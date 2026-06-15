import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isMongoConnected } from "../db/mongoose.js";
import { AuthAuditLog } from "../models/AuthAuditLog.js";
import { AuthUser } from "../models/AuthUser.js";
import { BenchmarkRecord } from "../models/BenchmarkRecord.js";
import { ComplianceExportRecord, type ExportStatus, type ExportType } from "../models/ComplianceExportRecord.js";
import { IntelligenceEvent } from "../models/IntelligenceEvent.js";
import { OperationalControlRecord } from "../models/OperationalControlRecord.js";
import { Snapshot } from "../models/Snapshot.js";
import { makeId } from "../utils/crypto.js";
import { isHeld } from "./legalHoldService.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export type { ExportType, ExportStatus };

export interface ComplianceExportView {
  exportId: string;
  exportType: ExportType;
  requestedBy: string;
  scope: "workspace" | "tenant" | "user";
  targetId: string;
  status: ExportStatus;
  recordsIncluded: number;
  exportPath?: string;
  requestedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
  errorMessage?: string;
  notes?: string;
}

const memoryExports = new Map<string, ComplianceExportView>();

function toView(doc: Record<string, unknown>): ComplianceExportView {
  return {
    exportId: doc.exportId as string,
    exportType: doc.exportType as ExportType,
    requestedBy: doc.requestedBy as string,
    scope: doc.scope as "workspace" | "tenant" | "user",
    targetId: doc.targetId as string,
    status: doc.status as ExportStatus,
    recordsIncluded: doc.recordsIncluded as number,
    exportPath: doc.exportPath as string | undefined,
    requestedAt: (doc.requestedAt as Date) ?? (doc.createdAt as Date),
    completedAt: doc.completedAt as Date | undefined,
    expiresAt: doc.expiresAt as Date | undefined,
    errorMessage: doc.errorMessage as string | undefined,
    notes: doc.notes as string | undefined
  };
}

export async function requestExport(input: {
  exportType: ExportType;
  requestedBy: string;
  scope: "workspace" | "tenant" | "user";
  targetId: string;
  notes?: string;
}): Promise<ComplianceExportView> {
  const exportId = makeId("exp");
  const requestedAt = new Date();
  // GDPR exports expire 30 days after completion
  const expiresAt = new Date(requestedAt.getTime() + 30 * 24 * 3600 * 1000);

  if (!isMongoConnected()) {
    const view: ComplianceExportView = {
      exportId,
      exportType: input.exportType,
      requestedBy: input.requestedBy,
      scope: input.scope,
      targetId: input.targetId,
      status: "pending",
      recordsIncluded: 0,
      requestedAt,
      expiresAt,
      notes: input.notes
    };
    memoryExports.set(exportId, view);
    return view;
  }

  const doc = await ComplianceExportRecord.create({
    exportId,
    exportType: input.exportType,
    requestedBy: input.requestedBy,
    scope: input.scope,
    targetId: input.targetId,
    status: "pending",
    recordsIncluded: 0,
    requestedAt,
    expiresAt,
    notes: input.notes
  });
  return toView(doc.toObject() as unknown as Record<string, unknown>);
}

export async function getExport(exportId: string): Promise<ComplianceExportView | null> {
  if (!isMongoConnected()) return memoryExports.get(exportId) ?? null;
  const doc = await ComplianceExportRecord.findOne({ exportId }).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function listExports(
  filter?: { status?: ExportStatus; exportType?: ExportType; scope?: string },
  limit = 50
): Promise<ComplianceExportView[]> {
  if (!isMongoConnected()) {
    let results = [...memoryExports.values()];
    if (filter?.status) results = results.filter((e) => e.status === filter.status);
    if (filter?.exportType) results = results.filter((e) => e.exportType === filter.exportType);
    return results.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()).slice(0, limit);
  }
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.exportType) query.exportType = filter.exportType;
  if (filter?.scope) query.scope = filter.scope;
  const docs = await ComplianceExportRecord.find(query).sort({ requestedAt: -1 }).limit(limit).lean();
  return docs.map((d) => toView(d as unknown as Record<string, unknown>));
}

async function persistResult(
  exportId: string,
  status: ExportStatus,
  recordsIncluded: number,
  exportPath?: string,
  errorMessage?: string
): Promise<ComplianceExportView | null> {
  if (!isMongoConnected()) {
    const existing = memoryExports.get(exportId);
    if (!existing) return null;
    const updated: ComplianceExportView = {
      ...existing,
      status,
      recordsIncluded,
      exportPath,
      completedAt: status === "completed" ? new Date() : undefined,
      errorMessage
    };
    memoryExports.set(exportId, updated);
    return updated;
  }
  const doc = await ComplianceExportRecord.findOneAndUpdate(
    { exportId },
    {
      $set: {
        status,
        recordsIncluded,
        ...(exportPath ? { exportPath } : {}),
        ...(status === "completed" ? { completedAt: new Date() } : {}),
        ...(errorMessage ? { errorMessage } : {})
      }
    },
    { new: true }
  ).lean();
  return doc ? toView(doc as unknown as Record<string, unknown>) : null;
}

export async function processExport(exportId: string): Promise<ComplianceExportView> {
  const record = await getExport(exportId);
  if (!record) throw new Error(`Export ${exportId} not found.`);
  if (record.status !== "pending") throw new Error(`Export ${exportId} is already in status "${record.status}".`);

  // Mark processing
  await persistResult(exportId, "processing", 0);

  try {
    let data: Record<string, unknown> = {};
    let recordsIncluded = 0;

    switch (record.exportType) {
      case "gdpr_portability":
        ({ data, recordsIncluded } = await collectPortabilityData(record.scope, record.targetId));
        break;
      case "gdpr_erasure":
        ({ recordsIncluded } = await performErasure(record.scope, record.targetId));
        data = { erased: true, recordsErased: recordsIncluded };
        break;
      case "soc2_audit":
        ({ data, recordsIncluded } = await collectSoc2AuditData(record.targetId));
        break;
      case "custom":
        ({ data, recordsIncluded } = await collectCustomData(record.scope, record.targetId));
        break;
    }

    let exportPath: string | undefined;
    if (env.complianceExportDir) {
      try {
        await mkdir(env.complianceExportDir, { recursive: true });
        const filePath = join(env.complianceExportDir, `${exportId}.json`);
        await writeFile(filePath, JSON.stringify({ exportId, exportType: record.exportType, scope: record.scope, targetId: record.targetId, exportedAt: new Date().toISOString(), data }, null, 2), "utf-8");
        exportPath = filePath;
      } catch (err) {
        logger.warn("compliance_export.write_failed", { exportId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const result = await persistResult(exportId, "completed", recordsIncluded, exportPath);
    return result!;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("compliance_export.failed", { exportId, error: errorMessage });
    const result = await persistResult(exportId, "failed", 0, undefined, errorMessage);
    return result!;
  }
}

async function collectPortabilityData(
  scope: "workspace" | "tenant" | "user",
  targetId: string
): Promise<{ data: Record<string, unknown>; recordsIncluded: number }> {
  if (!isMongoConnected()) return { data: { note: "Memory mode — no persisted records" }, recordsIncluded: 0 };

  const data: Record<string, unknown> = {};
  let count = 0;

  if (scope === "tenant") {
    const [snapshots, benchmarks, events] = await Promise.all([
      Snapshot.find({ tenantSlug: targetId }).limit(1000).lean(),
      BenchmarkRecord.find({ tenantSlug: targetId }).limit(1000).lean(),
      IntelligenceEvent.find({ workspaceId: { $regex: new RegExp(`^${targetId}:`) } }).limit(500).lean()
    ]);
    data.snapshots = snapshots;
    data.benchmarks = benchmarks;
    data.events = events;
    count = snapshots.length + benchmarks.length + events.length;
  } else if (scope === "user") {
    const [user, auditLogs] = await Promise.all([
      AuthUser.findOne({ userId: targetId }).lean(),
      AuthAuditLog.find({ identifier: targetId }).limit(500).lean()
    ]);
    data.user = user;
    data.auditLogs = auditLogs;
    count = (user ? 1 : 0) + auditLogs.length;
  } else {
    // workspace — collect snapshots matching workspaceId pattern
    const events = await IntelligenceEvent.find({ workspaceId: targetId }).limit(500).lean();
    data.events = events;
    count = events.length;
  }

  return { data, recordsIncluded: count };
}

async function performErasure(
  scope: "workspace" | "tenant" | "user",
  targetId: string
): Promise<{ recordsIncluded: number }> {
  if (!isMongoConnected()) return { recordsIncluded: 0 };

  // Block erasure if a legal hold covers this scope:targetId
  const held = await isHeld(scope === "tenant" ? "tenant" : scope === "user" ? "user" : "workspace", targetId);
  if (held) throw new Error(`Erasure blocked: an active legal hold covers ${scope}:${targetId}.`);

  let count = 0;

  if (scope === "user") {
    const [u, al] = await Promise.all([
      AuthUser.deleteOne({ userId: targetId }),
      AuthAuditLog.deleteMany({ identifier: targetId })
    ]);
    count = (u.deletedCount ?? 0) + (al.deletedCount ?? 0);
  } else if (scope === "tenant") {
    const [s, b] = await Promise.all([
      Snapshot.deleteMany({ tenantSlug: targetId }),
      BenchmarkRecord.deleteMany({ tenantSlug: targetId })
    ]);
    count = (s.deletedCount ?? 0) + (b.deletedCount ?? 0);
  } else {
    const ev = await IntelligenceEvent.deleteMany({ workspaceId: targetId });
    count = ev.deletedCount ?? 0;
  }

  return { recordsIncluded: count };
}

async function collectSoc2AuditData(
  targetId: string
): Promise<{ data: Record<string, unknown>; recordsIncluded: number }> {
  if (!isMongoConnected()) return { data: { note: "Memory mode — no persisted records" }, recordsIncluded: 0 };

  const [auditLogs, controls] = await Promise.all([
    AuthAuditLog.find({}).sort({ createdAt: -1 }).limit(1000).lean(),
    OperationalControlRecord.find({}).sort({ createdAt: -1 }).limit(500).lean()
  ]);

  return {
    data: { auditLogs, controls, targetId },
    recordsIncluded: auditLogs.length + controls.length
  };
}

async function collectCustomData(
  scope: "workspace" | "tenant" | "user",
  targetId: string
): Promise<{ data: Record<string, unknown>; recordsIncluded: number }> {
  return collectPortabilityData(scope, targetId);
}
