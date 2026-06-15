import { BillingPlan, type BillingPlanDocument, type PlanLimits, type PlanTier } from "../models/BillingPlan.js";
import { TenantSubscription, type TenantSubscriptionDocument } from "../models/TenantSubscription.js";
import { UsageRecord } from "../models/UsageRecord.js";
import { makeId } from "../utils/crypto.js";
import { isMongoConnected } from "../db/mongoose.js";

// ── In-memory stores (used when Mongoose is not connected) ────────────────────
const memoryPlans = new Map<string, BillingPlanDocument>();
const memorySubscriptions = new Map<string, TenantSubscriptionDocument>();

const DEFAULT_PLANS: Array<{
  tier: PlanTier;
  name: string;
  description: string;
  priceCentsPerMonth: number;
  priceCentsPerYear: number;
  limits: PlanLimits;
  features: string[];
}> = [
  {
    tier: "free",
    name: "Free",
    description: "For individuals exploring Systolab.",
    priceCentsPerMonth: 0,
    priceCentsPerYear: 0,
    limits: {
      scansPerMonth: 10,
      apiCallsPerMonth: 500,
      workspaces: 1,
      seats: 1,
      storageMb: 100,
      webhooks: 0,
      apiKeys: 0,
      customDomain: false,
      whiteLabel: false,
      prioritySupport: false,
      dataRetentionDays: 30
    },
    features: ["10 scans/month", "1 workspace", "Basic reports"]
  },
  {
    tier: "starter",
    name: "Starter",
    description: "For small teams getting started.",
    priceCentsPerMonth: 4900,
    priceCentsPerYear: 47040,
    limits: {
      scansPerMonth: 100,
      apiCallsPerMonth: 5000,
      workspaces: 3,
      seats: 5,
      storageMb: 1024,
      webhooks: 2,
      apiKeys: 2,
      customDomain: false,
      whiteLabel: false,
      prioritySupport: false,
      dataRetentionDays: 60
    },
    features: ["100 scans/month", "3 workspaces", "5 seats", "Webhooks", "PDF reports"]
  },
  {
    tier: "pro",
    name: "Pro",
    description: "For growing teams that need more power.",
    priceCentsPerMonth: 14900,
    priceCentsPerYear: 143040,
    limits: {
      scansPerMonth: 500,
      apiCallsPerMonth: 50000,
      workspaces: 10,
      seats: 20,
      storageMb: 10240,
      webhooks: 10,
      apiKeys: 10,
      customDomain: true,
      whiteLabel: false,
      prioritySupport: false,
      dataRetentionDays: 90
    },
    features: ["500 scans/month", "10 workspaces", "20 seats", "Custom domain", "API access"]
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    description: "Unlimited everything for agencies and enterprises.",
    priceCentsPerMonth: 49900,
    priceCentsPerYear: 478800,
    limits: {
      scansPerMonth: -1,
      apiCallsPerMonth: -1,
      workspaces: -1,
      seats: -1,
      storageMb: -1,
      webhooks: -1,
      apiKeys: -1,
      customDomain: true,
      whiteLabel: true,
      prioritySupport: true,
      dataRetentionDays: 365
    },
    features: ["Unlimited scans", "White-label", "Priority support", "SLA", "Custom contracts"]
  }
];

function makePlanDoc(data: (typeof DEFAULT_PLANS)[number] & { planId: string }): BillingPlanDocument {
  return { ...data, isActive: true, createdAt: new Date(), updatedAt: new Date() } as unknown as BillingPlanDocument;
}

function makeSubDoc(data: Record<string, unknown>): TenantSubscriptionDocument {
  return { ...data, createdAt: new Date(), updatedAt: new Date(), save: async function () { memorySubscriptions.set(data.tenantSlug as string, this as TenantSubscriptionDocument); } } as unknown as TenantSubscriptionDocument;
}

export async function seedDefaultPlans(): Promise<void> {
  if (!isMongoConnected()) {
    for (const plan of DEFAULT_PLANS) {
      if ([...memoryPlans.values()].some((p) => p.tier === plan.tier)) continue;
      const planId = makeId("plan");
      memoryPlans.set(planId, makePlanDoc({ planId, ...plan }));
    }
    return;
  }
  for (const plan of DEFAULT_PLANS) {
    const existing = await BillingPlan.findOne({ tier: plan.tier });
    if (existing) continue;
    await BillingPlan.create({ planId: makeId("plan"), ...plan });
  }
}

export async function listBillingPlans(): Promise<BillingPlanDocument[]> {
  if (!isMongoConnected()) {
    return [...memoryPlans.values()].filter((p) => p.isActive).sort((a, b) => a.priceCentsPerMonth - b.priceCentsPerMonth);
  }
  return BillingPlan.find({ isActive: true }).sort({ priceCentsPerMonth: 1 });
}

export async function getPlan(planId: string): Promise<BillingPlanDocument | null> {
  if (!isMongoConnected()) return memoryPlans.get(planId) ?? null;
  return BillingPlan.findOne({ planId, isActive: true });
}

export async function getPlanByTier(tier: PlanTier): Promise<BillingPlanDocument | null> {
  if (!isMongoConnected()) return [...memoryPlans.values()].find((p) => p.tier === tier && p.isActive) ?? null;
  return BillingPlan.findOne({ tier, isActive: true });
}

export async function getSubscription(tenantSlug: string): Promise<TenantSubscriptionDocument | null> {
  if (!isMongoConnected()) return memorySubscriptions.get(tenantSlug) ?? null;
  return TenantSubscription.findOne({ tenantSlug });
}

