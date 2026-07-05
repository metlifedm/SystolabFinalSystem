export const SYSTOLAB_VERSION = "1.0.0";

export type ScanMode = "fast_scan" | "full_audit";
export type SnapshotStatus = "completed" | "analysis_limited" | "content_unavailable" | "failed";
export type CoverageStatus = "Implemented" | "Partially Implemented" | "Planned" | "Deprecated";

export type EvidenceSourceType =
  | "http"
  | "html"
  | "dom"
  | "network"
  | "render"
  | "system"
  | "gbp";

export type ValidationMethod =
  | "multi_page_verification"
  | "structural_redundancy"
  | "direct_extraction"
  | "headless_render_verification"
  | null;

export type RenderState =
  | "static_html"
  | "hybrid_rendering"
  | "dynamic_javascript"
  | "authentication_restricted"
  | "not_rendered";

export type EvidenceVisibilityState =
  | "visible_above_fold"
  | "visible_below_fold"
  | "hidden"
  | "dynamically_injected"
  | "not_applicable"
  | "not_rendered";

export const RENDER_STATE_VALUES: Record<Exclude<RenderState, "not_rendered">, number> = {
  static_html: 100,
  hybrid_rendering: 66,
  dynamic_javascript: 33,
  authentication_restricted: 0
};

export type DimensionKey =
  | "trust"
  | "accessibility"
  | "renderingQuality"
  | "stability"
  | "mobileExperience"
  | "websiteHealth"
  | "visibilityStructure"
  | "conversionReadiness"
  | "informationClarity";

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  trust: "Trust",
  accessibility: "Accessibility",
  renderingQuality: "Rendering Quality",
  stability: "Stability",
  mobileExperience: "Mobile Experience",
  websiteHealth: "Website Health",
  visibilityStructure: "Visibility Structure",
  conversionReadiness: "Conversion Readiness",
  informationClarity: "Information Clarity"
};

export type VisualStateKey =
  | "not_scored"
  | "signal_red"
  | "attention_amber"
  | "visibility_gold"
  | "stability_green"
  | "assurance_emerald"
  | "integrity_sapphire";

export interface VisualState {
  key: VisualStateKey;
  label: string;
  range: [number, number];
  color: string;
  indicator: string;
  businessMeaning: string;
}

export const VISUAL_STATES: VisualState[] = [
  {
    key: "not_scored",
    label: "Not Scored",
    range: [0, 0],
    color: "#64748b",
    indicator: "not_scored",
    businessMeaning: "Website content was not collected, so no structural score was assigned."
  },
  {
    key: "signal_red",
    label: "Signal Red",
    range: [0, 39],
    color: "#c2412d",
    indicator: "red",
    businessMeaning: "High structural friction is visible in core website signals."
  },
  {
    key: "attention_amber",
    label: "Attention Amber",
    range: [40, 59],
    color: "#d97706",
    indicator: "amber",
    businessMeaning: "Several important structural conditions need attention."
  },
  {
    key: "visibility_gold",
    label: "Visibility Gold",
    range: [60, 74],
    color: "#b58900",
    indicator: "gold",
    businessMeaning: "The website shows useful structure with notable optimization gaps."
  },
  {
    key: "stability_green",
    label: "Stability Green",
    range: [75, 89],
    color: "#2f7d59",
    indicator: "green",
    businessMeaning: "Core structure is stable with focused improvement opportunities."
  },
  {
    key: "assurance_emerald",
    label: "Assurance Emerald",
    range: [90, 94],
    color: "#047857",
    indicator: "emerald",
    businessMeaning: "Strong evidence of mature operational structure."
  },
  {
    key: "integrity_sapphire",
    label: "Integrity Sapphire",
    range: [95, 100],
    color: "#2563eb",
    indicator: "sapphire",
    businessMeaning: "Excellent observable structural integrity across the sampled pages."
  }
];

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function visualStateForScore(score: number): VisualState {
  const safeScore = clampScore(score);
  return VISUAL_STATES.filter((state) => state.key !== "not_scored").find((state) => safeScore >= state.range[0] && safeScore <= state.range[1]) ?? VISUAL_STATES[1]!;
}

export const NOT_SCORED_VISUAL_STATE: VisualState = VISUAL_STATES[0]!;

export function confidenceLevelForScore(score: number): "Very High" | "High" | "Moderate" | "Limited" {
  const safeScore = clampScore(score);
  if (safeScore >= 90) return "Very High";
  if (safeScore >= 80) return "High";
  if (safeScore >= 70) return "Moderate";
  return "Limited";
}

export interface TenantBranding {
  tenantId: string;
  slug: string;
  publicName: string;
  logoUrl?: string;
  faviconUrl?: string;
  consultantPhotoUrl?: string;
  consultantEmail?: string;
  websiteUrl?: string;
  phoneNumber?: string;
  officeAddress?: string;
  businessRegistration?: string;
  licenseNumber?: string;
  socialLinks?: string[];
  consultantName?: string;
  disclaimerText?: string;
  coverPageDesign?: "classic" | "executive" | "minimal";
  reportIntroduction?: string;
  reportHeaderText?: string;
  thankYouPageTitle?: string;
  thankYouPageMessage?: string;
  iconStyle?: "line" | "solid" | "minimal";
  qrCodeUrl?: string;
  whatsappLink?: string;
  calendarBookingLink?: string;
  digitalSignature?: string;
  primaryCtaLabel?: string;
  primaryCtaUrl?: string;
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string;
  reportValidityDays?: number;
  validityStatement?: string;
  proposalModeEnabled?: boolean;
  proposalTimeline?: string;
  proposalInvestmentRange?: string;
  proposalDeliverables?: string[];
  proposalExpectedImpact?: string;
  crmIntegration?: {
    enabled: boolean;
    provider: "hubspot" | "gohighlevel" | "salesforce" | "zoho" | "pipedrive" | "custom_webhook" | "none";
    destinationLabel?: string;
    deliveryMode: "internal_outbox" | "manual_export";
  };
  pdfSecurity?: {
    passwordProtected: boolean;
    passwordHint?: string;
    watermarkText?: string;
    downloadRestriction: "none" | "authenticated_only" | "expires_after_validity";
    auditDownloads: boolean;
    tamperSeal: boolean;
  };
  reportLanguage?: "en" | "ar" | "fr" | "de" | "es" | "hi";
  industryTemplate?: "general" | "dentists" | "lawyers" | "interior_designers" | "real_estate" | "saas" | "hotels" | "ecommerce" | "healthcare" | "manufacturing";
  followUpAssets?: {
    emailSubject?: string;
    emailBody?: string;
    proposalEmailBody?: string;
    whatsappMessage?: string;
    meetingInvitationText?: string;
    presentationSummary?: string;
  };
  agencySuccessCenter?: {
    enabled: boolean;
    defaultPricingTier?: string;
    salesScriptTone?: "consultative" | "direct" | "executive";
  };
  serviceOfferings?: string[];
  poweredByMode?: "full_white_label" | "co_branded" | "systolab_standard";
  customDomains?: string[];
  customDomainStatus?: "not_configured" | "pending_dns" | "verified" | "failed";
  customDomainVerificationTarget?: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor: string;
  typography?: string;
  loginBackgroundUrl?: string;
  dashboardWelcomeMessage?: string;
  emailSenderName?: string;
  supportEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  attributionMode?: "systolab" | "partner" | "hidden";
  assistantName?: string;
  reportTitle: string;
  reportFooter?: string;
  customReportLabels?: Record<string, string>;
  poweredByLabel: string;
  footerLabel: string;
  customDomain?: string;
}

