#!/usr/bin/env node
/**
 * Standalone MongoDB backup script.
 *
 * Usage:
 *   node backup.mjs [--collections col1,col2] [--trigger manual]
 *
 * Reads environment from ../.env (or set vars in the calling shell).
 * Requires MongoDB Database Tools (mongodump) to be installed:
 *   https://www.mongodb.com/try/download/database-tools
 *
 * To run on a cron schedule (example — every day at 02:00):
 *   0 2 * * * cd /app/scripts && node backup.mjs >> /var/log/systolab-backup.log 2>&1
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────────

async function loadEnv() {
  try {
    const { default: dotenv } = await import("dotenv");
    dotenv.config({ path: path.resolve(__dirname, "../.env") });
  } catch {
    // dotenv optional — env vars may be set in calling shell
  }
}

await loadEnv();

const MONGODB_URI = process.env.MONGODB_URI ?? "";
const BACKUP_DIR = process.env.SYSTOLAB_BACKUP_DIR ?? "/data/backups";
const MAX_AGE_DAYS = parseInt(process.env.SYSTOLAB_BACKUP_MAX_AGE_DAYS ?? "7", 10);
const MONGODUMP_PATH = process.env.SYSTOLAB_BACKUP_MONGODUMP_PATH ?? "mongodump";
const BACKUP_COLLECTIONS = process.env.SYSTOLAB_BACKUP_COLLECTIONS ?? "";

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { trigger: "scheduled", collections: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trigger" && args[i + 1]) {
      result.trigger = args[++i];
    } else if (args[i] === "--collections" && args[i + 1]) {
      result.collections = args[++i].split(",").map((c) => c.trim()).filter(Boolean);
    }
  }
  if (result.collections.length === 0 && BACKUP_COLLECTIONS) {
    result.collections = BACKUP_COLLECTIONS.split(",").map((c) => c.trim()).filter(Boolean);
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeBackupId() {
  return `bkp_${randomBytes(8).toString("hex")}`;
}

function hashUri(uri) {
  return createHash("sha256").update(uri).digest("hex").slice(0, 16);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function inspectDumpDir(dirPath) {
  let sizeBytes = 0;
  let fileCount = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".bson.gz") || entry.name.endsWith(".bson") || entry.name.endsWith(".metadata.json.gz")) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) {
          sizeBytes += stat.size;
          if (entry.name.endsWith(".bson.gz") || entry.name.endsWith(".bson")) fileCount++;
        }
      }
    }
  }
  await walk(dirPath);
  return { sizeBytes, fileCount };
}

// ── mongodump runner ────────────────────────────────────────────────────────────

function runMongodump(mongoUri, outputDir, collections) {
  return new Promise((resolve, reject) => {
    const args = ["--uri", mongoUri, "--out", outputDir, "--gzip"];
    for (const col of collections) {
      // col format: "dbName.collectionName"
      const parts = col.split(".");
      if (parts.length === 2) {
        args.push("--db", parts[0], "--collection", parts[1]);
      }
    }
    log(`Running: ${MONGODUMP_PATH} ${args.map((a) => (a === mongoUri ? "<uri>" : a)).join(" ")}`);
    const proc = spawn(MONGODUMP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.stdout.on("data", (d) => { process.stdout.write(d); });
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error(`mongodump not found at '${MONGODUMP_PATH}'. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(`mongodump exited with code ${code}.\n${stderr}`));
      }
    });
  });
}

// ── MongoDB record writer ──────────────────────────────────────────────────────

async function withMongo(fn) {
  if (!MONGODB_URI) {
    log("MONGODB_URI not set — skipping BackupRecord persistence.");
    return null;
  }
  let client;
  try {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    return await fn(client);
  } catch (err) {
    log(`MongoDB record write failed (non-fatal): ${err.message}`);
    return null;
  } finally {
    await client?.close().catch(() => {});
  }
}

async function upsertBackupRecord(client, record) {
  const db = client.db();
  await db.collection("backuprecords").replaceOne(
    { backupId: record.backupId },
    record,
    { upsert: true }
  );
}

// ── Pruning ────────────────────────────────────────────────────────────────────

async function pruneOldBackups() {
  if (!MAX_AGE_DAYS || MAX_AGE_DAYS <= 0) return;
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  let entries;
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(BACKUP_DIR, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtime < cutoff) {
      log(`Pruning old backup: ${entry.name}`);
      await fs.rm(full, { recursive: true, force: true }).catch((err) => log(`Prune failed: ${err.message}`));
    }
  }

  await withMongo(async (client) => {
    const db = client.db();
    await db.collection("backuprecords").deleteMany({ createdAt: { $lt: cutoff } });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!MONGODB_URI) {
    log("WARNING: MONGODB_URI is not set. Backup will run but BackupRecord will not be persisted.");
  }

  const { trigger, collections } = parseArgs();
  const backupId = makeBackupId();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, `${timestamp}-${backupId}`);
  const mode = collections.length > 0 ? "collections" : "full";
  const mongoUriHash = hashUri(MONGODB_URI);
  const startedAt = Date.now();

  log(`Starting ${mode} backup. backupId=${backupId} trigger=${trigger}`);

  await fs.mkdir(backupPath, { recursive: true });

  const record = {
    backupId,
    status: "running",
    trigger,
    mode,
    collections,
    sizeBytes: 0,
    fileCount: 0,
    backupPath,
    durationMs: 0,
    mongoUriHash,
    createdAt: new Date()
  };

  await withMongo((client) => upsertBackupRecord(client, record));

  let finalStatus = "completed";
  let errorMessage;

  try {
    await runMongodump(MONGODB_URI, backupPath, collections);
  } catch (err) {
    finalStatus = "failed";
    errorMessage = err.message;
    log(`mongodump failed: ${err.message}`);
  }

  const durationMs = Date.now() - startedAt;
  const { sizeBytes, fileCount } = await inspectDumpDir(backupPath).catch(() => ({ sizeBytes: 0, fileCount: 0 }));

  const manifest = {
    backupId,
    status: finalStatus,
    trigger,
    mode,
    collections,
    sizeBytes,
    fileCount,
    backupPath,
    durationMs,
    mongoUriHash,
    errorMessage,
    completedAt: finalStatus === "completed" ? new Date().toISOString() : undefined,
    createdAt: record.createdAt.toISOString(),
    scriptVersion: "1"
  };

  await fs.writeFile(path.join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const updatedRecord = {
    ...record,
    status: finalStatus,
    sizeBytes,
    fileCount,
    durationMs,
    errorMessage,
    completedAt: finalStatus === "completed" ? new Date() : undefined
  };

  await withMongo((client) => upsertBackupRecord(client, updatedRecord));

  if (finalStatus === "completed") {
    log(`Backup complete. backupId=${backupId} files=${fileCount} size=${sizeBytes}B duration=${durationMs}ms`);
    await pruneOldBackups();
    process.exit(0);
  } else {
    log(`Backup failed. backupId=${backupId} error=${errorMessage}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`);
  process.exit(1);
});
