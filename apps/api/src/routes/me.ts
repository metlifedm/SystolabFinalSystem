import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { ensureCustomerOrganization, getPortalMe, startFirstAnalysis } from "../services/portalService.js";
import { assertPublicHttpUrl } from "../services/truth-engine/network.js";

export const meRouter = Router();

meRouter.get("/", authRequired, async (req, res, next) => {
  try {
    res.json(await getPortalMe(req.auth!.user));
  } catch (error) {
    next(error);
  }
});

meRouter.post("/first-analysis", authRequired, async (req, res, next) => {
  try {
    const rawTargetUrl = typeof req.body?.targetUrl === "string" ? req.body.targetUrl.trim() : "";
    if (!rawTargetUrl) {
      res.status(400).json({ error: { message: "Website URL is required." } });
      return;
    }
    const targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawTargetUrl) ? rawTargetUrl : "https://" + rawTargetUrl;
    await assertPublicHttpUrl(targetUrl);
    res.status(202).json(await startFirstAnalysis(req.auth!.user, { targetUrl }));
  } catch (error) {
    next(error);
  }
});
meRouter.post("/agency", authRequired, async (req, res, next) => {
  try {
    const requestedName = typeof req.body?.publicName === "string" ? req.body.publicName.trim() : undefined;
    const organization = await ensureCustomerOrganization(req.auth!.user, requestedName);
    res.status(organization.created ? 201 : 200).json({
      organization: {
        tenantId: String(organization.tenant._id),
        tenantSlug: organization.membership.tenantSlug,
        publicName: organization.tenant.publicName,
        created: organization.created
      }
    });
  } catch (error) {
    next(error);
  }
});