export interface ClientReportInformation {
  clientCompanyName?: string;
  websiteUrl?: string;
  industry?: string;
  businessType?: string;
  country?: string;
  city?: string;
  serviceArea?: string;
  competitorUrls?: string[];
  contactPerson?: string;
  clientLogoUrl?: string;
  scanDate?: string;
}

export interface ScanRequest {
  targetUrl: string;
  mode: ScanMode;
  includeSeo?: boolean;
  gbpUrl?: string;
  competitorUrls?: string[];
  monthlyLeadVolume?: number;
  industryType?: string;
  tenantSlug?: string;
  clientInformation?: ClientReportInformation;
}

export interface ScanCoverage {
  sampledPages: number;
  discoveredPages: number;
  coverageLabel: string;
  robotsTxtStatus: "allowed" | "blocked" | "unavailable" | "not_checked";
  pageRoles: Record<string, string>;
}

export interface DataInputStatus {
  source: "Website URL" | "Google Business Profile URL" | "Competitor URLs";
  status: "Provided" | "Not Assessed";
  reason?: string;
}

export interface EvidenceFreshnessMetadata {
  acquiredAt: string;
  validatedAt: string;
  sourceRecency: "current_scan" | "recent" | "aging" | "stale" | "unknown";
  updateFrequencyExpectation: "per_scan" | "daily" | "weekly" | "monthly" | "quarterly" | "unknown";
  freshnessStatus: "fresh" | "current" | "aging" | "stale" | "expired" | "incomplete";
  confidenceAdjustment: number;
}

export interface EvidenceObject {
  evidenceId: string;
  sourceType: EvidenceSourceType;
  url: string;
  pageRole: string;
  selectorPath: string | null;
  rawValue: string;
  normalizedInput: Record<string, unknown>;
  timestamp: string;
  validationMethod: ValidationMethod;
  confidenceBasis: string;
  groundTruthConfidence: number;
  groundTruthMeaning?: string;
  rawDomSnapshot?: string;
  freshness: EvidenceFreshnessMetadata;
  renderState?: RenderState;
  renderVisibility?: EvidenceVisibilityState;
  renderVerification?: string;
  httpSnippet?: string;
  screenshotRef?: string | null;
  dimensionRefs: DimensionKey[];
  hash: string;
}
export interface EvidenceCluster {
  clusterId: string;
  label: string;
  evidenceIds: string[];
  validationMethod: ValidationMethod;
  confidenceScore: number;
}

export interface RawSignalEvent {
  eventId: string;
  timestamp: string;
  stage: "robots" | "http" | "dom" | "parse" | "render" | "score" | "validation" | "system";
  level: "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationTraceEntry {
  traceId: string;
  evidenceId?: string;
  check: string;
  httpResult?: "found" | "not_found" | "not_checked";
  domResult?: "found" | "not_found" | "not_checked";
  renderResult?: "found" | "not_found" | "not_checked" | "not_rendered";
  outcome: string;
  confidenceScore: number;
}

export interface ScoreTraceFactor {
  factorId: string;
  label: string;
  contribution: number;
  weight: number;
  evidenceIds: string[];
  normalization: string;
  direction: "positive" | "negative" | "informational";
}

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number;
  classification: "Critical" | "Weak" | "At Risk" | "Stable" | "Strong";
  visualState: VisualState;
  businessMeaning: string;
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  evidenceIds: string[];
  trace: ScoreTraceFactor[];
}

export type DecisionCategory =
  | "Structural Priority: High"
  | "Optimization Required"
  | "Monitoring Suggested"
  | "Insufficient Evidence State";

export interface DecisionOutput {
  decisionId: string;
  category: DecisionCategory;
  decisionClassification: string;
  evidenceTraceReferences: string[];
  impactExplanation: string;
  recommendedActionPath: string;
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
}

export interface ExecutiveSummaryRow {
  area: string;
  currentStatus: string;
  observedCondition: string;
  businessImpact: string;
  priorityLevel: "High" | "Medium" | "Low" | "Not Assessed";
}

export interface BusinessVitalSign {
  vitalSign: string;
  score: number;
  status: "Critical" | "Weak" | "At Risk" | "Stable" | "Strong";
  visualState: VisualState;
}

export interface DirectionalImpactRanges {
  informationClarity: string;
  conversionReadiness: string;
  trustStrength: string;
}

export interface ActionFirstItem {
  actionId: string;
  issue: string;
  executableFix: string;
  businessReason: string;
  effortLevel: "low" | "medium" | "high";
  expectedDirectionalImpact: DirectionalImpactRanges;
  evidenceIds: string[];
  evidenceClusterId: string;
}

export interface ActionFirstPanel {
  layer: "decision";
  status: "actions_required" | "no_immediate_structural_fix_detected" | "analysis_limited";
  items: ActionFirstItem[];
  fallbackAction: string;
}

export interface SystemVerdict {
  layer: "decision";
  line: string;
  primaryIssue: string;
  businessConsequence: string;
  evidenceIds: string[];
}

export interface OssInterpretation {
  layer: "decision";
  score: number | null;
  strictClassification: "not_scored" | "critical_structural_failure" | "structural_friction" | "minor_optimization_opportunities";
  label: "Not Scored" | "Critical Structural Failure" | "Structural Friction" | "Minor Optimization Opportunities";
  range: "N/A" | "0-39" | "40-74" | "75-100";
  oneLineDiagnosis: string;
  meaning: string;
  visualState: VisualState;
}

export interface ConfidenceMetric {
  intelligenceArea: string;
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  basis: string;
}

export interface BenchmarkContext {
  status: "available" | "low_benchmark_coverage" | "not_available";
  datasetLabel: string;
  sampleSize: number;
  geography: string;
  datasetAge: string;
  comparativeConfidenceScore: number;
  positions: Array<{
    dimension: DimensionKey;
    position: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Not Assessed";
    evidenceIds: string[];
  }>;
}

export interface GbpIdentitySignal {
  label: string;
  status: "Observed" | "Not Observed" | "Limited";
  observedValue: string;
  evidenceIds: string[];
}

export interface GbpIdentityAnalysis {
  status: "not_assessed" | "assessed" | "limited" | "failed";
  inputUrl?: string;
  finalUrl?: string;
  identityMismatchFlag: "not_assessed" | "not_detected" | "possible_mismatch" | "insufficient_evidence";
  identityConsistencyScore: number;
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  extractedBusinessName?: string;
  extractedCategory?: string;
  profileCompletenessLevel: "Not Assessed" | "Limited" | "Partial" | "Strong";
  signals: GbpIdentitySignal[];
  consistencyNotes: string[];
  limitations: string[];
  evidenceIds: string[];
}

export interface BusinessRiskStatus {
  classification: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  level: "Not Assessed" | "Low Structural Risk" | "Medium Structural Risk" | "High Structural Risk" | "Critical Structural Risk";
  primaryRiskDriver: string;
  explanation: string;
  evidenceIds: string[];
}

