# Visitor Intelligence Layer (VIL) — Operations Runbook

## 1. Architecture Overview

The Visitor Intelligence Layer sits between the Evidence Layer and the Intelligence Layer in the SYSTOLAB processing pipeline:

```
Identity Layer
  → Data Layer
    → Evidence Layer
      → Visitor Intelligence Layer (VIL)   ← THIS SUBSYSTEM
        → Intelligence Layer
          → Revenue Intelligence Layer
            → Action Layer
              → Validation Layer
```

VIL's job is to continuously collect, structure, analyze, and transform visitor interactions into evidence-backed behavioral intelligence consumed by downstream intelligence systems. VIL never produces recommendations — it produces Behavioral Evidence Objects that feed into the Intelligence Layer.

---

## 2. Behavioral Consent Framework

Consent validation is the first gate in every VIL data flow. No session is created and no behavioral event is stored until the visitor's consent has been validated. This prevents compliance headaches before they start.

### Required Flow

```
Visitor Arrives
      ↓
Consent Validation        ← POST /api/vil/consent
      ↓
Session Capture           ← POST /api/vil/session  (blocked until consent passes)
      ↓
Behavior Tracking         ← POST /api/vil/session/:id/events  (re-validated per request)
```

### Consent Methods

| Method | Description | GDPR Compliant |
|---|---|---|
| `explicit` | Visitor actively clicked "Accept" | Yes |
| `implied` | Visitor continued browsing with visible notice | Jurisdiction-dependent |
| `opt-out` | Tracking on by default; visitor must actively opt out | No (not GDPR/CCPA compliant alone) |

SYSTOLAB stores which method was used and timestamps it in the immutable audit trail. The client is responsible for choosing the correct method per applicable law.

### Consent Categories

| Category | Field | VIL Requirement |
|---|---|---|
| Behavioral tracking | `categories.behavioral` | **Must be `true`** for any VIL session or event |
| Analytics | `categories.analytics` | Optional |
| Marketing | `categories.marketing` | Optional — not used by VIL directly |

### Consent Lifecycle

```
recordConsent({ consentGiven: true, categories: { behavioral: true } })
  → consentId, visitorId

→ Use visitorId + consentId to create sessions and ingest events

Privacy policy changes:
→ upgradeConsentVersion(visitorId, workspaceId, "2.0")
→ Client re-shows consent banner; visitor re-consents to new version

Visitor opts out:
→ DELETE /api/vil/consent/:visitorId   (revokes + purges behavioral data)
→ All future events on visitor's sessions blocked with 403 CONSENT_REVOKED
```

### Consent Record Retention

Consent records themselves must be retained for audit/compliance purposes even after behavioral data is purged. Do **not** delete `ConsentRecord` documents. Apply retention policies only to `BehavioralEvent` and `VisitorSession` data.

Under GDPR Article 7(1), the controller must be able to demonstrate that consent was given. The immutable `auditTrail` array in `ConsentRecord` serves this purpose.

### Consent Expiry

Default consent expiry: **395 days** (13 months — the GDPR maximum for consent-based cookies). After expiry:
- `validateConsentForTracking()` returns `{ allowed: false, code: "CONSENT_EXPIRED" }`
- Session creation is blocked with 403
- Client must re-show consent banner and call `POST /api/vil/consent` again

Custom expiry: pass `expiresInDays` in the `POST /api/vil/consent` body.

### Consent API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/vil/consent` | Record consent decision; returns `consentId` + `visitorId` |
| GET | `/api/vil/consent/:visitorId/status?workspaceId=` | Check current consent status |
| DELETE | `/api/vil/consent/:visitorId` | Revoke consent + purge behavioral data |
| PATCH | `/api/vil/consent/:visitorId/version` | Upgrade consent version after policy change |

### Consent Management (Admin)

| Method | Path | Description |
|---|---|---|
| GET | `/api/internal/platform/vil/consent/summary?workspaceId=` | Consent grant rate, revoked count, method breakdown |
| GET | `/api/internal/platform/vil/consent?workspaceId=` | List consent records |
| GET | `/api/internal/platform/vil/consent/:consentId` | Full consent record with audit trail |
| GET | `/api/internal/platform/vil/consent/check?visitorId=&workspaceId=` | Live consent status check |
| POST | `/api/internal/platform/vil/consent/purge` | Owner-only: force purge visitor data |

