import type { ReportSnapshot, TenantBranding } from "@systolab/shared";
import { AgencyAuditEvent, type AgencyAuditEventDocument } from "../models/AgencyAuditEvent.js";
import { AgencyOperatingProfile, type AgencyOperatingProfileDocument, type AgencyRecommendationStatus } from "../models/AgencyOperatingProfile.js";
import { ClientWorkspaceState, type ClientFollowUpStatus, type ClientWorkspaceStateDocument } from "../models/ClientWorkspaceState.js";
import { Snapshot } from "../models/Snapshot.js";
import { Tenant, tenantToBranding } from "../models/Tenant.js";
import { Workspace, type WorkspaceDocument } from "../models/Workspace.js";
import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { _memTenants, _memWorkspaces } from "./membershipService.js";
import { findSnapshotHistoryForTarget } from "./persistenceService.js";

export type AgencyTeamRole = "owner" | "admin" | "sales" | "seo_specialist" | "account_manager" | "viewer";

export interface AgencyOperatingSystem {
  tenantSlug: string;
  profile: AgencyProfile;
  serviceCatalog: ServiceCatalogItem[];
  proposalTemplates: ProposalTemplate[];
  knowledgeBase: AgencyKnowledgeBase;
  sharingDefaults: SharingControls;
  permissions: Array<{ role: AgencyTeamRole; permissions: string[] }>;
  clients: ClientOperatingSummary[];
  progress: AgencyProgressSummary;
  auditTrail: AgencyAuditSummary[];
  salesCoach: AgencySalesCoach;
}

export interface AgencyProfile {
  companyName: string;
  companyLogo?: string;
  brandColors: { primary: string; secondary?: string; accent: string };
  website?: string;
  contactEmail?: string;
  phoneNumber?: string;
  officeLocations: string[];
  teamMembers: Array<{ userId?: string; name: string; email?: string; role: AgencyTeamRole }>;
  defaultReportSettings: Record<string, unknown>;
  serviceOfferings: string[];
  specializedIndustries: string[];
}

export interface ServiceCatalogItem {
  serviceId: string;
  name: string;
  category: "seo" | "website" | "branding" | "ppc" | "cro" | "local_seo" | "ai_search" | "other";
  description?: string;
  pricingModel?: string;
  startingPrice?: string;
  active: boolean;
}

export interface ProposalTemplate {
  templateId: string;
  name: string;
  sections: string[];
  pricingStructure?: string;
  defaultTimeline?: string;
  isDefault: boolean;
  active: boolean;
}

export interface AgencyKnowledgeBase {
  caseStudies: string[];
  pricing: string[];
  serviceDescriptions: string[];
  guarantees: string[];
  methodologies: string[];
  faqs: string[];
  brandVoice?: string;
  proposalTemplateNotes: string[];
}

export interface SharingControls {
  allowView: boolean;
  allowDownload: boolean;
  allowPrint: boolean;
  allowShare: boolean;
  passwordProtected: boolean;
  passwordHint?: string;
  accessExpiresAt?: string;
}

export interface ClientOperatingSummary {
  workspaceId: string;
  clientName: string;
  targetUrl: string;
  assignedConsultant?: string;
  followUpStatus: ClientFollowUpStatus;
  renewalReminderAt?: string;
  notes: Array<{ noteId: string; body: string; createdBy?: string; createdAt: string }>;
  competitors: string[];
  scanHistory: Array<{ snapshotId: string; capturedAt: string; oss: number | null; visualStateLabel: string }>;
  firstScan?: { snapshotId: string; capturedAt: string; oss: number | null };
  latestScan?: { snapshotId: string; capturedAt: string; oss: number | null };
  scoreDelta: number | null;
  completedRecommendations: number;
  remainingPriorities: number;
  recommendationStatuses: Array<{ recommendationId: string; status: AgencyRecommendationStatus; note?: string; updatedBy?: string; updatedAt: string }>;
  sharingControls: SharingControls;
}

export interface AgencyProgressSummary {
  clientsTracked: number;
  reportsGenerated: number;
  improvedClients: number;
  averageScoreDelta: number | null;
  completedRecommendations: number;
  remainingPriorities: number;
}

export interface AgencyAuditSummary {
  eventId: string;
  action: string;
  workspaceId?: string;
  actorUserId?: string;
  summary: string;
  createdAt: string;
}

export interface AgencySalesCoach {
  status: "ready" | "limited";
  summary: string;
  easiestServicesToSell: string[];
  estimatedImplementationEffort: "Low" | "Medium" | "High" | "Mixed";
  likelyClientObjections: string[];
  suggestedResponses: string[];
  crossSellOpportunities: string[];
  upsellOpportunities: string[];
  suggestedMeetingAgenda: string[];
  followUpSequence: string[];
  clientPlaybooks: Array<{
    workspaceId: string;
    clientName: string;
    reportStatus: string;
    servicesToPitch: string[];
    estimatedEffort: "Low" | "Medium" | "High";
    primaryObjection: string;
    suggestedResponse: string;
    nextMeetingFocus: string;
  }>;
}