export type ExecutiveActionClassification =
  | "Unable to Assess"
  | "Excellent"
  | "Healthy but Optimize"
  | "Action Recommended"
  | "High Risk"
  | "Critical Attention Required";

export type ExecutiveDecisionRiskLevel = "Unable to Assess" | "Low Risk" | "Medium Risk" | "High Risk" | "Critical Risk";
export type ExecutiveDecisionPriority = "Not Applicable" | "Monitor" | "Optimize" | "Improve" | "Act" | "Escalate";
export type ExecutiveDecisionTimeSensitivity =
  | "Not Applicable"
  | "Monitor (Ongoing)"
  | "Short-Term (1-4 weeks)"
  | "This Month (7-30 days)"
  | "Immediate (0-7 days)";

export interface DecisionIntelligenceBrief {
  executiveVerdict: {
    currentSituation: string;
    seriousness: string;
    firstAction: string;
    urgency: ExecutiveDecisionTimeSensitivity;
    likelyBusinessImpact: string;
    evidenceBasis: string;
  };
  executiveActionBanner: {
    classification: ExecutiveActionClassification;
    message: string;
    urgency: ExecutiveDecisionTimeSensitivity;
  };
  executiveDecisionMatrix: {
    executiveDecisionScore: number | null;
    riskLevel: ExecutiveDecisionRiskLevel;
    executivePriority: ExecutiveDecisionPriority;
    timeSensitivity: ExecutiveDecisionTimeSensitivity;
    competitivePosition: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Benchmark Data Unavailable";
    primaryBusinessConstraint: string;
    potentialBusinessImpact: string;
    ifNotAddressedOutcome: string;
    recommendedNextAction: string;
  };
  actionPlan: Array<{
    priority: "Priority 1" | "Priority 2" | "Priority 3";
    action: string;
    rationale: string;
    confidenceScore: number;
    confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
    evidenceIds: string[];
  }>;
  whyThisMatters: {
    overallCondition: string;
    strongestValidatedDimensions: string[];
    weakestValidatedDimension: string;
    businessSignificance: string;
  };
  competitivePositionAnalysis: {
    summary: string;
    benchmarkStatus: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Benchmark Data Unavailable";
    competitorStatus: "Ahead of Compared Competitors" | "Behind Compared Competitors" | "Mixed Position" | "Competitor Data Unavailable";
    dimensionPositions: Array<{
      dimension: DimensionKey;
      dimensionLabel: string;
      position: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Not Assessed";
      confidenceScore: number;
      evidenceIds: string[];
    }>;
  };
  executiveReliabilityPanel: {
    evidenceCoverage: string;
    crawlCoverage: string;
    assessmentConfidence: string;
    benchmarkConfidence: string;
    assessmentTrustSignals: string;
    overallReportReliability: ReturnType<typeof confidenceLevelForScore>;
    limitations: string[];
  };
}

export interface BusinessOutcomeBridgeItem {
  bridgeId: string;
  dimension?: DimensionKey;
  structuralFinding: string;
  mappedBusinessOutcome: string;
  quantifiedUpliftRange: DirectionalImpactRanges;
  opportunityRange: "Limited" | "Moderate" | "Significant" | "High";
  transformationMapping: string;
  evidenceIds: string[];
  confidenceScore: number;
  limitation: string;
}

export interface TransformationProjection {
  currentOss: number;
  projectedOss: number;
  projectedDelta: number;
  projectionBasis: string;
  dimensionProjections: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    currentScore: number;
    projectedScore: number;
    projectedDelta: number;
    recommendedActionPath: string;
    evidenceIds: string[];
  }>;
}

export interface ClosedLoopProofSystem {
  status: "baseline_only" | "comparison_available" | "not_available";
  baselineSnapshotId: string;
  comparisonSnapshotId?: string;
  beforeOss: number;
  afterOss?: number;
  ossDelta?: number;
  dimensionDeltas: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    beforeScore: number;
    afterScore?: number;
    delta?: number;
  }>;
  explanation: string;
}

export interface PriorityTimelineItem {
  actionId: string;
  action: string;
  category: "FIX NOW" | "THIS MONTH" | "MONITOR";
  timeWindow: "0-7 days" | "7-30 days" | "ongoing";
  structuralSeverity: "High" | "Medium" | "Low";
  evidenceStrength: ReturnType<typeof confidenceLevelForScore>;
  evidenceIds: string[];
}

export interface PriorityTimelineFramework {
  fixNow: PriorityTimelineItem[];
  thisMonth: PriorityTimelineItem[];
  monitor: PriorityTimelineItem[];
}

export interface MarketReadinessPosition {
  status: "available" | "low_benchmark_coverage" | "not_available";
  datasetLabel: string;
  comparativeConfidenceScore: number;
  positions: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    position: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Not Assessed";
    score: number;
    evidenceIds: string[];
  }>;
  limitation: string;
}

export interface EvidenceCoverageSummary {
  totalPagesSampled: number;
  totalEvidenceObjects: number;
  pages: Array<{
    url: string;
    role: string;
    httpStatus: number | "not_fetched";
    evidenceCount: number;
    coverageStatus: "Complete" | "Partial" | "Limited";
    keySignals: string[];
  }>;
}

export interface ComparativeFinding {
  status: "assessed" | "failed";
  competitorUrl: string;
  competitorLabel: string;
  primaryOss: number;
  competitorOss: number | null;
  assessedPages: number;
  structuralGapSummary: string;
  primaryStrengthCount: number;
  competitorStrengthCount: number;
  equivalentCount: number;
  dataAvailability: string;
  failureReason?: string;
  evidenceTraceabilityMap: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    primaryScore: number;
    competitorScore: number | null;
    position: "primary_stronger" | "primary_weaker" | "structurally_equivalent";
    difference: number;
    primaryEvidenceIds: string[];
    competitorEvidenceIds: string[];
  }>;
}

export interface SystemHealthState {
  crawlerStability: "optimal" | "degraded" | "unstable";
  parserSuccessRate: number;
  renderEngineStatus: "html_only" | "headless_available" | "degraded" | "disabled";
  memoryUsageMb: number;
  cpuUserMicros: number;
  cpuLoadPercent: number;
  queueLatencyMs: number;
  errorRate: number;
  overallReliability: "optimal" | "degraded" | "unstable";
}

export interface GroundTruthValidationLogEntry {
  logId: string;
  check: "Primary CTA" | "Primary CTA Above Fold" | "H1 Heading" | "Trust Signals" | "GBP Identity Consistency";
  signalKeys: string[];
  httpResult: "found" | "not_found" | "not_checked";
  domResult: "found" | "not_found" | "not_checked";
  renderResult: "found" | "not_found" | "not_checked" | "not_rendered";
  outcome: string;
  gtcsScore: number;
  gtcsMeaning: string;
  evidenceIds: string[];
  validationTraceIds: string[];
}

export interface ReportGovernance {
  version: string;
  systemRules: string[];
  outputFormat: Array<"decision_layer" | "insight_layer" | "proof_layer">;
  constraints: string[];
  nonOverridableRules: string[];
  fallbackRules: string[];
  rejectionRules: string[];
  ossCalculationLogic: string;
}