export async function activateSubscription(
  tenantId: string,
  tenantSlug: string,
  planId: string,
  interval: "monthly" | "annual" = "monthly",
  options: { trialDays?: number; externalSubscriptionId?: string; externalCustomerId?: string } = {}
): Promise<TenantSubscriptionDocument> {
  const now = new Date();
  const periodEnd = new Date(now);
  if (interval === "annual") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }
  const trialEndsAt = options.trialDays ? new Date(now.getTime() + options.trialDays * 86_400_000) : undefined;
  const status = trialEndsAt ? "trialing" : "active";

  if (!isMongoConnected()) {
    const plan = [...memoryPlans.values()].find((p) => p.planId === planId);
    if (!plan) throw new Error(`Billing plan ${planId} not found.`);
    const existing = memorySubscriptions.get(tenantSlug);
    if (existing) {
      const updated = { ...existing, planId, status, interval, currentPeriodStart: now, currentPeriodEnd: periodEnd, trialEndsAt, canceledAt: undefined } as unknown as TenantSubscriptionDocument;
      (updated as unknown as Record<string, unknown>)["save"] = async function (this: unknown) { memorySubscriptions.set(tenantSlug, this as unknown as TenantSubscriptionDocument); };
      memorySubscriptions.set(tenantSlug, updated);
      return updated;
    }
    const sub = makeSubDoc({ subscriptionId: makeId("sub"), tenantId, tenantSlug, planId, status, interval, currentPeriodStart: now, currentPeriodEnd: periodEnd, trialEndsAt });
    memorySubscriptions.set(tenantSlug, sub);
    return sub;
  }

  const plan = await BillingPlan.findOne({ planId });
  if (!plan) throw new Error(`Billing plan ${planId} not found.`);

  const existing = await TenantSubscription.findOne({ tenantSlug });
  if (existing) {
    existing.planId = planId;
    existing.status = status;
    existing.interval = interval;
    existing.currentPeriodStart = now;
    existing.currentPeriodEnd = periodEnd;
    existing.trialEndsAt = trialEndsAt;
    existing.canceledAt = undefined;
    if (options.externalSubscriptionId) existing.externalSubscriptionId = options.externalSubscriptionId;
    if (options.externalCustomerId) existing.externalCustomerId = options.externalCustomerId;
    await existing.save();
    return existing;
  }

  return TenantSubscription.create({
    subscriptionId: makeId("sub"),
    tenantId,
    tenantSlug,
    planId,
    status,
    interval,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    trialEndsAt,
    externalSubscriptionId: options.externalSubscriptionId,
    externalCustomerId: options.externalCustomerId
  });
}

export async function cancelSubscription(tenantSlug: string): Promise<TenantSubscriptionDocument> {
  if (!isMongoConnected()) {
    const sub = memorySubscriptions.get(tenantSlug);
    if (!sub) throw new Error(`No subscription found for tenant ${tenantSlug}.`);
    const updated = { ...sub, status: "canceled", canceledAt: new Date() } as unknown as TenantSubscriptionDocument;
    (updated as unknown as Record<string, unknown>)["save"] = async function (this: unknown) { memorySubscriptions.set(tenantSlug, this as unknown as TenantSubscriptionDocument); };
    memorySubscriptions.set(tenantSlug, updated);
    return updated;
  }
  const sub = await TenantSubscription.findOne({ tenantSlug });
  if (!sub) throw new Error(`No subscription found for tenant ${tenantSlug}.`);
  sub.status = "canceled";
  sub.canceledAt = new Date();
  await sub.save();
  return sub;
}

export async function getTenantPlanLimits(tenantSlug: string): Promise<PlanLimits> {
  if (!isMongoConnected()) {
    const sub = memorySubscriptions.get(tenantSlug);
    const activeStatuses = ["active", "trialing"];
    if (!sub || !activeStatuses.includes(sub.status as string)) return DEFAULT_PLANS[0]!.limits;
    const plan = [...memoryPlans.values()].find((p) => p.planId === sub.planId);
    return plan?.limits ?? DEFAULT_PLANS[0]!.limits;
  }
  const sub = await TenantSubscription.findOne({ tenantSlug, status: { $in: ["active", "trialing"] } });
  if (!sub) {
    const freePlan = await BillingPlan.findOne({ tier: "free" });
    return freePlan?.limits ?? DEFAULT_PLANS[0]!.limits;
  }
  const plan = await BillingPlan.findOne({ planId: sub.planId });
  if (!plan) {
    const freePlan = await BillingPlan.findOne({ tier: "free" });
    return freePlan?.limits ?? DEFAULT_PLANS[0]!.limits;
  }
  return plan.limits;
}

export async function getTenantCostReport(
  tenantSlug: string,
  months = 6
): Promise<{
  tenantSlug: string;
  periods: Array<{ periodKey: string; scansUsed: number; apiCallsUsed: number; costCents: number }>;
  totalCostCents: number;
  avgMonthlyCostCents: number;
}> {
  if (!isMongoConnected()) {
    return { tenantSlug, periods: [], totalCostCents: 0, avgMonthlyCostCents: 0 };
  }
  const records = await UsageRecord.find({ tenantSlug })
    .sort({ periodKey: -1 })
    .limit(months);

  const periods = records.map((r) => ({
    periodKey: r.periodKey,
    scansUsed: r.scansUsed,
    apiCallsUsed: r.apiCallsUsed,
    costCents: r.costCents
  }));

  const totalCostCents = periods.reduce((sum, p) => sum + p.costCents, 0);
  const avgMonthlyCostCents = periods.length ? Math.round(totalCostCents / periods.length) : 0;

  return { tenantSlug, periods, totalCostCents, avgMonthlyCostCents };
}
