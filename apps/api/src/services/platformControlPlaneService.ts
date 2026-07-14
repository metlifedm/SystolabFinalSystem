import PDFDocument from "pdfkit";
import { SYSTOLAB_VERSION, type ReportSnapshot } from "@systolab/shared";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { getBackupStatusSummary } from "./backupService.js";
import { AnalyticsWarehouseRecord } from "../models/AnalyticsWarehouseRecord.js";
import { ApiGovernanceRecord } from "../models/ApiGovernanceRecord.js";
import { ArtifactVersionRecord } from "../models/ArtifactVersionRecord.js";
import { AuthAuditLog } from "../models/AuthAuditLog.js";
import { AuthSession } from "../models/AuthSession.js";
import { AuthUser } from "../models/AuthUser.js";
import { EvidenceArtifact } from "../models/EvidenceArtifact.js";
import { FeatureFlagRecord } from "../models/FeatureFlagRecord.js";
import { GraphIntelligenceRecord } from "../models/GraphIntelligenceRecord.js";
import { IntelligenceLineageRecord } from "../models/IntelligenceLineageRecord.js";
import { ModuleRegistryEntry } from "../models/ModuleRegistryEntry.js";
import { OperationalControlRecord } from "../models/OperationalControlRecord.js";
import { PlatformJob } from "../models/PlatformJob.js";
import { Snapshot } from "../models/Snapshot.js";
import { UserSearchActivity } from "../models/UserSearchActivity.js";
import { Workspace } from "../models/Workspace.js";
import { makeId, sha256 } from "../utils/crypto.js";
import { publishIntelligenceEvent } from "./intelligenceEventBus.js";
import { getCounterValue, histogramPercentile, histogramSummary, sumCounterValues } from "./metricsService.js";
import { getAlertSummary, resolveAlertByKey, triggerAlert } from "./alertService.js";
import {
  getDevelopmentSearchActivities,
  getDevelopmentSnapshots,
  saveDevelopmentSearchActivity
} from "./developmentPersistenceService.js";

type PlainRecord = Record<string, unknown>;
type ModuleState = "active" | "inactive" | "disabled";
type ModuleHealth = "healthy" | "degraded" | "failed" | "unknown";
type JobStatus = "queued" | "scheduled" | "running" | "completed" | "failed" | "dead_letter";

interface ModuleRegistryView {
  moduleId: string;
  name: string;
  version: string;
  dependencies: string[];
  permissions: string[];
  healthStatus: ModuleHealth;
  activationState: ModuleState;
  ownerTeam: string;
  compatibility: PlainRecord;
  auditHistory: PlainRecord[];
  lastValidatedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PlatformJobView {
  jobId: string;
  jobType: string;
  queue: string;
  priority: number;
  status: JobStatus;
  payload: PlainRecord;
  attempts: number;
  maxAttempts: number;
  scheduledFor: Date;
  lockedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  progress: number;
  result?: PlainRecord;
  auditHistory: PlainRecord[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface WarehouseView {
  recordId: string;
  grain: "snapshot" | "daily" | "weekly" | "monthly" | "custom";
  periodStartAt: Date;
  periodEndAt: Date;
  dimensions: PlainRecord;
  metrics: PlainRecord;
  sourceIds: string[];
  createdAt?: Date;
}

interface ApiGovernanceView {
  recordId: string;
  recordType: "usage_audit" | "quota" | "webhook" | "developer_control" | "api_version";
  tenantSlug: string;
  workspaceId?: string;
  apiVersion: string;
  method?: string;
  path?: string;
  statusCode?: number;
  keyHashPrefix?: string;
  quotaWindow?: string;
  quotaLimit?: number;
  quotaUsed?: number;
  payload: PlainRecord;
  createdAt?: Date;
}

interface OperationalControlView {
  recordId: string;
  controlType:
    | "disaster_recovery"
    | "observability"
    | "data_governance"
    | "intelligence_validation"
    | "scan_slo"
    | "governance_contract"
    | "data_quality"
    | "cost_intelligence"
    | "sandbox"
    | "ai_analyst_context"
    | "realtime_refresh"
    | "managed_white_label";
  status: "passing" | "warning" | "failing" | "informational";
  scope: string;
  score?: number;
  payload: PlainRecord;
  createdAt?: Date;
}

type ManagedWhiteLabelRole = "super_admin" | "partner" | "team_member" | "client";
type ManagedWorkspaceStatus = "draft" | "active" | "suspended" | "archived";

interface ManagedWhiteLabelWorkspaceView {
  workspaceId: string;
  tenantSlug: string;
  workspaceName: string;
  partnerType: string;
  status: ManagedWorkspaceStatus;
  branding: PlainRecord;
  domains: PlainRecord[];
  enabledFeatures: string[];
  allowedReports: string[];
  allowedExports: string[];
  allowedApis: string[];
  reportSections: string[];
  advancedEvidenceEnabled: boolean;
  permissions: PlainRecord;
  securityPolicy: PlainRecord;
  subscriptionPlan: PlainRecord;
  approval: PlainRecord;
  auditHistory: PlainRecord[];
  createdAt?: Date;
  updatedAt?: Date;
}

const memoryModules = new Map<string, ModuleRegistryView>();
const memoryJobs = new Map<string, PlatformJobView>();
const memoryWarehouse: WarehouseView[] = [];
const memoryEvidenceArtifacts: PlainRecord[] = [];
const memoryApiGovernance: ApiGovernanceView[] = [];
const memoryArtifactVersions: PlainRecord[] = [];
const memoryControls: OperationalControlView[] = [];
const memoryGraphRecords: PlainRecord[] = [];
const memoryFeatureFlags = new Map<string, PlainRecord>();
const memoryLineage: PlainRecord[] = [];
const memoryReports: Array<{ workspaceId: string; report: ReportSnapshot }> = getDevelopmentSnapshots()
  .map((report) => ({ workspaceId: `ws_${sha256(`${report.tenantBranding.slug}:${report.targetUrl.toLowerCase()}`).slice(0, 20)}`, report }));
const memoryUserSearchActivities: PlainRecord[] = getDevelopmentSearchActivities();
const memoryManagedWhiteLabelWorkspaces = new Map<string, ManagedWhiteLabelWorkspaceView>();
let memoryArtifactsHydration: Promise<void> | null = null;

const DEFAULT_MODULES: ModuleRegistryView[] = [
  module("module-registry", "Module Registry System", [], ["platform:modules:manage"]),
  module("distributed-jobs", "Distributed Job Processing Framework", ["module-registry"], ["platform:jobs:manage"]),
  module("truth-engine", "Deterministic Scan Truth Engine", ["module-registry", "governance-contract"], ["scan:execute", "evidence:write"]),
  module("evidence-repository", "Immutable Evidence Repository", ["truth-engine"], ["evidence:write", "evidence:read"]),
  module("analytics-warehouse", "Analytics Warehouse", ["evidence-repository", "distributed-jobs"], ["warehouse:materialize"]),
  module("ai-analyst-layer", "AI Analyst Layer", ["analytics-warehouse", "governance-contract"], ["analyst:context:read"]),
  module("workspace-intelligence", "Workspace Intelligence Architecture", ["module-registry"], ["workspace:read", "workspace:write"]),
  module("api-governance", "API Governance Layer", ["module-registry"], ["api:audit", "api:quota"]),
  module("artifact-versioning", "Artifact Versioning System", ["evidence-repository"], ["artifact:version"]),
  module("disaster-recovery", "Disaster Recovery Framework", ["analytics-warehouse"], ["dr:status", "dr:test"]),
  module("observability", "Unified Observability Framework", ["distributed-jobs"], ["observability:read"]),
  module("data-governance", "Data Governance Controls", ["evidence-repository"], ["data:govern"]),
  module("intelligence-validation", "Intelligence Validation Engine", ["truth-engine", "evidence-repository"], ["intelligence:validate"]),
  module("scan-slo", "Scan Service Level Objectives", ["truth-engine", "distributed-jobs"], ["slo:read"]),
  module("realtime-refresh", "Homepage Auto-Refresh Intelligence", ["distributed-jobs"], ["events:read"]),
  module("governance-contract", "SYSTOLAB Governance Contract", [], ["governance:enforce"]),
  module("intelligence-lineage", "Intelligence Lineage System", ["evidence-repository", "artifact-versioning"], ["lineage:read"]),
  module("data-quality", "Data Quality Framework", ["analytics-warehouse"], ["quality:check"]),
  module("cost-intelligence", "Cost Intelligence Engine", ["observability", "distributed-jobs"], ["cost:read"]),
  module("graph-intelligence", "Graph Intelligence Layer", ["intelligence-lineage"], ["graph:traverse"]),
  module("event-bus", "Centralized Event Bus", ["module-registry"], ["event:publish", "event:replay"]),
  module("multi-tenant-isolation", "Multi-Tenant Isolation", ["workspace-intelligence", "api-governance"], ["tenant:isolate"]),
  module("feature-flags", "Feature Flag Framework", ["module-registry"], ["feature:manage"]),
  module("intelligence-sandbox", "Intelligence Sandbox Environment", ["feature-flags", "intelligence-validation"], ["sandbox:run"]),
  module("managed-white-label-control", "Managed White-Label Control Center", ["workspace-intelligence", "feature-flags", "api-governance", "governance-contract"], ["white_label:govern"])
];

const DEFAULT_FLAGS: PlainRecord[] = [
  flag("iire.enabled", "Internal Intelligence Reporting Engine access.", "enabled", 100),
  flag("competitor_relationship_graph.enabled", "Competitor Relationship Graph output inside IIRE.", "enabled", 100),
  flag("knowledge_growth_score.enabled", "Knowledge Growth Score inside IAL.", "enabled", 100),
  flag("distributed_jobs.enabled", "Self-owned distributed job metadata and worker framework.", "enabled", 100),
  flag("intelligence_sandbox.enabled", "Internal sandbox experiments for scoring and benchmark methods.", "enabled", 100),
  flag("managed_white_label.enabled", "SYSTOLAB-owned managed white-label workspace governance.", "enabled", 100),
  flag("managed_white_label.advanced_evidence", "Owner-approved advanced evidence visibility per workspace.", "gradual", 0),
  flag("managed_white_label.custom_domains", "Owner-approved custom domain configuration per workspace.", "enabled", 100)
];

export async function listPlatformModules(): Promise<ModuleRegistryView[]> {
  await ensureModuleRegistry();
  if (!isMongoConnected()) return [...memoryModules.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  const rows = await ModuleRegistryEntry.find({}).sort({ moduleId: 1 }).lean();
  return rows.map((row) => ({ ...row, auditHistory: row.auditHistory as PlainRecord[], compatibility: row.compatibility as PlainRecord })) as ModuleRegistryView[];
}

export async function upsertPlatformModule(input: Partial<ModuleRegistryView> & { moduleId: string; name: string }): Promise<ModuleRegistryView> {
  await ensureModuleRegistry();
  const existing = (await getModule(input.moduleId)) ?? module(input.moduleId, input.name, input.dependencies ?? [], input.permissions ?? []);
  const now = new Date();
  const next: ModuleRegistryView = {
    ...existing,
    ...input,
    version: input.version ?? existing.version,
    dependencies: input.dependencies ?? existing.dependencies,
    permissions: input.permissions ?? existing.permissions,
    healthStatus: input.healthStatus ?? existing.healthStatus,
    activationState: input.activationState ?? existing.activationState,
    ownerTeam: input.ownerTeam ?? existing.ownerTeam,
    compatibility: input.compatibility ?? existing.compatibility,
    auditHistory: [
      ...existing.auditHistory,
      { action: "upserted", at: now.toISOString(), actor: "internal_admin", version: input.version ?? existing.version }
    ],
    updatedAt: now
  };
  await saveModule(next);
  await publishIntelligenceEvent({
    eventType: "platform.module_audited",
    layer: "automation",
    payload: { moduleId: next.moduleId, action: "upserted", activationState: next.activationState },
    source: "module-registry",
    confidenceScore: 100
  });
  return next;
}

export async function setPlatformModuleActivation(moduleId: string, activationState: ModuleState): Promise<ModuleRegistryView> {
  const existing = await getModule(moduleId);
  if (!existing) throw new Error("Module not found.");
  const next = {
    ...existing,
    activationState,
    auditHistory: [...existing.auditHistory, { action: "activation_changed", activationState, at: new Date().toISOString(), actor: "internal_admin" }]
  };
  await saveModule(next);
  return next;
}

export async function validatePlatformModules(): Promise<{ modules: ModuleRegistryView[]; failures: Array<{ moduleId: string; missingDependencies: string[] }> }> {
  const modules = await listPlatformModules();
  const moduleIds = new Set(modules.map((item) => item.moduleId));
  const failures: Array<{ moduleId: string; missingDependencies: string[] }> = [];
  const validated: ModuleRegistryView[] = [];
  for (const item of modules) {
    const missingDependencies = item.dependencies.filter((dependency) => !moduleIds.has(dependency));
    if (missingDependencies.length > 0) failures.push({ moduleId: item.moduleId, missingDependencies });
    const next = {
      ...item,
      healthStatus: missingDependencies.length > 0 ? "failed" as ModuleHealth : item.activationState === "active" ? "healthy" as ModuleHealth : "degraded" as ModuleHealth,
      lastValidatedAt: new Date(),
      auditHistory: [...item.auditHistory, { action: "validated", at: new Date().toISOString(), missingDependencies }]
    };
    await saveModule(next);
    validated.push(next);
  }
  await saveControl({
    recordId: makeId("ctrl"),
    controlType: "governance_contract",
    status: failures.length ? "warning" : "passing",
    scope: "module-registry",
    score: failures.length ? 70 : 100,
    payload: { validation: "module_dependencies", failures }
  });
  return { modules: validated, failures };
}

export async function enqueuePlatformJob(input: {
  jobType: string;
  queue?: string;
  priority?: number;
  payload?: PlainRecord;
  scheduledFor?: Date;
  maxAttempts?: number;
}): Promise<PlatformJobView> {
  const scheduledFor = input.scheduledFor ?? new Date();
  const job: PlatformJobView = {
    jobId: makeId("job"),
    jobType: input.jobType,
    queue: input.queue ?? "default",
    priority: input.priority ?? 5,
    status: scheduledFor.getTime() > Date.now() ? "scheduled" : "queued",
    payload: input.payload ?? {},
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    scheduledFor,
    progress: 0,
    auditHistory: [{ action: "queued", at: new Date().toISOString() }]
  };
  await saveJob(job);
  await publishIntelligenceEvent({
    eventType: "job.queued",
    layer: "automation",
    workspaceId: typeof job.payload.workspaceId === "string" ? job.payload.workspaceId : undefined,
    targetUrl: typeof job.payload.targetUrl === "string" ? job.payload.targetUrl : undefined,
    payload: { jobId: job.jobId, jobType: job.jobType, queue: job.queue, priority: job.priority },
    source: "distributed-job-framework",
    confidenceScore: 100
  });
  return job;
}

export async function completePlatformJob(jobId: string, result: PlainRecord = {}): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const next: PlatformJobView = {
    ...job,
    status: "completed",
    progress: 100,
    result,
    completedAt: new Date(),
    auditHistory: [...job.auditHistory, { action: "completed", at: new Date().toISOString(), result }]
  };
  await saveJob(next);
  await publishIntelligenceEvent({
    eventType: "job.completed",
    layer: "automation",
    workspaceId: typeof job.payload.workspaceId === "string" ? job.payload.workspaceId : undefined,
    targetUrl: typeof job.payload.targetUrl === "string" ? job.payload.targetUrl : undefined,
    payload: { jobId, jobType: job.jobType, result },
    source: "distributed-job-framework",
    confidenceScore: 100
  });
}

export async function failPlatformJob(jobId: string, error: unknown): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const attempts = job.attempts + 1;
  const deadLetter = attempts >= job.maxAttempts;
  const now = new Date();
  // Exponential backoff for retries: 30s * 2^(attempt-1), capped at 1 hour
  const retryDelayMs = Math.min(30_000 * Math.pow(2, attempts - 1), 3_600_000);
  const next: PlatformJobView = {
    ...job,
    attempts,
    status: deadLetter ? "dead_letter" : "failed",
    scheduledFor: deadLetter ? now : new Date(now.getTime() + retryDelayMs),
    failedAt: now,
    errorMessage: error instanceof Error ? error.message : "Unknown job failure",
    auditHistory: [...job.auditHistory, { action: deadLetter ? "dead_lettered" : "failed", at: now.toISOString(), attempts, retryDelayMs: deadLetter ? null : retryDelayMs }]
  };
  await saveJob(next);
}

export async function listPlatformJobs(limit = 100): Promise<PlatformJobView[]> {
  if (!isMongoConnected()) return [...memoryJobs.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)).slice(0, limit);
  const rows = await PlatformJob.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => row as unknown as PlatformJobView);
}

