# CIIF Runbook — Continuous Intelligence Improvement Framework

## 1. Overview

The SYSTOLAB Continuous Intelligence Improvement Framework (CIIF) is a cross-platform learning and validation mechanism that makes the platform progressively more accurate, evidence-driven, and outcome-oriented over time. It operates as a meta-layer across the Evidence Layer, VIL, Revenue Intelligence, and Intelligence Layers — it does not replace any existing component, it extends them.

**Architecture position:**

```
Identity → Data → Evidence → VIL → Intelligence → Revenue Intelligence
               ↗                                         ↓
         CIIF ←────────────────── Validation Feedback ──┘
         (Business DNA, Visitor DNA, Evidence Quality, Opportunity Discovery, KGS)
```

**Core outputs:**
- **KGS** — Knowledge Growth Score: composite platform intelligence maturity (0-100)
- **VRSR** — Validated Recommendation Success Rate: % of implemented recommendations producing validated positive outcomes
- **Evidence Quality Classification** — standardised quality tier on every piece of evidence
- **Business DNA** — longitudinal business profile per workspace
- **Visitor DNA** — formal archetype profiles per workspace
- **Opportunity Discovery** — prioritised opportunity backlog
- **Agency Intelligence Report** — human-readable cross-workspace intelligence summary

---

## 2. Component Reference

| Component | File | ID Prefix | Description |
|---|---|---|---|
| Evidence Quality Service | `evidenceQualityService.ts` | — | Classifies all evidence with quality tier |
| Business DNA Engine | `businessDnaService.ts` | `ciif_dna_*` | Longitudinal business profiles |
| Visitor DNA Framework | `visitorDnaService.ts` | `ciif_vdna_*` | Formal archetype profiles |
| Intelligence Validation Engine | `intelligenceValidationService.ts` | `ciif_val_*` | Validates predictions vs outcomes |
| Opportunity Discovery Engine | `opportunityDiscoveryService.ts` | `ciif_opp_*` | Prioritised opportunity backlog |
| CIIF Service | `ciifService.ts` | `ciif_kgs_*` | KGS computation, agency reporting |

---

## 3. Evidence Quality Classification

All evidence objects (both `EvidenceRecord` and `BehavioralEvidence`) are classified using a 6-factor scoring system:

| Factor | Weight | Description |
|---|---|---|
| Data Volume | 0-25 pts | Sample size driving the evidence |
| Statistical Significance | 0-25 pts | Whether n≥30 and confidence≥50 |
| Source Reliability | 0-20 pts | behavioral > scan > synthesized > competitive |
| Behavioral Consistency | 0-15 pts | Signal consistency across time windows |
| Validation History | 0-10 pts | % of prior validations that succeeded |
| Completeness | 0-5 pts | All expected fields populated |

**Classification thresholds:**

| Class | Score Range | Meaning |
|---|---|---|
| `low` | 0-29 | Insufficient data or unreliable source |
| `medium` | 30-59 | Usable but treat with caution |
| `high` | 60-84 | Well-supported, can drive recommendations |
| `verified` | 85-100 | Validated, consistent, statistically significant |

**Fields added to evidence objects:**
- `EvidenceRecord`: `qualityClass`, `qualityScore`, `qualityReason`, `qualityEvaluatedAt`
- `BehavioralEvidence`: `qualityClass`, `qualityScore`

**Batch classification:** `POST /api/internal/platform/ciif/evidence-quality/classify-behavioral` classifies all unclassified behavioral evidence for a workspace.

---

## 4. Business DNA Engine

The Business DNA Engine builds a longitudinal profile of each workspace over time, accumulating patterns across multiple scans and capturing trajectory information not visible in any single snapshot.

**Profile accumulation:**
1. Each scan triggers `updateDnaFromScan()` — scores are appended to `scoreHistory[]`
2. VIL behavioral signals update the profile via `updateDnaFromBehavioralData()`
3. Recommendation outcomes update `implementationRate` and `avgEffectivenessScore`

**Score trend computation** (last 6 snapshots):
- `improving` — positive deltas dominate
- `declining` — negative deltas dominate
- `volatile` — average absolute delta > 15 OSS points
- `stable` — neither trend is dominant

**Maturity levels:**

| Level | Requirement |
|---|---|
| `early` | < 3 scans |
| `developing` | ≥ 3 scans |
| `mature` | ≥ 6 scans, avg OSS ≥ 50, implementation rate ≥ 25% |
| `optimized` | ≥ 12 scans, avg OSS ≥ 70, implementation rate ≥ 50% |

