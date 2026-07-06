import type { EvidenceObject, ReportSnapshot } from "@systolab/shared";
import { NOT_SCORED_VISUAL_STATE } from "@systolab/shared";

type JsonRecord = Record<string, unknown>;

const INTERNAL_TOP_LEVEL_KEYS = new Set([
  "architectureState",
  "businessObjectiveAlignmentValidation",
  "businessOutcomeAttributionLayer",
  "closedLoopOutcomeVerificationLayer",
  "closedLoopProofSystem",
  "dataInputs",
  "dependencyIntelligenceLayer",
  "editIntelligenceSystem",
  "evidenceClusters",
  "evidenceDatabase",
  "evidenceFreshnessGovernanceLayer",
  "evidenceObjects",
  "executionProvenance",
  "groundTruthValidationLog",
  "globalOutputContract",
  "integrity",
  "monitoringScheduler",
  "operationalMemoryGraph",
  "recommendationOutcomeLoop",
  "recommendationSequencingEngine",
  "rawSignalTelemetry",
  "reportGovernance",
  "structuredOutputSchema",
  "systemHealthState",
  "validationTrace"
]);

const INTERNAL_FIELD_KEYS = new Set([
  "actionId",
  "alertId",
  "baselineSnapshotId",
  "buildHash",
  "changeId",
  "clusterId",
  "decisionId",
  "edgeId",
  "eventId",
  "evidenceClusterId",
  "evidenceId",
  "evidenceIds",
  "evidenceTraceReferences",
  "factorId",
  "hash",
  "httpSnippet",
  "immutableVerificationFingerprint",
  "lineage",
  "logId",
  "nodeClusterId",
  "nodeId",
  "normalizedInput",
  "parserVersion",
  "previousSnapshotId",
  "primaryEvidenceIds",
  "rawDomSnapshot",
  "rawValue",
  "recommendationId",
  "recommendationIds",
  "renderVerification",
  "screenshotRef",
  "selectorPath",
  "sourceEvidenceIds",
  "trace",
  "traceId",
  "validationTraceIds"
]);

const INTERNAL_TEXT_PATTERN =
  /HTTP fetch failed|parser success|parserSuccess|robots unavailable|crawler diagnostics|recovery logs|rawSignalTelemetry|executionProvenance|validationTrace|Cloudflare|JS Challenge|bot protection|retry count|headless browser|raw DOM|selector path/i;

export function isContentUnavailableReport(report: ReportSnapshot): boolean {
  return !report.oss || report.status === "content_unavailable" || report.oss.scoringStatus === "not_scored" || report.oss.score === null;
}

export function buildCustomerReportPayload(report: ReportSnapshot): Record<string, unknown> {
  const contentUnavailable = isContentUnavailableReport(report);
  const payload = stripInternalFields({
    snapshotId: report.snapshotId,
    createdAt: report.createdAt,
    status: contentUnavailable ? "content_unavailable" : report.status,
    targetUrl: report.targetUrl,
    mode: report.mode,
    tenantBranding: report.tenantBranding,
    clientInformation: report.clientInformation,
    scanCoverage: contentUnavailable ? unavailableScanCoverage() : sanitizeScanCoverage(report),
    executiveClarity: stripInternalFields(report.executiveClarity),
    verdictCard: stripInternalFields(report.verdictCard),
    actionFirstPanel: sanitizeActionFirstPanel(report),
    systemVerdict: stripInternalFields(report.systemVerdict),
    ossInterpretation: contentUnavailable ? unavailableOssInterpretation() : stripInternalFields(report.ossInterpretation),
    businessRiskStatus: contentUnavailable ? unavailableBusinessRiskStatus() : stripInternalFields(report.businessRiskStatus),
    decisionIntelligenceBrief: contentUnavailable ? unavailableDecisionBrief(report) : stripInternalFields(report.decisionIntelligenceBrief),
    oss: contentUnavailable ? unavailableOss() : stripInternalFields(report.oss),
    businessVitalSigns: contentUnavailable ? [] : stripInternalFields(report.businessVitalSigns ?? []),
    executiveSummaryTable: stripInternalFields(report.executiveSummaryTable ?? []),
    confidenceEngine: sanitizeConfidenceEngine(report),
    evidenceCoverageSummary: contentUnavailable ? unavailableEvidenceCoverageSummary() : sanitizeEvidenceCoverageSummary(report),
    dimensions: contentUnavailable ? [] : sanitizeDimensions(report),
    decisionSummary: sanitizeCustomerText(report.decisionSummary),
    customerBusinessDecisionSummary: buildCustomerBusinessDecisionSummary(report, contentUnavailable),
    businessOutcomeBridge: contentUnavailable ? [] : stripInternalFields(report.businessOutcomeBridge ?? []),
    revenueIntelligence: contentUnavailable ? unavailableRevenueIntelligence() : sanitizeRevenueIntelligence(report),
    recommendationEngine: contentUnavailable ? unavailableRecommendationEngine() : sanitizeRecommendationEngine(report),
    priorityTimeline: contentUnavailable ? unavailablePriorityTimeline() : sanitizePriorityTimeline(report),
    marketReadinessPosition: stripInternalFields(report.marketReadinessPosition),

    benchmarkContext: stripInternalFields(report.benchmarkContext),
    industryBenchmarkEngine: sanitizeIndustryBenchmark(report),
    competitorComparison: sanitizeCompetitorComparison(report),
    competitorIntelligenceEngine: sanitizeCompetitorIntelligence(report),
    businessEvolutionEngine: stripInternalFields(report.businessEvolutionEngine),
    competitiveThreatRadar: stripInternalFields(report.competitiveThreatRadar),
    businessDnaEngine: stripInternalFields(report.businessDnaEngine),
    transformationIntelligence: stripInternalFields(report.transformationIntelligence),
    optionalSections: report.optionalSections,
    freshness: stripInternalFields(report.freshness),
    customerAssessment: buildCustomerAssessment(report, contentUnavailable),
    customerExecutiveNarrative: buildCustomerExecutiveNarrative(report, contentUnavailable),
    customerBusinessDecisionSnapshot: buildCustomerBusinessDecisionSnapshot(report, contentUnavailable),
    customerBusinessHealthSnapshot: buildCustomerBusinessDecisionSnapshot(report, contentUnavailable),
    customerHesitationAreas: buildCustomerHesitationAreas(report, contentUnavailable),
    customerCompetitorNarrative: buildCustomerCompetitorNarrative(report, contentUnavailable),
    customerTopPriority: buildCustomerTopPriority(report, contentUnavailable),
    customerExpectedBusinessOutcomes: buildCustomerExpectedBusinessOutcomes(report, contentUnavailable),
    customerBusinessInitiatives: buildCustomerBusinessInitiatives(report, contentUnavailable),
    customerSeoBusinessQuestions: buildCustomerSeoBusinessQuestions(report, contentUnavailable),
    customerEvidenceItems: buildCustomerEvidenceItems(report, contentUnavailable),
    customerIntelligenceSummaries: contentUnavailable ? [] : buildCustomerIntelligenceSummaries(report),
    customerLocalVisibility: buildCustomerLocalVisibility(report, contentUnavailable),
    customerCompetitorContentComparison: buildCustomerCompetitorContentComparison(report, contentUnavailable),
    customerQuestionCoverage: buildCustomerQuestionCoverage(report, contentUnavailable),
    customerCompetitorWinReasons: buildCustomerCompetitorWinReasons(report, contentUnavailable),
    customerRevenueLeakage: buildCustomerRevenueLeakage(report, contentUnavailable),
    customerBusinessOutcomeSummary: buildCustomerOutcomeAttribution(report, contentUnavailable),
    customerIssueConnectionSummary: buildCustomerDependencySummary(report, contentUnavailable),
    customerImplementationRoadmap: buildCustomerRecommendationRoadmap(report, contentUnavailable),
    customerClientSuccessBlueprint: buildCustomerClientSuccessBlueprint(report, contentUnavailable)
  }) as JsonRecord;

  for (const key of INTERNAL_TOP_LEVEL_KEYS) delete payload[key];
  return payload;
}

function buildCustomerBusinessDecisionSummary(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const contract = (report as unknown as { globalOutputContract?: ReportSnapshot["globalOutputContract"] }).globalOutputContract;
  if (contentUnavailable || !contract) {
    return {
      status: contentUnavailable ? "content_unavailable" : "active",
      confidenceScore: contentUnavailable ? "0%" : `${Math.round(report.confidenceEngine?.overallConfidenceScore ?? 0)}%`,
      decisions: [],
      businessDrivers: [],
      revenueImpactAreas: [],
      priorityActions: [],
      evidenceStrength: contentUnavailable ? "Very limited" : "Limited",
      limitations: [contentUnavailable ? "Website content could not be collected, so business decisions were not generated." : "No business decision passed the evidence threshold."]
    };
  }

  return {
    status: contract.status,
    confidenceScore: `${Math.round(contract.confidenceScore)}%`,
    decisions: dedupeCustomerDecisionRows(
      contract.keyDecisionSummary.map((item, index) => ({
        title: `Business decision ${index + 1}`,
        priority: sanitizeCustomerText(item.priorityTier),
        meaning: sanitizeCustomerText(item.summary)
      })),
      "Business decision"
    ),
    businessDrivers: contract.rootCauseClusters.slice(0, 5).map((item, index) => ({
      title: `Business driver ${index + 1}`,
      driver: sanitizeCustomerText(item.primaryCausalDriver),
      meaning: sanitizeCustomerText(item.rootCauseStatement)
    })),
    revenueImpactAreas: contract.revenueImpactAreas.slice(0, 5).map((item) => ({
      area: sanitizeCustomerText(item.impactArea),
      businessImpact: sanitizeCustomerText(item.businessImpact),
      confidence: `${Math.round(item.confidenceScore)}%`
    })),
    priorityActions: dedupeCustomerDecisionRows(
      contract.actionPlanMapping.map((item, index) => ({
        title: `Priority action ${index + 1}`,
        action: sanitizeCustomerText(item.authoritativeAction),
        priority: sanitizeCustomerText(item.priorityTier)
      })),
      "Priority action"
    ),
    evidenceStrength: summarizeCustomerEvidenceStrength(report),
    limitations: contract.limitations.map(sanitizeCustomerText)
  };
}
function buildCustomerExecutiveNarrative(report: ReportSnapshot, contentUnavailable: boolean): string {
  if (contentUnavailable) {
    return "Website content was not available for a full customer decision assessment. SYSTOLAB did not infer business impact, risk, conversion loss, or revenue loss without validated current-scan evidence.";
  }
  const score = typeof report.oss?.score === "number" ? report.oss.score : null;
  const dimensions = report.dimensions ?? [];
  const weakest = dimensions.slice().sort((a, b) => a.score - b.score)[0];
  const strongest = dimensions.slice().sort((a, b) => b.score - a.score)[0];
  const competitorGaps = buildCustomerCompetitorContentComparison(report, false)["contentGaps"] as Array<Record<string, unknown>>;
  const foundation = score === null ? "limited" : score >= 80 ? "strong" : score >= 65 ? "solid" : score >= 50 ? "recoverable" : "fragile";
  const strongestText = strongest
    ? `${sanitizeCustomerText(strongest.label)} is currently the strongest signal for customer confidence.`
    : "The scan found some usable customer decision signals.";
  const weakLabel = weakest ? sanitizeCustomerText(weakest.label).toLowerCase() : "decision support";
  const competitorText = competitorGaps.length
    ? "Competitors generally provide stronger decision-support content in the areas listed below, which may influence customers during evaluation."
    : "Competitor intelligence did not validate a stronger external advantage in this scan.";
  return `Your business presents a ${foundation} foundation for customer trust and conversion. ${strongestText} The largest opportunity is improving ${weakLabel} so visitors reach key information and act with less friction. ${competitorText}`;
}

