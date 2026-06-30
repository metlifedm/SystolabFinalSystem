import { Router } from "express";
import { auditAdminAction, requireDestructiveConfirm } from "../middleware/adminAuth.js";
import { internalRoleAuth, ownerOnly } from "../middleware/internalRoleAuth.js";
import { findSnapshot } from "../services/persistenceService.js";
import { BackupError, getBackupRecord, getBackupStatusSummary, listBackupRecords, runBackup, verifyBackup } from "../services/backupService.js";
import { acknowledgeAlert, getAlert, getAlertSummary, listAlerts, resolveAlertById } from "../services/alertService.js";
import { getDataQualitySummary, runBenchmarkDataQualityAudit } from "../services/dataQualityService.js";
import { getQuarantineRecord, getQuarantineSummary, listQuarantined, resolveQuarantine } from "../services/quarantineService.js";
import { listHolds, placeHold, releaseHold, getHold } from "../services/legalHoldService.js";
import {
  deleteRetentionPolicy,
  getRetentionPolicy,
  getRetentionStatus,
  listRetentionPolicies,
  runRetentionJob,
  upsertRetentionPolicy
} from "../services/retentionService.js";
import {
  deprecateVersion,
  getCurrentVersion,
  getVersion,
  listVersions,
  publishVersion,
  rollbackToVersion,
  runQualityCheck
} from "../services/scoringVersionService.js";
import {
  getExport,
  listExports,
  processExport,
  requestExport
} from "../services/complianceExportService.js";
import {
  getDeliveryRecord,
  getEventBusStats,
  getIntelligenceEvent,
  getRegisteredSubscriptions,
  listEventDeliveries,
  listIntelligenceEvents,
  processDeliveries,
  replayEvents,
  retryDeadLetterDelivery,
  setSubscriberEnabled
} from "../services/eventBusService.js";
import {
  buildAiAnalystContext,
  enqueuePlatformJob,
  evaluateFeatureFlag,
  evaluateManagedWhiteLabelAccess,
  getDisasterRecoveryStatus,
  getDataGovernanceStatus,
  getGovernanceContractStatus,
  getManagedWhiteLabelGovernance,
  getObservabilityStatus,
  getPlatformOverview,
  getRealtimeRefreshState,
  getSecurityIntelligence,
  getSliDashboard,
  getUserIntelligence,
  getUserJourneyIntelligence,
  listApiGovernanceRecords,
  listArtifactVersions,
  listControls,
  listEvidenceRepository,
  listFeatureFlags,
  listGraphIntelligence,
  listLineage,
  listManagedWhiteLabelWorkspaces,
  listPlatformJobs,
  listUserSearchActivities,
  listPlatformModules,
  listWarehouseRecords,
  listWorkspaceIntelligence,
  materializeAnalyticsWarehouse,
  renderOperationsReportPdf,
  runDuePlatformJobs,
  runSandboxExperiment,
  setPlatformModuleActivation,
  upsertFeatureFlag,
  upsertManagedWhiteLabelWorkspace,
  upsertPlatformModule,
  validatePlatformModules
} from "../services/platformControlPlaneService.js";

import { listSessionsForWorkspace } from "../services/vilSessionService.js";
import { getConsentById, getConsentSummary, listConsentRecords, validateConsentForTracking, purgeVisitorData } from "../services/vilConsentService.js";
import { getArchetypeDistribution } from "../services/vilJourneyService.js";
import {
  listBehavioralEvidence,
  getBehavioralEvidenceById,
  computeSessionVfs,
  runEvidenceGeneration
} from "../services/vilEvidenceService.js";
import { traceBehavioralEvidence, listLineageForWorkspace } from "../services/vilLineageService.js";
import { checkVilSlas, getVilMetricsSummary } from "../services/vilSlaService.js";
import {
  listEffectivenessRecords,
  getEffectivenessStats,
  getTopPerformingRecommendationTypes,
  validateEffectiveness,
  recordRecommendationApplication
} from "../services/recommendationEffectivenessService.js";
import { getEventCountsByType } from "../services/vilEventService.js";
import {
  getEvidenceQualityStats,
  classifyEvidenceRecord,
  classifyBehavioralEvidence,
  classifyUnclassifiedBehavioralEvidence
} from "../services/evidenceQualityService.js";
import { getBusinessDna, listBusinessDnas, updateDnaFromBehavioralData } from "../services/businessDnaService.js";
import {
  listVisitorDnas,
  getVisitorDnaForArchetype,
  getArchetypeDistributionSummary
} from "../services/visitorDnaService.js";
import {
  recordValidation,
  listValidationsForWorkspace,
  getValidationAccuracyStats,
  computeVrsr
} from "../services/intelligenceValidationService.js";
import {
  createOpportunity,
  listOpportunities,
  updateOpportunityStatus,
  getOpportunityStats,
  discoverOpportunities
} from "../services/opportunityDiscoveryService.js";
import {
  computeAndSnapshotKgs,
  getLatestKgs,
  listKgsHistory,
  generateAgencyIntelligenceReport
} from "../services/ciifService.js";

export const internalPlatformRouter = Router();

internalPlatformRouter.use(internalRoleAuth(["owner", "manager"]));

internalPlatformRouter.get("/overview", async (_req, res) => {
  res.json(await getPlatformOverview());
});

internalPlatformRouter.get("/dashboard", async (_req, res) => {
  const [
    overview,
    modules,
    jobs,
    warehouse,
    aiContext,
    workspaces,
    evidence,
    apiGovernance,
    artifactVersions,
    disasterRecovery,
    observability,
    dataGovernance,
    validation,
    slo,
    realtime,
    governanceContract,
    lineage,
    dataQuality,
    cost,
    graph,
    featureFlags,
    managedWhiteLabel,
    sandbox,
    userJourney,
    security,
    userIntelligence,
    searchActivities,
    sliDashboard,
    alertSummary
  ] = await Promise.all([
    getPlatformOverview(),
    listPlatformModules(),
    listPlatformJobs(80),
    listWarehouseRecords(40),
    buildAiAnalystContext({ limit: 5 }),
    listWorkspaceIntelligence(),
    listEvidenceRepository(40),
    listApiGovernanceRecords(40),
    listArtifactVersions(40),
    getDisasterRecoveryStatus(),
    getObservabilityStatus(),
    getDataGovernanceStatus(),
    listControls(100, "intelligence_validation"),
    listControls(100, "scan_slo"),
    getRealtimeRefreshState(),
    getGovernanceContractStatus(),
    listLineage(50),
    listControls(100, "data_quality"),
    listControls(100, "cost_intelligence"),
    listGraphIntelligence(40),
    listFeatureFlags(),
    getManagedWhiteLabelGovernance(),
    listControls(100, "sandbox"),
    getUserJourneyIntelligence(60),
    getSecurityIntelligence(60),
    getUserIntelligence(250),
    listUserSearchActivities(250),
    getSliDashboard(),
    getAlertSummary()
  ]);

  res.json({
    overview,
    modules,
    jobs,
    warehouse,
    aiContext,
    workspaces,
    evidence,
    apiGovernance,
    artifactVersions,
    disasterRecovery,
    observability,
    dataGovernance,
    validation,
    slo,
    realtime,
    governanceContract,
    lineage,
    dataQuality,
    cost,
    graph,
    featureFlags,
    managedWhiteLabel,
    sandbox,
    userJourney,
    security,
    userIntelligence,
    searchActivities,
    sliDashboard,
    alertSummary
  });
});

