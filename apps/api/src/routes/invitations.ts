import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { acceptInvitation, listPendingInvitations, MembershipError } from "../services/membershipService.js";

export const invitationsRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

// ── POST /invitations/accept ──────────────────────────────────────────────────
// Accepts an invitation token. The acceptor must be authenticated and their
// email must match the invitation's email.

invitationsRouter.post("/accept", authRequired, async (req: Request, res: Response) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: { message: "token is required." } });
      return;
    }
    const email = req.auth!.user.email;
    if (!email) {
      res.status(400).json({ error: { message: "Your account must have a verified email to accept invitations." } });
      return;
    }
    const result = await acceptInvitation(token, req.auth!.user.userId, email);
    res.json({ tenantSlug: result.tenantSlug, workspaceId: result.workspaceId ?? null });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /invitations/pending ──────────────────────────────────────────────────
// Lists pending invitations for a tenant (owner only).

invitationsRouter.get("/pending", authRequired, async (req: Request, res: Response) => {
  try {
    const tenantId = req.query["tenantId"] as string | undefined;
    if (!tenantId) {
      res.status(400).json({ error: { message: "tenantId query parameter is required." } });
      return;
    }
    const invitations = await listPendingInvitations(tenantId);
    res.json({ items: invitations });
  } catch (error) {
    handleError(error, res);
  }
});
