import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { getTenantBySlug, getTenantMembershipBySlug, MembershipError } from "../services/membershipService.js";
import { activateSubscription, listBillingPlans, seedDefaultPlans } from "../services/billingService.js";
import { cancelTenantBilling, getBillingOverview } from "../services/portalService.js";

export const billingRouter = Router();

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

billingRouter.get("/plans", async (_req: Request, res: Response) => {
  try {
    await seedDefaultPlans();
    res.json({ items: await listBillingPlans() });
  } catch (error) {
    handleError(error, res);
  }
});

billingRouter.get("/", authRequired, async (req: Request, res: Response) => {
  try {
    const tenantSlug = requireTenantSlug(req);
    await assertOwner(req.auth!.user.userId, tenantSlug);
    res.json(await getBillingOverview(tenantSlug));
  } catch (error) {
    handleError(error, res);
  }
});

billingRouter.post("/activate", authRequired, async (req: Request, res: Response) => {
  try {
    const { tenantSlug, planId, interval, trialDays } = req.body as { tenantSlug?: string; planId?: string; interval?: "monthly" | "annual"; trialDays?: number };
    if (!tenantSlug || !planId) {
      res.status(400).json({ error: { message: "tenantSlug and planId are required." } });
      return;
    }
    await assertOwner(req.auth!.user.userId, tenantSlug);
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) throw new MembershipError("Tenant not found.", 404);
    const subscription = await activateSubscription(String(tenant._id), tenant.slug, planId, interval ?? "monthly", { trialDays });
    res.json({ subscription });
  } catch (error) {
    handleError(error, res);
  }
});

billingRouter.post("/cancel", authRequired, async (req: Request, res: Response) => {
  try {
    const { tenantSlug } = req.body as { tenantSlug?: string };
    if (!tenantSlug) {
      res.status(400).json({ error: { message: "tenantSlug is required." } });
      return;
    }
    await assertOwner(req.auth!.user.userId, tenantSlug);
    res.json({ subscription: await cancelTenantBilling(tenantSlug) });
  } catch (error) {
    handleError(error, res);
  }
});

function requireTenantSlug(req: Request): string {
  const tenantSlug = typeof req.query["tenantSlug"] === "string" ? req.query["tenantSlug"] : undefined;
  if (!tenantSlug) throw new MembershipError("tenantSlug is required.", 400);
  return tenantSlug;
}

async function assertOwner(userId: string, tenantSlug: string): Promise<void> {
  const membership = await getTenantMembershipBySlug(userId, tenantSlug);
  if (!membership || membership.role !== "owner") throw new MembershipError("Owner access is required.", 403);
}