**Admin routes:**
- `GET /api/internal/platform/ciif/business-dna?tenantSlug=` — list all DNA records
- `GET /api/internal/platform/ciif/business-dna/:workspaceId` — get specific DNA record
- `PATCH /api/internal/platform/ciif/business-dna/:workspaceId/behavioral` — update behavioral signals

---

## 5. Visitor DNA Framework

Extends the VIL rule-based archetype stubs into formal, statistically-measured profile records. One `VisitorDnaRecord` exists per archetype per workspace, refreshed from session summaries.

**Archetypes:**

| Archetype | Label | Behavioural Signal |
|---|---|---|
| `trust_seeker` | Trust Seeker | Navigates testimonials, credentials, case studies |
| `price_checker` | Price Checker | Returns to pricing page, compares |
| `research_visitor` | Research Visitor | High pages, high dwell, low conversion |
| `conversion_ready` | Conversion Ready | Short path to CTA, low VFS |
| `returning_visitor` | Returning Visitor | Pattern-matched to prior session data |
| `frustrated_visitor` | Frustrated Visitor | Elevated VFS score |
| `unclassified` | Unclassified | No pattern matched |

**Confidence scoring:**
- Sample score (0-50): proportional to session count (saturates at 100 sessions)
- Share score (0-30): proportional to % share of total sessions (saturates at 30%)
- Dwell consistency (0-20): 20 pts if CV < 0.3, else 10 pts
- Statistical significance: `sessionCount >= 30 && confidenceScore >= 50`

**Admin routes:**
- `GET /api/internal/platform/ciif/visitor-dna?workspaceId=` — all archetype profiles + distribution
- `GET /api/internal/platform/ciif/visitor-dna/:workspaceId/:archetype` — specific archetype

---

## 6. Intelligence Validation Engine

Validates intelligence artifacts (recommendations, benchmarks, revenue estimates, behavioral inferences, confidence scores) by comparing predicted outcomes to actual outcomes after the fact.

**Calibration statuses:**

| Status | Meaning |
|---|---|
| `well_calibrated` | Confidence drift ≤ 10 points |
| `overconfident` | Stated confidence exceeded accuracy by > 10 points |
| `underconfident` | Stated confidence underestimated accuracy by > 10 points |
| `insufficient_data` | No outcome data available yet |

**`confidenceDrift`** = `predictedConfidence - actualAccuracyScore` (positive = overconfident)

**Accuracy score computation:**
- For numeric outcomes: 1 - (normalised absolute error), averaged across all numeric keys
- For non-numeric: proportion of matching key/value pairs

**`actionRequired`** is set to `true` when `calibrationStatus != well_calibrated && |confidenceDrift| > 20`.

**VRSR computation** (`computeVrsr(workspaceId)`):
- When MongoDB connected: delegates to `recommendationEffectivenessService.getEffectivenessStats()`
- Memory fallback: counts validation records where `artifactType === "recommendation" && accuracyScore >= 70`

**Admin routes:**
- `GET /api/internal/platform/ciif/validation?workspaceId=` — list validations (filterable by type, calibration, actionRequired)
- `GET /api/internal/platform/ciif/validation/stats?workspaceId=` — accuracy breakdown
- `POST /api/internal/platform/ciif/validation` — record a validation
- `GET /api/internal/platform/ciif/vrsr?workspaceId=` — current VRSR

---

## 7. Opportunity Discovery Engine

Maintains a prioritised backlog of improvement opportunities across all types.

**Opportunity types:** `quick_win`, `high_impact`, `long_term`, `competitive`, `behavioral`, `revenue`, `trust`, `conversion`

**Priority score (0-100):**
```
revenue weight (0-40) + confidence (0-30) + effort inverse (0-20) + type bonus (0-10)
```

| Effort | Score |
|---|---|
| `low` | 20 pts |
| `medium` | 12 pts |
| `high` | 4 pts |

| Type | Bonus |
|---|---|
| `quick_win` | +10 |
| `high_impact`, `revenue` | +8 |
| `behavioral`, `conversion` | +6 |
| `competitive`, `trust` | +4 |
| `long_term` | +2 |