export interface GeneratedAgencyProposal {
  proposalId: string;
  workspaceId: string;
  clientName: string;
  templateName: string;
  recommendedServices: string[];
  sections: Array<{ title: string; body: string }>;
  generatedAt: string;
}

export class AgencyOperatingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const memoryOperatingProfiles = new Map<string, AgencyOperatingProfileDocument>();
const memoryClientStates = new Map<string, ClientWorkspaceStateDocument>();
const memoryAgencyAudit = new Map<string, AgencyAuditEventDocument>();

export async function getAgencyOperatingSystem(tenantSlug: string): Promise<AgencyOperatingSystem> {
  const [branding, operating, workspaces, auditTrail] = await Promise.all([
    getTenantBranding(tenantSlug),
    getOrCreateOperatingProfile(tenantSlug),
    listTenantWorkspaces(tenantSlug),
    listAuditEvents(tenantSlug)
  ]);
  const profile = buildAgencyProfile(tenantSlug, branding, operating);
  const serviceCatalog = cleanServiceCatalog(operating.serviceCatalog, branding?.serviceOfferings ?? []);
  const clients = await Promise.all(workspaces.map((workspace) => buildClientOperatingSummary(tenantSlug, workspace, operating.sharingDefaults as Partial<SharingControls>)));
  const salesCoach = await buildAgencySalesCoach(tenantSlug, workspaces, serviceCatalog, cleanKnowledgeBase(operating.knowledgeBase));
  return {
    tenantSlug,
    profile,
    serviceCatalog,
    proposalTemplates: cleanProposalTemplates(operating.proposalTemplates),
    knowledgeBase: cleanKnowledgeBase(operating.knowledgeBase),
    sharingDefaults: normalizeSharingControls(operating.sharingDefaults as Partial<SharingControls>),
    permissions: agencyPermissionMatrix(),
    clients,
    progress: summarizeAgencyProgress(clients),
    auditTrail,
    salesCoach
  };
}

export async function updateAgencyProfile(tenantSlug: string, actorUserId: string | undefined, profile: Partial<AgencyProfile>): Promise<AgencyOperatingSystem> {
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  operating.profile = {
    ...(operating.profile ?? {}),
    officeLocations: normalizeTextList(profile.officeLocations),
    teamMembers: normalizeTeamMembers(profile.teamMembers),
    defaultReportSettings: sanitizeRecord(profile.defaultReportSettings),
    specializedIndustries: normalizeTextList(profile.specializedIndustries)
  };
  await saveOperatingProfile(operating);
  await recordAgencyAudit(tenantSlug, actorUserId, "agency_profile.updated", "Agency profile settings updated.", { fields: Object.keys(profile) });
  return getAgencyOperatingSystem(tenantSlug);
}

export async function updateServiceCatalog(tenantSlug: string, actorUserId: string | undefined, items: unknown): Promise<AgencyOperatingSystem> {
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  operating.serviceCatalog = cleanServiceCatalog(Array.isArray(items) ? items : [], []).map((item) => ({ ...item, serviceId: item.serviceId || makeId("svc") }));
  await saveOperatingProfile(operating);
  await recordAgencyAudit(tenantSlug, actorUserId, "service_catalog.updated", "Agency service catalog updated.", { count: operating.serviceCatalog.length });
  return getAgencyOperatingSystem(tenantSlug);
}

export async function updateProposalTemplates(tenantSlug: string, actorUserId: string | undefined, templates: unknown): Promise<AgencyOperatingSystem> {
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  operating.proposalTemplates = cleanProposalTemplates(Array.isArray(templates) ? templates : []).map((template) => ({ ...template, templateId: template.templateId || makeId("tpl") }));
  await saveOperatingProfile(operating);
  await recordAgencyAudit(tenantSlug, actorUserId, "proposal_template.updated", "Agency proposal templates updated.", { count: operating.proposalTemplates.length });
  return getAgencyOperatingSystem(tenantSlug);
}

export async function updateAgencyKnowledgeBase(tenantSlug: string, actorUserId: string | undefined, knowledgeBase: unknown): Promise<AgencyOperatingSystem> {
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  operating.knowledgeBase = cleanKnowledgeBase(knowledgeBase) as unknown;
  await saveOperatingProfile(operating);
  await recordAgencyAudit(tenantSlug, actorUserId, "knowledge_base.updated", "Agency knowledge base updated.", {});
  return getAgencyOperatingSystem(tenantSlug);
}