export interface StructuredOutputSchema {
  schemaVersion: string;
  requiredTopLevelKeys: string[];
  layerKeys: {
    decision_layer: string[];
    insight_layer: string[];
    proof_layer: string[];
  };
}

export type IntelligenceLayerKey =
  | "identity_context"
  | "data"
  | "truth_evidence"
  | "intelligence"
  | "revenue_intelligence"
  | "confidence"
  | "automation"
  | "action_alert"
  | "outcome_validation";

export type SystolabEventType =
  | "scan.requested"
  | "scan.completed"
  | "evidence.generated"
  | "score.oss_computed"
  | "confidence.scored"
  | "benchmark.compared"
  | "revenue.estimated"
  | "recommendation.generated"
  | "change.detected"
  | "outcome.validated"
  | "alert.generated"
  | "monitoring.scheduled"
  | "edit.event_collected"
  | "snapshot.sealed"
  | "platform.module_audited"
  | "job.queued"
  | "job.completed"
  | "warehouse.materialized"
  | "governance.checked"
  | "lineage.recorded"
  | "quality.checked"
  | "cost.measured"
  | "feature_flag.evaluated"
  | "sandbox.completed";

export interface SystolabEventEnvelope {
  eventId: string;
  eventType: SystolabEventType;
  layer: IntelligenceLayerKey;
  snapshotId?: string;
  workspaceId?: string;
  userId?: string;
  targetUrl?: string;
  timestamp: string;
  /** Schema version for consumer compatibility routing. Defaults to 1 when absent. */
  schemaVersion?: number;
  payload: Record<string, unknown>;
  trace: {
    source: string;
    evidenceIds: string[];
    confidenceScore: number;
  };
}

export interface RevenueIntelligenceEstimate {
  label: string;
  low: number;
  high: number;
  unit: "monthly_visits" | "conversion_rate_percent" | "monthly_value_units" | "opportunity_cost_units";
  confidenceScore: number;
  rationale: string;
  evidenceIds: string[];
}

export interface RevenueIntelligenceLayer {
  status: "estimated" | "input_limited" | "not_available";
  confidenceScore: number;
  confidenceBasis: string;
  trafficRange: RevenueIntelligenceEstimate;
  conversionPotentialRange: RevenueIntelligenceEstimate;
  revenueOpportunityRange: RevenueIntelligenceEstimate;
  opportunityCostRange: RevenueIntelligenceEstimate;
  competitorRevenuePressure: {
    status: "assessed" | "not_assessed" | "limited";
    pressureLevel: "Low" | "Moderate" | "High" | "Unknown";
    explanation: string;
    evidenceIds: string[];
  };
  limitations: string[];
}

export interface RecommendationOutput {
  recommendationId: string;
  sourceDecisionId?: string;
  canonicalIssueId?: string;
  attributionProfileId?: string;
  dependencyChain?: string[];
  lifecycleState?: RecommendationLifecycleState;
  sequencePosition?: number;
  issue: string;
  action: string;
  priority: "FIX NOW" | "THIS MONTH" | "MONITOR";
  mappedDimensions: DimensionKey[];
  expectedScoreMovement: number;
  revenueIntelligenceMapping: string;
  confidenceScore: number;
  evidenceIds: string[];
  changeValidationPlan: string;
}

export interface RecommendationEngineOutput {
  status: "generated" | "limited";
  recommendations: RecommendationOutput[];
  mappingSystem: {
    rule: "one_recommendation_one_change_cluster";
    explanation: string;
  };
}

export type CanonicalSignalCategory =
  | "conversion_blocker"
  | "trust_failure"
  | "technical_access"
  | "content_intent_gap"
  | "visibility_gap"
  | "evidence_limited";

export type CanonicalIssueDomain =
  | "Conversion Intelligence"
  | "Trust Intelligence"
  | "Website Health Intelligence"
  | "Customer Intent Intelligence"
  | "Content Gap Intelligence"
  | "SERP Intelligence"
  | "Local Visibility Intelligence"
  | "Entity Intelligence"
  | "Competitor Intelligence";

export interface CanonicalSignalClassification {
  signalId: string;
  evidenceId: string;
  signalKey: string;
  primaryCategory: CanonicalSignalCategory;
  owningLayer: CanonicalIssueDomain;
  canonicalIssueType: string;
  classificationBasis: string;
}

export interface CanonicalIssue {
  canonicalIssueId: string;
  issueType: string;
  primaryCategory: CanonicalSignalCategory;
  owningLayer: CanonicalIssueDomain;
  systemDomain: CanonicalIssueDomain;
  primaryCausalDriver: string;
  rootCauseStatement: string;
  customerDecisionProblem: string;
  priorityRank: number;
  priorityTier: "FIX NOW" | "THIS MONTH" | "MONITOR";
  priorityReason: string;
  mappedDimensions: DimensionKey[];
  contributingSignalKeys: string[];
  evidenceIds: string[];
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  authoritativeAction: string;
  duplicateCollapseKey: string;
  referencedInSections: Array<"keyDecisionSummary" | "rootCauseClusters" | "revenueImpactAreas" | "evidenceBreakdown" | "actionPlanMapping">;
}

export interface UnifiedIssueCanvas {
  status: "active" | "limited_evidence";
  preSignalClassification: CanonicalSignalClassification[];
  canonicalIssues: CanonicalIssue[];
  duplicateCollapseEngine: {
    rule: "semantic_causal_equivalence";
    rawIssueCount: number;
    canonicalIssueCount: number;
    collapsedDuplicateCount: number;
  };
  actionUnificationLayer: {
    rule: "one_issue_one_authoritative_action";
    authoritativeActionCount: number;
    removedDuplicateActionCount: number;
  };
  postGenerationNormalization: {
    rule: "one_meaning_one_representation";
    normalized: boolean;
    removedResidualDuplicateCount: number;
  };
  priorityHierarchy: string[];
}

export interface GlobalOutputContract {
  schemaVersion: "systolab.output_contract.v1";
  status: "active" | "content_unavailable";
  keyDecisionSummary: Array<{
    canonicalIssueId: string;
    summary: string;
    priorityTier: "FIX NOW" | "THIS MONTH" | "MONITOR";
  }>;
  rootCauseClusters: Array<{
    canonicalIssueId: string;
    primaryCausalDriver: string;
    rootCauseStatement: string;
  }>;
  revenueImpactAreas: Array<{
    canonicalIssueId: string;
    impactArea: string;
    businessImpact: string;
    confidenceScore: number;
  }>;
  confidenceScore: number;
  evidenceBreakdown: Array<{
    canonicalIssueId: string;
    validatedFindingCount: number;
    evidenceCoverage: "full" | "partial" | "limited" | "blocked";
  }>;
  actionPlanMapping: Array<{
    canonicalIssueId: string;
    actionReference: string;
    authoritativeAction: string;
    priorityTier: "FIX NOW" | "THIS MONTH" | "MONITOR";
  }>;
  nonRedundancyRules: string[];
  limitations: string[];
}
export interface LightweightChangeDetection {
  status: "baseline_only" | "changes_detected" | "no_material_change" | "not_available";
  comparedSnapshotId?: string;
  changes: Array<{
    changeId: string;
    area: string;
    beforeState: string;
    afterState: string;
    direction: "improved" | "declined" | "unchanged";
    evidenceIds: string[];
    recommendationIds: string[];
    confidenceScore: number;
  }>;
  explanation: string;
}