### Consent Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `CONSENT_REQUIRED` | 403 | No consent record exists for this visitor |
| `CONSENT_REVOKED` | 403 | Visitor has explicitly revoked consent |
| `CONSENT_EXPIRED` | 403 | Consent record has passed its expiry date |
| `BEHAVIORAL_CONSENT_NOT_GRANTED` | 403 | Consent record exists but `categories.behavioral` is `false` |

### SLA-6: Consent Validation Latency

Consent validation is in the critical path of session creation and every event batch. It must be fast.

| ID | Target | Alert |
|---|---|---|
| VIL-SLA-6 | Consent validation P95 < 50ms | warning |

In memory mode (no MongoDB) consent validation is a single `Map` lookup — sub-millisecond. With MongoDB, the `{ visitorId, workspaceId, isActive: 1 }` compound index ensures the lookup stays fast even at scale.

---

## 3. Engine Reference

| Engine | Source Events | Output Evidence Type | Status |
|---|---|---|---|
| Session Capture Engine | `page_view` | Visitor Session Record | Active |
| Journey Reconstruction Engine | All session events | `JourneyFingerprint` + archetype | Active |
| Scroll Intelligence Engine | `scroll_depth`, `scroll_pause`, `scroll_reversal`, `section_engagement` | `engagement_dropoff`, `scroll_avoidance` | Active |
| CTA Intelligence Engine | `cta_view`, `cta_hover`, `cta_click`, `cta_abandon` | `cta_friction` | Active |
| Form Intelligence Engine | `form_start`, `form_field_*`, `form_abandon`, `form_submit` | `form_abandonment` | Active |
| Friction Detection Engine | `rage_click`, `dead_click`, `hover_confusion`, `navigation_uncertainty` | `rage_click_cluster`, `dead_click_cluster`, `navigation_uncertainty` | Active |
| Exit Intelligence Engine | `exit_intent`, `page_exit` | `exit_concentration` | Active |
| Heatmap Intelligence Engine | `heatmap_point` | `trust_signal_avoidance` | Deferred |
| Visitor DNA Framework | Journey fingerprints | Visitor archetypes | Partial (rule-based active, ML deferred) |

---

## 3. Data Flow

```
Browser SDK
  → POST /api/vil/session              (create session)
  → POST /api/vil/session/:id/events   (batch event ingestion)
  → POST /api/vil/session/:id/end      (session end signal)
                ↓
         vilSessionService  ──────────→  VisitorSession (MongoDB / mem)
         vilEventService    ──────────→  BehavioralEvent (MongoDB / mem)
                ↓
         vilWorker (every 60s)
           → Journey reconstruction  →  JourneyFingerprint
           → Archetype classification → VisitorSession.visitorArchetype
                ↓
         vilWorker (every 5 min)
           → Evidence generation sweep
             · CTA friction evidence
             · Form abandonment evidence
             · Engagement dropoff evidence
             · Exit concentration evidence
             · Friction cluster evidence
           → BehavioralEvidence objects (MongoDB / mem)
                ↓
         Intelligence Layer
           → Consumes BehavioralEvidence.behavioralEvidenceId
           → Links via vilLineageService.linkEvidenceToIntelligence()
                ↓
         Recommendation Effectiveness Database
           → recordRecommendationApplication()
           → setBaselineMetrics() (before behavioral metrics)
           → recordOutcomeMetrics() (after behavioral metrics)
           → validateEffectiveness() (computes delta + success flag)
```

---

## 4. SLA Definitions

| ID | Name | Target | Alert Severity |
|---|---|---|---|
| VIL-SLA-1 | Event ingestion latency P95 | < 200ms | warning |
| VIL-SLA-2 | Journey reconstruction lag P95 | < 60s | warning |
| VIL-SLA-3 | Evidence generation sweep duration P95 | < 5 minutes | warning |
| VIL-SLA-4 | Session expiry recency | Within last 30 minutes | warning |
| VIL-SLA-5 | VIL worker heartbeat | < 90s since last tick | critical |
| VIL-SLA-6 | Consent validation latency P95 | < 50ms | warning |

Check current SLA status:
```
GET /api/internal/platform/vil/sla
Authorization: Bearer <admin-token>
```

Response includes `sla.healthy` boolean and per-SLA breakdown with current vs. target values.

