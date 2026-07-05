import type { AuthUserProfile, ReportSnapshot, TenantBranding } from "@systolab/shared";
import type { TenantRole } from "../models/TenantMembership.js";
import type { WorkspaceDocument } from "../models/Workspace.js";
import type { WorkspaceRole } from "../models/WorkspaceMembership.js";
import { Tenant, tenantToBranding, defaultBranding } from "../models/Tenant.js";
import { isMongoConnected } from "../db/mongoose.js";
import { enqueuePlatformJob } from "./platformControlPlaneService.js";
import { findSnapshotHistoryForTarget } from "./persistenceService.js";
import {
  createWorkspace,
  getTenantBySlug,
  getWorkspace,
  listUserTenants,
  listUserWorkspaces,
  MembershipError,
  updateTenant,
  updateWorkspace,
  _memTenants
} from "./membershipService.js";
import {
  checkApiCallLimit,
  checkScanLimit,
  getCurrentPeriodKey,
  getUsageForPeriod,
  getUsageHistory,
  recordScanUsage
} from "./usageTrackingService.js";
import {
  cancelSubscription,
  getSubscription,
  getTenantPlanLimits,
  listBillingPlans,
  seedDefaultPlans
} from "./billingService.js";

export type PortalRole = "owner" | "agency_admin" | "team_member" | "client" | "viewer";

export interface ProjectInput {
  tenantSlug: string;
  targetUrl: string;
  projectName?: string;
  clientCompanyName?: string;
  contactPerson?: string;
  clientLogoUrl?: string;
  city?: string;
  serviceArea?: string;
  businessType?: string;
  targetCountry?: string;
  targetLocation?: string;
  competitorUrls?: string[];
  gbpUrl?: string;
  monitoringConfig?: {
    cadence?: "manual" | "daily" | "weekly" | "monthly";
    enabled?: boolean;
  };
  clientAccessEnabled?: boolean;
}

export interface PortalProjectSummary {
  workspaceId: string;
  tenantSlug: string;
  role: WorkspaceRole;
  projectName: string;
  clientCompanyName?: string;
  contactPerson?: string;
  clientLogoUrl?: string;
  city?: string;
  serviceArea?: string;
  targetUrl: string;
  businessType?: string;
  targetCountry?: string;
  targetLocation?: string;
  competitorUrls: string[];
  gbpUrl?: string;
  monitoringConfig: {
    cadence: "manual" | "daily" | "weekly" | "monthly";
    enabled: boolean;
  };
  clientAccessEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  latestReport?: PortalReportSummary;
}

export interface PortalReportSummary {
  snapshotId: string;
  createdAt: string;
  status: ReportSnapshot["status"];
  targetUrl: string;
  oss: number | null;
  visualStateLabel: string;
  businessRiskStatus: string;
  evidenceCoveragePercent: number;
  confidenceLabel: string;
  reportUrl: string;
  pdfUrl: string;
  brandedReportUrl?: string;
  brandedPdfUrl?: string;
  expiresAt?: string;
}

export function permissionsForTenantRole(role: TenantRole): string[] {
  if (role === "owner") {
    return [
      "tenant:manage",
      "team:manage",
      "projects:create",
      "projects:manage",
      "projects:view",
      "reports:view",
      "billing:manage",
      "white_label:manage",
      "api_keys:manage"
    ];
  }
  if (role === "member") {
    return ["projects:create", "projects:manage", "projects:view", "reports:view", "team:invite", "usage:view"];
  }
  return ["projects:view", "reports:view"];
}

export function portalRoleForTenantRole(role: TenantRole): PortalRole {
  if (role === "owner") return "owner";
  if (role === "member") return "team_member";
  return "viewer";
}

export async function getPortalMe(user: AuthUserProfile): Promise<{
  user: AuthUserProfile;
  tenants: Array<{
    tenantSlug: string;
    tenantId: string;
    role: TenantRole;
    portalRole: PortalRole;
    permissions: string[];
    branding: TenantBranding;
  }>;
  projects: PortalProjectSummary[];
}> {
  const memberships = await listUserTenants(user.userId);
  const tenants = await Promise.all(
    memberships.map(async (membership) => {
      const tenant = await getTenantBySlug(membership.tenantSlug);
      return {
        tenantSlug: membership.tenantSlug,
        tenantId: membership.tenantId.toString(),
        role: membership.role,
        portalRole: portalRoleForTenantRole(membership.role),
        permissions: permissionsForTenantRole(membership.role),
        branding: tenant ? tenantToBranding(tenant) : { ...defaultBranding(), slug: membership.tenantSlug, tenantId: membership.tenantId.toString() }
      };
    })
  );

  const projects = await listProjectsForUser(user.userId);
  return { user, tenants, projects };
}