function buildCustomerBusinessDecisionSnapshot(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, string>> {
  if (contentUnavailable) {
    return [
      { area: "Business Readiness", status: "Not Assessed", meaning: "Website content could not be collected, so readiness was not scored." },
      { area: "Customer Decision Confidence", status: "Very Limited", meaning: "Trust, clarity, and action-path signals could not be validated from current evidence." },
      { area: "Competitive Position", status: "Not Assessed", meaning: "Competitor position was not inferred without customer website evidence." },
      { area: "Revenue Opportunity", status: "Not Assessed", meaning: "Revenue opportunity was not estimated without validated page evidence." },
      { area: "Priority Focus", status: "Review Access", meaning: "Allow content collection and re-run the assessment before making business decisions." }
    ];
  }

  const score = typeof report.oss?.score === "number" ? report.oss.score : null;
  const weakest = (report.dimensions ?? []).slice().sort((a, b) => a.score - b.score)[0];
  const competitorGaps = buildCustomerCompetitorContentComparison(report, false)["contentGaps"] as unknown[];
  const decisionConfidence = averageNullable([
    scoreForDimension(report, "trust"),
    scoreForDimension(report, "informationClarity"),
    scoreForDimension(report, "conversionReadiness"),
    scoreForDimension(report, "mobileExperience")
  ]);
  const revenue = buildCustomerRevenueLeakage(report, false) as Record<string, unknown>;
  const priorityLabel = weakest ? `Improve ${sanitizeCustomerText(weakest.label)}` : "Improve Decision Support";

  return [
    { area: "Business Readiness", status: healthStatusForScore(score), meaning: "How ready the website appears to support customer trust, understanding, and action based on validated scan evidence." },
    { area: "Customer Decision Confidence", status: healthStatusForScore(decisionConfidence), meaning: "How confidently a visitor can understand the offer, trust the business, and choose the next step." },
    { area: "Competitive Position", status: competitorGaps.length ? competitiveMomentumForGapCount(competitorGaps.length) : "Competitive", meaning: competitorGaps.length ? "Validated competitor evidence suggests stronger decision support in selected areas." : "No validated competitor advantage was found from the available comparison evidence." },
    { area: "Revenue Opportunity", status: String(revenue["valueContext"] ?? "Evidence-bound opportunity"), meaning: "The practical opportunity indicated by current customer friction, not a guaranteed revenue claim." },
    { area: "Priority Focus", status: priorityLabel, meaning: "The first business area to improve based on the weakest validated customer decision signal." }
  ];
}

function buildCustomerHesitationAreas(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, string>> {
  if (contentUnavailable) {
    return [{
      area: "Content Access",
      whatIsHappening: "Website content could not be collected for analysis.",
      whyItMatters: "SYSTOLAB cannot validate where customers hesitate without current page evidence.",
      action: "Review access/security settings and re-run the assessment.",
      confidence: "Very limited"
    }];
  }

  const weakDimensions = (report.dimensions ?? [])
    .filter((dimension) => dimension.score < 76)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((dimension) => ({
      area: sanitizeCustomerText(dimension.label),
      whatIsHappening: `${sanitizeCustomerText(dimension.label)} is ${dimension.score}/100 in the validated scan evidence.`,
      whyItMatters: customerImpactForDimensionKey(dimension.key),
      action: actionForDimensionKey(dimension.key),
      confidence: `${dimension.confidenceScore}% ${sanitizeCustomerText(dimension.confidenceLevel)}`
    }));

  if (weakDimensions.length) return weakDimensions;
  return [{
    area: "Customer Decision Path",
    whatIsHappening: "No major hesitation area passed the reporting threshold in this scan.",
    whyItMatters: "The validated evidence suggests the current decision path is broadly usable.",
    action: "Maintain proof, clarity, contact visibility, and customer-answer coverage while monitoring competitors.",
    confidence: summarizeCustomerEvidenceStrength(report)
  }];
}

function buildCustomerCompetitorNarrative(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  if (contentUnavailable) {
    return {
      title: "Why Customers May Choose Competitors",
      summary: "Competitor advantage was not inferred because customer website content could not be collected.",
      momentum: "Not Assessed",
      costOfDelay: "Re-run the assessment after content collection is available before making competitive conclusions.",
      limitations: ["Competitive momentum requires validated customer website evidence and comparable competitor evidence."]
    };
  }

  const comparison = buildCustomerCompetitorContentComparison(report, false) as Record<string, unknown>;
  const gaps = Array.isArray(comparison["contentGaps"]) ? comparison["contentGaps"] as Array<Record<string, unknown>> : [];
  return {
    title: "Why Customers May Choose Competitors",
    summary: gaps.length
      ? "Based on the validated pages analysed, competitors may present stronger trust signals, answer more customer questions, or make services easier to evaluate. These differences may encourage potential customers to compare alternatives before contacting your business."
      : "This scan did not validate a specific competitor advantage beyond the available score-level comparison.",
    momentum: competitiveMomentumForGapCount(gaps.length),
    costOfDelay: gaps.length
      ? "While these decision gaps remain unresolved, potential customers may continue comparing alternatives before contacting your business. Competitors may strengthen their customer experience and visibility over time, making it harder to improve your relative competitive position."
      : "No evidence-bound cost of delay was generated for competitor movement in this scan.",
    limitations: gaps.length ? textArray(comparison["limitations"]) : ["Add competitor URLs and allow full content collection to compare FAQs, process detail, pricing cues, trust proof, and educational depth."]
  };
}

function buildCustomerTopPriority(report: ReportSnapshot, contentUnavailable: boolean): Record<string, string> {
  if (contentUnavailable) {
    return {
      recommendedPriority: "Review access/security settings and re-run scan.",
      whyItMatters: "Current website evidence was unavailable, so SYSTOLAB did not generate a structural business priority.",
      expectedBusinessBenefit: "A successful re-scan can support evidence-bound prioritization.",
      confidence: "Very limited",
      effort: "Medium",
      firstAction: "Confirm the website allows analysis access."
    };
  }

  const recommendations = report.recommendationEngine?.recommendations ?? [];
  const first = recommendations[0];
  const weakest = (report.dimensions ?? []).slice().sort((a, b) => a.score - b.score)[0];
  const action = sanitizeCustomerText(first?.action ?? (weakest ? actionForDimensionKey(weakest.key) : "Improve the clearest customer decision gap first."));
  return {
    recommendedPriority: action,
    whyItMatters: "Improving this area is expected to reduce customer hesitation at a key decision point. Based on validated evidence, it is the improvement most likely to strengthen customer confidence or next-step clarity first.",
    expectedBusinessBenefit: expectedOutcomeForAction(action),
    confidence: first ? `${first.confidenceScore}%` : summarizeCustomerEvidenceStrength(report),
    effort: effortForAction(action),
    firstAction: firstActionForRecommendation(action)
  };
}

function buildCustomerExpectedBusinessOutcomes(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, string>> {
  const confidence = contentUnavailable ? "Very limited" : summarizeCustomerEvidenceStrength(report);
  return [
    { improvement: "Customer decision path", expectedOutcome: contentUnavailable ? "Outcome not estimated until content is available." : "More visitors understand your offer and are more likely to enquire.", confidence },
    { improvement: "Trust signals", expectedOutcome: contentUnavailable ? "Trust outcomes were not assessed." : "More customers feel confident contacting your business.", confidence },
    { improvement: "Local presence", expectedOutcome: contentUnavailable ? "Local visibility was not assessed." : "Better visibility among nearby customers searching for your services.", confidence },
    { improvement: "Customer question coverage", expectedOutcome: contentUnavailable ? "Question coverage was not assessed." : "Fewer unanswered objections during the buying process.", confidence }
  ];
}

function buildCustomerBusinessInitiatives(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, unknown>> {
  if (contentUnavailable) {
    return [{
      title: "Business Initiative 1 - Restore Evidence Collection",
      outcome: "Enable a full evidence-bound website and SEO assessment.",
      actions: ["Review access/security settings.", "Allow analysis access.", "Re-run the scan."],
      confidence: "Very limited"
    }];
  }

  const actions = (report.recommendationEngine?.recommendations ?? [])
    .map((recommendation) => sanitizeCustomerText(recommendation.action))
    .filter(Boolean);
  const buckets = [
    {
      title: "Business Initiative 1 - Increase Customer Enquiries",
      outcome: "Clarify the offer, improve contact visibility, and simplify the next step.",
      actions: actions.filter((action) => initiativeBucket(action) === "enquiries")
    },
    {
      title: "Business Initiative 2 - Build Customer Confidence",
      outcome: "Add stronger trust proof, credibility signals, and answers to common customer concerns.",
      actions: actions.filter((action) => initiativeBucket(action) === "confidence")
    },
    {
      title: "Business Initiative 3 - Increase Discoverability",
      outcome: "Improve visibility structure, customer-answer coverage, and local presence.",
      actions: actions.filter((action) => initiativeBucket(action) === "discoverability")
    }
  ];
  const fallbackActions = actions.length ? actions : [firstRoadmapAction(report)];
  return buckets.map((bucket, index) => ({
    title: bucket.title,
    outcome: bucket.outcome,
    actions: (bucket.actions.length ? bucket.actions : [fallbackActions[index % fallbackActions.length]]).slice(0, 4),
    confidence: summarizeCustomerEvidenceStrength(report)
  }));
}

function buildCustomerSeoBusinessQuestions(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, string>> {
  if (contentUnavailable) {
    return [
      { question: "Can customers find your business?", answer: "Not Assessed", businessMeaning: "Website content could not be collected, so search visibility was not scored.", action: "Review access/security settings and re-run scan.", confidence: "Very limited" },
      { question: "How confident are these recommendations?", answer: "Very limited", businessMeaning: "Confidence is limited because current-scan evidence coverage is 0%.", action: "Re-run the assessment after content collection is available.", confidence: "Very limited" }
    ];
  }
  const visibility = scoreForDimension(report, "visibilityStructure");
  const clarity = scoreForDimension(report, "informationClarity");
  const questionCoverage = buildCustomerQuestionCoverage(report, false) as Record<string, unknown>;
  const competitorContent = buildCustomerCompetitorContentComparison(report, false) as Record<string, unknown>;
  const missingQuestions = Array.isArray(questionCoverage["questionsMissingFromWebsite"]) ? questionCoverage["questionsMissingFromWebsite"] as string[] : [];
  const contentGaps = Array.isArray(competitorContent["contentGaps"]) ? competitorContent["contentGaps"] as Array<Record<string, unknown>> : [];
  return [
    {
      question: "Can customers find your business?",
      answer: healthStatusForScore(visibility),
      businessMeaning: visibility === null ? "Search visibility could not be scored from current evidence." : `Search visibility readiness is ${formatNullableScore(visibility)}, which affects discovery before customers compare options.`,
      action: actionForDimensionKey("visibilityStructure"),
      confidence: summarizeCustomerEvidenceStrength(report)
    },
    {
      question: "What are customers searching for that you do not answer?",
      answer: missingQuestions.length ? `${missingQuestions.length} question gap${missingQuestions.length === 1 ? "" : "s"}` : "No major question gap validated",
      businessMeaning: missingQuestions.length ? missingQuestions.slice(0, 4).map(sanitizeCustomerText).join(" ") : "Current evidence did not validate a separate unanswered-question cluster.",
      action: sanitizeCustomerText(questionCoverage["action"] ?? "Add direct answers for price, process, trust, comparison, objections, contact, service area, availability, and decision-stage questions."),
      confidence: sanitizeCustomerText(questionCoverage["confidence"] ?? summarizeCustomerEvidenceStrength(report))
    },
    {
      question: "Why are competitors appearing above you?",
      answer: contentGaps.length ? `${contentGaps.length} competitor advantage${contentGaps.length === 1 ? "" : "s"}` : "Not validated",
      businessMeaning: contentGaps.length ? "Competitors provide more information that helps customers compare services and make confident decisions." : "Competitor evidence did not validate a stronger decision-support reason in this scan.",
      action: contentGaps.length ? sanitizeCustomerText(contentGaps[0]?.["action"] ?? "Close validated competitor content gaps.") : "Add competitor URLs and collect full evidence before drawing a stronger conclusion.",
      confidence: summarizeCustomerEvidenceStrength(report)
    },
    {
      question: "Where are you losing organic traffic?",
      answer: clarity !== null && visibility !== null && visibility < clarity ? "Discovery structure" : "Content decision support",
      businessMeaning: "Organic traffic is most likely limited where discoverability, topical depth, local signals, or customer-answer coverage is incomplete.",
      action: visibility !== null && visibility < 70 ? actionForDimensionKey("visibilityStructure") : "Add decision-stage service content, FAQs, comparison support, and helpful educational pages.",
      confidence: summarizeCustomerEvidenceStrength(report)
    },
    {
      question: "Which SEO improvements will create the greatest business impact?",
      answer: "Prioritized roadmap",
      businessMeaning: "The strongest SEO work should also improve trust, clarity, conversion readiness, and customer confidence, not only rankings.",
      action: firstRoadmapAction(report),
      confidence: summarizeCustomerEvidenceStrength(report)
    },
    {
      question: "How confident are these recommendations?",
      answer: summarizeCustomerEvidenceStrength(report),
      businessMeaning: "Confidence rises when current-scan evidence covers enough pages, validated findings, questions, competitors, and business signals.",
      action: "Use the Evidence & Implementation panel for technical tasks, then re-scan to validate improvement.",
      confidence: `${Math.round(report.confidenceEngine?.overallConfidenceScore ?? average(report.confidenceLayer?.map((item) => item.confidenceScore) ?? []))}%`
    }
  ];
}

function unavailableScanCoverage(): Record<string, unknown> {
  return {
    sampledPages: 0,
    discoveredPages: 0,
    coverageLabel: "0% evidence coverage - content unavailable"
  };
}

function unavailableEvidenceCoverageSummary(): Record<string, unknown> {
  return {
    totalPagesSampled: 0,
    totalValidatedFindings: 0,
    pages: [],
    globalCoverageStatus: "Limited",
    explanation: "Website content could not be collected, so evidence coverage is 0%."
  };
}

function unavailableOss(): ReportSnapshot["oss"] {
  return {
    score: null,
    scoringStatus: "not_scored",
    classification: "Not Scored",
    visualState: NOT_SCORED_VISUAL_STATE,
    explanation: "OSS was not scored because website content could not be collected."
  };
}

function unavailableOssInterpretation(): ReportSnapshot["ossInterpretation"] {
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

function unavailableBusinessRiskStatus(): ReportSnapshot["businessRiskStatus"] {
  return {
    classification: "UNKNOWN",
    level: "Not Assessed",
    primaryRiskDriver: "Website content could not be collected.",
    explanation: "Risk was not scored because no page content was available for validated structural analysis.",
    evidenceIds: []
  };
}

function unavailableDecisionBrief(report: ReportSnapshot): ReportSnapshot["decisionIntelligenceBrief"] {
  const brief = report.decisionIntelligenceBrief;
  return {
    ...brief,
    executiveVerdict: {
      currentSituation: "Website content could not be collected, so the current situation cannot be scored from validated page evidence.",
      seriousness: "No structural risk level or revenue impact was inferred because evidence coverage is 0%.",
      firstAction: "Review website access and security settings before re-running the assessment.",
      urgency: "Not Applicable",
      likelyBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      evidenceBasis: "0 sampled pages and 0 validated page findings were available."
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
      recommendedNextAction: "Review access/security settings and re-run scan."
    },
    actionPlan: [
      {
        priority: "Priority 1",
        action: "Review website access and security settings.",
        rationale: "The assessment could not collect page content, so access must be reviewed before conclusions can be generated.",
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
      evidenceCoverage: "0 sampled pages, 0 validated page findings.",
      crawlCoverage: "0 pages sampled - content unavailable",
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

function buildCustomerAssessment(report: ReportSnapshot, contentUnavailable: boolean): Record<string, string> {
  if (contentUnavailable) {
    return {
      status: "Content Unavailable",
      evidenceCoverage: "0%",
      confidence: "Very Limited",
      oss: "Not Scored",
      reason: "Website content could not be collected.",
      recommendedAction: "Review access/security settings and re-run scan."
    };
  }
  const confidence = report.confidenceEngine?.overallConfidenceScore ?? average(report.confidenceLayer?.map((item) => item.confidenceScore) ?? []);
  return {
    status: report.oss?.classification ?? "Assessment Complete",
    evidenceCoverage: `${report.evidenceCoverageSummary?.totalPagesSampled ?? report.scanCoverage.sampledPages} sampled page(s)`,
    confidence: `${Math.round(confidence)}%`,
    oss: typeof report.oss?.score === "number" ? `${report.oss.score}/100` : "Not Scored",
    reason: sanitizeCustomerText(report.ossInterpretation?.oneLineDiagnosis ?? report.oss?.explanation ?? "Validated website evidence was summarized into this customer report."),
    recommendedAction: sanitizeCustomerText(report.decisionIntelligenceBrief?.executiveDecisionMatrix?.recommendedNextAction ?? report.actionFirstPanel?.fallbackAction)
  };
}

function unavailableRevenueIntelligence(): Record<string, unknown> {
  const estimate = {
    label: "Not estimated because validated evidence was insufficient",
    low: 0,
    high: 0,
    unit: "monthly_value_units",
    confidenceScore: 0,
    rationale: "Website content could not be collected, so no revenue or conversion impact was inferred."
  };
  return {
    status: "not_available",
    confidenceScore: 0,
    confidenceBasis: "Very Limited: website content could not be collected.",
    trafficRange: estimate,
    conversionPotentialRange: estimate,
    revenueOpportunityRange: estimate,
    opportunityCostRange: estimate,
    competitorRevenuePressure: {
      status: "not_assessed",
      pressureLevel: "Unknown",
      explanation: "Not assessed because website content could not be collected."
    },
    limitations: ["Website content could not be collected.", "Revenue and conversion impact were not inferred."]
  };
}

function unavailableRecommendationEngine(): Record<string, unknown> {
  return {
    status: "limited",
    recommendations: [
      {
        issue: "Website content unavailable",
        action: "Review website access/security settings and re-run scan.",
        priority: "FIX NOW",
        mappedDimensions: [],
        expectedScoreMovement: 0,
        revenueIntelligenceMapping: "No business impact or revenue estimate was generated because page evidence was unavailable.",
        businessExplanation: "Website content could not be collected, so SYSTOLAB cannot safely infer customer behavior or business impact yet.",
        technicalTasks: ["Review access/security settings.", "Allow content collection for the target website.", "Re-run the assessment after access is available."],
        confidenceScore: 0,
        changeValidationPlan: "Re-run the assessment after content can be collected."
      }
    ],
    mappingSystem: {
      rule: "one_recommendation_one_change_cluster",
      explanation: "Recommendation mapping is limited until website content can be collected."
    }
  };
}

function unavailablePriorityTimeline(): Record<string, unknown> {
  return {
    fixNow: [
      {
        action: "Review website access/security settings and re-run scan.",
        category: "FIX NOW",
        timeWindow: "0-7 days",
        structuralSeverity: "High",
        evidenceStrength: "Limited"
      }
    ],
    thisMonth: [],
    monitor: []
  };
}

function sanitizeScanCoverage(report: ReportSnapshot): Record<string, unknown> {
  return {
    sampledPages: report.scanCoverage.sampledPages,
    discoveredPages: report.scanCoverage.discoveredPages,
    coverageLabel: sanitizeCustomerText(report.scanCoverage.coverageLabel)
  };
}

function sanitizeEvidenceCoverageSummary(report: ReportSnapshot): Record<string, unknown> {
  return {
    totalPagesSampled: report.evidenceCoverageSummary.totalPagesSampled,
    totalValidatedFindings: report.evidenceCoverageSummary.totalEvidenceObjects,
    pages: dedupeCoveragePages(report.evidenceCoverageSummary.pages).map((page) => ({
      url: page.url,
      role: page.role,
      evidenceCount: page.evidenceCount,
      coverageStatus: page.coverageStatus
    }))
  };
}

function sanitizeDimensions(report: ReportSnapshot): Array<Record<string, unknown>> {
  return (report.dimensions ?? []).map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    score: dimension.score,
    classification: dimension.classification,
    visualState: dimension.visualState,
    businessMeaning: sanitizeCustomerText(dimension.businessMeaning),
    confidenceScore: dimension.confidenceScore,
    confidenceLevel: dimension.confidenceLevel
  }));
}

function sanitizeActionFirstPanel(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.actionFirstPanel) return undefined;
  return {
    layer: report.actionFirstPanel.layer,
    status: report.actionFirstPanel.status,
    fallbackAction: sanitizeCustomerText(report.actionFirstPanel.fallbackAction),
    items: report.actionFirstPanel.items.map((item) => ({
      issue: sanitizeCustomerText(item.issue),
      executableFix: sanitizeCustomerText(item.executableFix),
      businessReason: sanitizeCustomerText(item.businessReason),
      effortLevel: item.effortLevel,
      expectedDirectionalImpact: item.expectedDirectionalImpact
    }))
  };
}

function sanitizeConfidenceEngine(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.confidenceEngine) return undefined;
  return {
    overallConfidenceScore: report.confidenceEngine.overallConfidenceScore,
    confidenceLevel: report.confidenceEngine.confidenceLevel,
    estimateExplanations: report.confidenceEngine.estimateExplanations.map((item) => ({
      area: item.area,
      confidenceScore: item.confidenceScore,
      reasons: item.reasons.map(sanitizeCustomerText),
      missingInputs: item.missingInputs.map(sanitizeCustomerText)
    }))
  };
}

function sanitizeRevenueIntelligence(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.revenueIntelligence) return undefined;
  const estimate = (item: ReportSnapshot["revenueIntelligence"]["trafficRange"]) => ({
    label: sanitizeCustomerText(item.label),
    low: item.low,
    high: item.high,
    unit: item.unit,
    confidenceScore: item.confidenceScore,
    rationale: sanitizeCustomerText(item.rationale)
  });
  return {
    status: report.revenueIntelligence.status,
    confidenceScore: report.revenueIntelligence.confidenceScore,
    confidenceBasis: sanitizeCustomerText(report.revenueIntelligence.confidenceBasis),
    trafficRange: estimate(report.revenueIntelligence.trafficRange),
    conversionPotentialRange: estimate(report.revenueIntelligence.conversionPotentialRange),
    revenueOpportunityRange: estimate(report.revenueIntelligence.revenueOpportunityRange),
    opportunityCostRange: estimate(report.revenueIntelligence.opportunityCostRange),
    competitorRevenuePressure: {
      status: report.revenueIntelligence.competitorRevenuePressure.status,
      pressureLevel: report.revenueIntelligence.competitorRevenuePressure.pressureLevel,
      explanation: sanitizeCustomerText(report.revenueIntelligence.competitorRevenuePressure.explanation)
    },
    limitations: report.revenueIntelligence.limitations.map(sanitizeCustomerText)
  };
}

function sanitizeRecommendationEngine(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.recommendationEngine) return undefined;
  return {
    status: report.recommendationEngine.status,
    recommendations: report.recommendationEngine.recommendations.map((recommendation) => ({
      issue: sanitizeCustomerText(recommendation.issue),
      action: sanitizeCustomerText(recommendation.action),
      priority: recommendation.priority,
      mappedDimensions: recommendation.mappedDimensions,
      expectedScoreMovement: recommendation.expectedScoreMovement,
      revenueIntelligenceMapping: sanitizeCustomerText(recommendation.revenueIntelligenceMapping),
      businessExplanation: businessExplanationForAction(recommendation.action, recommendation.revenueIntelligenceMapping || recommendation.issue),
      technicalTasks: technicalTasksForAction(recommendation.action),
      confidenceScore: recommendation.confidenceScore,
      changeValidationPlan: sanitizeCustomerText(recommendation.changeValidationPlan)
    })),
    mappingSystem: {
      rule: report.recommendationEngine.mappingSystem.rule,
      explanation: sanitizeCustomerText(report.recommendationEngine.mappingSystem.explanation)
    }
  };
}

function sanitizeOutcomeLoop(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.recommendationOutcomeLoop) return undefined;
  return {
    status: report.recommendationOutcomeLoop.status,
    summary: sanitizeCustomerText(report.recommendationOutcomeLoop.summary),
    validations: report.recommendationOutcomeLoop.validations.map((validation) => ({
      recommendation: sanitizeCustomerText(validation.recommendation),
      implementedStatus: validation.implementedStatus,
      detectedAt: validation.detectedAt,
      ossDelta: validation.ossDelta,
      dimensionDeltas: validation.dimensionDeltas,
      improvementStatus: validation.improvementStatus,
      revenueImpact: stripInternalFields(validation.revenueImpact),
      confidenceScore: validation.confidenceScore,
      confidenceReasons: validation.confidenceReasons.map(sanitizeCustomerText)
    }))
  };
}

function sanitizePriorityTimeline(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.priorityTimeline) return undefined;
  const sanitize = (items: ReportSnapshot["priorityTimeline"]["fixNow"]) =>
    items.map((item) => ({
      action: sanitizeCustomerText(item.action),
      category: item.category,
      timeWindow: item.timeWindow,
      structuralSeverity: item.structuralSeverity,
      evidenceStrength: item.evidenceStrength
    }));
  return {
    fixNow: sanitize(report.priorityTimeline.fixNow),
    thisMonth: sanitize(report.priorityTimeline.thisMonth),
    monitor: sanitize(report.priorityTimeline.monitor)
  };
}

function sanitizeIndustryBenchmark(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.industryBenchmarkEngine) return undefined;
  return {
    status: report.industryBenchmarkEngine.status,
    industryType: report.industryBenchmarkEngine.industryType,
    sampleSize: report.industryBenchmarkEngine.sampleSize,
    currentPosition: report.industryBenchmarkEngine.currentPosition.map((position) => ({
      dimension: position.dimension,
      dimensionLabel: position.dimensionLabel,
      score: position.score,
      industryAverage: position.industryAverage,
      position: position.position,
      delta: position.delta
    })),
    limitations: report.industryBenchmarkEngine.limitations.map(sanitizeCustomerText)
  };
}

