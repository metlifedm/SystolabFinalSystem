import type { ReportSnapshot, TenantBranding } from "@systolab/shared";
import { Workspace } from "../models/Workspace.js";
import { Snapshot } from "../models/Snapshot.js";
import { TenantMembership } from "../models/TenantMembership.js";
import { Tenant, tenantToBranding } from "../models/Tenant.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { getTenantCostReport, getSubscription, getPlanByTier, getPlan } from "./billingService.js";
import { getCurrentPeriodKey, getUsageForPeriod } from "./usageTrackingService.js";
import { isMongoConnected } from "../db/mongoose.js";
import { _memWorkspaces, _memTenantMems, _memWorkspaceMems, _memTenants } from "./membershipService.js";

export interface AgencyWorkspaceSummary {
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  industry?: string;
  lastScanAt?: Date;
  lastScore?: number;
  lastScoreLabel?: string;
  memberCount: number;
  scansThisPeriod: number;
}

export interface AgencyDashboard {
  tenantSlug: string;
  totalWorkspaces: number;
  totalMembers: number;
  activeSubscription: {
    tier: string;
    status: string;
    planName: string;
  } | null;
  usageThisPeriod: {
    scansUsed: number;
    apiCallsUsed: number;
    webhookDeliveriesCount: number;
  };
  analytics: {
    reportsGenerated: number;
    leadsCreated: number;
    reportToClientConversionRate: number;
    mostCommonClientIssues: string[];
    highestRoiRecommendations: string[];
    industryTrends: Array<{ industry: string; reports: number; averageOss: number | null; trend: "baseline" | "improving" | "declining" | "stable" }>;
  };
  successCenter: {
    whyThisLeadIsLikelyToBuy: string[];
    servicesToPitchFirst: string[];
    estimatedDealSize: string;
    suggestedPricingTier: string;
    likelySalesObjections: string[];
    personalizedSalesScript: string;
    crossSellUpsellOpportunities: string[];
  };
  crm: {
    enabled: boolean;
    provider: NonNullable<TenantBranding["crmIntegration"]>["provider"];
    deliveryMode: "internal_outbox" | "manual_export";
    queuedLeadCount: number;
    note: string;
  };
  workspaces: AgencyWorkspaceSummary[];
}

export async function listClientWorkspaces(tenantSlug: string): Promise<AgencyWorkspaceSummary[]> {
  if (!isMongoConnected()) {
    const workspaces = [..._memWorkspaces.values()].filter(
      (ws) => (ws as unknown as Record<string, unknown>)["tenantSlug"] === tenantSlug
    );
    const periodKey = getCurrentPeriodKey();
    const usageRecord = await getUsageForPeriod(tenantSlug, periodKey);

    return workspaces.map((ws) => {
      const wsAny = ws as unknown as Record<string, unknown>;
      const memberCount = [..._memWorkspaceMems.values()].filter(
        (m) => (m as unknown as Record<string, unknown>)["workspaceId"] === wsAny["workspaceId"] &&
               (m as unknown as Record<string, unknown>)["isActive"]
      ).length;
      return {
        workspaceId: wsAny["workspaceId"] as string,
        tenantSlug: wsAny["tenantSlug"] as string,
        targetUrl: wsAny["targetUrl"] as string,
        industry: wsAny["industry"] as string | undefined,
        lastScanAt: undefined,
        lastScore: undefined,
        lastScoreLabel: undefined,
        memberCount,
        scansThisPeriod: usageRecord?.scansUsed ?? 0
      } satisfies AgencyWorkspaceSummary;
    });
  }

  const workspaces = await Workspace.find({ tenantSlug });
  const periodKey = getCurrentPeriodKey();

  const summaries = await Promise.all(
    workspaces.map(async (ws) => {
      const [lastSnapshot, memberCount, usageRecord] = await Promise.all([
        Snapshot.findOne({ tenantSlug, targetUrl: ws.targetUrl }).sort({ createdAt: -1 }).select("report.oss createdAt"),
        WorkspaceMembership.countDocuments({ workspaceId: ws.workspaceId, isActive: true }),
        getUsageForPeriod(tenantSlug, periodKey)
      ]);

      return {
        workspaceId: ws.workspaceId,
        tenantSlug: ws.tenantSlug,
        targetUrl: ws.targetUrl,
        industry: ws.industry,
        lastScanAt: lastSnapshot?.createdAt,
        lastScore: lastSnapshot?.report?.oss?.score ?? undefined,
        lastScoreLabel: lastSnapshot?.report?.oss?.classification,
        memberCount,
        scansThisPeriod: usageRecord?.scansUsed ?? 0
      } satisfies AgencyWorkspaceSummary;
    })
  );

  return summaries;
}

