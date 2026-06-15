# SYSTOLAB Revenue Intelligence Platform

SYSTOLAB is a MERN stack deterministic website diagnostic and decision support platform. It scans publicly observable website structure using owned crawling, parsing, scoring, validation, and report-generation logic. It does not call Google PageSpeed, SEO APIs, analytics APIs, AI APIs, or any paid third-party intelligence source.

## What is included in this first production foundation

- TypeScript monorepo with `apps/api`, `apps/web`, and `packages/shared`.
- Express API with MongoDB/Mongoose models for tenants, API keys, immutable snapshots, and benchmark records.
- SYSTOLAB Internal Truth Engine API with bounded crawling, robots.txt checks, evidence objects, score traces, validation logs, visual states, report sections, and integrity hashing.
- React interface for fast scan/full audit input, report rendering, evidence explorer, score trace, decision summary, and white-label-ready branding.
- Specification coverage registry so every major requirement is tracked as Implemented, Partially Implemented, Planned, or Deprecated.

## Quick start

```bash
npm install
docker compose up -d mongo
npm run build
npm run dev
```

API: `http://127.0.0.1:4100`

Web: `http://127.0.0.1:5173`

## Public API shape

The public SYSTOLAB API is exposed under `/v1` and requires `x-systolab-api-key`. In development, set `SYSTOLAB_DEV_API_KEY` in `.env`.

```bash
curl -X POST http://127.0.0.1:4100/v1/scans \
  -H "content-type: application/json" \
  -H "x-systolab-api-key: dev_systolab_key_change_me" \
  -d "{\"targetUrl\":\"https://example.com\",\"mode\":\"full_audit\"}"
```

See [docs/API.md](docs/API.md) and [docs/SPEC_COVERAGE.md](docs/SPEC_COVERAGE.md).