export async function listProjectsForUser(userId: string, tenantSlug?: string): Promise<PortalProjectSummary[]> {
  const memberships = await listUserWorkspaces(userId, tenantSlug);
  const projects = await Promise.all(
    memberships.map(async (membership) => {
      const workspace = await getWorkspace(membership.workspaceId);
      if (!workspace) return null;
      return summarizeProject(workspace, membership.role);
    })
  );
  return projects.filter((item): item is PortalProjectSummary => Boolean(item));
}

export async function createProjectForTenant(userId: string, input: ProjectInput): Promise<PortalProjectSummary> {
  const tenant = await getTenantBySlug(input.tenantSlug);
  if (!tenant) throw new MembershipError("Tenant not found.", 404);
  const { workspace, membership } = await createWorkspace(String(tenant._id), tenant.slug, userId, input.targetUrl, input.businessType);
  const updated = await updateWorkspace(workspace.workspaceId, {
    projectName: cleanString(input.projectName) ?? cleanString(input.clientCompanyName) ?? deriveProjectName(input.targetUrl),
    clientCompanyName: cleanString(input.clientCompanyName) ?? cleanString(input.projectName),
    contactPerson: cleanString(input.contactPerson),
    clientLogoUrl: cleanString(input.clientLogoUrl),
    city: cleanString(input.city) ?? cleanString(input.targetLocation),
    serviceArea: cleanString(input.serviceArea) ?? cleanString(input.targetLocation),
    businessType: cleanString(input.businessType),
    industry: cleanString(input.businessType),
    targetCountry: cleanString(input.targetCountry),
    targetLocation: cleanString(input.targetLocation),
    competitorUrls: normalizeUrlList(input.competitorUrls),
    gbpUrl: cleanString(input.gbpUrl),
    monitoringConfig: {
      cadence: input.monitoringConfig?.cadence ?? "manual",
      enabled: Boolean(input.monitoringConfig?.enabled)
    },
    clientAccessEnabled: Boolean(input.clientAccessEnabled)
  });
  return summarizeProject(updated, membership.role);
}

export async function getProjectForMember(workspaceId: string, role: WorkspaceRole): Promise<PortalProjectSummary> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new MembershipError("Workspace not found.", 404);
  return summarizeProject(workspace, role);
}

export async function updateProjectForMember(
  workspaceId: string,
  role: WorkspaceRole,
  updates: Partial<Omit<ProjectInput, "tenantSlug">>
): Promise<PortalProjectSummary> {
  const allowedUpdates = {
    projectName: cleanString(updates.projectName),
    clientCompanyName: cleanString(updates.clientCompanyName),
    contactPerson: cleanString(updates.contactPerson),
    clientLogoUrl: cleanString(updates.clientLogoUrl),
    city: cleanString(updates.city),
    serviceArea: cleanString(updates.serviceArea),
    businessType: cleanString(updates.businessType),
    industry: cleanString(updates.businessType),
    targetCountry: cleanString(updates.targetCountry),
    targetLocation: cleanString(updates.targetLocation),
    competitorUrls: updates.competitorUrls ? normalizeUrlList(updates.competitorUrls) : undefined,
    gbpUrl: cleanString(updates.gbpUrl),
    monitoringConfig: updates.monitoringConfig,
    clientAccessEnabled: updates.clientAccessEnabled
  };
  const workspace = await updateWorkspace(workspaceId, removeUndefined(allowedUpdates));
  return summarizeProject(workspace, role);
}

export async function listProjectReports(workspaceId: string): Promise<PortalReportSummary[]> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new MembershipError("Workspace not found.", 404);
  const reports = await findSnapshotHistoryForTarget(workspace.targetUrl, workspace.tenantSlug, 24);
  return reports.map(summarizeReport);
}