function sanitizeCompetitorComparison(report: ReportSnapshot): Array<Record<string, unknown>> {
  return (report.competitorComparison ?? []).map((comparison) => ({
    status: comparison.status,
    competitorUrl: comparison.competitorUrl,
    competitorLabel: comparison.competitorLabel,
    primaryOss: comparison.primaryOss,
    competitorOss: comparison.competitorOss,
    assessedPages: comparison.assessedPages,
    structuralGapSummary: sanitizeCustomerText(comparison.structuralGapSummary),
    primaryStrengthCount: comparison.primaryStrengthCount,
    competitorStrengthCount: comparison.competitorStrengthCount,
    equivalentCount: comparison.equivalentCount,
    dataAvailability: sanitizeCustomerText(comparison.dataAvailability),
    failureReason: comparison.failureReason ? "Competitor content was unavailable for comparison." : undefined,
    evidenceTraceabilityMap: comparison.evidenceTraceabilityMap.map((row) => ({
      dimension: row.dimension,
      dimensionLabel: row.dimensionLabel,
      primaryScore: row.primaryScore,
      competitorScore: row.competitorScore,
      position: row.position,
      difference: row.difference
    }))
  }));
}

function sanitizeCompetitorIntelligence(report: ReportSnapshot): Record<string, unknown> | undefined {
  if (!report.competitorIntelligenceEngine) return undefined;
  return {
    status: report.competitorIntelligenceEngine.status,
    competitors: report.competitorIntelligenceEngine.competitors.map((competitor) => ({
      competitorUrl: competitor.competitorUrl,
      competitorLabel: competitor.competitorLabel,
      timeline: competitor.timeline.map((point) => ({
        capturedAt: point.capturedAt,
        oss: point.oss,
        dimensions: point.dimensions
      })),
      latestMovement: competitor.latestMovement
    })),
    explanation: sanitizeCustomerText(report.competitorIntelligenceEngine.explanation)
  };
}