export async function updateClientWorkspaceState(
  tenantSlug: string,
  workspaceId: string,
  actorUserId: string | undefined,
  updates: {
    assignedConsultantUserId?: string;
    assignedConsultantName?: string;
    followUpStatus?: ClientFollowUpStatus;
    renewalReminderAt?: string;
    note?: string;
    sharingControls?: Partial<SharingControls>;
  }
): Promise<ClientOperatingSummary> {
  const workspace = await getWorkspaceForTenant(tenantSlug, workspaceId);
  if (!workspace) throw new AgencyOperatingError("Workspace not found.", 404);
  const state = await getOrCreateClientState(tenantSlug, workspaceId);
  if (updates.assignedConsultantUserId !== undefined) state.assignedConsultantUserId = cleanString(updates.assignedConsultantUserId);
  if (updates.assignedConsultantName !== undefined) state.assignedConsultantName = cleanString(updates.assignedConsultantName);
  if (updates.followUpStatus && ["new", "contacted", "proposal_sent", "won", "lost", "on_hold"].includes(updates.followUpStatus)) state.followUpStatus = updates.followUpStatus;
  if (updates.renewalReminderAt !== undefined) {
    const reminder = new Date(updates.renewalReminderAt);
    state.renewalReminderAt = Number.isNaN(reminder.getTime()) ? undefined : reminder;
  }
  if (updates.note?.trim()) {
    state.notes.push({ noteId: makeId("note"), body: updates.note.trim(), createdBy: actorUserId, createdAt: new Date() });
  }
  if (updates.sharingControls) state.sharingControls = normalizeSharingControls({ ...state.sharingControls, ...updates.sharingControls }) as ClientWorkspaceStateDocument["sharingControls"];
  await saveClientState(state);
  await recordAgencyAudit(tenantSlug, actorUserId, "client_state.updated", "Client workspace state updated.", { workspaceId }, workspaceId);
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  return buildClientOperatingSummary(tenantSlug, workspace, operating.sharingDefaults as Partial<SharingControls>);
}

export async function updateRecommendationStatus(
  tenantSlug: string,
  workspaceId: string,
  actorUserId: string | undefined,
  recommendationId: string,
  status: AgencyRecommendationStatus,
  note?: string
): Promise<ClientOperatingSummary> {
  const workspace = await getWorkspaceForTenant(tenantSlug, workspaceId);
  if (!workspace) throw new AgencyOperatingError("Workspace not found.", 404);
  if (!["not_started", "in_progress", "completed", "not_applicable", "waiting_for_client"].includes(status)) throw new AgencyOperatingError("Invalid recommendation status.", 400);
  const state = await getOrCreateClientState(tenantSlug, workspaceId);
  const existing = state.recommendationStatuses.find((item) => item.recommendationId === recommendationId);
  if (existing) {
    existing.status = status;
    existing.note = cleanString(note);
    existing.updatedBy = actorUserId;
    existing.updatedAt = new Date();
  } else {
    state.recommendationStatuses.push({ recommendationId, status, note: cleanString(note), updatedBy: actorUserId, updatedAt: new Date() });
  }
  await saveClientState(state);
  await recordAgencyAudit(tenantSlug, actorUserId, "recommendation_status.updated", `Recommendation ${recommendationId} marked ${status}.`, { recommendationId, status }, workspaceId);
  const operating = await getOrCreateOperatingProfile(tenantSlug);
  return buildClientOperatingSummary(tenantSlug, workspace, operating.sharingDefaults as Partial<SharingControls>);
}

export async function generateAgencyProposal(tenantSlug: string, workspaceId: string, actorUserId?: string, templateId?: string): Promise<GeneratedAgencyProposal> {
  const [operating, workspace] = await Promise.all([getOrCreateOperatingProfile(tenantSlug), getWorkspaceForTenant(tenantSlug, workspaceId)]);
  if (!workspace) throw new AgencyOperatingError("Workspace not found.", 404);
  const reports = await findSnapshotHistoryForTarget(workspace.targetUrl, tenantSlug, 5);
  const latest = reports[0];
  const templates = cleanProposalTemplates(operating.proposalTemplates);
  const template = templates.find((item) => item.templateId === templateId) ?? templates.find((item) => item.isDefault) ?? defaultProposalTemplates()[0]!;
  const serviceCatalog = cleanServiceCatalog(operating.serviceCatalog, []);
  const recommendedServices = matchServicesToReport(latest, serviceCatalog);
  const clientName = workspace.clientCompanyName ?? workspace.projectName ?? safeHost(workspace.targetUrl);
  const sections = template.sections.map((title) => ({
    title,
    body: proposalSectionBody(title, latest, recommendedServices, cleanKnowledgeBase(operating.knowledgeBase), template)
  }));
  const proposal = { proposalId: makeId("prop"), workspaceId, clientName, templateName: template.name, recommendedServices, sections, generatedAt: new Date().toISOString() };
  await recordAgencyAudit(tenantSlug, actorUserId, "proposal.generated", `Proposal generated for ${clientName}.`, { proposalId: proposal.proposalId, templateId: template.templateId }, workspaceId);
  return proposal;
}

