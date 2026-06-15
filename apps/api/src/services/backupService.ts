import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { BackupRecord, type BackupRecordDocument, type BackupStatus, type BackupTrigger, type VerificationStatus } from "../models/BackupRecord.js";
import { makeId } from "../utils/crypto.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BackupView {
  backupId: string;
  status: BackupStatus;
  trigger: BackupTrigger;
  mode: "full" | "collections";
  collections: string[];
  sizeBytes: number;
  fileCount: number;
  backupPath: string;
  durationMs: number;
  errorMessage?: string;
  verifiedAt?: Date;
  verificationStatus?: VerificationStatus;
  verificationDetails?: Record<string, unknown>;
  completedAt?: Date;
  createdAt: Date;
}

export interface BackupStatusSummary {
  overallStatus: "healthy" | "warning" | "critical" | "unknown";
  lastBackupAt: Date | null;
  lastBackupId: string | null;
  lastBackupStatus: BackupStatus | null;
  lastVerifiedAt: Date | null;
  backupCount: number;
  rpoActualMinutes: number | null;
  rpoTargetMinutes: number;
  rtoTargetMinutes: number;
  recentBackups: BackupView[];
}

// In-memory fallback for when MongoDB is not available
const memoryBackups = new Map<string, BackupView>();

// ── Public service API ─────────────────────────────────────────────────────────

export async function runBackup(options: {
  trigger: BackupTrigger;
  collections?: string[];
}): Promise<BackupView> {
  const backupId = makeId("bkp");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(env.backupDir, `${timestamp}-${backupId}`);
  const mongoUriHash = hashUri(env.mongoUri ?? "");
  const mode = options.collections && options.collections.length > 0 ? "collections" : "full";
  const targetCollections = options.collections ?? parseCollectionsEnv();

  const record: BackupView = {
    backupId,
    status: "running",
    trigger: options.trigger,
    mode,
    collections: targetCollections,
    sizeBytes: 0,
    fileCount: 0,
    backupPath,
    durationMs: 0,
    createdAt: new Date()
  };

  await saveBackupRecord(record);
  const startedAt = Date.now();

  try {
    await fs.mkdir(backupPath, { recursive: true });
    await runMongodump(backupPath, targetCollections);

    const { sizeBytes, fileCount, collections } = await inspectDumpDir(backupPath);
    const durationMs = Date.now() - startedAt;
    const completedAt = new Date();

    const updated: BackupView = {
      ...record,
      status: "completed",
      collections: collections.length > 0 ? collections : record.collections,
      sizeBytes,
      fileCount,
      durationMs,
      completedAt
    };

    await writeManifest(backupPath, updated);
    await updateBackupRecord(backupId, {
      status: "completed",
      collections: updated.collections,
      sizeBytes,
      fileCount,
      durationMs,
      completedAt
    });
    await pruneOldBackups();
    return updated;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    const failed: BackupView = { ...record, status: "failed", errorMessage, durationMs };
    await updateBackupRecord(backupId, { status: "failed", errorMessage, durationMs });
    return failed;
  }
}

export async function verifyBackup(backupId: string): Promise<BackupView> {
  const record = await getBackupRecord(backupId);
  if (!record) throw new BackupError(404, `Backup ${backupId} not found.`);
  if (record.status === "running") throw new BackupError(409, "Backup is still in progress.");

  const details: Record<string, unknown> = {};
  let pass = true;

  // 1. Verify backup directory exists
  try {
    const stat = await fs.stat(record.backupPath);
    details["directoryExists"] = stat.isDirectory();
    if (!stat.isDirectory()) pass = false;
  } catch {
    details["directoryExists"] = false;
    pass = false;
  }

  // 2. Verify manifest file
  try {
    const manifest = await readManifest(record.backupPath);
    details["manifestValid"] = Boolean(manifest?.backupId);
    details["manifestBackupId"] = manifest?.backupId;
    if (manifest?.backupId !== backupId) pass = false;
  } catch {
    details["manifestValid"] = false;
    pass = false;
  }

  // 3. Verify dump files exist and have non-zero size
  try {
    const { sizeBytes, fileCount, collections } = await inspectDumpDir(record.backupPath);
    details["dumpSizeBytes"] = sizeBytes;
    details["dumpFileCount"] = fileCount;
    details["collectionsDumped"] = collections;
    if (fileCount === 0 || sizeBytes === 0) pass = false;
  } catch {
    details["dumpFileCount"] = 0;
    pass = false;
  }

  const verificationStatus: VerificationStatus = pass ? "pass" : "fail";
  const verifiedAt = new Date();
  const newStatus: BackupStatus = pass ? "verified" : "verification_failed";

  await updateBackupRecord(backupId, { status: newStatus, verificationStatus, verifiedAt, verificationDetails: details });

  return { ...record, status: newStatus, verificationStatus, verifiedAt, verificationDetails: details };
}