internalPlatformRouter.get("/reports/:snapshotId/full", async (req, res) => {
  const snapshotId = req.params.snapshotId;
  if (!snapshotId) {
    res.status(400).json({ error: { message: "snapshotId is required." } });
    return;
  }
  const report = await findSnapshot(snapshotId);
  if (!report) {
    res.status(404).json({ error: { message: "Snapshot not found." } });
    return;
  }
  res.json(report);
});

internalPlatformRouter.get("/modules", async (_req, res) => {
  res.json({ items: await listPlatformModules() });
});

internalPlatformRouter.post("/modules", ownerOnly, auditAdminAction("module.upsert", "module"), async (req, res) => {
  const input = req.body as { moduleId?: string; name?: string };
  if (!input.moduleId || !input.name) {
    res.status(400).json({ error: { message: "moduleId and name are required." } });
    return;
  }
  res.status(201).json({ item: await upsertPlatformModule({ ...req.body, moduleId: input.moduleId, name: input.name }) });
});

internalPlatformRouter.patch("/modules/:moduleId/activation", ownerOnly, auditAdminAction("module.activate", "module"), async (req, res) => {
  const moduleId = req.params.moduleId;
  const activationState = (req.body as { activationState?: "active" | "inactive" | "disabled" }).activationState;
  if (!moduleId) {
    res.status(400).json({ error: { message: "moduleId is required." } });
    return;
  }
  if (!activationState || !["active", "inactive", "disabled"].includes(activationState)) {
    res.status(400).json({ error: { message: "activationState must be active, inactive, or disabled." } });
    return;
  }
  res.json({ item: await setPlatformModuleActivation(moduleId, activationState) });
});

internalPlatformRouter.post("/modules/validate", ownerOnly, auditAdminAction("module.validate", "module"), async (_req, res) => {
  res.json(await validatePlatformModules());
});