export async function runProjectScan(
  workspaceId: string,
  tenantId: string,
  userId: string,
  options: { mode?: "fast_scan" | "full_audit"; includeSeo?: boolean; competitorUrls?: string[]; gbpUrl?: string } = {}
): Promise<{
  jobId: string;
  status: string;
  statusUrl: string;
  targetUrl: string;
  queuedAt: Date;
  usage: { used: number; limit: number; allowed: boolean };
}> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new MembershipError("Workspace not found.", 404);

  const limit = await checkScanLimit(workspace.tenantSlug);
  if (!limit.allowed) {
    throw new MembershipError(`Monthly scan limit reached (${limit.used}/${limit.limit}).`, 429);
  }

  await recordScanUsage(tenantId, workspace.tenantSlug);
  const job = await enqueuePlatformJob({
    jobType: "scan.execution",
    queue: "scan",
    priority: options.mode === "full_audit" ? 9 : 7,
    maxAttempts: 3,
    payload: {
      workspaceId: workspace.workspaceId,
      targetUrl: workspace.targetUrl,
      tenantSlug: workspace.tenantSlug,
      mode: options.mode ?? "full_audit",
      includeSeo: options.includeSeo ?? true,
      competitorUrls: normalizeUrlList(options.competitorUrls ?? workspace.competitorUrls ?? []),
      gbpUrl: cleanString(options.gbpUrl ?? workspace.gbpUrl),
      industryType: workspace.businessType ?? workspace.industry,
      clientInformation: removeUndefined({
        clientCompanyName: cleanString(workspace.clientCompanyName) ?? cleanString(workspace.projectName) ?? deriveProjectName(workspace.targetUrl),
        websiteUrl: workspace.targetUrl,
        industry: cleanString(workspace.industry ?? workspace.businessType),
        businessType: cleanString(workspace.businessType ?? workspace.industry),
        country: cleanString(workspace.targetCountry),
        city: cleanString(workspace.city ?? workspace.targetLocation),
        serviceArea: cleanString(workspace.serviceArea ?? workspace.targetLocation),
        competitorUrls: normalizeUrlList(options.competitorUrls ?? workspace.competitorUrls ?? []),
        contactPerson: cleanString(workspace.contactPerson),
        clientLogoUrl: cleanString(workspace.clientLogoUrl)
      }),
      userId
    }
  });

  return {
    jobId: job.jobId,
    status: job.status,
    statusUrl: `/api/scans/${job.jobId}`,
    targetUrl: workspace.targetUrl,
    queuedAt: job.scheduledFor,
    usage: { ...limit, used: limit.used + 1 }
  };
}

export async function getUsageOverview(tenantSlug: string): Promise<{
  tenantSlug: string;
  periodKey: string;
  limits: Awaited<ReturnType<typeof getTenantPlanLimits>>;
  usage: Awaited<ReturnType<typeof getUsageForPeriod>>;
  history: Awaited<ReturnType<typeof getUsageHistory>>;
  scanLimit: Awaited<ReturnType<typeof checkScanLimit>>;
  apiCallLimit: Awaited<ReturnType<typeof checkApiCallLimit>>;
}> {
  const [limits, usage, history, scanLimit, apiCallLimit] = await Promise.all([
    getTenantPlanLimits(tenantSlug),
    getUsageForPeriod(tenantSlug),
    getUsageHistory(tenantSlug, 12),
    checkScanLimit(tenantSlug),
    checkApiCallLimit(tenantSlug)
  ]);
  return { tenantSlug, periodKey: getCurrentPeriodKey(), limits, usage, history, scanLimit, apiCallLimit };
}

export async function getBillingOverview(tenantSlug: string): Promise<{
  plans: Awaited<ReturnType<typeof listBillingPlans>>;
  subscription: Awaited<ReturnType<typeof getSubscription>>;
  usage: Awaited<ReturnType<typeof getUsageOverview>>;
}> {
  await seedDefaultPlans();
  const [plans, subscription, usage] = await Promise.all([
    listBillingPlans(),
    getSubscription(tenantSlug),
    getUsageOverview(tenantSlug)
  ]);
  return { plans, subscription, usage };
}

export async function cancelTenantBilling(tenantSlug: string): Promise<Awaited<ReturnType<typeof cancelSubscription>>> {
  return cancelSubscription(tenantSlug);
}

export async function resolveWhiteLabelBranding(input: { slug?: string; domain?: string }): Promise<{
  found: boolean;
  branding: TenantBranding;
}> {
  const slug = cleanString(input.slug)?.toLowerCase();
  const domain = cleanString(input.domain)?.toLowerCase();
  const tenant = await findTenantForBranding(slug, domain);
  return tenant ? { found: true, branding: tenantToBranding(tenant) } : { found: false, branding: defaultBranding() };
}

