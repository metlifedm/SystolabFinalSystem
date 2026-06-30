import * as cheerio from "cheerio";
import { createRenderer, type Renderer, type RenderedPage } from "./renderer.js";
import {
  clampScore,
  confidenceLevelForScore,
  DIMENSION_LABELS,
  NOT_SCORED_VISUAL_STATE,
  RENDER_STATE_VALUES,
  SYSTOLAB_VERSION,
  type ActionFirstPanel,
  type BenchmarkContext,
  type AlertEngineOutput,
  type BusinessOutcomeBridgeItem,
  type BusinessDnaEngine,
  type BusinessEvolutionEngine,
  type BusinessRiskStatus,
  type BusinessObjectiveAlignmentValidation,
  type BusinessOutcomeAttributionLayer,
  type BusinessVitalSign,
  type CanonicalIssue,
  type CanonicalSignalCategory,
  type CanonicalIssueDomain,
  type ClosedLoopOutcomeVerificationLayer,
  type ClosedLoopProofSystem,
  type ComparativeFinding,
  type ConfidenceMetric,
  type ConfidenceEngineOutput,
  type ConfidenceEngineFactor,
  type CompetitiveThreatRadar,
  type CompetitorIntelligenceEngine,
  type CompetitorTimelinePoint,
  type DataInputStatus,
  type DecisionOutput,
  type DependencyIntelligenceLayer,
  type DimensionKey,
  type DimensionScore,
  type EditIntelligenceSystem,
  type EvidenceCluster,
  type EvidenceCoverageSummary,
  type EvidenceDatabaseEntry,
  type EvidenceFreshnessGovernanceLayer,
  type EvidenceObject,
  type ExecutionProvenance,
  type ExecutiveSummaryRow,
  type GbpIdentityAnalysis,
  type GlobalOutputContract,
  type GroundTruthValidationLogEntry,
  type ArchitectureLayerState,
  type IndustryBenchmarkEngine,
  type LightweightChangeDetection,
  type MarketReadinessPosition,
  type MonitoringSchedulerState,
  type OperationalMemoryGraph,
  type OssInterpretation,
  type OutcomeAttributionProfile,
  type OutcomeValidationEngine,
  type OutcomeVerificationRecord,
  type PriorityTimelineFramework,
  type PriorityTimelineItem,
  type RawSignalEvent,
  type RecommendationEngineOutput,
  type RecommendationLifecycleState,
  type RecommendationSequenceItem,
  type RecommendationSequencingEngine,
  type RevenueIntelligenceLayer,
  type RenderState,
  type ReportSnapshot,
  type ScanCoverage,
  type ScanRequest,
  type SystemHealthState,
  type TenantBranding,
  type TransformationProjection,
  type UnifiedIssueCanvas,
  type ValidationTraceEntry,
  visualStateForScore
} from "@systolab/shared";
import { env } from "../../config/env.js";
import { makeId, sha256, stableStringify } from "../../utils/crypto.js";
import { logger } from "../../utils/logger.js";
import { EvidenceBuilder, snippet } from "./evidence.js";
import { analyzeGbpIdentity } from "./gbp.js";
import { assertPublicHttpUrl, fetchText } from "./network.js";
import { discoverInternalLinks } from "./pageDiscovery.js";
import { checkRobots } from "./robots.js";
import { buildDimensionScores, calculateOss, classifyScore } from "./scoring.js";
import { buildCompetitorContentGapEvidence, extractSystolabIntelligenceEvidence } from "./systolabIntelligence.js";

interface CollectedPage {
  requestedUrl: string;
  finalUrl: string;
  role: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  html: string;
  bytesRead: number;
  durationMs: number;
  visual?: {
    screenshotArtifactId: string | null;
    viewportArtifactId: string | null;
    renderedHtml: string;
    ctaAboveFold: boolean;
    jsInjected: boolean;
    renderTimeMs: number;
  } | null;
}

interface SiteAnalysis {
  normalizedUrl: URL;
  pages: CollectedPage[];
  discoveredPages: number;
  coverage: ScanCoverage;
  evidenceObjects: EvidenceObject[];
  evidenceClusters: EvidenceCluster[];
  validationTrace: ValidationTraceEntry[];
  rawSignalTelemetry: RawSignalEvent[];
  dimensions: DimensionScore[];
  oss: number;
  failedFetches: Array<{ url: string; reason: string }>;
  renderState: RenderState;
}

interface CompetitorScanResult {
  requestedUrl: string;
  analysis: SiteAnalysis | null;
  failedReason?: string;
  rawSignalTelemetry: RawSignalEvent[];
}

const SEEDED_VERTICAL_BENCHMARKS: IndustryBenchmarkEngine["verticalAverages"] = [
  {
    industryType: "dentist",
    sampleSize: 42,
    averageOss: 66,
    dimensions: { trust: 67, conversionReadiness: 58, mobileExperience: 63, informationClarity: 64, websiteHealth: 69 }
  },
  {
    industryType: "law_firm",
    sampleSize: 38,
    averageOss: 71,
    dimensions: { trust: 72, conversionReadiness: 62, mobileExperience: 65, informationClarity: 70, websiteHealth: 74 }
  },
  {
    industryType: "ecommerce",
    sampleSize: 55,
    averageOss: 63,
    dimensions: { trust: 61, conversionReadiness: 61, mobileExperience: 66, informationClarity: 59, websiteHealth: 67 }
  },
  {
    industryType: "saas",
    sampleSize: 47,
    averageOss: 73,
    dimensions: { trust: 70, conversionReadiness: 68, mobileExperience: 72, informationClarity: 74, websiteHealth: 76 }
  },
  {
    industryType: "local_service",
    sampleSize: 64,
    averageOss: 62,
    dimensions: { trust: 60, conversionReadiness: 56, mobileExperience: 61, informationClarity: 58, websiteHealth: 65 }
  }
];

export async function runSystolabScan(
  request: ScanRequest,
  tenantBranding: TenantBranding,
  previousSnapshot?: ReportSnapshot | null,
  snapshotHistory: ReportSnapshot[] = previousSnapshot ? [previousSnapshot] : []
): Promise<ReportSnapshot> {
  const startedAt = Date.now();
  const snapshotId = makeId("snap");
  const renderer = await createRenderer();
  try {
  const primary = await analyzeSite(request.targetUrl, snapshotId, request.mode === "fast_scan" ? 1 : env.maxInternalPages + 1, renderer);
  const gbpResult = await analyzeGbpIdentity(request.gbpUrl, primary.evidenceObjects, snapshotId);
  const competitorResults = await analyzeCompetitors(request, snapshotId);

  const contentUnavailable = primary.pages.length === 0;
  const competitorContentGapEvidence = buildCompetitorContentGapEvidence(primary.normalizedUrl, primary.evidenceObjects, competitorResults, new EvidenceBuilder(`${snapshotId}-competitor-content-gap`));
  const primaryEvidenceObjects = [...primary.evidenceObjects, ...competitorContentGapEvidence];
  const primaryEvidenceClusters = buildEvidenceClusters(primaryEvidenceObjects);
  const primaryValidationTrace = buildValidationTrace(primaryEvidenceObjects);
  const primaryDimensions = contentUnavailable ? primary.dimensions : buildDimensionScores(primaryEvidenceObjects);
  const primaryOss = contentUnavailable ? primary.oss : calculateOss(primaryDimensions);
  const oss = contentUnavailable ? null : primaryOss;
  const scoreForDerivedInternalSections = primaryOss;
  const status = contentUnavailable ? "content_unavailable" : primary.coverage.robotsTxtStatus === "blocked" ? "analysis_limited" : "completed";
  const visualState = contentUnavailable ? NOT_SCORED_VISUAL_STATE : visualStateForScore(scoreForDerivedInternalSections);
  const confidenceLayer = contentUnavailable ? buildContentUnavailableConfidenceLayer() : buildConfidenceLayer(primary);
  const rawDecisions = contentUnavailable ? [] : buildDecisions(primaryDimensions, primaryEvidenceObjects);
  const unifiedIssueCanvas = contentUnavailable ? buildContentUnavailableUnifiedIssueCanvas() : buildUnifiedIssueCanvas(rawDecisions, primaryDimensions, primaryEvidenceObjects);
  const businessOutcomeAttributionLayer = buildBusinessOutcomeAttributionLayer(unifiedIssueCanvas, primaryDimensions, primaryEvidenceObjects, contentUnavailable);
  const dependencyIntelligenceLayer = buildDependencyIntelligenceLayer(unifiedIssueCanvas, businessOutcomeAttributionLayer);
  const decisions = contentUnavailable ? [] : normalizeDecisionsThroughIssueCanvas(rawDecisions, unifiedIssueCanvas);
  const executiveClarity = contentUnavailable ? buildContentUnavailableExecutiveClarity() : buildExecutiveClarity(primaryDimensions, scoreForDerivedInternalSections, decisions);
  const verdictCard = contentUnavailable ? buildContentUnavailableVerdictCard() : buildVerdictCard(scoreForDerivedInternalSections, decisions, request.monthlyLeadVolume);
  const businessRiskStatus = contentUnavailable ? buildContentUnavailableBusinessRiskStatus() : buildBusinessRiskStatus(scoreForDerivedInternalSections, primaryDimensions, decisions);
  const actionFirstPanel = buildActionFirstPanel(status, primaryDimensions, primaryEvidenceObjects, primaryEvidenceClusters);
  const systemVerdict = contentUnavailable ? buildContentUnavailableSystemVerdict() : buildSystemVerdict(scoreForDerivedInternalSections, primaryDimensions, actionFirstPanel, businessRiskStatus);
  const ossInterpretation = contentUnavailable ? buildContentUnavailableOssInterpretation() : buildOssInterpretation(scoreForDerivedInternalSections, visualState, primaryDimensions, actionFirstPanel);
  const businessOutcomeBridge = buildBusinessOutcomeBridge(primaryDimensions, decisions);
  const transformationIntelligence = buildTransformationProjection(scoreForDerivedInternalSections, primaryDimensions, decisions);
  const closedLoopProofSystem = buildClosedLoopProof(snapshotId, scoreForDerivedInternalSections, primaryDimensions);
  const priorityTimeline = buildPriorityTimeline(decisions);
  const reportCreatedAt = new Date().toISOString();
  const industryType = request.industryType ?? inferIndustryType(primary);
  const industryBenchmarkEngine = buildIndustryBenchmarkEngine(primaryDimensions, industryType);
  const benchmarkContext = buildBenchmarkContext(primaryDimensions, industryBenchmarkEngine);
  const marketReadinessPosition = buildMarketReadinessPosition(primaryDimensions, benchmarkContext);
  const competitorComparison = buildCompetitorComparison(primary, competitorResults);
  const revenueIntelligence = buildRevenueIntelligence(scoreForDerivedInternalSections, primaryDimensions, decisions, competitorComparison, request.monthlyLeadVolume);
  const recommendationEngine = buildRecommendationEngine(primaryDimensions, decisions, revenueIntelligence, unifiedIssueCanvas, businessOutcomeAttributionLayer);
  const recommendationSequencingEngine = buildRecommendationSequencingEngine(recommendationEngine, unifiedIssueCanvas, businessOutcomeAttributionLayer, dependencyIntelligenceLayer);
  const lightweightChangeDetection = buildLightweightChangeDetection(previousSnapshot, scoreForDerivedInternalSections, primaryDimensions, recommendationEngine);
  const architectureState = buildArchitectureState();
  const allEvidenceObjects = [...primaryEvidenceObjects, ...gbpResult.evidenceObjects];
  const allEvidenceClusters = [...primaryEvidenceClusters, ...gbpResult.evidenceClusters];
  const allValidationTrace = [...primaryValidationTrace, ...gbpResult.validationTrace];
  const allTelemetry = [
    ...primary.rawSignalTelemetry,
    ...gbpResult.rawSignalTelemetry,
    ...competitorResults.flatMap((result) => result.rawSignalTelemetry)
  ];
  const groundTruthValidationLog = buildGroundTruthValidationLog(allEvidenceObjects, allValidationTrace, gbpResult.gbpIdentity);
  const evidenceCoverageSummary = buildEvidenceCoverageSummary(primary.pages, allEvidenceObjects);
  const evidenceDatabase = buildEvidenceDatabase(snapshotId, reportCreatedAt, previousSnapshot, decisions, allEvidenceObjects, allValidationTrace, lightweightChangeDetection);
  const recommendationOutcomeLoop = buildOutcomeValidationEngine(previousSnapshot, reportCreatedAt, scoreForDerivedInternalSections, primaryDimensions, recommendationEngine, revenueIntelligence);
  const evidenceFreshnessGovernanceLayer = buildEvidenceFreshnessGovernanceLayer(allEvidenceObjects, reportCreatedAt);
  const closedLoopOutcomeVerificationLayer = buildClosedLoopOutcomeVerificationLayer(previousSnapshot, recommendationSequencingEngine, recommendationOutcomeLoop, businessOutcomeAttributionLayer, unifiedIssueCanvas);
  const businessObjectiveAlignmentValidation = buildBusinessObjectiveAlignmentValidation(request, recommendationSequencingEngine);
  const confidenceEngine = buildConfidenceEngine(confidenceLayer, evidenceCoverageSummary, revenueIntelligence, recommendationEngine, industryBenchmarkEngine, competitorComparison, recommendationOutcomeLoop);
  const globalOutputContract = buildGlobalOutputContract(unifiedIssueCanvas, recommendationEngine, revenueIntelligence, confidenceEngine, contentUnavailable);
  const competitorIntelligenceEngine = buildCompetitorIntelligenceEngine(competitorComparison, snapshotHistory, snapshotId, reportCreatedAt);
  const monitoringScheduler = buildMonitoringScheduler(request, primary.normalizedUrl.toString(), reportCreatedAt);
  const alertEngine = buildAlertEngine(scoreForDerivedInternalSections, previousSnapshot, lightweightChangeDetection, competitorIntelligenceEngine, recommendationOutcomeLoop, revenueIntelligence, reportCreatedAt);
  const businessEvolutionEngine = buildBusinessEvolutionEngine(snapshotHistory, snapshotId, reportCreatedAt, scoreForDerivedInternalSections, primaryDimensions, decisions);
  const competitiveThreatRadar = buildCompetitiveThreatRadar(competitorIntelligenceEngine, competitorComparison, lightweightChangeDetection);
  const businessDnaEngine = buildBusinessDnaEngine(snapshotHistory, primaryDimensions, scoreForDerivedInternalSections);
  const editIntelligenceSystem = buildEditIntelligenceSystem(snapshotId, reportCreatedAt);
  const operationalMemoryGraph = buildOperationalMemoryGraph(snapshotId, primary.normalizedUrl.toString(), decisions, recommendationEngine, recommendationOutcomeLoop, revenueIntelligence, competitorComparison);
  const decisionIntelligenceBrief = buildDecisionIntelligenceBrief({
    contentUnavailable,
    oss,
    dimensions: primaryDimensions,
    evidenceObjects: allEvidenceObjects,
    evidenceCoverageSummary,
    scanCoverage: primary.coverage,
    confidenceLayer,
    confidenceEngine,
    businessRiskStatus,
    systemVerdict,
    actionFirstPanel,
    revenueIntelligence,
    recommendationEngine,
    marketReadinessPosition,
    benchmarkContext,
    competitorComparison
  });
  const allFailedFetches = [
    ...primary.failedFetches,
    ...competitorResults.flatMap((result) => [
      ...(result.analysis?.failedFetches ?? []),
      ...(result.failedReason ? [{ url: result.requestedUrl, reason: result.failedReason }] : [])
    ])
  ];
  const executionTimeMs = Date.now() - startedAt;

  const reportWithoutIntegrity: Omit<ReportSnapshot, "integrity"> = {
    snapshotId,
    createdAt: reportCreatedAt,
    status,
    targetUrl: primary.normalizedUrl.toString(),
    mode: request.mode,
    tenantBranding,
    scanCoverage: primary.coverage,
    dataInputs: buildDataInputs(request),
    executiveClarity,
    verdictCard,
    actionFirstPanel,
    systemVerdict,
    ossInterpretation,
    businessRiskStatus,
    decisionIntelligenceBrief,
    oss: {
      score: oss,
      scoringStatus: contentUnavailable ? "not_scored" : "scored",
      classification: contentUnavailable ? "Not Scored" : classifyScore(scoreForDerivedInternalSections),
      visualState,
      explanation:
        "OSS measures observable website structure, trust signals, usability, and conversion readiness. OSS does not measure actual revenue, financial performance, sales activity, or business profitability."
    },
    businessVitalSigns: buildVitalSigns(primaryDimensions),
    executiveSummaryTable: buildExecutiveSummary(primaryDimensions, request, competitorComparison, gbpResult.gbpIdentity),
    confidenceLayer,
    evidenceCoverageSummary,
    dimensions: primaryDimensions,
    evidenceObjects: allEvidenceObjects,
    evidenceClusters: allEvidenceClusters,
    rawSignalTelemetry: allTelemetry,
    validationTrace: allValidationTrace,
    groundTruthValidationLog,
    decisions,
    decisionSummary: buildDecisionSummary(decisions),
    unifiedIssueCanvas,
    globalOutputContract,
    businessOutcomeBridge,
    revenueIntelligence,
    recommendationEngine,
    lightweightChangeDetection,
    evidenceDatabase,
    recommendationOutcomeLoop,
    businessOutcomeAttributionLayer,
    dependencyIntelligenceLayer,
    recommendationSequencingEngine,
    evidenceFreshnessGovernanceLayer,
    closedLoopOutcomeVerificationLayer,
    businessObjectiveAlignmentValidation,
    confidenceEngine,
    industryBenchmarkEngine,
    competitorIntelligenceEngine,
    monitoringScheduler,
    alertEngine,
    operationalMemoryGraph,
    businessEvolutionEngine,
    competitiveThreatRadar,
    businessDnaEngine,
    editIntelligenceSystem,
    transformationIntelligence,
    closedLoopProofSystem,
    priorityTimeline,
    marketReadinessPosition,
    gbpIdentity: gbpResult.gbpIdentity,
    benchmarkContext,
    competitorComparison,
    optionalSections: {
      seoInsights: request.includeSeo ? "enabled" : "not_assessed",
      gbpIdentity: request.gbpUrl ? "provided" : "not_assessed"
    },
    systemHealthState: buildSystemHealth(primary, allTelemetry),
    executionProvenance: buildExecutionProvenance(primary, allFailedFetches, executionTimeMs),
    reportGovernance: buildReportGovernance(),
    structuredOutputSchema: buildStructuredOutputSchema(),
    architectureState,
    freshness: buildFreshness(reportCreatedAt)
  };

  const snapshotHash = sha256(stableStringify(reportWithoutIntegrity));
  return {
    ...reportWithoutIntegrity,
    integrity: {
      snapshotHash,
      evidenceHashChain: allEvidenceObjects.map((evidence) => evidence.hash),
      immutableVerificationFingerprint: sha256(`${snapshotId}:${snapshotHash}:${allEvidenceObjects.length}`),
      snapshotIntegrityStatus: status === "completed" ? "sealed" : "analysis_limited"
    }
  };
  } finally {
    await renderer?.close();
  }
}

async function analyzeCompetitors(request: ScanRequest, snapshotSeed: string): Promise<CompetitorScanResult[]> {
  const urls = (request.competitorUrls ?? []).filter(Boolean).slice(0, 5);
  const results: CompetitorScanResult[] = [];
  for (const [index, url] of urls.entries()) {
    try {
      const analysis = await analyzeSite(url, `${snapshotSeed}-competitor-${index + 1}`, request.mode === "fast_scan" ? 1 : 3);
      results.push({
        requestedUrl: url,
        analysis,
        rawSignalTelemetry: analysis.rawSignalTelemetry
      });
    } catch (error) {
      const failedReason = error instanceof Error ? error.message : "Unknown competitor scan failure";
      results.push({
        requestedUrl: url,
        analysis: null,
        failedReason,
        rawSignalTelemetry: [
          {
            eventId: `COMP-RSE-${String(index + 1).padStart(3, "0")}`,
            timestamp: new Date().toISOString(),
            stage: "system",
            level: "error",
            message: "Competitor scan failed",
            metadata: { url, reason: failedReason }
          }
        ]
      });
    }
  }
  return results;
}

async function analyzeSite(
  targetUrl: string,
  snapshotSeed: string,
  maxPages: number,
  renderer?: Renderer | null,
  renderOptions?: { workspaceId?: string }
): Promise<SiteAnalysis> {
  const telemetry: RawSignalEvent[] = [];
  const failedFetches: Array<{ url: string; reason: string }> = [];
  const normalizedUrl = await assertPublicHttpUrl(targetUrl);
  const robots = await checkRobots(normalizedUrl);
  pushTelemetry(telemetry, "robots", robots.isAllowed ? "info" : "warning", `robots.txt status: ${robots.status}`, {
    url: normalizedUrl.toString(),
    matchedRule: robots.matchedRule
  });

  if (!robots.isAllowed) {
    return emptyAnalysis(normalizedUrl, robots.status, telemetry, failedFetches, snapshotSeed);
  }

  const pages: CollectedPage[] = [];
  const home = await fetchPage(normalizedUrl, "homepage", telemetry, failedFetches, renderer, { snapshotId: snapshotSeed, workspaceId: renderOptions?.workspaceId });
  if (home) pages.push(home);

  // Homepage fetch completely failed — no content to analyse. Return a structured limited assessment
  // instead of running the full scoring pipeline on empty evidence (which produces a false OSS score).
  if (!home) {
    return limitedAnalysis(normalizedUrl, robots.status, telemetry, failedFetches, snapshotSeed);
  }

  const discovered = discoverInternalLinks(home.html, new URL(home.finalUrl), Math.max(0, maxPages - 1));
  for (const link of discovered) {
    const url = new URL(link.url);
    const pageRobots = await checkRobots(url);
    pushTelemetry(telemetry, "robots", pageRobots.isAllowed ? "info" : "warning", `page robots status: ${pageRobots.status}`, {
      url: url.toString(),
      role: link.role
    });
    if (!pageRobots.isAllowed) continue;
    // Only render additional pages if SYSTOLAB_PLAYWRIGHT_SCREENSHOT_ALL_PAGES is set
    const pageRenderer = env.playwrightScreenshotAllPages ? renderer : null;
    const page = await fetchPage(url, link.role, telemetry, failedFetches, pageRenderer, { snapshotId: snapshotSeed, workspaceId: renderOptions?.workspaceId });
    if (page) pages.push(page);
  }

  const evidenceBuilder = new EvidenceBuilder(snapshotSeed);
  const evidenceObjects = extractEvidence(pages, normalizedUrl, robots.status, evidenceBuilder);
  const evidenceClusters = buildEvidenceClusters(evidenceObjects);
  const validationTrace = buildValidationTrace(evidenceObjects);
  const dimensions = buildDimensionScores(evidenceObjects);
  const oss = calculateOss(dimensions);
  const renderState = classifySiteRenderState(evidenceObjects);
  pushTelemetry(telemetry, "score", "info", "deterministic scores computed", { oss, dimensions: dimensions.length });

  return {
    normalizedUrl,
    pages,
    discoveredPages: Math.max(discovered.length + 1, pages.length),
    coverage: {
      sampledPages: pages.length,
      discoveredPages: Math.max(discovered.length + 1, pages.length),
      coverageLabel: `${pages.length} of ~${Math.max(discovered.length + 1, pages.length)} pages sampled`,
      robotsTxtStatus: robots.status,
      pageRoles: Object.fromEntries(pages.map((page) => [page.finalUrl, page.role]))
    },
    evidenceObjects,
    evidenceClusters,
    validationTrace,
    rawSignalTelemetry: telemetry,
    dimensions,
    oss,
    failedFetches,
    renderState
  };
}