**Auto-discovery** (`discoverOpportunities(ctx)`): given scan context, automatically creates prioritised opportunities:
- avgVFS > 40 + behavioral evidence → `quick_win` (reduce friction)
- OSS < 50 + recurring weaknesses → `high_impact` (address weaknesses)
- Top exit pages → `conversion` (optimise exit pages)
- Competitor gaps → `competitive` (close gaps)

**Status lifecycle:** `active → in_progress → completed | dismissed`

**Admin routes:**
- `GET /api/internal/platform/ciif/opportunities?workspaceId=` — list (filterable)
- `GET /api/internal/platform/ciif/opportunities/stats?workspaceId=` — aggregate stats
- `POST /api/internal/platform/ciif/opportunities` — create manually
- `PATCH /api/internal/platform/ciif/opportunities/:id/status` — update status
- `POST /api/internal/platform/ciif/opportunities/discover` — run auto-discovery

---

## 8. Knowledge Growth Score (KGS)

KGS is the primary metric for platform intelligence maturity. It is a weighted composite (0-100) of 5 component scores:

| Component | Weight | Source |
|---|---|---|
| Recommendation Effectiveness | 30% | VRSR |
| Evidence Quality | 25% | Average quality distribution across all evidence |
| Behavioral Intelligence | 20% | VIL coverage and archetype confidence |
| Validation Accuracy | 15% | Intelligence Validation Engine avg accuracy |
| Business DNA Coverage | 10% | % workspaces with DNA profiles |

**KGS Trend:**
- `growing` — current KGS ≥ previous + 3 points
- `declining` — current KGS ≤ previous − 3 points
- `stable` — within ±3 points of previous

**VRSR (Validated Recommendation Success Rate):**
- Primary executive metric
- Formula: `(totalRecommendationsSuccessful / totalRecommendationsValidated) × 100`
- Target: ≥ 70% VRSR for a mature platform

**Admin routes:**
- `GET /api/internal/platform/ciif/kgs` — latest KGS snapshot
- `GET /api/internal/platform/ciif/kgs/history` — history
- `POST /api/internal/platform/ciif/kgs/snapshot` — compute and persist a new snapshot
- `GET /api/internal/platform/ciif/report?workspaceId=` — agency intelligence report

---

## 9. Agency Intelligence Report

The agency intelligence report is a human-readable summary combining KGS, VRSR, opportunity stats, and confidence transparency into a structured report for agency or client delivery.

**Report structure:**
```json
{
  "generatedAt": "...",
  "headline": "Intelligence ↑ Growing — KGS 74/100, VRSR 78%",
  "kgsScore": 74,
  "kgsTrend": "growing",
  "vrsr": 78,
  "keyMetrics": [...],
  "topInsights": [...],
  "actionItems": [...],
  "confidenceTransparency": {
    "overallCalibrationStatus": "well_calibrated",
    "overconfidentArtifacts": 2,
    "adjustmentsRecommended": 1
  }
}
```

**Confidence Transparency:** Every report surfaces `confidenceTransparency` — the number of artifacts where the platform claimed higher confidence than the actual outcome justified. This prevents silent drift toward overconfidence and maintains client trust.

---

## 10. API Reference

All CIIF routes are under `/api/internal/platform/ciif/` and require `owner` or `manager` role.

### KGS

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/kgs` | Latest KGS snapshot |
| GET | `/ciif/kgs/history` | Historical KGS snapshots |
| POST | `/ciif/kgs/snapshot` | Compute and save new KGS snapshot |
| GET | `/ciif/report` | Agency intelligence report |
| GET | `/ciif/vrsr` | Current VRSR for a workspace |

### Business DNA

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/business-dna` | List all DNA records (by tenantSlug) |
| GET | `/ciif/business-dna/:workspaceId` | Get specific DNA record |
| PATCH | `/ciif/business-dna/:workspaceId/behavioral` | Update behavioral signals |

### Visitor DNA

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/visitor-dna` | List archetype profiles + distribution |
| GET | `/ciif/visitor-dna/:workspaceId/:archetype` | Specific archetype profile |

### Intelligence Validation

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/validation` | List validations (filterable) |
| GET | `/ciif/validation/stats` | Accuracy breakdown |
| POST | `/ciif/validation` | Record a validation |

