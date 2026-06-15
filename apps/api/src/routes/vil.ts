import { Router } from "express";
import { getWorkspace } from "../services/membershipService.js";
import { createVisitorSession, endVisitorSession, updateVisitorSession } from "../services/vilSessionService.js";
import { ingestEvent, ingestEventBatch } from "../services/vilEventService.js";
import {
  recordConsent,
  revokeConsent,
  validateConsentForTracking,
  getConsentRecord,
  upgradeConsentVersion
} from "../services/vilConsentService.js";
import { recordEventIngestionLatency, recordConsentValidationLatency } from "../services/vilSlaService.js";
import { BehavioralEventType, EngineSource } from "../models/BehavioralEvent.js";
import { DeviceType } from "../models/VisitorSession.js";
import { sha256 } from "../utils/crypto.js";

export const vilRouter = Router();

// ── Behavioral Consent Framework ───────────────────────────────────────────────
//
// All VIL data collection is gated by consent. The required flow is:
//
//   Visitor Arrives
//     ↓
//   POST /api/vil/consent          ← record consent decision
//     ↓
//   POST /api/vil/session          ← validated against consent; creates session
//     ↓
//   POST /api/vil/session/:id/events  ← validated before accepting any behavioral data
//
// Revoking consent: DELETE /api/vil/consent/:visitorId
// After revocation all new events on the visitor's sessions are blocked
// and purgeVisitorData() is called to clear behavioral payload.

// POST /api/vil/consent
// Record a visitor's consent decision. Must be called before session creation.
// Returns a visitorId (new or provided) and consentId.
vilRouter.post("/consent", async (req, res) => {
  const {
    visitorId, workspaceId, tenantSlug,
    consentGiven, consentVersion, consentMethod,
    categories, expiresInDays
  } = req.body as Record<string, unknown>;

  if (!workspaceId || !tenantSlug || consentGiven === undefined) {
    res.status(400).json({
      error: { message: "workspaceId, tenantSlug, and consentGiven are required" }
    });
    return;
  }

  const ipRaw = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
  const ipHashAtConsent = sha256(typeof ipRaw === "string" ? ipRaw.split(",")[0]!.trim() : String(ipRaw));
  const userAgentHash = req.headers["user-agent"] ? sha256(req.headers["user-agent"]) : undefined;

  const t0 = Date.now();
  const { record, visitorId: resolvedVisitorId } = await recordConsent({
    visitorId: visitorId ? String(visitorId) : undefined,
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    consentGiven: Boolean(consentGiven),
    consentVersion: consentVersion ? String(consentVersion) : undefined,
    consentMethod: consentMethod as "explicit" | "implied" | "opt-out" | undefined,
    ipHashAtConsent,
    userAgentHash,
    categories: categories && typeof categories === "object"
      ? categories as Record<string, boolean>
      : undefined,
    expiresInDays: typeof expiresInDays === "number" ? expiresInDays : undefined
  });
  recordConsentValidationLatency(Date.now() - t0);

  const r = record as Record<string, unknown>;
  res.status(201).json({
    consentId: r["consentId"],
    visitorId: resolvedVisitorId,
    consentGiven: r["consentGiven"],
    consentVersion: r["consentVersion"],
    expiresAt: r["expiresAt"]
  });
});

// GET /api/vil/consent/:visitorId/status?workspaceId=
// Check whether a visitor has active behavioral consent for a workspace.
vilRouter.get("/consent/:visitorId/status", async (req, res) => {
  const workspaceId = String(req.query["workspaceId"] ?? "");
  if (!workspaceId) {
    res.status(400).json({ error: { message: "workspaceId query param is required" } });
    return;
  }

  const t0 = Date.now();
  const result = await validateConsentForTracking(req.params.visitorId!, workspaceId);
  recordConsentValidationLatency(Date.now() - t0);

  if (result.allowed) {
    res.json({ allowed: true, consentId: result.consentId, consentVersion: result.consentVersion });
  } else {
    res.json({ allowed: false, code: result.code, reason: result.reason });
  }
});

