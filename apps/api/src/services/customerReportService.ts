import type { ReportSnapshot } from "@systolab/shared";

export function isContentUnavailableReport(report: ReportSnapshot): boolean {
  return !report.oss || report.status === "content_unavailable" || report.oss.scoringStatus === "not_scored" || report.oss.score === null;
}

export function buildCustomerReportPayload(report: ReportSnapshot): ReportSnapshot | Record<string, unknown> {
  if (!isContentUnavailableReport(report)) return report;

  const {
    architectureState: _architectureState,
    confidenceEngine: _confidenceEngine,
    dataInputs: _dataInputs,
    dimensions: _dimensions,
    editIntelligenceSystem: _editIntelligenceSystem,
    evidenceClusters: _evidenceClusters,
    evidenceDatabase: _evidenceDatabase,
    evidenceObjects: _evidenceObjects,
    executionProvenance: _executionProvenance,
    groundTruthValidationLog: _groundTruthValidationLog,
    integrity: _integrity,
    monitoringScheduler: _monitoringScheduler,
    operationalMemoryGraph: _operationalMemoryGraph,
    rawSignalTelemetry: _rawSignalTelemetry,
    reportGovernance: _reportGovernance,
    structuredOutputSchema: _structuredOutputSchema,
    systemHealthState: _systemHealthState,
    validationTrace: _validationTrace,
    ...safe
  } = report;

  return {
    ...safe,
    status: "content_unavailable",
    scanCoverage: {
      sampledPages: 0,
      discoveredPages: 0,
      coverageLabel: "0% evidence coverage - content unavailable",
      robotsTxtStatus: "not_checked",
      pageRoles: {}
    },
    evidenceCoverageSummary: {
      totalPages: 0,
      pages: [],
      globalCoverageStatus: "Limited",
      explanation: "Website content could not be collected, so evidence coverage is 0%."
    },
    customerAssessment: {
      status: "Content Unavailable",
      evidenceCoverage: "0%",
      confidence: "Very Limited",
      oss: "Not Scored",
      reason: "Website content could not be collected.",
      recommendedAction: "Review access/security/robots settings and re-run scan."
    }
  };
}