async function buildAgencySalesCoach(tenantSlug: string, workspaces: WorkspaceDocument[], services: ServiceCatalogItem[], knowledge: AgencyKnowledgeBase): Promise<AgencySalesCoach> {
  const playbooks = await Promise.all(workspaces.slice(0, 20).map(async (workspace) => {
    const latest = (await findSnapshotHistoryForTarget(workspace.targetUrl, tenantSlug, 1))[0];
    const servicesToPitch = matchServicesToReport(latest, services);
    const clientName = workspace.clientCompanyName ?? workspace.projectName ?? safeHost(workspace.targetUrl);
    const estimatedEffort = effortForReport(latest);
    return {
      workspaceId: workspace.workspaceId,
      clientName,
      reportStatus: latest ? latest.oss?.visualState?.label ?? latest.status : "No report yet",
      servicesToPitch,
      estimatedEffort,
      primaryObjection: objectionForReport(latest),
      suggestedResponse: responseForReport(latest, knowledge),
      nextMeetingFocus: meetingFocusForReport(latest, servicesToPitch)
    };
  }));
  const serviceNames = dedupeStrings(playbooks.flatMap((playbook) => playbook.servicesToPitch)).slice(0, 6);
  const efforts = playbooks.map((playbook) => playbook.estimatedEffort);
  const estimatedImplementationEffort = efforts.length === 0 ? "Medium" : efforts.every((effort) => effort === efforts[0]) ? efforts[0]! : "Mixed";
  const hasReports = playbooks.some((playbook) => playbook.reportStatus !== "No report yet");
  return {
    status: hasReports ? "ready" : "limited",
    summary: hasReports
      ? "Private agency-only coaching generated from latest client reports, service catalog, and agency knowledge base. This is never shown in customer reports."
      : "Create client reports to unlock private sales coaching for each opportunity.",
    easiestServicesToSell: serviceNames.length ? serviceNames : services.filter((service) => service.active).slice(0, 4).map((service) => service.name),
    estimatedImplementationEffort,
    likelyClientObjections: dedupeStrings(playbooks.map((playbook) => playbook.primaryObjection)).slice(0, 5),
    suggestedResponses: dedupeStrings(playbooks.map((playbook) => playbook.suggestedResponse)).slice(0, 5),
    crossSellOpportunities: buildCrossSellOpportunities(serviceNames, services),
    upsellOpportunities: buildUpsellOpportunities(serviceNames, knowledge),
    suggestedMeetingAgenda: [
      "Open with the business outcome the client cares about most.",
      "Review the 90-day blueprint and agree on Week 1 priorities.",
      "Show which findings are evidence-backed and which are intentionally not estimated.",
      "Confirm implementation owner, timeline, budget range, and re-scan date."
    ],
    followUpSequence: [
      "Same day: send the report, 90-day blueprint, and meeting recap.",
      "Day 2: share the top three easiest wins and implementation effort.",
      "Day 5: address objections with proof from the report and proposed scope.",
      "Day 10: offer a re-scan milestone and progress-tracking plan."
    ],
    clientPlaybooks: playbooks
  };
}

function effortForReport(report: ReportSnapshot | undefined): "Low" | "Medium" | "High" {
  const text = report?.recommendationEngine?.recommendations?.slice(0, 5).map((item) => item.action).join(" ").toLowerCase() ?? "";
  if (/redesign|architecture|migration|checkout|booking|render|schema|entity|technical|resource|speed/.test(text)) return "High";
  if (/local|citation|faq|content|internal link|mobile|trust|review|testimonial/.test(text)) return "Medium";
  return "Low";
}

function objectionForReport(report: ReportSnapshot | undefined): string {
  if (!report) return "The client may ask why they should act before seeing report evidence.";
  const confidence = report.confidenceEngine?.overallConfidenceScore ?? 0;
  const score = report.oss?.score;
  if (typeof score === "number" && score >= 75) return "The client may think the website is already good enough because the score looks healthy.";
  if (confidence < 60) return "The client may question the recommendation because evidence coverage or confidence is limited.";
  if ((report.recommendationEngine?.recommendations ?? []).some((item) => /price|pricing|cost/i.test(item.action))) return "The client may worry that adding pricing guidance will reduce enquiries.";
  return "The client may ask whether the recommended work will create measurable business improvement.";
}

function responseForReport(report: ReportSnapshot | undefined, knowledge: AgencyKnowledgeBase): string {
  const method = knowledge.methodologies[0] ?? "Use an evidence-first implementation, re-scan, and progress review cycle.";
  if (!report) return `${method} Start with a baseline report so scope is tied to visible evidence.`;
  const topAction = report.recommendationEngine?.recommendations?.[0]?.action ?? report.decisionIntelligenceBrief?.executiveDecisionMatrix?.recommendedNextAction ?? "the highest-confidence recommendation";
  return `${method} Position ${topAction} as the first measurable step, then validate the change with the next scan.`;
}

