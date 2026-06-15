# Internal Intelligence Reporting Engine

The Internal Intelligence Reporting Engine (IIRE) is SYSTOLAB's internal organizational learning layer. It is not exposed to customers and is protected by `x-systolab-internal-key`.

IIRE aggregates:

- Scan history and immutable snapshots.
- Intelligence events.
- Evidence Database rows.
- Revenue Intelligence estimates.
- Recommendation Outcome Validation records.
- Business DNA outputs.
- Competitor Intelligence outputs.
- Edit Intelligence first-party events.
- Operational Memory Graph outputs.
- Alert and notification records.

## Report Outputs

IIRE generates daily, weekly, monthly, quarterly, annual, custom, and event-triggered reports with:

- Executive summaries.
- Market intelligence.
- Industry trend analysis.
- Revenue leakage trends.
- Competitor movement reports.
- Competitor Relationship Graph clusters, influence leaders, weighted edges, and growth velocity.
- Recommendation effectiveness statistics.
- OSS distributions.
- Behavioral analytics and churn intelligence.
- Funnel analysis.
- Business DNA discoveries.
- Outcome validation findings.
- Intelligence accuracy metrics.
- Knowledge Growth Score.
- Platform growth indicators.
- Anomaly alerts.

Reports export as JSON, PDF, CSV, spreadsheet-compatible HTML, and dashboard JSON.

## Sub-Engines

### Intelligence Discovery Engine

The IDE discovers unrequested insights from aggregate data, including recurring weaknesses, industry gaps, behavioral patterns, competitor patterns, market shifts, and platform performance issues.

### Intelligence Accuracy Laboratory

The IAL compares revenue opportunity estimates and confidence scores against validated outcomes, producing alignment scores and recalibration recommendations. It also emits the Knowledge Growth Score, which measures whether SYSTOLAB is becoming smarter from validated intelligence gains across industry knowledge, competitor intelligence, revenue prediction confidence, recommendation accuracy, behavioral understanding, and market coverage.

### Competitor Relationship Graph

The CRG converts competitor observations into internal graph intelligence. It stores and aggregates business, competitor, industry, market-segment, and location nodes; weighted relationship edges; market clusters; influence leaders; growth velocity; concentration scores; and competitor overlap signals. CRG output is internal IIRE intelligence only and does not use rankings, paid APIs, traffic APIs, or external market datasets.

### Opportunity Discovery Engine

The ODE identifies internal product, service, automation, partnership, and market-segment opportunities from repeated weaknesses, recommendation effectiveness, industry leakage, and adoption behavior.

## Scheduling

`iireWorker.ts` runs inside the API process and executes due internal report schedules. Schedules are persisted in `InternalReportSchedule`, generated reports are persisted in `InternalIntelligenceReport`, and scan persistence also triggers an event-triggered internal report in the background.

## Access Boundary

IIRE routes live under `/api/internal/iire` and require `SYSTOLAB_INTERNAL_ADMIN_KEY`. They should not be used by customer dashboards, white-label clients, public API consumers, or tenant-facing reports.
