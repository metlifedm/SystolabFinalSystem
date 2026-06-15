// Event handler registrations — imported for side effects in server.ts.
//
// Each call to registerHandler() binds a named handler function to the handler registry.
// Each call to registerSubscriber() declares which events that handler receives.
//
// Circular-import note: this file MUST NOT import intelligenceEventBus.ts or any service
// that transitively imports it. It may import: eventBusService, iireService, alertService,
// metricsService, monitoringService, logger.

import type { SystolabEventEnvelope } from "@systolab/shared";
import { generateEventTriggeredInternalReport } from "./iireService.js";
import { triggerAlert, type PlatformAlertSeverity } from "./alertService.js";
import { incrementCounter, setGauge } from "./metricsService.js";
import { logger } from "../utils/logger.js";
import { registerHandler, registerSubscriber } from "./eventBusService.js";

// ── Handler: IIRE refresh on scan completion ──────────────────────────────────

registerHandler("iire.scan_completed", async (event: SystolabEventEnvelope) => {
  try {
    await generateEventTriggeredInternalReport();
    logger.debug("event_handler.iire.scan_completed", { eventId: event.eventId, workspaceId: event.workspaceId });
  } catch (err) {
    logger.warn("event_handler.iire.scan_completed.error", { eventId: event.eventId, error: err instanceof Error ? err.message : String(err) });
    throw err; // re-throw so delivery record captures the failure
  }
});

registerSubscriber({
  subscriptionId: "sub_iire_scan_completed",
  subscriberId: "iire.refresh",
  description: "Trigger event-driven IIRE report refresh when a scan completes",
  eventTypes: ["scan.completed"],
  layers: [],
  handlerName: "iire.scan_completed",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 3,
  enabled: true
});

// ── Handler: Platform alert on scan-level alert.generated ─────────────────────

registerHandler("alerts.alert_generated", async (event: SystolabEventEnvelope) => {
  const { title, message, severity: rawSeverity, category } = event.payload as Record<string, unknown>;
  const severity: PlatformAlertSeverity =
    rawSeverity === "critical" ? "critical" : rawSeverity === "info" ? "info" : "warning";

  await triggerAlert({
    key: `scan.alert.${event.workspaceId ?? "global"}.${event.snapshotId ?? "unknown"}`,
    severity,
    category: "scan",
    title: typeof title === "string" ? title : "Scan Alert",
    message: typeof message === "string" ? message : event.eventId,
    details: {
      eventId: event.eventId,
      snapshotId: event.snapshotId,
      workspaceId: event.workspaceId,
      targetUrl: event.targetUrl,
      category: typeof category === "string" ? category : undefined,
      payload: event.payload
    }
  });
});

registerSubscriber({
  subscriptionId: "sub_alerts_alert_generated",
  subscriberId: "alerts.from_scan",
  description: "Promote scan-level alert.generated events into platform operational alerts",
  eventTypes: ["alert.generated"],
  layers: ["action_alert"],
  handlerName: "alerts.alert_generated",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 3,
  enabled: true
});

// ── Handler: Metrics — job lifecycle ─────────────────────────────────────────

registerHandler("metrics.job_events", async (event: SystolabEventEnvelope) => {
  if (event.eventType === "job.queued") {
    incrementCounter("systolab_event_bus_jobs_total", { outcome: "queued" });
  } else if (event.eventType === "job.completed") {
    incrementCounter("systolab_event_bus_jobs_total", { outcome: "completed" });
    const durationMs = typeof event.payload.durationMs === "number" ? event.payload.durationMs : null;
    if (durationMs !== null) setGauge("systolab_last_job_duration_ms", durationMs);
  }
});

registerSubscriber({
  subscriptionId: "sub_metrics_job_events",
  subscriberId: "metrics.jobs",
  description: "Track job lifecycle events as metrics counters",
  eventTypes: ["job.queued", "job.completed"],
  layers: ["automation"],
  handlerName: "metrics.job_events",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 2,
  enabled: true
});

// ── Handler: Metrics — confidence score gauge ────────────────────────────────

registerHandler("metrics.confidence_scored", async (event: SystolabEventEnvelope) => {
  const score = typeof event.payload.score === "number" ? event.payload.score : null;
  const ossScore = typeof event.payload.ossScore === "number" ? event.payload.ossScore : null;
  if (score !== null) setGauge("systolab_last_confidence_score", score);
  if (ossScore !== null) setGauge("systolab_last_oss_score", ossScore);
  incrementCounter("systolab_event_bus_confidence_events_total", {});
});

registerSubscriber({
  subscriptionId: "sub_metrics_confidence_scored",
  subscriberId: "metrics.confidence",
  description: "Update confidence and OSS score gauges from confidence.scored events",
  eventTypes: ["confidence.scored"],
  layers: ["confidence"],
  handlerName: "metrics.confidence_scored",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 2,
  enabled: true
});

// ── Handler: Intelligence — change detection lineage ─────────────────────────

registerHandler("intelligence.change_detected", async (event: SystolabEventEnvelope) => {
  // Record change detection metric so SLI dashboard can track change velocity
  incrementCounter("systolab_event_bus_changes_detected_total", {
    workspaceId: event.workspaceId ?? "global"
  });
  logger.debug("event_handler.change_detected", {
    eventId: event.eventId,
    workspaceId: event.workspaceId,
    targetUrl: event.targetUrl
  });
});

registerSubscriber({
  subscriptionId: "sub_intelligence_change_detected",
  subscriberId: "intelligence.change_lineage",
  description: "Track change detection events for intelligence lineage and metrics",
  eventTypes: ["change.detected"],
  layers: ["truth_evidence"],
  handlerName: "intelligence.change_detected",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 2,
  enabled: true
});

// ── Handler: Automation — feature flag evaluation audit ──────────────────────

registerHandler("automation.feature_flag_evaluated", async (event: SystolabEventEnvelope) => {
  incrementCounter("systolab_event_bus_feature_flag_evaluations_total", {
    flagKey: typeof event.payload.flagKey === "string" ? event.payload.flagKey : "unknown"
  });
});

registerSubscriber({
  subscriptionId: "sub_automation_feature_flag_evaluated",
  subscriberId: "automation.feature_flags",
  description: "Count feature flag evaluations for usage analytics",
  eventTypes: ["feature_flag.evaluated"],
  layers: ["automation"],
  handlerName: "automation.feature_flag_evaluated",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 1,
  enabled: true
});

// ── Handler: Revenue intelligence event tracking ──────────────────────────────

registerHandler("intelligence.revenue_estimated", async (event: SystolabEventEnvelope) => {
  const revenue = typeof event.payload.estimatedAnnualRevenue === "number" ? event.payload.estimatedAnnualRevenue : null;
  if (revenue !== null) setGauge("systolab_last_revenue_estimate", revenue);
  incrementCounter("systolab_event_bus_revenue_events_total", {});
});

registerSubscriber({
  subscriptionId: "sub_intelligence_revenue_estimated",
  subscriberId: "intelligence.revenue",
  description: "Update revenue estimate gauge from revenue.estimated events",
  eventTypes: ["revenue.estimated"],
  layers: ["revenue_intelligence"],
  handlerName: "intelligence.revenue_estimated",
  deliveryMode: "async",
  minSchemaVersion: 1,
  maxAttempts: 2,
  enabled: true
});

logger.debug("event_handlers.registered", { count: 6 });
