import { incrementCounter, setGauge, recordHistogram, histogramPercentile } from "./metricsService.js";
import { triggerAlert, resolveAlertByKey } from "./alertService.js";
import { logger } from "../utils/logger.js";

// ─── VIL SLA Definitions ───────────────────────────────────────────────────────
//
// SLA-1  Event ingestion latency P95 < 200ms
// SLA-2  Journey reconstruction lag < 60s after session end
// SLA-3  Evidence generation sweep completes in < 5 minutes
// SLA-4  Session expiry runs at least once every 30 minutes
// SLA-5  VIL worker heartbeat: must fire within 90s of scheduled interval
//
// Breaches fire a PlatformAlert and increment vil_sla_breach_total counter.

export interface VilSlaStatus {
  healthy: boolean;
  slas: {
    id: string;
    name: string;
    target: string;
    current: string | number | null;
    passing: boolean;
  }[];
  lastCheckedAt: Date;
}

let _lastSessionExpiryRun: Date | null = null;
let _lastJourneyReconstructionRun: Date | null = null;
let _lastEvidenceSweepRun: Date | null = null;
let _lastWorkerHeartbeat: Date | null = null;

export function recordConsentValidationLatency(ms: number): void {
  recordHistogram("vil_consent_validation_latency_ms", ms);
  incrementCounter("vil_consent_validations_total");
}

export function recordEventIngestionLatency(ms: number): void {
  recordHistogram("vil_event_ingestion_latency_ms", ms);
  incrementCounter("vil_events_ingested_total");
}

export function recordJourneyReconstructionMs(ms: number): void {
  recordHistogram("vil_journey_reconstruction_ms", ms);
  _lastJourneyReconstructionRun = new Date();
}

export function recordEvidenceSweepMs(ms: number): void {
  recordHistogram("vil_evidence_sweep_ms", ms);
  _lastEvidenceSweepRun = new Date();
}

export function recordSessionExpiryRun(expired: number): void {
  _lastSessionExpiryRun = new Date();
  incrementCounter("vil_sessions_expired_total", {}, expired);
  setGauge("vil_last_session_expiry_ts", Date.now());
}

export function recordWorkerHeartbeat(): void {
  _lastWorkerHeartbeat = new Date();
  setGauge("vil_worker_last_heartbeat_ts", Date.now());
}