---

## 5. Behavioral Confidence Engine

Every Behavioral Evidence Object carries three confidence fields:

| Field | Description |
|---|---|
| `confidenceScore` | 0–100 composite score. Combines sample size (50 pts), historical consistency (40 pts), rate extremeness (10 pts) |
| `consistencyLevel` | `low` / `medium` / `high` — based on coefficient of variation across historical rates |
| `statisticalSignificance` | `true` when sample ≥ 30 AND confidenceScore ≥ 50 |

**Thresholds for downstream consumption:**
- `confidenceScore >= 70` + `statisticalSignificance = true` → safe to feed into Revenue Intelligence
- `confidenceScore 40–69` → surface to Intelligence Layer with low-confidence flag
- `confidenceScore < 40` → retain for trend tracking; do not drive recommendations

---

## 6. Visitor Frustration Score (VFS)

Composite metric computed per session from raw events. Range: 0–100.

| Component | Weight | Cap |
|---|---|---|
| Rage clicks | 20 pts each | 60 |
| Dead clicks | 10 pts each | 30 |
| Hover confusion events | 5 pts each | 15 |
| Navigation uncertainty events | 8 pts each | 24 |
| Form abandonments | 15 pts each | 30 |
| Rapid exits (< 10s dwell) | 20 pts each | 40 |

VFS is computed on-demand via:
```
GET /api/internal/platform/vil/vfs/:sessionId
```

Response includes `vfsScore` (0–100) and `breakdown` object with per-component contributions.

---

## 7. Behavioral Lineage

Every Behavioral Evidence Object is traceable through a 4-layer chain:

```
Revenue Alert / Recommendation (Intelligence Layer)
  └─ IntelligenceLineageRecord.lineageId
       └─ BehavioralLineageRecord (vilLineageService)
            └─ BehavioralEvidence (vil_bev_*)
                 └─ Visitor Session cluster (vil_ses_*)
                      └─ Raw BehavioralEvents (vil_evt_*)
```

Trace any evidence object:
```
GET /api/internal/platform/vil/evidence/:behavioralEvidenceId/lineage
```

Link evidence to a downstream intelligence artifact after it is consumed:
```typescript
await linkEvidenceToIntelligence(
  behavioralEvidenceId,
  intelligenceLineageId,
  "recommendation",  // or "revenue_alert" | "insight"
  workspaceId,
  tenantSlug
);
```

---

## 8. Recommendation Effectiveness Database

Tracks whether applied recommendations generate measurable behavioral improvement.

**Workflow:**
1. Recommendation generated by Intelligence Layer → call `recordRecommendationApplication()`
2. Capture baseline behavioral metrics → call `setBaselineMetrics()`
3. Client implements the recommendation (days/weeks later)
4. Capture outcome behavioral metrics → call `recordOutcomeMetrics()`
5. Validate improvement → call `validateEffectiveness()`
6. Aggregate stats update automatically across all workspaces

**View aggregate success rates:**
```
GET /api/internal/platform/vil/effectiveness/stats
GET /api/internal/platform/vil/effectiveness/top
```

**Improvement determination logic:**
- Positive signals (higher = better): `clickRate`, `completionRate`, `engagementScore`
- Negative signals (lower = better): `abandonRate`, `vfsScore`, `exitConcentrationRate`, `rageClickCount`
- A recommendation is marked `improved: true` when net behavioral delta is positive

---

## 9. Visitor DNA Archetypes

Current archetype classification is rule-based (v1). Full ML clustering is deferred.

| Archetype | Behavioral Pattern |
|---|---|
| `price_checker` | Visits pricing/plans pages within first 3 pages |
| `trust_seeker` | Views reviews/testimonials/case-studies before contacting |
| `research_visitor` | Reads blog/guides/resources without visiting contact pages |
| `conversion_ready` | Reaches contact/demo/trial within 5 pages |
| `frustrated_visitor` | High page count (>10), error pages, or back-navigation |

Archetype distribution by workspace:
```
GET /api/internal/platform/vil/archetypes?workspaceId=<id>
```

**Deferred (Visitor DNA Framework v2):** ML-based clustering over `patternHash` distributions, cross-industry behavioral benchmarking, predictive behavioral modeling.

---

## 10. API Reference

### Ingest API (Public — no auth required, workspaceId validated)