export interface EvidenceDatabaseEntry {
  evidenceId: string;
  issue: string;
  before: string | null;
  after: string | null;
  confidenceScore: number;
  confidenceReason: string;
  evidenceType: "issue_state" | "before_after_change" | "recommendation_outcome" | "competitor_change" | "edit_signal";
  lineage: {
    snapshotId: string;
    previousSnapshotId?: string;
    sourceEvidenceIds: string[];
    recommendationIds: string[];
    validationTraceIds: string[];
  };
  capturedAt: string;
}

export interface RecommendationOutcomeValidationItem {
  recommendationId: string;
  recommendation: string;
  implementedStatus: "pending_baseline" | "not_detected" | "detected" | "validated" | "regressed";
  detectedAt?: string;
  ossDelta: number | null;
  dimensionDeltas: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    beforeScore: number | null;
    afterScore: number;
    delta: number | null;
  }>;
  improvementStatus: "pending" | "improved" | "unchanged" | "declined";
  revenueImpact: RevenueIntelligenceEstimate;
  confidenceScore: number;
  confidenceReasons: string[];
  evidenceIds: string[];
}

export interface OutcomeValidationEngine {
  status: "baseline_pending" | "validated" | "no_material_change" | "regression_detected";
  previousSnapshotId?: string;
  validations: RecommendationOutcomeValidationItem[];
  summary: string;
}

export type BusinessOutcomeGap =
  | "customer_acquisition_loss"
  | "trust_loss"
  | "conversion_loss"
  | "lead_generation_loss"
  | "customer_confidence_loss"
  | "visibility_loss"
  | "retention_risk"
  | "revenue_leakage";

export type AttributionStrength = "high" | "moderate" | "low" | "limited";
export type RelativeBusinessInfluence = "primary" | "strong" | "moderate" | "supporting" | "unverified";
export type DependencyRole = "Root Cause Issue" | "Dependent Issue" | "Contributing Issue" | "Downstream Effect";
export type RecommendationLifecycleState =
  | "Recommended"
  | "Accepted"
  | "In Progress"
  | "Implemented"
  | "Partially Implemented"
  | "Not Implemented"
  | "Verified Effective"
  | "Verified Ineffective"
  | "Outcome Inconclusive";

export interface OutcomeAttributionProfile {
  attributionProfileId: string;
  canonicalIssueId: string;
  impactAreas: BusinessOutcomeGap[];
  attributionStrength: AttributionStrength;
  confidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  supportingEvidenceObjectIds: string[];
  relativeBusinessInfluence: RelativeBusinessInfluence;
  comparativeRank: number;
  customerBehaviorExplanation: string;
  nonPredictiveBoundary: string;
}

export interface BusinessOutcomeAttributionLayer {
  status: "active" | "limited_evidence";
  profiles: OutcomeAttributionProfile[];
  rankingMethod: "relative_influence_not_prediction";
  summary: string;
}

export interface DependencyIntelligenceLayer {
  status: "active" | "limited_evidence";
  issueRoles: Array<{
    canonicalIssueId: string;
    role: DependencyRole;
    rationale: string;
  }>;
  dependencyMap: Array<{
    parentCanonicalIssueId: string;
    childCanonicalIssueId: string;
    relationship: "prerequisite_for" | "reinforces" | "can_reduce" | "downstream_of";
    confidenceScore: number;
    explanation: string;
  }>;
  prerequisiteWarnings: string[];
  summary: string;
}

export interface RecommendationSequenceItem {
  sequenceId: string;
  recommendationId: string;
  canonicalIssueId?: string;
  action: string;
  sequencePosition: number;
  bucket: "Immediate Actions" | "Near-Term Actions" | "Medium-Term Actions" | "Strategic Actions";
  rationale: string;
  dependencyChain: string[];
  attributionProfileId?: string;
  confidenceScore: number;
  lifecycleState: RecommendationLifecycleState;
}

export interface RecommendationSequencingEngine {
  status: "sequenced" | "limited";
  immediateActions: RecommendationSequenceItem[];
  nearTermActions: RecommendationSequenceItem[];
  mediumTermActions: RecommendationSequenceItem[];
  strategicActions: RecommendationSequenceItem[];
  orderingRules: string[];
  summary: string;
}

export interface EvidenceFreshnessGovernanceLayer {
  status: "active" | "limited_evidence";
  evaluatedAt: string;
  evidenceFreshness: Array<{
    evidenceId: string;
    category: string;
    acquiredAt: string;
    validatedAt: string;
    ageHours: number;
    sourceRecency: EvidenceFreshnessMetadata["sourceRecency"];
    expectedUpdateFrequency: EvidenceFreshnessMetadata["updateFrequencyExpectation"];
    freshnessStatus: EvidenceFreshnessMetadata["freshnessStatus"];
    confidenceAdjustment: number;
  }>;
  staleEvidenceIds: string[];
  confidenceAdjustmentSummary: string;
}

export interface OutcomeVerificationRecord {
  outcomeVerificationId: string;
  recommendationId: string;
  canonicalIssueId?: string;
  implementationStatus: RecommendationLifecycleState;
  verificationStatus: "verified" | "pending" | "inconclusive";
  preImplementationState: string;
  postImplementationState: string;
  observedChange: string;
  confidenceOfVerification: number;
  supportingEvidenceObjectIds: string[];
  outcomeClassification:
    | "Strong Positive Outcome"
    | "Moderate Positive Outcome"
    | "Weak Positive Outcome"
    | "No Observable Change"
    | "Mixed Outcome"
    | "Negative Outcome"
    | "Insufficient Evidence";
  attributionUncertainty: string;
}

export interface ClosedLoopOutcomeVerificationLayer {
  status: "baseline_pending" | "verification_active" | "learning_active" | "insufficient_evidence";
  records: OutcomeVerificationRecord[];
  recommendationEffectivenessScores: Array<{
    issueType: string;
    recommendationPattern: string;
    verifiedOutcomeCount: number;
    effectivenessScore: number;
    confidenceScore: number;
  }>;
  outcomeIntelligenceRepository: {
    repositoryStatus: "baseline_only" | "accumulating" | "learning_ready";
    anonymizedOutcomeCount: number;
    issueResolutionPatterns: string[];
    confidenceCalibrationNotes: string[];
  };
  summary: string;
}

export interface BusinessObjectiveAlignmentValidation {
  status: "aligned" | "partially_aligned" | "not_assessed";
  primaryBusinessObjective: string;
  alignedRecommendationIds: string[];
  misalignedRecommendationIds: string[];
  validationNotes: string[];
}
export type AiceRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type AiceRecommendedActionWindow = "FIX NOW" | "THIS MONTH" | "MONITOR";

