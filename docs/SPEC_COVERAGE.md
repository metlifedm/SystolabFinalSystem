# SYSTOLAB Specification Coverage

SYSTOLAB is governed by the Zero-Omission Development Principle from the supplied product document. Every major requirement must be assigned one of four statuses: `Implemented`, `Partially Implemented`, `Planned`, or `Deprecated`.

The executable source of truth lives in [specCoverage.ts](../apps/api/src/specCoverage.ts).

Run:

```bash
npm run coverage:spec
```

## Current Coverage Themes

| Area | Status | Notes |
| --- | --- | --- |
| MERN architecture | Implemented | Monorepo contains Express/Mongo API, React web app, and shared contracts. |
| Deterministic crawling | Implemented | HTTP fetch, robots.txt evaluation, resource bounds, deterministic high-value page selection. |
| Evidence Objects | Partially Implemented | Raw DOM snippets, selectors, hashes, validation method, and confidence exist. Headless screenshots are planned. |
| Operational dimensions | Implemented | Core dimensions plus Conversion Readiness and Information Clarity. |
| Visual Intelligence Framework | Implemented | Canonical score-to-state mapping in shared package. |
| Verification Core / Ground Truth Validation | Partially Implemented | Validation trace and confidence exist; multi-source browser validation remains planned. |
| Public SYSTOLAB API | Implemented | `/v1/scans` and `/v1/snapshots/:id` with API-key middleware. |
| White labeling | Implemented | Tenant model and branding contract affect UI/PDF/report metadata. |
| GBP enrichment | Implemented | Public-page extraction, identity score, confidence, completeness, limitations, and evidence IDs are displayed without affecting OSS. |
| Competitor comparison | Implemented | Client-vs-competitor OSS, dimension rows, difference counts, evidence IDs, and failed/limited competitor rows are displayed. |
| Business Risk Status | Implemented | Dedicated section with structural risk level, primary risk driver, explanation, and evidence IDs. |
| Business Outcome Bridge | Implemented | Structural findings map to business outcome implications and opportunity ranges without revenue guarantees. |
| Transformation Intelligence | Implemented | Current OSS, projected OSS, projected delta, and dimension-level projections are displayed. |
| Closed-Loop Proof | Implemented | Baseline state is displayed and prepared for before/after delta comparison after re-scan. |
| Priority Timeline | Implemented | Recommendations are grouped into FIX NOW, THIS MONTH, and MONITOR. |
| Market Readiness | Implemented | Benchmark positions are shown as Not Assessed when benchmark coverage is low instead of approximated. |
| Evidence Coverage | Implemented | Per-page evidence coverage summary is displayed. |
| Data Freshness | Implemented | Capture timestamp, cache status, validity window, staleness risk, and next scan timing are displayed. |
| Benchmark Validation Layer | Partially Implemented | Internal record model exists; benchmark claims are disabled until dataset coverage is sufficient. |
| PDF reports | Partially Implemented | PDF generation exists; pixel-identical UI rendering and screenshot cards are planned. |

## Non-Negotiable Language Rule

Reports must use evidence-strength and structural diagnostic language. The product must avoid unsupported claims such as actual revenue loss, guaranteed conversion uplift, ranking position, business profitability, future outcomes, or user behavior measurement unless future versions ingest verified first-party data.