export async function updateWhiteLabelBranding(
  tenantId: string,
  updates: Partial<TenantBranding>
): Promise<TenantBranding> {
  const tenant = await updateTenant(tenantId, removeUndefined({
    publicName: cleanString(updates.publicName),
    logoUrl: cleanString(updates.logoUrl),
    faviconUrl: cleanString(updates.faviconUrl),
    consultantPhotoUrl: cleanString(updates.consultantPhotoUrl),
    consultantEmail: cleanString(updates.consultantEmail),
    websiteUrl: cleanString(updates.websiteUrl),
    phoneNumber: cleanString(updates.phoneNumber),
    officeAddress: cleanString(updates.officeAddress),
    businessRegistration: cleanString(updates.businessRegistration),
    licenseNumber: cleanString(updates.licenseNumber),
    socialLinks: updates.socialLinks ? normalizeTextList(updates.socialLinks) : undefined,
    consultantName: cleanString(updates.consultantName),
    disclaimerText: cleanString(updates.disclaimerText),
    coverPageDesign: cleanCoverPageDesign(updates.coverPageDesign),
    reportIntroduction: cleanString(updates.reportIntroduction),
    reportHeaderText: cleanString(updates.reportHeaderText),
    thankYouPageTitle: cleanString(updates.thankYouPageTitle),
    thankYouPageMessage: cleanString(updates.thankYouPageMessage),
    iconStyle: cleanIconStyle(updates.iconStyle),
    qrCodeUrl: cleanString(updates.qrCodeUrl),
    whatsappLink: cleanString(updates.whatsappLink),
    calendarBookingLink: cleanString(updates.calendarBookingLink),
    digitalSignature: cleanString(updates.digitalSignature),
    primaryCtaLabel: cleanString(updates.primaryCtaLabel),
    primaryCtaUrl: cleanString(updates.primaryCtaUrl),
    secondaryCtaLabel: cleanString(updates.secondaryCtaLabel),
    secondaryCtaUrl: cleanString(updates.secondaryCtaUrl),
    reportValidityDays: cleanPositiveNumber(updates.reportValidityDays, 365),
    validityStatement: cleanString(updates.validityStatement),
    proposalModeEnabled: typeof updates.proposalModeEnabled === "boolean" ? updates.proposalModeEnabled : undefined,
    proposalTimeline: cleanString(updates.proposalTimeline),
    proposalInvestmentRange: cleanString(updates.proposalInvestmentRange),
    proposalDeliverables: updates.proposalDeliverables ? normalizeTextList(updates.proposalDeliverables) : undefined,
    proposalExpectedImpact: cleanString(updates.proposalExpectedImpact),
    crmIntegration: cleanCrmIntegration(updates.crmIntegration),
    pdfSecurity: cleanPdfSecurity(updates.pdfSecurity),
    reportLanguage: cleanReportLanguage(updates.reportLanguage),
    industryTemplate: cleanIndustryTemplate(updates.industryTemplate),
    followUpAssets: cleanFollowUpAssets(updates.followUpAssets),
    agencySuccessCenter: cleanAgencySuccessCenter(updates.agencySuccessCenter),
    serviceOfferings: updates.serviceOfferings ? normalizeTextList(updates.serviceOfferings) : undefined,
    poweredByMode: cleanPoweredByMode(updates.poweredByMode),
    primaryColor: cleanString(updates.primaryColor),
    secondaryColor: cleanString(updates.secondaryColor),
    accentColor: cleanString(updates.accentColor),
    typography: cleanString(updates.typography),
    loginBackgroundUrl: cleanString(updates.loginBackgroundUrl),
    dashboardWelcomeMessage: cleanString(updates.dashboardWelcomeMessage),
    emailSenderName: cleanString(updates.emailSenderName),
    supportEmail: cleanString(updates.supportEmail),
    privacyPolicyUrl: cleanString(updates.privacyPolicyUrl),
    termsOfServiceUrl: cleanString(updates.termsOfServiceUrl),
    attributionMode: updates.attributionMode,
    assistantName: cleanString(updates.assistantName),
    reportTitle: cleanString(updates.reportTitle),
    reportFooter: cleanString(updates.reportFooter),
    customReportLabels: updates.customReportLabels,
    poweredByLabel: cleanString(updates.poweredByLabel),
    footerLabel: cleanString(updates.footerLabel),
    customDomain: cleanDomain(updates.customDomain),
    customDomains: updates.customDomains ? normalizeDomainList(updates.customDomains) : undefined,
    customDomainStatus: cleanCustomDomainStatus(updates.customDomainStatus),
    customDomainVerificationTarget: cleanString(updates.customDomainVerificationTarget)
  }));
  return tenantToBranding(tenant);
}
async function summarizeProject(workspace: WorkspaceDocument, role: WorkspaceRole): Promise<PortalProjectSummary> {
  const history = await findSnapshotHistoryForTarget(workspace.targetUrl, workspace.tenantSlug, 1);
  const latestReport = history[0] ? summarizeReport(history[0]) : undefined;
  return {
    workspaceId: workspace.workspaceId,
    tenantSlug: workspace.tenantSlug,
    role,
    projectName: workspace.projectName ?? workspace.clientCompanyName ?? deriveProjectName(workspace.targetUrl),
    clientCompanyName: workspace.clientCompanyName,
    contactPerson: workspace.contactPerson,
    clientLogoUrl: workspace.clientLogoUrl,
    city: workspace.city,
    serviceArea: workspace.serviceArea,
    targetUrl: workspace.targetUrl,
    businessType: workspace.businessType ?? workspace.industry,
    targetCountry: workspace.targetCountry,
    targetLocation: workspace.targetLocation,
    competitorUrls: normalizeUrlList(workspace.competitorUrls ?? []),
    gbpUrl: workspace.gbpUrl,
    monitoringConfig: {
      cadence: workspace.monitoringConfig?.cadence ?? "manual",
      enabled: Boolean(workspace.monitoringConfig?.enabled)
    },
    clientAccessEnabled: Boolean(workspace.clientAccessEnabled),
    createdAt: toIso(workspace.createdAt),
    updatedAt: toIso(workspace.updatedAt),
    latestReport
  };
}