| Method | Path | Description |
|---|---|---|
| POST | `/api/vil/consent` | Record consent decision |
| GET | `/api/vil/consent/:visitorId/status` | Check consent status |
| DELETE | `/api/vil/consent/:visitorId` | Revoke consent + purge data |
| PATCH | `/api/vil/consent/:visitorId/version` | Upgrade consent version |
| POST | `/api/vil/session` | Create visitor session (consent required) |
| PATCH | `/api/vil/session/:id` | Update session scores |
| POST | `/api/vil/session/:id/end` | End session |
| POST | `/api/vil/session/:id/event` | Ingest single event |
| POST | `/api/vil/session/:id/events` | Batch ingest (max 100) |

### Management API (Admin auth required)

| Method | Path | Description |
|---|---|---|
| GET | `/api/internal/platform/vil/consent/summary` | Consent grant rate, method breakdown |
| GET | `/api/internal/platform/vil/consent` | List consent records |
| GET | `/api/internal/platform/vil/consent/:consentId` | Consent record with audit trail |
| GET | `/api/internal/platform/vil/consent/check` | Live consent status check |
| POST | `/api/internal/platform/vil/consent/purge` | Force purge visitor data (owner only) |
| GET | `/api/internal/platform/vil/sessions` | List sessions for workspace |
| GET | `/api/internal/platform/vil/archetypes` | Archetype distribution |
| GET | `/api/internal/platform/vil/evidence` | List behavioral evidence |
| GET | `/api/internal/platform/vil/evidence/:id` | Get evidence by ID |
| GET | `/api/internal/platform/vil/evidence/:id/lineage` | Full lineage trace |
| GET | `/api/internal/platform/vil/lineage` | List lineage for workspace |
| GET | `/api/internal/platform/vil/vfs/:sessionId` | Compute session VFS |
| POST | `/api/internal/platform/vil/evidence/generate` | Trigger evidence sweep |
| GET | `/api/internal/platform/vil/event-counts` | Event type counts |
| GET | `/api/internal/platform/vil/sla` | SLA status + metrics |
| GET | `/api/internal/platform/vil/effectiveness` | List effectiveness records |
| GET | `/api/internal/platform/vil/effectiveness/stats` | Aggregate stats |
| GET | `/api/internal/platform/vil/effectiveness/top` | Top performing types |
| POST | `/api/internal/platform/vil/effectiveness` | Record application |
| POST | `/api/internal/platform/vil/effectiveness/:id/validate` | Validate outcome |

---

## 11. Operational Procedures

### Checking VIL health
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.systolab.com/api/internal/platform/vil/sla
```

### Manually triggering evidence generation for a workspace
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"ws_xxx","tenantSlug":"acme","windowDays":7}' \
  https://api.systolab.com/api/internal/platform/vil/evidence/generate
```

### Investigating a VIL SLA breach

1. Check which SLA is failing: `GET /api/internal/platform/vil/sla`
2. For **VIL-SLA-5** (worker heartbeat): check server logs for `vil.worker.started` on startup; if missing, the server likely restarted without the worker starting
3. For **VIL-SLA-4** (session expiry): confirm the worker interval is firing via `vil.worker.session_expiry` log entries
4. For **VIL-SLA-1** (latency): check `/metrics` endpoint for `vil_event_ingestion_latency_ms` histogram
5. All VIL SLA breaches create a `PlatformAlertRecord` — visible via `GET /api/internal/platform/alerts`

### Worker not starting
The `startVilWorker()` is called in `server.ts` inside the `app.listen` callback. If the server starts but the worker logs don't appear:
- Confirm `vil.worker.started` appears in stdout within 5s of server start
- Verify no uncaught exception silenced the worker bootstrap
- Check that `SYSTOLAB_MEMORY_STORE=true` is not set in production (it is for tests only)

### Sessions returning 403 CONSENT_REQUIRED

1. Confirm the client calls `POST /api/vil/consent` before `POST /api/vil/session`
2. Confirm `consentGiven: true` AND `categories.behavioral: true` are sent in the consent payload
3. Check consent record: `GET /api/internal/platform/vil/consent/check?visitorId=<id>&workspaceId=<id>`
4. If `CONSENT_EXPIRED`: consent is older than 395 days — client must re-show banner and re-collect
5. If `CONSENT_REVOKED`: visitor has opted out — respect this; do not attempt to re-create consent without user action

