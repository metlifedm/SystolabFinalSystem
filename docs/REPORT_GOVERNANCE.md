# SYSTOLAB Report Governance

SYSTOLAB reports are deterministic audit artifacts. The primary customer web UI, PDF export, and white-label tenant report render the full report with decision, insight, and proof layers. A compact Customer Intelligence Plane remains available through the Decision Compression Layer for API consumers that need a smaller decision object.

## SYSTEM RULES

- Do not use Google APIs, paid SEO APIs, analytics APIs, AI scoring APIs, or external performance APIs.
- Generate findings only from observable HTTP, DOM, HTML, render-classification, public GBP page, and public competitor page evidence.
- Every action must contain one issue, one explanation, one executable fix, and one evidence cluster.
- Every score must include numeric value, Visual Intelligence state, confidence, and EO references.
- OSS v1.0 scoring weights must remain stable unless the scoring engine version changes.

## OUTPUT FORMAT

Full reports render in this order:

1. Decision layer
2. Structured insight layer
3. Proof layer

Required decision-layer keys:

- `actionFirstPanel`
- `systemVerdict`
- `ossInterpretation`
- `verdictCard`
- `businessRiskStatus`

Required insight-layer keys:

- `businessVitalSigns`
- `dimensions`
- `businessOutcomeBridge`
- `priorityTimeline`
- `transformationIntelligence`
- `marketReadinessPosition`
- `gbpIdentity`
- `competitorComparison`

Required proof-layer keys:

- `evidenceObjects`
- `evidenceClusters`
- `groundTruthValidationLog`
- `validationTrace`
- `rawSignalTelemetry`
- `systemHealthState`
- `executionProvenance`
- `freshness`
- `integrity`

Compact decision-object outputs are limited to:

- `scan_id`
- `target`
- `risk_level`
- `time_sensitivity`
- `evidence_summary`
- `coverage_score`
- `confidence_score`
- `revenue_impact_range`
- `if_not_fixed_outcome`
- `recommended_action_window`
- `final_recommendation`
- `access_restriction_detected`
- `assessment_limitation`
- `impact`
- `evidence_heatmap_summary`

Server credentials, auth tokens, environment secrets, database secrets, and private infrastructure secrets must never render in any customer, API, PDF, or admin report output.

## CONSTRAINTS

- OSS means Observable Structural Score. It does not measure revenue, profit, ranking, traffic, sales activity, or conversion performance.
- Directional uplift ranges are structural readiness ranges only. They are not guarantees.
- GBP intelligence is supplementary identity context and must not affect OSS.
- Competitor comparison is a structural side-by-side. It must not declare rankings, winners, market position, traffic, or SEO superiority.
- Evidence IDs must remain complete in structured finding output for full reports.
- Customer-facing risk, business impact, conversion effect, user intent, and value-unit ranges must be directly supported by current validated evidence. Missing or blocked evidence must downgrade confidence.

## NON-OVERRIDABLE RULES

- Do not remove required full report sections from customer, PDF, white-label, or internal report output.
- Do not bypass the Decision Compression Layer for compact decision-object API routes.
- Do not rename OSS, GTCS, Visual Intelligence states, or priority timeline labels.
- Do not change OSS scoring weights without versioning the scoring engine.
- Do not merge competitor tables across domains.
- Do not skip evidence logs, validation traces, telemetry, data freshness, or integrity metadata in full reports.

## FALLBACK RULES

- If scan access is restricted, customer output must say: Access Restriction Detected: Yes; Assessment Limitation: The website restricted automated analysis before content could be collected; Impact: Website content could not be evaluated; Recommended Action: Review website security configuration and allow analysis access before re-scanning.
- If GBP extraction is limited, keep the section visible, surface limitations, and leave OSS unchanged.
- If competitor extraction fails, render a failed competitor block instead of hiding it.
- If evidence is insufficient, mark the finding confidence-limited instead of inventing a conclusion.

## REJECTION RULES

- Reject private, local, non-HTTP, and unsafe URLs before crawling.
- Reject untraceable findings that do not include EO references.
- Reject business-performance claims that imply revenue, profit, ranking, traffic, or conversion guarantees.

## OSS CALCULATION

OSS v1.0 is the weighted average of deterministic dimension scores:

- Trust: 16%
- Accessibility: 10%
- Rendering Quality: 10%
- Stability: 10%
- Mobile Experience: 14%
- Website Health: 12%
- Visibility Structure: 10%
- Conversion Readiness: 14%
- Information Clarity: 4%

Strict OSS interpretation:

- 0-39: Critical Structural Failure
- 40-74: Structural Friction
- 75-100: Minor Optimization Opportunities

Visual Intelligence states remain separate and canonical:

- Signal Red: 0-39
- Attention Amber: 40-59
- Visibility Gold: 60-74
- Stability Green: 75-89
- Assurance Emerald: 90-94
- Integrity Sapphire: 95-100