function summarizeReport(report: ReportSnapshot): PortalReportSummary {
  const totalPages = report.evidenceCoverageSummary.totalPagesSampled;
  const brandedBaseUrl = brandedReportBaseUrl(report.tenantBranding);
  const expiresAt = reportExpiresAt(report);
  const coveredPages = report.evidenceCoverageSummary.pages.filter((page) => page.evidenceCount > 0).length;
  const evidenceCoveragePercent = totalPages > 0 ? Math.round((coveredPages / totalPages) * 100) : 0;
  const averageConfidence = report.confidenceLayer.length
    ? Math.round(report.confidenceLayer.reduce((sum, item) => sum + item.confidenceScore, 0) / report.confidenceLayer.length)
    : 0;
  return {
    snapshotId: report.snapshotId,
    createdAt: report.createdAt,
    status: report.status,
    targetUrl: report.targetUrl,
    oss: report.oss.score,
    visualStateLabel: report.oss.visualState.label,
    businessRiskStatus: report.verdictCard.businessRiskStatus,
    evidenceCoveragePercent,
    confidenceLabel: confidenceLabel(averageConfidence),
    reportUrl: `/reports/${report.snapshotId}`,
    pdfUrl: `/api/reports/${report.snapshotId}/pdf`,
    brandedReportUrl: brandedBaseUrl ? `${brandedBaseUrl}/reports/${report.snapshotId}` : undefined,
    brandedPdfUrl: brandedBaseUrl ? `${brandedBaseUrl}/api/reports/${report.snapshotId}/pdf` : undefined,
    expiresAt
  };
}
async function findTenantForBranding(slug?: string, domain?: string) {
  if (!isMongoConnected()) {
    return [..._memTenants.values()].find((tenant) => {
      const tenantDomain = tenant.customDomain?.toLowerCase();
      const tenantDomains = normalizeDomainList([tenant.customDomain, ...(tenant.customDomains ?? [])]);
      return tenant.isActive && ((slug && tenant.slug === slug) || (domain && tenantDomains.includes(domain)) || (domain && tenantDomain === domain));
    }) ?? null;
  }
  if (slug) {
    const tenant = await Tenant.findOne({ slug, isActive: true });
    if (tenant) return tenant;
  }
  if (domain) {
    return Tenant.findOne({ isActive: true, $or: [{ customDomain: domain }, { customDomains: domain }] });
  }
  return null;
}

function removeUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 10);
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 24);
}

function cleanDomain(value: unknown): string | undefined {
  const clean = cleanString(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) return undefined;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean) ? clean : undefined;
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanDomain).filter((item): item is string => Boolean(item)))].slice(0, 8);
}

function cleanPositiveNumber(value: unknown, max: number): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(max, Math.round(numeric));
}

