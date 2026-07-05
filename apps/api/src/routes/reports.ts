import type { Request, Response } from "express";
import { Router } from "express";
import { authOptional } from "../middleware/authOptional.js";
import { findSnapshot } from "../services/persistenceService.js";
import { buildCustomerDecisionObject } from "../services/decisionCompressionService.js";
import { buildCustomerReportPayload } from "../services/customerReportService.js";
import { buildDecisionTimelineForReport } from "../services/decisionTimelineService.js";
import { renderReportPdf } from "../services/pdfService.js";
import { resolveArtifactBuffer } from "../services/artifactService.js";
import { completePlatformJob, enqueuePlatformJob, failPlatformJob } from "../services/platformControlPlaneService.js";
import { getWorkspaceMembership, derivedWorkspaceId } from "../services/membershipService.js";

const DEFAULT_SLUGS = new Set(["default", "systolab"]);

export const reportsRouter = Router();

// Customer-safe compressed output. Decision Compression Layer is the exclusive gateway.
reportsRouter.get("/:snapshotId/decision", authOptional, async (req: Request, res: Response) => {
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
  const allowed = await canReadReport(req, res, report);
  if (!allowed) return;
  res.json(buildCustomerDecisionObject(report));
});

// Full internal ReportSnapshot for authenticated internal operators.
reportsRouter.get("/:snapshotId/timeline", authOptional, async (req: Request, res: Response) => {
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
  const allowed = await canReadReport(req, res, report);
  if (!allowed) return;
  res.json(await buildDecisionTimelineForReport(report));
});

reportsRouter.get("/:snapshotId", authOptional, async (req: Request, res: Response) => {
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
  const allowed = await canReadReport(req, res, report);
  if (!allowed) return;
  const payload = buildCustomerReportPayload(report);
  payload.decisionTimeline = await buildDecisionTimelineForReport(report);
  res.json(payload);
});

reportsRouter.get("/:snapshotId/pdf", authOptional, async (req, res) => {
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
  const allowed = await canReadReport(req, res, report, {
    forceAuthenticated: report.tenantBranding.pdfSecurity?.downloadRestriction === "authenticated_only"
  });
  if (!allowed) return;
  if (isPdfDownloadExpired(report)) {
    res.status(410).json({ error: { code: "REPORT_EXPIRED", message: "This report PDF is no longer available because the configured validity window has expired." } });
    return;
  }

  const job = await enqueuePlatformJob({
    jobType: "pdf.export",
    queue: "reporting",
    priority: 6,
    payload: { snapshotId: report.snapshotId, targetUrl: report.targetUrl, tenantSlug: report.tenantBranding.slug, userId: req.auth?.user?.userId, requestHost: req.hostname, pdfSecurity: report.tenantBranding.pdfSecurity }
  });
  try {
    const pdf = await renderReportPdf(report, (artifactId) => resolveArtifactBuffer(artifactId));
    await completePlatformJob(job.jobId, { snapshotId: report.snapshotId, bytes: pdf.length });
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${report.snapshotId}.pdf"`);
    if (report.tenantBranding.pdfSecurity?.tamperSeal) res.setHeader("x-systolab-pdf-tamper-seal", report.integrity?.immutableVerificationFingerprint ?? report.integrity?.snapshotHash ?? report.snapshotId);
    if (report.tenantBranding.pdfSecurity?.watermarkText) res.setHeader("x-systolab-pdf-watermark", "enabled");
    if (report.tenantBranding.pdfSecurity?.auditDownloads) res.setHeader("x-systolab-pdf-audit", "recorded");
    res.send(pdf);
  } catch (error) {
    await failPlatformJob(job.jobId, error);
    throw error;
  }
});

function isPdfDownloadExpired(report: Awaited<ReturnType<typeof findSnapshot>>): boolean {
  if (!report) return false;
  if (report.tenantBranding.pdfSecurity?.downloadRestriction !== "expires_after_validity") return false;
  const days = report.tenantBranding.reportValidityDays;
  if (!days || days <= 0) return false;
  const created = new Date(report.clientInformation?.scanDate ?? report.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return Date.now() > created.getTime() + days * 24 * 60 * 60 * 1000;
}
async function canReadReport(req: Request, res: Response, report: Awaited<ReturnType<typeof findSnapshot>>, options: { forceAuthenticated?: boolean } = {}): Promise<boolean> {
  if (!report) return false;
  if (options.forceAuthenticated && !req.auth?.user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required to view this report." } });
    return false;
  }
  if (DEFAULT_SLUGS.has(report.tenantBranding.slug)) return true;
  if (!req.auth?.user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required to view this report." } });
    return false;
  }
  const workspaceId = derivedWorkspaceId(report.tenantBranding.slug, report.targetUrl);
  const membership = await getWorkspaceMembership(req.auth.user.userId, workspaceId);
  if (!membership) {
    res.status(403).json({ error: { code: "NOT_WORKSPACE_MEMBER", message: "You do not have access to this report." } });
    return false;
  }
  return true;
}
