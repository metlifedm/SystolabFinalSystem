import type { AuthUserProfile, ReportSnapshot, TenantBranding } from "@systolab/shared";
import type { TenantRole } from "../models/TenantMembership.js";
import type { WorkspaceDocument } from "../models/Workspace.js";
import type { WorkspaceRole } from "../models/WorkspaceMembership.js";
import { Tenant, tenantToBranding, defaultBranding } from "../models/Tenant.js";
import { isMongoConnected } from "../db/mongoose.js";
import { enqueuePlatformJob } from "./platformControlPlaneService.js";
import { findSnapshotHistoryForTarget } from "./persistenceService.js";
import {
  createTenant,
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
import { sha256 } from "../utils/crypto.js";

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

export interface FirstAnalysisInput {
  targetUrl: string;
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
  clientReady: {
    status: "ready" | "review" | "not_ready";
    label: "Ready to Share" | "Review Recommended" | "Not Ready";
    reason: string;
  };
  whatToSayToClient: string;
  highestRoiAction: string;
  implementationTime: string;
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

export async function ensureCustomerOrganization(user: AuthUserProfile, requestedName?: string): Promise<{
  tenant: Awaited<ReturnType<typeof createTenant>>["tenant"];
  membership: Awaited<ReturnType<typeof createTenant>>["membership"];
  created: boolean;
}> {
  const memberships = await listUserTenants(user.userId);
  const membership = memberships.find((item) => item.role === "owner" || item.role === "member");
  const tenant = membership ? await getTenantBySlug(membership.tenantSlug) : null;
  if (membership && tenant) return { tenant, membership, created: false };

  const publicName = cleanString(requestedName) ?? defaultAgencyName(user);
  const created = await createTenant(defaultAgencySlug(user), publicName, user.userId);
  return { ...created, created: true };
}

export async function startFirstAnalysis(user: AuthUserProfile, input: FirstAnalysisInput): Promise<{
  organization: { tenantId: string; tenantSlug: string; publicName: string; created: boolean };
  website: PortalProjectSummary;
  job: Awaited<ReturnType<typeof runProjectScan>>;
}> {
  const targetUrl = normalizeCustomerWebsiteUrl(input.targetUrl);
  const organization = await ensureCustomerOrganization(user);
  const { membership, tenant } = organization;

  const projects = await listProjectsForUser(user.userId, membership.tenantSlug);
  let website = projects.find((project) => canonicalWebsiteKey(project.targetUrl) === canonicalWebsiteKey(targetUrl));
  if (!website) {
    const businessName = deriveProjectName(targetUrl);
    website = await createProjectForTenant(user.userId, {
      tenantSlug: membership.tenantSlug,
      targetUrl,
      projectName: businessName,
      clientCompanyName: businessName,
      monitoringConfig: { cadence: "manual", enabled: false }
    });
  }

  const job = await runProjectScan(website.workspaceId, String(tenant._id), user.userId, {
    mode: "full_audit",
    includeSeo: true
  });

  return {
    organization: {
      tenantId: String(tenant._id),
      tenantSlug: membership.tenantSlug,
      publicName: tenant.publicName,
      created: organization.created
    },
    website,
    job
  };
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
  assertNoLockedWhiteLabelKeys(updates as Record<string, unknown>);
  const existingTenant = await findTenantByIdForBranding(tenantId);
  if (!existingTenant) throw new MembershipError("Tenant not found.", 404);
  const limits = await getTenantPlanLimits(existingTenant.slug);
  const canUseWhiteLabel = Boolean(limits.whiteLabel);
  const canUseCustomDomain = Boolean(limits.customDomain);
  const poweredByMode = updates.poweredByMode === undefined
    ? undefined
    : canUseWhiteLabel
      ? cleanPoweredByMode(updates.poweredByMode)
      : "systolab_standard";

  const tenant = await updateTenant(tenantId, removeUndefined({
    publicName: cleanString(updates.publicName),
    logoUrl: cleanString(updates.logoUrl),
    faviconUrl: cleanString(updates.faviconUrl),
    consultantPhotoUrl: cleanString(updates.consultantPhotoUrl),
    consultantEmail: cleanString(updates.consultantEmail),
    consultantDesignation: cleanString(updates.consultantDesignation),
    websiteUrl: cleanString(updates.websiteUrl),
    phoneNumber: cleanString(updates.phoneNumber),
    officeAddress: cleanString(updates.officeAddress),
    googleMapsUrl: cleanString(updates.googleMapsUrl),
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
    whatsappNumber: cleanString(updates.whatsappNumber),
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
    proposalExpectedServiceOutcome: cleanString(updates.proposalExpectedServiceOutcome),
    proposalPageContent: cleanString(updates.proposalPageContent),
    pricingPageContent: cleanString(updates.pricingPageContent),
    crmIntegration: cleanCrmIntegration(updates.crmIntegration),
    pdfSecurity: cleanPdfSecurity(updates.pdfSecurity),
    reportLanguage: cleanReportLanguage(updates.reportLanguage),
    currency: cleanCurrency(updates.currency),
    timeZone: cleanString(updates.timeZone),
    followUpAssets: cleanFollowUpAssets(updates.followUpAssets),
    agencySuccessCenter: cleanAgencySuccessCenter(updates.agencySuccessCenter),
    serviceOfferings: updates.serviceOfferings ? normalizeTextList(updates.serviceOfferings) : undefined,
    aboutCompany: cleanString(updates.aboutCompany),
    whyChooseUs: cleanString(updates.whyChooseUs),
    portfolioItems: updates.portfolioItems ? normalizeTextList(updates.portfolioItems) : undefined,
    testimonials: updates.testimonials ? normalizeTextList(updates.testimonials) : undefined,
    agencyImplementationNotes: cleanAgencyImplementationNotes(updates.agencyImplementationNotes),
    poweredByMode,
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
    reportTitle: cleanString(updates.reportTitle),
    reportFooter: cleanString(updates.reportFooter),
    customDomain: canUseCustomDomain ? cleanDomain(updates.customDomain) : undefined,
    customDomains: canUseCustomDomain && updates.customDomains ? normalizeDomainList(updates.customDomains) : undefined
  }));
  return tenantToBranding(tenant);
}

async function findTenantByIdForBranding(tenantId: string) {
  if (!isMongoConnected()) {
    return [..._memTenants.values()].find((tenant) => tenant._id?.toString() === tenantId || tenant.id === tenantId) ?? null;
  }
  return Tenant.findById(tenantId);
}

const LOCKED_WHITE_LABEL_UPDATE_KEYS = new Set([
  "tenantId",
  "slug",
  "poweredByLabel",
  "footerLabel",
  "customReportLabels",
  "attributionMode",
  "assistantName",
  "proposalExpectedImpact",
  "customDomainStatus",
  "customDomainVerificationTarget",
  "businessReadinessScore",
  "oss",
  "verdictCard",
  "businessVitalSigns",
  "evidenceObjects",
  "evidenceDatabase",
  "evidenceClusters",
  "confidenceLayer",
  "confidenceEngine",
  "recommendationEngine",
  "decisionIntelligenceBrief",
  "competitorComparison",
  "revenueIntelligence",
  "customerQuestionCoverage",
  "dimensions",
  "rawSignalTelemetry",
  "validationTrace",
  "executionProvenance",
  "reportGovernance",
  "integrity"
]);

function assertNoLockedWhiteLabelKeys(updates: Record<string, unknown>): void {
  const locked = Object.keys(updates).filter((key) => LOCKED_WHITE_LABEL_UPDATE_KEYS.has(key));
  if (locked.length > 0) {
    throw new MembershipError(`Locked SYSTOLAB intelligence fields cannot be edited by agencies: ${locked.join(", ")}.`, 403);
  }
}async function summarizeProject(workspace: WorkspaceDocument, role: WorkspaceRole): Promise<PortalProjectSummary> {
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
  const averageConfidence = Math.round(
    report.confidenceEngine?.overallConfidenceScore ??
      (report.confidenceLayer.length
        ? report.confidenceLayer.reduce((sum, item) => sum + item.confidenceScore, 0) / report.confidenceLayer.length
        : 0)
  );
  const contentUnavailable = report.status === "content_unavailable" || report.oss?.scoringStatus === "not_scored" || report.oss?.score === null;
  const evidenceCount = report.evidenceCoverageSummary?.totalEvidenceObjects ?? report.evidenceObjects?.length ?? 0;
  const recommendation = report.recommendationEngine?.recommendations?.[0];
  const recommendationAction = recommendation?.action ?? report.actionFirstPanel?.fallbackAction ?? "Improve the strongest validated customer decision opportunity.";
  const recommendationReason = recommendation?.revenueIntelligenceMapping || recommendation?.issue || report.businessRiskStatus?.primaryRiskDriver || "Validated evidence supports this priority.";
  const highestRoiAction = contentUnavailable
    ? "Restore assessment access and establish a validated baseline."
    : portalBusinessExplanationForAction(recommendationAction, recommendationReason);
  const clientReady = contentUnavailable || evidenceCount <= 0
    ? { status: "not_ready" as const, label: "Not Ready" as const, reason: "Website content was unavailable. Re-run the assessment before presenting business conclusions." }
    : averageConfidence >= 70
      ? { status: "ready" as const, label: "Ready to Share" as const, reason: "Validated current-scan evidence supports the customer-facing conclusions." }
      : { status: "review" as const, label: "Review Recommended" as const, reason: "Review evidence limitations and confidence before presenting this report." };
  const whatToSayToClient = contentUnavailable
    ? "The assessment could not collect enough current website evidence to support a reliable business conclusion. We should restore access and re-run it before recommending investment."
    : "The validated report shows a " + portalReadinessPhrase(report.oss.score) + " business foundation. The first conversation should focus on this opportunity: " + highestRoiAction + " The expected result is a clearer customer decision path, and progress should be confirmed with a follow-up scan.";
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
    clientReady,
    whatToSayToClient,
    highestRoiAction,
    implementationTime: contentUnavailable ? "Depends on website access configuration" : portalImplementationTimeForAction(recommendationAction),
    reportUrl: `/reports/${report.snapshotId}`,
    pdfUrl: `/api/reports/${report.snapshotId}/pdf`,
    brandedReportUrl: brandedBaseUrl ? `${brandedBaseUrl}/reports/${report.snapshotId}` : undefined,
    brandedPdfUrl: brandedBaseUrl ? `${brandedBaseUrl}/api/reports/${report.snapshotId}/pdf` : undefined,
    expiresAt
  };
}
function portalBusinessExplanationForAction(action: string, reason: string): string {
  const text = (action + " " + reason).toLowerCase();
  if (/primary cta|call to action|contact visibility|request a quote/.test(text)) return "Make it immediately clear how interested visitors can contact the business or request a quote.";
  if (/viewport|resource|mobile|speed|responsive/.test(text)) return "Make it easier for mobile visitors to understand the offer and reach the next step with less friction.";
  if (/trust|review|testimonial|proof|credib|guarantee|certif/.test(text)) return "Give visitors stronger reasons to trust the business before they compare alternatives.";
  if (/competitor|compare|comparison|alternative|versus/.test(text)) return "Close the information gap that may make competitors easier or safer to choose.";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "Answer the buying-stage questions that currently send potential customers elsewhere for information.";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "Help customers find the right pages and understand the business faster when searching for a solution.";
  return "Improve the customer decision path so visitors can understand the offer, trust the business, and act with less hesitation.";
}

function portalImplementationTimeForAction(action: string): string {
  const text = action.toLowerCase();
  if (/redesign|architecture|migration|checkout|booking/.test(text)) return "2-6 weeks";
  if (/schema|entity|citation|local|resource|speed|technical|render|responsive/.test(text)) return "1-2 weeks";
  return "1-3 business days";
}

function portalReadinessPhrase(score: number | null | undefined): string {
  if (typeof score !== "number") return "not yet assessed";
  if (score >= 75) return "strong";
  if (score >= 55) return "workable";
  return "constrained";
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

function cleanCurrency(value: unknown): string | undefined {
  const clean = cleanString(value)?.toUpperCase();
  return clean && /^[A-Z]{3}$/.test(clean) ? clean : undefined;
}

function cleanAgencyImplementationNotes(value: unknown): TenantBranding["agencyImplementationNotes"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notes: NonNullable<TenantBranding["agencyImplementationNotes"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const note = cleanString(record["note"]);
    if (!note) continue;
    notes.push({ recommendationId: cleanString(record["recommendationId"]), note });
    if (notes.length >= 50) break;
  }
  return notes;
}function cleanDomain(value: unknown): string | undefined {
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

function normalizeCustomerWebsiteUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new MembershipError("Website URL is required.", 400);
  const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : "https://" + candidate);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new MembershipError("Website URL must use HTTP or HTTPS.", 400);
  }
  parsed.hash = "";
  return parsed.toString();
}

function canonicalWebsiteKey(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase() + (parsed.pathname.replace(/\/$/, "") || "/");
  } catch {
    return value.trim().toLowerCase().replace(/\/$/, "");
  }
}

function defaultAgencyName(user: AuthUserProfile): string {
  const name = cleanString(user.displayName) ?? cleanString(user.givenName);
  return name ? name + "'s Agency" : "My Agency";
}

function defaultAgencySlug(user: AuthUserProfile): string {
  const seed = cleanString(user.displayName) ?? cleanString(user.givenName) ?? cleanString(user.email?.split("@")[0]) ?? "my-agency";
  const base = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "my-agency";
  return base + "-" + sha256(user.userId).slice(0, 8);
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