export interface AiceDecisionObject {
  scan_id: string;
  target: string;
  risk_level: AiceRiskLevel;
  time_sensitivity: string;
  evidence_summary: {
    overview: string;
    sampled_pages: number;
    coverage_status: "Complete" | "Partial" | "Limited";
    strongest_business_signal: string;
    weakest_business_signal: string;
  };
  coverage_score: number;
  confidence_score: number;
  revenue_impact_range: {
    label: string;
    low: number;
    high: number;
    unit: "monthly_visits" | "conversion_rate_percent" | "monthly_value_units" | "opportunity_cost_units";
  };
  if_not_fixed_outcome: string;
  recommended_action_window: AiceRecommendedActionWindow;
  final_recommendation: string;
  access_restriction_detected: boolean;
  assessment_limitation: string;
  impact: string;
  evidence_heatmap_summary: Array<{
    area: string;
    coverage: "full" | "partial" | "limited" | "blocked";
    business_meaning: string;
  }>;
}

export interface AiceBoundaryValidation {
  valid: boolean;
  violations: string[];
}

export interface ConfidenceEngineFactor {
  factorId: string;
  label: string;
  score: number;
  weight: number;
  reason: string;
  evidenceIds: string[];
}

export interface ConfidenceEngineOutput {
  overallConfidenceScore: number;
  confidenceLevel: ReturnType<typeof confidenceLevelForScore>;
  factors: ConfidenceEngineFactor[];
  estimateExplanations: Array<{
    area: "Revenue Estimate" | "Recommendation" | "Benchmark" | "Competitor" | "Outcome Validation";
    confidenceScore: number;
    reasons: string[];
    missingInputs: string[];
    evidenceIds: string[];
  }>;
}

export interface IndustryBenchmarkEngine {
  status: "available" | "seeded_internal_dataset" | "low_coverage" | "not_available";
  industryType: string;
  datasetVersion: string;
  sampleSize: number;
  verticalAverages: Array<{
    industryType: string;
    sampleSize: number;
    averageOss: number;
    dimensions: Partial<Record<DimensionKey, number>>;
  }>;
  currentPosition: Array<{
    dimension: DimensionKey;
    dimensionLabel: string;
    score: number;
    industryAverage: number;
    position: "Above Benchmark" | "At Benchmark" | "Below Benchmark" | "Not Assessed";
    delta: number;
  }>;
  limitations: string[];
}

export interface CompetitorTimelinePoint {
  snapshotId: string;
  capturedAt: string;
  oss: number | null;
  dimensions: Partial<Record<DimensionKey, number>>;
}

export interface CompetitorIntelligenceEngine {
  status: "not_assessed" | "tracked" | "limited";
  competitors: Array<{
    competitorUrl: string;
    competitorLabel: string;
    timeline: CompetitorTimelinePoint[];
    latestMovement: {
      ossDelta: number | null;
      changedDimensions: Array<{
        dimension: DimensionKey;
        dimensionLabel: string;
        beforeScore: number | null;
        afterScore: number | null;
        delta: number | null;
        suspectedReason: string;
      }>;
    };
  }>;
  explanation: string;
}

export interface MonitoringSchedulerState {
  status: "manual_only" | "scheduled" | "paused";
  scheduleId: string;
  cadence: "daily" | "weekly" | "monthly";
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  targetUrl: string;
  competitorUrls: string[];
  alertChannels: Array<"dashboard" | "email_simulated">;
}

export interface AlertEngineOutput {
  status: "no_alerts" | "alerts_generated";
  alerts: Array<{
    alertId: string;
    type: "score_drop" | "competitor_movement" | "recommendation_validated" | "revenue_pressure" | "monitoring_due";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    trigger: string;
    evidenceIds: string[];
    createdAt: string;
    acknowledged: boolean;
  }>;
}

export interface OperationalMemoryGraph {
  status: "graph_ready" | "limited_history";
  nodes: Array<{
    nodeId: string;
    type: "website" | "snapshot" | "issue" | "recommendation" | "outcome" | "revenue_impact" | "competitor";
    label: string;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    edgeId: string;
    from: string;
    to: string;
    relationship: "has_snapshot" | "has_issue" | "recommends" | "validated_by" | "maps_to" | "compared_with";
    confidenceScore: number;
  }>;
  summary: string;
}

export interface BusinessEvolutionEngine {
  status: "baseline_only" | "evolution_tracked";
  timeline: Array<{
    snapshotId: string;
    capturedAt: string;
    oss: number;
    topCause: string;
  }>;
  trend: "improving" | "declining" | "stable" | "baseline";
  scoreDelta: number;
  causeNarrative: string;
}

export interface CompetitiveThreatRadar {
  status: "not_assessed" | "active";
  threatLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  threats: Array<{
    competitorUrl: string;
    threatType: "mobile_gain" | "trust_gain" | "conversion_gain" | "oss_gain" | "client_regression";
    severity: "low" | "medium" | "high";
    reason: string;
    evidenceIds: string[];
  }>;
  explanation: string;
}

export interface BusinessDnaEngine {
  status: "baseline_profile" | "pattern_detected";
  strengths: string[];
  weaknesses: string[];
  growthStyle: "slow_but_consistent" | "fast_improving" | "volatile" | "declining" | "baseline_only";
  recurringPatterns: string[];
  confidenceScore: number;
}

export interface EditIntelligenceSystem {
  status: "collector_ready" | "signals_observed";
  sessionFingerprint: string;
  observedSignals: Array<{
    signal: "scan_started" | "scan_abandoned" | "report_downloaded" | "recommendation_viewed" | "rescan_started";
    count: number;
    lastObservedAt: string;
  }>;
  abandonmentRisk: "low" | "medium" | "high" | "unknown";
  churnInference: "not_enough_behavior" | "stable_usage" | "possible_churn";
  funnelAnalytics: Array<{
    step: string;
    observed: boolean;
    evidenceIds: string[];
  }>;
  limitations: string[];
}

export interface ArchitectureLayerState {
  flow: IntelligenceLayerKey[];
  activeV1Engines: string[];
  stagedFutureEngines: Array<{
    engine: "Operational Memory Graph" | "Business Evolution Engine" | "Outcome Validation Engine" | "Competitive Threat Radar" | "Business DNA Engine" | "Edit Intelligence System";
    status: "architecturally_integrated" | "staged_for_future_activation";
    activationNote: string;
  }>;
  eventDrivenContract: string;
}

export interface ExecutionProvenance {
  systemVersion: string;
  buildHash: string;
  deploymentEnvironment: string;
  nodeClusterId: string;
  executionRegion: string;
  crawlEngine: string;
  pagesFetched: string[];
  failedFetches: Array<{ url: string; reason: string }>;
  executionTimeMs: number;
  timeoutMs: number;
  retryCount: number;
  javascriptRenderingMode: RenderState;
  robotsTxtComplianceStatus: ScanCoverage["robotsTxtStatus"];
}

export interface IntegrityLayer {
  snapshotHash: string;
  evidenceHashChain: string[];
  immutableVerificationFingerprint: string;
  snapshotIntegrityStatus: "sealed" | "analysis_limited" | "failed";
}

