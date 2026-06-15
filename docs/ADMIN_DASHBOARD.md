# SYSTOLAB Operations Intelligence Center

The Operations Intelligence Center is the internal admin dashboard at `/admin`.

It is designed for:

- Owners: full platform governance, module validation, job execution, warehouse materialization, sandbox runs, feature activation, PDF exports, and platform-wide controls.
- Managers: read-only operational visibility across scans, jobs, users, security, intelligence quality, lineage, graph intelligence, workspaces, modules, and platform health.

The dashboard is backed by `/api/internal/platform` and uses:

- `x-systolab-internal-key`
- `x-systolab-admin-role`

## Dashboard Areas

- Executive Intelligence Overview.
- Operational Stability Score with visible factors.
- Scan Intelligence Center and Scan Replay Intelligence.
- User Journey Intelligence.
- User-wise search/report ledger showing each user's searched URL, scan inputs, report snapshot, OSS, risk, recommendations, competitors, revenue opportunity, confidence, sessions, and profile details.
- Decision Intelligence and ROI.
- Intelligence Quality Center and Accuracy controls.
- Security Intelligence Layer.
- Infrastructure Intelligence Center.
- Autonomous Intelligence Surface Discovery from the Module Registry.
- Intelligence Lineage Explorer.
- Platform Knowledge Graph Explorer.
- Workspace Intelligence Center.
- Cost Intelligence Center.
- Feature Flags.
- Intelligence Sandbox.

## PDF Export

The dashboard includes one-click PDF export through:

`GET /api/internal/platform/export.pdf`

The PDF includes timestamp, report ID, module registry state, job state, warehouse metrics, security posture, user journey metrics, governance controls, lineage counts, graph counts, and platform version metadata.
