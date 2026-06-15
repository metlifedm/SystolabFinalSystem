import { describe, expect, it } from "vitest";
import { makeId } from "./utils/crypto.js";
import {
  activateSubscription,
  cancelSubscription,
  getPlan,
  getPlanByTier,
  getSubscription,
  getTenantCostReport,
  getTenantPlanLimits,
  listBillingPlans,
  seedDefaultPlans
} from "./services/billingService.js";
import {
  checkApiCallLimit,
  checkScanLimit,
  getCurrentPeriodKey,
  getUsageForPeriod,
  getUsageHistory,
  recordApiCallUsage,
  recordScanUsage
} from "./services/usageTrackingService.js";

describe("billing — plan seeding and retrieval", () => {
  it("seedDefaultPlans creates four tiers exactly once", async () => {
    await seedDefaultPlans();
    await seedDefaultPlans(); // Idempotent
    const plans = await listBillingPlans();
    const tiers = new Set(plans.map((p) => p.tier));
    expect(tiers.has("free")).toBe(true);
    expect(tiers.has("starter")).toBe(true);
    expect(tiers.has("pro")).toBe(true);
    expect(tiers.has("enterprise")).toBe(true);
  });

  it("getPlanByTier returns the correct plan", async () => {
    await seedDefaultPlans();
    const free = await getPlanByTier("free");
    expect(free?.priceCentsPerMonth).toBe(0);
    expect(free?.limits.scansPerMonth).toBe(10);

    const enterprise = await getPlanByTier("enterprise");
    expect(enterprise?.limits.scansPerMonth).toBe(-1); // Unlimited
    expect(enterprise?.limits.whiteLabel).toBe(true);
  });

  it("listBillingPlans returns plans sorted by ascending price", async () => {
    await seedDefaultPlans();
    const plans = await listBillingPlans();
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.priceCentsPerMonth).toBeGreaterThanOrEqual(plans[i - 1]!.priceCentsPerMonth);
    }
  });
});

describe("billing — subscription lifecycle", () => {
  it("activateSubscription creates an active subscription for a new tenant", async () => {
    const tenantSlug = `billing-test-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const plan = await getPlanByTier("starter");
    const sub = await activateSubscription("tid-001", tenantSlug, plan!.planId);
    expect(sub.status).toBe("active");
    expect(sub.tenantSlug).toBe(tenantSlug);
    expect(sub.planId).toBe(plan!.planId);
  });

  it("activateSubscription with trialDays starts in trialing status", async () => {
    const tenantSlug = `billing-trial-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const plan = await getPlanByTier("pro");
    const sub = await activateSubscription("tid-002", tenantSlug, plan!.planId, "monthly", { trialDays: 14 });
    expect(sub.status).toBe("trialing");
    expect(sub.trialEndsAt).toBeDefined();
    expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("activateSubscription is idempotent — re-activating updates the existing record", async () => {
    const tenantSlug = `billing-idempotent-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const planA = await getPlanByTier("starter");
    const planB = await getPlanByTier("pro");
    await activateSubscription("tid-003", tenantSlug, planA!.planId);
    const updated = await activateSubscription("tid-003", tenantSlug, planB!.planId);
    expect(updated.planId).toBe(planB!.planId);
    // Only one subscription record should exist
    const found = await getSubscription(tenantSlug);
    expect(found?.planId).toBe(planB!.planId);
  });

  it("cancelSubscription marks the subscription as canceled", async () => {
    const tenantSlug = `billing-cancel-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const plan = await getPlanByTier("starter");
    await activateSubscription("tid-004", tenantSlug, plan!.planId);
    const canceled = await cancelSubscription(tenantSlug);
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceledAt).toBeDefined();
  });

  it("getTenantPlanLimits falls back to free plan when no active subscription exists", async () => {
    await seedDefaultPlans();
    const limits = await getTenantPlanLimits("no-sub-tenant-xyz");
    expect(limits.scansPerMonth).toBe(10); // Free plan
  });

  it("getTenantPlanLimits returns enterprise limits for enterprise subscribers", async () => {
    const tenantSlug = `ent-limits-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const plan = await getPlanByTier("enterprise");
    await activateSubscription("tid-ent", tenantSlug, plan!.planId);
    const limits = await getTenantPlanLimits(tenantSlug);
    expect(limits.scansPerMonth).toBe(-1);
    expect(limits.apiCallsPerMonth).toBe(-1);
    expect(limits.whiteLabel).toBe(true);
  });
});

describe("usage tracking", () => {
  it("getCurrentPeriodKey returns YYYY-MM format", () => {
    const key = getCurrentPeriodKey();
    expect(key).toMatch(/^\d{4}-\d{2}$/);
  });

  it("recordScanUsage increments scansUsed for the current period", async () => {
    const tenantSlug = `usage-scan-${makeId("t").slice(2, 8)}`;
    await recordScanUsage("tid-u1", tenantSlug);
    await recordScanUsage("tid-u1", tenantSlug);
    const usage = await getUsageForPeriod(tenantSlug);
    expect(usage?.scansUsed).toBeGreaterThanOrEqual(2);
  });

  it("recordApiCallUsage increments apiCallsUsed", async () => {
    const tenantSlug = `usage-api-${makeId("t").slice(2, 8)}`;
    await recordApiCallUsage("tid-u2", tenantSlug, 5);
    const usage = await getUsageForPeriod(tenantSlug);
    expect(usage?.apiCallsUsed).toBeGreaterThanOrEqual(5);
  });

  it("getUsageHistory returns records sorted newest first", async () => {
    const tenantSlug = `usage-history-${makeId("t").slice(2, 8)}`;
    await recordScanUsage("tid-u3", tenantSlug);
    const history = await getUsageHistory(tenantSlug, 12);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it("checkScanLimit returns allowed=true for unlimited enterprise plan", async () => {
    const tenantSlug = `scan-limit-ent-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    const plan = await getPlanByTier("enterprise");
    await activateSubscription("tid-sl", tenantSlug, plan!.planId);
    const result = await checkScanLimit(tenantSlug);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
  });

  it("checkScanLimit returns allowed=false when free plan limit is exhausted", async () => {
    const tenantSlug = `scan-limit-free-${makeId("t").slice(2, 8)}`;
    await seedDefaultPlans();
    // Free plan: 10 scans/month — record 11
    for (let i = 0; i < 11; i++) {
      await recordScanUsage("tid-sf", tenantSlug);
    }
    const result = await checkScanLimit(tenantSlug);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(10);
    expect(result.used).toBeGreaterThanOrEqual(11);
  });

  it("getTenantCostReport returns an array of period records", async () => {
    const tenantSlug = `cost-report-${makeId("t").slice(2, 8)}`;
    await recordScanUsage("tid-cr", tenantSlug, 100);
    const report = await getTenantCostReport(tenantSlug, 6);
    expect(report.tenantSlug).toBe(tenantSlug);
    expect(Array.isArray(report.periods)).toBe(true);
    expect(report.totalCostCents).toBeGreaterThanOrEqual(0);
  });
});
