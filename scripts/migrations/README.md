# Database Migration Strategy

## How Mongoose handles schema evolution

Mongoose creates collections and indexes automatically on first write or on
`ensureIndexes()` which runs at application startup. This means:

- **Additive changes** (new optional fields, new indexes) are zero-downtime by
  default — old documents simply return `undefined` for the new field.
- **Destructive changes** (dropping fields used by existing documents, changing
  index uniqueness, renaming fields) require a migration script.

---

## Index management

Index changes are detected and applied by Mongoose on next startup when
`autoIndex: true` (the default). In production MongoDB Atlas, prefer managing
indexes through Atlas UI or `mongosh` scripts so that index builds are
backgrounded and do not block the application.

To disable automatic index creation and manage indexes manually, set in
`apps/api/src/db/mongoose.ts`:

```ts
mongoose.set("autoIndex", false);
```

Then run index-build scripts as a separate step before deploying.

---

## Migration scripts

Place numbered, timestamped scripts here:

```
scripts/migrations/
  001-2026-06-11-add-workspace-slug-index.mjs
  002-2026-06-15-backfill-snapshot-tenantSlug.mjs
```

Each script exports a `migrate()` function:

```js
// scripts/migrations/001-2026-06-11-add-workspace-slug-index.mjs
import mongoose from "mongoose";

export async function migrate(db) {
  await db.collection("workspaces").createIndex({ slug: 1 }, { unique: true, background: true });
  console.log("001: workspace slug index created");
}
```

Run with:

```bash
node scripts/run-migrations.mjs
```

`run-migrations.mjs` (create alongside as needed) should:
1. Connect to MongoDB using `MONGODB_URI`.
2. Maintain a `_migrations` collection tracking which scripts have run.
3. Run only un-applied scripts, in order.
4. Log success/failure and exit non-zero on failure (so CI/CD stops the deploy).

---

## Deployment order (blue-green / rolling)

For zero-downtime deploys:

1. **Before deploy**: run migration scripts that only ADD fields or indexes.
2. **Deploy new code**: new version reads both old and new field shapes.
3. **After stabilisation**: run scripts that clean up old fields or rename indexes.

Never deploy a version that REQUIRES a field to exist before the backfill has run.

---

## Rollback procedure

### Code rollback

Pin the previous image tag in `docker-compose.prod.yml`:

```yaml
api:
  image: ghcr.io/your-org/systolab-api:v1.2.2   # previous tag
web:
  image: ghcr.io/your-org/systolab-web:v1.2.2
```

Then:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build
```

### Database rollback

Mongoose schemas are forward-compatible by default (extra fields are ignored,
missing optional fields return `undefined`). If a migration added a unique index
that now causes write failures on rollback, drop the index:

```bash
mongosh "$MONGODB_URI" --eval "
  db.workspaces.dropIndex('slug_1');
"
```

For destructive data migrations (field renames, data transforms), maintain a
`down()` function in each migration script and run it manually:

```bash
node scripts/run-migrations.mjs --down 001
```

---

## Pre-deployment checklist

- [ ] `NODE_ENV=production` is set
- [ ] `SYSTOLAB_MEMORY_STORE=false`
- [ ] All secrets are ≥ 32 chars and contain no placeholder words
- [ ] `SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL=false`
- [ ] `MONGODB_URI` points to a replica set for oplog-based change streams
- [ ] TLS certificates are present at `infra/nginx/ssl/`
- [ ] Migration scripts for this version have been reviewed and tested on staging
- [ ] Previous image tag is noted for rollback (`docker images` or CI artifact)
- [ ] Health check endpoint `/health` returns 200 after deploy

---

## MongoDB Atlas notes

- Use Atlas `M10+` for replica sets (required for transactions and change streams).
- Enable Atlas Backup for point-in-time recovery.
- Set `retryWrites=true&w=majority` in the connection URI.
- Restrict IP allowlist to your deployment servers + CI runner egress IPs.
- Use Atlas Database Users with `readWrite` on the `systolab` database only —
  not root credentials.