internalPlatformRouter.get("/jobs", async (req, res) => {
  res.json({ items: await listPlatformJobs(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.post("/jobs", ownerOnly, auditAdminAction("job.enqueue", "job"), async (req, res) => {
  const input = req.body as { jobType?: string; queue?: string; priority?: number; payload?: Record<string, unknown>; scheduledFor?: string; maxAttempts?: number };
  if (!input.jobType) {
    res.status(400).json({ error: { message: "jobType is required." } });
    return;
  }
  const item = await enqueuePlatformJob({
    jobType: input.jobType,
    queue: input.queue,
    priority: input.priority,
    payload: input.payload,
    scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
    maxAttempts: input.maxAttempts
  });
  res.status(201).json({ item });
});

internalPlatformRouter.post("/jobs/run-due", ownerOnly, requireDestructiveConfirm, auditAdminAction("job.run_due", "job"), async (req, res) => {
  res.json(await runDuePlatformJobs(new Date(), limitFromQuery((req.body as { limit?: number }).limit, 10)));
});

internalPlatformRouter.get("/warehouse", async (req, res) => {
  res.json({ items: await listWarehouseRecords(limitFromQuery(req.query.limit, 50)) });
});

internalPlatformRouter.post("/warehouse/materialize", ownerOnly, requireDestructiveConfirm, auditAdminAction("warehouse.materialize", "warehouse"), async (req, res) => {
  const input = req.body as { grain?: "daily" | "weekly" | "monthly" | "custom"; startAt?: string; endAt?: string };
  res.status(201).json({
    item: await materializeAnalyticsWarehouse({
      grain: input.grain,
      startAt: input.startAt ? new Date(input.startAt) : undefined,
      endAt: input.endAt ? new Date(input.endAt) : undefined
    })
  });
});

internalPlatformRouter.get("/ai-analyst/context", async (req, res) => {
  res.json({ item: await buildAiAnalystContext({ workspaceId: stringQuery(req.query.workspaceId), limit: limitFromQuery(req.query.limit, 5) }) });
});

internalPlatformRouter.get("/workspaces", async (_req, res) => {
  res.json({ items: await listWorkspaceIntelligence() });
});

internalPlatformRouter.get("/user-journey", async (req, res) => {
  res.json(await getUserJourneyIntelligence(limitFromQuery(req.query.limit, 100)));
});

internalPlatformRouter.get("/users", async (req, res) => {
  res.json({ items: await getUserIntelligence(limitFromQuery(req.query.limit, 250)) });
});

internalPlatformRouter.get("/user-searches", async (req, res) => {
  res.json({ items: await listUserSearchActivities(limitFromQuery(req.query.limit, 250)) });
});

internalPlatformRouter.get("/security", async (req, res) => {
  res.json(await getSecurityIntelligence(limitFromQuery(req.query.limit, 100)));
});

internalPlatformRouter.get("/evidence-repository", async (req, res) => {
  res.json({ items: await listEvidenceRepository(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.get("/api-governance", async (req, res) => {
  res.json({ items: await listApiGovernanceRecords(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.get("/artifact-versions", async (req, res) => {
  res.json({ items: await listArtifactVersions(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.get("/disaster-recovery", async (_req, res) => {
  res.json({ item: await getDisasterRecoveryStatus() });
});

internalPlatformRouter.get("/observability", async (_req, res) => {
  res.json({ item: await getObservabilityStatus() });
});

internalPlatformRouter.get("/data-governance", async (_req, res) => {
  res.json({ item: await getDataGovernanceStatus(), history: await listControls(100, "data_governance") });
});

internalPlatformRouter.get("/validation", async (_req, res) => {
  res.json({ items: await listControls(100, "intelligence_validation") });
});

internalPlatformRouter.get("/slo", async (_req, res) => {
  res.json({ items: await listControls(100, "scan_slo") });
});

internalPlatformRouter.get("/realtime/homepage", async (_req, res) => {
  res.json({ item: await getRealtimeRefreshState(), history: await listControls(100, "realtime_refresh") });
});

internalPlatformRouter.get("/governance-contract", async (_req, res) => {
  res.json({ item: await getGovernanceContractStatus(), history: await listControls(100, "governance_contract") });
});

internalPlatformRouter.get("/lineage", async (req, res) => {
  res.json({ items: await listLineage(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.get("/data-quality", async (_req, res) => {
  res.json({ items: await listControls(100, "data_quality") });
});

internalPlatformRouter.get("/cost-intelligence", async (_req, res) => {
  res.json({ items: await listControls(100, "cost_intelligence") });
});

internalPlatformRouter.get("/graph", async (req, res) => {
  res.json({ items: await listGraphIntelligence(limitFromQuery(req.query.limit, 100)) });
});

internalPlatformRouter.get("/feature-flags", async (_req, res) => {
  res.json({ items: await listFeatureFlags() });
});

internalPlatformRouter.post("/feature-flags", ownerOnly, auditAdminAction("feature_flag.upsert", "feature_flag"), async (req, res) => {
  const input = req.body as { flagKey?: string };
  if (!input.flagKey) {
    res.status(400).json({ error: { message: "flagKey is required." } });
    return;
  }
  res.status(201).json({ item: await upsertFeatureFlag({ ...req.body, flagKey: input.flagKey }) });
});

internalPlatformRouter.get("/feature-flags/:flagKey/evaluate", async (req, res) => {
  res.json({ item: await evaluateFeatureFlag(req.params.flagKey, { workspaceId: stringQuery(req.query.workspaceId), userId: stringQuery(req.query.userId) }) });
});

internalPlatformRouter.get("/white-label/governance", async (_req, res) => {
  res.json(await getManagedWhiteLabelGovernance());
});

internalPlatformRouter.get("/white-label/workspaces", async (_req, res) => {
  res.json({ items: await listManagedWhiteLabelWorkspaces() });
});

internalPlatformRouter.post("/white-label/workspaces", ownerOnly, auditAdminAction("white_label.workspace.upsert", "white_label"), async (req, res) => {
  const input = req.body as { tenantSlug?: string; workspaceName?: string };
  if (!input.tenantSlug || !input.workspaceName) {
    res.status(400).json({ error: { message: "tenantSlug and workspaceName are required." } });
    return;
  }
  try {
    res.status(201).json({ item: await upsertManagedWhiteLabelWorkspace({ ...req.body, tenantSlug: input.tenantSlug, workspaceName: input.workspaceName }, req.adminUser?.adminUserId) });
  } catch (error) {
    res.status(400).json({ error: { message: error instanceof Error ? error.message : "Unable to save managed white-label workspace." } });
  }
});

internalPlatformRouter.post("/white-label/access/evaluate", async (req, res) => {
  const input = req.body as { role?: "super_admin" | "partner" | "team_member" | "client" };
  if (!input.role || !["super_admin", "partner", "team_member", "client"].includes(input.role)) {
    res.status(400).json({ error: { message: "role must be super_admin, partner, team_member, or client." } });
    return;
  }
  res.json({ item: await evaluateManagedWhiteLabelAccess({ ...req.body, role: input.role }) });
});

internalPlatformRouter.get("/sandbox/experiments", async (_req, res) => {
  res.json({ items: await listControls(100, "sandbox") });
});

internalPlatformRouter.post("/sandbox/experiments", ownerOnly, requireDestructiveConfirm, auditAdminAction("sandbox.run_experiment", "sandbox"), async (req, res) => {
  const input = req.body as { experimentName?: string; scoringMethod?: string; benchmarkModel?: string; sampleSize?: number; workspaceId?: string };
  if (!input.experimentName) {
    res.status(400).json({ error: { message: "experimentName is required." } });
    return;
  }
  res.status(201).json({ item: await runSandboxExperiment({ ...input, experimentName: input.experimentName }) });
});

// ── SLI / SLO dashboard ───────────────────────────────────────────────────────

internalPlatformRouter.get("/sli", async (_req, res) => {
  res.json({ item: await getSliDashboard() });
});

// ── Platform alert routes ─────────────────────────────────────────────────────

internalPlatformRouter.get("/alerts", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status as "open" | "acknowledged" | "resolved" : undefined;
  const category = typeof req.query.category === "string" ? req.query.category as "scan" | "job" | "backup" | "security" | "dependency" | "slo" | "system" : undefined;
  const severity = typeof req.query.severity === "string" ? req.query.severity as "info" | "warning" | "critical" : undefined;
  const limit = limitFromQuery(req.query.limit, 50);
  res.json({ items: await listAlerts({ status, category, severity }, limit), summary: await getAlertSummary() });
});

internalPlatformRouter.get("/alerts/summary", async (_req, res) => {
  res.json({ item: await getAlertSummary() });
});

internalPlatformRouter.get("/alerts/:alertId", async (req, res) => {
  const record = await getAlert(req.params.alertId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "ALERT_NOT_FOUND", message: "Alert not found." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/alerts/:alertId/acknowledge", ownerOnly, auditAdminAction("alert.acknowledge", "alert"), async (req, res) => {
  const record = await acknowledgeAlert(req.params.alertId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "ALERT_NOT_FOUND", message: "Alert not found or not in open state." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/alerts/:alertId/resolve", ownerOnly, auditAdminAction("alert.resolve", "alert"), async (req, res) => {
  const record = await resolveAlertById(req.params.alertId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "ALERT_NOT_FOUND", message: "Alert not found or already resolved." } });
    return;
  }
  res.json({ item: record });
});

// ── Event bus admin routes ────────────────────────────────────────────────────

internalPlatformRouter.get("/events", async (req, res) => {
  const eventType = stringQuery(req.query.eventType);
  const layer = stringQuery(req.query.layer);
  const workspaceId = stringQuery(req.query.workspaceId);
  const limit = limitFromQuery(req.query.limit, 50);
  res.json({
    items: await listIntelligenceEvents(
      {
        eventTypes: eventType ? [eventType as import("@systolab/shared").SystolabEventType] : undefined,
        layers: layer ? [layer as import("@systolab/shared").IntelligenceLayerKey] : undefined,
        workspaceId
      },
      limit
    )
  });
});

internalPlatformRouter.get("/events/stats", async (_req, res) => {
  res.json({ item: await getEventBusStats() });
});

internalPlatformRouter.get("/events/subscriptions", async (_req, res) => {
  res.json({ items: getRegisteredSubscriptions() });
});

internalPlatformRouter.patch("/events/subscriptions/:subscriptionId", ownerOnly, auditAdminAction("event_bus.subscription.update", "event_bus"), async (req, res) => {
  const { subscriptionId } = req.params;
  const input = req.body as { enabled?: boolean };
  if (typeof input.enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled (boolean) is required." } });
    return;
  }
  setSubscriberEnabled(subscriptionId ?? "", input.enabled);
  res.json({ items: getRegisteredSubscriptions() });
});

internalPlatformRouter.get("/events/deliveries", async (req, res) => {
  const status = stringQuery(req.query.status) as import("../models/EventDeliveryRecord.js").DeliveryStatus | undefined;
  const eventId = stringQuery(req.query.eventId);
  const subscriptionId = stringQuery(req.query.subscriptionId);
  const limit = limitFromQuery(req.query.limit, 50);
  res.json({ items: await listEventDeliveries({ status, eventId, subscriptionId }, limit) });
});

internalPlatformRouter.get("/events/deliveries/:deliveryId", async (req, res) => {
  const record = await getDeliveryRecord(req.params.deliveryId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "DELIVERY_NOT_FOUND", message: "Delivery record not found." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/events/deliveries/:deliveryId/retry", ownerOnly, auditAdminAction("event_bus.delivery.retry", "event_bus"), async (req, res) => {
  const record = await retryDeadLetterDelivery(req.params.deliveryId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "DELIVERY_NOT_FOUND", message: "Delivery record not found or not in dead_letter state." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/events/process", ownerOnly, auditAdminAction("event_bus.process", "event_bus"), async (req, res) => {
  const limit = limitFromQuery((req.body as { limit?: number }).limit, 50);
  const result = await processDeliveries(limit);
  res.json({ item: result });
});

internalPlatformRouter.post("/events/replay", ownerOnly, requireDestructiveConfirm, auditAdminAction("event_bus.replay", "event_bus"), async (req, res) => {
  const input = req.body as { eventType?: string; layer?: string; workspaceId?: string; fromTs?: string; toTs?: string; limit?: number };
  const result = await replayEvents({
    eventTypes: input.eventType ? [input.eventType as import("@systolab/shared").SystolabEventType] : undefined,
    layers: input.layer ? [input.layer as import("@systolab/shared").IntelligenceLayerKey] : undefined,
    workspaceId: input.workspaceId,
    fromTimestamp: input.fromTs ? new Date(input.fromTs) : undefined,
    toTimestamp: input.toTs ? new Date(input.toTs) : undefined,
    limit: input.limit
  });
  res.json({ item: result });
});

internalPlatformRouter.get("/events/:eventId", async (req, res) => {
  const event = await getIntelligenceEvent(req.params.eventId ?? "");
  if (!event) {
    res.status(404).json({ error: { code: "EVENT_NOT_FOUND", message: "Event not found." } });
    return;
  }
  const deliveries = await listEventDeliveries({ eventId: req.params.eventId }, 100);
  res.json({ item: event, deliveries });
});

// ── Governance automation routes ──────────────────────────────────────────────

// Retention policies
internalPlatformRouter.get("/governance/retention", async (_req, res) => {
  res.json({ items: await listRetentionPolicies(), status: await getRetentionStatus() });
});

internalPlatformRouter.get("/governance/retention/:policyId", async (req, res) => {
  const policy = await getRetentionPolicy(req.params.policyId ?? "");
  if (!policy) {
    res.status(404).json({ error: { code: "POLICY_NOT_FOUND", message: "Retention policy not found." } });
    return;
  }
  res.json({ item: policy });
});

internalPlatformRouter.post("/governance/retention", ownerOnly, auditAdminAction("governance.retention.upsert", "governance"), async (req, res) => {
  const input = req.body as { recordType?: string; retentionDays?: number };
  if (!input.recordType || !input.retentionDays) {
    res.status(400).json({ error: { message: "recordType and retentionDays are required." } });
    return;
  }
  const item = await upsertRetentionPolicy({ ...req.body as Record<string, unknown>, recordType: input.recordType as import("../models/RetentionPolicyRecord.js").RetentionRecordType, retentionDays: input.retentionDays });
  res.status(201).json({ item });
});

internalPlatformRouter.delete("/governance/retention/:policyId", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.retention.delete", "governance"), async (req, res) => {
  const deleted = await deleteRetentionPolicy(req.params.policyId ?? "");
  if (!deleted) {
    res.status(404).json({ error: { code: "POLICY_NOT_FOUND", message: "Retention policy not found." } });
    return;
  }
  res.json({ ok: true });
});

internalPlatformRouter.post("/governance/retention/run", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.retention.run", "governance"), async (req, res) => {
  const input = req.body as { policyId?: string; batchSize?: number };
  const result = await runRetentionJob({ policyId: input.policyId, batchSize: input.batchSize });
  res.json({ item: result });
});

// Legal holds
internalPlatformRouter.get("/governance/holds", async (req, res) => {
  const status = stringQuery(req.query.status) as import("../models/LegalHoldRecord.js").HoldStatus | undefined;
  const scope = stringQuery(req.query.scope) as import("../models/LegalHoldRecord.js").HoldScope | undefined;
  const limit = limitFromQuery(req.query.limit, 100);
  res.json({ items: await listHolds({ status, scope }, limit) });
});

internalPlatformRouter.get("/governance/holds/:holdId", async (req, res) => {
  const hold = await getHold(req.params.holdId ?? "");
  if (!hold) {
    res.status(404).json({ error: { code: "HOLD_NOT_FOUND", message: "Legal hold not found." } });
    return;
  }
  res.json({ item: hold });
});

internalPlatformRouter.post("/governance/holds", ownerOnly, auditAdminAction("governance.hold.place", "governance"), async (req, res) => {
  const input = req.body as { scope?: string; targetId?: string; reason?: string };
  if (!input.scope || !input.targetId || !input.reason) {
    res.status(400).json({ error: { message: "scope, targetId, and reason are required." } });
    return;
  }
  const requestedBy = (req as unknown as Record<string, unknown>).adminUser
    ? ((req as unknown as Record<string, unknown>).adminUser as Record<string, unknown>).adminId as string
    : "api";
  const item = await placeHold({
    scope: input.scope as import("../models/LegalHoldRecord.js").HoldScope,
    targetId: input.targetId,
    reason: input.reason,
    createdBy: requestedBy
  });
  res.status(201).json({ item });
});

internalPlatformRouter.post("/governance/holds/:holdId/release", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.hold.release", "governance"), async (req, res) => {
  const hold = await releaseHold(req.params.holdId ?? "");
  if (!hold) {
    res.status(404).json({ error: { code: "HOLD_NOT_FOUND", message: "Hold not found or already released." } });
    return;
  }
  res.json({ item: hold });
});

// Quarantine
internalPlatformRouter.get("/governance/quarantine", async (req, res) => {
  const quarantineType = stringQuery(req.query.quarantineType) as import("../models/QuarantineRecord.js").QuarantineType | undefined;
  const resolution = stringQuery(req.query.resolution) as import("../models/QuarantineRecord.js").QuarantineResolution | undefined;
  const limit = limitFromQuery(req.query.limit, 50);
  res.json({ items: await listQuarantined({ quarantineType, resolution }, limit), summary: await getQuarantineSummary() });
});

internalPlatformRouter.get("/governance/quarantine/summary", async (_req, res) => {
  res.json({ item: await getQuarantineSummary() });
});

internalPlatformRouter.get("/governance/quarantine/:quarantineId", async (req, res) => {
  const record = await getQuarantineRecord(req.params.quarantineId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "QUARANTINE_NOT_FOUND", message: "Quarantine record not found." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/governance/quarantine/:quarantineId/resolve", ownerOnly, auditAdminAction("governance.quarantine.resolve", "governance"), async (req, res) => {
  const input = req.body as { resolution?: string; reviewedBy?: string };
  if (input.resolution !== "approved" && input.resolution !== "rejected") {
    res.status(400).json({ error: { message: "resolution must be 'approved' or 'rejected'." } });
    return;
  }
  const record = await resolveQuarantine(req.params.quarantineId ?? "", input.resolution, input.reviewedBy);
  if (!record) {
    res.status(404).json({ error: { code: "QUARANTINE_NOT_FOUND", message: "Record not found or already resolved." } });
    return;
  }
  res.json({ item: record });
});

// Data quality
internalPlatformRouter.get("/governance/data-quality", async (_req, res) => {
  res.json({ item: await getDataQualitySummary() });
});

internalPlatformRouter.post("/governance/data-quality/audit-benchmarks", ownerOnly, auditAdminAction("governance.quality.audit_benchmarks", "governance"), async (req, res) => {
  const limit = limitFromQuery((req.body as { limit?: number }).limit, 100);
  const result = await runBenchmarkDataQualityAudit(limit);
  res.json({ item: result });
});

// Scoring algorithm versioning
internalPlatformRouter.get("/governance/scoring-versions", async (req, res) => {
  res.json({ items: await listVersions(limitFromQuery(req.query.limit, 50)), current: await getCurrentVersion() });
});

internalPlatformRouter.get("/governance/scoring-versions/current", async (_req, res) => {
  const current = await getCurrentVersion();
  if (!current) {
    res.status(404).json({ error: { code: "NO_CURRENT_VERSION", message: "No current scoring version is set." } });
    return;
  }
  res.json({ item: current });
});

internalPlatformRouter.get("/governance/scoring-versions/:versionId", async (req, res) => {
  const version = await getVersion(req.params.versionId ?? "");
  if (!version) {
    res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Scoring version not found." } });
    return;
  }
  res.json({ item: version });
});

internalPlatformRouter.post("/governance/scoring-versions", ownerOnly, auditAdminAction("governance.scoring_version.publish", "governance"), async (req, res) => {
  const input = req.body as { versionTag?: string };
  if (!input.versionTag) {
    res.status(400).json({ error: { message: "versionTag is required." } });
    return;
  }
  try {
    const item = await publishVersion({ ...req.body as Record<string, unknown>, versionTag: input.versionTag });
    res.status(201).json({ item });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : "Invalid version input." } });
  }
});

internalPlatformRouter.post("/governance/scoring-versions/:versionId/quality-check", ownerOnly, auditAdminAction("governance.scoring_version.quality_check", "governance"), async (req, res) => {
  const version = await runQualityCheck(req.params.versionId ?? "");
  if (!version) {
    res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Scoring version not found." } });
    return;
  }
  res.json({ item: version });
});

internalPlatformRouter.post("/governance/scoring-versions/:versionId/deprecate", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.scoring_version.deprecate", "governance"), async (req, res) => {
  const version = await deprecateVersion(req.params.versionId ?? "");
  if (!version) {
    res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Scoring version not found." } });
    return;
  }
  res.json({ item: version });
});

internalPlatformRouter.post("/governance/scoring-versions/:versionId/rollback", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.scoring_version.rollback", "governance"), async (req, res) => {
  const version = await rollbackToVersion(req.params.versionId ?? "");
  if (!version) {
    res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Scoring version not found or is deprecated." } });
    return;
  }
  res.json({ item: version });
});

// Compliance exports
internalPlatformRouter.get("/governance/compliance-exports", async (req, res) => {
  const status = stringQuery(req.query.status) as import("../models/ComplianceExportRecord.js").ExportStatus | undefined;
  const exportType = stringQuery(req.query.exportType) as import("../models/ComplianceExportRecord.js").ExportType | undefined;
  const limit = limitFromQuery(req.query.limit, 50);
  res.json({ items: await listExports({ status, exportType }, limit) });
});

internalPlatformRouter.get("/governance/compliance-exports/:exportId", async (req, res) => {
  const record = await getExport(req.params.exportId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "EXPORT_NOT_FOUND", message: "Compliance export not found." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/governance/compliance-exports", ownerOnly, auditAdminAction("governance.compliance_export.request", "governance"), async (req, res) => {
  const input = req.body as { exportType?: string; scope?: string; targetId?: string; notes?: string };
  if (!input.exportType || !input.scope || !input.targetId) {
    res.status(400).json({ error: { message: "exportType, scope, and targetId are required." } });
    return;
  }
  const requestedBy = (req as unknown as Record<string, unknown>).adminUser
    ? ((req as unknown as Record<string, unknown>).adminUser as Record<string, unknown>).adminId as string
    : "api";
  const item = await requestExport({
    exportType: input.exportType as import("../models/ComplianceExportRecord.js").ExportType,
    scope: input.scope as "workspace" | "tenant" | "user",
    targetId: input.targetId,
    requestedBy,
    notes: input.notes
  });
  res.status(202).json({ item });
});

internalPlatformRouter.post("/governance/compliance-exports/:exportId/process", ownerOnly, requireDestructiveConfirm, auditAdminAction("governance.compliance_export.process", "governance"), async (req, res) => {
  try {
    const item = await processExport(req.params.exportId ?? "");
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: { message: err instanceof Error ? err.message : "Export processing failed." } });
  }
});

// ── Backup and disaster recovery routes ───────────────────────────────────────

internalPlatformRouter.get("/backup/status", async (_req, res) => {
  res.json({ item: await getBackupStatusSummary() });
});

internalPlatformRouter.get("/backup/history", async (req, res) => {
  res.json({ items: await listBackupRecords(limitFromQuery(req.query.limit, 20)) });
});

internalPlatformRouter.get("/backup/:backupId", async (req, res) => {
  const record = await getBackupRecord(req.params.backupId ?? "");
  if (!record) {
    res.status(404).json({ error: { code: "BACKUP_NOT_FOUND", message: "Backup record not found." } });
    return;
  }
  res.json({ item: record });
});

internalPlatformRouter.post("/backup/run", ownerOnly, auditAdminAction("backup.run", "backup"), async (req, res) => {
  const input = req.body as { trigger?: string; collections?: string[] };
  const trigger = input.trigger === "scheduled" ? "scheduled" : "api";
  try {
    const item = await runBackup({ trigger, collections: Array.isArray(input.collections) ? input.collections : undefined });
    res.status(202).json({ item });
  } catch (err) {
    if (err instanceof BackupError) {
      res.status(err.status).json({ error: { message: err.message } });
      return;
    }
    throw err;
  }
});

internalPlatformRouter.post("/backup/:backupId/verify", ownerOnly, requireDestructiveConfirm, auditAdminAction("backup.verify", "backup"), async (req, res) => {
  try {
    const item = await verifyBackup(req.params.backupId ?? "");
    res.json({ item });
  } catch (err) {
    if (err instanceof BackupError) {
      res.status(err.status).json({ error: { message: err.message } });
      return;
    }
    throw err;
  }
});

// ── VIL: Behavioral Consent Framework management ───────────────────────────────

// GET /api/internal/platform/vil/consent/summary?workspaceId=
internalPlatformRouter.get("/vil/consent/summary", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const summary = await getConsentSummary(workspaceId);
  res.json(summary);
});

// GET /api/internal/platform/vil/consent?workspaceId=&consentGiven=
internalPlatformRouter.get("/vil/consent", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const consentGivenRaw = stringQuery(req.query["consentGiven"]);
  const consentGiven = consentGivenRaw === "true" ? true : consentGivenRaw === "false" ? false : undefined;
  const { records, total } = await listConsentRecords(workspaceId, {
    consentGiven,
    limit: limitFromQuery(req.query["limit"], 50),
    skip: limitFromQuery(req.query["skip"], 0)
  });
  res.json({ records, total });
});

// GET /api/internal/platform/vil/consent/:consentId
internalPlatformRouter.get("/vil/consent/:consentId", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const record = await getConsentById(req.params.consentId!);
  if (!record) { res.status(404).json({ error: { message: "Consent record not found" } }); return; }
  res.json({ record });
});

// GET /api/internal/platform/vil/consent/check?visitorId=&workspaceId=
internalPlatformRouter.get("/vil/consent/check", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const visitorId = stringQuery(req.query["visitorId"]);
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!visitorId || !workspaceId) { res.status(400).json({ error: { message: "visitorId and workspaceId are required" } }); return; }
  const result = await validateConsentForTracking(visitorId, workspaceId);
  res.json(result);
});

// POST /api/internal/platform/vil/consent/purge
// GDPR/CCPA right-to-erasure: purge all behavioral data for a visitor.
internalPlatformRouter.post("/vil/consent/purge", ownerOnly, async (req, res) => {
  const { visitorId, workspaceId } = req.body as Record<string, unknown>;
  if (!visitorId || !workspaceId) { res.status(400).json({ error: { message: "visitorId and workspaceId are required" } }); return; }
  const result = await purgeVisitorData(String(visitorId), String(workspaceId));
  res.json({ ok: true, ...result });
});

// ── Visitor Intelligence Layer (VIL) management ────────────────────────────────

// GET /api/internal/platform/vil/sessions?workspaceId=&status=&limit=&skip=
internalPlatformRouter.get("/vil/sessions", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const status = stringQuery(req.query["status"]) as "active" | "ended" | "expired" | undefined;
  const { sessions, total } = await listSessionsForWorkspace(workspaceId, {
    status,
    limit: limitFromQuery(req.query["limit"], 50),
    skip: limitFromQuery(req.query["skip"], 0)
  });
  res.json({ sessions, total });
});

// GET /api/internal/platform/vil/archetypes?workspaceId=
internalPlatformRouter.get("/vil/archetypes", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const distribution = await getArchetypeDistribution(workspaceId);
  res.json({ distribution });
});

// GET /api/internal/platform/vil/evidence?workspaceId=&evidenceType=&minConfidence=&limit=&skip=
internalPlatformRouter.get("/vil/evidence", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const { evidence, total } = await listBehavioralEvidence(workspaceId, {
    evidenceType: stringQuery(req.query["evidenceType"]) as never,
    minConfidence: req.query["minConfidence"] ? Number(req.query["minConfidence"]) : undefined,
    limit: limitFromQuery(req.query["limit"], 50),
    skip: limitFromQuery(req.query["skip"], 0)
  });
  res.json({ evidence, total });
});

// GET /api/internal/platform/vil/evidence/:behavioralEvidenceId
internalPlatformRouter.get("/vil/evidence/:behavioralEvidenceId", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const evidence = await getBehavioralEvidenceById(req.params.behavioralEvidenceId!);
  if (!evidence) { res.status(404).json({ error: { message: "Behavioral evidence not found" } }); return; }
  res.json({ evidence });
});

// GET /api/internal/platform/vil/evidence/:behavioralEvidenceId/lineage
internalPlatformRouter.get("/vil/evidence/:behavioralEvidenceId/lineage", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const trace = await traceBehavioralEvidence(req.params.behavioralEvidenceId!);
  res.json(trace);
});

// GET /api/internal/platform/vil/lineage?workspaceId=
internalPlatformRouter.get("/vil/lineage", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const lineage = listLineageForWorkspace(workspaceId);
  res.json({ lineage, total: lineage.length });
});

// GET /api/internal/platform/vil/vfs/:sessionId
internalPlatformRouter.get("/vil/vfs/:sessionId", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const result = await computeSessionVfs(req.params.sessionId!);
  res.json(result);
});

// POST /api/internal/platform/vil/evidence/generate
// Trigger evidence generation for a workspace.
internalPlatformRouter.post("/vil/evidence/generate", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId, tenantSlug, windowDays } = req.body as Record<string, unknown>;
  if (!workspaceId || !tenantSlug) {
    res.status(400).json({ error: { message: "workspaceId and tenantSlug are required" } });
    return;
  }
  const result = await runEvidenceGeneration(
    String(workspaceId),
    String(tenantSlug),
    typeof windowDays === "number" ? windowDays : 7
  );
  res.json(result);
});

// GET /api/internal/platform/vil/event-counts?workspaceId=&since=
internalPlatformRouter.get("/vil/event-counts", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const sinceRaw = stringQuery(req.query["since"]);
  const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const counts = await getEventCountsByType(workspaceId, since);
  res.json({ counts, since });
});

// GET /api/internal/platform/vil/sla
internalPlatformRouter.get("/vil/sla", internalRoleAuth(["owner", "manager"]), async (_req, res) => {
  const [slaStatus, metrics] = await Promise.all([
    checkVilSlas(),
    Promise.resolve(getVilMetricsSummary())
  ]);
  res.json({ sla: slaStatus, metrics });
});

// ── Recommendation Effectiveness Database ──────────────────────────────────────

// GET /api/internal/platform/vil/effectiveness?workspaceId=&status=
internalPlatformRouter.get("/vil/effectiveness", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const { records, total } = await listEffectivenessRecords(workspaceId, {
    status: stringQuery(req.query["status"]) as never,
    limit: limitFromQuery(req.query["limit"], 50),
    skip: limitFromQuery(req.query["skip"], 0)
  });
  res.json({ records, total });
});

// GET /api/internal/platform/vil/effectiveness/stats?recommendationType=
internalPlatformRouter.get("/vil/effectiveness/stats", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const stats = await getEffectivenessStats({
    recommendationType: stringQuery(req.query["recommendationType"]),
    workspaceId: stringQuery(req.query["workspaceId"])
  });
  res.json(stats);
});

