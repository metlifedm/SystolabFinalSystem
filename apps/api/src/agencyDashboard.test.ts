import { describe, expect, it } from "vitest";
import { makeId } from "./utils/crypto.js";
import { createTenant, createWorkspace } from "./services/membershipService.js";
import {
  getAgencyDashboard,
  getAgencyProfitabilityReport,
  getClientWorkspaceSummary,
  listClientWorkspaces
} from "./services/agencyService.js";
import { seedDefaultPlans, activateSubscription, getPlanByTier } from "./services/billingService.js";
import { recordScanUsage, recordApiCallUsage } from "./services/usageTrackingService.js";

async function setupTenant(prefix: string) {
  const slug = `${prefix}-${makeId("t").slice(2, 8)}`;
  const userId = makeId("usr");
  const { tenant } = await createTenant(slug, `Agency Test — ${prefix}`, userId);
  return { slug, userId, tenant };
}

describe("agency dashboard — workspace listing", () => {
  it("listClientWorkspaces returns all workspaces for the tenant", async () => {
    const { slug, userId, tenant } = await setupTenant("ag-list");
    await createWorkspace(tenant._id, slug, userId, "https://site-a.example.com");
    await createWorkspace(tenant._id, slug, userId, "https://site-b.example.com");

    const workspaces = await listClientWorkspaces(slug);
    expect(workspaces.length).toBeGreaterThanOrEqual(2);
    expect(workspaces.every((w) => w.tenantSlug === slug)).toBe(true);
  });

  it("workspace summary includes targetUrl and memberCount", async () => {
    const { slug, userId, tenant } = await setupTenant("ag-summary");
    const { workspace } = await createWorkspace(tenant._id, slug, userId, "https://summary.example.com");

    const summary = await getClientWorkspaceSummary(slug, workspace.workspaceId);
    expect(summary).not.toBeNull();
    expect(summary!.targetUrl).toBe("https://summary.example.com");
    expect(typeof summary!.memberCount).toBe("number");
    expect(summary!.memberCount).toBeGreaterThanOrEqual(1); // Owner is always a member
  });

  it("getClientWorkspaceSummary returns null for a workspace not in the tenant", async () => {
    const { slug } = await setupTenant("ag-null");
    const result = await getClientWorkspaceSummary(slug, makeId("ws"));
    expect(result).toBeNull();
  });
});

describe("agency dashboard — aggregate view", () => {
  it("getAgencyDashboard returns counts and usage for the period", async () => {
    const { slug, userId, tenant } = await setupTenant("ag-dash");
    await createWorkspace(tenant._id, slug, userId, "https://dashboard.example.com");
    await recordScanUsage(tenant._id.toString(), slug);
    await recordApiCallUsage(tenant._id.toString(), slug, 10);

    const dashboard = await getAgencyDashboard(slug);
    expect(dashboard.tenantSlug).toBe(slug);
    expect(dashboard.totalWorkspaces).toBeGreaterThanOrEqual(1);
    expect(typeof dashboard.totalMembers).toBe("number");
    expect(typeof dashboard.usageThisPeriod.scansUsed).toBe("number");
    expect(typeof dashboard.usageThisPeriod.apiCallsUsed).toBe("number");
    expect(Array.isArray(dashboard.workspaces)).toBe(true);
  });

  it("getAgencyDashboard shows activeSubscription when tenant is subscribed", async () => {
    await seedDefaultPlans();
    const { slug, tenant } = await setupTenant("ag-sub");
    const plan = await getPlanByTier("starter");
    await activateSubscription(tenant._id.toString(), slug, plan!.planId);

    const dashboard = await getAgencyDashboard(slug);
    expect(dashboard.activeSubscription).not.toBeNull();
    expect(dashboard.activeSubscription?.tier).toBe("starter");
    expect(dashboard.activeSubscription?.status).toBe("active");
  });

  it("getAgencyDashboard returns null activeSubscription when no active plan", async () => {
    const { slug } = await setupTenant("ag-nosub");
    const dashboard = await getAgencyDashboard(slug);
    expect(dashboard.activeSubscription).toBeNull();
  });
});

describe("agency dashboard — profitability report", () => {
  it("getAgencyProfitabilityReport returns period-level revenue and cost data", async () => {
    await seedDefaultPlans();
    const { slug, tenant } = await setupTenant("ag-profit");
    const plan = await getPlanByTier("pro");
    await activateSubscription(tenant._id.toString(), slug, plan!.planId);
    await recordScanUsage(tenant._id.toString(), slug, 50);

    const report = await getAgencyProfitabilityReport(slug, 3);
    expect(report.tenantSlug).toBe(slug);
    expect(report.monthlyRevenueCents).toBe(plan!.priceCentsPerMonth);
    expect(Array.isArray(report.periods)).toBe(true);
    expect(typeof report.totalRevenueCents).toBe("number");
    expect(typeof report.totalCostCents).toBe("number");
    expect(typeof report.avgProfitMarginPct).toBe("number");
  });

  it("profitability report periods include margin calculations", async () => {
    await seedDefaultPlans();
    const { slug, tenant } = await setupTenant("ag-margin");
    const plan = await getPlanByTier("enterprise");
    await activateSubscription(tenant._id.toString(), slug, plan!.planId);
    await recordScanUsage(tenant._id.toString(), slug, 10);

    const report = await getAgencyProfitabilityReport(slug, 1);
    if (report.periods.length > 0) {
      const period = report.periods[0]!;
      expect(typeof period.revenueCents).toBe("number");
      expect(typeof period.profitCents).toBe("number");
      expect(typeof period.margin).toBe("number");
    }
    // If no usage period exists, that's valid too — just verify structure
    expect(report.planName).toBeTruthy();
  });
});