// DELETE /api/vil/consent/:visitorId
// Revoke consent. Triggers behavioral data purge on the visitor's sessions.
vilRouter.delete("/consent/:visitorId", async (req, res) => {
  const { workspaceId } = req.body as Record<string, unknown>;
  if (!workspaceId) {
    res.status(400).json({ error: { message: "workspaceId is required in request body" } });
    return;
  }

  const ipRaw = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
  const ipHash = sha256(typeof ipRaw === "string" ? ipRaw.split(",")[0]!.trim() : String(ipRaw));

  await revokeConsent(req.params.visitorId!, String(workspaceId), ipHash);

  // Purge behavioral data for this visitor
  const { purgeVisitorData } = await import("../services/vilConsentService.js");
  const purgeResult = await purgeVisitorData(req.params.visitorId!, String(workspaceId));

  res.json({ ok: true, purged: purgeResult });
});

// PATCH /api/vil/consent/:visitorId/version
// Upgrade consent to a new version (re-consent after privacy policy change).
vilRouter.patch("/consent/:visitorId/version", async (req, res) => {
  const { workspaceId, newVersion } = req.body as Record<string, unknown>;
  if (!workspaceId || !newVersion) {
    res.status(400).json({ error: { message: "workspaceId and newVersion are required" } });
    return;
  }
  const upgraded = await upgradeConsentVersion(req.params.visitorId!, String(workspaceId), String(newVersion));
  res.json({ ok: upgraded });
});

// ── Session lifecycle ──────────────────────────────────────────────────────────