export interface ReportSnapshot {
  snapshotId: string;
  createdAt: string;
  status: SnapshotStatus;
  targetUrl: string;
  mode: ScanMode;
  tenantBranding: TenantBranding;
  clientInformation?: ClientReportInformation;
  scanCoverage: ScanCoverage;
  dataInputs: DataInputStatus[];
  executiveClarity: Record<
    "overallWebsiteStatus" | "primaryConversionBlocker" | "primaryOpportunity" | "estimatedImpactRange" | "recommendedFirstAction",
    string
  >;
  verdictCard: {
    revenueStatus: string;
    oss: number | null;
    businessRiskStatus: "Not Assessed" | "Low Structural Risk" | "Medium Structural Risk" | "High Structural Risk" | "Critical Structural Risk";
    topIssue: string;
    recoverableOpportunity: string;
    highestLeverageAction: string;
  };
  actionFirstPanel: ActionFirstPanel;
  systemVerdict: SystemVerdict;
  ossInterpretation: OssInterpretation;
  businessRiskStatus: BusinessRiskStatus;
  decisionIntelligenceBrief: DecisionIntelligenceBrief;
  oss: {
    score: number | null;
    scoringStatus?: "scored" | "not_scored";
    classification: string;
    visualState: VisualState;
    explanation: string;
  };
  businessVitalSigns: BusinessVitalSign[];
  executiveSummaryTable: ExecutiveSummaryRow[];
  confidenceLayer: ConfidenceMetric[];
  evidenceCoverageSummary: EvidenceCoverageSummary;
  dimensions: DimensionScore[];
  evidenceObjects: EvidenceObject[];
  evidenceClusters: EvidenceCluster[];
  rawSignalTelemetry: RawSignalEvent[];
  validationTrace: ValidationTraceEntry[];
  groundTruthValidationLog: GroundTruthValidationLogEntry[];
  decisions: DecisionOutput[];
  decisionSummary: string;
  unifiedIssueCanvas: UnifiedIssueCanvas;
  globalOutputContract: GlobalOutputContract;
  businessOutcomeBridge: BusinessOutcomeBridgeItem[];
  revenueIntelligence: RevenueIntelligenceLayer;
  recommendationEngine: RecommendationEngineOutput;
  lightweightChangeDetection: LightweightChangeDetection;
  evidenceDatabase: EvidenceDatabaseEntry[];
  recommendationOutcomeLoop: OutcomeValidationEngine;
  businessOutcomeAttributionLayer: BusinessOutcomeAttributionLayer;
  dependencyIntelligenceLayer: DependencyIntelligenceLayer;
  recommendationSequencingEngine: RecommendationSequencingEngine;
  evidenceFreshnessGovernanceLayer: EvidenceFreshnessGovernanceLayer;
  closedLoopOutcomeVerificationLayer: ClosedLoopOutcomeVerificationLayer;
  businessObjectiveAlignmentValidation: BusinessObjectiveAlignmentValidation;
  confidenceEngine: ConfidenceEngineOutput;
  industryBenchmarkEngine: IndustryBenchmarkEngine;
  competitorIntelligenceEngine: CompetitorIntelligenceEngine;
  monitoringScheduler: MonitoringSchedulerState;
  alertEngine: AlertEngineOutput;
  operationalMemoryGraph: OperationalMemoryGraph;
  businessEvolutionEngine: BusinessEvolutionEngine;
  competitiveThreatRadar: CompetitiveThreatRadar;
  businessDnaEngine: BusinessDnaEngine;
  editIntelligenceSystem: EditIntelligenceSystem;
  transformationIntelligence: TransformationProjection;
  closedLoopProofSystem: ClosedLoopProofSystem;
  priorityTimeline: PriorityTimelineFramework;
  marketReadinessPosition: MarketReadinessPosition;
  gbpIdentity: GbpIdentityAnalysis;
  benchmarkContext: BenchmarkContext;
  competitorComparison: ComparativeFinding[];
  optionalSections: {
    seoInsights: "enabled" | "not_assessed";
    gbpIdentity: "provided" | "not_assessed";
  };
  systemHealthState: SystemHealthState;
  executionProvenance: ExecutionProvenance;
  reportGovernance: ReportGovernance;
  structuredOutputSchema: StructuredOutputSchema;
  architectureState: ArchitectureLayerState;
  integrity: IntegrityLayer;
  freshness: {
    capturedAt: string;
    cacheStatus: "live_capture" | "cached";
    validityWindowHours: number;
    stalenessRisk: "low" | "medium" | "high";
    nextRecommendedScanAt: string;
  };
}

export interface SpecCoverageItem {
  id: string;
  requirement: string;
  sourceParagraphs: string;
  status: CoverageStatus;
  implementation: string;
}

export type ReportLifecycleState = "draft" | "processing" | "available" | "reviewed" | "shared" | "archived" | "limited";

export interface DecisionTimelinePoint {
  snapshotId: string;
  capturedAt: string;
  scanDate: string;
  reportLifecycle: ReportLifecycleState;
  status: SnapshotStatus;
  oss: number | null;
  visualStateLabel: string;
  businessRiskStatus: string;
  confidenceScore: number;
  evidenceCoveragePercent: number;
  totalPagesSampled: number;
  totalEvidenceObjects: number;
  strongestSignal: string;
  weakestSignal: string;
  topDecision: string;
  topRecommendedAction: string;
  engineVersion: string;
  intelligenceModelVersion: string;
  decisionFrameworkVersion: string;
  reportTemplateVersion: string;
}

export interface DecisionTimelineEvent {
  eventId: string;
  eventType:
    | "baseline_created"
    | "score_improved"
    | "score_declined"
    | "risk_changed"
    | "recommendation_validated"
    | "recommendation_regressed"
    | "competitor_threat_detected"
    | "content_unavailable"
    | "review_recommended";
  capturedAt: string;
  snapshotId: string;
  title: string;
  summary: string;
  businessMeaning: string;
  confidenceScore: number;
  evidenceCoveragePercent: number;
  relatedRecommendationIds: string[];
}

export interface DecisionTimelineOutput {
  status: "baseline_only" | "active" | "content_unavailable" | "insufficient_history";
  targetUrl: string;
  tenantSlug: string;
  generatedAt: string;
  currentSnapshotId: string;
  currentLifecycle: ReportLifecycleState;
  summary: string;
  platformGovernance: {
    sourceOfTruth: "SYSTOLAB Intelligence Engine";
    mutationPolicy: "immutable_snapshot_history";
    ethicsPolicy: string;
  };
  versionLedger: {
    engineVersion: string;
    intelligenceModelVersion: string;
    decisionFrameworkVersion: string;
    reportTemplateVersion: string;
    currentScanDate: string;
  };
  points: DecisionTimelinePoint[];
  events: DecisionTimelineEvent[];
  limitations: string[];
}

export type InternalReportCadence = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "custom" | "event_triggered";
export type InternalReportExportFormat = "json" | "pdf" | "csv" | "spreadsheet" | "dashboard";