// GET /api/internal/platform/vil/effectiveness/top
internalPlatformRouter.get("/vil/effectiveness/top", internalRoleAuth(["owner", "manager"]), async (_req, res) => {
  const top = await getTopPerformingRecommendationTypes();
  res.json({ recommendations: top });
});

// POST /api/internal/platform/vil/effectiveness
// Record that a recommendation has been applied to a workspace.
internalPlatformRouter.post("/vil/effectiveness", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { recommendationId, workspaceId, tenantSlug, recommendationType, recommendationSummary, appliedBy, beforeEvidenceIds } =
    req.body as Record<string, unknown>;
  if (!recommendationId || !workspaceId || !tenantSlug || !recommendationType || !recommendationSummary) {
    res.status(400).json({ error: { message: "recommendationId, workspaceId, tenantSlug, recommendationType, recommendationSummary are required" } });
    return;
  }
  const { record } = await recordRecommendationApplication({
    recommendationId: String(recommendationId),
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    recommendationType: String(recommendationType),
    recommendationSummary: String(recommendationSummary),
    appliedBy: appliedBy ? String(appliedBy) : undefined,
    beforeEvidenceIds: Array.isArray(beforeEvidenceIds) ? beforeEvidenceIds.map(String) : []
  });
  res.status(201).json({ record });
});