function buildCustomerEvidenceItems(report: ReportSnapshot, contentUnavailable: boolean): Array<Record<string, string>> {
  if (contentUnavailable) return [];
  const databaseRows = (report.evidenceDatabase ?? []).map((evidence) => ({
    title: sanitizeCustomerText(evidence.issue),
    confidence: `${evidence.confidenceScore}%`,
    meaning: sanitizeCustomerText(evidence.confidenceReason)
  }));
  const evidenceRows = (report.evidenceObjects ?? [])
    .filter(isCustomerEvidence)
    .map((evidence) => ({
      title: customerSignalTitle(evidence),
      confidence: `${Math.round(evidence.groundTruthConfidence ?? 60)}%`,
      meaning: sanitizeCustomerText(evidence.groundTruthMeaning ?? evidence.confidenceBasis ?? "Validated website evidence supports this finding.")
    }));
  return dedupeBy([...databaseRows, ...evidenceRows], (item) => `${item.title}-${item.meaning}`).slice(0, 18);
}

function buildCustomerLocalVisibility(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const gbp = (report as unknown as { gbpIdentity?: ReportSnapshot["gbpIdentity"] }).gbpIdentity;
  const local = findNativeSignal(report, "native_local_visibility_opportunity_score");
  const localBusiness = findNativeSignal(report, "native_local_business_readiness_score");
  const citation = findNativeSignal(report, "native_citation_credibility_score");
  const entity = findNativeSignal(report, "native_entity_clarity_score");
  const trust = findNativeSignal(report, "native_trust_proof_coverage_score");
  const localScore = firstNumber([signalScore(local), signalScore(localBusiness), gbp?.identityConsistencyScore]);
  const proofSignals = asStringArray(trust?.normalizedInput?.["proofSignals"]);
  const localSignals = dedupeBy(
    [
      ...asStringArray(local?.normalizedInput?.["localSignals"]),
      ...asStringArray(localBusiness?.normalizedInput?.["localSignals"]),
      ...asStringArray(entity?.normalizedInput?.["entitySignals"])
    ],
    (item) => item
  );
  const reviewSignalObserved = proofSignals.some((signal) => /review|rating|testimonial/i.test(signal)) || evidenceCorpus(report).match(/review|rating|testimonial/i) !== null;

  return {
    status: contentUnavailable ? "Content Unavailable" : gbp?.status === "assessed" || localScore !== null ? "Assessed from current evidence" : "Not assessed",
    gbpScore: formatNullableScore(gbp?.identityConsistencyScore ?? null),
    localVisibilityScore: formatNullableScore(localScore),
    businessProfileCompleteness: gbp?.profileCompletenessLevel ?? "Not Assessed",
    identityConsistency: gbp?.identityMismatchFlag ? titleCase(String(gbp.identityMismatchFlag).replaceAll("_", " ")) : "Not assessed",
    reviewAnalysis: {
      status: reviewSignalObserved ? "Review proof visible in collected website evidence" : "Review and rating trends not assessed",
      finding: reviewSignalObserved
        ? "The scan found review, rating, or testimonial proof on collected website pages."
        : "The current scan did not collect verified review count, rating trend, or business profile history evidence.",
      gap: reviewSignalObserved ? "Review trend depth still depends on connected first-party or profile evidence." : "Add visible review/rating proof or provide profile data before drawing review-trend conclusions.",
      action: "Show current reviews, rating proof, testimonial depth, service proof, and local credibility near decision points."
    },
    serviceAreaClarity: {
      status: localSignals.some((signal) => /service_area|location|address|map|hours|phone/i.test(signal)) ? "Visible local cues detected" : "Service-area evidence limited",
      evidence: localSignals.length ? localSignals.map(sanitizeCustomerText).join(", ") : "No strong service-area, hours, map, or local contact signal was validated.",
      action: "Clarify address, phone, hours, service areas, appointment path, and local proof."
    },
    citationCoverage: {
      status: signalStatus(signalScore(citation)),
      score: formatNullableScore(signalScore(citation)),
      action: "Strengthen directory, association, partner, listing, media, and authority-reference signals where they support credibility."
    },
    localCompetitorComparison: buildLocalCompetitorComparison(report),
    localVisibilityOpportunities: dedupeBy(
      [local, localBusiness, citation, entity, trust]
        .filter((item): item is EvidenceObject => Boolean(item))
        .map((evidence) => ({
          area: customerSignalTitle(evidence),
          status: signalStatus(signalScore(evidence)),
          action: actionForSignal(String(evidence.normalizedInput?.["signalKey"] ?? "")),
          confidence: `${Math.round(evidence.groundTruthConfidence ?? 60)}% evidence confidence`
        })),
      (item) => `${item.area}-${item.action}`
    ),
    limitations: [
      contentUnavailable
        ? "Website content could not be collected, so local visibility could not be scored."
        : "Review history, rating trends, and business profile details are shown only when validated evidence is available."
    ]
  };
}

