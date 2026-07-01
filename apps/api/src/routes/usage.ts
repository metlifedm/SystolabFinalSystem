import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { getTenantMembershipBySlug, MembershipError } from "../services/membershipService.js";
import { getUsageOverview } from "../services/portalService.js";

export const usageRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

usageRouter.get("/", authRequired, async (req: Request, res: Response) => {
  try {
    const tenantSlug = typeof req.query["tenantSlug"] === "string" ? req.query["tenantSlug"] : undefined;
    if (!tenantSlug) {
      res.status(400).json({ error: { message: "tenantSlug is required." } });
      return;
    }
    const membership = await getTenantMembershipBySlug(req.auth!.user.userId, tenantSlug);
    if (!membership || !["owner", "member"].includes(membership.role)) {
      res.status(403).json({ error: { message: "You do not have permission to view this usage." } });
      return;
    }
    res.json(await getUsageOverview(tenantSlug));
  } catch (error) {
    handleError(error, res);
  }
});
