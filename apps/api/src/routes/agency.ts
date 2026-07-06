import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requireTenantMember } from "../middleware/tenantAccess.js";
import {
  getAgencyDashboard,
  getAgencyProfitabilityReport,
  getClientWorkspaceSummary,
  listClientWorkspaces
} from "../services/agencyService.js";
import { verifyCustomDomain, setVerifiedDomain } from "../services/customDomainService.js";
import {
  AgencyOperatingError,
  generateAgencyProposal,
  getAgencyOperatingSystem,
  updateAgencyKnowledgeBase,
  updateAgencyProfile,
  updateClientWorkspaceState,
  updateProposalTemplates,
  updateRecommendationStatus,
  updateServiceCatalog
} from "../services/agencyOperatingService.js";
import { MembershipError } from "../services/membershipService.js";

export const agencyRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

// ── GET /agency/:slug/dashboard ───────────────────────────────────────────────

agencyRouter.get("/:slug/dashboard", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const dashboard = await getAgencyDashboard(req.tenantCtx!.tenantSlug);
    res.json(dashboard);
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /agency/:slug/workspaces ──────────────────────────────────────────────

agencyRouter.get("/:slug/workspaces", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const workspaces = await listClientWorkspaces(req.tenantCtx!.tenantSlug);
    res.json({ items: workspaces });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /agency/:slug/workspaces/:workspaceId ─────────────────────────────────

agencyRouter.get("/:slug/workspaces/:workspaceId", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const summary = await getClientWorkspaceSummary(req.tenantCtx!.tenantSlug, req.params["workspaceId"]!);
    if (!summary) {
      res.status(404).json({ error: { message: "Workspace not found." } });
      return;
    }
    res.json(summary);
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /agency/:slug/profitability ───────────────────────────────────────────

agencyRouter.get("/:slug/profitability", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const months = Math.min(24, Number(req.query["months"] ?? 6));
    const report = await getAgencyProfitabilityReport(req.tenantCtx!.tenantSlug, months);
    res.json(report);
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /agency/:slug/custom-domain/verify ───────────────────────────────────

agencyRouter.get("/:slug/operating-system", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    res.json(await getAgencyOperatingSystem(req.tenantCtx!.tenantSlug));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.patch("/:slug/profile", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    res.json(await updateAgencyProfile(req.tenantCtx!.tenantSlug, req.auth?.user.userId, req.body));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.put("/:slug/services", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    res.json(await updateServiceCatalog(req.tenantCtx!.tenantSlug, req.auth?.user.userId, req.body?.items));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.put("/:slug/proposal-templates", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    res.json(await updateProposalTemplates(req.tenantCtx!.tenantSlug, req.auth?.user.userId, req.body?.items));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.put("/:slug/knowledge-base", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    res.json(await updateAgencyKnowledgeBase(req.tenantCtx!.tenantSlug, req.auth?.user.userId, req.body));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.patch("/:slug/workspaces/:workspaceId/client-state", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    res.json(await updateClientWorkspaceState(req.tenantCtx!.tenantSlug, req.params["workspaceId"]!, req.auth?.user.userId, req.body));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.patch("/:slug/workspaces/:workspaceId/recommendations/:recommendationId/status", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const { status, note } = req.body as { status?: string; note?: string };
    if (!status) {
      res.status(400).json({ error: { message: "status is required." } });
      return;
    }
    res.json(await updateRecommendationStatus(req.tenantCtx!.tenantSlug, req.params["workspaceId"]!, req.auth?.user.userId, req.params["recommendationId"]!, status as never, note));
  } catch (error) {
    handleError(error, res);
  }
});

agencyRouter.post("/:slug/workspaces/:workspaceId/proposals", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const { templateId } = req.body as { templateId?: string };
    res.status(201).json(await generateAgencyProposal(req.tenantCtx!.tenantSlug, req.params["workspaceId"]!, req.auth?.user.userId, templateId));
  } catch (error) {
    handleError(error, res);
  }
});
agencyRouter.post("/:slug/custom-domain/verify", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { domain } = req.body as { domain?: string };
    if (!domain) {
      res.status(400).json({ error: { message: "domain is required." } });
      return;
    }
    const result = await verifyCustomDomain(req.tenantCtx!.tenantSlug, domain);
    if (result.verified) {
      await setVerifiedDomain(req.tenantCtx!.tenantSlug, domain);
    }
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