export async function getClientWorkspaceSummary(
  tenantSlug: string,
  workspaceId: string
): Promise<AgencyWorkspaceSummary | null> {
  if (!isMongoConnected()) {
    const ws = _memWorkspaces.get(workspaceId);
    if (!ws) return null;
    const wsAny = ws as unknown as Record<string, unknown>;
    if (wsAny["tenantSlug"] !== tenantSlug) return null;
    const memberCount = [..._memWorkspaceMems.values()].filter(
      (m) => (m as unknown as Record<string, unknown>)["workspaceId"] === workspaceId &&
             (m as unknown as Record<string, unknown>)["isActive"]
    ).length;
    const usageRecord = await getUsageForPeriod(tenantSlug);
    return {
      workspaceId: wsAny["workspaceId"] as string,
      tenantSlug: wsAny["tenantSlug"] as string,
      targetUrl: wsAny["targetUrl"] as string,
      industry: wsAny["industry"] as string | undefined,
      lastScanAt: undefined,
      lastScore: undefined,
      lastScoreLabel: undefined,
      memberCount,
      scansThisPeriod: usageRecord?.scansUsed ?? 0
    };
  }

  const ws = await Workspace.findOne({ workspaceId, tenantSlug });
  if (!ws) return null;

  const periodKey = getCurrentPeriodKey();
  const [lastSnapshot, memberCount, usageRecord] = await Promise.all([
    Snapshot.findOne({ tenantSlug, targetUrl: ws.targetUrl }).sort({ createdAt: -1 }).select("report.oss createdAt"),
    WorkspaceMembership.countDocuments({ workspaceId, isActive: true }),
    getUsageForPeriod(tenantSlug, periodKey)
  ]);

  return {
    workspaceId: ws.workspaceId,
    tenantSlug: ws.tenantSlug,
    targetUrl: ws.targetUrl,
    industry: ws.industry,
    lastScanAt: lastSnapshot?.createdAt,
    lastScore: lastSnapshot?.report?.oss?.score ?? undefined,
    lastScoreLabel: lastSnapshot?.report?.oss?.classification,
    memberCount,
    scansThisPeriod: usageRecord?.scansUsed ?? 0
  };
}

