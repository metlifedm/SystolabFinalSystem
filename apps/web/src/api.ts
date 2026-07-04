import type {
  AiceDecisionObject,
  AuthResponse,
  AuthSessionSummary,
  AuthUserProfile,
  GoogleLoginRequest,
  LogoutInput,
  OtpChallengeResponse,
  OtpRequestInput,
  OtpVerifyInput,
  PasswordForgotInput,
  PasswordLoginInput,
  PasswordRegisterInput,
  PasswordResetChallengeResponse,
  PasswordResetInput,
  RefreshSessionInput,
  ReportSnapshot,
  ScanRequest,
  SpecCoverageItem,
  TenantBranding
} from "@systolab/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export type AdminRole = "owner" | "manager";

export interface AdminSession {
  token: string;
  role: AdminRole;
  email: string;
  adminUserId: string;
}

export interface AdminLoginResponse {
  token: string;
  adminUserId: string;
  email: string;
  role: AdminRole;
  sessionId: string;
  expiresIn: number;
}

export interface AdminAuthStatusResponse {
  ownerExists: boolean;
  setupRequired: boolean;
  storageMode: "memory" | "persistent";
}

export type PortalTenantRole = "owner" | "member" | "guest";
export type PortalWorkspaceRole = "owner" | "editor" | "viewer";

export interface PortalTenantSummary {
  tenantSlug: string;
  tenantId: string;
  role: PortalTenantRole;
  portalRole: "owner" | "agency_admin" | "team_member" | "client" | "viewer";
  permissions: string[];
  branding: TenantBranding;
}

export interface PortalProjectSummary {
  workspaceId: string;
  tenantSlug: string;
  role: PortalWorkspaceRole;
  projectName: string;
  targetUrl: string;
  businessType?: string;
  targetCountry?: string;
  targetLocation?: string;
  competitorUrls: string[];
  gbpUrl?: string;
  monitoringConfig: { cadence: "manual" | "daily" | "weekly" | "monthly"; enabled: boolean };
  clientAccessEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  latestReport?: PortalReportSummary;
}

export interface PortalReportSummary {
  snapshotId: string;
  createdAt: string;
  status: string;
  targetUrl: string;
  oss: number | null;
  visualStateLabel: string;
  businessRiskStatus: string;
  evidenceCoveragePercent: number;
  confidenceLabel: string;
  reportUrl: string;
  pdfUrl: string;
}

export interface PortalMeResponse {
  user: AuthUserProfile;
  tenants: PortalTenantSummary[];
  projects: PortalProjectSummary[];
}

export interface CreatePortalProjectInput {
  tenantSlug: string;
  targetUrl: string;
  projectName?: string;
  businessType?: string;
  targetCountry?: string;
  targetLocation?: string;
  competitorUrls?: string[];
  gbpUrl?: string;
  monitoringConfig?: { cadence?: "manual" | "daily" | "weekly" | "monthly"; enabled?: boolean };
  clientAccessEnabled?: boolean;
}

export interface PortalUsageOverview {
  tenantSlug: string;
  periodKey: string;
  limits: Record<string, number | boolean>;
  usage: Record<string, unknown> | null;
  history: Array<Record<string, unknown>>;
  scanLimit: { allowed: boolean; used: number; limit: number };
  apiCallLimit: { allowed: boolean; used: number; limit: number };
}

export interface PortalBillingPlan {
  planId: string;
  tier: string;
  name: string;
  description: string;
  priceCentsPerMonth: number;
  priceCentsPerYear?: number;
  limits: Record<string, number | boolean>;
  features: string[];
}
export interface CreateScanResponse {
  jobId: string;
  status: string;
  statusUrl: string;
  targetUrl: string;
  mode: string;
  queuedAt: string;
}

export interface ScanJobResponse {
  jobId: string;
  status: string;
  progress: { completedSteps?: number; totalSteps?: number; label?: string } | null;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  reportUrl?: string;
  startedAt: string | null;
  completedAt: string | null;
}

export async function createScan(request: ScanRequest): Promise<CreateScanResponse> {
  const response = await fetch(`${API_URL}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json", ...storedAuthHeader() },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getScanJob(jobId: string): Promise<ScanJobResponse> {
  const response = await fetch(`${API_URL}/api/scans/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    const error = new Error(await readError(response)) as Error & { status?: number; retryAfterMs?: number };
    error.status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }
  return response.json();
}