### Auditing consent for a specific visitor (GDPR Subject Access Request)

1. Obtain the `visitorId` from the client-side cookie or from the client application's user record
2. `GET /api/internal/platform/vil/consent/check?visitorId=<id>&workspaceId=<id>` — current status
3. `GET /api/internal/platform/vil/consent?workspaceId=<id>` — all records for workspace (filter by visitorId)
4. The `auditTrail` array in each `ConsentRecord` contains the full history of consent changes

### Handling a right-to-erasure request (GDPR Article 17 / CCPA)

1. Identify the `visitorId` from the client application
2. `POST /api/internal/platform/vil/consent/purge` with `{ visitorId, workspaceId }` — owner role required
3. This marks all sessions as expired and clears all `BehavioralEvent.data` payloads for the visitor
4. The `ConsentRecord` itself is **retained** (required for demonstrating compliance with Article 7)
5. Log the purge action in your internal GDPR request tracking system

### Evidence not being generated
1. Verify sessions exist: `GET /api/internal/platform/vil/sessions?workspaceId=<id>`
2. Verify events exist: `GET /api/internal/platform/vil/event-counts?workspaceId=<id>`
3. Check minimum thresholds: CTA friction requires ≥5 `cta_view` events; form abandonment requires ≥3 `form_start` events; friction clusters require ≥3 rage clicks or ≥5 dead clicks
4. Manually trigger: `POST /api/internal/platform/vil/evidence/generate`

---

## 12. Metrics

VIL writes to the in-process metrics registry (no external dependencies). Available via `GET /metrics`:

| Metric | Type | Description |
|---|---|---|
| `vil_events_ingested_total` | counter | Total behavioral events ingested |
| `vil_sessions_expired_total` | counter | Sessions expired by the worker |
| `vil_event_ingestion_latency_ms` | histogram | End-to-end event ingestion latency |
| `vil_journey_reconstruction_ms` | histogram | Journey reconstruction duration |
| `vil_evidence_sweep_ms` | histogram | Evidence generation sweep duration |
| `vil_last_session_expiry_ts` | gauge | Unix timestamp of last expiry run |
| `vil_worker_last_heartbeat_ts` | gauge | Unix timestamp of last worker heartbeat |
| `vil_consent_validations_total` | counter | Total consent checks performed |
| `vil_consent_validation_latency_ms` | histogram | Consent validation latency |
| `vil_sla_healthy` | gauge | 1 if all SLAs passing, 0 if any breach |
| `vil_sla_breach_total` | counter | Cumulative count of SLA breaches |

---

## 13. Privacy and Consent

- VIL collects **behavioral** data only — page paths, scroll depths, click coordinates, timing. No PII is stored by the VIL engines themselves.
- `visitorId` is a client-generated pseudonymous identifier. VIL does not link it to user accounts.
- UTM parameters and referral sources are stored on the session but contain no PII.
- `country`, `region`, `city` are coarse geolocation fields — not precise coordinates.
- Consent signal: the client-side tracking SDK must check consent before calling `/api/vil/session`. VIL does not enforce consent server-side; that responsibility belongs to the embedding client.
- Retention: VIL session and event data should be covered by the existing RetentionPolicy system. Apply a workspace-scoped retention policy to the `visitor_sessions` and `behavioral_events` collections.

---

## 14. Deferred Features (Architecture Defined, Not Yet Active)

The following are architecturally defined in the codebase but require explicit activation:

| Feature | Status | Notes |
|---|---|---|
| Heatmap Intelligence Engine | Deferred | `heatmap_point` events are accepted and stored but not yet processed into evidence |
| Visitor DNA Framework v2 | Deferred | Rule-based v1 active; ML clustering over `patternHash` distributions is the v2 target |
| Cross-industry behavioral benchmarking | Deferred | Requires multi-tenant aggregation across workspaces |
| Predictive behavioral modeling | Deferred | Requires sufficient historical journey fingerprint volume |
| Revenue Leakage correlation | Deferred | Link VFS + exit concentration to Revenue Intelligence Engine estimates |

To activate a deferred feature: implement the processing logic in the relevant service (e.g. `vilEventService` for heatmap aggregation), add evidence type to `generateEvidence*` functions in `vilEvidenceService.ts`, and update this runbook.