export async function getAgencyDashboard(tenantSlug: string): Promise<AgencyDashboard> {
  if (!isMongoConnected()) {
    const totalWorkspaces = [..._memWorkspaces.values()].filter(
      (ws) => (ws as unknown as Record<string, unknown>)["tenantSlug"] === tenantSlug
    ).length;
    const totalMembers = [..._memTenantMems.values()].filter(
      (m) => (m as unknown as Record<string, unknown>)["tenantSlug"] === tenantSlug &&
             (m as unknown as Record<string, unknown>)["isActive"]
    ).length;

    const sub = await getSubscription(tenantSlug);
    let activeSubscription: AgencyDashboard["activeSubscription"] = null;
    if (sub && ["active", "trialing"].includes(sub.status as string)) {
      const plan = await getPlan((sub as unknown as Record<string, unknown>)["planId"] as string);
      activeSubscription = {
        tier: (plan as unknown as Record<string, unknown>)?.["tier"] as string ?? "unknown",
        status: sub.status as string,
        planName: (plan as unknown as Record<string, unknown>)?.["name"] as string ?? (sub as unknown as Record<string, unknown>)["planId"] as string
      };
    }

    const usageRecord = await getUsageForPeriod(tenantSlug);
    const workspaces = await listClientWorkspaces(tenantSlug);

    const branding = await getTenantBranding(tenantSlug);
    const intelligence = buildAgencyDashboardIntelligence(workspaces, [], branding);

    return {
      tenantSlug,
      totalWorkspaces,
      totalMembers,
      activeSubscription,
      usageThisPeriod: {
        scansUsed: usageRecord?.scansUsed ?? 0,
        apiCallsUsed: usageRecord?.apiCallsUsed ?? 0,
        webhookDeliveriesCount: usageRecord?.webhookDeliveriesCount ?? 0
      },
      ...intelligence,
      workspaces
    };
  }

  const periodKey = getCurrentPeriodKey();

  const [totalWorkspaces, totalMembers, sub, usageRecord, workspaces, snapshots, branding] = await Promise.all([
    Workspace.countDocuments({ tenantSlug }),
    TenantMembership.countDocuments({ tenantSlug, isActive: true }),
    getSubscription(tenantSlug),
    getUsageForPeriod(tenantSlug, periodKey),
    listClientWorkspaces(tenantSlug),
    Snapshot.find({ tenantSlug }).sort({ createdAt: -1 }).limit(250).lean(),
    getTenantBranding(tenantSlug)
  ]);

  let activeSubscription: AgencyDashboard["activeSubscription"] = null;
  if (sub && ["active", "trialing"].includes(sub.status as string)) {
    const plan = await getPlan((sub as unknown as Record<string, unknown>)["planId"] as string);
    activeSubscription = {
      tier: (plan as unknown as Record<string, unknown>)?.["tier"] as string ?? "unknown",
      status: sub.status as string,
      planName: (plan as unknown as Record<string, unknown>)?.["name"] as string ?? (sub as unknown as Record<string, unknown>)["planId"] as string
    };
  }

  const intelligence = buildAgencyDashboardIntelligence(workspaces, snapshots.map((item) => item.report as ReportSnapshot), branding);

  return {
    tenantSlug,
    totalWorkspaces,
    totalMembers,
    activeSubscription,
    usageThisPeriod: {
      scansUsed: usageRecord?.scansUsed ?? 0,
      apiCallsUsed: usageRecord?.apiCallsUsed ?? 0,
      webhookDeliveriesCount: usageRecord?.webhookDeliveriesCount ?? 0
    },
    ...intelligence,
    workspaces
  };
}

async function getTenantBranding(tenantSlug: string): Promise<TenantBranding | undefined> {
  if (!isMongoConnected()) {
    const tenant = _memTenants.get(tenantSlug);
    return tenant ? tenantToBranding(tenant) : undefined;
  }
  const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
  return tenant ? tenantToBranding(tenant) : undefined;
}