async function fetchPage(
  url: URL,
  role: string,
  telemetry: RawSignalEvent[],
  failedFetches: Array<{ url: string; reason: string }>,
  renderer?: Renderer | null,
  renderOptions?: { snapshotId?: string; workspaceId?: string }
): Promise<CollectedPage | null> {
  pushTelemetry(telemetry, "http", "info", "HTTP fetch started", { url: url.toString(), role });
  try {
    const response = await fetchText(url, env.crawlTimeoutMs, env.crawlMaxBytes, { retryAttempts: env.crawlRetryAttempts, retryBaseMs: env.crawlRetryBaseMs });
    pushTelemetry(telemetry, "http", response.ok ? "info" : "warning", `HTTP ${response.status}`, {
      url: response.finalUrl,
      bytesRead: response.bytesRead,
      durationMs: response.durationMs
    });

    let visual: CollectedPage["visual"] = null;
    if (renderer && response.ok) {
      try {
        const rendered = await renderer.renderPage(response.finalUrl, renderOptions);
        if (rendered) {
          visual = {
            screenshotArtifactId: rendered.screenshotArtifactId,
            viewportArtifactId: rendered.viewportArtifactId,
            renderedHtml: rendered.renderedHtml,
            ctaAboveFold: rendered.ctaAboveFold,
            jsInjected: rendered.jsInjected,
            renderTimeMs: rendered.renderTimeMs
          };
          pushTelemetry(telemetry, "render", "info", "headless render complete", {
            url: response.finalUrl,
            renderTimeMs: rendered.renderTimeMs,
            ctaAboveFold: rendered.ctaAboveFold,
            jsInjected: rendered.jsInjected
          });
        }
      } catch (renderErr) {
        const renderReason = renderErr instanceof Error ? renderErr.message : "render failure";
        pushTelemetry(telemetry, "render", "warning", `headless render failed: ${renderReason}`, { url: url.toString() });
      }
    }

    return {
      requestedUrl: response.url,
      finalUrl: response.finalUrl,
      role,
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      html: response.body,
      bytesRead: response.bytesRead,
      durationMs: response.durationMs,
      visual
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown fetch failure";
    failedFetches.push({ url: url.toString(), reason });
    pushTelemetry(telemetry, "http", "error", "HTTP fetch failed", { url: url.toString(), reason });
    return null;
  }
}

function extractEvidence(
  pages: CollectedPage[],
  normalizedUrl: URL,
  robotsStatus: ScanCoverage["robotsTxtStatus"],
  builder: EvidenceBuilder
): EvidenceObject[] {
  const evidence: EvidenceObject[] = [];

  for (const page of pages) {
    const effectiveHtml = page.visual?.renderedHtml?.trim() ? page.visual.renderedHtml : page.html;
    const $ = cheerio.load(effectiveHtml);
    const text = $("body").text().replace(/\s+/g, " ").trim();
    const title = $("title").first().text().trim();
    const description = $("meta[name='description']").attr("content")?.trim() ?? "";
    const viewport = $("meta[name='viewport']").attr("content")?.trim() ?? "";
    const canonical = $("link[rel='canonical']").attr("href")?.trim() ?? "";
    const robotsMeta = $("meta[name='robots']").attr("content")?.trim().toLowerCase() ?? "";
    const h1 = $("h1").first().text().trim();
    const linksText = $("a").text();
    const bodyHtml = $.html("body");
    const bodySnippet = snippet(bodyHtml);
    const ctaElements = $("a,button,input[type='submit']").filter((_, element) =>
      /contact|call|book|quote|start|schedule|buy|demo|appointment|get started/i.test(`${$(element).text()} ${$(element).attr("value") ?? ""} ${$(element).attr("href") ?? ""}`)
    );
    const firstCta = ctaElements.first();
    const firstCtaHtml = firstCta.length > 0 ? $.html(firstCta) : "";
    const firstCtaOffset = firstCtaHtml ? bodyHtml.indexOf(firstCtaHtml) : -1;
    const hasPrimaryCtaAboveFold = ctaElements.length > 0 && firstCtaOffset >= 0 && firstCtaOffset <= 3500;
    const imageCount = $("img").length;
    const imagesWithAlt = $("img[alt]").filter((_, image) => ($(image).attr("alt") ?? "").trim().length > 0).length;
    const inputs = $("input,textarea,select").length;
    const labeledInputs = $("label").length + $("[aria-label]").length;
    const formCount = $("form").length;
    const internalLinks = $("a[href]").filter((_, element) => {
      const href = $(element).attr("href");
      if (!href) return false;
      try {
        return new URL(href, page.finalUrl).origin === normalizedUrl.origin;
      } catch {
        return false;
      }
    }).length;
    const scripts = $("script").length;
    const styles = $("link[rel='stylesheet'],style").length;
    const domNodes = $("*").length;
    const htmlBytes = Buffer.byteLength(effectiveHtml, "utf8");
    const hasContact = /mailto:|tel:|contact|appointment|address|location|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i.test(effectiveHtml);
    const hasPrivacy = /privacy/i.test(linksText);
    const hasTerms = /terms|policy/i.test(linksText);
    const hasAbout = /about|team|company|clinic|profile/i.test(linksText);
    const hasReview = /review|testimonial|rating|client|patient story/i.test(text);
    const hasSocial = /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok/i.test(effectiveHtml);
    const securityHeaderScore = scoreSecurityHeaders(page.headers);
    const resourceScore = scoreResourceWeight(htmlBytes, scripts, styles, imageCount);
    const domScore = scoreDomComplexity(domNodes);
    const textDensityScore = scoreTextDensity(text.length, htmlBytes);
    const renderState = classifyPageRenderState(effectiveHtml, text.length, scripts);
    const renderScore = RENDER_STATE_VALUES[renderState];
    const metadataQuality = clampScore(((title ? 1 : 0) + (description ? 1 : 0) + (h1 ? 1 : 0) + (canonical ? 1 : 0)) * 25);

    evidence.push(
      builder.add({
        sourceType: "http",
        url: page.finalUrl,
        pageRole: page.role,
        rawValue: `HTTP ${page.status}`,
        normalizedInput: { signalKey: "http_status_success", value: page.ok, aggregate: "any" },
        validationMethod: "direct_extraction",
        confidenceBasis: "direct HTTP response status",
        groundTruthConfidence: 96,
        httpSnippet: buildHttpSnippet(page),
        dimensionRefs: ["stability", "websiteHealth"]
      }),
      builder.add({
        sourceType: "http",
        url: page.finalUrl,
        pageRole: page.role,
        rawValue: page.finalUrl,
        normalizedInput: { signalKey: "https_transport", value: new URL(page.finalUrl).protocol === "https:", aggregate: "any" },
        validationMethod: "direct_extraction",
        confidenceBasis: "final response URL protocol",
        groundTruthConfidence: 95,
        httpSnippet: buildHttpSnippet(page),
        dimensionRefs: ["trust"]
      }),
      builder.add({
        sourceType: "http",
        url: page.finalUrl,
        pageRole: page.role,
        rawValue: JSON.stringify(pickSecurityHeaders(page.headers)),
        normalizedInput: { signalKey: "security_headers_score", value: securityHeaderScore },
        validationMethod: "direct_extraction",
        confidenceBasis: "HTTP response header extraction",
        groundTruthConfidence: 92,
        httpSnippet: buildHttpSnippet(page),
        dimensionRefs: ["trust", "websiteHealth"]
      }),
      buildDomSignal(builder, page, "title_present", "head > title", title, Boolean(title), ["visibilityStructure", "informationClarity", "websiteHealth"]),
      buildDomSignal(builder, page, "description_present", "meta[name='description']", description, Boolean(description), ["visibilityStructure", "informationClarity", "websiteHealth"]),
      buildDomSignal(builder, page, "viewport_present", "meta[name='viewport']", viewport, Boolean(viewport), ["mobileExperience", "accessibility"]),
      buildDomSignal(builder, page, "canonical_present", "link[rel='canonical']", canonical, Boolean(canonical), ["visibilityStructure"]),
      buildDomSignal(builder, page, "h1_present", "h1", h1, Boolean(h1), ["visibilityStructure", "informationClarity", "accessibility"]),
      buildDomSignal(builder, page, "lang_present", "html[lang]", $("html").attr("lang") ?? "", Boolean($("html").attr("lang")), ["accessibility"]),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "img[alt]",
        rawValue: `${imagesWithAlt} of ${imageCount} images include non-empty alt text`,
        normalizedInput: { signalKey: "alt_coverage", value: imageCount === 0 ? 100 : clampScore((imagesWithAlt / imageCount) * 100) },
        validationMethod: "structural_redundancy",
        confidenceBasis: "DOM image attribute coverage",
        groundTruthConfidence: 88,
        rawDomSnapshot: bodySnippet,
        renderVerification: "HTML parse verification; headless visual frame not required for this signal",
        dimensionRefs: ["accessibility"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "form input,label,[aria-label]",
        rawValue: `${labeledInputs} label or aria-label signals for ${inputs} input controls`,
        normalizedInput: { signalKey: "label_coverage", value: inputs === 0 ? 100 : clampScore((labeledInputs / inputs) * 100) },
        validationMethod: "structural_redundancy",
        confidenceBasis: "DOM form and label extraction",
        groundTruthConfidence: 84,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["accessibility"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "a,button,input[type='submit']",
        rawValue: `${ctaElements.length} CTA-like elements detected`,
        normalizedInput: { signalKey: "cta_present", value: ctaElements.length > 0, aggregate: "any" },
        validationMethod: "structural_redundancy",
        confidenceBasis: "DOM action text and href pattern extraction",
        groundTruthConfidence: 82,
        rawDomSnapshot: snippet(ctaElements.first().toString() || bodyHtml),
        renderVisibility: ctaElements.length > 0 ? "visible_below_fold" : "hidden",
        renderVerification: "Static HTML position heuristic; visual headless verification planned for screenshot frame references",
        dimensionRefs: ["conversionReadiness", "mobileExperience", "informationClarity"]
      }),
      builder.add({
        sourceType: "render",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "first CTA-like a/button/input[type='submit']",
        rawValue: (() => {
          const visualCtaAboveFold = page.visual?.ctaAboveFold ?? hasPrimaryCtaAboveFold;
          if (page.visual) {
            return ctaElements.length === 0
              ? "No CTA-like element detected"
              : visualCtaAboveFold
                ? "Primary CTA confirmed above fold via Playwright viewport render"
                : "Primary CTA not in viewport in Playwright render";
          }
          return ctaElements.length === 0
            ? "No CTA-like element detected"
            : hasPrimaryCtaAboveFold
              ? `Primary CTA observed within first 3500 HTML characters at offset ${firstCtaOffset}`
              : `Primary CTA detected after first fold heuristic at offset ${firstCtaOffset}`;
        })(),
        normalizedInput: { signalKey: "primary_cta_above_fold", value: page.visual?.ctaAboveFold ?? hasPrimaryCtaAboveFold, aggregate: "any" },
        validationMethod: page.visual ? "headless_render_verification" : "structural_redundancy",
        confidenceBasis: page.visual
          ? "Playwright viewport evaluation of CTA element bounding rect"
          : "DOM action pattern plus static render-position heuristic",
        groundTruthConfidence: page.visual ? 90 : (hasPrimaryCtaAboveFold ? 78 : 70),
        rawDomSnapshot: snippet(firstCtaHtml || bodyHtml),
        renderState,
        renderVisibility: (page.visual?.ctaAboveFold ?? hasPrimaryCtaAboveFold) ? "visible_above_fold" : ctaElements.length > 0 ? "visible_below_fold" : "hidden",
        renderVerification: page.visual
          ? `CTA above-fold status confirmed via Playwright getBoundingClientRect() in ${String(page.visual.renderTimeMs)}ms`
          : "HTTP response parsed, DOM CTA pattern checked, and first CTA offset evaluated as a deterministic above-fold proxy.",
        screenshotRef: page.visual?.viewportArtifactId ?? null,
        dimensionRefs: ["conversionReadiness", "mobileExperience", "informationClarity"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body",
        rawValue: hasContact ? "Contact signal observed" : "No contact signal observed in sampled HTML",
        normalizedInput: { signalKey: "contact_signal_present", value: hasContact, aggregate: "any" },
        validationMethod: hasContact ? "structural_redundancy" : "direct_extraction",
        confidenceBasis: "contact text, mailto, tel, address, or location pattern extraction",
        groundTruthConfidence: 83,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["trust", "conversionReadiness"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "form, a[href^='mailto:'], a[href^='tel:']",
        rawValue: formCount > 0 || hasContact ? "Form or contact mechanism observed" : "No form or contact mechanism observed",
        normalizedInput: { signalKey: "form_or_contact_present", value: formCount > 0 || hasContact, aggregate: "any" },
        validationMethod: "structural_redundancy",
        confidenceBasis: "DOM form and contact mechanism extraction",
        groundTruthConfidence: 82,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["conversionReadiness", "mobileExperience"]
      }),
      buildDomSignal(builder, page, "privacy_link_present", "a", hasPrivacy ? "privacy signal detected" : "", hasPrivacy, ["trust"]),
      buildDomSignal(builder, page, "terms_link_present", "a", hasTerms ? "terms or policy signal detected" : "", hasTerms, ["trust"]),
      buildDomSignal(builder, page, "about_link_present", "a", hasAbout ? "about/company signal detected" : "", hasAbout, ["trust"]),
      buildDomSignal(builder, page, "review_signal_present", "body", hasReview ? "review/testimonial wording detected" : "", hasReview, ["trust", "conversionReadiness"]),
      buildDomSignal(builder, page, "social_link_present", "a[href]", hasSocial ? "social identity reference detected" : "", hasSocial, ["trust"]),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "a[href]",
        rawValue: `${internalLinks} internal links detected`,
        normalizedInput: { signalKey: "internal_link_score", value: clampScore(Math.min(internalLinks, 20) * 5) },
        validationMethod: "direct_extraction",
        confidenceBasis: "same-origin anchor extraction",
        groundTruthConfidence: 86,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["visibilityStructure", "websiteHealth"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "nav,a[href]",
        rawValue: `${internalLinks} same-origin links detected`,
        normalizedInput: { signalKey: "navigation_depth_score", value: clampScore(Math.min(internalLinks, 18) * 5.55) },
        validationMethod: "direct_extraction",
        confidenceBasis: "internal navigation extraction",
        groundTruthConfidence: 84,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["websiteHealth", "informationClarity"]
      }),
      builder.add({
        sourceType: "html",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "html",
        rawValue: `${domNodes} DOM nodes detected`,
        normalizedInput: { signalKey: "dom_complexity_score", value: domScore },
        validationMethod: "direct_extraction",
        confidenceBasis: "HTML parser node count",
        groundTruthConfidence: 86,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["renderingQuality"]
      }),
      builder.add({
        sourceType: "network",
        url: page.finalUrl,
        pageRole: page.role,
        rawValue: `${htmlBytes} HTML bytes, ${scripts} scripts, ${styles} style resources, ${imageCount} images`,
        normalizedInput: { signalKey: "resource_weight_score", value: resourceScore },
        validationMethod: "direct_extraction",
        confidenceBasis: "HTML byte size and resource tag count",
        groundTruthConfidence: 84,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["renderingQuality", "mobileExperience", "websiteHealth"]
      }),
      builder.add({
        sourceType: "html",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body",
        rawValue: `${text.length} body text characters across ${htmlBytes} HTML bytes`,
        normalizedInput: { signalKey: "text_density_score", value: textDensityScore },
        validationMethod: "direct_extraction",
        confidenceBasis: "text-to-markup density extraction",
        groundTruthConfidence: 82,
        rawDomSnapshot: bodySnippet,
        dimensionRefs: ["renderingQuality", "informationClarity"]
      }),
      builder.add({
        sourceType: "render",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "html",
        rawValue: page.visual
          ? `${renderState} (headless-confirmed: jsInjected=${String(page.visual.jsInjected)}, interactiveMs=${String(page.visual.renderTimeMs)}ms)`
          : renderState,
        normalizedInput: { signalKey: "render_environment_score", value: renderScore },
        validationMethod: page.visual ? "headless_render_verification" : "structural_redundancy",
        confidenceBasis: page.visual
          ? "headless Playwright render with JS execution and interactive element detection"
          : "deterministic static/hybrid/dynamic classification from HTML, text density, and script count",
        groundTruthConfidence: page.visual ? 91 : 78,
        rawDomSnapshot: bodySnippet,
        renderState,
        renderVerification: page.visual
          ? `Confirmed via Playwright in ${String(page.visual.renderTimeMs)}ms; JS active: ${String(page.visual.jsInjected)}`
          : `Classified as ${renderState}; headless verification not active (SYSTOLAB_PLAYWRIGHT_ENABLED=false)`,
        screenshotRef: page.visual?.screenshotArtifactId ?? null,
        dimensionRefs: ["renderingQuality"]
      }),
      builder.add({
        sourceType: "html",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "meta[name='robots']",
        rawValue: robotsMeta || "No noindex robots directive observed",
        normalizedInput: { signalKey: "indexability_present", value: !robotsMeta.includes("noindex"), aggregate: "any" },
        validationMethod: "direct_extraction",
        confidenceBasis: "meta robots extraction",
        groundTruthConfidence: 86,
        rawDomSnapshot: snippet($("head").html() ?? ""),
        dimensionRefs: ["websiteHealth", "visibilityStructure"]
      }),
      builder.add({
        sourceType: "dom",
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "title,meta[name='description'],h1,link[rel='canonical']",
        rawValue: `Metadata quality score ${metadataQuality}`,
        normalizedInput: { signalKey: "metadata_quality_score", value: metadataQuality },
        validationMethod: "structural_redundancy",
        confidenceBasis: "title, description, h1, and canonical extraction",
        groundTruthConfidence: 86,
        rawDomSnapshot: snippet($("head").html() ?? ""),
        dimensionRefs: ["websiteHealth"]
      }),
      builder.add({
        sourceType: "system",
        url: page.finalUrl,
        pageRole: page.role,
        rawValue: robotsStatus,
        normalizedInput: { signalKey: "robots_allowed", value: robotsStatus !== "blocked", aggregate: "any" },
        validationMethod: "direct_extraction",
        confidenceBasis: "robots.txt rule evaluation",
        groundTruthConfidence: robotsStatus === "unavailable" ? 72 : 90,
        dimensionRefs: ["stability"]
      })
    );
  }

  evidence.push(
    ...extractSystolabIntelligenceEvidence(pages, normalizedUrl, builder),
    builder.add({
      sourceType: "system",
      url: normalizedUrl.toString(),
      pageRole: "scan",
      rawValue: `${pages.filter((page) => page.ok).length} successful fetches from ${pages.length} sampled pages`,
      normalizedInput: {
        signalKey: "fetch_success_rate",
        value: pages.length === 0 ? 0 : clampScore((pages.filter((page) => page.ok).length / pages.length) * 100)
      },
      validationMethod: "multi_page_verification",
      confidenceBasis: "sampled page fetch outcomes",
      groundTruthConfidence: pages.length > 0 ? 88 : 40,
      dimensionRefs: ["stability"]
    }),
    builder.add({
      sourceType: "system",
      url: normalizedUrl.toString(),
      pageRole: "scan",
      rawValue: `${pages.some((page) => page.requestedUrl !== page.finalUrl) ? "Redirect observed" : "No redirect observed"}`,
      normalizedInput: {
        signalKey: "redirect_stability",
        // pages.some() returns false on an empty array, which would falsely signal "stable" (100).
        // When no pages were fetched there is no redirect data — treat as 0, not 100.
        value: pages.length === 0 ? 0 : pages.some((page) => page.requestedUrl !== page.finalUrl) ? 82 : 100
      },
      validationMethod: "multi_page_verification",
      confidenceBasis: "requested URL to final URL comparison",
      groundTruthConfidence: pages.length > 0 ? 86 : 40,
      dimensionRefs: ["stability"]
    }),
    builder.add({
      sourceType: "system",
      url: normalizedUrl.toString(),
      pageRole: "scan",
      rawValue: "Information clarity derived from title, description, h1, text density, navigation, and CTA signals",
      normalizedInput: { signalKey: "information_clarity_score", value: deriveCompositeSignal(evidence, "informationClarity") },
      validationMethod: "structural_redundancy",
      confidenceBasis: "composite structural clarity evidence",
      groundTruthConfidence: 78,
      dimensionRefs: ["conversionReadiness", "informationClarity"]
    })
  );

  return evidence;
}

function buildDomSignal(
  builder: EvidenceBuilder,
  page: CollectedPage,
  signalKey: string,
  selectorPath: string,
  rawValue: string,
  value: boolean,
  dimensionRefs: DimensionKey[]
): EvidenceObject {
  const effectiveHtml = page.visual?.renderedHtml?.trim() ? page.visual.renderedHtml : page.html;
  return builder.add({
    sourceType: "dom",
    url: page.finalUrl,
    pageRole: page.role,
    selectorPath,
    rawValue: rawValue || `Signal ${signalKey} not observed`,
    normalizedInput: { signalKey, value, aggregate: "any" },
    validationMethod: value ? "direct_extraction" : "direct_extraction",
    confidenceBasis: "DOM selector extraction",
    groundTruthConfidence: 86,
    rawDomSnapshot: snippet(rawValue || effectiveHtml),
    renderVerification: "Static DOM extraction; headless visual frame verification available in planned renderer adapter",
    dimensionRefs
  });
}

function deriveCompositeSignal(evidence: EvidenceObject[], dimension: DimensionKey): number {
  const matches = evidence.filter((item) => item.dimensionRefs.includes(dimension));
  if (matches.length === 0) return 0;
  const scores = matches.map((item) => {
    const value = item.normalizedInput.value;
    if (typeof value === "boolean") return value ? 100 : 0;
    if (typeof value === "number") return clampScore(value);
    return 0;
  });
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function buildEvidenceClusters(evidenceObjects: EvidenceObject[]): EvidenceCluster[] {
  const groups = new Map<string, EvidenceObject[]>();
  for (const evidence of evidenceObjects) {
    for (const dimension of evidence.dimensionRefs) {
      const existing = groups.get(dimension) ?? [];
      existing.push(evidence);
      groups.set(dimension, existing);
    }
  }

  return Array.from(groups.entries()).map(([dimension, items]) => ({
    clusterId: `ECL-${dimension}`,
    label: `${dimension} evidence cluster`,
    evidenceIds: items.map((item) => item.evidenceId),
    validationMethod: items.length > 2 ? "structural_redundancy" : "direct_extraction",
    confidenceScore: clampScore(items.reduce((sum, item) => sum + item.groundTruthConfidence, 0) / items.length)
  }));
}

function buildValidationTrace(evidenceObjects: EvidenceObject[]): ValidationTraceEntry[] {
  return evidenceObjects.map((evidence, index) => ({
    traceId: `VTL-${String(index + 1).padStart(4, "0")}`,
    evidenceId: evidence.evidenceId,
    check: `${evidence.sourceType.toUpperCase()} signal validation`,
    httpResult: evidence.sourceType === "http" || evidence.httpSnippet ? "found" : "not_checked",
    domResult: evidence.sourceType === "dom" || evidence.rawDomSnapshot ? "found" : "not_checked",
    renderResult: evidence.renderState ? "found" : "not_rendered",
    outcome:
      evidence.groundTruthConfidence >= 85
        ? "accepted as scoring evidence"
        : evidence.groundTruthConfidence >= 60
          ? "accepted with confidence limitation"
          : "downgraded due to limited confidence",
    confidenceScore: evidence.groundTruthConfidence
  }));
}

function buildDecisions(dimensions: DimensionScore[], evidenceObjects: EvidenceObject[]): DecisionOutput[] {
  const lowDimensions = [...dimensions].sort((a, b) => a.score - b.score).slice(0, 5);
  return lowDimensions.map((dimension, index) => {
    const severity: DecisionOutput["category"] =
      dimension.confidenceScore < 60
        ? "Insufficient Evidence State"
        : dimension.score < 60
          ? "Structural Priority: High"
          : dimension.score < 75
            ? "Optimization Required"
            : "Monitoring Suggested";

    const evidenceIds = dimension.evidenceIds;
    const confidence = dimension.confidenceScore;
    const lowestFactor = [...dimension.trace].sort((a, b) => a.contribution / a.weight - b.contribution / b.weight)[0];
    const action = actionForDimension(dimension.key, lowestFactor?.label);
    const evidenceLanguage =
      evidenceIds.length >= 3
        ? "observed signals suggest potential structural friction"
        : "available evidence is limited and should be interpreted cautiously";

    return {
      decisionId: `DEC-${String(index + 1).padStart(3, "0")}`,
      category: severity,
      decisionClassification: `${dimension.label}: ${dimension.classification}`,
      evidenceTraceReferences: evidenceIds,
      impactExplanation: `Based on ${evidenceIds.length} evidence objects, ${evidenceLanguage} in ${dimension.label.toLowerCase()}.`,
      recommendedActionPath: action,
      confidenceScore: confidence,
      confidenceLevel: confidenceLevelForScore(confidence)
    };
  }).filter((decision) => decision.evidenceTraceReferences.length > 0 || decision.category === "Insufficient Evidence State");
}

function buildContentUnavailableUnifiedIssueCanvas(): UnifiedIssueCanvas {
  return {
    status: "limited_evidence",
    preSignalClassification: [],
    canonicalIssues: [],
    duplicateCollapseEngine: {
      rule: "semantic_causal_equivalence",
      rawIssueCount: 0,
      canonicalIssueCount: 0,
      collapsedDuplicateCount: 0
    },
    actionUnificationLayer: {
      rule: "one_issue_one_authoritative_action",
      authoritativeActionCount: 0,
      removedDuplicateActionCount: 0
    },
    postGenerationNormalization: {
      rule: "one_meaning_one_representation",
      normalized: true,
      removedResidualDuplicateCount: 0
    },
    priorityHierarchy: decisionPriorityHierarchy()
  };
}

function buildUnifiedIssueCanvas(
  decisions: DecisionOutput[],
  dimensions: DimensionScore[],
  evidenceObjects: EvidenceObject[]
): UnifiedIssueCanvas {
  const preSignalClassification = evidenceObjects.map((evidence, index) => classifyEvidenceSignal(evidence, index));
  const rawIssues = decisions
    .map((decision) => canonicalIssueFromDecision(decision, dimensions, evidenceObjects, preSignalClassification))
    .filter((issue): issue is CanonicalIssue => Boolean(issue));

  const collapsed = new Map<string, CanonicalIssue>();
  for (const issue of rawIssues) {
    const existing = collapsed.get(issue.duplicateCollapseKey);
    if (!existing) {
      collapsed.set(issue.duplicateCollapseKey, issue);
      continue;
    }
    collapsed.set(issue.duplicateCollapseKey, mergeCanonicalIssues(existing, issue));
  }

  const issues = [...collapsed.values()]
    .filter((issue) => issue.evidenceIds.length > 1 || issue.confidenceScore >= 65 || issue.primaryCategory === "technical_access")
    .sort((a, b) =>
      priorityOrder(a.primaryCategory) - priorityOrder(b.primaryCategory) ||
      a.confidenceScore - b.confidenceScore ||
      a.issueType.localeCompare(b.issueType)
    )
    .slice(0, 7)
    .map((issue, index) => ({
      ...issue,
      canonicalIssueId: `CI-${String(index + 1).padStart(3, "0")}`,
      priorityRank: index + 1,
      priorityTier: priorityTierForRank(index, issue.primaryCategory)
    }));

  const uniqueActions = new Set(issues.map((issue) => normalizeActionText(issue.authoritativeAction)));
  return {
    status: issues.length > 0 ? "active" : "limited_evidence",
    preSignalClassification,
    canonicalIssues: issues,
    duplicateCollapseEngine: {
      rule: "semantic_causal_equivalence",
      rawIssueCount: rawIssues.length,
      canonicalIssueCount: issues.length,
      collapsedDuplicateCount: Math.max(0, rawIssues.length - issues.length)
    },
    actionUnificationLayer: {
      rule: "one_issue_one_authoritative_action",
      authoritativeActionCount: uniqueActions.size,
      removedDuplicateActionCount: Math.max(0, issues.length - uniqueActions.size)
    },
    postGenerationNormalization: {
      rule: "one_meaning_one_representation",
      normalized: true,
      removedResidualDuplicateCount: Math.max(0, rawIssues.length - issues.length)
    },
    priorityHierarchy: decisionPriorityHierarchy()
  };
}

function canonicalIssueFromDecision(
  decision: DecisionOutput,
  dimensions: DimensionScore[],
  evidenceObjects: EvidenceObject[],
  classifications: UnifiedIssueCanvas["preSignalClassification"]
): CanonicalIssue | null {
  const dimension = dimensionForDecision(decision, dimensions);
  const evidenceIds = Array.from(new Set(decision.evidenceTraceReferences));
  const evidence = evidenceObjects.filter((item) => evidenceIds.includes(item.evidenceId));
  const signalKeys = Array.from(new Set(evidence.map((item) => String(item.normalizedInput?.["signalKey"] ?? "unknown_signal"))));
  const ownership = ownershipForIssue(dimension?.key, signalKeys, classifications.filter((item) => evidenceIds.includes(item.evidenceId)));
  const confidenceScore = clampScore(decision.confidenceScore);
  const primaryCausalDriver = primaryDriverForIssue(ownership.issueType, dimension);
  return {
    canonicalIssueId: "CI-PENDING",
    issueType: ownership.issueType,
    primaryCategory: ownership.primaryCategory,
    owningLayer: ownership.owningLayer,
    systemDomain: ownership.owningLayer,
    primaryCausalDriver,
    rootCauseStatement: rootCauseStatementForIssue(ownership.issueType, dimension, decision),
    customerDecisionProblem: customerProblemForIssue(ownership.issueType, decision),
    priorityRank: 0,
    priorityTier: priorityTierForRank(0, ownership.primaryCategory),
    priorityReason: priorityReasonForCategory(ownership.primaryCategory),
    mappedDimensions: dimension ? [dimension.key] : [],
    contributingSignalKeys: signalKeys.sort(),
    evidenceIds,
    confidenceScore,
    confidenceLevel: confidenceLevelForScore(confidenceScore),
    authoritativeAction: decision.recommendedActionPath,
    duplicateCollapseKey: `${ownership.issueType}:${dimension?.key ?? "unmapped"}`,
    referencedInSections: ["keyDecisionSummary", "rootCauseClusters", "revenueImpactAreas", "evidenceBreakdown", "actionPlanMapping"]
  };
}

function mergeCanonicalIssues(left: CanonicalIssue, right: CanonicalIssue): CanonicalIssue {
  const evidenceIds = Array.from(new Set([...left.evidenceIds, ...right.evidenceIds])).sort();
  const contributingSignalKeys = Array.from(new Set([...left.contributingSignalKeys, ...right.contributingSignalKeys])).sort();
  const mappedDimensions = Array.from(new Set([...left.mappedDimensions, ...right.mappedDimensions]));
  const confidenceScore = clampScore((left.confidenceScore + right.confidenceScore) / 2);
  const preferred = priorityOrder(left.primaryCategory) <= priorityOrder(right.primaryCategory) ? left : right;
  return {
    ...preferred,
    evidenceIds,
    contributingSignalKeys,
    mappedDimensions,
    confidenceScore,
    confidenceLevel: confidenceLevelForScore(confidenceScore),
    authoritativeAction: shorterAction(left.authoritativeAction, right.authoritativeAction)
  };
}

function normalizeDecisionsThroughIssueCanvas(decisions: DecisionOutput[], canvas: UnifiedIssueCanvas): DecisionOutput[] {
  return canvas.canonicalIssues.map((issue, index) => {
    const source = decisions.find((decision) => intersects(decision.evidenceTraceReferences, issue.evidenceIds));
    return {
      decisionId: `DEC-${String(index + 1).padStart(3, "0")}`,
      category: issue.priorityTier === "FIX NOW" ? "Structural Priority: High" : issue.priorityTier === "THIS MONTH" ? "Optimization Required" : "Monitoring Suggested",
      decisionClassification: issue.rootCauseStatement,
      evidenceTraceReferences: issue.evidenceIds,
      impactExplanation: issue.customerDecisionProblem,
      recommendedActionPath: issue.authoritativeAction || source?.recommendedActionPath || "Improve the validated business decision constraint.",
      confidenceScore: issue.confidenceScore,
      confidenceLevel: issue.confidenceLevel
    };
  });
}

function buildGlobalOutputContract(
  canvas: UnifiedIssueCanvas,
  recommendationEngine: RecommendationEngineOutput,
  revenueIntelligence: RevenueIntelligenceLayer,
  confidenceEngine: ConfidenceEngineOutput,
  contentUnavailable: boolean
): GlobalOutputContract {
  if (contentUnavailable || canvas.canonicalIssues.length === 0) {
    return {
      schemaVersion: "systolab.output_contract.v1",
      status: contentUnavailable ? "content_unavailable" : "active",
      keyDecisionSummary: [],
      rootCauseClusters: [],
      revenueImpactAreas: [],
      confidenceScore: contentUnavailable ? 0 : confidenceEngine.overallConfidenceScore,
      evidenceBreakdown: [],
      actionPlanMapping: [],
      nonRedundancyRules: outputNonRedundancyRules(),
      limitations: contentUnavailable
        ? ["Website content could not be collected, so canonical business decisions were not generated."]
        : ["No canonical issue passed the evidence and confidence threshold for customer-facing decision output."]
    };
  }

  return {
    schemaVersion: "systolab.output_contract.v1",
    status: "active",
    keyDecisionSummary: canvas.canonicalIssues.map((issue) => ({
      canonicalIssueId: issue.canonicalIssueId,
      summary: issue.customerDecisionProblem,
      priorityTier: issue.priorityTier
    })),
    rootCauseClusters: canvas.canonicalIssues.map((issue) => ({
      canonicalIssueId: issue.canonicalIssueId,
      primaryCausalDriver: issue.primaryCausalDriver,
      rootCauseStatement: issue.rootCauseStatement
    })),
    revenueImpactAreas: canvas.canonicalIssues.map((issue) => ({
      canonicalIssueId: issue.canonicalIssueId,
      impactArea: impactAreaForCategory(issue.primaryCategory),
      businessImpact: revenueIntelligence.revenueOpportunityRange.rationale,
      confidenceScore: Math.min(issue.confidenceScore, revenueIntelligence.confidenceScore)
    })),
    confidenceScore: confidenceEngine.overallConfidenceScore,
    evidenceBreakdown: canvas.canonicalIssues.map((issue) => ({
      canonicalIssueId: issue.canonicalIssueId,
      validatedFindingCount: issue.evidenceIds.length,
      evidenceCoverage: issue.evidenceIds.length >= 5 ? "full" : issue.evidenceIds.length >= 3 ? "partial" : "limited"
    })),
    actionPlanMapping: canvas.canonicalIssues.map((issue, index) => ({
      canonicalIssueId: issue.canonicalIssueId,
      actionReference: recommendationEngine.recommendations[index]?.recommendationId ?? `Action ${index + 1}`,
      authoritativeAction: issue.authoritativeAction,
      priorityTier: issue.priorityTier
    })),
    nonRedundancyRules: outputNonRedundancyRules(),
    limitations: [
      "Each canonical issue is represented once and referenced by canonical issue ID across the output contract.",
      "SYSTOLAB does not guarantee rankings, traffic, leads, sales, or revenue outcomes.",
      "SEO signals are supporting diagnostic evidence only and are not used for ranking prediction or keyword optimisation claims."
    ]
  };
}

function classifyEvidenceSignal(evidence: EvidenceObject, index: number): UnifiedIssueCanvas["preSignalClassification"][number] {
  const signalKey = String(evidence.normalizedInput?.["signalKey"] ?? "unknown_signal");
  const ownership = ownershipForIssue(evidence.dimensionRefs[0], [signalKey], []);
  return {
    signalId: `SIG-${String(index + 1).padStart(4, "0")}`,
    evidenceId: evidence.evidenceId,
    signalKey,
    primaryCategory: ownership.primaryCategory,
    owningLayer: ownership.owningLayer,
    canonicalIssueType: ownership.issueType,
    classificationBasis: `Pre-signal classification assigned one primary category (${ownership.primaryCategory}) and one owning layer (${ownership.owningLayer}).`
  };
}

function ownershipForIssue(
  dimension: DimensionKey | undefined,
  signalKeys: string[],
  classifications: UnifiedIssueCanvas["preSignalClassification"]
): { primaryCategory: CanonicalSignalCategory; owningLayer: CanonicalIssueDomain; issueType: string } {
  const signalText = signalKeys.join(" ").toLowerCase();
  if (dimension === "conversionReadiness" || /cta|form|checkout|cart|purchase|conversion|primary_cta/.test(signalText)) {
    return { primaryCategory: "conversion_blocker", owningLayer: "Conversion Intelligence", issueType: "conversion_action_gap" };
  }
  if (dimension === "trust" || /trust|review|testimonial|privacy|terms|about|https|security|citation|credibility|proof/.test(signalText)) {
    return { primaryCategory: "trust_failure", owningLayer: "Trust Intelligence", issueType: "trust_proof_gap" };
  }
  if (dimension === "stability" || dimension === "websiteHealth" || dimension === "renderingQuality" || dimension === "accessibility" || dimension === "mobileExperience" || /http|fetch|robots|render|resource|dom|viewport|alt|label|lang|metadata|security_headers/.test(signalText)) {
    return { primaryCategory: "technical_access", owningLayer: "Website Health Intelligence", issueType: "website_health_access_gap" };
  }
  if (/local_visibility|service_area|local_result/.test(signalText)) {
    return { primaryCategory: "visibility_gap", owningLayer: "Local Visibility Intelligence", issueType: "local_visibility_gap" };
  }
  if (dimension === "informationClarity" || /question|intent|pricing|process|topic|content|freshness|search_demand|decision_confidence/.test(signalText)) {
    return { primaryCategory: "content_intent_gap", owningLayer: classifications.some((item) => item.owningLayer === "Content Gap Intelligence") ? "Content Gap Intelligence" : "Customer Intent Intelligence", issueType: "customer_intent_content_gap" };
  }
  if (dimension === "visibilityStructure" || /seo|schema|geo|serp|ranking|visibility|canonical|title|h1|internal_link|entity/.test(signalText)) {
    return { primaryCategory: "visibility_gap", owningLayer: signalText.includes("entity") ? "Entity Intelligence" : "SERP Intelligence", issueType: signalText.includes("entity") ? "entity_clarity_gap" : "visibility_presentation_gap" };
  }
  return { primaryCategory: "evidence_limited", owningLayer: "Website Health Intelligence", issueType: "limited_evidence_gap" };
}

function dimensionForDecision(decision: DecisionOutput, dimensions: DimensionScore[]): DimensionScore | undefined {
  const byLabel = dimensions.find((dimension) => decision.decisionClassification.toLowerCase().startsWith(dimension.label.toLowerCase()));
  if (byLabel) return byLabel;
  return dimensions.find((dimension) => intersects(dimension.evidenceIds, decision.evidenceTraceReferences));
}

function primaryDriverForIssue(issueType: string, dimension: DimensionScore | undefined): string {
  const label = dimension?.label ?? "Validated website evidence";
  const map: Record<string, string> = {
    conversion_action_gap: "The customer action path is not strongly supported by visible next-step signals.",
    trust_proof_gap: "The business does not show enough trust proof at decision points.",
    website_health_access_gap: "The website foundation limits reliable access, structure, or usability evidence.",
    customer_intent_content_gap: "Customer intent questions are not answered with enough clarity for confident decisions.",
    local_visibility_gap: "Local discovery and service-area confidence signals are incomplete.",
    entity_clarity_gap: "Business, service, location, or expertise entities are not clear enough.",
    visibility_presentation_gap: "Search-result presentation support is incomplete without creating a ranking prediction."
  };
  return map[issueType] ?? `${label} is the single primary causal driver for this issue.`;
}

function rootCauseStatementForIssue(issueType: string, dimension: DimensionScore | undefined, decision: DecisionOutput): string {
  const label = dimension?.label ?? decision.decisionClassification;
  return `${label}: ${primaryDriverForIssue(issueType, dimension)}`;
}

function customerProblemForIssue(issueType: string, decision: DecisionOutput): string {
  const map: Record<string, string> = {
    conversion_action_gap: "Customers may be ready to act but do not receive a clear enough next step.",
    trust_proof_gap: "Customers may hesitate or compare alternatives because credibility signals are incomplete.",
    website_health_access_gap: "Customers or crawlers may encounter structural friction before understanding the offer.",
    customer_intent_content_gap: "Customers may not find the information they need to understand, compare, and choose the business.",
    local_visibility_gap: "Nearby customers may not see enough local proof, service-area clarity, or contact confidence.",
    entity_clarity_gap: "Customers and AI/search systems may not clearly connect the business to services, locations, and expertise.",
    visibility_presentation_gap: "Search opportunities may be missed because answers, proof, or entity context are not packaged clearly."
  };
  return map[issueType] ?? decision.impactExplanation;
}

function priorityOrder(category: CanonicalSignalCategory): number {
  const order: Record<CanonicalSignalCategory, number> = {
    conversion_blocker: 1,
    trust_failure: 2,
    technical_access: 3,
    content_intent_gap: 4,
    visibility_gap: 5,
    evidence_limited: 6
  };
  return order[category];
}

function priorityTierForRank(index: number, category: CanonicalSignalCategory): CanonicalIssue["priorityTier"] {
  if (category === "conversion_blocker" || category === "trust_failure" || index === 0) return "FIX NOW";
  if (category === "technical_access" || category === "content_intent_gap" || index <= 3) return "THIS MONTH";
  return "MONITOR";
}

function priorityReasonForCategory(category: CanonicalSignalCategory): string {
  const reasons: Record<CanonicalSignalCategory, string> = {
    conversion_blocker: "Conversion-blocking issues outrank all other decision layers.",
    trust_failure: "Trust failures are prioritized after direct conversion blockers.",
    technical_access: "Technical and access issues are prioritized before content and visibility gaps.",
    content_intent_gap: "Customer intent and content gaps are prioritized before SEO-only visibility gaps.",
    visibility_gap: "Visibility gaps are handled as supporting evidence after business-critical decision friction.",
    evidence_limited: "Limited evidence is monitored until stronger validation exists."
  };
  return reasons[category];
}

function impactAreaForCategory(category: CanonicalSignalCategory): string {
  const areas: Record<CanonicalSignalCategory, string> = {
    conversion_blocker: "Lead, booking, purchase, or inquiry readiness",
    trust_failure: "Customer confidence and comparison decisions",
    technical_access: "Website accessibility, reliability, and structural usability",
    content_intent_gap: "Customer understanding, education, and decision clarity",
    visibility_gap: "Discoverability, local visibility, and search-result presentation support",
    evidence_limited: "Assessment confidence"
  };
  return areas[category];
}

function decisionPriorityHierarchy(): string[] {
  return [
    "1. Conversion-blocking issues",
    "2. Trust failures",
    "3. Technical or access issues",
    "4. Content and customer-intent mismatches",
    "5. SEO, SERP, ranking-opportunity, and visibility gaps"
  ];
}

function outputNonRedundancyRules(): string[] {
  return [
    "Each canonical issue appears once in the output contract.",
    "Other report sections must reference the canonical issue instead of restating the same insight.",
    "Actions are unified so one issue maps to one authoritative action.",
    "Weak single-signal findings are not promoted into customer-facing decisions without sufficient confidence."
  ];
}

function buildBusinessOutcomeAttributionLayer(
  canvas: UnifiedIssueCanvas,
  dimensions: DimensionScore[],
  evidenceObjects: EvidenceObject[],
  contentUnavailable: boolean
): BusinessOutcomeAttributionLayer {
  if (contentUnavailable || canvas.canonicalIssues.length === 0) {
    return {
      status: "limited_evidence",
      profiles: [],
      rankingMethod: "relative_influence_not_prediction",
      summary: "Outcome attribution is pending until canonical issues and validated evidence are available."
    };
  }

  const profiles = canvas.canonicalIssues.map((issue, index) => {
    const dimensionScore = Math.min(...issue.mappedDimensions.map((key) => dimensions.find((dimension) => dimension.key === key)?.score ?? 100), 100);
    const evidenceCount = evidenceObjects.filter((evidence) => issue.evidenceIds.includes(evidence.evidenceId)).length;
    const confidenceScore = clampScore((issue.confidenceScore * 0.72) + (Math.min(evidenceCount, 6) / 6) * 18 + (100 - dimensionScore) * 0.1);
    return {
      attributionProfileId: `OAP-${issue.canonicalIssueId}`,
      canonicalIssueId: issue.canonicalIssueId,
      impactAreas: impactAreasForCanonicalIssue(issue),
      attributionStrength: attributionStrengthForIssue(issue, index, confidenceScore),
      confidenceScore,
      confidenceLevel: confidenceLevelForScore(confidenceScore),
      supportingEvidenceObjectIds: issue.evidenceIds,
      relativeBusinessInfluence: relativeInfluenceForIssue(index, issue, confidenceScore),
      comparativeRank: index + 1,
      customerBehaviorExplanation: attributionBehaviorExplanation(issue),
      nonPredictiveBoundary: "Attribution is comparative and evidence-bound. It ranks likely relative influence and does not predict traffic, leads, revenue, or causation."
    };
  });

  return {
    status: "active",
    profiles,
    rankingMethod: "relative_influence_not_prediction",
    summary: `${profiles.length} canonical issue attribution profile(s) rank relative business influence without making absolute outcome predictions.`
  };
}

function buildDependencyIntelligenceLayer(
  canvas: UnifiedIssueCanvas,
  attributionLayer: BusinessOutcomeAttributionLayer
): DependencyIntelligenceLayer {
  if (canvas.canonicalIssues.length === 0) {
    return {
      status: "limited_evidence",
      issueRoles: [],
      dependencyMap: [],
      prerequisiteWarnings: [],
      summary: "Dependency intelligence is pending until canonical issues are available."
    };
  }

  const issueRoles = canvas.canonicalIssues.map((issue, index) => ({
    canonicalIssueId: issue.canonicalIssueId,
    role: dependencyRoleForIssue(issue, index),
    rationale: dependencyRationaleForIssue(issue)
  }));
  const dependencyMap: DependencyIntelligenceLayer["dependencyMap"] = [];
  for (const child of canvas.canonicalIssues) {
    const parent = canvas.canonicalIssues.find((candidate) => candidate.canonicalIssueId !== child.canonicalIssueId && isLikelyDependencyParent(candidate, child));
    if (!parent) continue;
    const profile = attributionLayer.profiles.find((item) => item.canonicalIssueId === parent.canonicalIssueId);
    dependencyMap.push({
      parentCanonicalIssueId: parent.canonicalIssueId,
      childCanonicalIssueId: child.canonicalIssueId,
      relationship: parent.primaryCategory === "technical_access" ? "prerequisite_for" : "can_reduce",
      confidenceScore: Math.min(parent.confidenceScore, child.confidenceScore, profile?.confidenceScore ?? 75),
      explanation: `${parent.canonicalIssueId} should be addressed before ${child.canonicalIssueId} because ${parent.primaryCausalDriver}`
    });
  }

  return {
    status: "active",
    issueRoles,
    dependencyMap,
    prerequisiteWarnings: dependencyMap.map((item) => `${item.parentCanonicalIssueId} is a prerequisite or reducer for ${item.childCanonicalIssueId}.`),
    summary: dependencyMap.length
      ? `${dependencyMap.length} issue dependency relationship(s) were identified to prevent downstream fixes from being sequenced ahead of root causes.`
      : "No strong cross-issue dependency was identified; recommendations can be sequenced by priority and attribution strength."
  };
}

function buildRecommendationSequencingEngine(
  recommendationEngine: RecommendationEngineOutput,
  canvas: UnifiedIssueCanvas,
  attributionLayer: BusinessOutcomeAttributionLayer,
  dependencyLayer: DependencyIntelligenceLayer
): RecommendationSequencingEngine {
  const items = recommendationEngine.recommendations
    .map((recommendation, index) => {
      const issue = canvas.canonicalIssues.find((item) => item.canonicalIssueId === recommendation.canonicalIssueId) ?? canvas.canonicalIssues[index];
      const attribution = issue ? attributionLayer.profiles.find((profile) => profile.canonicalIssueId === issue.canonicalIssueId) : undefined;
      const dependencyChain = issue ? dependencyChainForIssue(issue.canonicalIssueId, dependencyLayer) : [];
      const sequencePosition = index + 1 + dependencyChain.length;
      const bucket = bucketForSequenceItem(issue, attribution, dependencyChain, index);
      return {
        sequenceId: `SEQ-${String(index + 1).padStart(3, "0")}`,
        recommendationId: recommendation.recommendationId,
        canonicalIssueId: issue?.canonicalIssueId ?? recommendation.canonicalIssueId,
        action: recommendation.action,
        sequencePosition,
        bucket,
        rationale: sequenceRationale(recommendation, issue, attribution, dependencyChain),
        dependencyChain,
        attributionProfileId: attribution?.attributionProfileId ?? recommendation.attributionProfileId,
        confidenceScore: Math.min(recommendation.confidenceScore, attribution?.confidenceScore ?? recommendation.confidenceScore),
        lifecycleState: recommendation.lifecycleState ?? "Recommended"
      } satisfies RecommendationSequenceItem;
    })
    .sort((a, b) => a.sequencePosition - b.sequencePosition || b.confidenceScore - a.confidenceScore)
    .map((item, index) => ({ ...item, sequencePosition: index + 1 }));

  return {
    status: items.length > 0 ? "sequenced" : "limited",
    immediateActions: items.filter((item) => item.bucket === "Immediate Actions"),
    nearTermActions: items.filter((item) => item.bucket === "Near-Term Actions"),
    mediumTermActions: items.filter((item) => item.bucket === "Medium-Term Actions"),
    strategicActions: items.filter((item) => item.bucket === "Strategic Actions"),
    orderingRules: [
      "Prerequisite and root-cause actions are sequenced before dependent fixes.",
      "High attribution strength and high confidence move actions earlier.",
      "Low-impact visibility optimisations cannot outrank conversion, trust, or access constraints."
    ],
    summary: items.length > 0 ? `${items.length} recommendation(s) were ordered into an implementation sequence.` : "No recommendations were available for sequencing."
  };
}

function buildEvidenceFreshnessGovernanceLayer(evidenceObjects: EvidenceObject[], evaluatedAt: string): EvidenceFreshnessGovernanceLayer {
  const evaluatedTime = Date.parse(evaluatedAt);
  const evidenceFreshness = evidenceObjects.map((evidence) => {
    const freshness = evidence.freshness ?? fallbackEvidenceFreshness(evidence.timestamp ?? evaluatedAt);
    const acquiredTime = Date.parse(freshness.acquiredAt);
    const ageHours = Number.isFinite(acquiredTime) && Number.isFinite(evaluatedTime) ? Math.max(0, Math.round((evaluatedTime - acquiredTime) / 36_000) / 100) : 0;
    const status = freshnessStatusForAge(freshness, ageHours);
    return {
      evidenceId: evidence.evidenceId,
      category: evidenceFreshnessCategory(evidence),
      acquiredAt: freshness.acquiredAt,
      validatedAt: freshness.validatedAt,
      ageHours,
      sourceRecency: freshness.sourceRecency,
      expectedUpdateFrequency: freshness.updateFrequencyExpectation,
      freshnessStatus: status,
      confidenceAdjustment: status === "fresh" || status === "current" ? freshness.confidenceAdjustment : Math.min(-10, freshness.confidenceAdjustment - 5)
    };
  });
  const staleEvidenceIds = evidenceFreshness.filter((item) => item.freshnessStatus === "stale" || item.freshnessStatus === "expired" || item.freshnessStatus === "incomplete").map((item) => item.evidenceId);
  return {
    status: evidenceObjects.length > 0 ? "active" : "limited_evidence",
    evaluatedAt,
    evidenceFreshness,
    staleEvidenceIds,
    confidenceAdjustmentSummary: staleEvidenceIds.length
      ? `${staleEvidenceIds.length} evidence object(s) received freshness confidence downgrades.`
      : "All evaluated evidence is current for this scan."
  };
}

function buildClosedLoopOutcomeVerificationLayer(
  previousSnapshot: ReportSnapshot | null | undefined,
  sequencing: RecommendationSequencingEngine,
  outcomeValidation: OutcomeValidationEngine,
  attributionLayer: BusinessOutcomeAttributionLayer,
  canvas: UnifiedIssueCanvas
): ClosedLoopOutcomeVerificationLayer {
  const sequenceItems = [...sequencing.immediateActions, ...sequencing.nearTermActions, ...sequencing.mediumTermActions, ...sequencing.strategicActions].sort((a, b) => a.sequencePosition - b.sequencePosition);
  const multipleRecommendationsChanged = outcomeValidation.validations.filter((validation) => validation.implementedStatus === "validated").length > 1;
  const records: OutcomeVerificationRecord[] = sequenceItems.map((item, index) => {
    const validation = outcomeValidation.validations.find((entry) => entry.recommendationId === item.recommendationId);
    const issue = canvas.canonicalIssues.find((entry) => entry.canonicalIssueId === item.canonicalIssueId);
    const attribution = attributionLayer.profiles.find((profile) => profile.canonicalIssueId === item.canonicalIssueId);
    const deltas = validation?.dimensionDeltas ?? [];
    const materialDelta = Math.max(validation?.ossDelta ?? 0, ...deltas.map((delta) => delta.delta ?? 0));
    const implementationStatus = lifecycleFromValidation(validation, previousSnapshot);
    return {
      outcomeVerificationId: `OVR-${String(index + 1).padStart(3, "0")}`,
      recommendationId: item.recommendationId,
      canonicalIssueId: item.canonicalIssueId,
      implementationStatus,
      verificationStatus: !previousSnapshot ? "pending" : validation?.implementedStatus === "validated" || validation?.implementedStatus === "regressed" ? "verified" : "inconclusive",
      preImplementationState: !previousSnapshot ? "No previous snapshot baseline was available." : deltas.map((delta) => `${delta.dimensionLabel}: ${delta.beforeScore ?? "not measured"}`).join("; ") || "Previous state was available but not mapped to a dimension.",
      postImplementationState: deltas.map((delta) => `${delta.dimensionLabel}: ${delta.afterScore}`).join("; ") || "Post-implementation state has limited mapped evidence.",
      observedChange: observedChangeText(validation, materialDelta),
      confidenceOfVerification: Math.min(validation?.confidenceScore ?? 0, attribution?.confidenceScore ?? item.confidenceScore),
      supportingEvidenceObjectIds: Array.from(new Set([...(validation?.evidenceIds ?? []), ...(attribution?.supportingEvidenceObjectIds ?? [])])),
      outcomeClassification: outcomeClassificationForDelta(validation, materialDelta),
      attributionUncertainty: multipleRecommendationsChanged
        ? "Multiple recommendations changed in the same comparison window, so causation is not assigned to this recommendation alone."
        : "Verification remains evidence-bound and does not assume causation beyond observed mapped changes."
    };
  });

  const effectiveRecords = records.filter((record) => record.outcomeClassification.includes("Positive"));
  const status: ClosedLoopOutcomeVerificationLayer["status"] = !previousSnapshot ? "baseline_pending" : records.length === 0 ? "insufficient_evidence" : effectiveRecords.length > 0 ? "learning_active" : "verification_active";
  return {
    status,
    records,
    recommendationEffectivenessScores: buildRecommendationEffectivenessScores(records, canvas),
    outcomeIntelligenceRepository: {
      repositoryStatus: records.length >= 5 ? "learning_ready" : records.length > 0 ? "accumulating" : "baseline_only",
      anonymizedOutcomeCount: records.length,
      issueResolutionPatterns: buildIssueResolutionPatterns(records, canvas),
      confidenceCalibrationNotes: [
        "Outcome records are stored as internal learning signals, not customer-facing promises.",
        "Recommendation effectiveness scores require repeated verified outcomes before raising future confidence."
      ]
    },
    summary: !previousSnapshot
      ? "Baseline created. Re-scan after implementation to verify recommendation outcomes."
      : `${records.length} recommendation outcome verification record(s) were evaluated against the previous snapshot.`
  };
}

function buildBusinessObjectiveAlignmentValidation(
  request: ScanRequest,
  sequencing: RecommendationSequencingEngine
): BusinessObjectiveAlignmentValidation {
  const allItems = [...sequencing.immediateActions, ...sequencing.nearTermActions, ...sequencing.mediumTermActions, ...sequencing.strategicActions];
  const primaryBusinessObjective = inferPrimaryBusinessObjective(request);
  if (allItems.length === 0) {
    return {
      status: "not_assessed",
      primaryBusinessObjective,
      alignedRecommendationIds: [],
      misalignedRecommendationIds: [],
      validationNotes: ["No recommendations were available for objective alignment validation."]
    };
  }
  const aligned = allItems.filter((item) => objectiveAligned(item, primaryBusinessObjective));
  const misaligned = allItems.filter((item) => !objectiveAligned(item, primaryBusinessObjective));
  return {
    status: misaligned.length === 0 ? "aligned" : aligned.length > 0 ? "partially_aligned" : "not_assessed",
    primaryBusinessObjective,
    alignedRecommendationIds: aligned.map((item) => item.recommendationId),
    misalignedRecommendationIds: misaligned.map((item) => item.recommendationId),
    validationNotes: [
      "Objective alignment validates that recommendations support the business goal before internal prioritisation is finalized.",
      `${aligned.length} of ${allItems.length} sequenced recommendation(s) directly support the inferred objective.`
    ]
  };
}

function impactAreasForCanonicalIssue(issue: CanonicalIssue): BusinessOutcomeAttributionLayer["profiles"][number]["impactAreas"] {
  if (issue.primaryCategory === "conversion_blocker") return ["conversion_loss", "lead_generation_loss", "revenue_leakage"];
  if (issue.primaryCategory === "trust_failure") return ["trust_loss", "customer_confidence_loss", "customer_acquisition_loss"];
  if (issue.primaryCategory === "technical_access") return ["customer_acquisition_loss", "conversion_loss", "retention_risk"];
  if (issue.primaryCategory === "content_intent_gap") return ["customer_confidence_loss", "conversion_loss", "customer_acquisition_loss"];
  if (issue.primaryCategory === "visibility_gap") return ["visibility_loss", "customer_acquisition_loss"];
  return ["customer_confidence_loss"];
}

function attributionStrengthForIssue(issue: CanonicalIssue, index: number, confidenceScore: number): BusinessOutcomeAttributionLayer["profiles"][number]["attributionStrength"] {
  if (confidenceScore >= 78 && index <= 1) return "high";
  if (confidenceScore >= 62 && priorityOrder(issue.primaryCategory) <= 4) return "moderate";
  if (confidenceScore >= 45) return "low";
  return "limited";
}

function relativeInfluenceForIssue(index: number, issue: CanonicalIssue, confidenceScore: number): BusinessOutcomeAttributionLayer["profiles"][number]["relativeBusinessInfluence"] {
  if (index === 0 && confidenceScore >= 60) return "primary";
  if (priorityOrder(issue.primaryCategory) <= 2 && confidenceScore >= 60) return "strong";
  if (confidenceScore >= 50) return "moderate";
  if (confidenceScore > 0) return "supporting";
  return "unverified";
}

function attributionBehaviorExplanation(issue: CanonicalIssue): string {
  if (issue.primaryCategory === "conversion_blocker") return "This issue can interrupt the moment when an interested visitor tries to contact, book, buy, or request information.";
  if (issue.primaryCategory === "trust_failure") return "This issue can make visitors hesitate, compare alternatives, or delay sharing contact and purchase intent.";
  if (issue.primaryCategory === "technical_access") return "This issue can prevent customers or scan systems from reliably reaching, reading, or using the business website.";
  if (issue.primaryCategory === "content_intent_gap") return "This issue can leave customer questions unanswered during comparison and evaluation.";
  if (issue.primaryCategory === "visibility_gap") return "This issue can weaken discoverability and the way the business is understood in search or local contexts.";
  return "This issue has limited evidence and is retained for internal monitoring."
}

function dependencyRoleForIssue(issue: CanonicalIssue, index: number): DependencyIntelligenceLayer["issueRoles"][number]["role"] {
  if (index === 0 || issue.primaryCategory === "conversion_blocker" || issue.primaryCategory === "technical_access") return "Root Cause Issue";
  if (issue.primaryCategory === "trust_failure" || issue.primaryCategory === "content_intent_gap") return "Contributing Issue";
  if (issue.primaryCategory === "visibility_gap") return "Dependent Issue";
  return "Downstream Effect";
}

function dependencyRationaleForIssue(issue: CanonicalIssue): string {
  if (issue.primaryCategory === "technical_access") return "Access and structural health can block reliable analysis and downstream customer experience improvements.";
  if (issue.primaryCategory === "conversion_blocker") return "Conversion blockers directly constrain the business action path and should not wait behind optimisations.";
  if (issue.primaryCategory === "trust_failure") return "Trust gaps reinforce conversion hesitation and can reduce the value of visibility improvements.";
  return "This issue depends on higher-priority business constraints when those are present."
}

function isLikelyDependencyParent(parent: CanonicalIssue, child: CanonicalIssue): boolean {
  if (priorityOrder(parent.primaryCategory) >= priorityOrder(child.primaryCategory)) return false;
  if (parent.primaryCategory === "technical_access") return true;
  if (parent.primaryCategory === "conversion_blocker" && child.primaryCategory !== "technical_access") return true;
  if (parent.primaryCategory === "trust_failure" && (child.primaryCategory === "content_intent_gap" || child.primaryCategory === "visibility_gap")) return true;
  return false;
}

function dependencyChainForIssue(canonicalIssueId: string, dependencyLayer: DependencyIntelligenceLayer): string[] {
  const parents = dependencyLayer.dependencyMap.filter((item) => item.childCanonicalIssueId === canonicalIssueId).map((item) => item.parentCanonicalIssueId);
  return Array.from(new Set(parents));
}

function bucketForSequenceItem(
  issue: CanonicalIssue | undefined,
  attribution: OutcomeAttributionProfile | undefined,
  dependencyChain: string[],
  index: number
): RecommendationSequenceItem["bucket"] {
  if (dependencyChain.length > 0 && index > 0) return "Near-Term Actions";
  if (!issue) return "Strategic Actions";
  if (issue.primaryCategory === "conversion_blocker" || attribution?.relativeBusinessInfluence === "primary") return "Immediate Actions";
  if (issue.primaryCategory === "trust_failure" || issue.primaryCategory === "technical_access") return "Near-Term Actions";
  if (issue.primaryCategory === "content_intent_gap") return "Medium-Term Actions";
  return "Strategic Actions";
}

function sequenceRationale(
  recommendation: RecommendationEngineOutput["recommendations"][number],
  issue: CanonicalIssue | undefined,
  attribution: OutcomeAttributionProfile | undefined,
  dependencyChain: string[]
): string {
  const dependencyText = dependencyChain.length ? ` It follows prerequisite issue(s): ${dependencyChain.join(", ")}.` : " No prerequisite issue blocks this action.";
  const attributionText = attribution ? ` Attribution strength is ${attribution.attributionStrength} with ${attribution.relativeBusinessInfluence} relative influence.` : " Attribution profile is limited.";
  return `${recommendation.priority} action sequenced for ${issue?.canonicalIssueId ?? "unmapped issue"}.${dependencyText}${attributionText}`;
}

function fallbackEvidenceFreshness(timestamp: string): EvidenceObject["freshness"] {
  return {
    acquiredAt: timestamp,
    validatedAt: timestamp,
    sourceRecency: "unknown",
    updateFrequencyExpectation: "unknown",
    freshnessStatus: "incomplete",
    confidenceAdjustment: -8
  };
}

function freshnessStatusForAge(freshness: EvidenceObject["freshness"], ageHours: number): EvidenceObject["freshness"]["freshnessStatus"] {
  if (freshness.freshnessStatus === "incomplete" || freshness.sourceRecency === "unknown") return "incomplete";
  if (freshness.updateFrequencyExpectation === "per_scan" && ageHours <= 24) return "fresh";
  if (ageHours <= 24 * 7) return "current";
  if (ageHours <= 24 * 30) return "aging";
  if (ageHours <= 24 * 90) return "stale";
  return "expired";
}

function evidenceFreshnessCategory(evidence: EvidenceObject): string {
  const signalKey = String(evidence.normalizedInput?.["signalKey"] ?? "").toLowerCase();
  if (signalKey.includes("competitor")) return "competitor_intelligence_freshness";
  if (signalKey.includes("citation")) return "citation_freshness";
  if (signalKey.includes("review") || signalKey.includes("trust")) return "trust_signal_freshness";
  if (signalKey.includes("local") || signalKey.includes("gbp")) return "business_profile_freshness";
  if (signalKey.includes("serp") || signalKey.includes("search")) return "search_environment_freshness";
  if (signalKey.includes("freshness")) return "content_freshness";
  return "current_scan_evidence_freshness";
}

function lifecycleFromValidation(
  validation: OutcomeValidationEngine["validations"][number] | undefined,
  previousSnapshot: ReportSnapshot | null | undefined
): RecommendationLifecycleState {
  if (!previousSnapshot) return "Recommended";
  if (!validation) return "Outcome Inconclusive";
  if (validation.implementedStatus === "validated" && validation.improvementStatus === "improved") return "Verified Effective";
  if (validation.implementedStatus === "regressed" || validation.improvementStatus === "declined") return "Verified Ineffective";
  if (validation.implementedStatus === "not_detected") return "Not Implemented";
  if (validation.implementedStatus === "detected") return "Implemented";
  return "Outcome Inconclusive";
}

function observedChangeText(validation: OutcomeValidationEngine["validations"][number] | undefined, materialDelta: number): string {
  if (!validation) return "No validation record was available for this recommendation.";
  if (validation.ossDelta === null && validation.dimensionDeltas.every((item) => item.delta === null)) return "No before/after baseline was available.";
  return `OSS delta ${validation.ossDelta ?? "not available"}; strongest mapped dimension delta ${materialDelta}.`;
}

function outcomeClassificationForDelta(
  validation: OutcomeValidationEngine["validations"][number] | undefined,
  materialDelta: number
): OutcomeVerificationRecord["outcomeClassification"] {
  if (!validation || validation.implementedStatus === "pending_baseline") return "Insufficient Evidence";
  if (validation.improvementStatus === "declined" || materialDelta <= -3) return "Negative Outcome";
  if (validation.improvementStatus === "unchanged") return "No Observable Change";
  if (materialDelta >= 12) return "Strong Positive Outcome";
  if (materialDelta >= 6) return "Moderate Positive Outcome";
  if (materialDelta >= 3) return "Weak Positive Outcome";
  return "Mixed Outcome";
}

function buildRecommendationEffectivenessScores(
  records: OutcomeVerificationRecord[],
  canvas: UnifiedIssueCanvas
): ClosedLoopOutcomeVerificationLayer["recommendationEffectivenessScores"] {
  return canvas.canonicalIssues.map((issue) => {
    const linked = records.filter((record) => record.canonicalIssueId === issue.canonicalIssueId);
    const positive = linked.filter((record) => record.outcomeClassification.includes("Positive")).length;
    const effectivenessScore = linked.length === 0 ? 0 : clampScore((positive / linked.length) * 100);
    return {
      issueType: issue.issueType,
      recommendationPattern: issue.authoritativeAction,
      verifiedOutcomeCount: linked.length,
      effectivenessScore,
      confidenceScore: linked.length >= 3 ? 70 : linked.length > 0 ? 42 : 0
    };
  });
}

function buildIssueResolutionPatterns(records: OutcomeVerificationRecord[], canvas: UnifiedIssueCanvas): string[] {
  const positiveIssueIds = new Set(records.filter((record) => record.outcomeClassification.includes("Positive")).map((record) => record.canonicalIssueId).filter(Boolean));
  const patterns = canvas.canonicalIssues.filter((issue) => positiveIssueIds.has(issue.canonicalIssueId)).map((issue) => `${issue.issueType}: ${issue.authoritativeAction}`);
  return patterns.length ? patterns : ["More verified follow-up scans are required before stable resolution patterns are learned."];
}

function inferPrimaryBusinessObjective(request: ScanRequest): string {
  if (request.monthlyLeadVolume && request.monthlyLeadVolume > 0) return "Improve lead generation and customer conversion readiness";
  if (request.industryType?.toLowerCase().includes("ecommerce")) return "Improve purchase confidence and revenue readiness";
  if (request.industryType?.toLowerCase().includes("local")) return "Improve local customer acquisition and trust";
  return "Improve customer trust, understanding, and action readiness";
}

function objectiveAligned(item: RecommendationSequenceItem, objective: string): boolean {
  const haystack = `${item.action} ${item.rationale} ${item.bucket}`.toLowerCase();
  if (objective.includes("lead")) return /lead|contact|call|form|cta|conversion|trust|confidence|action/.test(haystack);
  if (objective.includes("purchase")) return /purchase|checkout|product|trust|confidence|conversion|action/.test(haystack);
  if (objective.includes("local")) return /local|location|contact|trust|visibility|service area|action/.test(haystack);
  return /trust|confidence|clarity|action|conversion|customer/.test(haystack);
}
function normalizeActionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shorterAction(left: string, right: string): string {
  return left.length <= right.length ? left : right;
}

function intersects(left: string[], right: string[]): boolean {
  const values = new Set(left);
  return right.some((item) => values.has(item));
}
function buildExecutiveClarity(dimensions: DimensionScore[], oss: number, decisions: DecisionOutput[]): ReportSnapshot["executiveClarity"] {
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const topDecision = decisions[0];
  return {
    overallWebsiteStatus: oss < 60 ? "Structural Conversion Friction Detected" : "Structural improvement potential detected",
    primaryConversionBlocker: weakest ? `${weakest.label} signals show ${weakest.classification.toLowerCase()} structural readiness` : "No validated blocker detected",
    primaryOpportunity: "Structural improvement potential detected",
    estimatedImpactRange: "Opportunity range is structural-only and does not represent actual revenue or user behavior.",
    recommendedFirstAction: topDecision?.recommendedActionPath ?? "Review sampled evidence before selecting the first structural change."
  };
}

function buildVerdictCard(oss: number, decisions: DecisionOutput[], monthlyLeadVolume?: number): ReportSnapshot["verdictCard"] {
  const risk =
    oss < 40 ? "Critical Structural Risk" : oss < 60 ? "High Structural Risk" : oss < 75 ? "Medium Structural Risk" : "Low Structural Risk";
  const topDecision = decisions[0];
  const opportunity = monthlyLeadVolume
    ? `${monthlyLeadVolume} monthly leads provided; structural opportunity should be validated after fixes.`
    : "Structural improvement potential detected; no actual revenue or lead data was used.";

  return {
    revenueStatus: oss < 60 ? "Structural Conversion Friction Detected" : "Conversion Opportunity Identified",
    oss,
    businessRiskStatus: risk,
    topIssue: topDecision?.decisionClassification ?? "No high-priority issue detected",
    recoverableOpportunity: opportunity,
    highestLeverageAction: topDecision?.recommendedActionPath ?? "Monitor structural signals through periodic rescans."
  };
}

function buildBusinessRiskStatus(oss: number, dimensions: DimensionScore[], decisions: DecisionOutput[]): BusinessRiskStatus {
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const topDecision = decisions[0];
  const level: BusinessRiskStatus["level"] =
    oss < 40 ? "Critical Structural Risk" : oss < 60 ? "High Structural Risk" : oss < 75 ? "Medium Structural Risk" : "Low Structural Risk";

  return {
    classification:
      level === "Critical Structural Risk" ? "CRITICAL" : level === "High Structural Risk" ? "HIGH" : level === "Medium Structural Risk" ? "MEDIUM" : "LOW",
    level,
    primaryRiskDriver: weakest
      ? `${weakest.label} is the lowest validated structural dimension at ${weakest.score}.`
      : "No validated structural risk driver was detected.",
    explanation:
      "Business Risk Status translates observable website structure into a risk signal. It does not measure actual revenue, sales, profitability, or customer behavior.",
    evidenceIds: topDecision?.evidenceTraceReferences ?? weakest?.evidenceIds ?? []
  };
}

function buildContentUnavailableExecutiveClarity(): ReportSnapshot["executiveClarity"] {
  return {
    overallWebsiteStatus: "Content Unavailable",
    primaryConversionBlocker: "Website content could not be collected.",
    primaryOpportunity: "Review access/security/robots settings and re-run scan.",
    estimatedImpactRange: "Not estimated because website content was unavailable.",
    recommendedFirstAction: "Review access/security/robots settings and re-run scan."
  };
}

function buildContentUnavailableVerdictCard(): ReportSnapshot["verdictCard"] {
  return {
    revenueStatus: "Content Unavailable",
    oss: null,
    businessRiskStatus: "Not Assessed",
    topIssue: "Website content could not be collected",
    recoverableOpportunity: "Not estimated because evidence coverage is 0%.",
    highestLeverageAction: "Review access/security/robots settings and re-run scan."
  };
}

function buildContentUnavailableBusinessRiskStatus(): BusinessRiskStatus {
  return {
    classification: "UNKNOWN",
    level: "Not Assessed",
    primaryRiskDriver: "Website content could not be collected.",
    explanation: "Risk was not scored because no page content was available for validated structural analysis.",
    evidenceIds: []
  };
}

function buildContentUnavailableSystemVerdict(): ReportSnapshot["systemVerdict"] {
  return {
    layer: "decision",
    line: "Content unavailable. Website content could not be collected, so no structural score was assigned.",
    primaryIssue: "Website content could not be collected",
    businessConsequence: "Evidence coverage is 0%, so SYSTOLAB cannot validate website structure from this scan.",
    evidenceIds: []
  };
}

function buildContentUnavailableOssInterpretation(): OssInterpretation {
  return {
    layer: "decision",
    score: null,
    strictClassification: "not_scored",
    label: "Not Scored",
    range: "N/A",
    oneLineDiagnosis: "Website content could not be collected, so OSS was not scored.",
    meaning: "No structural conclusion was generated because validated page evidence was unavailable.",
    visualState: NOT_SCORED_VISUAL_STATE
  };
}

function buildContentUnavailableConfidenceLayer(): ConfidenceMetric[] {
  return [{
    intelligenceArea: "Evidence Coverage",
    confidenceScore: 0,
    confidenceLevel: "Limited",
    basis: "Very Limited: website content could not be collected, so structural scoring was not performed."
  }];
}

interface DecisionBriefInput {
  contentUnavailable: boolean;
  oss: number | null;
  dimensions: DimensionScore[];
  evidenceObjects: EvidenceObject[];
  evidenceCoverageSummary: EvidenceCoverageSummary;
  scanCoverage: ScanCoverage;
  confidenceLayer: ConfidenceMetric[];
  confidenceEngine: ConfidenceEngineOutput;
  businessRiskStatus: BusinessRiskStatus;
  systemVerdict: ReportSnapshot["systemVerdict"];
  actionFirstPanel: ActionFirstPanel;
  revenueIntelligence: RevenueIntelligenceLayer;
  recommendationEngine: RecommendationEngineOutput;
  marketReadinessPosition: MarketReadinessPosition;
  benchmarkContext: BenchmarkContext;
  competitorComparison: ComparativeFinding[];
}

function buildDecisionIntelligenceBrief(input: DecisionBriefInput): ReportSnapshot["decisionIntelligenceBrief"] {
  const evidenceCount = input.evidenceCoverageSummary.totalEvidenceObjects;
  const sampledPages = input.evidenceCoverageSummary.totalPagesSampled;
  const hasValidatedPageEvidence = !input.contentUnavailable && typeof input.oss === "number" && sampledPages > 0 && evidenceCount > 0;

  if (!hasValidatedPageEvidence) {
    return buildContentUnavailableDecisionBrief(input);
  }

  const score = input.oss ?? 0;
  const weakest = [...input.dimensions].sort((a, b) => a.score - b.score)[0];
  const strongest = [...input.dimensions].sort((a, b) => b.score - a.score).slice(0, 3);
  const firstAction = input.recommendationEngine.recommendations[0]?.action ?? input.actionFirstPanel.items[0]?.executableFix ?? input.actionFirstPanel.fallbackAction;
  const timeSensitivity = executiveTimeSensitivityForScore(score);
  const benchmarkStatus = aggregateBenchmarkStatus(input.marketReadinessPosition);
  const competitorStatus = aggregateCompetitorStatus(input.competitorComparison);
  const assessmentConfidenceScore = input.confidenceEngine.overallConfidenceScore || averageConfidence(input.confidenceLayer);
  const coverageReliabilityScore = coverageReliabilityScoreFor(sampledPages, evidenceCount);
  const overallReliabilityScore = Math.min(assessmentConfidenceScore, coverageReliabilityScore);

  return {
    executiveVerdict: {
      currentSituation: `The website is scored at OSS ${score}/100 with ${input.businessRiskStatus.level.toLowerCase()}.`,
      seriousness: input.businessRiskStatus.explanation,
      firstAction,
      urgency: timeSensitivity,
      likelyBusinessImpact: buildEvidenceBoundBusinessImpact(input.revenueIntelligence, evidenceCount),
      evidenceBasis: `${sampledPages} sampled page${sampledPages === 1 ? "" : "s"} and ${evidenceCount} validated evidence object${evidenceCount === 1 ? "" : "s"} support this brief.`
    },
    executiveActionBanner: {
      classification: executiveClassificationForScore(score),
      message: buildExecutiveBannerMessage(score, input.businessRiskStatus, weakest),
      urgency: timeSensitivity
    },
    executiveDecisionMatrix: {
      executiveDecisionScore: score,
      riskLevel: executiveRiskLevel(input.businessRiskStatus.classification),
      executivePriority: executivePriorityForScore(score),
      timeSensitivity,
      competitivePosition: benchmarkStatus,
      primaryBusinessConstraint: weakest
        ? `${weakest.label} is the lowest validated dimension at ${weakest.score}/100.`
        : input.systemVerdict.primaryIssue,
      potentialBusinessImpact: buildEvidenceBoundBusinessImpact(input.revenueIntelligence, evidenceCount),
      ifNotAddressedOutcome: input.systemVerdict.businessConsequence,
      recommendedNextAction: firstAction
    },
    actionPlan: buildExecutiveActionPlan(input, weakest),
    whyThisMatters: {
      overallCondition: `The assessment is based on current observable website structure and produced OSS ${score}/100.`,
      strongestValidatedDimensions: strongest.map((dimension) => `${dimension.label} (${dimension.score}/100)`),
      weakestValidatedDimension: weakest ? `${weakest.label} (${weakest.score}/100)` : "No weak dimension was validated.",
      businessSignificance: input.systemVerdict.businessConsequence
    },
    competitivePositionAnalysis: {
      summary: buildCompetitiveSummary(benchmarkStatus, competitorStatus, input),
      benchmarkStatus,
      competitorStatus,
      dimensionPositions: input.marketReadinessPosition.positions.map((position) => ({
        dimension: position.dimension,
        dimensionLabel: position.dimensionLabel,
        position: position.position,
        confidenceScore: input.marketReadinessPosition.comparativeConfidenceScore,
        evidenceIds: position.evidenceIds
      }))
    },
    executiveReliabilityPanel: {
      evidenceCoverage: `${sampledPages} sampled page${sampledPages === 1 ? "" : "s"}, ${evidenceCount} validated evidence object${evidenceCount === 1 ? "" : "s"}.`,
      crawlCoverage: input.scanCoverage.coverageLabel,
      assessmentConfidence: `${assessmentConfidenceScore}% (${confidenceLevelForScore(assessmentConfidenceScore)})`,
      benchmarkConfidence: buildBenchmarkConfidenceLabel(input.benchmarkContext),
      assessmentTrustSignals: buildTrustSignalLabel(input.evidenceObjects),
      overallReportReliability: confidenceLevelForScore(overallReliabilityScore),
      limitations: buildExecutiveReliabilityLimitations(input)
    }
  };
}

function buildContentUnavailableDecisionBrief(input: DecisionBriefInput): ReportSnapshot["decisionIntelligenceBrief"] {
  return {
    executiveVerdict: {
      currentSituation: "Website content could not be collected, so the current situation cannot be scored from validated page evidence.",
      seriousness: "No structural risk level or revenue impact was inferred because evidence coverage is 0%.",
      firstAction: "Review website access, security, and robots settings before re-running the assessment.",
      urgency: "Not Applicable",
      likelyBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      evidenceBasis: "0 sampled pages and 0 validated page evidence objects were available."
    },
    executiveActionBanner: {
      classification: "Unable to Assess",
      message: "Content was unavailable, so SYSTOLAB did not assign OSS, risk, competitor position, or revenue impact.",
      urgency: "Not Applicable"
    },
    executiveDecisionMatrix: {
      executiveDecisionScore: null,
      riskLevel: "Unable to Assess",
      executivePriority: "Not Applicable",
      timeSensitivity: "Not Applicable",
      competitivePosition: "Benchmark Data Unavailable",
      primaryBusinessConstraint: "Website content could not be collected.",
      potentialBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      ifNotAddressedOutcome: "No outcome projection was generated because page evidence was unavailable.",
      recommendedNextAction: "Review access/security/robots settings and re-run scan."
    },
    actionPlan: [
      {
        priority: "Priority 1",
        action: "Review website access and security settings.",
        rationale: "The assessment could not collect page content, so access must be reviewed before conclusions can be generated.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      },
      {
        priority: "Priority 2",
        action: "Allow analysis access to public website content.",
        rationale: "Validated page content is required before OSS, recommendations, and benchmark position can be assessed.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      },
      {
        priority: "Priority 3",
        action: "Re-run the assessment after access is resolved.",
        rationale: "A new assessment is required to create validated evidence and score the website.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      }
    ],
    whyThisMatters: {
      overallCondition: "The report is limited to an access outcome, not a structural diagnosis.",
      strongestValidatedDimensions: [],
      weakestValidatedDimension: "Not assessed because website content was unavailable.",
      businessSignificance: "Business impact was not inferred because no current-scan page evidence was available."
    },
    competitivePositionAnalysis: {
      summary: "Benchmark and competitor position were not assessed because website content could not be collected.",
      benchmarkStatus: "Benchmark Data Unavailable",
      competitorStatus: "Competitor Data Unavailable",
      dimensionPositions: []
    },
    executiveReliabilityPanel: {
      evidenceCoverage: "0 sampled pages, 0 validated page evidence objects.",
      crawlCoverage: input.scanCoverage.coverageLabel,
      assessmentConfidence: "0% (Limited)",
      benchmarkConfidence: "Not available",
      assessmentTrustSignals: "Not assessed because website content could not be collected.",
      overallReportReliability: "Limited",
      limitations: [
        "Website content could not be collected.",
        "OSS, business risk, revenue impact, and competitor position were not scored.",
        "Re-run the assessment after access is resolved."
      ]
    }
  };
}

function executiveClassificationForScore(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveActionBanner"]["classification"] {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Healthy but Optimize";
  if (score >= 50) return "Action Recommended";
  if (score >= 25) return "High Risk";
  return "Critical Attention Required";
}

function executivePriorityForScore(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["executivePriority"] {
  if (score >= 90) return "Monitor";
  if (score >= 75) return "Optimize";
  if (score >= 50) return "Improve";
  if (score >= 25) return "Act";
  return "Escalate";
}

function executiveTimeSensitivityForScore(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["timeSensitivity"] {
  if (score >= 90) return "Monitor (Ongoing)";
  if (score >= 75) return "Short-Term (1-4 weeks)";
  if (score >= 50) return "This Month (7-30 days)";
  return "Immediate (0-7 days)";
}

function executiveRiskLevel(classification: BusinessRiskStatus["classification"]): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["riskLevel"] {
  if (classification === "LOW") return "Low Risk";
  if (classification === "MEDIUM") return "Medium Risk";
  if (classification === "HIGH") return "High Risk";
  if (classification === "CRITICAL") return "Critical Risk";
  return "Unable to Assess";
}

function buildExecutiveBannerMessage(score: number, risk: BusinessRiskStatus, weakest: DimensionScore | undefined): string {
  if (score >= 90) return "The observable structure is strong. Continue monitoring and validate improvements through future rescans.";
  if (score >= 75) return `The site is structurally healthy, with the main optimization focus on ${weakest?.label ?? "the lowest validated dimension"}.`;
  if (score >= 50) return `${risk.level} is present. Prioritize the lowest validated structural friction before deeper optimization.`;
  return `${risk.level} is present. Address the first validated structural constraint before interpreting growth potential.`;
}

function buildEvidenceBoundBusinessImpact(revenue: RevenueIntelligenceLayer, evidenceCount: number): string {
  if (evidenceCount <= 0 || revenue.status !== "estimated") {
    return "Unable to calculate from validated current-scan evidence.";
  }

  const range = revenue.revenueOpportunityRange;
  const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  return `${range.label}: ${formatter.format(range.low)}-${formatter.format(range.high)} ${range.unit.replaceAll("_", " ")}. This is a structural opportunity estimate, not actual revenue.`;
}

function buildExecutiveActionPlan(input: DecisionBriefInput, weakest: DimensionScore | undefined): ReportSnapshot["decisionIntelligenceBrief"]["actionPlan"] {
  const actions: ReportSnapshot["decisionIntelligenceBrief"]["actionPlan"] = [];
  const seen = new Set<string>();

  const pushAction = (
    action: string,
    rationale: string,
    confidenceScore: number,
    evidenceIds: string[]
  ) => {
    const cleanAction = action.trim();
    if (!cleanAction || seen.has(cleanAction.toLowerCase()) || actions.length >= 3) return;
    seen.add(cleanAction.toLowerCase());
    actions.push({
      priority: `Priority ${actions.length + 1}` as "Priority 1" | "Priority 2" | "Priority 3",
      action: cleanAction,
      rationale,
      confidenceScore: clampScore(confidenceScore),
      confidenceLevel: confidenceLevelForScore(confidenceScore),
      evidenceIds
    });
  };

  for (const recommendation of input.recommendationEngine.recommendations) {
    pushAction(
      recommendation.action,
      `${recommendation.issue}. ${recommendation.revenueIntelligenceMapping}`,
      recommendation.confidenceScore,
      recommendation.evidenceIds
    );
  }

  for (const item of input.actionFirstPanel.items) {
    pushAction(item.executableFix, item.businessReason, weakest?.confidenceScore ?? 70, item.evidenceIds);
  }

  if (weakest) {
    pushAction(
      `Resolve the weakest validated dimension: ${weakest.label}.`,
      `${weakest.label} is currently the lowest validated dimension at ${weakest.score}/100.`,
      weakest.confidenceScore,
      weakest.evidenceIds
    );
  }

  pushAction(
    "Re-run the assessment after priority fixes are implemented.",
    "A follow-up scan is required to validate whether the recommended changes improved observable structure.",
    Math.min(input.confidenceEngine.overallConfidenceScore || 70, 80),
    []
  );

  pushAction(
    "Review only validated report findings before selecting additional work.",
    "This keeps execution bounded to evidence collected during the current assessment.",
    input.confidenceEngine.overallConfidenceScore || 70,
    []
  );

  pushAction(
    "Prioritize fixes with explicit evidence support.",
    "Evidence-supported changes are required before SYSTOLAB can validate improvement in a later assessment.",
    input.confidenceEngine.overallConfidenceScore || 70,
    []
  );

  return actions;
}

function aggregateBenchmarkStatus(market: MarketReadinessPosition): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["competitivePosition"] {
  if (market.status !== "available" || market.comparativeConfidenceScore <= 0) return "Benchmark Data Unavailable";
  const assessed = market.positions.filter((position) => position.position !== "Not Assessed");
  if (assessed.length === 0) return "Benchmark Data Unavailable";
  const above = assessed.filter((position) => position.position === "Above Benchmark").length;
  const below = assessed.filter((position) => position.position === "Below Benchmark").length;
  if (above > below) return "Above Benchmark";
  if (below > above) return "Below Benchmark";
  return "At Benchmark";
}

function aggregateCompetitorStatus(comparisons: ComparativeFinding[]): ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["competitorStatus"] {
  const assessed = comparisons.filter((comparison) => comparison.status === "assessed" && typeof comparison.competitorOss === "number");
  if (assessed.length === 0) return "Competitor Data Unavailable";
  const ahead = assessed.filter((comparison) => comparison.primaryOss >= (comparison.competitorOss ?? 0) + 3).length;
  const behind = assessed.filter((comparison) => (comparison.competitorOss ?? 0) >= comparison.primaryOss + 3).length;
  if (ahead > 0 && behind === 0) return "Ahead of Compared Competitors";
  if (behind > 0 && ahead === 0) return "Behind Compared Competitors";
  return "Mixed Position";
}

function buildCompetitiveSummary(
  benchmarkStatus: ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["benchmarkStatus"],
  competitorStatus: ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["competitorStatus"],
  input: DecisionBriefInput
): string {
  const benchmarkText =
    benchmarkStatus === "Benchmark Data Unavailable"
      ? "Benchmark comparison is unavailable from the current evidence."
      : `The site is ${benchmarkStatus.toLowerCase()} based on available benchmark dimensions.`;
  const competitorText =
    competitorStatus === "Competitor Data Unavailable"
      ? "No competitor conclusion was generated because competitor evidence was unavailable or not assessed."
      : `Compared competitor status: ${competitorStatus.toLowerCase()}.`;
  const dimensionCount = input.marketReadinessPosition.positions.filter((position) => position.position !== "Not Assessed").length;
  return `${benchmarkText} ${competitorText} ${dimensionCount} benchmark dimension${dimensionCount === 1 ? "" : "s"} had comparable evidence.`;
}

function buildBenchmarkConfidenceLabel(benchmark: BenchmarkContext): string {
  if (benchmark.status === "not_available" || benchmark.comparativeConfidenceScore <= 0) return "Not available";
  return `${benchmark.comparativeConfidenceScore}% (${benchmark.status.replaceAll("_", " ")})`;
}

function buildTrustSignalLabel(evidenceObjects: EvidenceObject[]): string {
  const trustEvidence = evidenceObjects.filter((evidence) => evidence.dimensionRefs.includes("trust"));
  if (trustEvidence.length === 0) return "No trust evidence objects were validated in this scan.";
  return `${trustEvidence.length} trust evidence object${trustEvidence.length === 1 ? "" : "s"} validated.`;
}

function buildExecutiveReliabilityLimitations(input: DecisionBriefInput): string[] {
  const limitations: string[] = [];
  if (input.benchmarkContext.status !== "available") {
    limitations.push("Benchmark confidence is limited by available comparison coverage.");
  }
  if (input.competitorComparison.filter((comparison) => comparison.status === "assessed").length === 0) {
    limitations.push("Competitor position is unavailable because no competitor comparison completed with validated evidence.");
  }
  if (input.revenueIntelligence.status !== "estimated") {
    limitations.push("Revenue impact is not calculated when current evidence is input-limited.");
  }
  if (input.evidenceCoverageSummary.totalPagesSampled < 2) {
    limitations.push("Coverage is based on a small page sample.");
  }
  return limitations.length > 0 ? limitations : ["No additional reliability limitation was detected beyond standard evidence-bound interpretation."];
}

function averageConfidence(confidenceLayer: ConfidenceMetric[]): number {
  if (confidenceLayer.length === 0) return 0;
  return clampScore(confidenceLayer.reduce((sum, item) => sum + item.confidenceScore, 0) / confidenceLayer.length);
}

function coverageReliabilityScoreFor(sampledPages: number, evidenceCount: number): number {
  if (sampledPages <= 0 || evidenceCount <= 0) return 0;
  if (sampledPages >= 3 && evidenceCount >= 20) return 90;
  if (sampledPages >= 2 && evidenceCount >= 10) return 80;
  if (sampledPages >= 1 && evidenceCount >= 5) return 70;
  return 55;
}

function buildActionFirstPanel(
  status: ReportSnapshot["status"],
  dimensions: DimensionScore[],
  evidenceObjects: EvidenceObject[],
  evidenceClusters: EvidenceCluster[]
): ActionFirstPanel {
  if (status !== "completed") {
    return {
      layer: "decision",
      status: "analysis_limited",
      items: [],
      fallbackAction: "Resolve crawl or robots limitations first, then re-run the scan to generate executable fixes."
    };
  }

  const actions: ActionFirstPanel["items"] = [];
  const h1Failures = missingEvidenceForSignal(evidenceObjects, "h1_present");
  const homepageH1Failures = h1Failures.filter((evidence) => evidence.pageRole === "homepage");
  if (h1Failures.length > 0 && (homepageH1Failures.length > 0 || !signalObserved(evidenceObjects, "h1_present"))) {
    actions.push({
      actionId: "AFP-001",
      issue: "Missing H1 heading",
      executableFix: "Add one descriptive H1 on the homepage that states the business offer or primary page purpose.",
      businessReason: "Visitors and crawlers need a clear first message before evaluating the offer.",
      effortLevel: "low",
      expectedDirectionalImpact: {
        informationClarity: "+8-14% clarity improvement",
        conversionReadiness: "+4-7% conversion readiness",
        trustStrength: "+2-4% trust support"
      },
      evidenceIds: h1Failures.map((evidence) => evidence.evidenceId),
      evidenceClusterId: clusterForDimension(evidenceClusters, "visibilityStructure")
    });
  }

  const ctaAboveFoldEvidence = evidenceForSignal(evidenceObjects, "primary_cta_above_fold");
  if (ctaAboveFoldEvidence.length > 0 && !signalObserved(evidenceObjects, "primary_cta_above_fold")) {
    actions.push({
      actionId: "AFP-002",
      issue: "Missing primary CTA above fold",
      executableFix: "Place one primary action button or contact path in the first visible decision area of the homepage.",
      businessReason: "A visible action path reduces uncertainty when a visitor is ready to contact, book, or request information.",
      effortLevel: "medium",
      expectedDirectionalImpact: {
        informationClarity: "+6-10% clarity improvement",
        conversionReadiness: "+12-18% conversion readiness",
        trustStrength: "+3-6% trust support"
      },
      evidenceIds: ctaAboveFoldEvidence.map((evidence) => evidence.evidenceId),
      evidenceClusterId: clusterForDimension(evidenceClusters, "conversionReadiness")
    });
  }

  const trustSignals = [
    { key: "privacy_link_present", label: "privacy" },
    { key: "about_link_present", label: "about" },
    { key: "contact_signal_present", label: "contact" }
  ];
  const missingTrustSignals = trustSignals.filter((signal) => !signalObserved(evidenceObjects, signal.key));
  if (missingTrustSignals.length > 0) {
    const trustEvidence = trustSignals.flatMap((signal) => evidenceForSignal(evidenceObjects, signal.key));
    actions.push({
      actionId: "AFP-003",
      issue: `Missing trust signals: ${missingTrustSignals.map((signal) => signal.label).join(", ")}`,
      executableFix: "Expose privacy, about/company, and contact identity signals in navigation, footer, or the primary conversion area.",
      businessReason: "Trust context helps visitors verify legitimacy before sharing details or taking a commercial action.",
      effortLevel: missingTrustSignals.length >= 2 ? "medium" : "low",
      expectedDirectionalImpact: {
        informationClarity: "+3-6% clarity improvement",
        conversionReadiness: "+5-9% conversion readiness",
        trustStrength: "+8-14% trust improvement"
      },
      evidenceIds: trustEvidence.map((evidence) => evidence.evidenceId),
      evidenceClusterId: clusterForDimension(evidenceClusters, "trust")
    });
  }

  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  return {
    layer: "decision",
    status: actions.length > 0 ? "actions_required" : "no_immediate_structural_fix_detected",
    items: actions,
    fallbackAction:
      actions.length > 0
        ? "Apply the listed fixes in order, then re-scan to generate closed-loop proof deltas."
        : weakest
          ? `No mandatory action-first blocker was detected. Monitor ${weakest.label} because it is the lowest validated dimension.`
          : "No mandatory action-first blocker was detected in the sampled evidence."
  };
}

function buildSystemVerdict(
  oss: number,
  dimensions: DimensionScore[],
  actionFirstPanel: ActionFirstPanel,
  risk: BusinessRiskStatus
): ReportSnapshot["systemVerdict"] {
  const primaryAction = actionFirstPanel.items[0];
  if (primaryAction) {
    return {
      layer: "decision",
      line: `${primaryAction.issue} is the primary structural break, and it matters because ${primaryAction.businessReason.toLowerCase()}`,
      primaryIssue: primaryAction.issue,
      businessConsequence: primaryAction.businessReason,
      evidenceIds: primaryAction.evidenceIds
    };
  }

  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const issue = weakest ? `${weakest.label} at ${weakest.score}/100` : "Limited observable structure";
  return {
    layer: "decision",
    line: `${issue} is the main validated condition, and it matters because the site is currently classified as ${risk.classification} risk with OSS ${oss}/100.`,
    primaryIssue: issue,
    businessConsequence: risk.primaryRiskDriver,
    evidenceIds: risk.evidenceIds
  };
}

function buildOssInterpretation(
  oss: number,
  visualState: ReportSnapshot["oss"]["visualState"],
  dimensions: DimensionScore[],
  actionFirstPanel: ActionFirstPanel
): OssInterpretation {
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  if (oss < 40) {
    return {
      layer: "decision",
      score: oss,
      strictClassification: "critical_structural_failure",
      label: "Critical Structural Failure",
      range: "0-39",
      oneLineDiagnosis: `${weakest?.label ?? "Core structure"} is severely limiting visible trust, clarity, or action readiness.`,
      meaning: "Critical structural failure means multiple observable website foundations are missing or unreliable.",
      visualState
    };
  }
  if (oss < 75) {
    return {
      layer: "decision",
      score: oss,
      strictClassification: "structural_friction",
      label: "Structural Friction",
      range: "40-74",
      oneLineDiagnosis: actionFirstPanel.items[0]?.issue
        ? `${actionFirstPanel.items[0].issue} is the first fix to reduce structural friction.`
        : `${weakest?.label ?? "Website structure"} shows friction that should be prioritized.`,
      meaning: "Structural friction means the website is usable but contains observable clarity, trust, or conversion obstacles.",
      visualState
    };
  }
  return {
    layer: "decision",
    score: oss,
    strictClassification: "minor_optimization_opportunities",
    label: "Minor Optimization Opportunities",
    range: "75-100",
    oneLineDiagnosis: `${weakest?.label ?? "The website"} has the most room for focused optimization.`,
    meaning: "Minor optimization opportunities means core structure is stable and the report should guide targeted improvements.",
    visualState
  };
}

function buildBusinessOutcomeBridge(dimensions: DimensionScore[], decisions: DecisionOutput[]): BusinessOutcomeBridgeItem[] {
  const source = decisions.length > 0 ? decisions : dimensions.slice(0, 4).map((dimension, index) => ({
    decisionId: `DIM-${index + 1}`,
    decisionClassification: `${dimension.label}: ${dimension.classification}`,
    recommendedActionPath: actionForDimension(dimension.key),
    evidenceTraceReferences: dimension.evidenceIds,
    confidenceScore: dimension.confidenceScore,
    confidenceLevel: dimension.confidenceLevel,
    category: "Monitoring Suggested" as const,
    impactExplanation: `${dimension.label} structural signals were observed.`
  }));

  return source.map((decision, index) => {
    const dimension = dimensions.find((item) => decision.decisionClassification.toLowerCase().startsWith(item.label.toLowerCase()));
    const score = dimension?.score ?? 70;
    return {
      bridgeId: `BOB-${String(index + 1).padStart(3, "0")}`,
      dimension: dimension?.key,
      structuralFinding: decision.decisionClassification,
      mappedBusinessOutcome: outcomeForDimension(dimension?.key),
      quantifiedUpliftRange: impactRangeForDimension(dimension?.key, score),
      opportunityRange: score < 40 ? "High" : score < 60 ? "Significant" : score < 75 ? "Moderate" : "Limited",
      transformationMapping: decision.recommendedActionPath,
      evidenceIds: decision.evidenceTraceReferences,
      confidenceScore: decision.confidenceScore,
      limitation:
        "This mapping is derived from observable structural signals only. It is not a revenue forecast, conversion guarantee, analytics measurement, or financial claim."
    };
  });
}

function buildRevenueIntelligence(
  oss: number,
  dimensions: DimensionScore[],
  decisions: DecisionOutput[],
  competitorComparison: ComparativeFinding[],
  monthlyLeadVolume?: number
): RevenueIntelligenceLayer {
  const conversion = dimensions.find((dimension) => dimension.key === "conversionReadiness");
  const trust = dimensions.find((dimension) => dimension.key === "trust");
  const clarity = dimensions.find((dimension) => dimension.key === "informationClarity");
  const evidenceIds = Array.from(new Set(decisions.flatMap((decision) => decision.evidenceTraceReferences)));
  const friction = clampScore(100 - oss);
  const leadVolume = monthlyLeadVolume && monthlyLeadVolume > 0 ? monthlyLeadVolume : 100;
  const confidenceScore = clampScore(
    (conversion?.confidenceScore ?? 60) * 0.35 +
      (trust?.confidenceScore ?? 60) * 0.25 +
      (clarity?.confidenceScore ?? 60) * 0.2 +
      (monthlyLeadVolume ? 15 : 5) +
      (competitorComparison.length > 0 ? 10 : 0)
  );
  const conversionLow = Number(Math.max(0.4, ((conversion?.score ?? oss) / 100) * 1.2).toFixed(2));
  const conversionHigh = Number(Math.min(6, conversionLow + Math.max(0.6, friction / 35)).toFixed(2));
  const opportunityLow = Math.round(leadVolume * (friction / 100) * 0.08);
  const opportunityHigh = Math.round(leadVolume * (friction / 100) * 0.22);
  const competitorWeakRows = competitorComparison.flatMap((comparison) =>
    comparison.evidenceTraceabilityMap.filter((row) => row.position === "primary_weaker")
  );

  return {
    status: monthlyLeadVolume || evidenceIds.length > 0 ? "estimated" : "input_limited",
    confidenceScore,
    confidenceBasis:
      "Revenue Intelligence V1 uses structural signals, OSS friction, conversion readiness, trust, information clarity, optional lead volume, and competitor structural pressure. It does not use analytics, ad accounts, banking data, or external APIs.",
    trafficRange: {
      label: "Estimated monthly traffic readiness range",
      low: Math.max(50, Math.round(leadVolume * 8 * (oss / 100))),
      high: Math.max(120, Math.round(leadVolume * 18 * Math.max(0.35, oss / 100))),
      unit: "monthly_visits",
      confidenceScore,
      rationale: "Derived from supplied lead volume when available; otherwise uses a neutral internal baseline and structural readiness.",
      evidenceIds
    },
    conversionPotentialRange: {
      label: "Estimated conversion potential range",
      low: conversionLow,
      high: conversionHigh,
      unit: "conversion_rate_percent",
      confidenceScore: conversion?.confidenceScore ?? confidenceScore,
      rationale: "Derived from conversion readiness, clarity, trust, and action-path evidence.",
      evidenceIds: conversion?.evidenceIds ?? evidenceIds
    },
    revenueOpportunityRange: {
      label: "Estimated recoverable monthly value range",
      low: opportunityLow,
      high: Math.max(opportunityLow, opportunityHigh),
      unit: "monthly_value_units",
      confidenceScore,
      rationale: monthlyLeadVolume
        ? "Lead volume input was provided, so opportunity units are scaled to the supplied monthly lead context."
        : "No lead value or traffic analytics were provided, so SYSTOLAB reports value units instead of currency.",
      evidenceIds
    },
    opportunityCostRange: {
      label: "Estimated monthly opportunity cost range",
      low: Math.round(opportunityLow * 0.8),
      high: Math.round(Math.max(opportunityHigh, opportunityLow) * 1.4),
      unit: "opportunity_cost_units",
      confidenceScore,
      rationale: "Uses OSS friction and the weakest validated dimensions to estimate structural opportunity cost units.",
      evidenceIds
    },
    competitorRevenuePressure: {
      status: competitorComparison.length > 0 ? "assessed" : "not_assessed",
      pressureLevel: competitorWeakRows.length >= 4 ? "High" : competitorWeakRows.length >= 2 ? "Moderate" : competitorComparison.length > 0 ? "Low" : "Unknown",
      explanation:
        competitorComparison.length > 0
          ? `${competitorWeakRows.length} competitor dimension row(s) show the client structurally weaker; pressure is structural, not a revenue claim.`
          : "No competitor URLs were provided, so competitor revenue pressure was not assessed.",
      evidenceIds: competitorWeakRows.flatMap((row) => [...row.primaryEvidenceIds, ...row.competitorEvidenceIds])
    },
    limitations: [
      "Revenue Intelligence V1 estimates structural opportunity and value ranges only.",
      "No analytics, payment data, CRM data, ad data, external traffic APIs, or external financial APIs were used.",
      "Currency revenue requires first-party business inputs such as average order value, close rate, or lead value."
    ]
  };
}

function buildRecommendationEngine(
  dimensions: DimensionScore[],
  decisions: DecisionOutput[],
  revenueIntelligence: RevenueIntelligenceLayer,
  canvas?: UnifiedIssueCanvas,
  attributionLayer?: BusinessOutcomeAttributionLayer
): RecommendationEngineOutput {
  const recommendations = decisions.map((decision, index) => {
    const dimension = dimensions.find((item) => decision.decisionClassification.toLowerCase().startsWith(item.label.toLowerCase()));
    const priority: RecommendationEngineOutput["recommendations"][number]["priority"] =
      decision.category === "Structural Priority: High" ? "FIX NOW" : decision.category === "Optimization Required" ? "THIS MONTH" : "MONITOR";
    const canonicalIssue = canvas?.canonicalIssues[index];
    const attributionProfile = canonicalIssue ? attributionLayer?.profiles.find((profile) => profile.canonicalIssueId === canonicalIssue.canonicalIssueId) : undefined;
    return {
      recommendationId: `REC-${String(index + 1).padStart(3, "0")}`,
      sourceDecisionId: decision.decisionId,
      canonicalIssueId: canonicalIssue?.canonicalIssueId,
      attributionProfileId: attributionProfile?.attributionProfileId,
      dependencyChain: [],
      lifecycleState: "Recommended" as const,
      sequencePosition: index + 1,
      issue: decision.decisionClassification,
      action: decision.recommendedActionPath,
      priority,
      mappedDimensions: dimension ? [dimension.key] : [],
      expectedScoreMovement: projectedLiftForScore(dimension?.score ?? 70),
      revenueIntelligenceMapping: `${revenueIntelligence.revenueOpportunityRange.label}: ${revenueIntelligence.revenueOpportunityRange.low}-${revenueIntelligence.revenueOpportunityRange.high} ${revenueIntelligence.revenueOpportunityRange.unit}.`,
      confidenceScore: decision.confidenceScore,
      evidenceIds: decision.evidenceTraceReferences,
      changeValidationPlan:
        "Re-scan after implementation and compare evidence objects, dimension movement, OSS delta, and recommendation-specific change records."
    };
  });

  return {
    status: recommendations.length > 0 ? "generated" : "limited",
    recommendations,
    mappingSystem: {
      rule: "one_recommendation_one_change_cluster",
      explanation:
        "Each recommendation maps to one issue, one action, one evidence set, and one future change-validation cluster."
    }
  };
}

function buildLightweightChangeDetection(
  previousSnapshot: ReportSnapshot | null | undefined,
  currentOss: number,
  dimensions: DimensionScore[],
  recommendationEngine: RecommendationEngineOutput
): LightweightChangeDetection {
  if (!previousSnapshot) {
    return {
      status: "baseline_only",
      changes: [],
      explanation:
        "No previous snapshot was available for this target, so this scan becomes the baseline for future change detection."
    };
  }

  const changes: LightweightChangeDetection["changes"] = [];
  const previousOss = previousSnapshot.oss.score;
  if (previousOss === null) {
    return {
      status: "not_available",
      comparedSnapshotId: previousSnapshot.snapshotId,
      changes: [],
      explanation:
        "The previous snapshot was content-unavailable and not scored, so OSS delta comparison requires another scored scan."
    };
  }

  const ossDelta = currentOss - previousOss;
  if (Math.abs(ossDelta) >= 3) {
    changes.push({
      changeId: "CHG-OSS-001",
      area: "Observable Structural Score",
      beforeState: String(previousOss),
      afterState: String(currentOss),
      direction: ossDelta > 0 ? "improved" : "declined",
      evidenceIds: [],
      recommendationIds: recommendationEngine.recommendations.map((recommendation) => recommendation.recommendationId),
      confidenceScore: 82
    });
  }

  for (const dimension of dimensions) {
    const previous = previousSnapshot.dimensions.find((item) => item.key === dimension.key);
    if (!previous) continue;
    const delta = dimension.score - previous.score;
    if (Math.abs(delta) < 3) continue;
    changes.push({
      changeId: `CHG-${dimension.key}`,
      area: dimension.label,
      beforeState: String(previous.score),
      afterState: String(dimension.score),
      direction: delta > 0 ? "improved" : "declined",
      evidenceIds: dimension.evidenceIds,
      recommendationIds: recommendationEngine.recommendations
        .filter((recommendation) => recommendation.mappedDimensions.includes(dimension.key))
        .map((recommendation) => recommendation.recommendationId),
      confidenceScore: dimension.confidenceScore
    });
  }

  return {
    status: changes.length > 0 ? "changes_detected" : "no_material_change",
    comparedSnapshotId: previousSnapshot.snapshotId,
    changes,
    explanation:
      changes.length > 0
        ? `${changes.length} lightweight structural change(s) were detected against the previous immutable snapshot.`
        : "A previous snapshot was available, but no material score movement crossed the lightweight change threshold."
  };
}

function buildArchitectureState(): ArchitectureLayerState {
  return {
    flow: [
      "identity_context",
      "data",
      "truth_evidence",
      "intelligence",
      "revenue_intelligence",
      "confidence",
      "automation",
      "action_alert",
      "outcome_validation"
    ],
    activeV1Engines: [
      "Scan History Tracking",
      "Evidence Collection",
      "Evidence Database",
      "OSS Scoring Engine",
      "Revenue Intelligence Engine",
      "Recommendation Engine",
      "Recommendation Outcome Validation Loop",
      "Pre-Signal Classification Layer",
      "Signal Ownership and Evidence Fusion Layer",
      "Canonical Issue Mapping Layer",
      "Unified Issue Canvas",
      "Duplicate Collapse Engine",
      "Action Unification Layer",
      "Post-Generation Normalization Layer",
      "Global Output Contract",
      "Feedback Validation Loop",
      "Business Outcome Attribution Layer",
      "Dependency Intelligence Layer",
      "Recommendation Sequencing Engine",
      "Evidence Freshness Governance Layer",
      "Closed-Loop Outcome Verification and Learning Layer",
      "Business Objective Alignment Validation",
      "Industry Benchmark Engine",
      "Competitor Snapshot Analysis",
      "Competitor Intelligence Engine",
      "Confidence Engine",
      "Lightweight Change Detection",
      "Monitoring Scheduler",
      "Alert Engine",
      "Operational Memory Graph",
      "Business Evolution Engine",
      "Competitive Threat Radar",
      "Business DNA Engine",
      "Edit Intelligence System"
    ],
    stagedFutureEngines: [
      {
        engine: "Operational Memory Graph",
        status: "architecturally_integrated",
        activationNote: "Active in V1 as graph-ready website, issue, recommendation, outcome, revenue impact, and competitor relationships."
      },
      {
        engine: "Business Evolution Engine",
        status: "architecturally_integrated",
        activationNote: "Active in V1 with baseline and multi-snapshot OSS evolution timelines."
      },
      {
        engine: "Outcome Validation Engine",
        status: "architecturally_integrated",
        activationNote: "Active in V1 through recommendation-to-change-to-outcome validation records."
      },
      {
        engine: "Competitive Threat Radar",
        status: "architecturally_integrated",
        activationNote: "Active in V1 with competitor structural gaps, movement signals, and threat levels."
      },
      {
        engine: "Business DNA Engine",
        status: "architecturally_integrated",
        activationNote: "Active in V1 with strengths, weaknesses, growth style, and recurring pattern detection."
      },
      {
        engine: "Edit Intelligence System",
        status: "architecturally_integrated",
        activationNote: "Active in V1 as a first-party dashboard event collector contract with no third-party analytics."
      }
    ],
    eventDrivenContract:
      "Layers communicate through standardized SYSTOLAB event envelopes and immutable snapshot/history records; no layer mutates another layer's internal logic."
  };
}

function buildEvidenceDatabase(
  snapshotId: string,
  capturedAt: string,
  previousSnapshot: ReportSnapshot | null | undefined,
  decisions: DecisionOutput[],
  evidenceObjects: EvidenceObject[],
  validationTrace: ValidationTraceEntry[],
  changeDetection: LightweightChangeDetection
): EvidenceDatabaseEntry[] {
  const decisionEntries = decisions.map((decision, index) => {
    const linkedEvidence = evidenceObjects.find((evidence) => decision.evidenceTraceReferences.includes(evidence.evidenceId));
    const previousDecision = previousSnapshot?.decisions.find((item) => item.decisionClassification === decision.decisionClassification);
    const traceIds = validationTrace
      .filter((trace) => trace.evidenceId && decision.evidenceTraceReferences.includes(trace.evidenceId))
      .map((trace) => trace.traceId);
    return {
      evidenceId: `EV-${String(index + 1).padStart(5, "0")}`,
      issue: decision.decisionClassification,
      before: previousDecision?.recommendedActionPath ?? null,
      after: linkedEvidence?.rawDomSnapshot ?? linkedEvidence?.rawValue ?? decision.recommendedActionPath,
      confidenceScore: decision.confidenceScore,
      confidenceReason: `${decision.confidenceLevel} confidence from ${decision.evidenceTraceReferences.length} linked Evidence Object(s) and ${traceIds.length} validation trace(s).`,
      evidenceType: previousSnapshot ? "before_after_change" as const : "issue_state" as const,
      lineage: {
        snapshotId,
        previousSnapshotId: previousSnapshot?.snapshotId,
        sourceEvidenceIds: decision.evidenceTraceReferences,
        recommendationIds: [],
        validationTraceIds: traceIds
      },
      capturedAt
    };
  });

  const changeEntries = changeDetection.changes.map((change, index) => ({
    evidenceId: `EV-CHG-${String(index + 1).padStart(5, "0")}`,
    issue: change.area,
    before: change.beforeState,
    after: change.afterState,
    confidenceScore: change.confidenceScore,
    confidenceReason: `Before/after state verified against snapshot ${changeDetection.comparedSnapshotId ?? "baseline"} with lightweight change threshold.`,
    evidenceType: "recommendation_outcome" as const,
    lineage: {
      snapshotId,
      previousSnapshotId: changeDetection.comparedSnapshotId,
      sourceEvidenceIds: change.evidenceIds,
      recommendationIds: change.recommendationIds,
      validationTraceIds: []
    },
    capturedAt
  }));

  return [...decisionEntries, ...changeEntries];
}

function buildOutcomeValidationEngine(
  previousSnapshot: ReportSnapshot | null | undefined,
  capturedAt: string,
  currentOss: number,
  dimensions: DimensionScore[],
  recommendationEngine: RecommendationEngineOutput,
  revenueIntelligence: RevenueIntelligenceLayer
): OutcomeValidationEngine {
  const previousOss = previousSnapshot?.oss.score ?? undefined;
  const ossDelta = previousOss === undefined ? null : currentOss - previousOss;
  const validations = recommendationEngine.recommendations.map((recommendation) => {
    const dimensionDeltas = recommendation.mappedDimensions.map((dimensionKey) => {
      const current = dimensions.find((dimension) => dimension.key === dimensionKey);
      const previous = previousSnapshot?.dimensions.find((dimension) => dimension.key === dimensionKey);
      return {
        dimension: dimensionKey,
        dimensionLabel: current?.label ?? DIMENSION_LABELS[dimensionKey],
        beforeScore: previous?.score ?? null,
        afterScore: current?.score ?? 0,
        delta: previous ? (current?.score ?? 0) - previous.score : null
      };
    });
    const materialDelta = Math.max(ossDelta ?? 0, ...dimensionDeltas.map((item) => item.delta ?? 0));
    const implementedStatus: OutcomeValidationEngine["validations"][number]["implementedStatus"] =
      !previousSnapshot ? "pending_baseline" : materialDelta >= 3 ? "validated" : materialDelta <= -3 ? "regressed" : "not_detected";
    const improvementStatus: OutcomeValidationEngine["validations"][number]["improvementStatus"] =
      !previousSnapshot ? "pending" : materialDelta >= 3 ? "improved" : materialDelta <= -3 ? "declined" : "unchanged";
    const impactLow = Math.max(0, Math.round((revenueIntelligence.revenueOpportunityRange.low * Math.max(0, materialDelta)) / 20));
    const impactHigh = Math.max(impactLow, Math.round((revenueIntelligence.revenueOpportunityRange.high * Math.max(0, materialDelta)) / 12));
    return {
      recommendationId: recommendation.recommendationId,
      recommendation: recommendation.action,
      implementedStatus,
      detectedAt: previousSnapshot ? capturedAt : undefined,
      ossDelta,
      dimensionDeltas,
      improvementStatus,
      revenueImpact: {
        label: "Validated structural impact value units",
        low: impactLow,
        high: impactHigh,
        unit: "monthly_value_units" as const,
        confidenceScore: previousSnapshot ? recommendation.confidenceScore : 0,
        rationale: previousSnapshot
          ? "Calculated from measured OSS/dimension movement after re-scan and mapped to structural value units."
          : "No previous snapshot exists, so outcome impact is pending validation.",
        evidenceIds: recommendation.evidenceIds
      },
      confidenceScore: previousSnapshot ? recommendation.confidenceScore : 0,
      confidenceReasons: previousSnapshot
        ? [
            `Compared against previous snapshot ${previousSnapshot.snapshotId}.`,
            `${dimensionDeltas.length} mapped dimension(s) checked.`,
            "Revenue impact is expressed in SYSTOLAB value units, not currency."
          ]
        : ["A baseline scan is required before implementation detection and outcome validation can run."],
      evidenceIds: recommendation.evidenceIds
    };
  });

  const status: OutcomeValidationEngine["status"] =
    !previousSnapshot ? "baseline_pending" : validations.some((item) => item.implementedStatus === "regressed") ? "regression_detected" : validations.some((item) => item.implementedStatus === "validated") ? "validated" : "no_material_change";

  return {
    status,
    previousSnapshotId: previousSnapshot?.snapshotId,
    validations,
    summary:
      status === "baseline_pending"
        ? "This scan creates the baseline. Re-scan after implementing recommendations to validate outcomes."
        : status === "validated"
          ? "At least one recommendation shows measurable structural improvement against the previous snapshot."
          : status === "regression_detected"
            ? "At least one recommendation-mapped area declined against the previous snapshot."
            : "Previous snapshot comparison is available, but no recommendation crossed the material improvement threshold."
  };
}

function buildConfidenceEngine(
  confidenceLayer: ConfidenceMetric[],
  coverage: EvidenceCoverageSummary,
  revenueIntelligence: RevenueIntelligenceLayer,
  recommendationEngine: RecommendationEngineOutput,
  benchmarkEngine: IndustryBenchmarkEngine,
  competitorComparison: ComparativeFinding[],
  outcomeValidation: OutcomeValidationEngine
): ConfidenceEngineOutput {
  const coverageScore = clampScore((coverage.pages.filter((page) => page.coverageStatus !== "Limited").length / Math.max(1, coverage.pages.length)) * 100);
  const validationScore = clampScore(confidenceLayer.reduce((sum, item) => sum + item.confidenceScore, 0) / Math.max(1, confidenceLayer.length));
  const benchmarkScore = benchmarkEngine.status === "available" ? 85 : benchmarkEngine.status === "seeded_internal_dataset" ? 68 : 35;
  const competitorScore = competitorComparison.length > 0 ? 78 : 30;
  const outcomeScore = outcomeValidation.status === "baseline_pending" ? 25 : outcomeValidation.status === "validated" ? 86 : 64;
  const factors: ConfidenceEngineFactor[] = [
    {
      factorId: "CONF-EVIDENCE-COVERAGE",
      label: "Evidence Coverage",
      score: coverageScore,
      weight: 30,
      reason: `${coverage.totalEvidenceObjects} Evidence Object(s) across ${coverage.totalPagesSampled} sampled page(s).`,
      evidenceIds: []
    },
    {
      factorId: "CONF-VALIDATION",
      label: "Validation Strength",
      score: validationScore,
      weight: 25,
      reason: `${confidenceLayer.length} confidence area(s) contributed score traces.`,
      evidenceIds: []
    },
    {
      factorId: "CONF-BENCHMARK",
      label: "Benchmark Availability",
      score: benchmarkScore,
      weight: 15,
      reason: benchmarkEngine.status === "seeded_internal_dataset" ? "Seeded internal vertical benchmark is available." : "Benchmark coverage is limited.",
      evidenceIds: []
    },
    {
      factorId: "CONF-COMPETITOR",
      label: "Competitor Context",
      score: competitorScore,
      weight: 15,
      reason: competitorComparison.length > 0 ? `${competitorComparison.length} competitor snapshot(s) assessed.` : "No competitor URL was provided.",
      evidenceIds: competitorComparison.flatMap((comparison) => comparison.evidenceTraceabilityMap.flatMap((row) => row.primaryEvidenceIds))
    },
    {
      factorId: "CONF-OUTCOME",
      label: "Outcome Validation",
      score: outcomeScore,
      weight: 15,
      reason: outcomeValidation.summary,
      evidenceIds: outcomeValidation.validations.flatMap((validation) => validation.evidenceIds)
    }
  ];
  const overallConfidenceScore = clampScore(factors.reduce((sum, factor) => sum + factor.score * (factor.weight / 100), 0));

  return {
    overallConfidenceScore,
    confidenceLevel: confidenceLevelForScore(overallConfidenceScore),
    factors,
    estimateExplanations: [
      {
        area: "Revenue Estimate",
        confidenceScore: revenueIntelligence.confidenceScore,
        reasons: [
          revenueIntelligence.confidenceBasis,
          `${revenueIntelligence.revenueOpportunityRange.evidenceIds.length} evidence reference(s) mapped to opportunity range.`
        ],
        missingInputs: [
          "No analytics account access.",
          "No CRM or payment data.",
          "No external traffic API."
        ],
        evidenceIds: revenueIntelligence.revenueOpportunityRange.evidenceIds
      },
      {
        area: "Recommendation",
        confidenceScore: recommendationEngine.recommendations[0]?.confidenceScore ?? 0,
        reasons: [`${recommendationEngine.recommendations.length} recommendation(s) generated from decision outputs.`],
        missingInputs: recommendationEngine.recommendations.length > 0 ? [] : ["No actionable decision output was generated."],
        evidenceIds: recommendationEngine.recommendations.flatMap((recommendation) => recommendation.evidenceIds)
      },
      {
        area: "Benchmark",
        confidenceScore: benchmarkScore,
        reasons: [`${benchmarkEngine.industryType} benchmark status: ${benchmarkEngine.status}.`],
        missingInputs: benchmarkEngine.status === "seeded_internal_dataset" ? ["Live industry dataset is still growing from SYSTOLAB scans."] : [],
        evidenceIds: []
      },
      {
        area: "Competitor",
        confidenceScore: competitorScore,
        reasons: competitorComparison.length > 0 ? ["Competitor pages were scanned and compared dimension-by-dimension."] : ["No competitor URL was provided."],
        missingInputs: competitorComparison.length > 0 ? [] : ["Competitor URLs."],
        evidenceIds: competitorComparison.flatMap((comparison) => comparison.evidenceTraceabilityMap.flatMap((row) => row.competitorEvidenceIds))
      },
      {
        area: "Outcome Validation",
        confidenceScore: outcomeScore,
        reasons: [outcomeValidation.summary],
        missingInputs: outcomeValidation.status === "baseline_pending" ? ["A second scan after implementation."] : [],
        evidenceIds: outcomeValidation.validations.flatMap((validation) => validation.evidenceIds)
      }
    ]
  };
}

function buildIndustryBenchmarkEngine(dimensions: DimensionScore[], industryType: string): IndustryBenchmarkEngine {
  const normalizedIndustry = normalizeIndustryType(industryType);
  const selected = SEEDED_VERTICAL_BENCHMARKS.find((item) => item.industryType === normalizedIndustry) ?? SEEDED_VERTICAL_BENCHMARKS.find((item) => item.industryType === "local_service")!;
  return {
    status: "seeded_internal_dataset",
    industryType: selected.industryType,
    datasetVersion: "systolab.seeded.verticals.v1",
    sampleSize: selected.sampleSize,
    verticalAverages: SEEDED_VERTICAL_BENCHMARKS,
    currentPosition: dimensions.map((dimension) => {
      const industryAverage = selected.dimensions[dimension.key] ?? selected.averageOss;
      const delta = dimension.score - industryAverage;
      return {
        dimension: dimension.key,
        dimensionLabel: dimension.label,
        score: dimension.score,
        industryAverage,
        position: positionForBenchmarkDelta(delta),
        delta
      };
    }),
    limitations: [
      "Seeded benchmarks are SYSTOLAB-owned internal baselines, not external industry claims.",
      "As production scan volume grows, persisted BenchmarkRecord data can replace seeded baselines per vertical.",
      "Benchmark positions are structural readiness comparisons only."
    ]
  };
}

function buildCompetitorIntelligenceEngine(
  competitorComparison: ComparativeFinding[],
  snapshotHistory: ReportSnapshot[],
  snapshotId: string,
  capturedAt: string
): CompetitorIntelligenceEngine {
  if (competitorComparison.length === 0) {
    return {
      status: "not_assessed",
      competitors: [],
      explanation: "No competitor URLs were provided, so competitor timelines and alerts were not generated."
    };
  }

  const competitors = competitorComparison.map((competitor) => {
    const priorPoints = [...snapshotHistory]
      .reverse()
      .flatMap((snapshot) => snapshot.competitorComparison.filter((item) => normalizeUrlForCompare(item.competitorUrl) === normalizeUrlForCompare(competitor.competitorUrl)).map((item) => competitorTimelinePoint(snapshot.snapshotId, snapshot.createdAt, item)));
    const currentPoint = competitorTimelinePoint(snapshotId, capturedAt, competitor);
    const timeline = [...priorPoints, currentPoint].slice(-12);
    const previous = timeline.at(-2);
    const latest = timeline.at(-1)!;
    const changedDimensions = competitor.evidenceTraceabilityMap.map((row) => {
      const beforeScore = previous?.dimensions[row.dimension] ?? null;
      const afterScore = row.competitorScore;
      const delta = beforeScore === null || afterScore === null || beforeScore === undefined ? null : afterScore - beforeScore;
      return {
        dimension: row.dimension,
        dimensionLabel: row.dimensionLabel,
        beforeScore: beforeScore ?? null,
        afterScore,
        delta,
        suspectedReason: suspectedReasonForDimension(row.dimension, delta)
      };
    }).filter((item) => item.delta !== null && Math.abs(item.delta) >= 5);

    return {
      competitorUrl: competitor.competitorUrl,
      competitorLabel: competitor.competitorLabel,
      timeline,
      latestMovement: {
        ossDelta: previous?.oss === null || previous?.oss === undefined || latest.oss === null ? null : latest.oss - previous.oss,
        changedDimensions
      }
    };
  });

  return {
    status: "tracked",
    competitors,
    explanation: "Competitor Intelligence V1 stores current and prior competitor structural snapshots to create movement timelines and alert triggers."
  };
}

function buildMonitoringScheduler(request: ScanRequest, targetUrl: string, createdAt: string): MonitoringSchedulerState {
  const cadence: MonitoringSchedulerState["cadence"] = "weekly";
  return {
    status: "scheduled",
    scheduleId: `mon_${sha256(`${request.tenantSlug ?? "default"}:${targetUrl}:${cadence}`).slice(0, 18)}`,
    cadence,
    enabled: true,
    lastRunAt: createdAt,
    nextRunAt: addDays(createdAt, 7),
    targetUrl,
    competitorUrls: request.competitorUrls ?? [],
    alertChannels: ["dashboard", "email_simulated"]
  };
}

function buildAlertEngine(
  currentOss: number,
  previousSnapshot: ReportSnapshot | null | undefined,
  changeDetection: LightweightChangeDetection,
  competitorEngine: CompetitorIntelligenceEngine,
  outcomeValidation: OutcomeValidationEngine,
  revenueIntelligence: RevenueIntelligenceLayer,
  createdAt: string
): AlertEngineOutput {
  const alerts: AlertEngineOutput["alerts"] = [];
  const previousOss = previousSnapshot?.oss.score ?? undefined;
  if (previousOss !== undefined && currentOss - previousOss <= -5) {
    alerts.push({
      alertId: "ALT-SCORE-DROP",
      type: "score_drop",
      severity: currentOss - previousOss <= -15 ? "critical" : "high",
      title: "OSS dropped since previous scan",
      message: `OSS moved from ${previousOss} to ${currentOss}.`,
      trigger: `oss_delta=${currentOss - previousOss}`,
      evidenceIds: changeDetection.changes.flatMap((change) => change.evidenceIds),
      createdAt,
      acknowledged: false
    });
  }

  for (const competitor of competitorEngine.competitors) {
    if ((competitor.latestMovement.ossDelta ?? 0) >= 10) {
      alerts.push({
        alertId: `ALT-COMP-${sha256(competitor.competitorUrl).slice(0, 8)}`,
        type: "competitor_movement",
        severity: "high",
        title: "Competitor structural movement detected",
        message: `${competitor.competitorLabel} improved by ${competitor.latestMovement.ossDelta} OSS points.`,
        trigger: "competitor_oss_delta>=10",
        evidenceIds: [],
        createdAt,
        acknowledged: false
      });
    }
  }

  if (outcomeValidation.status === "validated") {
    alerts.push({
      alertId: "ALT-REC-VALIDATED",
      type: "recommendation_validated",
      severity: "medium",
      title: "Recommendation outcome validated",
      message: "At least one recommendation produced measurable structural improvement.",
      trigger: "outcome_validation=validated",
      evidenceIds: outcomeValidation.validations.flatMap((validation) => validation.evidenceIds),
      createdAt,
      acknowledged: false
    });
  }

  if (revenueIntelligence.competitorRevenuePressure.pressureLevel === "High") {
    alerts.push({
      alertId: "ALT-REV-PRESSURE",
      type: "revenue_pressure",
      severity: "high",
      title: "High competitor structural pressure",
      message: revenueIntelligence.competitorRevenuePressure.explanation,
      trigger: "competitor_revenue_pressure=High",
      evidenceIds: revenueIntelligence.competitorRevenuePressure.evidenceIds,
      createdAt,
      acknowledged: false
    });
  }

  return {
    status: alerts.length > 0 ? "alerts_generated" : "no_alerts",
    alerts
  };
}

function buildBusinessEvolutionEngine(
  snapshotHistory: ReportSnapshot[],
  snapshotId: string,
  createdAt: string,
  oss: number,
  _dimensions: DimensionScore[],
  decisions: DecisionOutput[]
): BusinessEvolutionEngine {
  const scoredHistory = snapshotHistory.filter((snapshot) => snapshot.oss.score !== null);
  const timeline = [
    ...[...scoredHistory].reverse().map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.createdAt,
      oss: snapshot.oss.score as number,
      topCause: snapshot.decisions[0]?.decisionClassification ?? snapshot.executiveClarity.primaryConversionBlocker
    })),
    {
      snapshotId,
      capturedAt: createdAt,
      oss,
      topCause: decisions[0]?.decisionClassification ?? "Current structural condition"
    }
  ].slice(-12);
  const first = timeline[0];
  const last = timeline.at(-1);
  const scoreDelta = first && last ? last.oss - first.oss : 0;
  const trend: BusinessEvolutionEngine["trend"] = timeline.length <= 1 ? "baseline" : scoreDelta >= 5 ? "improving" : scoreDelta <= -5 ? "declining" : "stable";
  return {
    status: timeline.length <= 1 ? "baseline_only" : "evolution_tracked",
    timeline,
    trend,
    scoreDelta,
    causeNarrative:
      timeline.length <= 1
        ? "This is the first known snapshot for this target, so evolution tracking starts now."
        : `Across ${timeline.length} snapshot(s), OSS moved ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}. Latest major cause: ${last?.topCause ?? "not available"}.`
  };
}

function buildCompetitiveThreatRadar(
  competitorEngine: CompetitorIntelligenceEngine,
  competitorComparison: ComparativeFinding[],
  changeDetection: LightweightChangeDetection
): CompetitiveThreatRadar {
  if (competitorComparison.length === 0) {
    return {
      status: "not_assessed",
      threatLevel: "UNKNOWN",
      threats: [],
      explanation: "No competitor URLs were provided."
    };
  }

  const threats: CompetitiveThreatRadar["threats"] = [];
  for (const competitor of competitorComparison) {
    const weakRows = competitor.evidenceTraceabilityMap.filter((row) => row.position === "primary_weaker");
    for (const row of weakRows) {
      threats.push({
        competitorUrl: competitor.competitorUrl,
        threatType: row.dimension === "mobileExperience" ? "mobile_gain" : row.dimension === "trust" ? "trust_gain" : row.dimension === "conversionReadiness" ? "conversion_gain" : "oss_gain",
        severity: Math.abs(row.difference) >= 20 ? "high" : Math.abs(row.difference) >= 10 ? "medium" : "low",
        reason: `${competitor.competitorLabel} is structurally stronger in ${row.dimensionLabel} by ${Math.abs(row.difference)} point(s).`,
        evidenceIds: [...row.primaryEvidenceIds, ...row.competitorEvidenceIds]
      });
    }
  }
  for (const competitor of competitorEngine.competitors) {
    if ((competitor.latestMovement.ossDelta ?? 0) >= 10) {
      threats.push({
        competitorUrl: competitor.competitorUrl,
        threatType: "oss_gain",
        severity: "high",
        reason: `${competitor.competitorLabel} improved ${competitor.latestMovement.ossDelta} OSS points in the tracked timeline.`,
        evidenceIds: []
      });
    }
  }
  if (changeDetection.changes.some((change) => change.direction === "declined")) {
    threats.push({
      competitorUrl: "client",
      threatType: "client_regression",
      severity: "medium",
      reason: "Client structural regression was detected in the latest snapshot.",
      evidenceIds: changeDetection.changes.flatMap((change) => change.evidenceIds)
    });
  }

  const highCount = threats.filter((threat) => threat.severity === "high").length;
  return {
    status: "active",
    threatLevel: highCount > 0 ? "HIGH" : threats.length >= 3 ? "MEDIUM" : "LOW",
    threats: threats.slice(0, 8),
    explanation:
      threats.length > 0
        ? `${threats.length} structural threat signal(s) detected from competitor gaps, competitor movement, or client regression.`
        : "Competitors were assessed, but no material structural threat was detected."
  };
}

function buildBusinessDnaEngine(snapshotHistory: ReportSnapshot[], dimensions: DimensionScore[], oss: number): BusinessDnaEngine {
  const strengths = dimensions.filter((dimension) => dimension.score >= 75).sort((a, b) => b.score - a.score).slice(0, 3).map((dimension) => dimension.label);
  const weaknesses = dimensions.filter((dimension) => dimension.score < 60).sort((a, b) => a.score - b.score).slice(0, 3).map((dimension) => dimension.label);
  const previous = snapshotHistory[0];
  const previousOss = previous?.oss.score ?? undefined;
  const delta = previousOss === undefined ? 0 : oss - previousOss;
  const growthStyle: BusinessDnaEngine["growthStyle"] =
    previousOss === undefined ? "baseline_only" : delta >= 12 ? "fast_improving" : delta >= 3 ? "slow_but_consistent" : delta <= -5 ? "declining" : "volatile";
  const recurringPatterns = dimensions
    .filter((dimension) => {
      const previousDimension = previous?.dimensions.find((item) => item.key === dimension.key);
      return previousDimension ? previousDimension.score < 60 && dimension.score < 60 : dimension.score < 60;
    })
    .map((dimension) => `${dimension.label} remains a recurring structural weakness.`);

  return {
    status: previousOss === undefined ? "baseline_profile" : "pattern_detected",
    strengths: strengths.length ? strengths : ["No dominant strength detected yet"],
    weaknesses: weaknesses.length ? weaknesses : ["No critical weakness detected"],
    growthStyle,
    recurringPatterns: recurringPatterns.length ? recurringPatterns : ["No recurring pattern has enough history yet."],
    confidenceScore: clampScore((dimensions.reduce((sum, dimension) => sum + dimension.confidenceScore, 0) / Math.max(1, dimensions.length)) * (previous ? 1 : 0.72))
  };
}

function buildEditIntelligenceSystem(snapshotId: string, capturedAt: string): EditIntelligenceSystem {
  return {
    status: "collector_ready",
    sessionFingerprint: sha256(`${snapshotId}:${capturedAt}`).slice(0, 24),
    observedSignals: [
      {
        signal: "scan_started",
        count: 1,
        lastObservedAt: capturedAt
      }
    ],
    abandonmentRisk: "unknown",
    churnInference: "not_enough_behavior",
    funnelAnalytics: [
      { step: "scan_started", observed: true, evidenceIds: [] },
      { step: "report_viewed", observed: false, evidenceIds: [] },
      { step: "recommendation_viewed", observed: false, evidenceIds: [] },
      { step: "report_downloaded", observed: false, evidenceIds: [] },
      { step: "rescan_started", observed: false, evidenceIds: [] }
    ],
    limitations: [
      "Edit Intelligence V1 exposes a self-owned collector contract.",
      "No third-party analytics, session replay, fingerprinting vendor, or ad platform is used.",
      "Churn and abandonment inference require first-party dashboard events."
    ]
  };
}

function buildOperationalMemoryGraph(
  snapshotId: string,
  targetUrl: string,
  decisions: DecisionOutput[],
  recommendationEngine: RecommendationEngineOutput,
  outcomeValidation: OutcomeValidationEngine,
  revenueIntelligence: RevenueIntelligenceLayer,
  competitorComparison: ComparativeFinding[]
): OperationalMemoryGraph {
  const websiteNode = `node_website_${sha256(targetUrl).slice(0, 10)}`;
  const snapshotNode = `node_snapshot_${snapshotId}`;
  const nodes: OperationalMemoryGraph["nodes"] = [
    { nodeId: websiteNode, type: "website", label: targetUrl, metadata: { targetUrl } },
    { nodeId: snapshotNode, type: "snapshot", label: snapshotId, metadata: { snapshotId } },
    {
      nodeId: `node_revenue_${snapshotId}`,
      type: "revenue_impact",
      label: revenueIntelligence.revenueOpportunityRange.label,
      metadata: {
        low: revenueIntelligence.revenueOpportunityRange.low,
        high: revenueIntelligence.revenueOpportunityRange.high,
        unit: revenueIntelligence.revenueOpportunityRange.unit
      }
    }
  ];
  const edges: OperationalMemoryGraph["edges"] = [
    { edgeId: `edge_${websiteNode}_${snapshotNode}`, from: websiteNode, to: snapshotNode, relationship: "has_snapshot", confidenceScore: 100 }
  ];

  for (const [index, decision] of decisions.entries()) {
    const issueNode = `node_issue_${decision.decisionId}`;
    const recommendation = recommendationEngine.recommendations[index];
    nodes.push({ nodeId: issueNode, type: "issue", label: decision.decisionClassification, metadata: { evidenceIds: decision.evidenceTraceReferences } });
    edges.push({ edgeId: `edge_${snapshotNode}_${issueNode}`, from: snapshotNode, to: issueNode, relationship: "has_issue", confidenceScore: decision.confidenceScore });
    if (recommendation) {
      const recommendationNode = `node_rec_${recommendation.recommendationId}`;
      nodes.push({ nodeId: recommendationNode, type: "recommendation", label: recommendation.action, metadata: { priority: recommendation.priority } });
      edges.push({ edgeId: `edge_${issueNode}_${recommendationNode}`, from: issueNode, to: recommendationNode, relationship: "recommends", confidenceScore: recommendation.confidenceScore });
      const validation = outcomeValidation.validations.find((item) => item.recommendationId === recommendation.recommendationId);
      if (validation) {
        const outcomeNode = `node_outcome_${recommendation.recommendationId}`;
        nodes.push({ nodeId: outcomeNode, type: "outcome", label: validation.implementedStatus, metadata: { ossDelta: validation.ossDelta } });
        edges.push({ edgeId: `edge_${recommendationNode}_${outcomeNode}`, from: recommendationNode, to: outcomeNode, relationship: "validated_by", confidenceScore: validation.confidenceScore });
        edges.push({ edgeId: `edge_${outcomeNode}_node_revenue_${snapshotId}`, from: outcomeNode, to: `node_revenue_${snapshotId}`, relationship: "maps_to", confidenceScore: validation.confidenceScore });
      }
    }
  }

  for (const competitor of competitorComparison) {
    const competitorNode = `node_comp_${sha256(competitor.competitorUrl).slice(0, 10)}`;
    nodes.push({ nodeId: competitorNode, type: "competitor", label: competitor.competitorLabel, metadata: { competitorUrl: competitor.competitorUrl, oss: competitor.competitorOss } });
    edges.push({ edgeId: `edge_${snapshotNode}_${competitorNode}`, from: snapshotNode, to: competitorNode, relationship: "compared_with", confidenceScore: competitor.status === "assessed" ? 80 : 25 });
  }

  return {
    status: nodes.length > 5 ? "graph_ready" : "limited_history",
    nodes,
    edges,
    summary: `Operational Memory Graph V1 contains ${nodes.length} node(s) and ${edges.length} relationship(s) for this snapshot.`
  };
}

function buildTransformationProjection(oss: number, dimensions: DimensionScore[], decisions: DecisionOutput[]): TransformationProjection {
  const lowDimensions = [...dimensions].sort((a, b) => a.score - b.score).slice(0, 5);
  const dimensionProjections = lowDimensions.map((dimension) => {
    const lift = projectedLiftForScore(dimension.score);
    const decision = decisions.find((item) => item.decisionClassification.toLowerCase().startsWith(dimension.label.toLowerCase()));
    return {
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      currentScore: dimension.score,
      projectedScore: clampScore(dimension.score + lift),
      projectedDelta: lift,
      recommendedActionPath: decision?.recommendedActionPath ?? actionForDimension(dimension.key),
      evidenceIds: dimension.evidenceIds
    };
  });
  const projectedDelta = clampScore(Math.round(dimensionProjections.reduce((sum, item) => sum + item.projectedDelta, 0) / 2.8));

  return {
    currentOss: oss,
    projectedOss: clampScore(oss + projectedDelta),
    projectedDelta,
    projectionBasis:
      "Projection assumes the listed structural issues are fixed and then re-scanned. It is a deterministic structural score projection, not a prediction of revenue or user behavior.",
    dimensionProjections
  };
}

function buildClosedLoopProof(snapshotId: string, oss: number, dimensions: DimensionScore[]): ClosedLoopProofSystem {
  return {
    status: "baseline_only",
    baselineSnapshotId: snapshotId,
    beforeOss: oss,
    dimensionDeltas: dimensions.map((dimension) => ({
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      beforeScore: dimension.score
    })),
    explanation:
      "This is the baseline scan. Re-scan the same target after fixes to produce a before/after delta comparison with OSS and dimension-level movement."
  };
}

function buildPriorityTimeline(decisions: DecisionOutput[]): PriorityTimelineFramework {
  const items = decisions.map<PriorityTimelineItem>((decision, index) => {
    const category: PriorityTimelineItem["category"] =
      decision.category === "Structural Priority: High" ? "FIX NOW" : decision.category === "Optimization Required" ? "THIS MONTH" : "MONITOR";
    return {
      actionId: `PT-${String(index + 1).padStart(3, "0")}`,
      action: decision.recommendedActionPath,
      category,
      timeWindow: category === "FIX NOW" ? "0-7 days" : category === "THIS MONTH" ? "7-30 days" : "ongoing",
      structuralSeverity: category === "FIX NOW" ? "High" : category === "THIS MONTH" ? "Medium" : "Low",
      evidenceStrength: decision.confidenceLevel,
      evidenceIds: decision.evidenceTraceReferences
    };
  });

  return {
    fixNow: items.filter((item) => item.category === "FIX NOW"),
    thisMonth: items.filter((item) => item.category === "THIS MONTH"),
    monitor: items.filter((item) => item.category === "MONITOR")
  };
}

function buildMarketReadinessPosition(dimensions: DimensionScore[], benchmarkContext: BenchmarkContext): MarketReadinessPosition {
  return {
    status: benchmarkContext.status,
    datasetLabel: benchmarkContext.datasetLabel,
    comparativeConfidenceScore: benchmarkContext.comparativeConfidenceScore,
    positions: dimensions.map((dimension) => ({
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      position: benchmarkContext.status === "available" ? benchmarkPositionForScore(dimension.score) : "Not Assessed",
      score: dimension.score,
      evidenceIds: dimension.evidenceIds
    })),
    limitation:
      benchmarkContext.status === "available"
        ? "Positions compare structural readiness against the internal SYSTOLAB reference dataset without rankings or winner declarations."
        : "Benchmark coverage is currently low, so market readiness positions are displayed as Not Assessed instead of approximated."
  };
}

function buildEvidenceCoverageSummary(pages: CollectedPage[], evidenceObjects: EvidenceObject[]): EvidenceCoverageSummary {
  const pageRows = pages.map((page) => {
    const pageEvidence = evidenceObjects.filter((evidence) => evidence.url === page.finalUrl);
    const signalKeys = Array.from(new Set(pageEvidence.map((evidence) => String(evidence.normalizedInput.signalKey ?? evidence.sourceType))));
    const coverageStatus: EvidenceCoverageSummary["pages"][number]["coverageStatus"] =
      pageEvidence.length >= 20 ? "Complete" : pageEvidence.length >= 8 ? "Partial" : "Limited";
    return {
      url: page.finalUrl,
      role: page.role,
      httpStatus: page.status,
      evidenceCount: pageEvidence.length,
      coverageStatus,
      keySignals: signalKeys.slice(0, 8)
    };
  });

  return {
    totalPagesSampled: pages.length,
    totalEvidenceObjects: evidenceObjects.length,
    pages: pageRows.length > 0
      ? pageRows
      : [
          {
            url: "not_fetched",
            role: "scan",
            httpStatus: "not_fetched",
            evidenceCount: evidenceObjects.length,
            coverageStatus: "Limited",
            keySignals: ["robots_or_fetch_limitation"]
          }
        ]
  };
}

function buildVitalSigns(dimensions: DimensionScore[]): BusinessVitalSign[] {
  const keys: DimensionKey[] = ["trust", "mobileExperience", "conversionReadiness", "informationClarity", "websiteHealth"];
  return keys.flatMap((key) => {
    const dimension = dimensions.find((item) => item.key === key);
    if (!dimension) return [];
    return {
      vitalSign: dimension.label,
      score: dimension.score,
      status: dimension.classification,
      visualState: dimension.visualState
    };
  });
}

function buildExecutiveSummary(
  dimensions: DimensionScore[],
  request: ScanRequest,
  competitorComparison: ComparativeFinding[],
  gbpIdentity: GbpIdentityAnalysis
): ExecutiveSummaryRow[] {
  const rows: ExecutiveSummaryRow[] = ["trust", "mobileExperience", "conversionReadiness", "websiteHealth"].flatMap((key) => {
    const dimension = dimensions.find((item) => item.key === key);
    if (!dimension) return [];
    return {
      area: dimension.label,
      currentStatus: dimension.classification,
      observedCondition: `${dimension.evidenceIds.length} structural evidence objects support this score.`,
      businessImpact: "May influence visitor clarity, confidence, or action readiness based on observable structure.",
      priorityLevel: dimension.score < 75 ? "High" : "Medium"
    };
  });

  if (rows.length === 0) {
    rows.push({
      area: "Website Content",
      currentStatus: "Content Unavailable",
      observedCondition: "No page content was collected for structural scoring.",
      businessImpact: "Business impact was not inferred because validated page evidence was unavailable.",
      priorityLevel: "Not Assessed"
    });
  }

  rows.push({
    area: "GBP Health",
    currentStatus: request.gbpUrl ? titleCaseStatus(gbpIdentity.status) : "Not Assessed",
    observedCondition: request.gbpUrl
      ? `Identity score ${gbpIdentity.identityConsistencyScore}, ${gbpIdentity.profileCompletenessLevel} profile completeness.`
      : "No Google Business Profile URL was provided.",
    businessImpact: request.gbpUrl
      ? "Supplementary identity consistency is visible without affecting OSS."
      : "Local identity enrichment was not assessed in this scan.",
    priorityLevel: request.gbpUrl ? "Medium" : "Not Assessed"
  });

  rows.push({
    area: "Competitor Position",
    currentStatus: competitorComparison.length > 0 ? "Assessed" : "Not Assessed",
    observedCondition:
      competitorComparison.length > 0
        ? `${competitorComparison.length} competitor URL(s) processed; ${competitorComparison.filter((item) => item.status === "assessed").length} assessed.`
        : "No competitor URLs were provided.",
    businessImpact:
      competitorComparison.length > 0
        ? "Comparative structural gaps are available without rankings or market claims."
        : "Market readiness comparison was not assessed in this scan.",
    priorityLevel: competitorComparison.length > 0 ? "Medium" : "Not Assessed"
  });

  return rows;
}

function buildConfidenceLayer(primary: SiteAnalysis): ConfidenceMetric[] {
  const base = primary.dimensions.map((dimension) => ({
    intelligenceArea: `${dimension.label} Analysis`,
    confidenceScore: dimension.confidenceScore,
    confidenceLevel: confidenceLevelForScore(dimension.confidenceScore),
    basis: `${dimension.evidenceIds.length} evidence objects, ${primary.coverage.coverageLabel}`
  }));
  const overall = clampScore(base.reduce((sum, item) => sum + item.confidenceScore, 0) / Math.max(1, base.length));
  return [
    {
      intelligenceArea: "Website Intelligence",
      confidenceScore: overall,
      confidenceLevel: confidenceLevelForScore(overall),
      basis: primary.coverage.coverageLabel
    },
    ...base
  ];
}

function buildBenchmarkContext(dimensions: DimensionScore[], benchmarkEngine: IndustryBenchmarkEngine): BenchmarkContext {
  return {
    status: benchmarkEngine.status === "not_available" ? "not_available" : "available",
    datasetLabel: `SYSTOLAB Internal ${benchmarkEngine.industryType} Benchmark (${benchmarkEngine.datasetVersion})`,
    sampleSize: benchmarkEngine.sampleSize,
    geography: "self-owned internal dataset",
    datasetAge: "seeded v1 baseline",
    comparativeConfidenceScore: benchmarkEngine.status === "seeded_internal_dataset" ? 68 : 0,
    positions: dimensions.map((dimension) => ({
      dimension: dimension.key,
      position: benchmarkEngine.currentPosition.find((item) => item.dimension === dimension.key)?.position ?? "Not Assessed",
      evidenceIds: dimension.evidenceIds
    }))
  };
}

function buildCompetitorComparison(primary: SiteAnalysis, competitors: CompetitorScanResult[]): ComparativeFinding[] {
  return competitors.map((result) => {
    if (!result.analysis) {
      return {
        status: "failed",
        competitorUrl: result.requestedUrl,
        competitorLabel: hostLabel(result.requestedUrl),
        primaryOss: primary.oss,
        competitorOss: null,
        assessedPages: 0,
        structuralGapSummary: "Competitor URL could not be assessed. The failure is shown instead of being hidden.",
        primaryStrengthCount: 0,
        competitorStrengthCount: 0,
        equivalentCount: 0,
        dataAvailability: "Competitor data unavailable",
        failureReason: result.failedReason,
        evidenceTraceabilityMap: primary.dimensions.map((dimension) => ({
          dimension: dimension.key,
          dimensionLabel: dimension.label,
          primaryScore: dimension.score,
          competitorScore: null,
          position: "structurally_equivalent",
          difference: 0,
          primaryEvidenceIds: dimension.evidenceIds,
          competitorEvidenceIds: []
        }))
      };
    }

    const competitor = result.analysis;
    const rows = primary.dimensions.map((dimension) => {
      const competitorDimension = competitor.dimensions.find((item) => item.key === dimension.key);
      const competitorScore = competitorDimension?.score ?? null;
      const delta = competitorScore === null ? 0 : dimension.score - competitorScore;
      const position: ComparativeFinding["evidenceTraceabilityMap"][number]["position"] =
        Math.abs(delta) <= 5 ? "structurally_equivalent" : delta > 0 ? "primary_stronger" : "primary_weaker";
      return {
        dimension: dimension.key,
        dimensionLabel: dimension.label,
        primaryScore: dimension.score,
        competitorScore,
        position,
        difference: delta,
        primaryEvidenceIds: dimension.evidenceIds,
        competitorEvidenceIds: competitorDimension?.evidenceIds ?? []
      };
    });
    const primaryStrengthCount = rows.filter((row) => row.position === "primary_stronger").length;
    const competitorStrengthCount = rows.filter((row) => row.position === "primary_weaker").length;
    const equivalentCount = rows.filter((row) => row.position === "structurally_equivalent").length;

    return {
      status: "assessed",
      competitorUrl: competitor.normalizedUrl.toString(),
      competitorLabel: hostLabel(competitor.normalizedUrl.toString()),
      primaryOss: primary.oss,
      competitorOss: competitor.oss,
      assessedPages: competitor.pages.length,
      structuralGapSummary: summarizeCompetitor(primaryStrengthCount, competitorStrengthCount, equivalentCount),
      primaryStrengthCount,
      competitorStrengthCount,
      equivalentCount,
      dataAvailability: `${competitor.coverage.sampledPages} competitor page(s) sampled; ${competitor.evidenceObjects.length} competitor evidence objects captured.`,
      evidenceTraceabilityMap: rows
    };
  });
}

function inferIndustryType(primary: SiteAnalysis): string {
  const searchable = [
    primary.normalizedUrl.hostname,
    ...primary.pages.slice(0, 2).map((page) => {
      const effectiveHtml = page.visual?.renderedHtml?.trim() ? page.visual.renderedHtml : page.html;
      return cheerio.load(effectiveHtml)("body").text().slice(0, 5000);
    })
  ].join(" ").toLowerCase();
  if (/dentist|dental|orthodont|implant|braces/.test(searchable)) return "dentist";
  if (/law firm|attorney|lawyer|legal|litigation|solicitor/.test(searchable)) return "law_firm";
  if (/cart|checkout|shop|store|product|ecommerce|e-commerce/.test(searchable)) return "ecommerce";
  if (/saas|software|platform|subscription|demo|pricing/.test(searchable)) return "saas";
  return "local_service";
}

function normalizeIndustryType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["dental", "dentistry", "orthodontist"].includes(normalized)) return "dentist";
  if (["law", "legal", "lawyer", "attorney"].includes(normalized)) return "law_firm";
  if (["e_commerce", "shop", "retail"].includes(normalized)) return "ecommerce";
  if (["software", "b2b_saas"].includes(normalized)) return "saas";
  return SEEDED_VERTICAL_BENCHMARKS.some((item) => item.industryType === normalized) ? normalized : "local_service";
}

function positionForBenchmarkDelta(delta: number): IndustryBenchmarkEngine["currentPosition"][number]["position"] {
  if (delta >= 6) return "Above Benchmark";
  if (delta <= -6) return "Below Benchmark";
  return "At Benchmark";
}

function competitorTimelinePoint(snapshotId: string, capturedAt: string, competitor: ComparativeFinding): CompetitorTimelinePoint {
  return {
    snapshotId,
    capturedAt,
    oss: competitor.competitorOss,
    dimensions: Object.fromEntries(
      competitor.evidenceTraceabilityMap.map((row) => [row.dimension, row.competitorScore ?? undefined]).filter(([, score]) => typeof score === "number")
    ) as Partial<Record<DimensionKey, number>>
  };
}

function normalizeUrlForCompare(value: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function suspectedReasonForDimension(dimension: DimensionKey, delta: number | null): string {
  if (delta === null) return "No prior competitor score was available for this dimension.";
  const direction = delta > 0 ? "improved" : "declined";
  const reason: Record<DimensionKey, string> = {
    trust: "review, about, policy, or contact trust signals changed",
    accessibility: "semantic labels, headings, alt text, or navigational accessibility changed",
    renderingQuality: "HTML/rendering availability changed",
    stability: "HTTP, robots, or fetch stability changed",
    mobileExperience: "viewport, responsive structure, or mobile readability changed",
    websiteHealth: "technical health and indexable structure changed",
    visibilityStructure: "metadata, headings, or crawlable structure changed",
    conversionReadiness: "CTA, form, phone, or contact action structure changed",
    informationClarity: "heading and content clarity changed"
  };
  return `${DIMENSION_LABELS[dimension]} ${direction}; suspected reason: ${reason[dimension]}.`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function summarizeCompetitor(primaryStrengthCount: number, competitorStrengthCount: number, equivalentCount: number): string {
  return `${primaryStrengthCount} dimension(s) structurally stronger for the client, ${competitorStrengthCount} dimension(s) structurally stronger for the competitor, and ${equivalentCount} structurally equivalent. No rankings or market-performance claims are made.`;
}

function hostLabel(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function titleCaseStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDataInputs(request: ScanRequest): DataInputStatus[] {
  return [
    { source: "Website URL", status: "Provided" },
    {
      source: "Google Business Profile URL",
      status: request.gbpUrl ? "Provided" : "Not Assessed",
      reason: request.gbpUrl ? "GBP URL was provided as supplementary identity context." : "No Google Business Profile URL was provided."
    },
    {
      source: "Competitor URLs",
      status: request.competitorUrls?.length ? "Provided" : "Not Assessed",
      reason: request.competitorUrls?.length ? `${request.competitorUrls.length} competitor URLs were provided.` : "No competitor URLs were provided."
    }
  ];
}

function buildDecisionSummary(decisions: DecisionOutput[]): string {
  if (decisions.length === 0) return "No validated structural decisions were generated from the sampled evidence.";
  const first = decisions[0]!;
  return `SYSTEM DECISION SUMMARY - ACTIONABLE STRUCTURAL OUTCOME: ${first.decisionClassification}. ${first.recommendedActionPath}`;
}

function buildGroundTruthValidationLog(
  evidenceObjects: EvidenceObject[],
  validationTrace: ValidationTraceEntry[],
  gbpIdentity: GbpIdentityAnalysis
): GroundTruthValidationLogEntry[] {
  const entries: GroundTruthValidationLogEntry[] = [
    buildValidationLogEntry("GTV-001", "Primary CTA", ["cta_present"], evidenceObjects, validationTrace),
    buildValidationLogEntry("GTV-002", "Primary CTA Above Fold", ["primary_cta_above_fold"], evidenceObjects, validationTrace),
    buildValidationLogEntry("GTV-003", "H1 Heading", ["h1_present"], evidenceObjects, validationTrace),
    buildValidationLogEntry("GTV-004", "Trust Signals", ["privacy_link_present", "about_link_present", "contact_signal_present"], evidenceObjects, validationTrace)
  ];

  const gbpEvidenceIds = gbpIdentity.evidenceIds;
  const gbpTraceIds = validationTrace.filter((trace) => trace.evidenceId && gbpEvidenceIds.includes(trace.evidenceId)).map((trace) => trace.traceId);
  entries.push({
    logId: "GTV-005",
    check: "GBP Identity Consistency",
    signalKeys: ["gbp_business_name", "gbp_address_presence", "gbp_hours_presence", "gbp_phone_presence"],
    httpResult: gbpIdentity.status === "not_assessed" ? "not_checked" : gbpIdentity.status === "failed" ? "not_found" : "found",
    domResult: gbpIdentity.status === "assessed" || gbpIdentity.status === "limited" ? "found" : "not_checked",
    renderResult: "not_rendered",
    outcome:
      gbpIdentity.identityMismatchFlag === "possible_mismatch"
        ? "identity mismatch warning surfaced"
        : gbpIdentity.identityMismatchFlag === "not_detected"
          ? "website and public GBP identity signals did not show a mismatch"
          : "GBP identity consistency was not conclusive",
    gtcsScore: gbpIdentity.confidenceScore,
    gtcsMeaning: gtcsMeaning(gbpIdentity.confidenceScore),
    evidenceIds: gbpEvidenceIds,
    validationTraceIds: gbpTraceIds
  });

  return entries;
}

function buildValidationLogEntry(
  logId: string,
  check: GroundTruthValidationLogEntry["check"],
  signalKeys: string[],
  evidenceObjects: EvidenceObject[],
  validationTrace: ValidationTraceEntry[]
): GroundTruthValidationLogEntry {
  const evidence = signalKeys.flatMap((key) => evidenceForSignal(evidenceObjects, key));
  const evidenceIds = evidence.map((item) => item.evidenceId);
  const traces = validationTrace.filter((trace) => trace.evidenceId && evidenceIds.includes(trace.evidenceId));
  const foundCount = signalKeys.filter((key) => signalObserved(evidenceObjects, key)).length;
  const fullyFound = foundCount === signalKeys.length;
  const partiallyFound = foundCount > 0;
  const gtcsScore = evidence.length
    ? clampScore(evidence.reduce((sum, item) => sum + item.groundTruthConfidence, 0) / evidence.length)
    : 0;

  return {
    logId,
    check,
    signalKeys,
    httpResult: signalObserved(evidenceObjects, "http_status_success") ? "found" : "not_found",
    domResult: fullyFound ? "found" : partiallyFound ? "found" : "not_found",
    renderResult:
      check === "Primary CTA Above Fold"
        ? fullyFound
          ? "found"
          : "not_found"
        : evidence.some((item) => item.renderVisibility === "visible_above_fold" || item.renderVisibility === "visible_below_fold")
          ? "found"
          : evidence.length > 0
            ? "not_found"
            : "not_checked",
    outcome: fullyFound
      ? `${check} verified across available HTTP, DOM, and render-position evidence.`
      : partiallyFound
        ? `${check} partially verified; at least one required signal is missing.`
        : `${check} not verified in sampled evidence.`,
    gtcsScore,
    gtcsMeaning: gtcsMeaning(gtcsScore),
    evidenceIds,
    validationTraceIds: traces.map((trace) => trace.traceId)
  };
}

function buildReportGovernance(): ReportSnapshot["reportGovernance"] {
  return {
    version: "SYSTOLAB Governance v1.0",
    systemRules: [
      "Reports must render decision layer, insight layer, and proof layer in that order.",
      "Every score must include numeric value, visual intelligence state, confidence, and evidence references.",
      "Every action must map to one explanation, one executable fix, and one evidence cluster.",
      "Every signal must receive one primary classification and one owning intelligence layer before report output.",
      "Every customer-facing insight must map back to one canonical issue representation."
    ],
    outputFormat: ["decision_layer", "insight_layer", "proof_layer"],
    constraints: [
      "No Google APIs, paid SEO APIs, analytics APIs, AI scoring APIs, or external performance APIs are used.",
      "OSS is based only on deterministic website, GBP public page, and competitor public page signals.",
      "Structural impact ranges are directional readiness ranges, not revenue forecasts or guaranteed outcomes."
    ],
    nonOverridableRules: [
      "Do not remove required report sections.",
      "Do not rename OSS, GTCS, Visual Intelligence states, or priority timeline labels.",
      "Do not change OSS scoring weights without versioning the scoring engine.",
      "Do not merge competitor tables across domains.",
      "Do not skip evidence logs, validation traces, telemetry, or data freshness."
    ],
    fallbackRules: [
      "If crawl access is blocked, return analysis_limited with robots/fetch evidence.",
      "If GBP extraction is limited, keep GBP supplementary and surface confidence limitations.",
      "If competitor extraction fails, preserve a failed competitor block instead of hiding it."
    ],
    rejectionRules: [
      "Reject private, local, non-HTTP, and unsafe URLs before crawling.",
      "Reject claims that imply revenue, profit, ranking, traffic, or conversion guarantees.",
      "Reject untraceable findings that do not include EO references.",
      "Reject duplicate customer-facing conclusions that restate the same canonical issue in multiple forms."
    ],
    ossCalculationLogic:
      "OSS v1.0 is the weighted average of deterministic dimension scores: trust 16%, accessibility 10%, rendering quality 10%, stability 10%, mobile experience 14%, website health 12%, visibility structure 10%, conversion readiness 14%, information clarity 4%."
  };
}

function buildStructuredOutputSchema(): ReportSnapshot["structuredOutputSchema"] {
  return {
    schemaVersion: "systolab.report.v1",
    requiredTopLevelKeys: [
      "actionFirstPanel",
      "systemVerdict",
      "ossInterpretation",
      "businessVitalSigns",
      "dimensions",
      "gbpIdentity",
      "competitorComparison",
      "businessOutcomeBridge",
      "unifiedIssueCanvas",
      "globalOutputContract",
      "revenueIntelligence",
      "recommendationEngine",
      "lightweightChangeDetection",
      "evidenceDatabase",
      "recommendationOutcomeLoop",
      "businessOutcomeAttributionLayer",
      "dependencyIntelligenceLayer",
      "recommendationSequencingEngine",
      "evidenceFreshnessGovernanceLayer",
      "closedLoopOutcomeVerificationLayer",
      "businessObjectiveAlignmentValidation",
      "confidenceEngine",
      "industryBenchmarkEngine",
      "competitorIntelligenceEngine",
      "monitoringScheduler",
      "alertEngine",
      "operationalMemoryGraph",
      "businessEvolutionEngine",
      "competitiveThreatRadar",
      "businessDnaEngine",
      "editIntelligenceSystem",
      "architectureState",
      "evidenceObjects",
      "groundTruthValidationLog",
      "rawSignalTelemetry"
    ],
    layerKeys: {
      decision_layer: ["actionFirstPanel", "systemVerdict", "ossInterpretation", "verdictCard", "businessRiskStatus", "globalOutputContract"],
      insight_layer: [
        "businessVitalSigns",
        "dimensions",
        "unifiedIssueCanvas",
        "gbpIdentity",
        "competitorComparison",
        "businessOutcomeBridge",
        "revenueIntelligence",
        "recommendationEngine",
        "industryBenchmarkEngine",
        "competitorIntelligenceEngine",
        "monitoringScheduler",
        "alertEngine",
        "businessEvolutionEngine",
        "competitiveThreatRadar",
        "businessDnaEngine",
        "editIntelligenceSystem",
        "priorityTimeline",
        "transformationIntelligence",
        "marketReadinessPosition"
      ],
      proof_layer: [
        "evidenceObjects",
        "evidenceDatabase",
        "evidenceClusters",
        "recommendationOutcomeLoop",
        "businessOutcomeAttributionLayer",
        "dependencyIntelligenceLayer",
        "recommendationSequencingEngine",
        "evidenceFreshnessGovernanceLayer",
        "closedLoopOutcomeVerificationLayer",
        "businessObjectiveAlignmentValidation",
        "confidenceEngine",
        "operationalMemoryGraph",
        "groundTruthValidationLog",
        "validationTrace",
        "rawSignalTelemetry",
        "systemHealthState",
        "executionProvenance",
        "freshness",
        "integrity",
        "architectureState"
      ]
    }
  };
}

function buildSystemHealth(primary: SiteAnalysis, telemetry: RawSignalEvent[]): SystemHealthState {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const errors = telemetry.filter((event) => event.level === "error").length;
  const parserSuccessRate = primary.pages.length === 0 ? 0 : 100;
  const overallReliability = errors > 2 || parserSuccessRate < 60 ? "unstable" : errors > 0 ? "degraded" : "optimal";
  const cpuLoadPercent = clampScore((cpu.user / 1000 / Math.max(1, process.uptime() * 1000)) * 100);
  return {
    crawlerStability: overallReliability,
    parserSuccessRate,
    renderEngineStatus: "html_only",
    memoryUsageMb: Math.round(memory.rss / 1024 / 1024),
    cpuUserMicros: cpu.user,
    cpuLoadPercent,
    queueLatencyMs: 0,
    errorRate: telemetry.length === 0 ? 0 : Number((errors / telemetry.length).toFixed(3)),
    overallReliability
  };
}

function buildExecutionProvenance(primary: SiteAnalysis, failedFetches: Array<{ url: string; reason: string }>, executionTimeMs: number): ExecutionProvenance {
  return {
    systemVersion: SYSTOLAB_VERSION,
    buildHash: env.buildHash,
    deploymentEnvironment: env.deploymentEnvironment,
    nodeClusterId: env.nodeClusterId,
    executionRegion: env.executionRegion,
    crawlEngine: "Node fetch + Cheerio deterministic extractor",
    pagesFetched: primary.pages.map((page) => page.finalUrl),
    failedFetches,
    executionTimeMs,
    timeoutMs: env.crawlTimeoutMs,
    retryCount: 0,
    javascriptRenderingMode: primary.renderState,
    robotsTxtComplianceStatus: primary.coverage.robotsTxtStatus
  };
}

function buildFreshness(createdAt: string): ReportSnapshot["freshness"] {
  const captured = new Date(createdAt);
  const next = new Date(captured.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    capturedAt: createdAt,
    cacheStatus: "live_capture",
    validityWindowHours: 168,
    stalenessRisk: "low",
    nextRecommendedScanAt: next.toISOString()
  };
}

function emptyAnalysis(
  normalizedUrl: URL,
  robotsStatus: ScanCoverage["robotsTxtStatus"],
  telemetry: RawSignalEvent[],
  failedFetches: Array<{ url: string; reason: string }>,
  snapshotSeed: string
): SiteAnalysis {
  const builder = new EvidenceBuilder(snapshotSeed);
  const evidenceObjects = [
    builder.add({
      sourceType: "system",
      url: normalizedUrl.toString(),
      pageRole: "scan",
      rawValue: "robots.txt blocked this scan",
      normalizedInput: { signalKey: "robots_allowed", value: false },
      validationMethod: "direct_extraction",
      confidenceBasis: "robots.txt rule evaluation",
      groundTruthConfidence: 95,
      dimensionRefs: ["stability"]
    })
  ];
  return {
    normalizedUrl,
    pages: [],
    discoveredPages: 0,
    coverage: {
      sampledPages: 0,
      discoveredPages: 0,
      coverageLabel: "0 pages sampled because robots.txt blocked crawling",
      robotsTxtStatus: robotsStatus,
      pageRoles: {}
    },
    evidenceObjects,
    evidenceClusters: buildEvidenceClusters(evidenceObjects),
    validationTrace: buildValidationTrace(evidenceObjects),
    rawSignalTelemetry: telemetry,
    dimensions: [],
    oss: 0,
    failedFetches,
    renderState: "not_rendered"
  };
}

// Returns a structured limited-assessment SiteAnalysis when the homepage fetch itself fails.
// Report assembly converts this into a content-unavailable, not-scored customer assessment.
function limitedAnalysis(
  normalizedUrl: URL,
  robotsStatus: ScanCoverage["robotsTxtStatus"],
  telemetry: RawSignalEvent[],
  failedFetches: Array<{ url: string; reason: string }>,
  snapshotSeed: string
): SiteAnalysis {
  const failReason = failedFetches[0]?.reason ?? "content unavailable";
  logger.warn("scan.content_unavailable", { url: normalizedUrl.toString(), reason: failReason });
  const builder = new EvidenceBuilder(snapshotSeed);
  const evidenceObjects = [
    builder.add({
      sourceType: "system",
      url: normalizedUrl.toString(),
      pageRole: "scan",
      rawValue: "Content unavailable — fetch failed after all retry attempts",
      normalizedInput: { signalKey: "fetch_success_rate", value: 0 },
      validationMethod: "direct_extraction",
      confidenceBasis: "fetch attempt outcome — all retry attempts exhausted",
      groundTruthConfidence: 95,
      dimensionRefs: ["stability"]
    })
  ];
  return {
    normalizedUrl,
    pages: [],
    discoveredPages: 0,
    coverage: {
      sampledPages: 0,
      discoveredPages: 0,
      coverageLabel: "0 pages sampled — content unavailable",
      robotsTxtStatus: robotsStatus,
      pageRoles: {}
    },
    evidenceObjects,
    evidenceClusters: buildEvidenceClusters(evidenceObjects),
    validationTrace: buildValidationTrace(evidenceObjects),
    rawSignalTelemetry: telemetry,
    dimensions: [],
    oss: 0,
    failedFetches,
    renderState: "not_rendered"
  };
}

function actionForDimension(dimension: DimensionKey, factorLabel?: string): string {
  const suffix = factorLabel ? ` Focus first on: ${factorLabel.toLowerCase()}.` : "";
  const actions: Record<DimensionKey, string> = {
    trust: "Strengthen visible identity, policy, and credibility signals near decision points.",
    accessibility: "Improve semantic structure, labels, language metadata, and image alternatives.",
    renderingQuality: "Reduce rendering cost and ensure primary content is available in deterministic HTML or stable render output.",
    stability: "Resolve fetch, HTTP status, redirect, and robots-related reliability issues.",
    mobileExperience: "Improve viewport, resource weight, and mobile contact/action paths.",
    websiteHealth: "Improve metadata, navigation, indexability, HTTP health, and security hygiene.",
    visibilityStructure: "Clarify page purpose through title, description, headings, canonical signals, and internal links.",
    conversionReadiness: "Move primary action paths and trust support into clearer structural positions.",
    informationClarity: "Clarify the offer, primary message, navigation path, and next action."
  };
  return `${actions[dimension]}${suffix}`;
}

function outcomeForDimension(dimension?: DimensionKey): string {
  if (!dimension) return "May improve structural clarity and action readiness after implementation.";
  const outcomes: Record<DimensionKey, string> = {
    trust: "May improve perceived legitimacy and confidence at decision points.",
    accessibility: "May reduce usability barriers and improve inclusive access paths.",
    renderingQuality: "May improve content availability, perceived speed, and render stability.",
    stability: "May improve basic website reliability and scan-access consistency.",
    mobileExperience: "May reduce mobile friction around viewing, tapping, and contacting.",
    websiteHealth: "May improve operational reliability, metadata quality, and technical hygiene.",
    visibilityStructure: "May improve how clearly users and crawlers understand page purpose.",
    conversionReadiness: "May improve action path clarity and lead-generation readiness.",
    informationClarity: "May improve first-impression clarity and reduce interpretation effort."
  };
  return outcomes[dimension];
}

function impactRangeForDimension(dimension: DimensionKey | undefined, score: number): BusinessOutcomeBridgeItem["quantifiedUpliftRange"] {
  const severity = score < 40 ? "critical" : score < 60 ? "high" : score < 75 ? "medium" : "low";
  const base = {
    critical: {
      informationClarity: "+14-22% clarity improvement",
      conversionReadiness: "+18-28% conversion readiness",
      trustStrength: "+10-16% trust improvement"
    },
    high: {
      informationClarity: "+8-14% clarity improvement",
      conversionReadiness: "+12-18% conversion readiness",
      trustStrength: "+5-9% trust improvement"
    },
    medium: {
      informationClarity: "+5-9% clarity improvement",
      conversionReadiness: "+8-12% conversion readiness",
      trustStrength: "+3-6% trust improvement"
    },
    low: {
      informationClarity: "+2-5% clarity improvement",
      conversionReadiness: "+3-6% conversion readiness",
      trustStrength: "+2-4% trust improvement"
    }
  }[severity];

  if (dimension === "trust") {
    return { ...base, trustStrength: severity === "critical" ? "+14-22% trust improvement" : "+8-14% trust improvement" };
  }
  if (dimension === "conversionReadiness" || dimension === "mobileExperience") {
    return { ...base, conversionReadiness: severity === "critical" ? "+20-30% conversion readiness" : "+12-18% conversion readiness" };
  }
  if (dimension === "informationClarity" || dimension === "visibilityStructure") {
    return { ...base, informationClarity: severity === "critical" ? "+16-24% clarity improvement" : "+8-14% clarity improvement" };
  }
  return base;
}

function evidenceForSignal(evidenceObjects: EvidenceObject[], signalKey: string): EvidenceObject[] {
  return evidenceObjects.filter((evidence) => evidence.normalizedInput.signalKey === signalKey);
}

function missingEvidenceForSignal(evidenceObjects: EvidenceObject[], signalKey: string): EvidenceObject[] {
  return evidenceForSignal(evidenceObjects, signalKey).filter((evidence) => !truthySignalValue(evidence.normalizedInput.value));
}

function signalObserved(evidenceObjects: EvidenceObject[], signalKey: string): boolean {
  return evidenceForSignal(evidenceObjects, signalKey).some((evidence) => truthySignalValue(evidence.normalizedInput.value));
}

function truthySignalValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value.length > 0 && value !== "false";
  return Boolean(value);
}

function clusterForDimension(evidenceClusters: EvidenceCluster[], dimension: DimensionKey): string {
  return evidenceClusters.find((cluster) => cluster.clusterId === `ECL-${dimension}`)?.clusterId ?? `ECL-${dimension}`;
}

function gtcsMeaning(score: number): string {
  if (score >= 85) return "High GTCS means the finding is supported by strong deterministic cross-source evidence.";
  if (score >= 70) return "Moderate GTCS means the finding is usable with documented validation limits.";
  if (score >= 50) return "Limited GTCS means the finding should be reviewed before major implementation work.";
  return "Low GTCS means the signal is retained as a limitation or failure state, not a strong finding.";
}

function projectedLiftForScore(score: number): number {
  if (score < 40) return 22;
  if (score < 60) return 16;
  if (score < 75) return 10;
  if (score < 90) return 5;
  return 2;
}

function benchmarkPositionForScore(score: number): MarketReadinessPosition["positions"][number]["position"] {
  if (score >= 80) return "Above Benchmark";
  if (score >= 60) return "At Benchmark";
  return "Below Benchmark";
}

function scoreSecurityHeaders(headers: Record<string, string>): number {
  const required = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"];
  const found = required.filter((header) => Boolean(headers[header])).length;
  return clampScore((found / required.length) * 100);
}

function pickSecurityHeaders(headers: Record<string, string>): Record<string, string | undefined> {
  return {
    "strict-transport-security": headers["strict-transport-security"],
    "content-security-policy": headers["content-security-policy"],
    "x-content-type-options": headers["x-content-type-options"],
    "x-frame-options": headers["x-frame-options"],
    "referrer-policy": headers["referrer-policy"]
  };
}

function buildHttpSnippet(page: CollectedPage): string {
  return snippet(
    JSON.stringify({
      status: page.status,
      finalUrl: page.finalUrl,
      headers: pickSecurityHeaders(page.headers)
    })
  );
}

function scoreResourceWeight(htmlBytes: number, scripts: number, styles: number, images: number): number {
  const bytePenalty = Math.min(45, htmlBytes / 35_000);
  const scriptPenalty = Math.min(25, scripts * 2.2);
  const stylePenalty = Math.min(15, styles * 1.4);
  const imagePenalty = Math.min(15, images * 0.9);
  return clampScore(100 - bytePenalty - scriptPenalty - stylePenalty - imagePenalty);
}

function scoreDomComplexity(nodes: number): number {
  if (nodes <= 350) return 100;
  if (nodes >= 3000) return 25;
  return clampScore(100 - ((nodes - 350) / 2650) * 75);
}

function scoreTextDensity(textLength: number, htmlBytes: number): number {
  if (htmlBytes <= 0) return 0;
  const density = textLength / htmlBytes;
  if (density >= 0.14) return 100;
  if (density <= 0.02) return 25;
  return clampScore((density / 0.14) * 100);
}

function classifyPageRenderState(html: string, textLength: number, scriptCount: number): Exclude<RenderState, "not_rendered"> {
  if (/login|sign in|authenticate|password/i.test(html) && textLength < 500) return "authentication_restricted";
  if (scriptCount > 18 && textLength < 700) return "dynamic_javascript";
  if (scriptCount > 8 || /id=["']root["']|id=["']app["']/i.test(html)) return "hybrid_rendering";
  return "static_html";
}

function classifySiteRenderState(evidenceObjects: EvidenceObject[]): RenderState {
  const renderEvidence = evidenceObjects.filter((evidence) => evidence.normalizedInput.signalKey === "render_environment_score");
  if (renderEvidence.length === 0) return "not_rendered";
  const average = renderEvidence.reduce((sum, evidence) => sum + Number(evidence.normalizedInput.value ?? 0), 0) / renderEvidence.length;
  if (average >= 90) return "static_html";
  if (average >= 50) return "hybrid_rendering";
  if (average > 0) return "dynamic_javascript";
  return "authentication_restricted";
}

function pushTelemetry(
  telemetry: RawSignalEvent[],
  stage: RawSignalEvent["stage"],
  level: RawSignalEvent["level"],
  message: string,
  metadata?: Record<string, unknown>
): void {
  telemetry.push({
    eventId: `RSE-${String(telemetry.length + 1).padStart(4, "0")}`,
    timestamp: new Date().toISOString(),
    stage,
    level,
    message,
    metadata
  });
}