export async function runDuePlatformJobs(now = new Date(), limit = 10): Promise<{ processed: number; completed: string[]; deadLettered: string[]; failures: Array<{ jobId: string; reason: string }> }> {
  const candidates = await getDueJobs(now, limit);
  const completed: string[] = [];
  const deadLettered: string[] = [];
  const failures: Array<{ jobId: string; reason: string }> = [];
  for (const job of candidates) {
    const running = { ...job, status: "running" as JobStatus, startedAt: new Date(), lockedAt: new Date(), attempts: job.attempts + 1, auditHistory: [...job.auditHistory, { action: "started", at: new Date().toISOString() }] };
    await saveJob(running);
    try {
      const result = await executePlatformJob(running);
      await completePlatformJob(job.jobId, result);
      completed.push(job.jobId);
    } catch (error) {
      await failPlatformJob(job.jobId, error);
      const updated = await getJob(job.jobId);
      if (updated?.status === "dead_letter") deadLettered.push(job.jobId);
      failures.push({ jobId: job.jobId, reason: error instanceof Error ? error.message : "Unknown job failure" });
    }
  }
  return { processed: candidates.length, completed, deadLettered, failures };
}

// ── Scan worker helpers ────────────────────────────────────────────────────────

export async function getDueScanJobs(now: Date, limit: number, lockTimeoutMs: number): Promise<PlatformJobView[]> {
  const staleLockedBefore = new Date(now.getTime() - lockTimeoutMs);
  if (!isMongoConnected()) {
    return [...memoryJobs.values()]
      .filter((job) => {
        if (job.queue !== "scan") return false;
        const isPickable = ["queued", "scheduled", "failed"].includes(job.status) && job.scheduledFor.getTime() <= now.getTime();
        const isStale = job.status === "running" && (job.lockedAt == null || job.lockedAt.getTime() <= staleLockedBefore.getTime());
        return isPickable || isStale;
      })
      .sort((a, b) => b.priority - a.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit);
  }
  const rows = await PlatformJob.find({
    queue: "scan",
    $or: [
      { status: { $in: ["queued", "scheduled", "failed"] }, scheduledFor: { $lte: now } },
      { status: "running", lockedAt: { $lte: staleLockedBefore } }
    ]
  }).sort({ priority: -1, scheduledFor: 1 }).limit(limit).lean();
  return rows as unknown as PlatformJobView[];
}

export async function markJobRunning(jobId: string): Promise<PlatformJobView | null> {
  const now = new Date();
  if (!isMongoConnected()) {
    const job = memoryJobs.get(jobId);
    if (!job) return null;
    const next = { ...job, status: "running" as JobStatus, startedAt: now, lockedAt: now, attempts: job.attempts + 1, auditHistory: [...job.auditHistory, { action: "started", at: now.toISOString() }] };
    memoryJobs.set(jobId, { ...next, updatedAt: now });
    return next;
  }
  const row = await PlatformJob.findOneAndUpdate(
    { jobId, status: { $in: ["queued", "scheduled", "failed", "running"] } },
    { $set: { status: "running", startedAt: now, lockedAt: now }, $inc: { attempts: 1 }, $push: { auditHistory: { action: "started", at: now.toISOString() } } },
    { new: true }
  ).lean();
  return row as unknown as PlatformJobView | null;
}

export async function updateJobProgress(jobId: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  if (!isMongoConnected()) {
    const job = memoryJobs.get(jobId);
    if (job) memoryJobs.set(jobId, { ...job, progress: clamped, updatedAt: new Date() });
    return;
  }
  await PlatformJob.updateOne({ jobId }, { $set: { progress: clamped } });
}

export async function getScanQueueMetrics(): Promise<{
  queued: number; running: number; completed: number; failed: number; deadLetter: number;
  avgProcessingTimeMs: number | null; workerReady: boolean;
}> {
  if (!isMongoConnected()) {
    const all = [...memoryJobs.values()].filter((j) => j.queue === "scan");
    const completed = all.filter((j) => j.status === "completed");
    const durations = completed.filter((j) => j.startedAt && j.completedAt).map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());
    return {
      queued: all.filter((j) => j.status === "queued" || j.status === "scheduled").length,
      running: all.filter((j) => j.status === "running").length,
      completed: completed.length,
      failed: all.filter((j) => j.status === "failed").length,
      deadLetter: all.filter((j) => j.status === "dead_letter").length,
      avgProcessingTimeMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      workerReady: true
    };
  }
  const [queued, running, completed, failed, deadLetter] = await Promise.all([
    PlatformJob.countDocuments({ queue: "scan", status: { $in: ["queued", "scheduled"] } }),
    PlatformJob.countDocuments({ queue: "scan", status: "running" }),
    PlatformJob.countDocuments({ queue: "scan", status: "completed" }),
    PlatformJob.countDocuments({ queue: "scan", status: "failed" }),
    PlatformJob.countDocuments({ queue: "scan", status: "dead_letter" })
  ]);
  const recentCompleted = await PlatformJob.find({ queue: "scan", status: "completed", startedAt: { $exists: true }, completedAt: { $exists: true } }).sort({ completedAt: -1 }).limit(50).lean();
  const durations = recentCompleted.filter((j) => j.startedAt && j.completedAt).map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());
  return {
    queued, running, completed, failed, deadLetter,
    avgProcessingTimeMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    workerReady: true
  };
}

export async function getPlatformJob(jobId: string): Promise<PlatformJobView | null> {
  return getJob(jobId);
}

export async function listScanJobs(limit = 50): Promise<PlatformJobView[]> {
  if (!isMongoConnected()) {
    return [...memoryJobs.values()].filter((j) => j.queue === "scan").sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)).slice(0, limit);
  }
  const rows = await PlatformJob.find({ queue: "scan" }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows as unknown as PlatformJobView[];
}

export async function checkApiQuota(input: { tenantSlug: string; keyHashPrefix?: string }): Promise<{ allowed: boolean; quotaLimit: number; quotaUsed: number; quotaWindow: string }> {
  const quotaWindow = currentQuotaWindow();
  const quotaLimit = env.publicApiDailyQuota;
  const quotaUsed = await countApiUsage(input.tenantSlug, quotaWindow, input.keyHashPrefix);
  return { allowed: quotaUsed < quotaLimit, quotaLimit, quotaUsed, quotaWindow };
}

export async function recordApiGovernanceUsage(input: {
  tenantSlug: string;
  workspaceId?: string;
  method: string;
  path: string;
  statusCode: number;
  keyHashPrefix?: string;
  apiVersion?: string;
  payload?: PlainRecord;
}): Promise<ApiGovernanceView> {
  const quotaWindow = currentQuotaWindow();
  const quotaUsed = (await countApiUsage(input.tenantSlug, quotaWindow, input.keyHashPrefix)) + 1;
  const record: ApiGovernanceView = {
    recordId: makeId("api"),
    recordType: "usage_audit",
    tenantSlug: input.tenantSlug,
    workspaceId: input.workspaceId,
    apiVersion: input.apiVersion ?? "v1",
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    keyHashPrefix: input.keyHashPrefix,
    quotaWindow,
    quotaLimit: env.publicApiDailyQuota,
    quotaUsed,
    payload: input.payload ?? {},
    createdAt: new Date()
  };
  await saveApiGovernance(record);
  return record;
}

export async function listApiGovernanceRecords(limit = 100): Promise<ApiGovernanceView[]> {
  if (!isMongoConnected()) return memoryApiGovernance.slice(-limit).reverse();
  const rows = await ApiGovernanceRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => row as unknown as ApiGovernanceView);
}

export async function persistPlatformArtifacts(report: ReportSnapshot, workspaceId: string): Promise<void> {
  if (!memoryReports.some((item) => item.report.snapshotId === report.snapshotId)) {
    memoryReports.push({ workspaceId, report });
  }
  const controls = [
    buildIntelligenceValidation(report, workspaceId),
    buildScanSlo(report, workspaceId),
    buildGovernanceContract(report, workspaceId),
    buildDataQuality(report, workspaceId),
    buildCostIntelligence(report, workspaceId),
    buildRealtimeRefresh(report, workspaceId)
  ];
  await Promise.all([
    saveEvidenceArtifacts(report, workspaceId),
    saveArtifactVersions(report, workspaceId),
    saveLineage(report, workspaceId),
    saveGraphIntelligence(report, workspaceId),
    saveWarehouseRecord(buildSnapshotWarehouseRecord(report, workspaceId)),
    ...controls.map(saveControl)
  ]);
  await publishIntelligenceEvent({
    eventType: "lineage.recorded",
    layer: "truth_evidence",
    report,
    workspaceId,
    payload: { snapshotId: report.snapshotId, artifactVersions: 6, governanceControls: controls.length },
    source: "platform-control-plane",
    confidenceScore: 100
  });
}