function buildCustomerCompetitorContentComparison(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const gapEvidence = nativeSignalList(report, "native_competitor_content_gap_score");
  const assessedComparisons = (report.competitorComparison ?? []).filter((comparison) => comparison.status === "assessed");
  const contentGaps = gapEvidence.map((evidence) => {
    const comparedSignal = String(evidence.normalizedInput?.["comparedSignal"] ?? "");
    const competitor = sanitizeCustomerText(evidence.normalizedInput?.["competitor"] ?? "Compared competitor");
    const primaryScore = numberOrNull(evidence.normalizedInput?.["primaryScore"]);
    const competitorScore = numberOrNull(evidence.normalizedInput?.["competitorScore"]);
    return {
      competitor,
      area: signalBusinessArea(comparedSignal),
      clientEvidence: formatNullableScore(primaryScore),
      competitorEvidence: formatNullableScore(competitorScore),
      scoreComparison: scoreComparisonText(primaryScore, competitorScore),
      implication: "Competitors provide more information that helps customers compare services and make confident decisions. This reduces uncertainty before customers contact them.",
      decisionImpact: competitorGapImpact(comparedSignal),
      action: actionForSignal(comparedSignal)
    };
  });

  const dimensionGaps = assessedComparisons.flatMap((comparison) =>
    comparison.evidenceTraceabilityMap
      .filter((row) => row.position === "primary_weaker")
      .map((row) => ({
        competitor: comparison.competitorLabel || safeHostLabel(comparison.competitorUrl),
        area: sanitizeCustomerText(row.dimensionLabel),
        clientEvidence: formatNullableScore(row.primaryScore),
        competitorEvidence: formatNullableScore(row.competitorScore ?? null),
        scoreComparison: scoreComparisonText(row.primaryScore, row.competitorScore ?? null),
        implication: "Competitors provide more information that helps customers compare services and make confident decisions. This reduces uncertainty before customers contact them.",
        decisionImpact: `${sanitizeCustomerText(row.dimensionLabel)} can affect whether a comparison-shopping customer feels safer choosing one business over another.`,
        action: actionForDimensionKey(row.dimension)
      }))
  );

  const rows = dedupeBy([...contentGaps, ...dimensionGaps], (item) => `${item.competitor}-${item.area}`);
  return {
    status: contentUnavailable ? "Content Unavailable" : rows.length > 0 ? "Competitor content gaps detected" : assessedComparisons.length > 0 ? "Compared with no validated content gap" : "Not assessed",
    summary: contentUnavailable
      ? "Competitor content comparison could not run because website content was unavailable."
      : rows.length > 0
        ? "SYSTOLAB found areas where compared competitors provide stronger customer decision support."
        : "No validated competitor content advantage was available in this scan.",
    comparedCompetitors: assessedComparisons.map((comparison) => comparison.competitorLabel || safeHostLabel(comparison.competitorUrl)),
    contentGaps: rows.slice(0, 8),
    missingContentTypes: buildCustomerContentTypeCoverage(report),
    limitations: rows.length === 0 ? ["Add competitor URLs and allow full content collection to compare FAQs, process detail, pricing cues, trust proof, and educational depth."] : []
  };
}

function buildCustomerQuestionCoverage(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const question = findNativeSignal(report, "native_customer_question_coverage_score");
  const covered = asStringArray(question?.normalizedInput?.["coveredQuestionFamilies"]);
  const missing = asStringArray(question?.normalizedInput?.["missingQuestionFamilies"]);
  const competitorQuestionGaps = nativeSignalList(report, "native_competitor_content_gap_score").filter((evidence) =>
    String(evidence.normalizedInput?.["comparedSignal"] ?? "").includes("question")
  );

  return {
    status: contentUnavailable ? "Content Unavailable" : question ? signalStatus(signalScore(question)) : "Not assessed",
    coverageScore: formatNullableScore(signalScore(question)),
    questionsCustomersAsk: dedupeBy([...covered, ...missing].map(questionFamilyToCustomerQuestion), (item) => item),
    questionsAnsweredOnWebsite: covered.map(questionFamilyToCustomerQuestion),
    questionsMissingFromWebsite: missing.map(questionFamilyToCustomerQuestion),
    questionsCompetitorsAnswer: competitorQuestionGaps.length
      ? competitorQuestionGaps.map((evidence) => `${sanitizeCustomerText(evidence.normalizedInput?.["competitor"] ?? "A competitor")} appears stronger in customer question coverage.`)
      : ["Competitor question-answer coverage was not validated in this scan."],
    action: "Add direct answers for price, process, trust, comparison, objections, contact, service area, availability, and decision-stage questions.",
    confidence: question ? `${Math.round(question.groundTruthConfidence ?? 60)}% evidence confidence` : "Limited confidence"
  };
}

function buildCustomerCompetitorWinReasons(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const signalReasons = nativeSignalList(report, "native_competitor_content_gap_score").map((evidence) => {
    const comparedSignal = String(evidence.normalizedInput?.["comparedSignal"] ?? "");
    return {
      competitor: sanitizeCustomerText(evidence.normalizedInput?.["competitor"] ?? "Compared competitor"),
      reason: `${sanitizeCustomerText(evidence.normalizedInput?.["competitor"] ?? "Compared competitor")} appears stronger in ${signalBusinessArea(comparedSignal)}.`,
      proof: `Client ${formatNullableScore(numberOrNull(evidence.normalizedInput?.["primaryScore"]))} vs competitor ${formatNullableScore(numberOrNull(evidence.normalizedInput?.["competitorScore"]))}.`,
      decisionImpact: competitorGapImpact(comparedSignal),
      action: actionForSignal(comparedSignal)
    };
  });

  const dimensionReasons = (report.competitorComparison ?? []).flatMap((comparison) =>
    comparison.evidenceTraceabilityMap
      .filter((row) => row.position === "primary_weaker")
      .map((row) => ({
        competitor: comparison.competitorLabel || safeHostLabel(comparison.competitorUrl),
        reason: `${comparison.competitorLabel || safeHostLabel(comparison.competitorUrl)} appears stronger in ${sanitizeCustomerText(row.dimensionLabel)}.`,
        proof: `Client ${formatNullableScore(row.primaryScore)} vs competitor ${formatNullableScore(row.competitorScore ?? null)}.`,
        decisionImpact: `${sanitizeCustomerText(row.dimensionLabel)} can influence customer confidence during comparison.`,
        action: actionForDimensionKey(row.dimension)
      }))
  );

  const reasons = dedupeBy([...signalReasons, ...dimensionReasons], (item) => `${item.competitor}-${item.reason}`);
  return {
    status: contentUnavailable ? "Content Unavailable" : reasons.length > 0 ? "Validated competitor advantage detected" : "Not validated",
    reasons: reasons.slice(0, 8),
    summary: reasons.length > 0
      ? "Competitors provide more information that helps customers compare services and make confident decisions. This reduces uncertainty before customers contact them."
      : "This scan did not validate why a competitor is winning beyond score-level comparison."
  };
}

function buildCustomerRevenueLeakage(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const areas = [
    { key: "trust", area: "Trust leakage", attribution: "Trust", action: "Add stronger reviews, testimonials, guarantees, certifications, case studies, and credibility proof." },
    { key: "conversionReadiness", area: "Conversion leakage", attribution: "Conversion", action: "Make the main CTA, form, booking, purchase, or contact path easier to see and complete." },
    { key: "informationClarity", area: "Information leakage", attribution: "Information clarity", action: "Explain the offer, process, pricing cues, audience, outcomes, and next steps more clearly." },
    { key: "visibilityStructure", area: "Visibility leakage", attribution: "Visibility", action: "Improve page structure, search-to-sale support, local/entity cues, internal links, and discoverability signals." }
  ].map((item) => {
    const dimension = (report.dimensions ?? []).find((row) => row.key === item.key);
    return {
      area: item.area,
      score: formatNullableScore(dimension?.score ?? null),
      status: contentUnavailable ? "Not assessed" : dimension ? signalStatus(dimension.score) : "Not assessed",
      businessArea: item.attribution,
      customerImpact: dimension ? customerImpactForDimensionKey(item.key) : "Current evidence did not validate this leakage category.",
      action: item.action,
      confidence: dimension ? `${dimension.confidenceScore}% ${dimension.confidenceLevel}` : "Limited confidence"
    };
  });

  const revenue = report.revenueIntelligence;
  return {
    status: contentUnavailable ? "Content Unavailable" : revenue?.status ?? "Not assessed",
    valueContext: revenue?.revenueOpportunityRange ? formatCustomerRange(revenue.revenueOpportunityRange) : "Revenue leakage is not estimated without validated current-scan evidence.",
    leakageAreas: areas,
    limitation: "These are structural leakage categories supported by scan evidence, not guaranteed revenue outcomes."
  };
}

function buildCustomerOutcomeAttribution(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const layer = (report as unknown as { businessOutcomeAttributionLayer?: ReportSnapshot["businessOutcomeAttributionLayer"] }).businessOutcomeAttributionLayer;
  const profiles = layer?.profiles ?? [];
  return {
    status: contentUnavailable ? "Content Unavailable" : profiles.length > 0 ? "Business impact links available" : "Not assessed",
    summary: contentUnavailable
      ? "Business impact could not be evaluated because website content was unavailable."
      : profiles.length > 0
        ? sanitizeCustomerText(layer?.summary ?? "SYSTOLAB mapped validated issues to business outcome categories.")
        : "No business impact link passed the current evidence threshold.",
    outcomeLinks: profiles
      .sort((a, b) => (numberOrNull(a.comparativeRank) ?? 999) - (numberOrNull(b.comparativeRank) ?? 999))
      .slice(0, 6)
      .map((profile, index) => {
        const partial = profile as Partial<ReportSnapshot["businessOutcomeAttributionLayer"]["profiles"][number]>;
        return {
          issue: customerIssueLabel(report, partial.canonicalIssueId ?? "", index),
          businessAreas: asStringArray(partial.impactAreas).map(formatImpactArea).join(", ") || "Not assessed",
          strength: titleCase(String(partial.attributionStrength ?? "limited")),
          influence: titleCase(String(partial.relativeBusinessInfluence ?? "unverified")),
          explanation: sanitizeCustomerText(partial.customerBehaviorExplanation ?? "Business impact details were not fully validated."),
          confidence: `${numberOrNull(partial.confidenceScore) ?? 0}% ${partial.confidenceLevel ?? "Limited"}`
        };
      }),
    boundary: "Business impact links are directional and evidence-bound; they do not claim actual revenue loss without verified performance data."
  };
}