export async function checkVilSlas(): Promise<VilSlaStatus> {
  const now = Date.now();
  const slas: VilSlaStatus["slas"] = [];
  let allPassing = true;

  // SLA-1: Event ingestion P95 < 200ms
  const p95Latency = histogramPercentile("vil_event_ingestion_latency_ms", 95);
  const sla1Pass = p95Latency === null || p95Latency < 200;
  slas.push({
    id: "VIL-SLA-1",
    name: "Event ingestion latency P95",
    target: "< 200ms",
    current: p95Latency !== null ? `${Math.round(p95Latency)}ms` : "no data",
    passing: sla1Pass
  });
  if (!sla1Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_event_ingestion_latency",
      severity: "warning",
      category: "slo",
      title: "VIL SLA-1 Breach: Event ingestion latency",
      message: `Event ingestion P95 latency is ${Math.round(p95Latency!)}ms — SLA target is < 200ms`,
      details: { p95Latency, target: 200 }
    });
  } else {
    await resolveAlertByKey("vil_sla_event_ingestion_latency").catch(() => undefined);
  }

  // SLA-2: Journey reconstruction lag < 60s
  const journeyReconMs = histogramPercentile("vil_journey_reconstruction_ms", 95);
  const sla2Pass = journeyReconMs === null || journeyReconMs < 60_000;
  slas.push({
    id: "VIL-SLA-2",
    name: "Journey reconstruction lag P95",
    target: "< 60s",
    current: journeyReconMs !== null ? `${Math.round(journeyReconMs / 1000)}s` : "no data",
    passing: sla2Pass
  });
  if (!sla2Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_journey_reconstruction_lag",
      severity: "warning",
      category: "slo",
      title: "VIL SLA-2 Breach: Journey reconstruction lag",
      message: `Journey reconstruction P95 is ${Math.round(journeyReconMs! / 1000)}s — SLA target is < 60s`,
      details: { journeyReconMs, target: 60_000 }
    });
  } else {
    await resolveAlertByKey("vil_sla_journey_reconstruction_lag").catch(() => undefined);
  }

  // SLA-3: Evidence sweep completes in < 5 minutes
  const sweepMs = histogramPercentile("vil_evidence_sweep_ms", 95);
  const sla3Pass = sweepMs === null || sweepMs < 300_000;
  slas.push({
    id: "VIL-SLA-3",
    name: "Evidence generation sweep duration P95",
    target: "< 5 minutes",
    current: sweepMs !== null ? `${Math.round(sweepMs / 1000)}s` : "no data",
    passing: sla3Pass
  });
  if (!sla3Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_evidence_sweep_duration",
      severity: "warning",
      category: "slo",
      title: "VIL SLA-3 Breach: Evidence sweep too slow",
      message: `Evidence generation P95 is ${Math.round(sweepMs! / 1000)}s — SLA target is < 300s`,
      details: { sweepMs, target: 300_000 }
    });
  } else {
    await resolveAlertByKey("vil_sla_evidence_sweep_duration").catch(() => undefined);
  }

  // SLA-4: Session expiry within last 30 minutes
  const expiryAge = _lastSessionExpiryRun ? now - _lastSessionExpiryRun.getTime() : Infinity;
  const sla4Pass = expiryAge < 35 * 60 * 1000; // 35min tolerance
  slas.push({
    id: "VIL-SLA-4",
    name: "Session expiry recency",
    target: "Within 30 minutes",
    current: _lastSessionExpiryRun ? `${Math.round(expiryAge / 60_000)}min ago` : "never run",
    passing: sla4Pass
  });
  if (!sla4Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_session_expiry_stale",
      severity: "warning",
      category: "slo",
      title: "VIL SLA-4 Breach: Session expiry not running",
      message: `Session expiry has not run in ${Math.round(expiryAge / 60_000)} minutes — SLA target is every 30 minutes`,
      details: { lastRun: _lastSessionExpiryRun, ageMs: expiryAge }
    });
  } else {
    await resolveAlertByKey("vil_sla_session_expiry_stale").catch(() => undefined);
  }

  // SLA-5: Worker heartbeat within last 90s
  const heartbeatAge = _lastWorkerHeartbeat ? now - _lastWorkerHeartbeat.getTime() : Infinity;
  const sla5Pass = heartbeatAge < 90_000;
  slas.push({
    id: "VIL-SLA-5",
    name: "VIL worker heartbeat",
    target: "< 90s since last tick",
    current: _lastWorkerHeartbeat ? `${Math.round(heartbeatAge / 1000)}s ago` : "never",
    passing: sla5Pass
  });
  if (!sla5Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_worker_heartbeat_missing",
      severity: "critical",
      category: "slo",
      title: "VIL SLA-5 Breach: Worker heartbeat missing",
      message: `VIL worker has not emitted a heartbeat in ${Math.round(heartbeatAge / 1000)}s — worker may have crashed`,
      details: { lastHeartbeat: _lastWorkerHeartbeat, ageMs: heartbeatAge }
    });
  } else {
    await resolveAlertByKey("vil_sla_worker_heartbeat_missing").catch(() => undefined);
  }

  // SLA-6: Consent validation latency P95 < 50ms
  const consentP95 = histogramPercentile("vil_consent_validation_latency_ms", 95);
  const sla6Pass = consentP95 === null || consentP95 < 50;
  slas.push({
    id: "VIL-SLA-6",
    name: "Consent validation latency P95",
    target: "< 50ms",
    current: consentP95 !== null ? `${Math.round(consentP95)}ms` : "no data",
    passing: sla6Pass
  });
  if (!sla6Pass) {
    allPassing = false;
    await triggerAlert({
      key: "vil_sla_consent_validation_latency",
      severity: "warning",
      category: "slo",
      title: "VIL SLA-6 Breach: Consent validation latency",
      message: `Consent validation P95 is ${Math.round(consentP95!)}ms — SLA target is < 50ms`,
      details: { consentP95, target: 50 }
    });
  } else {
    await resolveAlertByKey("vil_sla_consent_validation_latency").catch(() => undefined);
  }

  if (!allPassing) {
    incrementCounter("vil_sla_breach_total");
    logger.warn("vil.sla.breach", { failing: slas.filter((s) => !s.passing).map((s) => s.id) });
  }

  const status: VilSlaStatus = { healthy: allPassing, slas, lastCheckedAt: new Date() };
  setGauge("vil_sla_healthy", allPassing ? 1 : 0);
  return status;
}

export function getVilMetricsSummary(): Record<string, unknown> {
  return {
    eventIngestionP95ms: histogramPercentile("vil_event_ingestion_latency_ms", 95),
    consentValidationP95ms: histogramPercentile("vil_consent_validation_latency_ms", 95),
    journeyReconstructionP95ms: histogramPercentile("vil_journey_reconstruction_ms", 95),
    evidenceSweepP95ms: histogramPercentile("vil_evidence_sweep_ms", 95),
    lastSessionExpiryRun: _lastSessionExpiryRun,
    lastJourneyReconstructionRun: _lastJourneyReconstructionRun,
    lastEvidenceSweepRun: _lastEvidenceSweepRun,
    lastWorkerHeartbeat: _lastWorkerHeartbeat
  };
}
