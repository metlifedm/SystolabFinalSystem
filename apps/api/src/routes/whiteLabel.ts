import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requireTenantMember } from "../middleware/tenantAccess.js";
import { MembershipError } from "../services/membershipService.js";
import { resolveWhiteLabelBranding, updateWhiteLabelBranding } from "../services/portalService.js";

export const whiteLabelRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

whiteLabelRouter.get("/resolve", async (req: Request, res: Response) => {
  try {
    const slug = typeof req.query["slug"] === "string" ? req.query["slug"] : undefined;
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : req.hostname;
    res.json(await resolveWhiteLabelBranding({ slug, domain }));
  } catch (error) {
    handleError(error, res);
  }
});

whiteLabelRouter.get("/:slug/branding", async (req: Request, res: Response) => {
  try {
    res.json(await resolveWhiteLabelBranding({ slug: req.params["slug"] }));
  } catch (error) {
    handleError(error, res);
  }
});

whiteLabelRouter.patch("/:slug/branding", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    res.json({ branding: await updateWhiteLabelBranding(req.tenantCtx!.tenantId, req.body) });
  } catch (error) {
    handleError(error, res);
  }
});
