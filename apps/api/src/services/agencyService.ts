import { Workspace } from "../models/Workspace.js";
import { Snapshot } from "../models/Snapshot.js";
import { TenantMembership } from "../models/TenantMembership.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { getTenantCostReport, getSubscription, getPlanByTier, getPlan } from "./billingService.js";
import { getCurrentPeriodKey, getUsageForPeriod } from "./usageTrackingService.js";
import { isMongoConnected } from "../db/mongoose.js";
import { _memWorkspaces, _memTenantMems, _memWorkspaceMems } from "./membershipService.js";

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
        Snapshot.findOne({ workspaceId: ws.workspaceId }).sort({ createdAt: -1 }).select("report.oss createdAt"),
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
    Snapshot.findOne({ workspaceId }).sort({ createdAt: -1 }).select("report.oss createdAt"),
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
      workspaces
    };
  }

  const periodKey = getCurrentPeriodKey();

  const [totalWorkspaces, totalMembers, sub, usageRecord, workspaces] = await Promise.all([
    Workspace.countDocuments({ tenantSlug }),
    TenantMembership.countDocuments({ tenantSlug, isActive: true }),
    getSubscription(tenantSlug),
    getUsageForPeriod(tenantSlug, periodKey),
    listClientWorkspaces(tenantSlug)
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
    workspaces
  };
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