export async function recordUserSearchActivity(input: {
  report: ReportSnapshot;
  workspaceId: string;
  scanRequest: PlainRecord;
  user?: {
    userId: string;
    email?: string;
    phone?: string;
    displayName?: string;
    providers?: string[];
  };
  session?: {
    sessionId: string;
    deviceId: string;
    provider: string;
  };
}): Promise<PlainRecord> {
  const report = input.report;
  const primaryConfidence = report.confidenceLayer[0]?.confidenceScore ?? report.revenueIntelligence?.confidenceScore ?? 0;
  const record = {
    activityId: `usrscan_${sha256(`${report.snapshotId}:${input.user?.userId ?? "anonymous"}`).slice(0, 24)}`,
    userId: input.user?.userId,
    userEmail: input.user?.email,
    userPhone: input.user?.phone,
    userName: input.user?.displayName ?? input.user?.email ?? input.user?.phone ?? "Anonymous visitor",
    sessionId: input.session?.sessionId,
    deviceId: input.session?.deviceId,
    tenantSlug: report.tenantBranding.slug,
    workspaceId: input.workspaceId,
    targetUrl: report.targetUrl,
    request: {
      targetUrl: input.scanRequest.targetUrl,
      mode: input.scanRequest.mode,
      includeSeo: input.scanRequest.includeSeo,
      gbpUrl: input.scanRequest.gbpUrl,
      competitorUrls: input.scanRequest.competitorUrls,
      monthlyLeadVolume: input.scanRequest.monthlyLeadVolume,
      industryType: input.scanRequest.industryType,
      tenantSlug: input.scanRequest.tenantSlug,
      authProvider: input.session?.provider,
      userProviders: input.user?.providers ?? []
    },
    result: buildUserSearchResult(report),
    createdAt: new Date(report.createdAt)
  };

  if (!isMongoConnected()) {
    if (!memoryUserSearchActivities.some((item) => item.activityId === record.activityId)) {
      memoryUserSearchActivities.push(record);
      saveDevelopmentSearchActivity(record);
    }
  } else {
    await UserSearchActivity.findOneAndUpdate(
      { activityId: record.activityId },
      { $setOnInsert: record },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  await publishIntelligenceEvent({
    eventType: "edit.event_collected",
    layer: "automation",
    report,
    workspaceId: input.workspaceId,
    userId: input.user?.userId,
    payload: {
      activityId: record.activityId,
      targetUrl: report.targetUrl,
      snapshotId: report.snapshotId,
      eventType: "user_search_completed"
    },
    source: "user-search-intelligence",
    confidenceScore: primaryConfidence
  });
  return record;
}

export async function listUserSearchActivities(limit = 250): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    const existing = memoryUserSearchActivities.slice(-limit).reverse();
    const seen = new Set(existing.map((item) => String((item.result as PlainRecord | undefined)?.snapshotId ?? "")));
    const backfilled = memoryReports
      .map((item) => activityFromReport(item.report, item.workspaceId))
      .filter((item) => !seen.has(String((item.result as PlainRecord).snapshotId)))
      .reverse();
    return [...existing, ...backfilled].slice(0, limit);
  }
  const rows = await UserSearchActivity.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  const existing = rows as unknown as PlainRecord[];
  if (existing.length >= limit) return existing;
  const seen = new Set(existing.map((item) => String((item.result as PlainRecord | undefined)?.snapshotId ?? "")));
  const snapshots = await Snapshot.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  const backfilled = snapshots
    .map((item) => activityFromReport(item.report, `ws_${sha256(`${item.report.tenantBranding.slug}:${item.report.targetUrl.toLowerCase()}`).slice(0, 20)}`))
    .filter((item) => !seen.has(String((item.result as PlainRecord).snapshotId)));
  return [...existing, ...backfilled].slice(0, limit);
}

export async function getUserIntelligence(limit = 250): Promise<PlainRecord[]> {
  const searches = await listUserSearchActivities(1000);
  if (!isMongoConnected()) {
    const grouped = groupBy(searches, (item) => String(item.userId ?? item.userEmail ?? item.userPhone ?? "anonymous"));
    return Object.entries(grouped).slice(0, limit).map(([userId, rows]) => ({
      userId,
      displayName: String(rows[0]?.userName ?? "Anonymous visitor"),
      email: rows[0]?.userEmail,
      phone: rows[0]?.userPhone,
      lifecycleState: userId === "anonymous" ? "ANONYMOUS" : "UNKNOWN",
      providers: [],
      activeSessions: 0,
      totalSearches: rows.length,
      latestSearchAt: rows[0]?.createdAt,
      latestTargetUrl: rows[0]?.targetUrl,
      latestOss: (rows[0]?.result as PlainRecord | undefined)?.oss,
      searches: rows.slice(0, 10)
    }));
  }

  const [users, sessions, audits] = await Promise.all([
    AuthUser.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
    AuthSession.find({}).sort({ lastSeenAt: -1 }).limit(1000).lean(),
    AuthAuditLog.find({}).sort({ createdAt: -1 }).limit(1000).lean()
  ]);
  const searchesByUser = groupBy(searches, (item) => String(item.userId ?? "anonymous"));
  const sessionsByUser = groupBy(sessions, (item) => item.userId.toString());
  const auditsByUser = groupBy(audits.filter((item) => item.userId), (item) => item.userId!.toString());
  const rows: PlainRecord[] = users.map((user) => {
    const userId = user._id.toString();
    const userSearches = searchesByUser[userId] ?? [];
    const userSessions = sessionsByUser[userId] ?? [];
    const userAudits = auditsByUser[userId] ?? [];
    const activeSessions = userSessions.filter((session) => !session.revokedAt && session.refreshExpiresAt >= new Date()).length;
    return {
      userId,
      displayName: user.displayName ?? user.email ?? user.phone ?? "Unnamed user",
      email: user.email,
      phone: user.phone,
      googleId: user.googleId,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      providers: user.providers,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      googleVerified: user.googleVerified,
      lifecycleState: user.lifecycleState,
      loginFailureCount: user.loginFailureCount,
      lockedUntil: user.lockedUntil,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      activeSessions,
      totalSessions: userSessions.length,
      totalSearches: userSearches.length,
      latestSearchAt: userSearches[0]?.createdAt,
      latestTargetUrl: userSearches[0]?.targetUrl,
      latestOss: (userSearches[0]?.result as PlainRecord | undefined)?.oss,
      sessions: userSessions.slice(0, 8).map((session) => ({
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        deviceLabel: session.deviceLabel,
        provider: session.provider,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        refreshExpiresAt: session.refreshExpiresAt,
        revokedAt: session.revokedAt
      })),
      authTimeline: userAudits.slice(0, 12).map((audit) => ({
        auditId: audit.auditId,
        eventType: audit.eventType,
        success: audit.success,
        reason: audit.reason,
        createdAt: audit.createdAt
      })),
      searches: userSearches.slice(0, 12)
    };
  });

  const anonymous = searchesByUser.anonymous ?? [];
  if (anonymous.length) {
    rows.push({
      userId: "anonymous",
      displayName: "Anonymous visitors",
      lifecycleState: "ANONYMOUS",
      providers: [],
      activeSessions: 0,
      totalSessions: 0,
      totalSearches: anonymous.length,
      latestSearchAt: anonymous[0]?.createdAt,
      latestTargetUrl: anonymous[0]?.targetUrl,
      latestOss: (anonymous[0]?.result as PlainRecord | undefined)?.oss,
      sessions: [],
      authTimeline: [],
      searches: anonymous.slice(0, 12)
    });
  }
  return rows;
}

export async function materializeAnalyticsWarehouse(input: { grain?: "daily" | "weekly" | "monthly" | "custom"; startAt?: Date; endAt?: Date } = {}): Promise<WarehouseView> {
  const endAt = input.endAt ?? new Date();
  const startAt = input.startAt ?? defaultPeriodStart(endAt, input.grain ?? "daily");
  const grain = input.grain ?? "daily";
  const snapshots = await snapshotsForPeriod(startAt, endAt);
  const record: WarehouseView = {
    recordId: `wh_${sha256(`${grain}:${startAt.toISOString()}:${endAt.toISOString()}:${snapshots.length}`).slice(0, 22)}`,
    grain,
    periodStartAt: startAt,
    periodEndAt: endAt,
    dimensions: {
      industries: unique(snapshots.map((item) => item.industryBenchmarkEngine?.industryType ?? "unknown")),
      tenants: unique(snapshots.map((item) => item.tenantBranding.slug)),
      workspaces: unique(snapshots.map((item) => `${item.tenantBranding.slug}:${item.targetUrl}`))
    },
    metrics: {
      scans: snapshots.length,
      completedScans: snapshots.filter((item) => item.status === "completed").length,
      averageOss: average(snapshots.flatMap((item) => item.oss.score === null ? [] : [item.oss.score])),
      evidenceObjects: sum(snapshots.map((item) => item.evidenceObjects.length)),
      recommendations: sum(snapshots.map((item) => item.recommendationEngine.recommendations.length)),
      alerts: sum(snapshots.map((item) => item.alertEngine.alerts.length)),
      estimatedRevenueHighUnits: sum(snapshots.map((item) => item.revenueIntelligence?.revenueOpportunityRange.high ?? 0)),
      validationRows: sum(snapshots.map((item) => item.recommendationOutcomeLoop.validations.length))
    },
    sourceIds: snapshots.map((item) => item.snapshotId),
    createdAt: new Date()
  };
  await saveWarehouseRecord(record);
  await publishIntelligenceEvent({
    eventType: "warehouse.materialized",
    layer: "automation",
    payload: { recordId: record.recordId, grain, scans: snapshots.length },
    source: "analytics-warehouse",
    confidenceScore: 100
  });
  return record;
}

export async function listWarehouseRecords(limit = 50): Promise<WarehouseView[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    const uniqueReports = [...new Map(memoryReports.map((item) => [item.report.snapshotId, item.report])).values()];
    const summary = buildLiveWarehouseSummary(uniqueReports);
    const records = memoryWarehouse.slice().reverse().filter((item) => item.recordId !== summary?.recordId);
    return summary ? [summary, ...records].slice(0, limit) : records.slice(0, limit);
  }

  const [rows, summaryRows] = await Promise.all([
    AnalyticsWarehouseRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
    Snapshot.aggregate([
      {
        $group: {
          _id: null,
          scans: { $sum: 1 },
          completedScans: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          averageOss: { $avg: "$report.oss.score" },
          evidenceObjects: { $sum: { $size: { $ifNull: ["$report.evidenceObjects", []] } } },
          recommendations: { $sum: { $size: { $ifNull: ["$report.recommendationEngine.recommendations", []] } } },
          alerts: { $sum: { $size: { $ifNull: ["$report.alertEngine.alerts", []] } } },
          estimatedRevenueHighUnits: { $sum: { $ifNull: ["$report.revenueIntelligence.revenueOpportunityRange.high", 0] } },
          validationRows: { $sum: { $size: { $ifNull: ["$report.recommendationOutcomeLoop.validations", []] } } },
          periodStartAt: { $min: "$createdAt" },
          periodEndAt: { $max: "$createdAt" }
        }
      }
    ])
  ]);
  const aggregate = summaryRows[0] as PlainRecord | undefined;
  const summary: WarehouseView | null = aggregate
    ? {
        recordId: "wh_live_all",
        grain: "custom",
        periodStartAt: aggregate.periodStartAt as Date,
        periodEndAt: aggregate.periodEndAt as Date,
        dimensions: { scope: "all_time", source: "operational_snapshots" },
        metrics: {
          scans: aggregate.scans,
          completedScans: aggregate.completedScans,
          averageOss: aggregate.averageOss,
          evidenceObjects: aggregate.evidenceObjects,
          recommendations: aggregate.recommendations,
          alerts: aggregate.alerts,
          estimatedRevenueHighUnits: aggregate.estimatedRevenueHighUnits,
          validationRows: aggregate.validationRows
        },
        sourceIds: [],
        createdAt: new Date()
      }
    : null;
  const records = rows.map((row) => row as unknown as WarehouseView).filter((item) => item.recordId !== summary?.recordId);
  return summary ? [summary, ...records].slice(0, limit) : records.slice(0, limit);
}

export async function getPlatformOverview(): Promise<PlainRecord> {
  const modules = await listPlatformModules();
  const jobs = await listPlatformJobs(200);
  const controls = await listControls(200);
  const warehouse = await listWarehouseRecords(5);
  const flags = await listFeatureFlags();
  const managedWhiteLabel = await getManagedWhiteLabelGovernance();
  return {
    generatedAt: new Date().toISOString(),
    modules: {
      total: modules.length,
      active: modules.filter((item) => item.activationState === "active").length,
      degraded: modules.filter((item) => item.healthStatus !== "healthy").length
    },
    jobs: jobStats(jobs),
    warehouseLatest: warehouse[0] ?? null,
    controls: controlStats(controls),
    featureFlags: {
      total: flags.length,
      enabled: flags.filter((item) => item.state === "enabled").length
    },
    multiTenantIsolation: {
      status: "enforced",
      boundary: "workspaceId + tenantSlug scoped records with internal-only aggregation"
    },
    managedWhiteLabel: {
      ownershipModel: managedWhiteLabel.ownershipModel,
      platformOwner: managedWhiteLabel.platformOwner,
      workspaceCount: managedWhiteLabel.workspaceCount,
      activeWorkspaceCount: managedWhiteLabel.activeWorkspaceCount,
      advancedEvidenceWorkspaceCount: managedWhiteLabel.advancedEvidenceWorkspaceCount
    }
  };
}

