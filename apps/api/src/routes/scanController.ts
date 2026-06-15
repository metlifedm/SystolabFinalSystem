import type { Request, Response } from "express";
import type { ScanMode, ScanRequest } from "@systolab/shared";
import { findSnapshot } from "../services/persistenceService.js";
import { enqueuePlatformJob } from "../services/platformControlPlaneService.js";
import { buildCustomerDecisionObject } from "../services/decisionCompressionService.js";
import { assertPublicHttpUrl } from "../services/truth-engine/network.js";

export async function createScan(req: Request, res: Response): Promise<void> {
  const scanRequest = parseScanRequest(req.body);
  await validateScanRequestUrls(scanRequest);

  const tenantSlug = scanRequest.tenantSlug ?? req.tenantBranding?.slug ?? "default";
  const scanJob = await enqueuePlatformJob({
    jobType: "scan.execution",
    queue: "scan",
    priority: scanRequest.mode === "full_audit" ? 9 : 7,
    maxAttempts: 3,
    payload: {
      targetUrl: scanRequest.targetUrl,
      tenantSlug,
      mode: scanRequest.mode,
      includeSeo: scanRequest.includeSeo,
      gbpUrl: scanRequest.gbpUrl,
      competitorUrls: scanRequest.competitorUrls ?? [],
      monthlyLeadVolume: scanRequest.monthlyLeadVolume,
      industryType: scanRequest.industryType,
      userId: req.auth?.user.userId ?? undefined
    }
  });

  res.status(202).json({
    jobId: scanJob.jobId,
    status: scanJob.status,
    statusUrl: `/api/scans/${scanJob.jobId}`,
    targetUrl: scanRequest.targetUrl,
    mode: scanRequest.mode,
    queuedAt: scanJob.scheduledFor
  });
}

export async function getReport(req: Request, res: Response): Promise<void> {
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
}

export async function getDecision(req: Request, res: Response): Promise<void> {
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
  res.json(buildCustomerDecisionObject(report));
}

function parseScanRequest(body: unknown): ScanRequest {
  const input = body as Partial<ScanRequest>;
  if (!input || typeof input.targetUrl !== "string" || input.targetUrl.trim().length === 0) {
    throw new Error("targetUrl is required.");
  }
  const mode: ScanMode = input.mode === "full_audit" ? "full_audit" : "fast_scan";
  const competitorUrls = Array.isArray(input.competitorUrls)
    ? input.competitorUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0).slice(0, 5)
    : [];
  return {
    targetUrl: input.targetUrl,
    mode,
    includeSeo: Boolean(input.includeSeo),
    gbpUrl: typeof input.gbpUrl === "string" && input.gbpUrl.trim() ? input.gbpUrl : undefined,
    competitorUrls,
    monthlyLeadVolume: typeof input.monthlyLeadVolume === "number" ? input.monthlyLeadVolume : undefined,
    industryType: typeof input.industryType === "string" && input.industryType.trim() ? input.industryType.trim() : undefined,
    tenantSlug: typeof input.tenantSlug === "string" ? input.tenantSlug : undefined
  };
}

async function validateScanRequestUrls(scanRequest: ScanRequest): Promise<void> {
  await assertPublicHttpUrl(scanRequest.targetUrl);
  await Promise.all((scanRequest.competitorUrls ?? []).map((url) => assertPublicHttpUrl(url)));
  if (scanRequest.gbpUrl) await assertPublicHttpUrl(scanRequest.gbpUrl);
}