function meetingFocusForReport(report: ReportSnapshot | undefined, services: string[]): string {
  if (!report) return "Create the first report and identify evidence-backed priorities.";
  const primary = report.decisionIntelligenceBrief?.executiveDecisionMatrix?.primaryBusinessConstraint ?? report.businessRiskStatus?.primaryRiskDriver ?? "the strongest validated constraint";
  return `Discuss ${primary}, confirm the first service to implement (${services[0] ?? "implementation support"}), and set a re-scan milestone.`;
}

function buildCrossSellOpportunities(serviceNames: string[], services: ServiceCatalogItem[]): string[] {
  const names = serviceNames.join(" ").toLowerCase();
  const opportunities = [
    names.includes("seo") ? "Pair SEO with conversion improvements so new visitors have a clearer path to enquire." : "Add SEO or local visibility after website friction is reduced.",
    names.includes("website") || names.includes("cro") ? "Add trust proof, testimonials, and case-study content to support conversion work." : "Offer CRO or landing-page improvements for high-intent pages.",
    names.includes("local") ? "Add review, citation, and service-area improvements after local visibility work starts." : "Add local SEO for clients with city, service-area, or GBP signals."
  ];
  return dedupeStrings([...opportunities, ...services.filter((service) => service.active).slice(0, 2).map((service) => `Package ${service.name} with progress tracking and monthly re-scans.`)]).slice(0, 6);
}