// POST /api/internal/platform/vil/effectiveness/:effectivenessId/validate
internalPlatformRouter.post("/vil/effectiveness/:effectivenessId/validate", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const record = await validateEffectiveness(req.params.effectivenessId!);
  if (!record) { res.status(404).json({ error: { message: "Effectiveness record not found" } }); return; }
  res.json({ record });
});

// ── End VIL management ─────────────────────────────────────────────────────────

// ── Continuous Intelligence Improvement Framework (CIIF) ──────────────────────

// GET /api/internal/platform/ciif/kgs
internalPlatformRouter.get("/ciif/kgs", internalRoleAuth(["owner", "manager"]), async (_req, res) => {
  const item = await getLatestKgs();
  res.json({ item });
});

// GET /api/internal/platform/ciif/kgs/history?limit=&offset=
internalPlatformRouter.get("/ciif/kgs/history", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const items = await listKgsHistory({
    limit: limitFromQuery(req.query["limit"], 30),
    offset: limitFromQuery(req.query["offset"], 0)
  });
  res.json({ items, total: items.length });
});

// POST /api/internal/platform/ciif/kgs/snapshot
internalPlatformRouter.post("/ciif/kgs/snapshot", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId, totalWorkspaces } = req.body as Record<string, unknown>;
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const item = await computeAndSnapshotKgs({
    workspaceId: String(workspaceId),
    totalWorkspaces: typeof totalWorkspaces === "number" ? totalWorkspaces : undefined,
    periodStart,
    periodEnd: now
  });
  res.status(201).json({ item });
});

