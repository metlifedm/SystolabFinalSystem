import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requireWorkspaceMember } from "../middleware/tenantAccess.js";
import { getTenantMembershipBySlug, MembershipError } from "../services/membershipService.js";
import {
  createProjectForTenant,
  getProjectForMember,
  listProjectReports,
  listProjectsForUser,
  runProjectScan,
  updateProjectForMember,
  type ProjectInput
} from "../services/portalService.js";
import { assertPublicHttpUrl } from "../services/truth-engine/network.js";

export const projectsRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  if (error instanceof Error) {
    res.status(400).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

projectsRouter.get("/", authRequired, async (req: Request, res: Response) => {
  try {
    const tenantSlug = typeof req.query["tenantSlug"] === "string" ? req.query["tenantSlug"] : undefined;
    const items = await listProjectsForUser(req.auth!.user.userId, tenantSlug);
    res.json({ items });
  } catch (error) {
    handleError(error, res);
  }
});

projectsRouter.post("/", authRequired, async (req: Request, res: Response) => {
  try {
    const input = req.body as ProjectInput;
    if (!input.tenantSlug || !input.targetUrl) {
      res.status(400).json({ error: { message: "tenantSlug and targetUrl are required." } });
      return;
    }
    const membership = await getTenantMembershipBySlug(req.auth!.user.userId, input.tenantSlug);
    if (!membership || !["owner", "member"].includes(membership.role)) {
      res.status(403).json({ error: { message: "You do not have permission to create projects for this tenant." } });
      return;
    }
    await validateProjectUrls(input);
    const project = await createProjectForTenant(req.auth!.user.userId, input);
    res.status(201).json({ project });
  } catch (error) {
    handleError(error, res);
  }
});

projectsRouter.get("/:workspaceId", authRequired, requireWorkspaceMember(), async (req: Request, res: Response) => {
  try {
    const project = await getProjectForMember(req.workspaceCtx!.workspaceId, req.workspaceCtx!.role);
    res.json({ project });
  } catch (error) {
    handleError(error, res);
  }
});

projectsRouter.patch("/:workspaceId", authRequired, requireWorkspaceMember(["owner", "editor"]), async (req: Request, res: Response) => {
  try {
    const updates = req.body as Partial<Omit<ProjectInput, "tenantSlug">>;
    await validateProjectUrls(updates);
    const project = await updateProjectForMember(req.workspaceCtx!.workspaceId, req.workspaceCtx!.role, updates);
    res.json({ project });
  } catch (error) {
    handleError(error, res);
  }
});

projectsRouter.get("/:workspaceId/reports", authRequired, requireWorkspaceMember(), async (req: Request, res: Response) => {
  try {
    const items = await listProjectReports(req.workspaceCtx!.workspaceId);
    res.json({ items });
  } catch (error) {
    handleError(error, res);
  }
});

projectsRouter.post("/:workspaceId/scans", authRequired, requireWorkspaceMember(["owner", "editor"]), async (req: Request, res: Response) => {
  try {
    const input = req.body as { mode?: "fast_scan" | "full_audit"; includeSeo?: boolean; competitorUrls?: string[]; gbpUrl?: string };
    await validateProjectUrls({ competitorUrls: input.competitorUrls, gbpUrl: input.gbpUrl });
    const job = await runProjectScan(req.workspaceCtx!.workspaceId, req.workspaceCtx!.tenantId, req.auth!.user.userId, input);
    res.status(202).json(job);
  } catch (error) {
    handleError(error, res);
  }
});

async function validateProjectUrls(input: Partial<ProjectInput>): Promise<void> {
  if (typeof input.targetUrl === "string" && input.targetUrl.trim()) await assertPublicHttpUrl(input.targetUrl);
  if (Array.isArray(input.competitorUrls)) {
    await Promise.all(input.competitorUrls.filter(Boolean).map((url) => assertPublicHttpUrl(url)));
  }
  if (typeof input.gbpUrl === "string" && input.gbpUrl.trim()) await assertPublicHttpUrl(input.gbpUrl);
}