### Opportunity Discovery

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/opportunities` | List opportunities |
| GET | `/ciif/opportunities/stats` | Aggregate stats |
| POST | `/ciif/opportunities` | Create opportunity |
| PATCH | `/ciif/opportunities/:id/status` | Update status |
| POST | `/ciif/opportunities/discover` | Auto-discover from scan context |

### Evidence Quality

| Method | Path | Description |
|---|---|---|
| GET | `/ciif/evidence-quality/stats` | Quality distribution stats |
| POST | `/ciif/evidence-quality/classify` | Classify a specific evidence record |
| POST | `/ciif/evidence-quality/classify-behavioral` | Batch classify all unclassified behavioral evidence |

---

## 11. Data Models

| Model | Collection | ID Prefix | One-per |
|---|---|---|---|
| `BusinessDnaRecord` | BusinessDnaRecord | `ciif_dna_*` | workspace |
| `VisitorDnaRecord` | VisitorDnaRecord | `ciif_vdna_*` | workspace+archetype |
| `IntelligenceValidationRecord` | IntelligenceValidationRecord | `ciif_val_*` | validation event |
| `OpportunityRecord` | OpportunityRecord | `ciif_opp_*` | opportunity |
| `KnowledgeGrowthRecord` | KnowledgeGrowthRecord | `ciif_kgs_*` | period snapshot |

---

## 12. Operational Procedures

### Running a KGS snapshot

```bash
curl -X POST /api/internal/platform/ciif/kgs/snapshot \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "ws_abc", "totalWorkspaces": 42}'
```

The snapshot captures all 5 component scores and persists them. Run monthly or after major recommendation implementation batches.

### Running opportunity auto-discovery

```bash
curl -X POST /api/internal/platform/ciif/opportunities/discover \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws_abc",
    "tenantSlug": "acmecorp",
    "ossScore": 42,
    "weaknesses": ["missing trust signals", "no social proof"],
    "avgVfsScore": 55,
    "topExitPages": ["/pricing", "/about"],
    "behavioralEvidenceIds": ["vil_bev_xxx"]
  }'
```

Returns `{"opportunitiesCreated": N}`.

### Batch classifying evidence quality

```bash
curl -X POST /api/internal/platform/ciif/evidence-quality/classify-behavioral \
  -d '{"workspaceId": "ws_abc"}'
```

Scans all `BehavioralEvidence` records missing `qualityClass` and backfills them. Safe to run repeatedly.

### Recording an intelligence validation

After a recommendation is implemented and outcomes are measured:

```bash
curl -X POST /api/internal/platform/ciif/validation \
  -d '{
    "workspaceId": "ws_abc",
    "tenantSlug": "acmecorp",
    "artifactType": "recommendation",
    "artifactId": "rec_xyz",
    "predictedOutcome": {"clickRate": 0.12, "conversionRate": 0.035},
    "actualOutcome": {"clickRate": 0.10, "conversionRate": 0.038},
    "predictedConfidence": 70
  }'
```

---

## 13. Confidence Transparency

Every recommendation and intelligence output carries a `predictedConfidence` value. CIIF tracks actual accuracy after outcomes resolve and computes `confidenceDrift`. The agency report always surfaces:

- How many artifacts were overconfident
- How many adjustments are recommended
- Overall calibration status

**Target:** All artifacts should be `well_calibrated` — confidence drift ≤ 10 points in either direction.

If `overconfidentArtifacts > 5` in a report period, investigate whether the scoring methodology needs recalibration (check `IntelligenceValidationRecord` for `actionRequired: true` entries).

---

## 14. Metrics

| Metric | Target | Source |
|---|---|---|
| KGS | ≥ 60 for mature platform | `KnowledgeGrowthRecord.kgsScore` |
| VRSR | ≥ 70% | `recommendationEffectivenessService.successRate` |
| Evidence Quality — verified | ≥ 20% | `BehavioralEvidence.qualityClass = "verified"` |
| Validation accuracy | ≥ 75 avg | `IntelligenceValidationRecord.accuracyScore` |
| Overconfident artifacts | < 10% | `IntelligenceValidationRecord.calibrationStatus` |
| Open opportunities | < 20 at any time | `OpportunityRecord.status = "active"` |

---

## 15. Deferred Features

| Feature | Notes |
|---|---|
| ML-based archetype clustering | Currently rule-based; v2 will use session embedding clustering |
| Automated KGS snapshots via worker | Snapshots are currently triggered manually; a cron entry can be added to `vilWorker.ts` |
| Cross-workspace KGS aggregation | Current KGS operates per-workspace; platform-level KGS can aggregate across all workspaces |
| Opportunity ML ranking | Priority score is currently rule-based; ML ranking can be added once enough completion data exists |