// GET /api/internal/platform/ciif/report?workspaceId=
internalPlatformRouter.get("/ciif/report", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const report = await generateAgencyIntelligenceReport(workspaceId, periodStart, now);
  res.json({ report });
});

// GET /api/internal/platform/ciif/vrsr?workspaceId=
internalPlatformRouter.get("/ciif/vrsr", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const result = await computeVrsr(workspaceId);
  res.json(result);
});

// ── CIIF: Business DNA Engine ─────────────────────────────────────────────────

// GET /api/internal/platform/ciif/business-dna?tenantSlug=
internalPlatformRouter.get("/ciif/business-dna", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const tenantSlug = stringQuery(req.query["tenantSlug"]);
  if (!tenantSlug) { res.status(400).json({ error: { message: "tenantSlug is required" } }); return; }
  const items = await listBusinessDnas(tenantSlug, {
    limit: limitFromQuery(req.query["limit"], 50),
    offset: limitFromQuery(req.query["offset"], 0)
  });
  res.json({ items, total: items.length });
});

// GET /api/internal/platform/ciif/business-dna/:workspaceId
internalPlatformRouter.get("/ciif/business-dna/:workspaceId", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const item = await getBusinessDna(req.params.workspaceId!);
  if (!item) { res.status(404).json({ error: { message: "Business DNA record not found" } }); return; }
  res.json({ item });
});