export async function getCustomerDecision(snapshotId: string): Promise<AiceDecisionObject> {
  if (!snapshotId || snapshotId === "undefined" || snapshotId === "null") {
    throw new Error("Invalid snapshot ID.");
  }
  const response = await fetch(`${API_URL}/api/reports/${snapshotId}/decision`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getReport(snapshotId: string): Promise<ReportSnapshot> {
  if (!snapshotId || snapshotId === "undefined" || snapshotId === "null") {
    throw new Error("Invalid snapshot ID.");
  }
  const response = await fetch(`${API_URL}/api/reports/${snapshotId}`, {
    headers: storedAuthHeader()
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export function pdfUrl(snapshotId: string): string {
  return `${API_URL}/api/reports/${encodeURIComponent(snapshotId)}/pdf`;
}

export async function downloadReportPdf(snapshotId: string): Promise<Blob> {
  if (!snapshotId || snapshotId === "undefined" || snapshotId === "null") {
    throw new Error("Invalid snapshot ID.");
  }
  const response = await fetch(`${API_URL}/api/reports/${encodeURIComponent(snapshotId)}/pdf`, {
    headers: storedAuthHeader()
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.blob();
}

export async function getSpecCoverage(): Promise<SpecCoverageItem[]> {
  const response = await fetch(`${API_URL}/api/coverage`);
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { items: SpecCoverageItem[] };
  return payload.items;
}

// ── Admin auth API ─────────────────────────────────────────────────────────────

export async function adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
  return postJson("/api/admin/auth/login", { email, password });
}
export async function adminAuthStatus(): Promise<AdminAuthStatusResponse> {
  const response = await fetch(`${API_URL}/api/admin/auth/status`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function adminLogout(token: string): Promise<{ message: string }> {
  const response = await fetch(`${API_URL}/api/admin/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function adminMe(token: string): Promise<{ adminUserId: string; email: string; role: AdminRole; sessionId: string }> {
  const response = await fetch(`${API_URL}/api/admin/auth/me`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function adminBootstrap(ownerKey: string, email: string, password: string): Promise<{ message: string; adminUserId: string; email: string; role: AdminRole }> {
  return postJson("/api/admin/auth/bootstrap", { ownerKey, email, password });
}

// ── Internal platform API (Bearer-token authenticated) ─────────────────────────

export async function internalPlatformGet<T>(path: string, session: AdminSession): Promise<T> {
  const response = await fetch(`${API_URL}/api/internal/platform${path}`, {
    headers: adminBearerHeaders(session)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function internalPlatformPost<T>(path: string, payload: unknown, session: AdminSession, options?: { destructive?: boolean }): Promise<T> {
  const response = await fetch(`${API_URL}/api/internal/platform${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...adminBearerHeaders(session, options?.destructive)
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function internalPlatformPatch<T>(path: string, payload: unknown, session: AdminSession): Promise<T> {
  const response = await fetch(`${API_URL}/api/internal/platform${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...adminBearerHeaders(session) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getInternalFullReport(snapshotId: string, session: AdminSession): Promise<ReportSnapshot> {
  if (!snapshotId || snapshotId === "undefined" || snapshotId === "null") {
    throw new Error("Invalid snapshot ID.");
  }
  return internalPlatformGet<ReportSnapshot>(`/reports/${encodeURIComponent(snapshotId)}/full`, session);
}

export async function downloadOperationsPdf(session: AdminSession): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/internal/platform/export.pdf`, {
    headers: adminBearerHeaders(session)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.blob();
}

export async function recordEditEvent(request: {
  workspaceId?: string;
  snapshotId?: string;
  sessionFingerprint?: string;
  eventType: "scan_started" | "scan_completed" | "report_viewed" | "report_downloaded" | "recommendation_viewed" | "rescan_started";
  metadata?: Record<string, unknown>;
}): Promise<{ eventId: string; sessionFingerprint: string; eventType: string; occurredAt: string }> {
  return postJson("/api/intelligence/edit/events", request);
}


export async function getPortalMe(): Promise<PortalMeResponse> {
  const response = await fetch(`${API_URL}/api/me`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function createTenant(slug: string, publicName: string): Promise<{ tenant: Record<string, unknown>; membership: Record<string, unknown> }> {
  return postJson("/api/tenants", { slug, publicName }, readStoredAccessToken());
}

export async function listProjects(tenantSlug?: string): Promise<{ items: PortalProjectSummary[] }> {
  const suffix = tenantSlug ? `?tenantSlug=${encodeURIComponent(tenantSlug)}` : "";
  const response = await fetch(`${API_URL}/api/projects${suffix}`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function createProject(request: CreatePortalProjectInput): Promise<{ project: PortalProjectSummary }> {
  return postJson("/api/projects", request, readStoredAccessToken());
}

export async function getProject(workspaceId: string): Promise<{ project: PortalProjectSummary }> {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(workspaceId)}`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function updateProject(workspaceId: string, request: Partial<CreatePortalProjectInput>): Promise<{ project: PortalProjectSummary }> {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(workspaceId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...storedAuthHeader() },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getProjectReports(workspaceId: string): Promise<{ items: PortalReportSummary[] }> {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(workspaceId)}/reports`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function runProjectScan(workspaceId: string, request: { mode?: "fast_scan" | "full_audit"; includeSeo?: boolean; competitorUrls?: string[]; gbpUrl?: string }): Promise<CreateScanResponse & { usage?: { used: number; limit: number; allowed: boolean } }> {
  return postJson(`/api/projects/${encodeURIComponent(workspaceId)}/scans`, request, readStoredAccessToken());
}

export async function getUsageOverview(tenantSlug: string): Promise<PortalUsageOverview> {
  const response = await fetch(`${API_URL}/api/usage?tenantSlug=${encodeURIComponent(tenantSlug)}`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getBillingPlans(): Promise<{ items: PortalBillingPlan[] }> {
  const response = await fetch(`${API_URL}/api/billing/plans`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getBillingOverview(tenantSlug: string): Promise<{ plans: PortalBillingPlan[]; subscription: Record<string, unknown> | null; usage: PortalUsageOverview }> {
  const response = await fetch(`${API_URL}/api/billing?tenantSlug=${encodeURIComponent(tenantSlug)}`, { headers: storedAuthHeader() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function resolveWhiteLabel(input: { slug?: string; domain?: string }): Promise<{ found: boolean; branding: TenantBranding }> {
  const params = new URLSearchParams();
  if (input.slug) params.set("slug", input.slug);
  if (input.domain) params.set("domain", input.domain);
  const response = await fetch(`${API_URL}/api/white-label/resolve?${params.toString()}`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function updateWhiteLabelBranding(tenantSlug: string, branding: Partial<TenantBranding>): Promise<{ branding: TenantBranding }> {
  const response = await fetch(`${API_URL}/api/white-label/${encodeURIComponent(tenantSlug)}/branding`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...storedAuthHeader() },
    body: JSON.stringify(branding)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
export async function googleAuth(request: GoogleLoginRequest): Promise<AuthResponse> {
  return postJson("/api/auth/google", request);
}

export async function requestOtp(request: OtpRequestInput): Promise<OtpChallengeResponse> {
  return postJson("/api/auth/otp/request", request);
}

export async function verifyOtp(request: OtpVerifyInput): Promise<AuthResponse> {
  return postJson("/api/auth/otp/verify", request);
}

export async function registerPassword(request: PasswordRegisterInput): Promise<AuthResponse & { otpChallenge: OtpChallengeResponse }> {
  return postJson("/api/auth/password/register", request);
}

export async function loginPassword(request: PasswordLoginInput): Promise<AuthResponse> {
  return postJson("/api/auth/password/login", request);
}

export async function forgotPassword(request: PasswordForgotInput): Promise<PasswordResetChallengeResponse> {
  return postJson("/api/auth/password/forgot", request);
}

export async function resetPassword(request: PasswordResetInput): Promise<AuthResponse> {
  return postJson("/api/auth/password/reset", request);
}

export async function refreshAuthSession(request: RefreshSessionInput): Promise<AuthResponse> {
  return postJson("/api/auth/refresh", request);
}

export async function logoutAuth(request: LogoutInput, accessToken: string): Promise<{ message: string }> {
  return postJson("/api/auth/logout", request, accessToken);
}

export async function getAuthSessions(accessToken: string): Promise<{ sessions: AuthSessionSummary[] }> {
  const response = await fetch(`${API_URL}/api/auth/sessions`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function revokeAuthSession(sessionId: string, accessToken: string): Promise<{ message: string }> {
  const response = await fetch(`${API_URL}/api/auth/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

async function postJson<T>(path: string, payload: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

function adminBearerHeaders(session: AdminSession, destructive = false): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  if (destructive) headers["x-confirm-destructive"] = "true";
  return headers;
}


function readStoredAccessToken(): string | undefined {
  try {
    const payload = JSON.parse(localStorage.getItem("systolab.auth") ?? "{}") as { tokens?: { accessToken?: string } };
    return payload.tokens?.accessToken;
  } catch {
    return undefined;
  }
}
function storedAuthHeader(): Record<string, string> {
  try {
    const payload = JSON.parse(localStorage.getItem("systolab.auth") ?? "{}") as { tokens?: { accessToken?: string } };
    return payload.tokens?.accessToken ? { authorization: `Bearer ${payload.tokens.accessToken}` } : {};
  } catch {
    return {};
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