// POST /api/vil/session
// Create a new visitor session. Consent must have been recorded first.
vilRouter.post("/session", async (req, res) => {
  const {
    workspaceId, tenantSlug, visitorId,
    deviceType, browserName, browserVersion,
    os, screenWidth, screenHeight,
    country, region, city, landingPage,
    referralSource, utmSource, utmMedium, utmCampaign, utmContent, utmTerm
  } = req.body as Record<string, unknown>;

  if (!workspaceId || !tenantSlug || !landingPage) {
    res.status(400).json({ error: { message: "workspaceId, tenantSlug, and landingPage are required" } });
    return;
  }
  if (!visitorId) {
    res.status(400).json({
      error: {
        message: "visitorId is required — obtain it by calling POST /api/vil/consent first",
        code: "CONSENT_REQUIRED"
      }
    });
    return;
  }

  const ws = await getWorkspace(String(workspaceId));
  if (!ws) {
    res.status(404).json({ error: { message: "Workspace not found" } });
    return;
  }

  // ── Consent gate ──────────────────────────────────────────────────────────────
  const t0Consent = Date.now();
  const consentResult = await validateConsentForTracking(String(visitorId), String(workspaceId));
  recordConsentValidationLatency(Date.now() - t0Consent);

  if (!consentResult.allowed) {
    res.status(403).json({
      error: {
        code: consentResult.code,
        message: consentResult.reason,
        consentEndpoint: "/api/vil/consent"
      }
    });
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const t0 = Date.now();
  const { session } = await createVisitorSession({
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    visitorId: String(visitorId),
    consentId: consentResult.consentId,
    consentVersion: consentResult.consentVersion,
    deviceType: deviceType as DeviceType | undefined,
    browserName: browserName ? String(browserName) : undefined,
    browserVersion: browserVersion ? String(browserVersion) : undefined,
    os: os ? String(os) : undefined,
    screenWidth: typeof screenWidth === "number" ? screenWidth : undefined,
    screenHeight: typeof screenHeight === "number" ? screenHeight : undefined,
    country: country ? String(country) : undefined,
    region: region ? String(region) : undefined,
    city: city ? String(city) : undefined,
    landingPage: String(landingPage),
    referralSource: referralSource ? String(referralSource) : undefined,
    utmSource: utmSource ? String(utmSource) : undefined,
    utmMedium: utmMedium ? String(utmMedium) : undefined,
    utmCampaign: utmCampaign ? String(utmCampaign) : undefined,
    utmContent: utmContent ? String(utmContent) : undefined,
    utmTerm: utmTerm ? String(utmTerm) : undefined
  });
  recordEventIngestionLatency(Date.now() - t0);

  const s = session as Record<string, unknown>;
  res.status(201).json({
    sessionId: s["sessionId"],
    visitorId: s["visitorId"],
    consentId: s["consentId"]
  });
});

// POST /api/vil/session/:sessionId/end
vilRouter.post("/session/:sessionId/end", async (req, res) => {
  await endVisitorSession(req.params.sessionId!);
  res.json({ ok: true });
});

// PATCH /api/vil/session/:sessionId
vilRouter.patch("/session/:sessionId", async (req, res) => {
  const { visitorFrustrationScore, engagementScore } = req.body as Record<string, unknown>;
  await updateVisitorSession(req.params.sessionId!, {
    visitorFrustrationScore: typeof visitorFrustrationScore === "number" ? visitorFrustrationScore : undefined,
    engagementScore: typeof engagementScore === "number" ? engagementScore : undefined
  });
  res.json({ ok: true });
});

// ── Event ingestion ────────────────────────────────────────────────────────────

// POST /api/vil/session/:sessionId/event
vilRouter.post("/session/:sessionId/event", async (req, res) => {
  const { workspaceId, tenantSlug, visitorId, engineSource, eventType, page, timestamp, data } =
    req.body as Record<string, unknown>;

  if (!workspaceId || !tenantSlug || !engineSource || !eventType || !page) {
    res.status(400).json({
      error: { message: "workspaceId, tenantSlug, engineSource, eventType, and page are required" }
    });
    return;
  }

  // ── Consent gate ──────────────────────────────────────────────────────────────
  if (visitorId) {
    const t0Consent = Date.now();
    const consentResult = await validateConsentForTracking(String(visitorId), String(workspaceId));
    recordConsentValidationLatency(Date.now() - t0Consent);
    if (!consentResult.allowed) {
      res.status(403).json({ error: { code: consentResult.code, message: consentResult.reason } });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const t0 = Date.now();
  const { event } = await ingestEvent({
    sessionId: req.params.sessionId!,
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    engineSource: String(engineSource) as EngineSource,
    eventType: String(eventType) as BehavioralEventType,
    page: String(page),
    timestamp: timestamp ? new Date(String(timestamp)) : undefined,
    data: data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
  });
  recordEventIngestionLatency(Date.now() - t0);

  const e = event as Record<string, unknown>;
  res.status(201).json({ eventId: e["eventId"] });
});

// POST /api/vil/session/:sessionId/events
// Batch ingest — client queues events and flushes periodically.
vilRouter.post("/session/:sessionId/events", async (req, res) => {
  const { events, visitorId, workspaceId } = req.body as {
    events?: unknown[];
    visitorId?: string;
    workspaceId?: string;
  };

  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: { message: "events array is required and must not be empty" } });
    return;
  }
  if (events.length > 100) {
    res.status(400).json({ error: { message: "Maximum 100 events per batch" } });
    return;
  }

  // ── Consent gate ──────────────────────────────────────────────────────────────
  if (visitorId && workspaceId) {
    const t0Consent = Date.now();
    const consentResult = await validateConsentForTracking(visitorId, workspaceId);
    recordConsentValidationLatency(Date.now() - t0Consent);
    if (!consentResult.allowed) {
      res.status(403).json({ error: { code: consentResult.code, message: consentResult.reason } });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const sessionId = req.params.sessionId!;
  const t0 = Date.now();

  const inputs = (events as Record<string, unknown>[]).map((e) => ({
    sessionId,
    workspaceId: String(e["workspaceId"] ?? workspaceId ?? ""),
    tenantSlug: String(e["tenantSlug"] ?? ""),
    engineSource: String(e["engineSource"] ?? "journey") as EngineSource,
    eventType: String(e["eventType"] ?? "page_view") as BehavioralEventType,
    page: String(e["page"] ?? "/"),
    timestamp: e["timestamp"] ? new Date(String(e["timestamp"])) : undefined,
    data: e["data"] && typeof e["data"] === "object" ? (e["data"] as Record<string, unknown>) : undefined
  }));

  const { count } = await ingestEventBatch(inputs);
  recordEventIngestionLatency(Date.now() - t0);

  res.status(201).json({ ingested: count });
});
