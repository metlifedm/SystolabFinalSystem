# SYSTOLAB Platform Control Plane

The Platform Control Plane is SYSTOLAB's internal production infrastructure layer. It is self-owned and protected by `x-systolab-internal-key`.

It implements:

- Module Registry System with module versions, dependencies, permissions, health, activation state, owner, compatibility, and audit history.
- Distributed Job Processing Framework with priority queues, scheduled jobs, attempts, retries, dead-letter state, and job audits.
- Analytics Warehouse rollups isolated from transactional snapshots.
- AI Analyst context generation without external AI APIs.
- Workspace Intelligence with tenant and workspace isolation.
- Immutable Evidence Repository and Artifact Versioning.
- API Governance with API key auth, rate limiting, daily quotas, usage audits, API versioning, and developer-control records.
- Disaster Recovery, Observability, Data Governance, Intelligence Validation, Scan SLO, Governance Contract, Data Quality, Cost Intelligence, Graph Intelligence, Feature Flags, and Sandbox controls.

## Internal Routes

All routes live under `/api/internal/platform` and require `SYSTOLAB_INTERNAL_ADMIN_KEY`.

- `GET /overview`
- `GET /modules`
- `POST /modules`
- `PATCH /modules/:moduleId/activation`
- `POST /modules/validate`
- `GET /jobs`
- `POST /jobs`
- `POST /jobs/run-due`
- `GET /warehouse`
- `POST /warehouse/materialize`
- `GET /ai-analyst/context`
- `GET /workspaces`
- `GET /evidence-repository`
- `GET /api-governance`
- `GET /artifact-versions`
- `GET /disaster-recovery`
- `GET /observability`
- `GET /data-governance`
- `GET /validation`
- `GET /slo`
- `GET /realtime/homepage`
- `GET /governance-contract`
- `GET /lineage`
- `GET /data-quality`
- `GET /cost-intelligence`
- `GET /graph`
- `GET /feature-flags`
- `POST /feature-flags`
- `GET /feature-flags/:flagKey/evaluate`
- `GET /sandbox/experiments`
- `POST /sandbox/experiments`

## Public API Governance

The `/v1` API is governed by:

- `x-systolab-api-key` authentication.
- Express rate limiting.
- Daily quota checks through `SYSTOLAB_PUBLIC_API_DAILY_QUOTA`.
- API usage audit records.
- API version tagging.

No external gateway, analytics provider, or paid API is required.
