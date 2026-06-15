import type { Request, Response } from "express";
import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { requireTenantMember } from "../middleware/tenantAccess.js";
import {
  addTenantMember,
  createApiKey,
  createInvitation,
  createTenant,
  createWebhook,
  getTenantBySlug,
  listApiKeys,
  listPendingInvitations,
  listTenantMembers,
  listWebhooks,
  MembershipError,
  removeTenantMember,
  revokeApiKey,
  revokeInvitation,
  revokeWebhook,
  updateTenant,
  updateTenantMemberRole
} from "../services/membershipService.js";
import {
  activateSubscription,
  cancelSubscription,
  getSubscription,
  listBillingPlans,
  getTenantCostReport
} from "../services/billingService.js";
import {
  checkScanLimit,
  getUsageForPeriod,
  getUsageHistory
} from "../services/usageTrackingService.js";
import { listDeliveries } from "../services/webhookDeliveryService.js";

export const tenantsRouter = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof MembershipError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}

// ── POST /tenants ─────────────────────────────────────────────────────────────

tenantsRouter.post("/", authRequired, async (req: Request, res: Response) => {
  try {
    const { slug, publicName } = req.body as { slug?: string; publicName?: string };
    if (!slug || !publicName) {
      res.status(400).json({ error: { message: "slug and publicName are required." } });
      return;
    }
    const { tenant, membership } = await createTenant(slug, publicName, req.auth!.user.userId);
    res.status(201).json({ tenant, membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug ────────────────────────────────────────────────────────

tenantsRouter.get("/:slug", authRequired, requireTenantMember(), async (req: Request, res: Response) => {
  try {
    const tenant = await getTenantBySlug(req.params["slug"]!);
    res.json({ tenant, role: req.tenantCtx!.role });
  } catch (error) {
    handleError(error, res);
  }
});

// ── PATCH /tenants/:slug ──────────────────────────────────────────────────────

tenantsRouter.patch("/:slug", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const allowed = ["publicName", "logoUrl", "primaryColor", "accentColor", "reportTitle", "poweredByLabel", "footerLabel", "customDomain"] as const;
    type UpdateKey = typeof allowed[number];
    const updates: Partial<Record<UpdateKey, string>> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = String(req.body[key]);
    }
    const tenant = await updateTenant(req.tenantCtx!.tenantId, updates);
    res.json({ tenant });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/members ────────────────────────────────────────────────

tenantsRouter.get("/:slug/members", authRequired, requireTenantMember(), async (req: Request, res: Response) => {
  try {
    const members = await listTenantMembers(req.tenantCtx!.tenantId);
    res.json({ items: members });
  } catch (error) {
    handleError(error, res);
  }
});

// ── PATCH /tenants/:slug/members/:userId/role ─────────────────────────────────

tenantsRouter.patch("/:slug/members/:userId/role", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { role } = req.body as { role?: string };
    if (!role || !["owner", "member", "guest"].includes(role)) {
      res.status(400).json({ error: { message: "role must be one of: owner, member, guest." } });
      return;
    }
    const membership = await updateTenantMemberRole(req.tenantCtx!.tenantId, req.params["userId"]!, role as "owner" | "member" | "guest");
    res.json({ membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── DELETE /tenants/:slug/members/:userId ─────────────────────────────────────

tenantsRouter.delete("/:slug/members/:userId", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    await removeTenantMember(req.tenantCtx!.tenantId, req.params["userId"]!, req.auth!.user.userId);
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/members ───────────────────────────────────────────────

tenantsRouter.post("/:slug/members", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || !role || !["owner", "member", "guest"].includes(role)) {
      res.status(400).json({ error: { message: "userId and a valid role are required." } });
      return;
    }
    const membership = await addTenantMember(req.tenantCtx!.tenantId, req.tenantCtx!.tenantSlug, userId, role as "owner" | "member" | "guest", req.auth!.user.userId);
    res.status(201).json({ membership });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/invitations ───────────────────────────────────────────

tenantsRouter.post("/:slug/invitations", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const { email, tenantRole, workspaceId, workspaceRole } = req.body as {
      email?: string;
      tenantRole?: string;
      workspaceId?: string;
      workspaceRole?: string;
    };
    if (!email || !tenantRole || !["owner", "member", "guest"].includes(tenantRole)) {
      res.status(400).json({ error: { message: "email and a valid tenantRole are required." } });
      return;
    }
    const { invitation, rawToken } = await createInvitation(
      req.tenantCtx!.tenantId,
      req.tenantCtx!.tenantSlug,
      email,
      tenantRole as "owner" | "member" | "guest",
      req.auth!.user.userId,
      workspaceId,
      workspaceRole as "owner" | "editor" | "viewer" | undefined
    );
    res.status(201).json({ invitation, token: rawToken });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/invitations ────────────────────────────────────────────

tenantsRouter.get("/:slug/invitations", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const invitations = await listPendingInvitations(req.tenantCtx!.tenantId);
    res.json({ items: invitations });
  } catch (error) {
    handleError(error, res);
  }
});

// ── DELETE /tenants/:slug/invitations/:invitationId ───────────────────────────

tenantsRouter.delete("/:slug/invitations/:invitationId", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    await revokeInvitation(req.params["invitationId"]!, req.tenantCtx!.tenantId);
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/api-keys ───────────────────────────────────────────────

tenantsRouter.get("/:slug/api-keys", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const keys = await listApiKeys(req.tenantCtx!.tenantId);
    res.json({ items: keys.map(k => ({ ...k.toObject(), keyHash: undefined })) });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/api-keys ──────────────────────────────────────────────

tenantsRouter.post("/:slug/api-keys", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { label, scopes } = req.body as { label?: string; scopes?: string[] };
    if (!label) {
      res.status(400).json({ error: { message: "label is required." } });
      return;
    }
    const { apiKey, rawKey } = await createApiKey(req.tenantCtx!.tenantId, label, scopes ?? []);
    res.status(201).json({ apiKey: { ...apiKey.toObject(), keyHash: undefined }, key: rawKey });
  } catch (error) {
    handleError(error, res);
  }
});

// ── DELETE /tenants/:slug/api-keys/:keyId ─────────────────────────────────────

tenantsRouter.delete("/:slug/api-keys/:keyId", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    await revokeApiKey(req.params["keyId"]!, req.tenantCtx!.tenantId);
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/webhooks ───────────────────────────────────────────────

tenantsRouter.get("/:slug/webhooks", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const webhooks = await listWebhooks(req.tenantCtx!.tenantId);
    res.json({ items: webhooks.map(w => ({ ...w.toObject(), secretHash: undefined, signingSecret: undefined })) });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/webhooks ──────────────────────────────────────────────

tenantsRouter.post("/:slug/webhooks", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { url, events, workspaceId } = req.body as { url?: string; events?: string[]; workspaceId?: string };
    if (!url) {
      res.status(400).json({ error: { message: "url is required." } });
      return;
    }
    const { webhook, rawSecret } = await createWebhook(
      req.tenantCtx!.tenantId,
      req.tenantCtx!.tenantSlug,
      url,
      (events ?? []) as import("../models/WebhookRecord.js").WebhookEvent[],
      req.auth!.user.userId,
      workspaceId
    );
    res.status(201).json({ webhook: { ...webhook.toObject(), secretHash: undefined, signingSecret: undefined }, secret: rawSecret });
  } catch (error) {
    handleError(error, res);
  }
});

// ── DELETE /tenants/:slug/webhooks/:webhookId ─────────────────────────────────

tenantsRouter.delete("/:slug/webhooks/:webhookId", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    await revokeWebhook(req.params["webhookId"]!, req.tenantCtx!.tenantId);
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/webhooks/:webhookId/deliveries ─────────────────────────

tenantsRouter.get("/:slug/webhooks/:webhookId/deliveries", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Number(req.query["limit"] ?? 50));
    const offset = Number(req.query["offset"] ?? 0);
    const { deliveries, total } = await listDeliveries(req.params["webhookId"]!, limit, offset);
    res.json({ items: deliveries, total });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/billing/plans ──────────────────────────────────────────

tenantsRouter.get("/:slug/billing/plans", authRequired, requireTenantMember(), async (_req: Request, res: Response) => {
  try {
    const plans = await listBillingPlans();
    res.json({ items: plans });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/billing ────────────────────────────────────────────────

tenantsRouter.get("/:slug/billing", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const [subscription, usage, scanLimit] = await Promise.all([
      getSubscription(req.tenantCtx!.tenantSlug),
      getUsageForPeriod(req.tenantCtx!.tenantSlug),
      checkScanLimit(req.tenantCtx!.tenantSlug)
    ]);
    res.json({ subscription, usage, scanLimit });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/billing/activate ──────────────────────────────────────

tenantsRouter.post("/:slug/billing/activate", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const { planId, interval, trialDays } = req.body as {
      planId?: string;
      interval?: "monthly" | "annual";
      trialDays?: number;
    };
    if (!planId) {
      res.status(400).json({ error: { message: "planId is required." } });
      return;
    }
    const subscription = await activateSubscription(
      req.tenantCtx!.tenantId,
      req.tenantCtx!.tenantSlug,
      planId,
      interval ?? "monthly",
      { trialDays }
    );
    res.json({ subscription });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /tenants/:slug/billing/cancel ────────────────────────────────────────

tenantsRouter.post("/:slug/billing/cancel", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const subscription = await cancelSubscription(req.tenantCtx!.tenantSlug);
    res.json({ subscription });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/billing/usage ──────────────────────────────────────────

tenantsRouter.get("/:slug/billing/usage", authRequired, requireTenantMember(["owner", "member"]), async (req: Request, res: Response) => {
  try {
    const periodKey = req.query["period"] as string | undefined;
    const usage = await getUsageForPeriod(req.tenantCtx!.tenantSlug, periodKey);
    res.json({ usage });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/billing/usage/history ──────────────────────────────────

tenantsRouter.get("/:slug/billing/usage/history", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const months = Math.min(24, Number(req.query["months"] ?? 12));
    const history = await getUsageHistory(req.tenantCtx!.tenantSlug, months);
    res.json({ items: history });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /tenants/:slug/billing/cost-report ────────────────────────────────────

tenantsRouter.get("/:slug/billing/cost-report", authRequired, requireTenantMember(["owner"]), async (req: Request, res: Response) => {
  try {
    const months = Math.min(24, Number(req.query["months"] ?? 6));
    const report = await getTenantCostReport(req.tenantCtx!.tenantSlug, months);
    res.json(report);
  } catch (error) {
    handleError(error, res);
  }
});