function buildUpsellOpportunities(serviceNames: string[], knowledge: AgencyKnowledgeBase): string[] {
  return dedupeStrings([
    "Convert the report into a 90-day implementation retainer with progress tracking.",
    "Offer monthly re-scans and completed-recommendation validation.",
    "Add competitor monitoring once Week 1 and Weeks 2-4 priorities are complete.",
    ...(knowledge.caseStudies.length ? ["Use agency case studies as proof during proposal follow-up."] : []),
    ...(serviceNames.length ? [`Bundle ${serviceNames.slice(0, 3).join(", ")} into one phased growth package.`] : [])
  ]).slice(0, 6);
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
async function getTenantBranding(tenantSlug: string): Promise<TenantBranding | undefined> {
  if (!isMongoConnected()) {
    const tenant = _memTenants.get(tenantSlug);
    return tenant ? tenantToBranding(tenant) : undefined;
  }
  const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
  return tenant ? tenantToBranding(tenant) : undefined;
}

async function getOrCreateOperatingProfile(tenantSlug: string): Promise<AgencyOperatingProfileDocument> {
  if (!isMongoConnected()) {
    const existing = memoryOperatingProfiles.get(tenantSlug);
    if (existing) return existing;
    const created = makeOperatingProfileDoc(tenantSlug);
    memoryOperatingProfiles.set(tenantSlug, created);
    return created;
  }
  const existing = await AgencyOperatingProfile.findOne({ tenantSlug });
  if (existing) return existing;
  return AgencyOperatingProfile.create(defaultOperatingProfile(tenantSlug));
}

function makeOperatingProfileDoc(tenantSlug: string): AgencyOperatingProfileDocument {
  const now = new Date();
  return {
    ...defaultOperatingProfile(tenantSlug),
    createdAt: now,
    updatedAt: now,
    save: async function (this: AgencyOperatingProfileDocument) {
      this.updatedAt = new Date();
      memoryOperatingProfiles.set(tenantSlug, this as unknown as AgencyOperatingProfileDocument);
      return this as unknown as AgencyOperatingProfileDocument;
    }
  } as unknown as AgencyOperatingProfileDocument;
}

function defaultOperatingProfile(tenantSlug: string): Pick<AgencyOperatingProfileDocument, "tenantSlug" | "profile" | "serviceCatalog" | "proposalTemplates" | "knowledgeBase" | "sharingDefaults"> {
  return {
    tenantSlug,
    profile: { officeLocations: [], teamMembers: [], specializedIndustries: [], defaultReportSettings: {} },
    serviceCatalog: defaultServiceCatalog(),
    proposalTemplates: defaultProposalTemplates(),
    knowledgeBase: defaultKnowledgeBase(),
    sharingDefaults: defaultSharingControls()
  };
}

async function saveOperatingProfile(profile: AgencyOperatingProfileDocument): Promise<void> {
  if (!isMongoConnected()) {
    memoryOperatingProfiles.set(profile.tenantSlug, profile);
    return;
  }
  await profile.save();
}

async function listTenantWorkspaces(tenantSlug: string): Promise<WorkspaceDocument[]> {
  if (!isMongoConnected()) {
    return [..._memWorkspaces.values()].filter((workspace) => workspace.tenantSlug === tenantSlug);
  }
  return Workspace.find({ tenantSlug }).sort({ updatedAt: -1 });
}

async function getWorkspaceForTenant(tenantSlug: string, workspaceId: string): Promise<WorkspaceDocument | null> {
  if (!isMongoConnected()) {
    const workspace = _memWorkspaces.get(workspaceId) ?? null;
    return workspace?.tenantSlug === tenantSlug ? workspace : null;
  }
  return Workspace.findOne({ tenantSlug, workspaceId });
}

async function getOrCreateClientState(tenantSlug: string, workspaceId: string): Promise<ClientWorkspaceStateDocument> {
  if (!isMongoConnected()) {
    const existing = memoryClientStates.get(workspaceId);
    if (existing) return existing;
    const created = makeClientStateDoc(tenantSlug, workspaceId);
    memoryClientStates.set(workspaceId, created);
    return created;
  }
  const existing = await ClientWorkspaceState.findOne({ tenantSlug, workspaceId });
  if (existing) return existing;
  return ClientWorkspaceState.create({ tenantSlug, workspaceId, sharingControls: defaultSharingControls() });
}

function makeClientStateDoc(tenantSlug: string, workspaceId: string): ClientWorkspaceStateDocument {
  const now = new Date();
  return {
    tenantSlug,
    workspaceId,
    followUpStatus: "new",
    notes: [],
    recommendationStatuses: [],
    sharingControls: defaultSharingControls(),
    createdAt: now,
    updatedAt: now,
    save: async function (this: ClientWorkspaceStateDocument) {
      this.updatedAt = new Date();
      memoryClientStates.set(workspaceId, this as unknown as ClientWorkspaceStateDocument);
      return this as unknown as ClientWorkspaceStateDocument;
    }
  } as unknown as ClientWorkspaceStateDocument;
}

async function saveClientState(state: ClientWorkspaceStateDocument): Promise<void> {
  if (!isMongoConnected()) {
    memoryClientStates.set(state.workspaceId, state);
    return;
  }
  await state.save();
}

async function buildClientOperatingSummary(tenantSlug: string, workspace: WorkspaceDocument, sharingDefaults: Partial<SharingControls>): Promise<ClientOperatingSummary> {
  const [state, reports] = await Promise.all([
    getOrCreateClientState(tenantSlug, workspace.workspaceId),
    findSnapshotHistoryForTarget(workspace.targetUrl, tenantSlug, 24)
  ]);
  const scanHistory = reports.map((report) => ({
    snapshotId: report.snapshotId,
    capturedAt: report.createdAt,
    oss: report.oss?.score ?? null,
    visualStateLabel: report.oss?.visualState?.label ?? "Not Scored"
  }));
  const chronological = [...scanHistory].reverse();
  const firstScan = chronological[0] ? { snapshotId: chronological[0].snapshotId, capturedAt: chronological[0].capturedAt, oss: chronological[0].oss } : undefined;
  const latestScan = scanHistory[0] ? { snapshotId: scanHistory[0].snapshotId, capturedAt: scanHistory[0].capturedAt, oss: scanHistory[0].oss } : undefined;
  const scoreDelta = typeof firstScan?.oss === "number" && typeof latestScan?.oss === "number" ? latestScan.oss - firstScan.oss : null;
  const latestRecommendations = reports[0]?.recommendationEngine?.recommendations ?? [];
  const completedRecommendations = state.recommendationStatuses.filter((item) => item.status === "completed").length;
  const remainingPriorities = Math.max(0, latestRecommendations.length - completedRecommendations);
  return {
    workspaceId: workspace.workspaceId,
    clientName: workspace.clientCompanyName ?? workspace.projectName ?? safeHost(workspace.targetUrl),
    targetUrl: workspace.targetUrl,
    assignedConsultant: state.assignedConsultantName,
    followUpStatus: state.followUpStatus,
    renewalReminderAt: state.renewalReminderAt?.toISOString(),
    notes: state.notes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
    competitors: workspace.competitorUrls ?? [],
    scanHistory,
    firstScan,
    latestScan,
    scoreDelta,
    completedRecommendations,
    remainingPriorities,
    recommendationStatuses: state.recommendationStatuses.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    sharingControls: normalizeSharingControls({ ...sharingDefaults, ...state.sharingControls })
  };
}

function summarizeAgencyProgress(clients: ClientOperatingSummary[]): AgencyProgressSummary {
  const deltas = clients.map((client) => client.scoreDelta).filter((delta): delta is number => typeof delta === "number");
  return {
    clientsTracked: clients.length,
    reportsGenerated: clients.reduce((sum, client) => sum + client.scanHistory.length, 0),
    improvedClients: deltas.filter((delta) => delta > 0).length,
    averageScoreDelta: deltas.length ? Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length) : null,
    completedRecommendations: clients.reduce((sum, client) => sum + client.completedRecommendations, 0),
    remainingPriorities: clients.reduce((sum, client) => sum + client.remainingPriorities, 0)
  };
}

async function listAuditEvents(tenantSlug: string): Promise<AgencyAuditSummary[]> {
  if (!isMongoConnected()) {
    return [...memoryAgencyAudit.values()]
      .filter((event) => event.tenantSlug === tenantSlug)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map(auditSummary);
  }
  const events = await AgencyAuditEvent.find({ tenantSlug }).sort({ createdAt: -1 }).limit(50);
  return events.map(auditSummary);
}

