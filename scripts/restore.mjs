#!/usr/bin/env node
/**
 * Standalone MongoDB restore script.
 *
 * Usage:
 *   node restore.mjs --backup-id bkp_abc123
 *   node restore.mjs --backup-path /data/backups/2024-01-15T02-00-00-bkp_abc123
 *   node restore.mjs --backup-id bkp_abc123 --drop       # drop collections before restore
 *   node restore.mjs --backup-id bkp_abc123 --dry-run    # print commands, do not execute
 *
 * Reads environment from ../.env (or set vars in the calling shell).
 * Requires MongoDB Database Tools (mongorestore) to be installed:
 *   https://www.mongodb.com/try/download/database-tools
 *
 * CAUTION: This is a destructive operation. Always verify the backup first:
 *   node verify-backup.mjs --backup-id bkp_abc123
 */

import { spawn } from "node:child_process";
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
const MONGORESTORE_PATH = process.env.SYSTOLAB_BACKUP_MONGORESTORE_PATH ?? "mongorestore";

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { backupId: null, backupPath: null, drop: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--backup-id" && args[i + 1]) result.backupId = args[++i];
    else if (args[i] === "--backup-path" && args[i + 1]) result.backupPath = args[++i];
    else if (args[i] === "--drop") result.drop = true;
    else if (args[i] === "--dry-run") result.dryRun = true;
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
  if (opts.backupPath) return opts.backupPath;
  if (!opts.backupId) abort("Provide --backup-id or --backup-path.");

  // Try to find in BackupRecord first
  if (MONGODB_URI) {
    let client;
    try {
      client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const record = await client.db().collection("backuprecords").findOne({ backupId: opts.backupId });
      if (record?.backupPath) {
        await client.close().catch(() => {});
        return record.backupPath;
      }
      await client.close().catch(() => {});
    } catch {
      await client?.close().catch(() => {});
    }
  }

  // Fallback: scan backup dir for a directory containing the backupId
  let entries;
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch {
    abort(`Cannot read backup directory: ${BACKUP_DIR}`);
  }
  const match = entries.find((e) => e.isDirectory() && e.name.includes(opts.backupId));
  if (match) return path.join(BACKUP_DIR, match.name);

  abort(`No backup found for id '${opts.backupId}' in ${BACKUP_DIR}.`);
}

async function readManifest(backupPath) {
  const manifestPath = path.join(backupPath, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── mongorestore runner ────────────────────────────────────────────────────────

function runMongorestore(mongoUri, backupPath, { drop, dryRun }) {
  const args = ["--uri", mongoUri, "--gzip", "--dir", backupPath];
  if (drop) args.push("--drop");

  const printable = args.map((a) => (a === mongoUri ? "<uri>" : a));
  log(`Command: ${MONGORESTORE_PATH} ${printable.join(" ")}`);

  if (dryRun) {
    log("DRY RUN — command printed, not executed.");
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(MONGORESTORE_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.stdout.on("data", (d) => { process.stdout.write(d); });
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error(`mongorestore not found at '${MONGORESTORE_PATH}'. Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools`));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(`mongorestore exited with code ${code}.\n${stderr}`));
      }
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!MONGODB_URI) abort("MONGODB_URI is not set.");

  const opts = parseArgs();
  if (!opts.backupId && !opts.backupPath) {
    console.error("Usage: node restore.mjs --backup-id <id> [--drop] [--dry-run]");
    console.error("       node restore.mjs --backup-path <path> [--drop] [--dry-run]");
    process.exit(1);
  }

  const backupPath = await resolveBackupPath(opts);
  log(`Resolved backup path: ${backupPath}`);

  // Verify the directory exists
  const stat = await fs.stat(backupPath).catch(() => null);
  if (!stat?.isDirectory()) abort(`Backup directory not found: ${backupPath}`);

  // Read manifest for informational output
  const manifest = await readManifest(backupPath);
  if (manifest) {
    log(`Manifest: id=${manifest.backupId} status=${manifest.status} mode=${manifest.mode} files=${manifest.fileCount} size=${manifest.sizeBytes}B`);
    if (manifest.status !== "completed" && manifest.status !== "verified") {
      log(`WARNING: Backup status is '${manifest.status}'. Restoring from an incomplete backup may be dangerous.`);
    }
  } else {
    log("WARNING: No manifest.json found in backup directory. Proceeding anyway.");
  }

  if (opts.drop) {
    log("WARNING: --drop flag set. Existing collections will be dropped before restore.");
  }

  log("Starting restore...");
  const startedAt = Date.now();

  try {
    await runMongorestore(MONGODB_URI, backupPath, { drop: opts.drop, dryRun: opts.dryRun });
  } catch (err) {
    abort(`Restore failed: ${err.message}`);
  }

  const durationMs = Date.now() - startedAt;
  if (opts.dryRun) {
    log("Dry run complete. No data was modified.");
  } else {
    log(`Restore complete in ${durationMs}ms.`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`);
  process.exit(1);
});