// PATCH /api/internal/platform/ciif/business-dna/:workspaceId/behavioral
internalPlatformRouter.patch("/ciif/business-dna/:workspaceId/behavioral", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { dominantArchetype, avgVfsScore, topExitPages, topConversionPaths, openOpportunityCount, businessInsights } =
    req.body as Record<string, unknown>;
  await updateDnaFromBehavioralData({
    workspaceId: req.params.workspaceId!,
    dominantArchetype: dominantArchetype ? String(dominantArchetype) : undefined,
    avgVfsScore: typeof avgVfsScore === "number" ? avgVfsScore : undefined,
    topExitPages: Array.isArray(topExitPages) ? topExitPages.map(String) : undefined,
    topConversionPaths: Array.isArray(topConversionPaths) ? topConversionPaths.map(String) : undefined,
    openOpportunityCount: typeof openOpportunityCount === "number" ? openOpportunityCount : undefined,
    businessInsights: Array.isArray(businessInsights) ? businessInsights.map(String) : undefined
  });
  res.json({ ok: true });
});

// ── CIIF: Visitor DNA Framework ───────────────────────────────────────────────

// GET /api/internal/platform/ciif/visitor-dna?workspaceId=
internalPlatformRouter.get("/ciif/visitor-dna", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const items = await listVisitorDnas(workspaceId);
  const distribution = await getArchetypeDistributionSummary(workspaceId);
  res.json({ items, distribution });
});

// GET /api/internal/platform/ciif/visitor-dna/:workspaceId/:archetype
internalPlatformRouter.get("/ciif/visitor-dna/:workspaceId/:archetype", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const item = await getVisitorDnaForArchetype(req.params.workspaceId!, req.params.archetype as never);
  if (!item) { res.status(404).json({ error: { message: "Visitor DNA record not found for this archetype" } }); return; }
  res.json({ item });
});

// ── CIIF: Intelligence Validation Engine ─────────────────────────────────────

// GET /api/internal/platform/ciif/validation?workspaceId=&artifactType=&calibrationStatus=
internalPlatformRouter.get("/ciif/validation", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const records = await listValidationsForWorkspace(workspaceId, {
    artifactType: stringQuery(req.query["artifactType"]) as never,
    calibrationStatus: stringQuery(req.query["calibrationStatus"]) as never,
    actionRequiredOnly: req.query["actionRequiredOnly"] === "true",
    limit: limitFromQuery(req.query["limit"], 50),
    offset: limitFromQuery(req.query["offset"], 0)
  });
  res.json({ records, total: records.length });
});

// GET /api/internal/platform/ciif/validation/stats?workspaceId=
internalPlatformRouter.get("/ciif/validation/stats", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const stats = await getValidationAccuracyStats(workspaceId);
  res.json(stats);
});

// POST /api/internal/platform/ciif/validation
internalPlatformRouter.post("/ciif/validation", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId, tenantSlug, artifactType, artifactId, predictedOutcome, actualOutcome, predictedConfidence, evidenceIds, adjustmentRecommended } =
    req.body as Record<string, unknown>;
  if (!workspaceId || !tenantSlug || !artifactType || !artifactId || !predictedOutcome || !actualOutcome || predictedConfidence === undefined) {
    res.status(400).json({ error: { message: "workspaceId, tenantSlug, artifactType, artifactId, predictedOutcome, actualOutcome, predictedConfidence are required" } });
    return;
  }
  const record = await recordValidation({
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    artifactType: artifactType as never,
    artifactId: String(artifactId),
    predictedOutcome: predictedOutcome as Record<string, unknown>,
    actualOutcome: actualOutcome as Record<string, unknown>,
    predictedConfidence: Number(predictedConfidence),
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.map(String) : undefined,
    adjustmentRecommended: adjustmentRecommended ? String(adjustmentRecommended) : undefined
  });
  res.status(201).json({ record });
});