async function recordAgencyAudit(
  tenantSlug: string,
  actorUserId: string | undefined,
  action: AgencyAuditEventDocument["action"],
  summary: string,
  metadata: Record<string, unknown>,
  workspaceId?: string
): Promise<void> {
  const eventId = makeId("aaud");
  const data = { eventId, tenantSlug, workspaceId, actorUserId, action, summary, metadata, createdAt: new Date() };
  if (!isMongoConnected()) {
    memoryAgencyAudit.set(eventId, data as unknown as AgencyAuditEventDocument);
    return;
  }
  await AgencyAuditEvent.create(data);
}

function auditSummary(event: AgencyAuditEventDocument): AgencyAuditSummary {
  return {
    eventId: event.eventId,
    action: event.action,
    workspaceId: event.workspaceId,
    actorUserId: event.actorUserId,
    summary: event.summary,
    createdAt: event.createdAt.toISOString()
  };
}

function buildAgencyProfile(tenantSlug: string, branding: TenantBranding | undefined, operating: AgencyOperatingProfileDocument): AgencyProfile {
  const profile = sanitizeRecord(operating.profile) as Partial<AgencyProfile>;
  return {
    companyName: branding?.publicName ?? tenantSlug,
    companyLogo: branding?.logoUrl,
    brandColors: { primary: branding?.primaryColor ?? "#246b5b", secondary: branding?.secondaryColor, accent: branding?.accentColor ?? "#c27a2c" },
    website: branding?.websiteUrl,
    contactEmail: branding?.supportEmail ?? branding?.consultantEmail,
    phoneNumber: branding?.phoneNumber,
    officeLocations: normalizeTextList(profile.officeLocations),
    teamMembers: normalizeTeamMembers(profile.teamMembers),
    defaultReportSettings: sanitizeRecord(profile.defaultReportSettings),
    serviceOfferings: branding?.serviceOfferings?.length ? branding.serviceOfferings : defaultServiceCatalog().map((item) => item.name),
    specializedIndustries: normalizeTextList(profile.specializedIndustries)
  };
}

function agencyPermissionMatrix(): AgencyOperatingSystem["permissions"] {
  return [
    { role: "owner", permissions: ["manage_profile", "manage_services", "manage_templates", "manage_team", "manage_clients", "generate_reports", "update_recommendations", "manage_sharing", "view_audit"] },
    { role: "admin", permissions: ["manage_profile", "manage_services", "manage_templates", "manage_clients", "generate_reports", "update_recommendations", "manage_sharing", "view_audit"] },
    { role: "sales", permissions: ["view_clients", "generate_proposals", "update_follow_up", "view_reports"] },
    { role: "seo_specialist", permissions: ["view_clients", "generate_reports", "update_recommendations", "view_reports"] },
    { role: "account_manager", permissions: ["view_clients", "update_follow_up", "update_recommendations", "manage_sharing", "view_reports"] },
    { role: "viewer", permissions: ["view_clients", "view_reports"] }
  ];
}

function cleanServiceCatalog(value: unknown, fallbackServices: string[]): ServiceCatalogItem[] {
  const source = Array.isArray(value) && value.length ? value : fallbackServices.map((name) => ({ name }));
  return source
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      serviceId: cleanString(item["serviceId"]) ?? makeId("svc"),
      name: cleanString(item["name"]) ?? "Service",
      category: cleanServiceCategory(item["category"]),
      description: cleanString(item["description"]),
      pricingModel: cleanString(item["pricingModel"]),
      startingPrice: cleanString(item["startingPrice"]),
      active: item["active"] === undefined ? true : Boolean(item["active"])
    }))
    .filter((item) => item.name !== "Service" || item.description)
    .slice(0, 50);
}

function cleanProposalTemplates(value: unknown): ProposalTemplate[] {
  const source = Array.isArray(value) && value.length ? value : defaultProposalTemplates();
  return source
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      templateId: cleanString(item["templateId"]) ?? makeId("tpl"),
      name: cleanString(item["name"]) ?? `Proposal Template ${index + 1}`,
      sections: normalizeTextList(item["sections"]).length ? normalizeTextList(item["sections"]) : ["Problems Found", "Recommended Services", "Timeline", "Investment", "Next Steps"],
      pricingStructure: cleanString(item["pricingStructure"]),
      defaultTimeline: cleanString(item["defaultTimeline"]),
      isDefault: item["isDefault"] === undefined ? index === 0 : Boolean(item["isDefault"]),
      active: item["active"] === undefined ? true : Boolean(item["active"])
    }))
    .slice(0, 20);
}

function cleanKnowledgeBase(value: unknown): AgencyKnowledgeBase {
  const record = sanitizeRecord(value);
  return {
    caseStudies: normalizeTextList(record["caseStudies"]),
    pricing: normalizeTextList(record["pricing"]),
    serviceDescriptions: normalizeTextList(record["serviceDescriptions"]),
    guarantees: normalizeTextList(record["guarantees"]),
    methodologies: normalizeTextList(record["methodologies"]),
    faqs: normalizeTextList(record["faqs"]),
    brandVoice: cleanString(record["brandVoice"]),
    proposalTemplateNotes: normalizeTextList(record["proposalTemplateNotes"])
  };
}