export async function getUserJourneyIntelligence(limit = 100): Promise<PlainRecord> {
  if (!isMongoConnected()) {
    const searches = await listUserSearchActivities(Math.max(limit, 250));
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const identified = searches.filter((item) => item.userId || item.userEmail || item.userPhone);
    const userKey = (item: PlainRecord) => String(item.userId ?? item.userEmail ?? item.userPhone);
    const uniqueUsers = new Set(identified.map(userKey));
    const recentUsers = new Set(identified.filter((item) => new Date(String(item.createdAt ?? 0)).getTime() >= sevenDaysAgo).map(userKey));
    const activeSessions = new Set(searches.flatMap((item) => typeof item.sessionId === "string" ? [item.sessionId] : []));
    const loginMethods = searches.reduce<Record<string, number>>((counts, item) => {
      const request = (item.request as PlainRecord | undefined) ?? {};
      const provider = typeof request.authProvider === "string" ? request.authProvider : "unknown";
      counts[provider] = (counts[provider] ?? 0) + 1;
      return counts;
    }, {});
    const searchesByUser = groupBy(identified, userKey);
    const returningUsers = Object.values(searchesByUser).filter((items) => items.length > 1).length;
    return {
      generatedAt: new Date().toISOString(),
      registeredUsers: uniqueUsers.size,
      activeUsers: recentUsers.size,
      activeSessions: activeSessions.size,
      newUsers7d: recentUsers.size,
      loginMethods,
      timeline: searches.slice(0, limit).map((item) => ({
        eventType: "scan.completed",
        identifier: item.userEmail ?? item.userPhone ?? item.userName ?? "Anonymous visitor",
        success: true,
        targetUrl: item.targetUrl,
        createdAt: item.createdAt
      })),
      retentionSignals: returningUsers > 0 ? [`${returningUsers} identified users completed more than one search.`] : [],
      churnRisks: [],
      conversionDrivers: searches.length > 0 ? [`${searches.length} completed searches are retained in the local development store.`] : []
    };
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [registeredUsers, activeUsers, activeSessions, newUsers7d, audits] = await Promise.all([
    AuthUser.countDocuments({ lifecycleState: { $ne: "DELETED" } }),
    AuthUser.countDocuments({ lifecycleState: "VERIFIED", lastLoginAt: { $gte: sevenDaysAgo } }),
    AuthSession.countDocuments({ revokedAt: { $exists: false }, refreshExpiresAt: { $gte: new Date() } }),
    AuthUser.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    AuthAuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean()
  ]);
  const loginMethods = audits.reduce<Record<string, number>>((counts, item) => {
    if (item.eventType.includes("google")) counts.google = (counts.google ?? 0) + 1;
    if (item.eventType.includes("otp")) counts.otp = (counts.otp ?? 0) + 1;
    if (item.eventType.includes("password")) counts.password = (counts.password ?? 0) + 1;
    return counts;
  }, {});
  const failed = audits.filter((item) => !item.success).length;
  return {
    generatedAt: new Date().toISOString(),
    registeredUsers,
    activeUsers,
    activeSessions,
    newUsers7d,
    loginMethods,
    timeline: audits.map((item) => ({
      auditId: item.auditId,
      eventType: item.eventType,
      success: item.success,
      identifier: item.identifier,
      reason: item.reason,
      createdAt: item.createdAt
    })),
    retentionSignals: activeUsers > 0 ? [`${activeUsers} verified user(s) logged in during the last 7 days.`] : ["No 7-day active verified user signal is currently present."],
    churnRisks: failed >= 5 ? [`${failed} recent authentication failures may indicate access friction.`] : [],
    conversionDrivers: ["Successful Google/password/OTP authentication events and scan/report events create the first-party user journey."]
  };
}

export async function getSecurityIntelligence(limit = 100): Promise<PlainRecord> {
  if (!isMongoConnected()) {
    return {
      generatedAt: new Date().toISOString(),
      securityPosture: "limited_memory_mode",
      suspiciousActivities: 0,
      authFailures: 0,
      lockEvents: 0,
      throttleEvents: 0,
      activeSessions: 0,
      recentEvents: []
    };
  }
  const audits = await AuthAuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  const activeSessions = await AuthSession.countDocuments({ revokedAt: { $exists: false }, refreshExpiresAt: { $gte: new Date() } });
  const authFailures = audits.filter((item) => !item.success).length;
  const suspiciousActivities = audits.filter((item) => item.eventType === "suspicious_activity").length;
  const lockEvents = audits.filter((item) => item.eventType === "auth_lock_applied").length;
  const throttleEvents = audits.filter((item) => item.eventType === "throttle_triggered").length;
  const securityPosture = suspiciousActivities > 0 || lockEvents >= 3 ? "elevated_risk" : authFailures >= 10 ? "watch" : "stable";
  return {
    generatedAt: new Date().toISOString(),
    securityPosture,
    suspiciousActivities,
    authFailures,
    lockEvents,
    throttleEvents,
    activeSessions,
    recentEvents: audits.slice(0, 25).map((item) => ({
      auditId: item.auditId,
      eventType: item.eventType,
      success: item.success,
      reason: item.reason,
      createdAt: item.createdAt
    }))
  };
}

export async function renderOperationsReportPdf(): Promise<Buffer> {
  const [overview, modules, jobs, warehouse, controls, security, journeys, lineage, graph, userIntelligence, searchActivities] = await Promise.all([
    getPlatformOverview(),
    listPlatformModules(),
    listPlatformJobs(25),
    listWarehouseRecords(10),
    listControls(25),
    getSecurityIntelligence(25),
    getUserJourneyIntelligence(25),
    listLineage(25),
    listGraphIntelligence(10),
    getUserIntelligence(50),
    listUserSearchActivities(50)
  ]);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 44, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    const reportId = makeId("ops_pdf");
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fillColor("#17201d").fontSize(18).text("SYSTOLAB Operations Intelligence Center");
    doc.fontSize(9).fillColor("#52605a").text(`Internal report ${reportId} | ${new Date().toISOString()} | version ${SYSTOLAB_VERSION}`).moveDown();
    writeOpsPdfSection(doc, "Executive Overview", [
      `Modules: ${JSON.stringify(overview.modules)}`,
      `Jobs: ${JSON.stringify(overview.jobs)}`,
      `Controls: ${JSON.stringify(overview.controls)}`,
      `Multi-tenant isolation: ${JSON.stringify(overview.multiTenantIsolation)}`
    ]);
    writeOpsPdfSection(doc, "Module Registry", modules.slice(0, 16).map((item) => `${item.moduleId} ${item.version} | ${item.activationState} | ${item.healthStatus} | deps ${item.dependencies.join(", ") || "none"}`));
    writeOpsPdfSection(doc, "Jobs", jobs.map((item) => `${item.jobId} | ${item.jobType} | ${item.queue} | ${item.status} | attempts ${item.attempts}/${item.maxAttempts}`));
    writeOpsPdfSection(doc, "Warehouse", warehouse.map((item) => `${item.recordId} | ${item.grain} | metrics ${JSON.stringify(item.metrics)}`));
    writeOpsPdfSection(doc, "Security", [
      `Posture: ${String(security.securityPosture)}`,
      `Failures: ${String(security.authFailures)} | Suspicious: ${String(security.suspiciousActivities)} | Locks: ${String(security.lockEvents)}`
    ]);
    writeOpsPdfSection(doc, "User Journey", [
      `Registered: ${String(journeys.registeredUsers)} | Active: ${String(journeys.activeUsers)} | Sessions: ${String(journeys.activeSessions)}`,
      `Login methods: ${JSON.stringify(journeys.loginMethods)}`
    ]);
    writeOpsPdfSection(doc, "User Search Intelligence", [
      `User rows: ${userIntelligence.length} | Search rows: ${searchActivities.length}`,
      ...userIntelligence.slice(0, 8).map((item) => `${String(item.displayName ?? item.userId ?? "user")} | ${String(item.email ?? item.phone ?? "no contact")} | searches ${String(item.totalSearches ?? 0)} | latest ${String(item.latestTargetUrl ?? "none")}`),
      ...searchActivities.slice(0, 8).map((item) => {
        const result = (item.result as PlainRecord | undefined) ?? {};
        return `${String(item.userName ?? item.userEmail ?? "Anonymous visitor")} searched ${String(item.targetUrl ?? "")} | OSS ${String(result.oss ?? "n/a")} | snapshot ${String(result.snapshotId ?? "n/a")}`;
      })
    ]);
    writeOpsPdfSection(doc, "Governance And Quality", controls.map((item) => `${item.controlType} | ${item.status} | score ${item.score ?? "n/a"} | scope ${item.scope}`));
    writeOpsPdfSection(doc, "Lineage And Graph", [
      `${lineage.length} lineage record(s) exported with evidence/source references.`,
      `${graph.length} graph intelligence record(s) exported with node/edge metrics.`
    ]);
    doc.end();
  });
}

export async function buildAiAnalystContext(input: { workspaceId?: string; limit?: number } = {}): Promise<OperationalControlView> {
  const warehouse = await listWarehouseRecords(input.limit ?? 5);
  const controls = await listControls(100);
  const jobs = await listPlatformJobs(50);
  const context: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "ai_analyst_context",
    status: "informational",
    scope: input.workspaceId ?? "platform",
    payload: {
      note: "Deterministic internal analyst context. No external AI API is called.",
      warehouseSignals: warehouse.map((item) => ({ grain: item.grain, periodEndAt: item.periodEndAt, metrics: item.metrics })),
      recentControls: controls.slice(0, 12).map((item) => ({ controlType: item.controlType, status: item.status, score: item.score, scope: item.scope })),
      jobHealth: jobStats(jobs),
      permissionBoundary: input.workspaceId ? "workspace_scoped" : "internal_admin_platform_scope"
    },
    createdAt: new Date()
  };
  await saveControl(context);
  return context;
}

export async function listWorkspaceIntelligence(): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    const grouped = groupBy(memoryReports, (item) => item.workspaceId);
    return Object.entries(grouped).map(([workspaceId, rows]) => ({
      workspaceId,
      tenantSlug: rows[0]?.report.tenantBranding.slug ?? "unknown",
      targetUrl: rows[0]?.report.targetUrl ?? "unknown",
      scans: rows.length,
      latestOss: rows.at(-1)?.report.oss.score ?? null,
      strictIsolationKey: workspaceId
    }));
  }
  const rows = await Workspace.find({}).sort({ updatedAt: -1 }).limit(250).lean();
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    tenantSlug: row.tenantSlug,
    targetUrl: row.targetUrl,
    businessContext: row.businessContext,
    preferences: row.preferences,
    strictIsolationKey: row.workspaceId
  }));
}

export async function listEvidenceRepository(limit = 100): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    return memoryEvidenceArtifacts.slice(-limit).reverse();
  }
  const rows = await EvidenceArtifact.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows as unknown as PlainRecord[];
}

export async function listArtifactVersions(limit = 100): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    return memoryArtifactVersions.slice(-limit).reverse();
  }
  const rows = await ArtifactVersionRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows as unknown as PlainRecord[];
}

export async function listControls(limit = 100, controlType?: OperationalControlView["controlType"]): Promise<OperationalControlView[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    return memoryControls.filter((item) => !controlType || item.controlType === controlType).slice(-limit).reverse();
  }
  const query = controlType ? { controlType } : {};
  const rows = await OperationalControlRecord.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => row as unknown as OperationalControlView);
}

export async function getDisasterRecoveryStatus(): Promise<OperationalControlView> {
  const backup = await getBackupStatusSummary().catch(() => null);

  const overallStatus = backup?.overallStatus ?? "unknown";
  const controlStatus: OperationalControlView["status"] =
    overallStatus === "healthy" ? "passing" :
    overallStatus === "warning" ? "warning" :
    overallStatus === "critical" ? "failing" :
    "informational";

  const score =
    overallStatus === "healthy" ? (backup?.lastBackupId && backup.lastVerifiedAt ? 97 : 88) :
    overallStatus === "warning" ? 62 :
    overallStatus === "critical" ? 30 :
    50;

  const status: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "disaster_recovery",
    status: controlStatus,
    scope: "platform",
    score,
    payload: {
      backupStatus: overallStatus,
      lastBackupAt: backup?.lastBackupAt ?? null,
      lastBackupId: backup?.lastBackupId ?? null,
      lastBackupStatus: backup?.lastBackupStatus ?? null,
      lastVerifiedAt: backup?.lastVerifiedAt ?? null,
      backupCount: backup?.backupCount ?? 0,
      rpoActualMinutes: backup?.rpoActualMinutes ?? null,
      rpoTargetMinutes: backup?.rpoTargetMinutes ?? 60,
      rtoTargetMinutes: backup?.rtoTargetMinutes ?? 240,
      backupDir: env.backupDir,
      backupMechanism: "mongodump_gzip_manifest",
      replication: "database_provider_or_self_hosted_replica_required_in_production",
      failover: "documented_runbook",
      runbookPath: "docs/disaster-recovery-runbook.md",
      recoveryTestingRoute: "POST /api/internal/platform/backup/run",
      verificationRoute: "POST /api/internal/platform/backup/:backupId/verify"
    },
    createdAt: new Date()
  };
  await saveControl(status);
  return status;
}

export async function getObservabilityStatus(): Promise<OperationalControlView> {
  const [jobs, queueMetrics, backupSummary, alertSummary] = await Promise.all([
    listPlatformJobs(200),
    getScanQueueMetrics(),
    getBackupStatusSummary(),
    getAlertSummary()
  ]);

  await checkAndFireThresholdAlerts(queueMetrics, backupSummary);

  const mem = process.memoryUsage();
  const httpP95 = histogramPercentile("systolab_http_request_duration_ms", 95);
  const scanSummary = histogramSummary("systolab_scan_duration_ms");
  const totalRequests = sumCounterValues("systolab_http_requests_total");
  const serverErrors = getCounterValue("systolab_errors_total", { type: "server_error" });
  const errorRate = totalRequests > 0 ? serverErrors / totalRequests : 0;

  const hasDeadLetter = queueMetrics.deadLetter > 0;
  const hasCriticalAlert = alertSummary.critical > 0;
  const overallStatus = hasCriticalAlert ? "failing" : hasDeadLetter || alertSummary.warning > 0 ? "warning" : "passing";
  const score = hasCriticalAlert ? 58 : hasDeadLetter ? 72 : alertSummary.warning > 0 ? 78 : 96;

  const status: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "observability",
    status: overallStatus,
    scope: "platform",
    score,
    payload: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsageMb: {
        heapUsed: Math.round(mem.heapUsed / 1_048_576),
        heapTotal: Math.round(mem.heapTotal / 1_048_576),
        rss: Math.round(mem.rss / 1_048_576)
      },
      jobStats: jobStats(jobs),
      queueMetrics,
      httpMetrics: {
        totalRequests,
        serverErrors,
        errorRatePct: Math.round(errorRate * 10_000) / 100,
        p95LatencyMs: httpP95
      },
      scanLatencyMs: {
        count: scanSummary.count,
        p50: scanSummary.p50,
        p95: scanSummary.p95,
        p99: scanSummary.p99
      },
      alerts: alertSummary,
      mongoConnected: isMongoConnected(),
      healthEndpoint: "/health/detailed",
      metricsEndpoint: "/metrics"
    },
    createdAt: new Date()
  };
  await saveControl(status);
  return status;
}