export async function listBackupRecords(limit = 20): Promise<BackupView[]> {
  if (!isMongoConnected()) {
    return Array.from(memoryBackups.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  const docs = await BackupRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((doc) => docToView(doc as unknown as Record<string, unknown>));
}

export async function getBackupRecord(backupId: string): Promise<BackupView | null> {
  if (!isMongoConnected()) return memoryBackups.get(backupId) ?? null;
  const doc = await BackupRecord.findOne({ backupId }).lean();
  return doc ? docToView(doc as unknown as Record<string, unknown>) : null;
}

export async function getBackupStatusSummary(): Promise<BackupStatusSummary> {
  const recent = await listBackupRecords(10);
  const lastCompleted = recent.find((b) => b.status === "completed" || b.status === "verified");
  const lastVerified = recent.find((b) => b.status === "verified");

  const rpoTargetMinutes = 60;
  const rtoTargetMinutes = 240;

  let rpoActualMinutes: number | null = null;
  if (lastCompleted?.completedAt) {
    rpoActualMinutes = Math.round((Date.now() - new Date(lastCompleted.completedAt).getTime()) / 60_000);
  }

  let overallStatus: BackupStatusSummary["overallStatus"] = "unknown";
  if (recent.length === 0) {
    overallStatus = "unknown";
  } else if (rpoActualMinutes === null || rpoActualMinutes > rpoTargetMinutes * 48) {
    overallStatus = "critical";
  } else if (rpoActualMinutes > rpoTargetMinutes * 25) {
    overallStatus = "warning";
  } else {
    overallStatus = "healthy";
  }

  return {
    overallStatus,
    lastBackupAt: lastCompleted?.completedAt ? new Date(lastCompleted.completedAt) : null,
    lastBackupId: lastCompleted?.backupId ?? null,
    lastBackupStatus: lastCompleted?.status ?? null,
    lastVerifiedAt: lastVerified?.verifiedAt ? new Date(lastVerified.verifiedAt) : null,
    backupCount: recent.length,
    rpoActualMinutes,
    rpoTargetMinutes,
    rtoTargetMinutes,
    recentBackups: recent
  };
}

// ── BackupError ────────────────────────────────────────────────────────────────

export class BackupError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BackupError";
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function runMongodump(outputDir: string, collections: string[]): Promise<void> {
  const mongoUri = env.mongoUri;
  if (!mongoUri) throw new Error("MONGODB_URI is not configured — cannot run backup.");

  const args: string[] = [`--uri=${mongoUri}`, `--out=${outputDir}`, "--gzip"];

  if (collections.length > 0) {
    for (const col of collections) {
      const parts = col.includes(".") ? col.split(".") : ["systolab", col];
      args.push(`--db=${parts[0] ?? "systolab"}`, `--collection=${parts[1] ?? col}`);
    }
  }

  const mongodumpPath = env.backupMongodumpPath;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(mongodumpPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: string[] = [];

    proc.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk.toString()); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mongodump exited with code ${String(code)}. stderr: ${stderr.join("").slice(0, 500)}`));
      }
    });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`mongodump not found at '${mongodumpPath}'. Install MongoDB Database Tools.`));
      } else {
        reject(err);
      }
    });
  });
}

async function inspectDumpDir(dirPath: string): Promise<{ sizeBytes: number; fileCount: number; collections: string[] }> {
  let sizeBytes = 0;
  let fileCount = 0;
  const collections: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const s = await fs.stat(full);
          sizeBytes += s.size;
          if (entry.name.endsWith(".bson.gz") || entry.name.endsWith(".bson")) {
            fileCount++;
            const colName = entry.name.replace(/\.bson(\.gz)?$/, "");
            const dbDir = path.basename(path.dirname(full));
            const qualified = `${dbDir}.${colName}`;
            if (!collections.includes(qualified)) collections.push(qualified);
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(dirPath);
  return { sizeBytes, fileCount, collections };
}

async function writeManifest(backupPath: string, view: BackupView): Promise<void> {
  const manifestPath = path.join(backupPath, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(view, null, 2), "utf8");
}

async function readManifest(backupPath: string): Promise<BackupView | null> {
  try {
    const raw = await fs.readFile(path.join(backupPath, "manifest.json"), "utf8");
    return JSON.parse(raw) as BackupView;
  } catch {
    return null;
  }
}

async function pruneOldBackups(): Promise<void> {
  const maxAgeDays = env.backupMaxAgeDays;
  if (!maxAgeDays || maxAgeDays <= 0) return;

  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const records = await listBackupRecords(100);
  const toDelete = records.filter(
    (r) => r.status !== "running" && r.createdAt.getTime() < cutoff
  );

  for (const r of toDelete) {
    try {
      await fs.rm(r.backupPath, { recursive: true, force: true });
      if (isMongoConnected()) {
        await BackupRecord.deleteOne({ backupId: r.backupId });
      } else {
        memoryBackups.delete(r.backupId);
      }
    } catch { /* best effort */ }
  }
}

async function saveBackupRecord(view: BackupView): Promise<void> {
  if (!isMongoConnected()) {
    memoryBackups.set(view.backupId, view);
    return;
  }
  await BackupRecord.create({
    ...view,
    mongoUriHash: hashUri(env.mongoUri ?? "")
  });
}

async function updateBackupRecord(backupId: string, update: Partial<BackupView>): Promise<void> {
  if (!isMongoConnected()) {
    const existing = memoryBackups.get(backupId);
    if (existing) memoryBackups.set(backupId, { ...existing, ...update });
    return;
  }
  await BackupRecord.findOneAndUpdate({ backupId }, { $set: update });
}

function docToView(doc: Record<string, unknown>): BackupView {
  return {
    backupId: String(doc["backupId"] ?? ""),
    status: (doc["status"] as BackupStatus) ?? "failed",
    trigger: (doc["trigger"] as BackupTrigger) ?? "manual",
    mode: (doc["mode"] as "full" | "collections") ?? "full",
    collections: Array.isArray(doc["collections"]) ? (doc["collections"] as string[]) : [],
    sizeBytes: Number(doc["sizeBytes"] ?? 0),
    fileCount: Number(doc["fileCount"] ?? 0),
    backupPath: String(doc["backupPath"] ?? ""),
    durationMs: Number(doc["durationMs"] ?? 0),
    errorMessage: doc["errorMessage"] as string | undefined,
    verifiedAt: doc["verifiedAt"] instanceof Date ? doc["verifiedAt"] : undefined,
    verificationStatus: doc["verificationStatus"] as VerificationStatus | undefined,
    verificationDetails: doc["verificationDetails"] as Record<string, unknown> | undefined,
    completedAt: doc["completedAt"] instanceof Date ? doc["completedAt"] : undefined,
    createdAt: doc["createdAt"] instanceof Date ? doc["createdAt"] : new Date()
  };
}

function hashUri(uri: string): string {
  return createHash("sha256").update(uri).digest("hex").slice(0, 16);
}

function parseCollectionsEnv(): string[] {
  const raw = env.backupCollections;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
