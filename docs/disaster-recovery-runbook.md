# Systolab — Disaster Recovery Runbook

**Version:** 1.0  
**Owner:** Platform Engineering  
**Last reviewed:** 2026-06-11

---

## 1. Overview

This runbook covers the procedures for recovering the Systolab production system following a major incident (data loss, database corruption, infrastructure failure, or security breach). It is intended for the on-call engineer or platform lead.

---

## 2. RTO / RPO Targets

| Target | Value | Notes |
|--------|-------|-------|
| **RPO** (Recovery Point Objective) | 24 hours | Maximum acceptable data loss. Daily backups ensure at most ~24 h of data is at risk. |
| **RTO** (Recovery Time Objective) | 4 hours | Target time from incident declaration to service restoration. |
| Backup retention | 7 days (configurable) | `SYSTOLAB_BACKUP_MAX_AGE_DAYS` |
| Backup schedule | Daily at 02:00 UTC | Configured in cron / scheduler |
| Backup verification | Within 30 min of completion | Triggered by cron or API |

---

## 3. Incident Classification

| Severity | Description | Example |
|----------|-------------|---------|
| **P1 — Critical** | Complete service loss or confirmed data loss | DB unreachable, data corruption confirmed |
| **P2 — High** | Significant degradation, partial data unavailable | API errors > 10%, scans failing |
| **P3 — Medium** | Non-critical feature failure, elevated error rate | PDF export broken, workers paused |
| **P4 — Low** | Cosmetic or isolated issue | Dashboard rendering glitch |

Invoke this runbook for **P1** and **P2** incidents. P3/P4 follow standard debugging procedures.

---

## 4. Contacts

| Role | Name | Contact |
|------|------|---------|
| Platform Lead | *(fill in)* | *(fill in)* |
| On-call Engineer | *(fill in — see PagerDuty / Opsgenie rotation)* | *(fill in)* |
| Database Admin | *(fill in)* | *(fill in)* |
| Security Lead | *(fill in — for breach incidents)* | *(fill in)* |

---

## 5. Pre-Incident Prerequisites

Ensure the following are in place **before** an incident:

- [ ] `SYSTOLAB_BACKUP_DIR` is mounted to a persistent volume (not ephemeral container storage).
- [ ] Daily backup cron is registered and verified (`node scripts/verify-backup.mjs --backup-id <latest>`).
- [ ] `mongodump` / `mongorestore` binaries are accessible in the container or host path.
- [ ] `.env.prod` with valid `MONGODB_URI` is accessible on the recovery host.
- [ ] This runbook has been drilled at least once per quarter.

---

## 6. Step-by-Step Restoration Procedure

### 6.1 Declare the incident

1. Notify the on-call engineer and platform lead using the contact list in §4.
2. Open an incident channel (e.g., `#incident-YYYY-MM-DD`) for coordination.
3. Document the time of incident declaration.

### 6.2 Assess scope

```bash
# Check API health
curl https://<your-domain>/health

# Check recent backup status via admin API
curl -H "Authorization: Bearer <owner-token>" \
  https://<your-domain>/api/internal/platform/backup/status
```

Determine:
- Is MongoDB reachable?
- Is the last backup `completed` or `verified`?
- What is the timestamp of the last known-good backup?

### 6.3 Stop writes (optional but recommended)

If the database is still accepting writes but data integrity is in question, pause the API workers to prevent further corruption:

```bash
# Via docker-compose (staging/prod)
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec api node -e "process.exit(0)"  # test connectivity

# Scale API to 0 to stop writes during restore
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  stop api
```

### 6.4 Identify the backup to restore

```bash
# List recent backups
ls -lt /data/backups/

# Or query the admin API (if MongoDB is partially available)
curl -H "Authorization: Bearer <owner-token>" \
  https://<your-domain>/api/internal/platform/backup/history
```

Choose the most recent backup with `status: "completed"` or `"verified"`.

### 6.5 Verify the backup (if not already verified)

```bash
cd /app/scripts
node verify-backup.mjs --backup-id bkp_<id>
# or
node verify-backup.mjs --backup-path /data/backups/<dir>
```

If verification fails (missing BSON files, manifest mismatch), try the next most recent backup.

### 6.6 Restore

> **CAUTION:** Using `--drop` will destroy existing data in the target collections before restoring.
> Only use `--drop` when restoring to a fresh or corrupted database.

```bash
cd /app/scripts

# Dry run first — prints commands without executing
node restore.mjs --backup-id bkp_<id> --drop --dry-run

# Execute restore
node restore.mjs --backup-id bkp_<id> --drop
```

Or using `mongorestore` directly (equivalent):

```bash
mongorestore \
  --uri "$MONGODB_URI" \
  --gzip \
  --drop \
  --dir /data/backups/<backup-directory>
```

### 6.7 Verify post-restore