function cleanIconStyle(value: unknown): TenantBranding["iconStyle"] | undefined {
  return value === "line" || value === "solid" || value === "minimal" ? value : undefined;
}

function cleanCustomDomainStatus(value: unknown): TenantBranding["customDomainStatus"] | undefined {
  return value === "not_configured" || value === "pending_dns" || value === "verified" || value === "failed" ? value : undefined;
}

function cleanReportLanguage(value: unknown): TenantBranding["reportLanguage"] | undefined {
  return value === "en" || value === "ar" || value === "fr" || value === "de" || value === "es" || value === "hi" ? value : undefined;
}

function cleanIndustryTemplate(value: unknown): TenantBranding["industryTemplate"] | undefined {
  return value === "general" || value === "dentists" || value === "lawyers" || value === "interior_designers" || value === "real_estate" || value === "saas" || value === "hotels" || value === "ecommerce" || value === "healthcare" || value === "manufacturing" ? value : undefined;
}

function cleanCrmIntegration(value: unknown): TenantBranding["crmIntegration"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const provider = ["hubspot", "gohighlevel", "salesforce", "zoho", "pipedrive", "custom_webhook", "none"].includes(String(record["provider"])) ? String(record["provider"]) as NonNullable<TenantBranding["crmIntegration"]>["provider"] : "none";
  const deliveryMode = record["deliveryMode"] === "manual_export" ? "manual_export" : "internal_outbox";
  return {
    enabled: Boolean(record["enabled"]),
    provider,
    destinationLabel: cleanString(record["destinationLabel"]),
    deliveryMode
  };
}

function cleanPdfSecurity(value: unknown): TenantBranding["pdfSecurity"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const downloadRestriction = record["downloadRestriction"] === "authenticated_only" || record["downloadRestriction"] === "expires_after_validity" ? record["downloadRestriction"] : "none";
  return {
    passwordProtected: Boolean(record["passwordProtected"]),
    passwordHint: cleanString(record["passwordHint"]),
    watermarkText: cleanString(record["watermarkText"]),
    downloadRestriction,
    auditDownloads: Boolean(record["auditDownloads"]),
    tamperSeal: Boolean(record["tamperSeal"])
  };
}

function cleanFollowUpAssets(value: unknown): TenantBranding["followUpAssets"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return removeUndefined({
    emailSubject: cleanString(record["emailSubject"]),
    emailBody: cleanString(record["emailBody"]),
    proposalEmailBody: cleanString(record["proposalEmailBody"]),
    whatsappMessage: cleanString(record["whatsappMessage"]),
    meetingInvitationText: cleanString(record["meetingInvitationText"]),
    presentationSummary: cleanString(record["presentationSummary"])
  }) as TenantBranding["followUpAssets"];
}

function cleanAgencySuccessCenter(value: unknown): TenantBranding["agencySuccessCenter"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const tone = record["salesScriptTone"] === "direct" || record["salesScriptTone"] === "executive" ? record["salesScriptTone"] : "consultative";
  return {
    enabled: Boolean(record["enabled"]),
    defaultPricingTier: cleanString(record["defaultPricingTier"]),
    salesScriptTone: tone
  };
}

function brandedReportBaseUrl(branding: TenantBranding): string | undefined {
  const domain = normalizeDomainList([branding.customDomain, ...(branding.customDomains ?? [])])[0];
  return domain ? `https://${domain}` : undefined;
}

function reportExpiresAt(report: ReportSnapshot): string | undefined {
  const days = report.tenantBranding.reportValidityDays;
  if (!days || days <= 0) return undefined;
  const created = new Date(report.createdAt);
  if (Number.isNaN(created.getTime())) return undefined;
  return new Date(created.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
function cleanPoweredByMode(value: unknown): TenantBranding["poweredByMode"] | undefined {
  return value === "full_white_label" || value === "co_branded" || value === "systolab_standard" ? value : undefined;
}

function cleanCoverPageDesign(value: unknown): TenantBranding["coverPageDesign"] | undefined {
  return value === "classic" || value === "executive" || value === "minimal" ? value : undefined;
}

function deriveProjectName(targetUrl: string): string {
  try {
    return new URL(targetUrl).hostname.replace(/^www\./, "") || "Website Project";
  } catch {
    return "Website Project";
  }
}

function confidenceLabel(score: number): string {
  if (score >= 90) return "Very High";
  if (score >= 80) return "High";
  if (score >= 70) return "Moderate";
  if (score > 0) return "Limited";
  return "Not Available";
}

function toIso(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}