function buildCustomerDependencySummary(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const layer = (report as unknown as { dependencyIntelligenceLayer?: ReportSnapshot["dependencyIntelligenceLayer"] }).dependencyIntelligenceLayer;
  const roles = layer?.issueRoles ?? [];
  const relations = layer?.dependencyMap ?? [];
  return {
    status: contentUnavailable ? "Content Unavailable" : roles.length > 0 || relations.length > 0 ? "Fix-order guidance available" : "Not assessed",
    summary: contentUnavailable ? "Fix order could not be evaluated because website content was unavailable." : sanitizeCustomerText(layer?.summary ?? "No issue connection passed the evidence threshold."),
    businessConnections: [
      ...roles.slice(0, 6).map((role, index) => ({
        issue: customerIssueLabel(report, role.canonicalIssueId, index),
        role: titleCase(String(role.role).replaceAll("_", " ")),
        rationale: sanitizeCustomerText(role.rationale)
      })),
      ...relations.slice(0, 6).map((relation, index) => ({
        issue: customerIssueLabel(report, relation.parentCanonicalIssueId, index),
        role: titleCase(relation.relationship.replaceAll("_", " ")),
        rationale: `${customerIssueLabel(report, relation.childCanonicalIssueId, index + 1)}: ${sanitizeCustomerText(relation.explanation)} ${relation.confidenceScore}% confidence.`
      }))
    ].slice(0, 8),
    fixOrderWarnings: (layer?.prerequisiteWarnings ?? []).map(sanitizeCustomerText)
  };
}

function buildCustomerClientSuccessBlueprint(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const recommendations = (report.recommendationEngine?.recommendations ?? []).map((recommendation) => ({
    action: sanitizeCustomerText(recommendation.action),
    reason: sanitizeCustomerText(recommendation.revenueIntelligenceMapping || recommendation.issue),
    priority: recommendation.priority,
    confidence: `${Math.round(recommendation.confidenceScore ?? 0)}% evidence confidence`
  }));
  const confidence = contentUnavailable ? "Very limited confidence" : summarizeCustomerEvidenceStrength(report);
  const actionAt = (index: number, fallback: string) => recommendations[index]?.action ?? fallback;
  const reasonAt = (index: number) => recommendations[index]?.reason ?? "Validated evidence supports this improvement priority.";
  const item = (action: string, reason: string, dependencies: string, successMetric: string) => ({
    action: sanitizeCustomerText(action),
    expectedBusinessOutcome: expectedOutcomeForAction(action),
    estimatedEffort: effortForAction(action),
    dependencies: sanitizeCustomerText(dependencies),
    successMetric: sanitizeCustomerText(successMetric),
    confidence: confidence || sanitizeCustomerText(reason)
  });
  return {
    status: contentUnavailable ? "Content Unavailable" : "Evidence-backed roadmap",
    summary: contentUnavailable
      ? "Website content could not be collected, so a full 90-day improvement plan was not scored. First restore access and re-run the scan."
      : "This 90-day plan converts validated recommendations into a practical implementation roadmap. Outcomes are expected business support, not guaranteed revenue, and should be validated through follow-up scans.",
    phases: [
      {
        phase: "Week 1",
        timeframe: "Critical fixes",
        focus: "Remove the highest-friction customer decision blockers",
        items: [item(actionAt(0, report.actionFirstPanel?.fallbackAction ?? "Improve the weakest validated customer decision area and re-run the scan."), reasonAt(0), "Access to website content, CMS, analytics or owner approval where needed", "Top recommendation completed and re-scan shows improved evidence coverage or score movement")]
      },
      {
        phase: "Weeks 2-4",
        timeframe: "High-impact improvements",
        focus: "Improve customer trust, clarity, and action paths",
        items: [item(actionAt(1, actionForDimensionKey("trust")), reasonAt(1), "Week 1 blocker removed and decision pages identified", "Trust, clarity, or conversion readiness improves on the next scan")]
      },
      {
        phase: "Month 2",
        timeframe: "Growth initiatives",
        focus: "Strengthen search, local visibility, content depth, and decision support",
        items: [item(actionAt(2, actionForDimensionKey("visibilityStructure")), reasonAt(2), "Core website fixes completed and priority service pages selected", "More customer questions answered and visibility-support signals validated")]
      },
      {
        phase: "Month 3",
        timeframe: "Competitive advantage projects",
        focus: "Differentiate against competitors and prove progress",
        items: [item(actionAt(3, "Compare competitor gaps, improve weaker content areas, and re-scan to validate improvement."), reasonAt(3), "At least one follow-up scan and competitor URLs available", "First scan vs latest scan shows completed recommendations and stronger competitive decision support")]
      }
    ]
  };
}
function buildCustomerRecommendationRoadmap(report: ReportSnapshot, contentUnavailable: boolean): Record<string, unknown> {
  const sequencing = (report as unknown as { recommendationSequencingEngine?: ReportSnapshot["recommendationSequencingEngine"] }).recommendationSequencingEngine;
  const phases = [
    { phase: "Phase 1", focus: "Fix trust and critical blockers", timeframe: "Immediate Actions", actions: sequencing?.immediateActions ?? [] },
    { phase: "Phase 2", focus: "Fix conversion and decision clarity", timeframe: "Near-Term Actions", actions: sequencing?.nearTermActions ?? [] },
    { phase: "Phase 3", focus: "Fix authority and visibility support", timeframe: "Medium-Term Actions", actions: sequencing?.mediumTermActions ?? [] },
    { phase: "Phase 4", focus: "Capture demand and monitor gains", timeframe: "Strategic Actions", actions: sequencing?.strategicActions ?? [] }
  ].map((phase) => ({
    phase: phase.phase,
    focus: phase.focus,
    timeframe: phase.timeframe,
    actions: phase.actions.slice(0, 4).map((action) => ({
      action: sanitizeCustomerText(action.action),
      rationale: sanitizeCustomerText(action.rationale),
      confidence: `${action.confidenceScore}% confidence`,
      lifecycleState: action.lifecycleState
    }))
  }));

  const fallback = phases.every((phase) => phase.actions.length === 0) ? fallbackRoadmapFromTimeline(report) : phases;
  return {
    status: contentUnavailable ? "Content Unavailable" : fallback.some((phase) => phase.actions.length > 0) ? "Sequenced" : "Not assessed",
    summary: contentUnavailable ? "The implementation roadmap could not be generated because website content was unavailable." : sanitizeCustomerText(sequencing?.summary ?? "Recommendations are grouped into practical phases."),
    phases: fallback
  };
}

function buildLocalCompetitorComparison(report: ReportSnapshot): Array<Record<string, string>> {
  return (report.competitorComparison ?? [])
    .flatMap((comparison) =>
      comparison.evidenceTraceabilityMap
        .filter((row) => row.position === "primary_weaker" && ["visibilityStructure", "trust", "conversionReadiness"].includes(row.dimension))
        .map((row) => ({
          competitor: comparison.competitorLabel || safeHostLabel(comparison.competitorUrl),
          position: `Competitor stronger in ${sanitizeCustomerText(row.dimensionLabel)}`,
          reason: `Client ${formatNullableScore(row.primaryScore)} vs competitor ${formatNullableScore(row.competitorScore ?? null)}.`
        }))
    )
    .slice(0, 5);
}

function buildCustomerContentTypeCoverage(report: ReportSnapshot): Array<Record<string, string>> {
  const corpus = evidenceCorpus(report);
  const question = findNativeSignal(report, "native_customer_question_coverage_score");
  const missingQuestions = new Set(asStringArray(question?.normalizedInput?.["missingQuestionFamilies"]));
  const checks: Array<{ contentType: string; matched: boolean; action: string }> = [
    { contentType: "Process explanation", matched: /process|steps|how it works|what to expect|timeline/i.test(corpus), action: "Explain how the service, purchase, booking, or onboarding process works." },
    { contentType: "FAQ and customer answers", matched: /faq|questions|answers/i.test(corpus) || (Boolean(question) && missingQuestions.size === 0), action: "Add direct answers to the questions customers ask before contacting or buying." },
    { contentType: "Trust content", matched: /review|testimonial|case stud|certified|licensed|insured|award|guarantee/i.test(corpus), action: "Add reviews, testimonials, proof, guarantees, credentials, or case studies." },
    { contentType: "Case studies or results", matched: /case stud|portfolio|results|before and after|success story/i.test(corpus), action: "Show outcomes, examples, portfolio proof, case studies, or before-after evidence." },
    { contentType: "Comparison pages", matched: /compare|versus|vs\.?|alternative|why choose|different from/i.test(corpus), action: "Explain why customers should choose this business over alternatives." },
    { contentType: "Educational content", matched: /guide|resources|learn|insights|blog|education|tips/i.test(corpus), action: "Add helpful service guides, educational resources, and decision-support content." },
    { contentType: "Pricing guidance", matched: /price|pricing|cost|rates|fees|quote|estimate/i.test(corpus), action: "Add pricing ranges, quote expectations, cost factors, or estimate guidance where appropriate." }
  ];
  return checks.map((check) => ({
    contentType: check.contentType,
    status: check.matched ? "Visible in collected evidence" : "Not validated in collected evidence",
    action: check.action
  }));
}

function fallbackRoadmapFromTimeline(report: ReportSnapshot): Array<{ phase: string; focus: string; timeframe: string; actions: Array<Record<string, string>> }> {
  const toActions = (items: ReportSnapshot["priorityTimeline"]["fixNow"]) =>
    items.slice(0, 4).map((item) => ({
      action: sanitizeCustomerText(item.action),
      rationale: `${item.structuralSeverity} severity with ${item.evidenceStrength} evidence.`,
      confidence: item.evidenceStrength,
      lifecycleState: "Recommended"
    }));
  return [
    { phase: "Phase 1", focus: "Fix trust and critical blockers", timeframe: "FIX NOW", actions: toActions(report.priorityTimeline?.fixNow ?? []) },
    { phase: "Phase 2", focus: "Fix conversion and decision clarity", timeframe: "THIS MONTH", actions: toActions(report.priorityTimeline?.thisMonth ?? []) },
    { phase: "Phase 3", focus: "Fix authority and visibility support", timeframe: "MONITOR", actions: toActions(report.priorityTimeline?.monitor ?? []) },
    { phase: "Phase 4", focus: "Capture demand and monitor gains", timeframe: "Follow-up", actions: [] }
  ];
}