// ── CIIF: Opportunity Discovery Engine ───────────────────────────────────────

// GET /api/internal/platform/ciif/opportunities?workspaceId=&status=&opportunityType=
internalPlatformRouter.get("/ciif/opportunities", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const items = await listOpportunities(workspaceId, {
    status: stringQuery(req.query["status"]) as never,
    opportunityType: stringQuery(req.query["opportunityType"]) as never,
    minPriorityScore: req.query["minPriorityScore"] ? Number(req.query["minPriorityScore"]) : undefined,
    limit: limitFromQuery(req.query["limit"], 50),
    offset: limitFromQuery(req.query["offset"], 0)
  });
  res.json({ items, total: items.length });
});

// GET /api/internal/platform/ciif/opportunities/stats?workspaceId=
internalPlatformRouter.get("/ciif/opportunities/stats", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const stats = await getOpportunityStats(workspaceId);
  res.json(stats);
});

// POST /api/internal/platform/ciif/opportunities
internalPlatformRouter.post("/ciif/opportunities", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId, tenantSlug, opportunityType, title, description, estimatedRevenueImpact, effortLevel, evidenceIds, behavioralEvidenceIds, confidenceScore, discoveredBy } =
    req.body as Record<string, unknown>;
  if (!workspaceId || !tenantSlug || !opportunityType || !title || !description || confidenceScore === undefined || !discoveredBy) {
    res.status(400).json({ error: { message: "workspaceId, tenantSlug, opportunityType, title, description, confidenceScore, discoveredBy are required" } });
    return;
  }
  const item = await createOpportunity({
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    opportunityType: opportunityType as never,
    title: String(title),
    description: String(description),
    estimatedRevenueImpact: typeof estimatedRevenueImpact === "number" ? estimatedRevenueImpact : undefined,
    effortLevel: effortLevel as never,
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.map(String) : undefined,
    behavioralEvidenceIds: Array.isArray(behavioralEvidenceIds) ? behavioralEvidenceIds.map(String) : undefined,
    confidenceScore: Number(confidenceScore),
    discoveredBy: discoveredBy as never
  });
  res.status(201).json({ item });
});

// PATCH /api/internal/platform/ciif/opportunities/:opportunityId/status
internalPlatformRouter.patch("/ciif/opportunities/:opportunityId/status", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { status, reason } = req.body as Record<string, unknown>;
  if (!status) { res.status(400).json({ error: { message: "status is required" } }); return; }
  await updateOpportunityStatus(req.params.opportunityId!, status as never, reason ? String(reason) : undefined);
  res.json({ ok: true });
});

// POST /api/internal/platform/ciif/opportunities/discover
internalPlatformRouter.post("/ciif/opportunities/discover", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId, tenantSlug, ossScore, weaknesses, avgVfsScore, topExitPages, behavioralEvidenceIds, evidenceIds, competitorGaps } =
    req.body as Record<string, unknown>;
  if (!workspaceId || !tenantSlug) {
    res.status(400).json({ error: { message: "workspaceId and tenantSlug are required" } });
    return;
  }
  const count = await discoverOpportunities({
    workspaceId: String(workspaceId),
    tenantSlug: String(tenantSlug),
    ossScore: typeof ossScore === "number" ? ossScore : undefined,
    weaknesses: Array.isArray(weaknesses) ? weaknesses.map(String) : undefined,
    avgVfsScore: typeof avgVfsScore === "number" ? avgVfsScore : undefined,
    topExitPages: Array.isArray(topExitPages) ? topExitPages.map(String) : undefined,
    behavioralEvidenceIds: Array.isArray(behavioralEvidenceIds) ? behavioralEvidenceIds.map(String) : undefined,
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.map(String) : undefined,
    competitorGaps: Array.isArray(competitorGaps) ? competitorGaps.map(String) : undefined
  });
  res.status(201).json({ opportunitiesCreated: count });
});

// ── CIIF: Evidence Quality Classification ─────────────────────────────────────

// GET /api/internal/platform/ciif/evidence-quality/stats?workspaceId=
internalPlatformRouter.get("/ciif/evidence-quality/stats", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const workspaceId = stringQuery(req.query["workspaceId"]);
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const stats = await getEvidenceQualityStats(workspaceId);
  res.json(stats);
});

// POST /api/internal/platform/ciif/evidence-quality/classify-behavioral
// Batch classify all unclassified behavioral evidence for a workspace.
internalPlatformRouter.post("/ciif/evidence-quality/classify-behavioral", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { workspaceId } = req.body as Record<string, unknown>;
  if (!workspaceId) { res.status(400).json({ error: { message: "workspaceId is required" } }); return; }
  const result = await classifyUnclassifiedBehavioralEvidence(String(workspaceId));
  res.json(result);
});

// POST /api/internal/platform/ciif/evidence-quality/classify
// Classify a specific evidence record.
internalPlatformRouter.post("/ciif/evidence-quality/classify", internalRoleAuth(["owner", "manager"]), async (req, res) => {
  const { evidenceId, behavioralEvidenceId, sampleSize, statisticalSignificance, sourceType, consistencyLevel, priorValidations, priorValidationSuccesses } =
    req.body as Record<string, unknown>;

  const factors = {
    sampleSize: typeof sampleSize === "number" ? sampleSize : undefined,
    statisticalSignificance: statisticalSignificance === true,
    sourceType: sourceType as never,
    consistencyLevel: consistencyLevel as never,
    priorValidations: typeof priorValidations === "number" ? priorValidations : undefined,
    priorValidationSuccesses: typeof priorValidationSuccesses === "number" ? priorValidationSuccesses : undefined
  };

  if (evidenceId) {
    const result = await classifyEvidenceRecord(String(evidenceId), factors);
    res.json(result);
  } else if (behavioralEvidenceId) {
    const result = await classifyBehavioralEvidence(String(behavioralEvidenceId), factors);
    res.json(result);
  } else {
    res.status(400).json({ error: { message: "evidenceId or behavioralEvidenceId is required" } });
  }
});

// ── End CIIF management ────────────────────────────────────────────────────────

internalPlatformRouter.get("/export.pdf", async (_req, res) => {
  const pdf = await renderOperationsReportPdf();
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `attachment; filename="systolab-operations-${Date.now()}.pdf"`);
  res.send(pdf);
});

function limitFromQuery(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" || typeof raw === "number" ? Number(raw) : fallback;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : fallback;
}

function stringQuery(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