function buildAgencyDashboardIntelligence(
  workspaces: AgencyWorkspaceSummary[],
  reports: ReportSnapshot[],
  branding?: TenantBranding
): Pick<AgencyDashboard, "analytics" | "successCenter" | "crm"> {
  const scoredReports = reports.filter((report) => typeof report.oss?.score === "number");
  const reportsGenerated = reports.length;
  const leadsCreated = workspaces.length;
  const projectsWithReport = new Set(reports.map((report) => report.targetUrl)).size;
  const reportToClientConversionRate = leadsCreated > 0 ? Math.round((projectsWithReport / leadsCreated) * 100) : 0;
  const issues = countStrings(reports.flatMap((report) => report.recommendationEngine?.recommendations?.map((item) => item.issue) ?? []));
  const recommendations = countStrings(reports.flatMap((report) => report.recommendationEngine?.recommendations?.map((item) => item.action) ?? []));
  const industries = buildIndustryTrends(reports);
  const services = servicesToPitch([...recommendations.keys()], branding?.serviceOfferings ?? []);
  const highIntent = buildLikelyBuySignals(reports, reportToClientConversionRate);
  const suggestedTier = branding?.agencySuccessCenter?.defaultPricingTier ?? tierForOpportunity(reports, services.length);

  return {
    analytics: {
      reportsGenerated,
      leadsCreated,
      reportToClientConversionRate,
      mostCommonClientIssues: topKeys(issues, 6),
      highestRoiRecommendations: topKeys(recommendations, 6),
      industryTrends: industries
    },
    successCenter: {
      whyThisLeadIsLikelyToBuy: highIntent,
      servicesToPitchFirst: services,
      estimatedDealSize: dealSizeForOpportunity(reports, services.length),
      suggestedPricingTier: suggestedTier,
      likelySalesObjections: salesObjectionsForReports(reports),
      personalizedSalesScript: salesScriptForReports(reports, services, branding),
      crossSellUpsellOpportunities: crossSellForServices(services, branding?.serviceOfferings ?? [])
    },
    crm: {
      enabled: Boolean(branding?.crmIntegration?.enabled),
      provider: branding?.crmIntegration?.provider ?? "none",
      deliveryMode: branding?.crmIntegration?.deliveryMode ?? "internal_outbox",
      queuedLeadCount: branding?.crmIntegration?.enabled ? reportsGenerated : 0,
      note: branding?.crmIntegration?.enabled
        ? "CRM delivery is staged through SYSTOLAB internal outbox/export controls. No third-party API call is made until credentials and outbound delivery are explicitly configured."
        : "CRM sync is disabled. Leads and reports remain inside SYSTOLAB."
    }
  };
}

function buildIndustryTrends(reports: ReportSnapshot[]): AgencyDashboard["analytics"]["industryTrends"] {
  const groups = new Map<string, ReportSnapshot[]>();
  for (const report of reports) {
    const industry = report.clientInformation?.industry ?? report.clientInformation?.businessType ?? "General";
    groups.set(industry, [...(groups.get(industry) ?? []), report]);
  }
  return [...groups.entries()].slice(0, 8).map(([industry, rows]) => {
    const scores = rows.map((report) => report.oss?.score).filter((score): score is number => typeof score === "number");
    const averageOss = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const sorted = rows.filter((report) => typeof report.oss?.score === "number").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = sorted[0]?.oss.score;
    const last = sorted[sorted.length - 1]?.oss.score;
    const trend = typeof first === "number" && typeof last === "number" && sorted.length > 1
      ? last > first + 2 ? "improving" : first > last + 2 ? "declining" : "stable"
      : "baseline";
    return { industry, reports: rows.length, averageOss, trend };
  });
}