function dedupeCustomerDecisionRows<T extends Record<string, unknown>>(rows: T[], titlePrefix: string): T[] {
  return dedupeBy(rows, (item) => canonicalCustomerDecisionKey(`${String(item["meaning"] ?? "")} ${String(item["action"] ?? "")} ${String(item["priority"] ?? "")}`))
    .slice(0, 4)
    .map((item, index) => ({ ...item, title: `${titlePrefix} ${index + 1}` }));
}

function canonicalCustomerDecisionKey(value: string): string {
  const text = value.toLowerCase();
  if (/mobile|viewport|resource|speed|responsive|tap/.test(text)) return "mobile_conversion_path";
  if (/trust|review|testimonial|proof|credib|guarantee|certif|case stud/.test(text)) return "customer_trust";
  if (/competitor|compare|comparison|alternative|versus/.test(text)) return "competitor_decision_support";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "customer_questions";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "search_visibility";
  if (/conversion|cta|book|buy|form|lead|checkout|contact path|action path|ready to act|next step|taking action|take action|act but need/.test(text)) return "conversion_readiness";
  if (/clarity|message|offer|explain|information/.test(text)) return "offer_clarity";
  return text.replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(sanitizeCustomerText).filter(Boolean) : [];
}

function competitiveMomentumForGapCount(gapCount: number): string {
  if (gapCount <= 0) return "Stable";
  if (gapCount === 1) return "Watch Closely";
  if (gapCount <= 3) return "Losing Ground";
  return "High Competitive Pressure";
}

function expectedOutcomeForAction(action: string): string {
  const text = action.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) return "Visitors can more quickly understand how to contact your business or request a quote.";
  if (/viewport|resource|mobile|speed|responsive/.test(text)) return "Mobile visitors can understand the offer and reach the next step with less abandonment risk.";
  if (/trust|review|testimonial|proof|credib|guarantee|certif/.test(text)) return "More customers may feel confident contacting the business before comparing alternatives.";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "Fewer customers need to leave the site to answer buying-stage questions.";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "Customers can find and understand the right pages more easily.";
  return "The customer decision path becomes clearer and easier to act on.";
}

function effortForAction(action: string): string {
  const text = action.toLowerCase();
  if (/schema|entity|citation|local|resource|speed|technical|render|responsive/.test(text)) return "Medium";
  if (/redesign|architecture|migration|checkout|booking/.test(text)) return "High";
  return "Low";
}

function firstActionForRecommendation(action: string): string {
  const text = action.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) return "Make the main contact or quote action visible near the first customer decision point.";
  if (/trust|review|testimonial|proof|credib/.test(text)) return "Place the strongest proof near high-intent pages and contact paths.";
  if (/question|faq|answer|pricing|cost|process/.test(text)) return "Add clear answers for the highest-intent customer questions first.";
  if (/visibility|search|local|schema|entity|citation/.test(text)) return "Start with the visibility signals that also help customers understand the business.";
  return "Complete the highest-confidence action first, then re-scan to validate improvement.";
}

function initiativeBucket(action: string): "enquiries" | "confidence" | "discoverability" {
  const text = action.toLowerCase();
  if (/trust|review|testimonial|proof|credib|guarantee|certif|case stud|question|faq|answer|pricing|cost|process|objection/.test(text)) return "confidence";
  if (/visibility|search|local|schema|entity|citation|discover|topic|internal link/.test(text)) return "discoverability";
  return "enquiries";
}

function businessExplanationForAction(action: string, reason: string): string {
  const text = `${action} ${reason}`.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) return "Help visitors immediately understand how to contact your business or request a quote.";
  if (/viewport|resource|mobile|contact|cta|action path|speed|responsive/.test(text)) return "Make it easier for mobile visitors to quickly understand your offer and contact your business. This reduces abandonment among high-intent visitors.";
  if (/trust|review|testimonial|proof|credib|guarantee|certif/.test(text)) return "Give visitors stronger reasons to trust the business before they compare alternatives or decide to contact you.";
  if (/competitor|compare|comparison|alternative|versus/.test(text)) return "Close the information gap that may make competitors feel safer or easier to choose during customer comparison.";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "Answer the questions customers ask before they contact, book, or buy so fewer people leave to research elsewhere.";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "Help customers find the right pages and understand the business faster when they are searching for a solution.";
  if (/conversion|form|booking|checkout|lead|buy|contact/.test(text)) return "Make the next step clearer so interested visitors can move from interest to action with less friction.";
  return "Improve the customer decision path so visitors can understand the offer, trust the business, and take the next step with less hesitation.";
}

function technicalTasksForAction(action: string): string[] {
  const safeAction = sanitizeCustomerText(action);
  const text = safeAction.toLowerCase();
  const tasks = new Set<string>();
  if (/viewport|responsive/.test(text)) tasks.add("Improve viewport and responsive layout behavior.");
  if (/resource|speed|weight|load/.test(text)) tasks.add("Reduce resource weight and loading friction.");
  if (/mobile|tap|contact|cta|action path/.test(text)) tasks.add("Make mobile contact and primary action paths easier to reach.");
  if (/review|testimonial|proof|trust|credib/.test(text)) tasks.add("Add visible trust proof near high-intent decision points.");
  if (/faq|question|answer|pricing|cost|process/.test(text)) tasks.add("Add direct answers for pricing, process, objections, and decision-stage questions.");
  if (/schema|entity|citation|local|search|visibility/.test(text)) tasks.add("Strengthen entity, local, internal-linking, and structured visibility cues where supported by evidence.");
  tasks.add(safeAction);
  return Array.from(tasks).slice(0, 5);
}