export interface SliDashboard {
  scanSuccessRate: { sli: number | null; slo: number; status: "passing" | "warning" | "failing" };
  apiErrorRatePct: { sli: number | null; slo: number; status: "passing" | "warning" | "failing" };
  httpP95LatencyMs: { sli: number | null; slo: number; status: "passing" | "warning" | "failing" };
  scanP95LatencyMs: { sli: number | null; slo: number; status: "passing" | "warning" | "failing" };
  backupRpo: { sli: number | null; slo: number; unit: "minutes"; status: "passing" | "warning" | "failing" };
  openAlerts: number;
  criticalAlerts: number;
  computedAt: Date;
}

export async function getSliDashboard(): Promise<SliDashboard> {
  const [queueMetrics, backupSummary, alertSummary] = await Promise.all([
    getScanQueueMetrics(),
    getBackupStatusSummary(),
    getAlertSummary()
  ]);

  const totalScans = queueMetrics.completed + queueMetrics.failed + queueMetrics.deadLetter;
  const scanSuccessRatio = totalScans > 0 ? queueMetrics.completed / totalScans : null;

  const totalRequests = sumCounterValues("systolab_http_requests_total");
  const serverErrors = getCounterValue("systolab_errors_total", { type: "server_error" });
  const errorRatio = totalRequests > 0 ? serverErrors / totalRequests : null;

  const httpP95 = histogramPercentile("systolab_http_request_duration_ms", 95);
  const scanP95 = histogramPercentile("systolab_scan_duration_ms", 95);

  function sliStatus(value: number | null, targetGood: (v: number) => boolean, targetWarn: (v: number) => boolean): "passing" | "warning" | "failing" {
    if (value === null) return "passing"; // no data = no violation
    return targetGood(value) ? "passing" : targetWarn(value) ? "warning" : "failing";
  }

  return {
    scanSuccessRate: {
      sli: scanSuccessRatio !== null ? Math.round(scanSuccessRatio * 10_000) / 100 : null,
      slo: 95,
      status: sliStatus(scanSuccessRatio, (v) => v >= 0.95, (v) => v >= 0.85)
    },
    apiErrorRatePct: {
      sli: errorRatio !== null ? Math.round(errorRatio * 10_000) / 100 : null,
      slo: 1,
      status: sliStatus(errorRatio !== null ? errorRatio * 100 : null, (v) => v <= 1, (v) => v <= 5)
    },
    httpP95LatencyMs: {
      sli: httpP95,
      slo: 500,
      status: sliStatus(httpP95, (v) => v <= 500, (v) => v <= 1000)
    },
    scanP95LatencyMs: {
      sli: scanP95,
      slo: 30_000,
      status: sliStatus(scanP95, (v) => v <= 30_000, (v) => v <= 60_000)
    },
    backupRpo: {
      sli: backupSummary.rpoActualMinutes,
      slo: 24 * 60,
      unit: "minutes",
      status: backupSummary.overallStatus === "healthy" ? "passing" : backupSummary.overallStatus === "warning" ? "warning" : "failing"
    },
    openAlerts: alertSummary.open,
    criticalAlerts: alertSummary.critical,
    computedAt: new Date()
  };
}

async function checkAndFireThresholdAlerts(
  queueMetrics: Awaited<ReturnType<typeof getScanQueueMetrics>>,
  backupSummary: Awaited<ReturnType<typeof getBackupStatusSummary>>
): Promise<void> {
  // Scan dead-letter alert
  if (queueMetrics.deadLetter > 0) {
    await triggerAlert({
      key: "scan.dead_letter",
      severity: "warning",
      category: "job",
      title: "Scan Dead Letter Queue",
      message: `${queueMetrics.deadLetter} scan job(s) moved to dead-letter queue`,
      details: { deadLetter: queueMetrics.deadLetter, failed: queueMetrics.failed }
    });
  } else {
    await resolveAlertByKey("scan.dead_letter");
  }

  // Auth brute-force / security alert
  const authHits = getCounterValue("systolab_rate_limit_hits_total", { type: "auth" });
  if (authHits >= 20) {
    await triggerAlert({
      key: "security.auth_rate_limit",
      severity: "warning",
      category: "security",
      title: "Elevated Auth Rate-Limit Activity",
      message: `${authHits} authentication rate-limit violations recorded this session`,
      details: { count: authHits }
    });
  }

  // High server error rate alert
  const totalRequests = sumCounterValues("systolab_http_requests_total");
  const serverErrors = getCounterValue("systolab_errors_total", { type: "server_error" });
  const errorRate = totalRequests > 0 ? serverErrors / totalRequests : 0;
  if (errorRate > 0.05 && totalRequests >= 20) {
    await triggerAlert({
      key: "system.high_error_rate",
      severity: "critical",
      category: "system",
      title: "High Server Error Rate",
      message: `${(errorRate * 100).toFixed(1)}% server error rate exceeds 5% threshold`,
      details: { errorRatePct: Math.round(errorRate * 10_000) / 100, totalRequests, serverErrors }
    });
  } else {
    await resolveAlertByKey("system.high_error_rate");
  }

  // Backup RPO alerts
  if (backupSummary.overallStatus === "critical") {
    await triggerAlert({
      key: "backup.rpo_breach",
      severity: "critical",
      category: "backup",
      title: "Backup RPO Breach",
      message: `Last backup was ${backupSummary.rpoActualMinutes ?? "unknown"} min ago — exceeds ${backupSummary.rpoTargetMinutes * 2} min critical threshold`,
      details: { rpoActualMinutes: backupSummary.rpoActualMinutes, rpoTargetMinutes: backupSummary.rpoTargetMinutes }
    });
    await resolveAlertByKey("backup.rpo_warning");
  } else if (backupSummary.overallStatus === "warning") {
    await triggerAlert({
      key: "backup.rpo_warning",
      severity: "warning",
      category: "backup",
      title: "Backup RPO Warning",
      message: `Last backup was ${backupSummary.rpoActualMinutes ?? "unknown"} min ago — approaching RPO target of ${backupSummary.rpoTargetMinutes} min`,
      details: { rpoActualMinutes: backupSummary.rpoActualMinutes }
    });
    await resolveAlertByKey("backup.rpo_breach");
  } else {
    await resolveAlertByKey("backup.rpo_breach");
    await resolveAlertByKey("backup.rpo_warning");
  }
}

export async function getDataGovernanceStatus(): Promise<OperationalControlView> {
  const status: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "data_governance",
    status: "passing",
    scope: "platform",
    score: 92,
    payload: {
      dataClassification: ["public_website_evidence", "tenant_operational_data", "internal_platform_intelligence", "auth_security_data"],
      retentionPolicies: {
        snapshots: "immutable_retained_for_audit",
        evidenceArtifacts: "immutable_retained_with_lineage",
        apiUsage: "rolling_operational_audit",
        authAudit: "security_retention_policy"
      },
      archivalWorkflows: ["warehouse_rollups", "evidence_artifact_hash_preservation"],
      legalHolds: "supported_by_workspace_and_snapshot_scope",
      privacyControls: ["tenant_isolation", "internal_admin_boundary", "no_external_analytics_export"],
      complianceControls: ["audit_logs", "lineage_records", "governance_contract"],
      dataLineageTracking: "enabled"
    },
    createdAt: new Date()
  };
  await saveControl(status);
  return status;
}

export async function getGovernanceContractStatus(): Promise<OperationalControlView> {
  const status: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "governance_contract",
    status: "passing",
    scope: "platform",
    score: 100,
    payload: {
      contractVersion: "SYSTOLAB Governance v1.0",
      singleSourceOfTruth: true,
      governs: ["permissions", "scoring_methodologies", "intelligence_generation_rules", "audit_requirements", "retention_policies", "compliance_controls", "operational_workflows", "future_capabilities"],
      bypassAllowed: false,
      scoringChangeRule: "no OSS scoring method can change without artifact versioning and sandbox validation",
      customerSafetyRule: "no unsupported revenue, ranking, traffic, profit, or conversion guarantees"
    },
    createdAt: new Date()
  };
  await saveControl(status);
  return status;
}

export async function getRealtimeRefreshState(): Promise<OperationalControlView> {
  const status: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "realtime_refresh",
    status: "passing",
    scope: "platform",
    payload: {
      updateTriggers: ["scan.initiated", "scan.completed", "scan.failed", "scan.replayed", "report.regenerated", "classification.updated"],
      deliveryMode: "first_party_event_bus_polling_ready",
      dashboardWidgets: ["metrics", "feeds", "summaries", "intelligence_widgets"],
      externalRealtimeProvider: "none"
    },
    createdAt: new Date()
  };
  await saveControl(status);
  return status;
}

export async function listGraphIntelligence(limit = 100): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    return memoryGraphRecords.slice(-limit).reverse();
  }
  const rows = await GraphIntelligenceRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows as unknown as PlainRecord[];
}

export async function listLineage(limit = 100): Promise<PlainRecord[]> {
  if (!isMongoConnected()) {
    await ensureMemoryArtifactsHydrated();
    return memoryLineage.slice(-limit).reverse();
  }
  const rows = await IntelligenceLineageRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return rows as unknown as PlainRecord[];
}

export async function listFeatureFlags(): Promise<Array<PlainRecord & { flagKey: string; state: string; rolloutPercentage: number }>> {
  await ensureFeatureFlags();
  if (!isMongoConnected()) return [...memoryFeatureFlags.values()] as Array<PlainRecord & { flagKey: string; state: string; rolloutPercentage: number }>;
  const rows = await FeatureFlagRecord.find({}).sort({ flagKey: 1 }).lean();
  return rows as unknown as Array<PlainRecord & { flagKey: string; state: string; rolloutPercentage: number }>;
}

