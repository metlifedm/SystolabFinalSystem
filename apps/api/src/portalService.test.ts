import { describe, expect, it } from "vitest";
import { createTenant, updateTenant } from "./services/membershipService.js";
import { recordScanUsage } from "./services/usageTrackingService.js";
import {
  createProjectForTenant,
  ensureCustomerOrganization,
  getPortalMe,
  getUsageOverview,
  listProjectsForUser,
  resolveWhiteLabelBranding,
  runProjectScan,
  startFirstAnalysis,
  updateWhiteLabelBranding
} from "./services/portalService.js";
import { makeId } from "./utils/crypto.js";

function uniqueSlug(prefix: string) {
  return `${prefix}-${makeId("t").slice(2, 10)}`;
}

describe("portal service", () => {
  it("delivers value first by provisioning hidden account resources and queuing the first report from one URL", async () => {
    const userId = makeId("usr");
    const user = {
      userId,
      email: "value-first@example.com",
      displayName: "Amina Rahman",
      providers: ["password"] as const,
      emailVerified: true,
      phoneVerified: false,
      googleVerified: false,
      lifecycleState: "VERIFIED" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const started = await startFirstAnalysis(user, { targetUrl: "value-first.example.com" });

    expect(started.organization.created).toBe(true);
    expect(started.organization.publicName).toBe("Amina Rahman's Agency");
    expect(started.website.targetUrl).toBe("https://value-first.example.com/");
    expect(started.job.jobId).toMatch(/^job_/);
    expect(started.job.status).toBe("queued");

    const portal = await getPortalMe(user);
    expect(portal.tenants).toHaveLength(1);
    expect(portal.projects).toHaveLength(1);
    expect(portal.projects[0]?.workspaceId).toBe(started.website.workspaceId);

    const existing = await ensureCustomerOrganization(user, "A Different Name");
    expect(existing.created).toBe(false);
    expect(existing.membership.tenantSlug).toBe(started.organization.tenantSlug);
  });
  it("creates tenant-scoped projects and lists them only for the owning user", async () => {
    const ownerId = makeId("usr");
    const outsiderId = makeId("usr");
    const slug = uniqueSlug("portal-project");
    await createTenant(slug, "Portal Project Tenant", ownerId);

    const project = await createProjectForTenant(ownerId, {
      tenantSlug: slug,
      targetUrl: "https://portal-project.example.com",
      projectName: "Portal Project",
      businessType: "Law Firm",
      targetCountry: "US",
      targetLocation: "Austin",
      competitorUrls: ["https://competitor-one.example.com", "https://competitor-two.example.com"],
      gbpUrl: "https://maps.google.com/?cid=12345",
      monitoringConfig: { cadence: "weekly", enabled: true }
    });

    const ownerProjects = await listProjectsForUser(ownerId, slug);
    const outsiderProjects = await listProjectsForUser(outsiderId, slug);

    expect(project.projectName).toBe("Portal Project");
    expect(project.competitorUrls).toHaveLength(2);
    expect(project.monitoringConfig.enabled).toBe(true);
    expect(ownerProjects.some((item) => item.workspaceId === project.workspaceId)).toBe(true);
    expect(outsiderProjects).toHaveLength(0);
  });

  it("builds portal me with tenant permissions and project summaries", async () => {
    const ownerId = makeId("usr");
    const slug = uniqueSlug("portal-me");
    await createTenant(slug, "Portal Me Tenant", ownerId);
    await createProjectForTenant(ownerId, { tenantSlug: slug, targetUrl: "https://portal-me.example.com" });

    const bundle = await getPortalMe({
      userId: ownerId,
      email: "owner@example.com",
      providers: ["password"],
      emailVerified: true,
      phoneVerified: false,
      googleVerified: false,
      lifecycleState: "VERIFIED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    expect(bundle.tenants[0]?.role).toBe("owner");
    expect(bundle.tenants[0]?.permissions).toContain("white_label:manage");
    expect(bundle.projects[0]?.targetUrl).toBe("https://portal-me.example.com");
  });

  it("returns usage overview and enforces free scan limits for project scans", async () => {
    const ownerId = makeId("usr");
    const slug = uniqueSlug("portal-usage");
    const { tenant } = await createTenant(slug, "Portal Usage Tenant", ownerId);
    const project = await createProjectForTenant(ownerId, { tenantSlug: slug, targetUrl: "https://portal-usage.example.com" });

    const queued = await runProjectScan(project.workspaceId, tenant._id.toString(), ownerId, { mode: "fast_scan", includeSeo: true });
    expect(queued.jobId).toMatch(/^job_/);
    expect(queued.usage.used).toBe(1);

    for (let i = 0; i < 9; i++) await recordScanUsage(tenant._id.toString(), slug);
    const overview = await getUsageOverview(slug);
    expect(overview.scanLimit.used).toBeGreaterThanOrEqual(10);
    expect(overview.scanLimit.allowed).toBe(false);
    await expect(runProjectScan(project.workspaceId, tenant._id.toString(), ownerId)).rejects.toThrow(/Monthly scan limit/);
  });

  it("allows agency sales content but rejects locked intelligence fields", async () => {
    const ownerId = makeId("usr");
    const slug = uniqueSlug("portal-lock");
    const { tenant } = await createTenant(slug, "Portal Lock Tenant", ownerId);

    const updated = await updateWhiteLabelBranding(tenant._id.toString(), {
      publicName: "Evidence-Safe Agency",
      aboutCompany: "We implement SYSTOLAB findings without changing the diagnosis.",
      agencyImplementationNotes: [{ recommendationId: "REC-001", note: "Our team can implement this after client approval." }]
    });

    expect(updated.publicName).toBe("Evidence-Safe Agency");
    expect(updated.agencyImplementationNotes?.[0]?.note).toContain("client approval");
    await expect(updateWhiteLabelBranding(tenant._id.toString(), { poweredByLabel: "Agency Engine" } as never)).rejects.toThrow(/Locked SYSTOLAB intelligence fields/);
    await expect(updateWhiteLabelBranding(tenant._id.toString(), { recommendationEngine: { status: "fake" } } as never)).rejects.toThrow(/Locked SYSTOLAB intelligence fields/);
  });
  it("resolves public white-label branding by slug and custom domain", async () => {
    const ownerId = makeId("usr");
    const slug = uniqueSlug("portal-brand");
    const { tenant } = await createTenant(slug, "Portal Brand Tenant", ownerId);
    await updateTenant(tenant._id.toString(), {
      publicName: "Partner Intelligence Co",
      customDomain: "reports.partner.test",
      primaryColor: "#123456",
      accentColor: "#b7791f",
      supportEmail: "support@partner.test"
    });

    const bySlug = await resolveWhiteLabelBranding({ slug });
    const byDomain = await resolveWhiteLabelBranding({ domain: "reports.partner.test" });

    expect(bySlug.found).toBe(true);
    expect(bySlug.branding.publicName).toBe("Partner Intelligence Co");
    expect(byDomain.found).toBe(true);
    expect(byDomain.branding.supportEmail).toBe("support@partner.test");
  });
});