function scoreForDimension(report: ReportSnapshot, key: string): number | null {
  const dimension = (report.dimensions ?? []).find((item) => item.key === key || item.label === key);
  return typeof dimension?.score === "number" && Number.isFinite(dimension.score) ? dimension.score : null;
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const scores = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function healthStatusForScore(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not Assessed";
  if (score >= 75) return "Strong";
  if (score >= 55) return "Moderate";
  return "Needs Improvement";
}

function numberFromText(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreComparisonText(primaryScore: number | null | undefined, competitorScore: number | null | undefined): string {
  return `Client ${formatNullableScore(primaryScore)} vs competitor ${formatNullableScore(competitorScore)}`;
}

function firstRoadmapAction(report: ReportSnapshot): string {
  const roadmap = buildCustomerRecommendationRoadmap(report, false) as Record<string, unknown>;
  const phases = Array.isArray(roadmap["phases"]) ? roadmap["phases"] as Array<Record<string, unknown>> : [];
  for (const phase of phases) {
    const actions = Array.isArray(phase["actions"]) ? phase["actions"] as Array<Record<string, unknown>> : [];
    const action = sanitizeCustomerText(actions[0]?.["action"] ?? "");
    if (action) return action;
  }
  return actionForDimensionKey("visibilityStructure");
}

function summarizeCustomerEvidenceStrength(report: ReportSnapshot): string {
  const sampledPages = report.evidenceCoverageSummary?.totalPagesSampled ?? report.scanCoverage?.sampledPages ?? 0;
  const validatedFindings = report.evidenceCoverageSummary?.totalEvidenceObjects ?? report.evidenceObjects?.filter(isCustomerEvidence).length ?? 0;
  if (sampledPages <= 0 || validatedFindings <= 0) return "Very limited";
  if (sampledPages < 2 || validatedFindings < 4) return "Limited";
  if (validatedFindings < 10) return "Moderate";
  return "Strong";
}
function findNativeSignal(report: ReportSnapshot, signalKey: string): EvidenceObject | undefined {
  return nativeSignalList(report, signalKey).sort((a, b) => (signalScore(b) ?? -1) - (signalScore(a) ?? -1))[0];
}

function nativeSignalList(report: ReportSnapshot, signalKey: string): EvidenceObject[] {
  return (report.evidenceObjects ?? []).filter((evidence) => evidence.normalizedInput?.["signalKey"] === signalKey);
}

function signalScore(evidence: EvidenceObject | undefined): number | null {
  if (!evidence) return null;
  return evidenceScore(evidence);
}

function firstNumber(values: Array<number | null | undefined>): number | null {
  const value = values.find((item): item is number => typeof item === "number" && Number.isFinite(item));
  return value ?? null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNullableScore(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? `${Math.round(score)}/100` : "Not assessed";
}

function signalStatus(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not assessed";
  if (score >= 75) return "Strong support";
  if (score >= 55) return "Needs improvement";
  return "Coverage gap detected";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function evidenceCorpus(report: ReportSnapshot): string {
  return [
    report.targetUrl,
    report.decisionSummary,
    ...(report.evidenceObjects ?? []).map((evidence) => `${evidence.rawValue} ${evidence.confidenceBasis} ${evidence.groundTruthMeaning ?? ""}`),
    ...(report.evidenceDatabase ?? []).map((evidence) => `${evidence.issue} ${evidence.confidenceReason}`),
    ...(report.recommendationEngine?.recommendations ?? []).map((recommendation) => `${recommendation.issue} ${recommendation.action}`)
  ].join(" ");
}

function signalBusinessArea(signalKey: string): string {
  if (signalKey.includes("question")) return "customer question coverage";
  if (signalKey.includes("trust_proof")) return "trust proof";
  if (signalKey.includes("decision_confidence")) return "decision confidence";
  if (signalKey.includes("topic_authority")) return "topic authority";
  if (signalKey.includes("search_demand")) return "search demand coverage";
  if (signalKey.includes("serp")) return "search result support";
  if (signalKey.includes("local_visibility")) return "local visibility";
  if (signalKey.includes("entity")) return "entity clarity";
  if (signalKey.includes("citation")) return "citation credibility";
  if (signalKey.includes("freshness")) return "content freshness";
  if (signalKey.includes("search_to_sale")) return "search-to-sale support";
  return "customer decision support";
}

function competitorGapImpact(signalKey: string): string {
  if (signalKey.includes("question")) return "A competitor may answer pre-contact questions better, reducing hesitation for comparison shoppers.";
  if (signalKey.includes("trust")) return "A competitor may feel safer or more credible if proof is easier to validate.";
  if (signalKey.includes("decision_confidence")) return "A competitor may reduce uncertainty with stronger proof, transparency, and next-step support.";
  if (signalKey.includes("local_visibility")) return "A local customer may choose the competitor if location, service area, hours, or local proof are clearer.";
  if (signalKey.includes("topic") || signalKey.includes("search")) return "A competitor may capture more demand by explaining the topic more completely.";
  return "A competitor may give comparison-shopping customers more confidence in this decision area.";
}

function questionFamilyToCustomerQuestion(key: string): string {
  const labels: Record<string, string> = {
    pricing_transparency: "What does it cost, or how is pricing estimated?",
    process_clarity: "What happens next, and how does the process work?",
    trust_questions: "Can I trust this business?",
    comparison_support: "Why choose this business instead of another option?",
    objection_handling: "What if something goes wrong?",
    decision_support: "What information helps me decide?",
    contact_confidence: "How do I contact, book, request, or buy?",
    shipping_confidence: "How will shipping or delivery work?",
    returns_confidence: "Can I return, refund, exchange, or use a warranty?",
    purchase_security: "Is checkout and payment safe?",
    service_area: "Do they serve my area?",
    availability: "When are they available?",
    appointment_confidence: "How do appointments, insurance, treatment, or patient next steps work?",
    case_fit: "Is this business the right fit for my case?",
    demo_trial: "Can I try, demo, integrate, or onboard confidently?"
  };
  return labels[key] ?? titleCase(key.replaceAll("_", " "));
}

function formatImpactArea(value: string): string {
  return titleCase(value.replaceAll("_", " "));
}

function customerIssueLabel(report: ReportSnapshot, canonicalIssueId: string, index: number): string {
  const contract = (report as unknown as { globalOutputContract?: ReportSnapshot["globalOutputContract"] }).globalOutputContract;
  const summary = contract?.keyDecisionSummary.find((item) => item.canonicalIssueId === canonicalIssueId)?.summary;
  return summary ? sanitizeCustomerText(summary) : `Issue ${index + 1}`;
}

function actionForDimensionKey(key: string): string {
  if (key === "trust") return "Add stronger proof, reviews, testimonials, certifications, guarantees, and credibility cues.";
  if (key === "conversionReadiness") return "Clarify the primary action path and remove friction before form, booking, contact, or purchase.";
  if (key === "informationClarity") return "Explain the offer, process, pricing cues, outcomes, and next steps more clearly.";
  if (key === "visibilityStructure") return "Improve discoverability, page structure, entity cues, local signals, and internal linking.";
  if (key === "mobileExperience") return "Improve the mobile decision path, spacing, readability, and tappable action visibility.";
  return "Improve the weakest validated customer decision area first.";
}

function customerImpactForDimensionKey(key: string): string {
  if (key === "trust") return "Visitors may question credibility before contacting, booking, or buying.";
  if (key === "conversionReadiness") return "Interested visitors may not see a clear next step and leave without converting.";
  if (key === "informationClarity") return "Visitors may need extra effort to understand the offer, which increases drop-off risk.";
  if (key === "visibilityStructure") return "Customers may not find, understand, or trust the important pages quickly enough.";
  return "This gap may reduce customer confidence during the decision process.";
}

function formatCustomerRange(range: ReportSnapshot["revenueIntelligence"]["trafficRange"]): string {
  return `${sanitizeCustomerText(range.label)}: ${range.low}-${range.high} ${range.unit.replaceAll("_", " ")} (${range.confidenceScore}% confidence).`;
}

function safeHostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Competitor";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}
function buildCustomerIntelligenceSummaries(report: ReportSnapshot): Array<Record<string, string>> {
  return (report.evidenceObjects ?? [])
    .filter((evidence) => isCustomerEvidence(evidence) && String(evidence.normalizedInput?.sourceModule ?? "").startsWith("systolab_"))
    .map((evidence) => {
      const signalKey = String(evidence.normalizedInput?.signalKey ?? "");
      const score = evidenceScore(evidence);
      return {
        section: customerSectionForSignal(signalKey),
        title: customerSignalTitle(evidence),
        status: score >= 75 ? "Strong support" : score >= 55 ? "Needs improvement" : "Coverage gap detected",
        meaning: intelligenceMeaningForSignal(signalKey),
        action: actionForSignal(signalKey),
        confidence: `${Math.round(evidence.groundTruthConfidence ?? 60)}% evidence confidence`
      };
    })
    .slice(0, 15);
}

function isCustomerEvidence(evidence: EvidenceObject): boolean {
  if (evidence.sourceType === "system" || evidence.sourceType === "network" || evidence.sourceType === "http") return false;
  const text = `${evidence.rawValue} ${evidence.confidenceBasis} ${evidence.groundTruthMeaning ?? ""}`;
  return !INTERNAL_TEXT_PATTERN.test(text);
}

function customerSignalTitle(evidence: EvidenceObject): string {
  return sanitizeCustomerText(
    String(
      evidence.normalizedInput?.["label"] ??
        evidence.normalizedInput?.["signalLabel"] ??
        evidence.normalizedInput?.["signalKey"] ??
        evidence.pageRole ??
        "Validated Website Finding"
    )
  );
}

function customerSectionForSignal(signalKey: string): string {
  if (signalKey.includes("question")) return "questions";
  if (signalKey.includes("decision_confidence")) return "confidence";
  if (signalKey.includes("trust")) return "trustProof";
  if (signalKey.includes("local_visibility")) return "trustProof";
  if (signalKey.includes("journey")) return "journey";
  return "search";
}

function evidenceScore(evidence: EvidenceObject): number {
  const value = evidence.normalizedInput?.["value"];
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 100 : 0;
  return 0;
}

function intelligenceMeaningForSignal(signalKey: string): string {
  if (signalKey.includes("question")) return "Customers may still have unanswered questions before they feel ready to contact, book, or buy.";
  if (signalKey.includes("decision_confidence")) return "Visitors may hesitate if proof, clarity, reassurance, or transparency is incomplete.";
  if (signalKey.includes("trust")) return "Weak proof can make customers delay decisions or compare competitors with stronger credibility signals.";
  if (signalKey.includes("journey")) return "The path from discovery to action may contain friction that interrupts confidence before conversion.";
  if (signalKey.includes("topic_authority")) return "Customers may be unable to find enough helpful service information to build confidence before contacting the business.";
  if (signalKey.includes("search_demand")) return "Customer demand may exist around services, questions, comparisons, timing, or trust topics that the current website does not cover strongly enough.";
  if (signalKey.includes("serp")) return "Search-result presentation opportunities may be missed when answer formats, local cues, reviews, visuals, or comparison support are incomplete.";
  if (signalKey.includes("ranking_opportunity")) return "Visibility opportunities should be prioritized by evidence strength, customer relevance, trust gaps, and business impact rather than ranking promises.";
  if (signalKey.includes("local_visibility")) return "Local customers may need clearer location, service-area, availability, contact, and credibility signals before choosing the business.";
  if (signalKey.includes("entity")) return "Customers and search systems may need clearer signals about the business, services, locations, people, and expertise.";
  if (signalKey.includes("citation")) return "Discoverability and credibility improve when reputation, association, listing, and authority signals are clear.";
  if (signalKey.includes("freshness")) return "Stale content can make customers question whether the offer, service, or information is current.";
  if (signalKey.includes("competitor_content_gap")) return "A competitor appears to give customers stronger supporting information in an area that affects comparison decisions.";
  return "This evidence affects customer confidence, clarity, trust, visibility, or action readiness.";
}

function actionForSignal(signalKey: string): string {
  if (signalKey.includes("question")) return "Add direct answers for pricing, process, comparison, objection, trust, and decision-stage questions.";
  if (signalKey.includes("decision_confidence")) return "Add clearer proof, policies, pricing cues, process steps, reassurance, and next-step guidance.";
  if (signalKey.includes("trust")) return "Add testimonials, reviews, certifications, case studies, awards, or client credibility signals.";
  if (signalKey.includes("journey")) return "Reduce navigation friction and make trust cues, key content, and CTAs visible along the path to action.";
  if (signalKey.includes("topic_authority")) return "Build stronger educational pages, service guides, supporting resources, and answers around decision topics.";
  if (signalKey.includes("search_demand")) return "Add content for uncovered demand topics, service/product needs, comparison questions, local intent, reputation concerns, and seasonal or timing needs.";
  if (signalKey.includes("serp")) return "Structure key pages with direct answers, FAQ-style sections, review proof, visual support, comparison context, and clear local/entity cues.";
  if (signalKey.includes("ranking_opportunity")) return "Prioritize low-effort, medium-term, and strategic visibility improvements that also strengthen trust, clarity, and conversion readiness.";
  if (signalKey.includes("local_visibility")) return "Clarify phone, address, hours, service areas, directions, local proof, review signals, and appointment/contact paths.";
  if (signalKey.includes("entity")) return "Clarify business identity, service names, product/service relationships, team expertise, locations, and structured entity signals.";
  if (signalKey.includes("citation")) return "Strengthen reputation, association, directory, listing, partner, and authority references where they support credibility.";
  if (signalKey.includes("freshness")) return "Update outdated pages, refresh service information, remove expired offers, and add current dates where useful.";
  if (signalKey.includes("competitor_content_gap")) return "Close the competitor information gap with stronger educational, proof, transparency, or decision-support content.";
  return "Improve the supporting content and proof around this customer decision area.";
}

function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalFields);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeCustomerText(value) : value;
  }

  const clean: JsonRecord = {};
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (isInternalFieldKey(key)) continue;
    clean[key] = stripInternalFields(entry);
  }
  return clean;
}

function isInternalFieldKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, "").toLowerCase();
  return [...INTERNAL_FIELD_KEYS].some((candidate) => candidate.replace(/[\s_-]/g, "").toLowerCase() === normalized);
}

function sanitizeCustomerText(value: unknown): string {
  const text = String(value ?? "Not Available")
    .replace(/\bEO-[A-Za-z0-9-]+/g, "validated finding")
    .replace(/\bEV-[A-Za-z0-9-]+/g, "validated finding")
    .replace(/\bREC-[A-Za-z0-9-]+/g, "recommendation")
    .replace(/\bTRACE-[A-Za-z0-9-]+/gi, "internal reference")
    .replace(/\bOSS\b/g, "Business Readiness Score")
    .replace(/Operational Site Score/gi, "Business Readiness Score")
    .replace(/Global Output Contract/gi, "Business Decision Summary")
    .replace(/Action Plan Mapping/gi, "Priority Action Summary")
    .replace(/canonical issue ids?/gi, "business decision references")
    .replace(/canonical issues?/gi, "business decisions")
    .replace(/canonical/gi, "business")
    .replace(/dependency intelligence/gi, "fix-order guidance")
    .replace(/dependency chains?/gi, "issue connections")
    .replace(/dependencies/gi, "fix-order relationships")
    .replace(/attribution/gi, "business impact link")
    .replace(/robots\.txt|robots/gi, "website access rules")
    .replace(/crawler|crawl/gi, "content collection")
    .replace(/parser|parsing/gi, "content analysis")
    .replace(/\bHTTP\b/gi, "website access")
    .replace(/\bDOM\b/gi, "page structure")
    .replace(/\bGTCS\b/g, "Evidence Confidence")
    .replace(/evidence objects?/gi, "validated findings")
    .replace(/headless browser rendering/gi, "visual validation")
    .replace(/\bGBP\b/g, "Business Profile")
    .replace(/\s+/g, " ")
    .trim();
  return INTERNAL_TEXT_PATTERN.test(text) ? "Technical collection details are available in the internal report." : text;
}

function dedupeCoveragePages(pages: ReportSnapshot["evidenceCoverageSummary"]["pages"]): ReportSnapshot["evidenceCoverageSummary"]["pages"] {
  return dedupeBy(pages, (page) => normalizeUrlKey(page.url));
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.hostname.toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function average(values: number[]): number {
  const scores = values.filter((value) => Number.isFinite(value));
  if (scores.length === 0) return 0;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}