```bash
# Quick sanity check — connect to MongoDB and count documents
mongosh "$MONGODB_URI" --eval "
  const dbs = db.adminCommand({ listDatabases: 1 });
  printjson(dbs.databases.map(d => ({name: d.name, sizeOnDisk: d.sizeOnDisk})));
"

# Check key collections
mongosh "$MONGODB_URI" --eval "
  db = db.getSiblingDB('systolab');
  print('snapshots:', db.snapshots.countDocuments());
  print('authusers:', db.authusers.countDocuments());
  print('workspaces:', db.workspaces.countDocuments());
  print('scanrequests:', db.scanrequests.countDocuments());
"
```

### 6.8 Restart services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api
```

Wait for the health check to pass:

```bash
docker compose -f docker-compose.prod.yml ps
# api should show status: "healthy"
```

### 6.9 Validate application behaviour

- [ ] `GET /health` returns 200 with `status: "ok"`.
- [ ] Log in via the web dashboard.
- [ ] Trigger a test scan and confirm it completes.
- [ ] Check the admin platform dashboard (`/api/internal/platform/dashboard`) for anomalies.
- [ ] Review error logs for the first 15 minutes post-restore.

### 6.10 Declare incident resolved

1. Post resolution in the incident channel with: timeline, root cause (if known), data loss window, and any action items.
2. Create a post-mortem within 48 hours.

---

## 7. Failover Procedure (Infrastructure Failure)

If the primary host is lost:

1. Provision a new host with Docker installed.
2. Pull the latest application images:
   ```bash
   docker pull ghcr.io/<your-org>/systolab-api:<tag>
   docker pull ghcr.io/<your-org>/systolab-web:<tag>
   ```
3. Copy `.env.prod` and TLS certificates to the new host.
4. Restore `backup_data` and `artifact_data` volumes from the backup storage location (S3, NFS, or remote copy).
5. Follow steps 6.6–6.9 above.
6. Update DNS to point to the new host IP.

---

## 8. Manual Backup Trigger

To create an immediate backup (outside the scheduled window):

```bash
# Via API (requires owner token)
curl -X POST \
  -H "Authorization: Bearer <owner-token>" \
  -H "X-Confirm-Destructive: true" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}' \
  https://<your-domain>/api/internal/platform/backup/run

# Via standalone script (on the host/container)
cd /app/scripts
node backup.mjs --trigger manual
```

---

## 9. Scheduled Backup Cron

The recommended cron entry (host or container orchestrator):

```cron
# Daily at 02:00 UTC — full backup with verification
0 2 * * * cd /app/scripts && node backup.mjs --trigger scheduled >> /var/log/systolab-backup.log 2>&1
30 2 * * * cd /app/scripts && node verify-backup.mjs --backup-id $(ls -t /data/backups | head -1 | grep -oP 'bkp_\w+') >> /var/log/systolab-backup.log 2>&1
```

In Kubernetes, use a `CronJob` with the same commands.

---

## 10. Backup Verification API

Verification can also be triggered via the admin API:

```bash
# List recent backups
GET /api/internal/platform/backup/history

# Check backup status summary
GET /api/internal/platform/backup/status

# Verify a specific backup
POST /api/internal/platform/backup/:backupId/verify
  Headers: Authorization: Bearer <owner-token>
           X-Confirm-Destructive: true
```

---

## 11. Environment Variables Reference

| Variable | Purpose | Default |
|----------|---------|---------|
| `SYSTOLAB_BACKUP_DIR` | Root directory for backup output | `/data/backups` |
| `SYSTOLAB_BACKUP_MAX_AGE_DAYS` | Days to retain completed backups | `7` |
| `SYSTOLAB_BACKUP_MONGODUMP_PATH` | Path to `mongodump` binary | `mongodump` |
| `SYSTOLAB_BACKUP_MONGORESTORE_PATH` | Path to `mongorestore` binary | `mongorestore` |
| `SYSTOLAB_BACKUP_COLLECTIONS` | Comma-separated collection filter (empty = all) | *(all)* |

---

## 12. Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/backup.mjs` | Run `mongodump`, write `manifest.json`, persist `BackupRecord` |
| `scripts/restore.mjs` | Run `mongorestore` from a backup directory or `--backup-id` |
| `scripts/verify-backup.mjs` | Verify file integrity and update `BackupRecord.verificationStatus` |

All scripts read environment from `../.env` (relative to `scripts/`) or from the shell environment.

---

## 13. Post-Mortem Template

After each P1/P2 incident, complete a post-mortem within 48 hours:

```
## Incident Summary
Date:
Duration:
Severity:
On-call engineer:

## Timeline
- HH:MM — <event>
- HH:MM — <event>

## Root Cause
<1-3 sentences>

## Impact
- Data loss window: <none | X minutes>
- Users affected: <count or "all">
- Features degraded: <list>

## What Went Well
- 

## What Went Wrong
-

## Action Items
- [ ] Owner: task — due date
```