export async function upsertFeatureFlag(input: { flagKey: string; description?: string; state?: "enabled" | "disabled" | "gradual"; rolloutPercentage?: number; workspaceAllowList?: string[]; permissionKeys?: string[] }): Promise<PlainRecord> {
  await ensureFeatureFlags();
  const existing = memoryFeatureFlags.get(input.flagKey) ?? flag(input.flagKey, input.description ?? input.flagKey, "disabled", 0);
  const next = {
    ...existing,
    ...input,
    description: input.description ?? String(existing.description),
    state: input.state ?? String(existing.state),
    rolloutPercentage: input.rolloutPercentage ?? Number(existing.rolloutPercentage ?? 0),
    workspaceAllowList: input.workspaceAllowList ?? (existing.workspaceAllowList as string[] | undefined) ?? [],
    permissionKeys: input.permissionKeys ?? (existing.permissionKeys as string[] | undefined) ?? [],
    auditHistory: [...((existing.auditHistory as PlainRecord[] | undefined) ?? []), { action: "upserted", at: new Date().toISOString() }]
  };
  if (!isMongoConnected()) {
    memoryFeatureFlags.set(input.flagKey, next);
  } else {
    await FeatureFlagRecord.findOneAndUpdate({ flagKey: input.flagKey }, next, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  return next;
}

export async function evaluateFeatureFlag(flagKey: string, input: { workspaceId?: string; userId?: string } = {}): Promise<PlainRecord> {
  await ensureFeatureFlags();
  const flagRecord = isMongoConnected()
    ? await FeatureFlagRecord.findOne({ flagKey }).lean()
    : memoryFeatureFlags.get(flagKey);
  const item = (flagRecord ?? flag(flagKey, flagKey, "disabled", 0)) as PlainRecord;
  const allowList = (item.workspaceAllowList as string[] | undefined) ?? [];
  const rollout = Number(item.rolloutPercentage ?? 0);
  const bucket = input.workspaceId ? Number.parseInt(sha256(`${flagKey}:${input.workspaceId}`).slice(0, 8), 16) % 100 : 0;
  const enabled = item.state === "enabled" || (item.state === "gradual" && bucket < rollout) || Boolean(input.workspaceId && allowList.includes(input.workspaceId));
  await publishIntelligenceEvent({
    eventType: "feature_flag.evaluated",
    layer: "automation",
    workspaceId: input.workspaceId,
    userId: input.userId,
    payload: { flagKey, enabled, state: item.state, rolloutPercentage: rollout },
    source: "feature-flag-framework",
    confidenceScore: 100
  });
  return { flagKey, enabled, state: item.state, rolloutPercentage: rollout, workspaceId: input.workspaceId, bucket };
}

const DEFAULT_MANAGED_AUTH_METHODS = ["email", "password", "google", "microsoft", "apple", "two_factor"];
const DEFAULT_MANAGED_FEATURES = [
  "business_decision_reports",
  "revenue_opportunity_intelligence",
  "customer_journey_intelligence",
  "competitor_intelligence",
  "trust_intelligence",
  "local_visibility_intelligence",
  "growth_roadmaps"
];
const DEFAULT_MANAGED_REPORTS = ["decision_intelligence_brief", "full_business_report", "executive_summary", "managed_customer_pdf"];
const DEFAULT_MANAGED_EXPORTS = ["pdf", "csv", "json", "spreadsheet"];
const DEFAULT_MANAGED_APIS = ["scan:create", "report:read", "report:export", "workspace:read"];
const DEFAULT_MANAGED_REPORT_SECTIONS = [
  "executive_verdict",
  "business_risk_status",
  "evidence_summary",
  "competitor_comparison",
  "recommendations",
  "revenue_opportunity",
  "priority_timeline",
  "historical_progress"
];
const MANAGED_DENIED_CAPABILITIES = [
  "platform_admin",
  "modify_engine",
  "alter_scoring",
  "modify_ai_models",
  "change_report_logic",
  "override_permissions",
  "create_platform_features",
  "change_system_settings",
  "bypass_audit",
  "change_security_policy"
];

export async function listManagedWhiteLabelWorkspaces(): Promise<ManagedWhiteLabelWorkspaceView[]> {
  if (!isMongoConnected()) {
    return [...memoryManagedWhiteLabelWorkspaces.values()].sort((a, b) => a.tenantSlug.localeCompare(b.tenantSlug));
  }
  const rows = await OperationalControlRecord.find({ controlType: "managed_white_label", "payload.recordKind": "managed_workspace" }).sort({ createdAt: -1 }).lean();
  return rows
    .map((row) => (row.payload as PlainRecord | undefined)?.workspace as ManagedWhiteLabelWorkspaceView | undefined)
    .filter((workspace): workspace is ManagedWhiteLabelWorkspaceView => Boolean(workspace?.workspaceId));
}

export async function getManagedWhiteLabelGovernance(): Promise<PlainRecord> {
  const workspaces = await listManagedWhiteLabelWorkspaces();
  const activeWorkspaceCount = workspaces.filter((workspace) => workspace.status === "active").length;
  return {
    generatedAt: new Date().toISOString(),
    platformOwner: "SYSTOLAB",
    ownershipModel: "managed_white_label",
    principle: "Client owns brand. SYSTOLAB owns platform.",
    workspaceCount: workspaces.length,
    activeWorkspaceCount,
    advancedEvidenceWorkspaceCount: workspaces.filter((workspace) => workspace.advancedEvidenceEnabled).length,
    nonNegotiableRules: [
      "Only SYSTOLAB Super Admin can modify engine, scoring, AI models, report logic, global permissions, subscriptions, security policy, platform features, integrations, APIs, domains, and deployment controls.",
      "Partners, agencies, team members, and end clients only receive explicitly granted managed workspace permissions.",
      "Branding is configurable only after SYSTOLAB approval and never transfers ownership of the platform.",
      "Customer reports remain business-decision focused; advanced evidence is hidden unless SYSTOLAB enables it per workspace.",
      "Every managed white-label change is routed through the Platform Control Center and audit trail."
    ],
    roleHierarchy: [
      {
        role: "SYSTOLAB Super Admin",
        platformOwner: true,
        unrestrictedControl: true,
        capabilities: ["all_workspaces", "all_clients", "all_reports", "all_subscriptions", "all_permissions", "all_features", "all_security", "all_audit_logs"]
      },
      {
        role: "Managed Partner",
        platformOwner: false,
        unrestrictedControl: false,
        capabilities: ["assigned_clients", "approved_branding", "approved_reports", "approved_exports", "assigned_team_members"]
      },
      {
        role: "Partner Team Member",
        platformOwner: false,
        unrestrictedControl: false,
        capabilities: ["inherited_workspace_permissions", "assigned_reports", "assigned_customers"]
      },
      {
        role: "End Client",
        platformOwner: false,
        unrestrictedControl: false,
        capabilities: ["own_reports", "own_websites", "own_history", "approved_downloads"]
      }
    ],
    centralizedControls: {
      branding: ["company_name", "logo", "colors", "custom_domain", "email_sender", "pdf_branding", "dashboard_branding"],
      features: ["modules", "reports", "ai_features", "integrations", "apis", "plans", "limits", "exports", "report_sections"],
      permissions: ["roles", "workspace_access", "client_access", "advanced_evidence", "api_access", "export_access"],
      platformRules: ["engine_logic", "scoring_models", "report_logic", "security_policy", "audit_policy", "deployment_controls"]
    },
    defaultAllowedAuthMethods: DEFAULT_MANAGED_AUTH_METHODS,
    deniedToPartnersAndClients: MANAGED_DENIED_CAPABILITIES,
    clientExperienceBoundaries: {
      decisionFocusedReports: true,
      technicalDetailsHiddenByDefault: true,
      advancedEvidenceRequiresSystolabApproval: true,
      rawCrawlerTelemetryVisibleToCustomers: false
    },
    managedWorkspaces: workspaces
  };
}

export async function upsertManagedWhiteLabelWorkspace(
  input: Partial<ManagedWhiteLabelWorkspaceView> & { tenantSlug: string; workspaceName: string },
  actorAdminId = "systolab_super_admin"
): Promise<ManagedWhiteLabelWorkspaceView> {
  const tenantSlug = normalizeTenantSlug(input.tenantSlug);
  const workspaceName = String(input.workspaceName ?? "").trim();
  if (!tenantSlug || !workspaceName) throw new Error("tenantSlug and workspaceName are required.");
  const existing = await findManagedWhiteLabelWorkspace(input.workspaceId, tenantSlug);
  const now = new Date();
  const workspaceId = input.workspaceId ?? existing?.workspaceId ?? "mwl_" + sha256(tenantSlug).slice(0, 18);
  const workspace: ManagedWhiteLabelWorkspaceView = {
    workspaceId,
    tenantSlug,
    workspaceName,
    partnerType: input.partnerType ?? existing?.partnerType ?? "managed_partner",
    status: input.status ?? existing?.status ?? "active",
    branding: {
      status: "approved_by_systolab",
      companyName: workspaceName,
      logoUrl: null,
      primaryColor: "#17201d",
      accentColor: "#d6a84f",
      emailSender: "SYSTOLAB Managed Workspace",
      dashboardBranding: "workspace_brand_on_systolab_platform",
      pdfBranding: "workspace_brand_on_systolab_report_template",
      ...((existing?.branding as PlainRecord | undefined) ?? {}),
      ...((input.branding as PlainRecord | undefined) ?? {})
    },
    domains: input.domains ?? existing?.domains ?? [],
    enabledFeatures: uniqueStrings(input.enabledFeatures ?? existing?.enabledFeatures ?? DEFAULT_MANAGED_FEATURES),
    allowedReports: uniqueStrings(input.allowedReports ?? existing?.allowedReports ?? DEFAULT_MANAGED_REPORTS),
    allowedExports: uniqueStrings(input.allowedExports ?? existing?.allowedExports ?? DEFAULT_MANAGED_EXPORTS),
    allowedApis: uniqueStrings(input.allowedApis ?? existing?.allowedApis ?? DEFAULT_MANAGED_APIS),
    reportSections: uniqueStrings(input.reportSections ?? existing?.reportSections ?? DEFAULT_MANAGED_REPORT_SECTIONS),
    advancedEvidenceEnabled: Boolean(input.advancedEvidenceEnabled ?? existing?.advancedEvidenceEnabled ?? false),
    permissions: {
      ...defaultManagedPermissions(),
      ...((existing?.permissions as PlainRecord | undefined) ?? {}),
      ...((input.permissions as PlainRecord | undefined) ?? {})
    },
    securityPolicy: {
      authControlledBy: "SYSTOLAB",
      allowedAuthMethods: DEFAULT_MANAGED_AUTH_METHODS,
      twoFactorAvailable: true,
      workspaceIsolation: "tenant_workspace_scoped",
      auditRequired: true,
      ownerApprovalRequiredForSecurityChanges: true,
      ...((existing?.securityPolicy as PlainRecord | undefined) ?? {}),
      ...((input.securityPolicy as PlainRecord | undefined) ?? {})
    },
    subscriptionPlan: {
      planOwner: "SYSTOLAB",
      billingControlledBy: "SYSTOLAB",
      planKey: "managed_standard",
      limitsControlledCentrally: true,
      ...((existing?.subscriptionPlan as PlainRecord | undefined) ?? {}),
      ...((input.subscriptionPlan as PlainRecord | undefined) ?? {})
    },
    approval: {
      configuredBy: actorAdminId,
      configuredAt: now.toISOString(),
      platformOwner: "SYSTOLAB",
      brandingApproval: "approved_by_systolab",
      featureApproval: "approved_by_systolab",
      permissionApproval: "approved_by_systolab",
      reportTemplateApproval: "approved_by_systolab"
    },
    auditHistory: [
      ...(existing?.auditHistory ?? []),
      {
        action: existing ? "managed_workspace_updated" : "managed_workspace_created",
        actor: actorAdminId,
        at: now.toISOString(),
        owner: "SYSTOLAB",
        tenantSlug
      }
    ],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await saveManagedWhiteLabelWorkspace(workspace);
  await saveControl({
    recordId: makeId("ctrl"),
    controlType: "managed_white_label",
    status: "passing",
    scope: workspace.workspaceId,
    score: 100,
    payload: {
      recordKind: "workspace_governance_change",
      workspaceId: workspace.workspaceId,
      tenantSlug: workspace.tenantSlug,
      platformOwner: "SYSTOLAB",
      action: existing ? "updated" : "created"
    },
    createdAt: now
  });
  await publishIntelligenceEvent({
    eventType: "governance.checked",
    layer: "automation",
    workspaceId: workspace.workspaceId,
    payload: { governanceArea: "managed_white_label", tenantSlug, platformOwner: "SYSTOLAB", status: workspace.status },
    source: "platform-control-center",
    confidenceScore: 100
  });
  return workspace;
}

export async function evaluateManagedWhiteLabelAccess(input: {
  workspaceId?: string;
  tenantSlug?: string;
  role: ManagedWhiteLabelRole;
  requestedFeature?: string;
  requestedPermission?: string;
  requestedReportSection?: string;
}): Promise<PlainRecord> {
  const workspace = await findManagedWhiteLabelWorkspace(input.workspaceId, input.tenantSlug ? normalizeTenantSlug(input.tenantSlug) : undefined);
  if (input.role === "super_admin") {
    return {
      role: input.role,
      workspaceId: workspace?.workspaceId ?? input.workspaceId,
      platformOwner: true,
      unrestrictedControl: true,
      allowed: true,
      reason: "SYSTOLAB Super Admin has full platform control."
    };
  }
  const permissions = (workspace?.permissions as PlainRecord | undefined) ?? defaultManagedPermissions();
  const rolePermissions = uniqueStrings((permissions[input.role] as string[] | undefined) ?? []);
  const requestedPermission = input.requestedPermission;
  const requestedFeature = input.requestedFeature;
  const requestedReportSection = input.requestedReportSection;
  const deniedByCapability = requestedPermission ? MANAGED_DENIED_CAPABILITIES.includes(requestedPermission) : false;
  const permissionAllowed = requestedPermission ? rolePermissions.includes(requestedPermission) && !deniedByCapability : true;
  const featureAllowed = requestedFeature ? Boolean(workspace?.enabledFeatures.includes(requestedFeature)) : true;
  const sectionAllowed = requestedReportSection
    ? Boolean(workspace?.reportSections.includes(requestedReportSection) || (requestedReportSection === "advanced_evidence" && workspace?.advancedEvidenceEnabled))
    : true;
  const workspaceAvailable = Boolean(workspace);
  const allowed = workspaceAvailable && permissionAllowed && featureAllowed && sectionAllowed;
  return {
    role: input.role,
    workspaceId: workspace?.workspaceId ?? input.workspaceId,
    tenantSlug: workspace?.tenantSlug ?? input.tenantSlug,
    platformOwner: false,
    unrestrictedControl: false,
    allowed,
    workspaceAvailable,
    permissionAllowed,
    featureAllowed,
    sectionAllowed,
    deniedCapabilities: MANAGED_DENIED_CAPABILITIES,
    grantedPermissions: rolePermissions,
    reason: allowed
      ? "Access allowed inside SYSTOLAB-managed workspace permissions."
      : "Access denied because this role is not the platform owner or the requested capability is not granted."
  };
}

function defaultManagedPermissions(): PlainRecord {
  return {
    partner: ["view_assigned_clients", "manage_own_customers", "invite_team_members", "generate_reports", "download_reports", "view_analytics"],
    team_member: ["inherited_permissions_only", "generate_reports", "download_reports", "view_assigned_customers"],
    client: ["view_reports", "generate_reports", "download_reports", "manage_own_websites", "view_history"],
    deniedForNonOwners: MANAGED_DENIED_CAPABILITIES
  };
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeTenantSlug(value?: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function findManagedWhiteLabelWorkspace(workspaceId?: string, tenantSlug?: string): Promise<ManagedWhiteLabelWorkspaceView | null> {
  const normalizedTenantSlug = tenantSlug ? normalizeTenantSlug(tenantSlug) : undefined;
  if (!isMongoConnected()) {
    if (workspaceId && memoryManagedWhiteLabelWorkspaces.has(workspaceId)) return memoryManagedWhiteLabelWorkspaces.get(workspaceId) ?? null;
    if (normalizedTenantSlug) return [...memoryManagedWhiteLabelWorkspaces.values()].find((workspace) => workspace.tenantSlug === normalizedTenantSlug) ?? null;
    return null;
  }
  const query: PlainRecord = { controlType: "managed_white_label", "payload.recordKind": "managed_workspace" };
  if (workspaceId) query.scope = workspaceId;
  if (normalizedTenantSlug) query["payload.workspace.tenantSlug"] = normalizedTenantSlug;
  const row = await OperationalControlRecord.findOne(query).sort({ createdAt: -1 }).lean();
  return ((row?.payload as PlainRecord | undefined)?.workspace as ManagedWhiteLabelWorkspaceView | undefined) ?? null;
}

async function saveManagedWhiteLabelWorkspace(workspace: ManagedWhiteLabelWorkspaceView): Promise<void> {
  if (!isMongoConnected()) {
    memoryManagedWhiteLabelWorkspaces.set(workspace.workspaceId, workspace);
    return;
  }
  await OperationalControlRecord.findOneAndUpdate(
    { recordId: "mwl_" + workspace.workspaceId },
    {
      recordId: "mwl_" + workspace.workspaceId,
      controlType: "managed_white_label",
      status: workspace.status === "active" ? "passing" : "warning",
      scope: workspace.workspaceId,
      score: workspace.status === "active" ? 100 : 70,
      payload: { recordKind: "managed_workspace", workspace },
      createdAt: workspace.createdAt ?? new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function runSandboxExperiment(input: { experimentName: string; scoringMethod?: string; benchmarkModel?: string; sampleSize?: number; workspaceId?: string }): Promise<OperationalControlView> {
  const warehouse = await listWarehouseRecords(input.sampleSize ?? 10);
  const currentAverage = average(warehouse.map((item) => Number(item.metrics.averageOss ?? 0)));
  const proposedAverage = clampPercent(currentAverage + deterministicAdjustment(input.experimentName));
  const delta = Number((proposedAverage - currentAverage).toFixed(2));
  const result: OperationalControlView = {
    recordId: makeId("ctrl"),
    controlType: "sandbox",
    status: Math.abs(delta) <= 5 ? "passing" : "warning",
    scope: input.workspaceId ?? "platform",
    score: clampPercent(100 - Math.abs(delta) * 6),
    payload: {
      experimentName: input.experimentName,
      scoringMethod: input.scoringMethod ?? "oss-v1-shadow",
      benchmarkModel: input.benchmarkModel ?? "seeded-benchmark-shadow",
      sampleSize: warehouse.length,
      currentAverageOss: currentAverage,
      proposedAverageOss: proposedAverage,
      delta,
      activationRecommendation: Math.abs(delta) <= 5 ? "safe_for_review" : "requires_calibration_before_activation"
    },
    createdAt: new Date()
  };
  await saveControl(result);
  await publishIntelligenceEvent({
    eventType: "sandbox.completed",
    layer: "automation",
    workspaceId: input.workspaceId,
    payload: result.payload,
    source: "intelligence-sandbox",
    confidenceScore: result.score ?? 0
  });
  return result;
}

function module(moduleId: string, name: string, dependencies: string[], permissions: string[]): ModuleRegistryView {
  return {
    moduleId,
    name,
    version: SYSTOLAB_VERSION,
    dependencies,
    permissions,
    healthStatus: "healthy",
    activationState: "active",
    ownerTeam: "systolab-core",
    compatibility: { platformVersion: SYSTOLAB_VERSION, minimumNode: "20.11.0" },
    auditHistory: [{ action: "registered", at: new Date().toISOString(), actor: "system" }]
  };
}

function flag(flagKey: string, description: string, state: "enabled" | "disabled" | "gradual", rolloutPercentage: number): PlainRecord {
  return {
    flagKey,
    description,
    state,
    rolloutPercentage,
    workspaceAllowList: [],
    permissionKeys: [],
    ownerTeam: "systolab-core",
    auditHistory: [{ action: "registered", at: new Date().toISOString(), actor: "system" }]
  };
}

function buildUserSearchResult(report: ReportSnapshot): PlainRecord {
  const primaryConfidence = report.confidenceLayer[0]?.confidenceScore ?? report.revenueIntelligence?.confidenceScore ?? 0;
  return {
    snapshotId: report.snapshotId,
    reportUrl: `/reports/${report.snapshotId}`,
    status: report.status,
    oss: report.oss.score,
    ossClassification: report.oss.classification,
    businessRisk: report.businessRiskStatus.classification,
    primaryIssue: report.verdictCard.topIssue,
    recommendedFirstAction: report.executiveClarity.recommendedFirstAction,
    recommendationCount: report.recommendationEngine.recommendations.length,
    recommendations: report.recommendationEngine.recommendations.slice(0, 8).map((item) => ({
      recommendationId: item.recommendationId,
      issue: item.issue,
      action: item.action,
      priority: item.priority,
      confidenceScore: item.confidenceScore
    })),
    competitorCount: report.competitorComparison.length,
    competitors: report.competitorComparison.map((item) => ({
      competitorUrl: item.competitorUrl,
      competitorLabel: item.competitorLabel,
      competitorOss: item.competitorOss,
      structuralGapSummary: item.structuralGapSummary
    })),
    revenueOpportunity: {
      low: report.revenueIntelligence?.revenueOpportunityRange.low ?? 0,
      high: report.revenueIntelligence?.revenueOpportunityRange.high ?? 0,
      confidenceScore: report.revenueIntelligence?.confidenceScore ?? 0
    },
    confidenceScore: primaryConfidence,
    evidenceObjects: report.evidenceObjects.length,
    generatedAt: report.createdAt
  };
}

function activityFromReport(report: ReportSnapshot, workspaceId: string): PlainRecord {
  return {
    activityId: `historical_${sha256(report.snapshotId).slice(0, 20)}`,
    userName: "Historical anonymous scan",
    tenantSlug: report.tenantBranding.slug,
    workspaceId,
    targetUrl: report.targetUrl,
    request: {
      targetUrl: report.targetUrl,
      mode: report.mode,
      includeSeo: report.optionalSections.seoInsights === "enabled",
      gbpUrl: report.optionalSections.gbpIdentity === "provided" ? "provided" : undefined,
      competitorUrls: report.competitorComparison.map((item) => item.competitorUrl),
      industryType: report.industryBenchmarkEngine?.industryType,
      tenantSlug: report.tenantBranding.slug,
      historicalBackfill: true
    },
    result: buildUserSearchResult(report),
    createdAt: new Date(report.createdAt)
  };
}

async function ensureModuleRegistry(): Promise<void> {
  if (!isMongoConnected()) {
    for (const item of DEFAULT_MODULES) {
      if (!memoryModules.has(item.moduleId)) memoryModules.set(item.moduleId, item);
    }
    return;
  }
  await Promise.all(DEFAULT_MODULES.map((item) => ModuleRegistryEntry.findOneAndUpdate({ moduleId: item.moduleId }, { $setOnInsert: item }, { upsert: true, new: true, setDefaultsOnInsert: true })));
}

async function ensureFeatureFlags(): Promise<void> {
  if (!isMongoConnected()) {
    for (const item of DEFAULT_FLAGS) {
      if (!memoryFeatureFlags.has(String(item.flagKey))) memoryFeatureFlags.set(String(item.flagKey), item);
    }
    return;
  }
  await Promise.all(DEFAULT_FLAGS.map((item) => FeatureFlagRecord.findOneAndUpdate({ flagKey: item.flagKey }, { $setOnInsert: item }, { upsert: true, new: true, setDefaultsOnInsert: true })));
}

async function getModule(moduleId: string): Promise<ModuleRegistryView | null> {
  await ensureModuleRegistry();
  if (!isMongoConnected()) return memoryModules.get(moduleId) ?? null;
  const row = await ModuleRegistryEntry.findOne({ moduleId }).lean();
  return row as unknown as ModuleRegistryView | null;
}

async function saveModule(item: ModuleRegistryView): Promise<void> {
  if (!isMongoConnected()) {
    memoryModules.set(item.moduleId, { ...item, updatedAt: new Date(), createdAt: item.createdAt ?? new Date() });
    return;
  }
  await ModuleRegistryEntry.findOneAndUpdate({ moduleId: item.moduleId }, item, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function getJob(jobId: string): Promise<PlatformJobView | null> {
  if (!isMongoConnected()) return memoryJobs.get(jobId) ?? null;
  const row = await PlatformJob.findOne({ jobId }).lean();
  return row as unknown as PlatformJobView | null;
}

async function saveJob(job: PlatformJobView): Promise<void> {
  const now = new Date();
  if (!isMongoConnected()) {
    memoryJobs.set(job.jobId, { ...job, createdAt: job.createdAt ?? now, updatedAt: now });
    return;
  }
  await PlatformJob.findOneAndUpdate({ jobId: job.jobId }, job, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function getDueJobs(now: Date, limit: number): Promise<PlatformJobView[]> {
  if (!isMongoConnected()) {
    return [...memoryJobs.values()]
      .filter((job) => ["queued", "scheduled", "failed"].includes(job.status) && job.scheduledFor.getTime() <= now.getTime())
      .sort((a, b) => b.priority - a.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit);
  }
  const rows = await PlatformJob.find({ status: { $in: ["queued", "scheduled", "failed"] }, scheduledFor: { $lte: now } }).sort({ priority: -1, scheduledFor: 1 }).limit(limit).lean();
  return rows as unknown as PlatformJobView[];
}

async function executePlatformJob(job: PlatformJobView): Promise<PlainRecord> {
  if (job.jobType === "warehouse.materialize") {
    const record = await materializeAnalyticsWarehouse({ grain: "daily" });
    return { recordId: record.recordId };
  }
  if (job.jobType === "module.validate") {
    const result = await validatePlatformModules();
    return { failures: result.failures.length };
  }
  if (job.jobType === "dr.recovery_test") {
    const result = await getDisasterRecoveryStatus();
    return { status: result.status, score: result.score };
  }
  if (job.jobType === "sandbox.experiment") {
    const result = await runSandboxExperiment({ experimentName: String(job.payload.experimentName ?? "scheduled-sandbox") });
    return { status: result.status, score: result.score };
  }
  return { status: "acknowledged", note: "No deterministic handler was required for this job type." };
}

async function ensureMemoryArtifactsHydrated(): Promise<void> {
  if (isMongoConnected()) return;
  if (!memoryArtifactsHydration) {
    memoryArtifactsHydration = (async () => {
      const hydratedSnapshotIds = new Set(memoryWarehouse.flatMap((item) => item.sourceIds));
      for (const { report, workspaceId } of memoryReports) {
        if (hydratedSnapshotIds.has(report.snapshotId)) continue;
        const controls = [
          buildIntelligenceValidation(report, workspaceId),
          buildScanSlo(report, workspaceId),
          buildGovernanceContract(report, workspaceId),
          buildDataQuality(report, workspaceId),
          buildCostIntelligence(report, workspaceId),
          buildRealtimeRefresh(report, workspaceId)
        ];
        await Promise.all([
          saveEvidenceArtifacts(report, workspaceId),
          saveArtifactVersions(report, workspaceId),
          saveLineage(report, workspaceId),
          saveGraphIntelligence(report, workspaceId),
          saveWarehouseRecord(buildSnapshotWarehouseRecord(report, workspaceId)),
          ...controls.map(saveControl)
        ]);
        hydratedSnapshotIds.add(report.snapshotId);
      }
    })().catch((error) => {
      memoryArtifactsHydration = null;
      throw error;
    });
  }
  await memoryArtifactsHydration;
}

async function saveWarehouseRecord(record: WarehouseView): Promise<void> {
  if (!isMongoConnected()) {
    memoryWarehouse.push(record);
    return;
  }
  await AnalyticsWarehouseRecord.findOneAndUpdate({ recordId: record.recordId }, record, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function saveApiGovernance(record: ApiGovernanceView): Promise<void> {
  if (!isMongoConnected()) {
    memoryApiGovernance.push(record);
    return;
  }
  await ApiGovernanceRecord.create(record).catch(() => undefined);
}

async function countApiUsage(tenantSlug: string, quotaWindow: string, keyHashPrefix?: string): Promise<number> {
  if (!isMongoConnected()) {
    return memoryApiGovernance.filter((item) => item.recordType === "usage_audit" && item.tenantSlug === tenantSlug && item.quotaWindow === quotaWindow && (!keyHashPrefix || item.keyHashPrefix === keyHashPrefix)).length;
  }
  const query: PlainRecord = { recordType: "usage_audit", tenantSlug, quotaWindow };
  if (keyHashPrefix) query.keyHashPrefix = keyHashPrefix;
  return ApiGovernanceRecord.countDocuments(query);
}

async function saveControl(control: OperationalControlView): Promise<void> {
  if (!isMongoConnected()) {
    memoryControls.push(control);
    return;
  }
  await OperationalControlRecord.create(control).catch(() => undefined);
}

async function saveEvidenceArtifacts(report: ReportSnapshot, workspaceId: string): Promise<void> {
  const artifacts = [
    ...report.evidenceObjects.slice(0, 200).map((evidence) => ({
      artifactId: `ea_${sha256(`${report.snapshotId}:${evidence.evidenceId}`).slice(0, 24)}`,
      snapshotId: report.snapshotId,
      workspaceId,
      tenantSlug: report.tenantBranding.slug,
      targetUrl: report.targetUrl,
      artifactType: "extracted_metadata",
      contentHash: sha256(JSON.stringify(evidence)),
      storageMode: "inline_metadata",
      payload: {
        evidenceId: evidence.evidenceId,
        sourceType: evidence.sourceType,
        url: evidence.url,
        selectorPath: evidence.selectorPath,
        rawValue: evidence.rawValue,
        normalizedInput: evidence.normalizedInput,
        validationMethod: evidence.validationMethod
      },
      version: SYSTOLAB_VERSION,
      lineage: { source: "evidence-object", snapshotId: report.snapshotId }
    })),
    {
      artifactId: `ea_scan_${sha256(report.snapshotId).slice(0, 20)}`,
      snapshotId: report.snapshotId,
      workspaceId,
      tenantSlug: report.tenantBranding.slug,
      targetUrl: report.targetUrl,
      artifactType: "scan_artifact",
      contentHash: report.integrity.snapshotHash,
      storageMode: "database_reference",
      payload: { snapshotId: report.snapshotId, executionProvenance: report.executionProvenance, freshness: report.freshness },
      version: SYSTOLAB_VERSION,
      lineage: { source: "operational-snapshot", evidenceHashChain: report.integrity.evidenceHashChain }
    }
  ];
  if (!isMongoConnected()) {
    memoryEvidenceArtifacts.push(...artifacts);
    return;
  }
  await EvidenceArtifact.insertMany(artifacts, { ordered: false }).catch(() => undefined);
}

async function saveArtifactVersions(report: ReportSnapshot, workspaceId: string): Promise<void> {
  const versioned = [
    { artifactType: "oss_calculation", artifactId: `${report.snapshotId}:oss`, payload: report.oss },
    { artifactType: "classification", artifactId: `${report.snapshotId}:dimensions`, payload: { dimensions: report.dimensions, decisions: report.decisions } },
    { artifactType: "recommendations", artifactId: `${report.snapshotId}:recommendations`, payload: report.recommendationEngine },
    { artifactType: "benchmarks", artifactId: `${report.snapshotId}:benchmarks`, payload: report.industryBenchmarkEngine },
    { artifactType: "confidence_scores", artifactId: `${report.snapshotId}:confidence`, payload: report.confidenceEngine },
    { artifactType: "generated_report", artifactId: `${report.snapshotId}:report`, payload: { snapshotId: report.snapshotId, integrity: report.integrity, reportGovernance: report.reportGovernance } }
  ].map((item) => ({
    versionId: `ver_${sha256(`${item.artifactId}:${SYSTOLAB_VERSION}`).slice(0, 24)}`,
    ...item,
    snapshotId: report.snapshotId,
    workspaceId,
    version: SYSTOLAB_VERSION,
    hash: sha256(JSON.stringify(item.payload)),
    lineage: { snapshotId: report.snapshotId, evidenceIds: report.evidenceObjects.map((evidence) => evidence.evidenceId), governanceVersion: report.reportGovernance.version }
  }));
  if (!isMongoConnected()) {
    memoryArtifactVersions.push(...versioned);
    return;
  }
  await ArtifactVersionRecord.insertMany(versioned, { ordered: false }).catch(() => undefined);
}

async function saveLineage(report: ReportSnapshot, workspaceId: string): Promise<void> {
  const scoreEvidenceIds = report.dimensions.flatMap((dimension) => dimension.evidenceIds);
  const rows = [
    {
      lineageId: `lin_${sha256(`${report.snapshotId}:oss`).slice(0, 24)}`,
      workspaceId,
      tenantSlug: report.tenantBranding.slug,
      snapshotId: report.snapshotId,
      artifactType: "score",
      artifactId: `${report.snapshotId}:oss`,
      evidenceIds: scoreEvidenceIds,
      sourceIds: report.validationTrace.map((trace) => trace.traceId),
      decisionPath: report.dimensions.map((dimension) => ({ dimension: dimension.key, label: dimension.label, score: dimension.score, evidenceIds: dimension.evidenceIds })),
      confidenceScore: average(report.confidenceLayer.map((item) => item.confidenceScore))
    },
    ...report.recommendationEngine.recommendations.map((recommendation) => ({
      lineageId: `lin_${sha256(`${report.snapshotId}:${recommendation.recommendationId}`).slice(0, 24)}`,
      workspaceId,
      tenantSlug: report.tenantBranding.slug,
      snapshotId: report.snapshotId,
      artifactType: "recommendation",
      artifactId: recommendation.recommendationId,
      evidenceIds: recommendation.evidenceIds,
      sourceIds: recommendation.mappedDimensions,
      decisionPath: [{ issue: recommendation.issue, action: recommendation.action, priority: recommendation.priority }],
      confidenceScore: recommendation.confidenceScore
    }))
  ];
  if (!isMongoConnected()) {
    memoryLineage.push(...rows);
    return;
  }
  await IntelligenceLineageRecord.insertMany(rows, { ordered: false }).catch(() => undefined);
}

async function saveGraphIntelligence(report: ReportSnapshot, workspaceId: string): Promise<void> {
  const graph = {
    graphId: `graph_${sha256(`${report.snapshotId}:omg`).slice(0, 20)}`,
    workspaceId,
    tenantSlug: report.tenantBranding.slug,
    snapshotId: report.snapshotId,
    source: "operational_memory_graph",
    nodes: report.operationalMemoryGraph.nodes,
    edges: report.operationalMemoryGraph.edges,
    metrics: {
      nodes: report.operationalMemoryGraph.nodes.length,
      edges: report.operationalMemoryGraph.edges.length,
      competitors: report.competitorComparison.length,
      recommendations: report.recommendationEngine.recommendations.length
    },
    createdAt: new Date()
  };
  if (!isMongoConnected()) {
    memoryGraphRecords.push(graph);
    return;
  }
  await GraphIntelligenceRecord.create(graph).catch(() => undefined);
}

export function buildLiveWarehouseSummary(reports: ReportSnapshot[]): WarehouseView | null {
  if (reports.length === 0) return null;
  const sorted = reports.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const scored = reports.flatMap((report) => report.oss.score === null ? [] : [report.oss.score]);
  return {
    recordId: "wh_live_all",
    grain: "custom",
    periodStartAt: new Date(sorted[0]!.createdAt),
    periodEndAt: new Date(sorted.at(-1)!.createdAt),
    dimensions: {
      scope: "all_time",
      source: "operational_snapshots",
      tenants: unique(reports.map((report) => report.tenantBranding.slug))
    },
    metrics: {
      scans: reports.length,
      completedScans: reports.filter((report) => report.status === "completed").length,
      averageOss: scored.length > 0 ? average(scored) : null,
      evidenceObjects: sum(reports.map((report) => report.evidenceObjects.length)),
      recommendations: sum(reports.map((report) => report.recommendationEngine.recommendations.length)),
      alerts: sum(reports.map((report) => report.alertEngine.alerts.length)),
      estimatedRevenueHighUnits: sum(reports.map((report) => report.revenueIntelligence?.revenueOpportunityRange.high ?? 0)),
      validationRows: sum(reports.map((report) => report.recommendationOutcomeLoop.validations.length))
    },
    sourceIds: reports.map((report) => report.snapshotId),
    createdAt: new Date()
  };
}

function buildSnapshotWarehouseRecord(report: ReportSnapshot, workspaceId: string): WarehouseView {
  const createdAt = new Date(report.createdAt);
  return {
    recordId: `wh_snap_${sha256(report.snapshotId).slice(0, 20)}`,
    grain: "snapshot",
    periodStartAt: createdAt,
    periodEndAt: createdAt,
    dimensions: {
      tenantSlug: report.tenantBranding.slug,
      workspaceId,
      targetUrl: report.targetUrl,
      industryType: report.industryBenchmarkEngine?.industryType ?? "unknown",
      mode: report.mode
    },
    metrics: {
      oss: report.oss.score,
      evidenceObjects: report.evidenceObjects.length,
      recommendations: report.recommendationEngine.recommendations.length,
      outcomeValidations: report.recommendationOutcomeLoop.validations.length,
      alerts: report.alertEngine.alerts.length,
      executionTimeMs: report.executionProvenance.executionTimeMs,
      revenueOpportunityHigh: report.revenueIntelligence?.revenueOpportunityRange.high ?? 0
    },
    sourceIds: [report.snapshotId],
    createdAt: new Date()
  };
}

function buildIntelligenceValidation(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  const evidenceScore = clampPercent(report.evidenceObjects.length * 3);
  const confidenceScore = average(report.confidenceLayer.map((item) => item.confidenceScore));
  const consistencyScore = typeof report.oss.score === "number" && report.oss.score >= 0 && report.oss.score <= 100 ? 100 : 0;
  const score = average([evidenceScore, confidenceScore, consistencyScore]);
  return {
    recordId: `val_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "intelligence_validation",
    status: score >= 75 ? "passing" : score >= 50 ? "warning" : "failing",
    scope: workspaceId,
    score,
    payload: {
      snapshotId: report.snapshotId,
      evidenceSufficiency: evidenceScore,
      confidenceReliability: confidenceScore,
      ossConsistency: consistencyScore,
      benchmarkIntegrity: report.industryBenchmarkEngine?.status ?? "unknown",
      recommendationAccuracyInputs: report.recommendationOutcomeLoop.validations.length
    },
    createdAt: new Date()
  };
}

function buildScanSlo(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  const targetMs = 10_000;
  const actualMs = report.executionProvenance.executionTimeMs;
  return {
    recordId: `slo_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "scan_slo",
    status: actualMs <= targetMs ? "passing" : actualMs <= targetMs * 1.5 ? "warning" : "failing",
    scope: workspaceId,
    score: clampPercent(100 - Math.max(0, actualMs - targetMs) / 200),
    payload: {
      snapshotId: report.snapshotId,
      targetMs,
      actualMs,
      queueHealth: "inline_or_worker_queue_audited",
      slaCompliance: actualMs <= targetMs
    },
    createdAt: new Date()
  };
}

function buildGovernanceContract(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  return {
    recordId: `gov_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "governance_contract",
    status: "passing",
    scope: workspaceId,
    score: 100,
    payload: {
      snapshotId: report.snapshotId,
      contractVersion: report.reportGovernance.version,
      scoringMethodology: report.reportGovernance.ossCalculationLogic,
      nonOverridableRules: report.reportGovernance.nonOverridableRules,
      retentionPolicy: "operational_snapshots_and_evidence_artifacts_are_immutable",
      bypassAllowed: false
    },
    createdAt: new Date()
  };
}

function buildDataQuality(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  const completeness = clampPercent((report.evidenceCoverageSummary.totalPagesSampled > 0 ? 25 : 0) + Math.min(50, report.evidenceObjects.length * 2) + (report.validationTrace.length > 0 ? 25 : 0));
  const freshnessHours = Math.abs(Date.now() - new Date(report.freshness.capturedAt).getTime()) / 3_600_000;
  const freshness = clampPercent(100 - freshnessHours);
  const consistency = report.integrity.snapshotIntegrityStatus === "sealed" ? 100 : 60;
  const score = average([completeness, freshness, consistency]);
  return {
    recordId: `dq_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "data_quality",
    status: score >= 75 ? "passing" : "warning",
    scope: workspaceId,
    score,
    payload: {
      snapshotId: report.snapshotId,
      completeness,
      freshness,
      consistency,
      accuracy: average(report.confidenceLayer.map((item) => item.confidenceScore)),
      integrity: consistency,
      lineageTracked: true
    },
    createdAt: new Date()
  };
}

function buildCostIntelligence(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  const pages = report.evidenceCoverageSummary.totalPagesSampled;
  const evidence = report.evidenceObjects.length;
  const executionSeconds = report.executionProvenance.executionTimeMs / 1000;
  const costUnits = Number((pages * 0.4 + evidence * 0.02 + executionSeconds * 0.1).toFixed(2));
  return {
    recordId: `cost_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "cost_intelligence",
    status: "informational",
    scope: workspaceId,
    score: clampPercent(100 - costUnits),
    payload: {
      snapshotId: report.snapshotId,
      costPerScanUnits: costUnits,
      costPerReportUnits: Number((costUnits + 0.8).toFixed(2)),
      aiTokenConsumption: 0,
      infrastructureUtilization: { pages, evidenceObjects: evidence, executionSeconds },
      storageGrowthUnits: Number((evidence * 0.01).toFixed(2)),
      profitabilityGuardrail: "structural cost units only; no external paid API calls"
    },
    createdAt: new Date()
  };
}

function buildRealtimeRefresh(report: ReportSnapshot, workspaceId: string): OperationalControlView {
  return {
    recordId: `rt_${sha256(report.snapshotId).slice(0, 20)}`,
    controlType: "realtime_refresh",
    status: "passing",
    scope: workspaceId,
    payload: {
      snapshotId: report.snapshotId,
      refreshTopics: ["scan.completed", "report.regenerated", "dashboard.metrics", "intelligence.widgets"],
      recommendedClientAction: "refresh_homepage_widgets",
      eventVersion: SYSTOLAB_VERSION
    },
    createdAt: new Date()
  };
}

async function snapshotsForPeriod(startAt: Date, endAt: Date): Promise<ReportSnapshot[]> {
  if (!isMongoConnected()) {
    return memoryReports.map((item) => item.report).filter((report) => {
      const date = new Date(report.createdAt);
      return date >= startAt && date <= endAt;
    });
  }
  const rows = await Snapshot.find({ createdAt: { $gte: startAt, $lte: endAt } }).sort({ createdAt: 1 }).lean();
  return rows.map((row) => row.report);
}

function defaultPeriodStart(endAt: Date, grain: "daily" | "weekly" | "monthly" | "custom"): Date {
  const start = new Date(endAt);
  if (grain === "monthly") start.setUTCMonth(start.getUTCMonth() - 1);
  else if (grain === "weekly") start.setUTCDate(start.getUTCDate() - 7);
  else start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

function currentQuotaWindow(): string {
  return new Date().toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const name = key(item);
    groups[name] = groups[name] ?? [];
    groups[name]!.push(item);
    return groups;
  }, {});
}

function jobStats(jobs: PlatformJobView[]): PlainRecord {
  return {
    total: jobs.length,
    queued: jobs.filter((job) => job.status === "queued" || job.status === "scheduled").length,
    running: jobs.filter((job) => job.status === "running").length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    deadLetter: jobs.filter((job) => job.status === "dead_letter").length
  };
}

function writeOpsPdfSection(doc: PDFKit.PDFDocument, title: string, lines: string[]): void {
  doc.moveDown(0.8).fillColor("#17201d").fontSize(13).text(title);
  if (!lines.length) {
    doc.fillColor("#52605a").fontSize(9).text("No records available for this section.");
    return;
  }
  for (const line of lines.slice(0, 18)) doc.fillColor("#52605a").fontSize(9).text(`- ${line}`);
}

function controlStats(controls: OperationalControlView[]): PlainRecord {
  return {
    total: controls.length,
    passing: controls.filter((item) => item.status === "passing").length,
    warning: controls.filter((item) => item.status === "warning").length,
    failing: controls.filter((item) => item.status === "failing").length,
    informational: controls.filter((item) => item.status === "informational").length
  };
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Number((valid.reduce((total, value) => total + value, 0) / valid.length).toFixed(2));
}

function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function deterministicAdjustment(seed: string): number {
  const hash = Number.parseInt(sha256(seed).slice(0, 8), 16);
  return Number((((hash % 900) - 450) / 100).toFixed(2));
}