function countStrings(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items.map((value) => value.trim()).filter(Boolean)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function servicesToPitch(recommendations: string[], configuredServices: string[]): string[] {
  const lower = recommendations.join(" ").toLowerCase();
  const services = new Set<string>();
  if (/seo|search|visibility|meta|schema|content/.test(lower)) services.add("SEO");
  if (/mobile|cta|conversion|contact|form|navigation/.test(lower)) services.add("CRO");
  if (/trust|review|testimonial|proof|local/.test(lower)) services.add("Local SEO");
  if (/speed|render|layout|development|technical/.test(lower)) services.add("Website Development");
  for (const service of configuredServices.slice(0, 4)) services.add(service);
  return [...services].slice(0, 6);
}

function buildLikelyBuySignals(reports: ReportSnapshot[], conversionRate: number): string[] {
  const latest = reports[0];
  const signals = [
    conversionRate > 0 ? `${conversionRate}% of active projects already have reports generated.` : "Lead has been captured as an active project.",
    latest?.recommendationEngine?.recommendations?.length ? "The latest report contains specific recommended services, making the sales conversation concrete." : "A first report can create the initial sales conversation.",
    latest?.competitorComparison?.length ? "Competitor evidence is available, which can increase urgency." : "Competitor evidence can be added to strengthen urgency."
  ];
  return signals;
}

function tierForOpportunity(reports: ReportSnapshot[], serviceCount: number): string {
  const score = reports[0]?.oss?.score;
  if (typeof score === "number" && score < 50) return "Growth Recovery Package";
  if (serviceCount >= 4) return "Agency Growth Package";
  return "Strategy Starter Package";
}

function dealSizeForOpportunity(reports: ReportSnapshot[], serviceCount: number): string {
  const latest = reports[0];
  const risk = latest?.businessRiskStatus?.classification;
  if (risk === "HIGH" || risk === "CRITICAL" || serviceCount >= 4) return "High: multi-service implementation opportunity";
  if (risk === "MEDIUM" || serviceCount >= 2) return "Medium: focused optimization opportunity";
  return "Entry: strategy and priority-fix opportunity";
}

function salesObjectionsForReports(reports: ReportSnapshot[]): string[] {
  const confidence = reports[0]?.confidenceEngine?.overallConfidenceScore ?? 0;
  const objections = ["Why should we fix this now?", "How do we know these recommendations will improve results?"];
  if (confidence < 70) objections.push("Is there enough evidence to justify the work?");
  if (!reports[0]?.competitorComparison?.length) objections.push("How do we compare against competitors?");
  return objections;
}

function salesScriptForReports(reports: ReportSnapshot[], services: string[], branding?: TenantBranding): string {
  const partner = branding?.publicName ?? "Your agency";
  const latest = reports[0];
  const topAction = latest?.decisionIntelligenceBrief?.executiveDecisionMatrix?.recommendedNextAction ?? latest?.recommendationEngine?.recommendations?.[0]?.action ?? "review the highest-priority website and SEO opportunities";
  const serviceText = services.length ? services.join(", ") : "priority implementation";
  return `${partner} should open with the business outcome: ${topAction}. Then position ${serviceText} as the first practical step, offer a short implementation timeline, and close with the configured CTA.`;
}

function crossSellForServices(services: string[], configuredServices: string[]): string[] {
  const pool = configuredServices.length ? configuredServices : ["SEO", "Website Development", "Google Ads", "CRO", "Local SEO", "AI Search Optimization"];
  return pool.filter((service) => !services.includes(service)).slice(0, 5);
}
export async function getAgencyProfitabilityReport(tenantSlug: string, months = 6) {
  const costReport = await getTenantCostReport(tenantSlug, months);
  const sub = await getSubscription(tenantSlug);
  const subAny = sub as unknown as Record<string, unknown> | null;
  const plan = subAny ? await getPlan(subAny["planId"] as string) : null;
  const planAny = plan as unknown as Record<string, unknown> | null;

  const monthlyRevenueCents = (planAny?.["priceCentsPerMonth"] as number) ?? 0;

  const periods = costReport.periods.map((p) => ({
    ...p,
    revenueCents: monthlyRevenueCents,
    profitCents: monthlyRevenueCents - p.costCents,
    margin: monthlyRevenueCents > 0
      ? Math.round(((monthlyRevenueCents - p.costCents) / monthlyRevenueCents) * 100)
      : 0
  }));

  return {
    tenantSlug,
    planName: (planAny?.["name"] as string) ?? "unknown",
    monthlyRevenueCents,
    periods,
    totalCostCents: costReport.totalCostCents,
    totalRevenueCents: monthlyRevenueCents * periods.length,
    avgProfitMarginPct: periods.length
      ? Math.round(periods.reduce((s, p) => s + p.margin, 0) / periods.length)
      : 0
  };
}