function normalizeSharingControls(value: (Partial<Omit<SharingControls, "accessExpiresAt">> & { accessExpiresAt?: string | Date }) | undefined): SharingControls {
  const expires = cleanString(value?.accessExpiresAt);
  return {
    allowView: value?.allowView ?? true,
    allowDownload: value?.allowDownload ?? true,
    allowPrint: value?.allowPrint ?? true,
    allowShare: value?.allowShare ?? false,
    passwordProtected: value?.passwordProtected ?? false,
    passwordHint: cleanString(value?.passwordHint),
    accessExpiresAt: expires && !Number.isNaN(new Date(expires).getTime()) ? new Date(expires).toISOString() : undefined
  };
}

function normalizeTeamMembers(value: unknown): AgencyProfile["teamMembers"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      userId: cleanString(item["userId"]),
      name: cleanString(item["name"]) ?? "Team member",
      email: cleanString(item["email"]),
      role: cleanAgencyRole(item["role"])
    }))
    .slice(0, 100);
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function cleanAgencyRole(value: unknown): AgencyTeamRole {
  return value === "owner" || value === "admin" || value === "sales" || value === "seo_specialist" || value === "account_manager" || value === "viewer" ? value : "viewer";
}

function cleanServiceCategory(value: unknown): ServiceCatalogItem["category"] {
  return value === "seo" || value === "website" || value === "branding" || value === "ppc" || value === "cro" || value === "local_seo" || value === "ai_search" || value === "other" ? value : "other";
}

function defaultSharingControls(): SharingControls {
  return { allowView: true, allowDownload: true, allowPrint: true, allowShare: false, passwordProtected: false };
}

function defaultKnowledgeBase(): AgencyKnowledgeBase {
  return { caseStudies: [], pricing: [], serviceDescriptions: [], guarantees: [], methodologies: [], faqs: [], proposalTemplateNotes: [] };
}

function defaultServiceCatalog(): ServiceCatalogItem[] {
  return [
    { serviceId: "svc_seo", name: "SEO", category: "seo", active: true },
    { serviceId: "svc_web", name: "Website Development", category: "website", active: true },
    { serviceId: "svc_cro", name: "CRO", category: "cro", active: true },
    { serviceId: "svc_local", name: "Local SEO", category: "local_seo", active: true },
    { serviceId: "svc_ai_search", name: "AI Search Optimization", category: "ai_search", active: true }
  ];
}

function defaultProposalTemplates(): ProposalTemplate[] {
  return [
    {
      templateId: "tpl_growth",
      name: "Growth Proposal",
      sections: ["Problems Found", "Recommended Services", "Timeline", "Investment", "Expected Business Support", "Next Steps"],
      pricingStructure: "Use configured service catalog pricing.",
      defaultTimeline: "2-4 weeks",
      isDefault: true,
      active: true
    }
  ];
}

function matchServicesToReport(report: ReportSnapshot | undefined, services: ServiceCatalogItem[]): string[] {
  const text = [
    report?.recommendationEngine?.recommendations?.map((item) => `${item.issue} ${item.action}`).join(" "),
    report?.decisionIntelligenceBrief?.executiveDecisionMatrix?.recommendedNextAction
  ].filter(Boolean).join(" ").toLowerCase();
  const matched = services.filter((service) => {
    const haystack = `${service.name} ${service.category} ${service.description ?? ""}`.toLowerCase();
    return text.includes(service.category) || haystack.split(/\s+/).some((word) => word.length > 4 && text.includes(word));
  });
  return (matched.length ? matched : services.filter((service) => service.active).slice(0, 3)).map((service) => service.name).slice(0, 6);
}

function proposalSectionBody(title: string, report: ReportSnapshot | undefined, services: string[], knowledge: AgencyKnowledgeBase, template: ProposalTemplate): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("problem")) return report?.recommendationEngine?.recommendations?.slice(0, 5).map((item) => item.issue).join("; ") || "No report recommendations are available yet.";
  if (normalized.includes("service")) return services.length ? services.join(", ") : "Use the agency service catalog to define recommended services.";
  if (normalized.includes("timeline")) return template.defaultTimeline || "Timeline should be confirmed after implementation scoping.";
  if (normalized.includes("investment") || normalized.includes("pricing")) return template.pricingStructure || knowledge.pricing.join("; ") || "Investment should be configured in the proposal template.";
  if (normalized.includes("next")) return report?.tenantBranding?.primaryCtaLabel || "Book a consultation to review scope and next steps.";
  if (normalized.includes("method")) return knowledge.methodologies.join("; ") || "Agency methodology can be added to the knowledge base.";
  return knowledge.proposalTemplateNotes.join("; ") || "This section is generated from the agency proposal template and current SYSTOLAB report evidence.";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}









