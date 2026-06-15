#!/usr/bin/env node
/**
 * Standalone backup verification script.
 *
 * Usage:
 *   node verify-backup.mjs --backup-id bkp_abc123
 *   node verify-backup.mjs --backup-path /data/backups/2024-01-15T02-00-00-bkp_abc123
 *
 * Checks:
 *   1. Backup directory exists and is readable.
 *   2. manifest.json is present and parseable.
 *   3. At least one .bson.gz or .bson file exists.
 *   4. Actual file count and size match manifest values (if present).
 *
 * Updates the BackupRecord in MongoDB (if MONGODB_URI is set) with
 * verificationStatus: "pass" | "fail" and verifiedAt timestamp.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────────

async function loadEnv() {
  try {
    const { default: dotenv } = await import("dotenv");
    dotenv.config({ path: path.resolve(__dirname, "../.env") });
  } catch {
    // dotenv optional
  }
}

await loadEnv();

const MONGODB_URI = process.env.MONGODB_URI ?? "";
const BACKUP_DIR = process.env.SYSTOLAB_BACKUP_DIR ?? "/data/backups";

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { backupId: null, backupPath: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--backup-id" && args[i + 1]) result.backupId = args[++i];
    else if (args[i] === "--backup-path" && args[i + 1]) result.backupPath = args[++i];
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function abort(msg) {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`);
  process.exit(1);
}

async function resolveBackupPath(opts) {
  if (opts.backupPath) return { backupPath: opts.backupPath, backupId: opts.backupId };
  if (!opts.backupId) abort("Provide --backup-id or --backup-path.");

  if (MONGODB_URI) {
    let client;
    try {
      client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const record = await client.db().collection("backuprecords").findOne({ backupId: opts.backupId });
      if (record?.backupPath) {
        await client.close().catch(() => {});
        return { backupPath: record.backupPath, backupId: opts.backupId };
      }
      await client.close().catch(() => {});
    } catch {
      await client?.close().catch(() => {});
    }
  }

  let entries;
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    abort(`Cannot read backup directory: ${BACKUP_DIR}`);
  }
  const match = entries.find((e) => e.isDirectory() && e.name.includes(opts.backupId));
  if (match) return { backupPath: path.join(BACKUP_DIR, match.name), backupId: opts.backupId };

  abort(`No backup found for id '${opts.backupId}' in ${BACKUP_DIR}.`);
}

async function inspectDumpDir(dirPath) {
  let sizeBytes = 0;
  let fileCount = 0;
  const files = [];
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
          if (entry.name.endsWith(".bson.gz") || entry.name.endsWith(".bson")) {
            fileCount++;
            files.push(path.relative(dirPath, full));
          }
        }
      }
    }
  }
  await walk(dirPath);
  return { sizeBytes, fileCount, files };
}

async function updateBackupRecord(backupId, verificationStatus, details) {
  if (!MONGODB_URI || !backupId) return;
  let client;
  try {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db().collection("backuprecords").updateOne(
      { backupId },
      {
        $set: {
          status: verificationStatus === "pass" ? "verified" : "verification_failed",
          verificationStatus,
          verifiedAt: new Date(),
          verificationDetails: details
        }
      }
    );
    log(`BackupRecord updated: backupId=${backupId} verificationStatus=${verificationStatus}`);
  } catch (err) {
    log(`MongoDB update failed (non-fatal): ${err.message}`);
  } finally {
    await client?.close().catch(() => {});
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  if (!opts.backupId && !opts.backupPath) {
    console.error("Usage: node verify-backup.mjs --backup-id <id>");
    console.error("       node verify-backup.mjs --backup-path <path>");
    process.exit(1);
  }

  const { backupPath, backupId } = await resolveBackupPath(opts);
  log(`Verifying backup at: ${backupPath}`);

  const checks = { dirExists: false, manifestPresent: false, manifestParseable: false, bsonFilesPresent: false, sizeMatch: null, fileCountMatch: null };
  let verificationStatus = "pass";
  const issues = [];

  // Check 1: directory exists
  const dirStat = await fs.stat(backupPath).catch(() => null);
  if (dirStat?.isDirectory()) {
    checks.dirExists = true;
    log("PASS  Directory exists.");
  } else {
    checks.dirExists = false;
    issues.push("Backup directory does not exist or is not a directory.");
    log(`FAIL  Directory not found: ${backupPath}`);
    verificationStatus = "fail";
  }

  if (!checks.dirExists) {
    await updateBackupRecord(backupId, verificationStatus, { checks, issues });
    log(`Verification result: ${verificationStatus.toUpperCase()}`);
    process.exit(verificationStatus === "pass" ? 0 : 1);
  }

  // Check 2: manifest.json
  const manifestPath = path.join(backupPath, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8").catch(() => null);
  if (manifestRaw !== null) {
    checks.manifestPresent = true;
    log("PASS  manifest.json present.");
    try {
      const manifest = JSON.parse(manifestRaw);
      checks.manifestParseable = true;
      log(`      manifest: id=${manifest.backupId} status=${manifest.status} mode=${manifest.mode}`);
    } catch {
      checks.manifestParseable = false;
      issues.push("manifest.json is not valid JSON.");
      log("FAIL  manifest.json is not valid JSON.");
      verificationStatus = "fail";
    }
  } else {
    checks.manifestPresent = false;
    checks.manifestParseable = false;
    issues.push("manifest.json not found.");
    log("FAIL  manifest.json not found.");
    verificationStatus = "fail";
  }

  // Check 3: .bson.gz files present
  const { sizeBytes, fileCount, files } = await inspectDumpDir(backupPath);
  if (fileCount > 0) {
    checks.bsonFilesPresent = true;
    log(`PASS  ${fileCount} BSON file(s) found, total ${sizeBytes} bytes.`);
    if (files.length <= 20) {
      for (const f of files) log(`      ${f}`);
    } else {
      log(`      (${files.length} files — showing first 20)`);
      for (const f of files.slice(0, 20)) log(`      ${f}`);
    }
  } else {
    checks.bsonFilesPresent = false;
    issues.push("No BSON data files found in backup directory.");
    log("FAIL  No .bson.gz or .bson files found.");
    verificationStatus = "fail";
  }

  // Check 4: cross-reference manifest counts (informational)
  if (checks.manifestParseable) {
    const manifest = JSON.parse(manifestRaw);
    if (typeof manifest.fileCount === "number") {
      checks.fileCountMatch = fileCount === manifest.fileCount;
      if (checks.fileCountMatch) {
        log(`PASS  File count matches manifest (${fileCount}).`);
      } else {
        log(`WARN  File count mismatch: actual=${fileCount} manifest=${manifest.fileCount}`);
        issues.push(`File count mismatch: actual=${fileCount} manifest=${manifest.fileCount}.`);
      }
    }
    if (typeof manifest.sizeBytes === "number" && manifest.sizeBytes > 0) {
      const delta = Math.abs(sizeBytes - manifest.sizeBytes) / manifest.sizeBytes;
      checks.sizeMatch = delta < 0.01;
      if (checks.sizeMatch) {
        log(`PASS  Size matches manifest (${sizeBytes} bytes).`);
      } else {
        log(`WARN  Size mismatch: actual=${sizeBytes} manifest=${manifest.sizeBytes}`);
        issues.push(`Size mismatch: actual=${sizeBytes} manifest=${manifest.sizeBytes}.`);
      }
    }
  }

  const details = { checks, issues, actualFileCount: fileCount, actualSizeBytes: sizeBytes };
  await updateBackupRecord(backupId ?? opts.backupId, verificationStatus, details);

  log(`Verification result: ${verificationStatus.toUpperCase()}${issues.length > 0 ? ` (${issues.length} issue(s))` : ""}`);
  if (issues.length > 0) {
    for (const issue of issues) log(`  - ${issue}`);
  }

  process.exit(verificationStatus === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`);
  process.exit(1);
});