export interface InternalIntelligenceReport {
  reportId: string;
  reportType: InternalReportCadence;
  title: string;
  generatedAt: string;
  period: {
    startAt: string;
    endAt: string;
    label: string;
  };
  accessScope: "internal_admin_only";
  sourceSummary: {
    scans: number;
    completedScans: number;
    industries: number;
    competitorsTracked: number;
    evidenceRows: number;
    outcomeValidations: number;
    editEvents: number;
    alerts: number;
  };
  executiveSummary: string[];
  marketIntelligence: Array<{
    industryType: string;
    scanCount: number;
    averageOss: number;
    trend: "improving" | "declining" | "stable" | "insufficient_history";
    commonWeaknesses: string[];
  }>;
  industryTrendAnalysis: Array<{
    industryType: string;
    strongestDimension: string;
    weakestDimension: string;
    revenueLeakageUnits: number;
    opportunityScore: number;
  }>;
  revenueLeakageTrends: {
    estimatedLowUnits: number;
    estimatedHighUnits: number;
    validatedLowUnits: number;
    validatedHighUnits: number;
    alignmentScore: number;
    notes: string[];
  };
  competitorMovementReport: Array<{
    competitorUrl: string;
    observations: number;
    latestOssDelta: number | null;
    threatLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
    reasons: string[];
  }>;
  competitorRelationshipGraph: {
    status: "empty" | "active" | "limited";
    nodes: Array<{
      nodeId: string;
      type: "business" | "competitor" | "industry" | "market_segment" | "location";
      label: string;
      prominenceScore: number;
      metadata: Record<string, unknown>;
    }>;
    edges: Array<{
      edgeId: string;
      from: string;
      to: string;
      relationship: "competes_with" | "belongs_to_industry" | "operates_in_location" | "overlaps_with";
      weight: number;
      observations: number;
      latestOssDelta: number | null;
    }>;
    marketClusters: Array<{
      clusterId: string;
      industryType: string;
      location: string;
      businessCount: number;
      competitorCount: number;
      concentrationScore: number;
      dominantCompetitors: string[];
      emergingChallengers: string[];
    }>;
    influenceLeaders: Array<{
      competitorUrl: string;
      referencedByBusinesses: number;
      industries: string[];
      locations: string[];
      influenceScore: number;
      growthVelocity: number;
    }>;
    insights: string[];
  };
  recommendationEffectiveness: Array<{
    recommendationPattern: string;
    generatedCount: number;
    validatedCount: number;
    averageOssDelta: number;
    effectivenessScore: number;
  }>;
  ossDistribution: {
    critical: number;
    friction: number;
    optimization: number;
    averageOss: number;
  };
  behavioralAnalytics: {
    eventsByType: Record<string, number>;
    abandonmentSignals: number;
    reportDownloadRate: number;
    recommendationViewRate: number;
  };
  churnIntelligence: {
    possibleChurnSignals: number;
    highAbandonmentSessions: number;
    notes: string[];
  };
  conversionFunnelAnalysis: Array<{
    step: string;
    observedCount: number;
    conversionFromPreviousPercent: number;
  }>;
  businessDnaDiscoveries: Array<{
    pattern: string;
    frequency: number;
    affectedIndustries: string[];
  }>;
  outcomeValidationFindings: Array<{
    status: string;
    count: number;
    averageOssDelta: number;
    evidenceStrength: string;
  }>;
  intelligenceAccuracyMetrics: Array<{
    metric: string;
    score: number;
    basis: string;
    recalibrationRecommendation: string;
  }>;
  knowledgeGrowthScore: {
    overallScore: number;
    trend: "learning_fast" | "learning_steadily" | "flat" | "insufficient_signal";
    dimensions: Array<{
      dimension:
        | "industry_knowledge"
        | "competitor_intelligence"
        | "revenue_prediction_confidence"
        | "recommendation_accuracy"
        | "behavioral_understanding"
        | "market_coverage";
      score: number;
      evidenceGains: string[];
      limitation: string;
    }>;
    evidenceBasis: string[];
    interpretation: string;
  };
  platformGrowthIndicators: {
    scanGrowthRate: number;
    activeWorkspaceCount: number;
    monitoredTargets: number;
    generatedAlerts: number;
    notificationJobs: number;
  };
  intelligenceDiscoveryInsights: Array<{
    insightId: string;
    category: "market_shift" | "behavioral_pattern" | "recommendation_pattern" | "industry_gap" | "competitor_pattern" | "platform_performance";
    title: string;
    finding: string;
    confidenceScore: number;
    evidenceBasis: string[];
  }>;
  opportunityDiscoveries: Array<{
    opportunityId: string;
    opportunityType: "product" | "service" | "automation" | "partnership" | "market_segment";
    title: string;
    rationale: string;
    priority: "low" | "medium" | "high";
    estimatedImpactUnits: number;
  }>;
  anomalyAlerts: Array<{
    anomalyId: string;
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    explanation: string;
    detectedAt: string;
  }>;
}

export type AuthProviderType = "google" | "email_otp" | "phone_otp" | "password";
export type AuthIdentifierType = "email" | "phone";
export type UserLifecycleState = "PENDING" | "VERIFIED" | "SUSPENDED" | "LOCKED" | "DELETED";
export type OtpPurpose = "signup" | "login" | "password_reset";

export interface AuthUserProfile {
  userId: string;
  email?: string;
  phone?: string;
  googleId?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  avatarUrl?: string;
  locale?: string;
  googleProfile?: {
    subject?: string;
    hostedDomain?: string;
    picture?: string;
    claimsCapturedAt?: string;
    availableClaims: string[];
  };
  providers: AuthProviderType[];
  emailVerified: boolean;
  phoneVerified: boolean;
  googleVerified: boolean;
  lifecycleState: UserLifecycleState;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AuthSessionSummary {
  sessionId: string;
  deviceId: string;
  deviceLabel: string;
  provider: AuthProviderType;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  refreshExpiresAt: string;
  revokedAt?: string;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResponse {
  user: AuthUserProfile;
  session?: AuthSessionSummary;
  tokens?: AuthTokenPair;
  requiresVerification?: boolean;
  message: string;
}

export interface GoogleLoginRequest {
  credential: string;
  deviceId?: string;
  deviceLabel?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  photoURL?: string;
  phoneNumber?: string;
  locale?: string;
}

export interface OtpRequestInput {
  identifierType: AuthIdentifierType;
  identifier: string;
  purpose: OtpPurpose;
  deviceId?: string;
}

export interface OtpChallengeResponse {
  challengeId: string;
  identifierType: AuthIdentifierType;
  maskedDestination: string;
  purpose: OtpPurpose;
  expiresAt: string;
  resendAvailableAt: string;
  maxAttempts: number;
  simulatedDelivery: {
    mode: "backend_simulation";
    code?: string;
    note: string;
  };
}

export interface OtpVerifyInput {
  challengeId: string;
  code: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface PasswordRegisterInput {
  identifierType: AuthIdentifierType;
  identifier: string;
  password: string;
  displayName?: string;
  deviceId?: string;
}

export interface PasswordLoginInput {
  identifierType: AuthIdentifierType;
  identifier: string;
  password: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface PasswordForgotInput {
  identifierType: AuthIdentifierType;
  identifier: string;
  deviceId?: string;
}

export interface PasswordResetChallengeResponse {
  resetId: string;
  maskedDestination: string;
  expiresAt: string;
  maxAttempts: number;
  simulatedDelivery: {
    mode: "backend_simulation";
    token?: string;
    note: string;
  };
}

export interface PasswordResetInput {
  resetId: string;
  token: string;
  newPassword: string;
  deviceId?: string;
}

export interface RefreshSessionInput {
  refreshToken: string;
  deviceId?: string;
}

export interface LogoutInput {
  refreshToken?: string;
  sessionId?: string;
}
