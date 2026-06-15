import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requireWorkspaceMember } from "../middleware/tenantAccess.js";
import { ScanHistory } from "../models/ScanHistory.js";
import {
  addWorkspaceMember,
  createWorkspace,
  listUserWorkspaces,
  listWorkspaceMembers,
  MembershipError,
  removeWorkspaceMember,
  updateWorkspace,
  updateWorkspaceMemberRole
} from "../services/membershipService.js";

export const workspacesRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

// ── POST /workspaces ──────────────────────────────────────────────────────────

workspacesRouter.post("/", authRequired, async (req: Request, res: Response) => {
  try {
    const { tenantId, tenantSlug, targetUrl, industry } = req.body as {
      tenantId?: string;
      tenantSlug?: string;
      targetUrl?: string;
      industry?: string;
    };
    if (!tenantId || !tenantSlug || !targetUrl) {
      res.status(400).json({ error: { message: "tenantId, tenantSlug, and targetUrl are required." } });
      return;
    }
    const { workspace, membership } = await createWorkspace(tenantId, tenantSlug, req.auth!.user.userId, targetUrl, industry);
    res.status(201).json({ workspace, membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /workspaces ───────────────────────────────────────────────────────────

workspacesRouter.get("/", authRequired, async (req: Request, res: Response) => {
  try {
    const tenantSlug = req.query["tenantSlug"] as string | undefined;
    const memberships = await listUserWorkspaces(req.auth!.user.userId, tenantSlug);
    res.json({ items: memberships });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /workspaces/:workspaceId ──────────────────────────────────────────────

workspacesRouter.get("/:workspaceId", authRequired, requireWorkspaceMember(), async (req: Request, res: Response) => {
  res.json({ workspaceId: req.workspaceCtx!.workspaceId, role: req.workspaceCtx!.role });
});

// ── PATCH /workspaces/:workspaceId ────────────────────────────────────────────

workspacesRouter.patch("/:workspaceId", authRequired, requireWorkspaceMember(["owner", "editor"]), async (req: Request, res: Response) => {
  try {
    const allowed = ["industry", "businessContext", "preferences"] as const;
    type UpdateKey = typeof allowed[number];
    const updates: Partial<Record<UpdateKey, unknown>> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const workspace = await updateWorkspace(req.workspaceCtx!.workspaceId, updates as Parameters<typeof updateWorkspace>[1]);
    res.json({ workspace });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /workspaces/:workspaceId/members ──────────────────────────────────────

workspacesRouter.get("/:workspaceId/members", authRequired, requireWorkspaceMember(), async (req: Request, res: Response) => {
  try {
    const members = await listWorkspaceMembers(req.workspaceCtx!.workspaceId);
    res.json({ items: members });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /workspaces/:workspaceId/members ─────────────────────────────────────

workspacesRouter.post("/:workspaceId/members", authRequired, requireWorkspaceMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || !role || !["owner", "editor", "viewer"].includes(role)) {
      res.status(400).json({ error: { message: "userId and a valid role (owner, editor, viewer) are required." } });
      return;
    }
    const membership = await addWorkspaceMember(
      req.workspaceCtx!.workspaceId,
      req.workspaceCtx!.tenantId,
      req.workspaceCtx!.tenantSlug,
      userId,
      role as "owner" | "editor" | "viewer"
    );
    res.status(201).json({ membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── PATCH /workspaces/:workspaceId/members/:userId/role ───────────────────────

workspacesRouter.patch("/:workspaceId/members/:userId/role", authRequired, requireWorkspaceMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { role } = req.body as { role?: string };
    if (!role || !["owner", "editor", "viewer"].includes(role)) {
      res.status(400).json({ error: { message: "role must be one of: owner, editor, viewer." } });
      return;
    }
    const membership = await updateWorkspaceMemberRole(req.workspaceCtx!.workspaceId, req.params["userId"]!, role as "owner" | "editor" | "viewer");
    res.json({ membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── DELETE /workspaces/:workspaceId/members/:userId ───────────────────────────

workspacesRouter.delete("/:workspaceId/members/:userId", authRequired, requireWorkspaceMember(["owner"]), async (req: Request, res: Response) => {
  try {
    await removeWorkspaceMember(req.workspaceCtx!.workspaceId, req.params["userId"]!, req.auth!.user.userId);
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /workspaces/:workspaceId/scans ────────────────────────────────────────

workspacesRouter.get("/:workspaceId/scans", authRequired, requireWorkspaceMember(), async (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query["limit"] ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 100) : 20;
    const scans = await ScanHistory.find({ workspaceId: req.workspaceCtx!.workspaceId })
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ items: scans });
  } catch (error) {
    handleError(error, res);
  }
});
