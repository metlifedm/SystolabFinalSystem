import { useEffect, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import type { AuthIdentifierType, AuthResponse, AuthSessionSummary, AuthTokenPair, AuthUserProfile, TenantBranding } from "@systolab/shared";
import { CheckCircle2, KeyRound, Layers, LogOut, ShieldCheck } from "lucide-react";
import {
  createProject,
  createTenant,
  downloadReportPdf,
  getBillingOverview,
  getBillingPlans,
  getPortalMe,
  getProject,
  getProjectReports,
  getUsageOverview,
  googleAuth,
  loginPassword,
  logoutAuth,
  registerPassword,
  requestOtp,
  runProjectScan,
  updateWhiteLabelBranding,
  verifyOtp
} from "./api.js";
import type { PortalBillingPlan, PortalMeResponse, PortalProjectSummary, PortalReportSummary, PortalTenantSummary, PortalUsageOverview } from "./api.js";

type StoredPortalAuth = { user: AuthUserProfile; tokens: AuthTokenPair; session: AuthSessionSummary };

type PortalPath =
  | "/"
  | "/features"
  | "/pricing"
  | "/docs"
  | "/help"
  | "/demo"
  | "/testimonials"
  | "/contact"
  | "/login"
  | "/signup"
  | "/dashboard"
  | "/projects"
  | "/reports"
  | "/monitoring"
  | "/competitors"
  | "/recommendations"
  | "/team"
  | "/clients"
  | "/billing"
  | "/white-label"
  | "/account"
  | "/security";

const publicPortalRoutes = new Set(["/", "/features", "/pricing", "/docs", "/help", "/demo", "/white-label", "/testimonials", "/contact", "/login", "/signup"]);

export function isPortalRoute(pathname: string): boolean {
  const path = normalizePortalPath(pathname);
  return publicPortalRoutes.has(path) || path === "/dashboard" || path === "/projects" || path.startsWith("/projects/") || ["/reports", "/monitoring", "/competitors", "/recommendations", "/team", "/clients", "/billing", "/white-label", "/account", "/security"].includes(path);
}

function normalizePortalPath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/$/, "");
}

export function UniversalPortal() {
  const [path, setPath] = useState(() => normalizePortalPath(window.location.pathname));
  const [auth, setAuth] = useState<StoredPortalAuth | null>(() => readStoredAuth());
  const [portal, setPortal] = useState<PortalMeResponse | null>(null);
  const [plans, setPlans] = useState<PortalBillingPlan[]>([]);
  const [usage, setUsage] = useState<PortalUsageOverview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onPop = () => setPath(normalizePortalPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    getBillingPlans().then((payload) => setPlans(payload.items)).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    if (!auth?.tokens.accessToken) {
      setPortal(null);
      setUsage(null);
      return;
    }
    void refreshPortal();
  }, [auth?.tokens.accessToken]);

  useEffect(() => {
    const tenantSlug = portal?.tenants[0]?.tenantSlug;
    if (!tenantSlug || !auth) return;
    getUsageOverview(tenantSlug).then(setUsage).catch(() => setUsage(null));
  }, [auth?.tokens.accessToken, portal?.tenants[0]?.tenantSlug]);

  function navigate(nextPath: string) {
    window.history.pushState(null, "", nextPath);
    setPath(normalizePortalPath(nextPath));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshPortal() {
    setError("");
    try {
      setPortal(await getPortalMe());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load portal data.");
    }
  }

  function applyAuth(result: AuthResponse) {
    if (!result.tokens || !result.session) {
      setMessage(result.message);
      return;
    }
    const nextAuth = { user: result.user, tokens: result.tokens, session: result.session };
    localStorage.setItem("systolab.auth", JSON.stringify(nextAuth));
    setAuth(nextAuth);
    setMessage(result.message);
    navigate("/dashboard");
  }

  function signOut() {
    if (auth?.tokens) void logoutAuth({ refreshToken: auth.tokens.refreshToken }, auth.tokens.accessToken).catch(() => undefined);
    localStorage.removeItem("systolab.auth");
    setAuth(null);
    setPortal(null);
    navigate("/");
  }

  const protectedRoute = !publicPortalRoutes.has(path);
  const tenant = portal?.tenants[0] ?? null;

  return (
    <div className="portal-shell">
      <PortalTopNav auth={auth} path={path} navigate={navigate} signOut={signOut} />
      {message && <div className="portal-status">{message}</div>}
      {error && <div className="portal-alert">{error}</div>}
      {!auth && protectedRoute ? <PortalAuthPage mode="login" onAuth={applyAuth} /> : renderPortalPage(path, { auth, portal, tenant, plans, usage, navigate, refreshPortal, applyAuth })}
    </div>
  );
}

function renderPortalPage(path: string, ctx: { auth: StoredPortalAuth | null; portal: PortalMeResponse | null; tenant: PortalTenantSummary | null; plans: PortalBillingPlan[]; usage: PortalUsageOverview | null; navigate: (path: string) => void; refreshPortal: () => Promise<void>; applyAuth: (result: AuthResponse) => void }) {
  if (path === "/") return <PortalLanding navigate={ctx.navigate} />;
  if (path === "/login" || path === "/signup") return <PortalAuthPage mode={path === "/signup" ? "signup" : "login"} onAuth={ctx.applyAuth} />;
  if (path === "/features") return <PortalStaticPage eyebrow="Features" title="Business Decision Intelligence" items={featureCards} />;
  if (path === "/pricing") return <PortalPricing plans={ctx.plans} navigate={ctx.navigate} />;
  if (path === "/docs") return <PortalDocs />;
  if (path === "/help") return <PortalHelp />;
  if (path === "/demo") return <PortalDemo navigate={ctx.navigate} />;
  if (path === "/white-label" && !ctx.auth) return <PortalWhiteLabelMarketing navigate={ctx.navigate} />;
  if (path === "/testimonials") return <PortalTestimonials navigate={ctx.navigate} />;
  if (path === "/contact") return <PortalContact navigate={ctx.navigate} />;
  if (path === "/dashboard") return <PortalDashboard portal={ctx.portal} usage={ctx.usage} refresh={ctx.refreshPortal} navigate={ctx.navigate} />;
  if (path === "/projects") return <PortalProjects portal={ctx.portal} refresh={ctx.refreshPortal} navigate={ctx.navigate} />;
  if (path.startsWith("/projects/")) return <PortalProjectDetail workspaceId={path.split("/")[2] ?? ""} navigate={ctx.navigate} />;
  if (path === "/reports") return <PortalReports projects={ctx.portal?.projects ?? []} navigate={ctx.navigate} />;
  if (path === "/billing") return <PortalBilling tenant={ctx.tenant} plans={ctx.plans} />;
  if (path === "/white-label") return <PortalWhiteLabel tenant={ctx.tenant} refresh={ctx.refreshPortal} />;
  if (path === "/account" || path === "/security") return <PortalAccountSecurity auth={ctx.auth} security={path === "/security"} />;
  return <PortalOperationsPage path={path as PortalPath} projects={ctx.portal?.projects ?? []} navigate={ctx.navigate} />;
}
function PortalTopNav({ auth, path, navigate, signOut }: { auth: StoredPortalAuth | null; path: string; navigate: (path: string) => void; signOut: () => void }) {
  const items: Array<[string, string]> = auth
    ? [["/dashboard", "Dashboard"], ["/projects", "Projects"], ["/reports", "Reports"], ["/billing", "Billing"], ["/white-label", "White Label"]]
    : [["/features", "Features"], ["/pricing", "Pricing"], ["/demo", "Live Demo"], ["/docs", "Docs"], ["/white-label", "White Label"], ["/contact", "Contact"]];
  return (
    <header className="portal-nav">
      <button className="portal-brand" onClick={() => navigate(auth ? "/dashboard" : "/")}><img src="/systolab-icon.png" alt="SYSTOLAB" /><span>SYSTOLAB Cloud</span></button>
      <nav>{items.map(([href, label]) => <button key={href} className={path === href ? "active" : ""} onClick={() => navigate(href)}>{label}</button>)}</nav>
      <div className="portal-nav-actions">
        {auth ? <><button className="portal-secondary" onClick={() => navigate("/account")}>{auth.user.displayName || auth.user.email || "Account"}</button><button className="portal-icon-button" onClick={signOut}><LogOut size={16} />Sign out</button></> : <><button className="portal-secondary" onClick={() => navigate("/login")}>Sign in</button><button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button></>}
      </div>
    </header>
  );
}
function PortalLanding({ navigate }: { navigate: (path: string) => void }) {
  return (
    <main className="portal-landing">
      <section className="portal-hero">
        <div className="portal-hero-copy">
          <span className="portal-eyebrow">Executive Business Decision Intelligence</span>
          <h1>Make Better Business Decisions With Validated Website, SEO, Local, and Competitor Intelligence</h1>
          <p>SYSTOLAB helps organizations turn website evidence, search visibility, competitor movement, revenue signals, and recommendation outcomes into clear executive decisions.</p>
          <div className="portal-hero-actions"><button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button><button className="portal-secondary" onClick={() => navigate("/demo")}>View live demo</button></div>
          <p className="portal-muted">Includes 5 complimentary Business Intelligence Reports after account creation.</p>
        </div>
        <div className="portal-hero-panel">
          <div className="health-snapshot compact"><HealthRow label="Customer Acquisition" value="Website + SEO" /><HealthRow label="Customer Trust" value="Evidence-led" /><HealthRow label="Decision Support" value="Prioritized" /><HealthRow label="Competitive Position" value="Explained" /><HealthRow label="Revenue Opportunity" value="Attribution-ready" /></div>
          <div className="portal-signal-grid"><MetricTile label="Account" value="Required" /><MetricTile label="Organization" value="MetifeDM LLC" /><MetricTile label="Projects" value="Client websites" /><MetricTile label="Reports" value="PDF / JSON" /></div>
        </div>
      </section>
      <section className="portal-band three-col">{featureCards.slice(0, 3).map((item) => <PortalInfoCard key={item.title} {...item} />)}</section>
      <section className="portal-band two-col">
        <PortalInfoCard title="White Label For Agencies" body="Create an organization, enable white-label branding, upload your logo, set brand colors, configure support identity, and deliver client reports under your brand." />
        <PortalInfoCard title="One Customer Journey" body="Start Free, verify your account, create an organization, add websites, run reports, invite teammates, and manage billing from one portal." />
      </section>
    </main>
  );
}
function PortalAuthPage({ mode, onAuth }: { mode: "login" | "signup"; onAuth: (result: AuthResponse) => void }) {
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [authMode, setAuthMode] = useState<"google" | "password" | "otp">(mode === "signup" ? "password" : "google");
  const [identifierType, setIdentifierType] = useState<AuthIdentifierType>("email");
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<{ challengeId: string; simulatedDelivery: { code?: string } } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setStatus(""); setError("");
    try { await action(); } catch (authError) { setError(authError instanceof Error ? authError.message : "Authentication failed."); }
  }

  async function continueGoogle() {
    await run(async () => {
      if (!identifier) { setStatus("Enter the Google email you want to use with SYSTOLAB."); setAuthMode("google"); return; }
      const fallbackName = displayName || identifier.split("@")[0] || "Google User";
      const credential = ["dev", identifier, `google-${simpleId(identifier)}`, fallbackName, "", "", "", "en"].map((part, index) => index === 0 ? part : encodeURIComponent(part)).join(":");
      onAuth(await googleAuth({ credential, displayName: fallbackName, deviceId, deviceLabel: "SYSTOLAB Portal" }));
    });
  }

  return (
    <main className="portal-auth-layout">
      <section className="portal-auth-copy"><span className="portal-eyebrow">Universal authentication</span><h1>{mode === "signup" ? "Create your SYSTOLAB Cloud account" : "Sign in to SYSTOLAB Cloud"}</h1><p>Use Google-first login, password, or self-contained OTP verification. Sessions, devices, and audit records are managed by the SYSTOLAB backend.</p><div className="portal-auth-proof"><span><ShieldCheck size={16} />Secure sessions</span><span><KeyRound size={16} />OTP throttling</span><span><Layers size={16} />Organization access</span></div></section>
      <section className="portal-auth-card">
        <div className="portal-auth-tabs"><button className={authMode === "google" ? "active" : ""} onClick={() => setAuthMode("google")}>Google</button><button className={authMode === "password" ? "active" : ""} onClick={() => setAuthMode("password")}>Password</button><button className={authMode === "otp" ? "active" : ""} onClick={() => setAuthMode("otp")}>OTP</button></div>
        <div className="portal-form-grid">
          {mode === "signup" && authMode !== "otp" && <label><span>Name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Business owner or agency name" /></label>}
          <div className="portal-segmented"><button className={identifierType === "email" ? "active" : ""} onClick={() => setIdentifierType("email")}>Email</button><button className={identifierType === "phone" ? "active" : ""} onClick={() => setIdentifierType("phone")}>Phone</button></div>
          <label><span>{authMode === "google" ? "Google email" : identifierType === "email" ? "Email" : "Phone"}</span><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={identifierType === "email" || authMode === "google" ? "name@example.com" : "+15551234567"} /></label>
          {authMode === "password" && <label><span>Password</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Minimum 8 characters" /></label>}
          {authMode === "otp" && otpChallenge && <label><span>OTP code</span><input value={otpCode} onChange={(event) => setOtpCode(event.target.value)} placeholder={otpChallenge.simulatedDelivery.code ?? "000000"} /></label>}
        </div>
        {authMode === "google" && <button className="portal-google" onClick={continueGoogle}><GoogleIcon />Continue with Google</button>}
        {authMode === "password" && <button className="portal-primary full" disabled={!identifier || !password} onClick={() => run(async () => { const request = { identifierType, identifier, password, deviceId, deviceLabel: "SYSTOLAB Portal" }; onAuth(mode === "signup" ? await registerPassword({ ...request, displayName: displayName || identifier.split("@")[0] }) : await loginPassword(request)); })}>{mode === "signup" ? "Create account" : "Sign in"}</button>}
        {authMode === "otp" && !otpChallenge && <button className="portal-primary full" disabled={!identifier} onClick={() => run(async () => { const challenge = await requestOtp({ identifierType, identifier, purpose: mode === "signup" ? "signup" : "login", deviceId }); setOtpChallenge(challenge); setOtpCode(challenge.simulatedDelivery.code ?? ""); })}>Send OTP</button>}
        {authMode === "otp" && otpChallenge && <button className="portal-primary full" disabled={!otpCode} onClick={() => run(async () => onAuth(await verifyOtp({ challengeId: otpChallenge.challengeId, code: otpCode, deviceId, deviceLabel: "SYSTOLAB Portal" })))}>Verify OTP</button>}
        {status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}
      </section>
    </main>
  );
}

function PortalDashboard({ portal, usage, refresh, navigate }: { portal: PortalMeResponse | null; usage: PortalUsageOverview | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const organization = portal?.tenants[0] ?? null;
  const projects = portal?.projects ?? [];
  const latest = projects.find((project) => project.latestReport)?.latestReport;
  const organizationName = organization?.branding.publicName ?? organization?.tenantSlug ?? "No organization yet";
  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="Executive Dashboard" title={`Welcome back${portal?.user.displayName ? `, ${portal.user.displayName.split(" ")[0]}` : ""}.`} actions={<button className="portal-primary" onClick={() => navigate(organization ? "/projects" : "/dashboard")}>{organization ? "+ Add Website" : "Create Organization"}</button>} />
      {!organization && <CreateOrganizationCard refresh={refresh} />}
      <section className="portal-dashboard-grid">
        <div className="portal-panel"><h2>Organization</h2><MetricTile label="Name" value={organizationName} /><MetricTile label="White Label" value={organization ? "Available" : "Create organization first"} /><MetricTile label="Team" value={organization ? "Ready" : "Pending"} /></div>
        <div className="portal-panel"><h2>Usage</h2><MetricTile label="Reports this month" value={`${usage?.scanLimit.used ?? 0}/${usage?.scanLimit.limit === -1 ? "Unlimited" : usage?.scanLimit.limit ?? 0}`} /><MetricTile label="API calls" value={`${usage?.apiCallLimit.used ?? 0}/${usage?.apiCallLimit.limit === -1 ? "Unlimited" : usage?.apiCallLimit.limit ?? 0}`} /></div>
        <div className="portal-panel wide"><h2>Business Health Snapshot</h2><div className="health-snapshot"><HealthRow label="Customer Acquisition" value={latest?.oss === null ? "Not scored" : latest ? "Tracked" : "Ready for first report"} /><HealthRow label="Customer Trust" value={latest?.businessRiskStatus ?? "Awaiting report"} /><HealthRow label="Customer Decision Support" value={latest ? latest.visualStateLabel : "Needs first report"} /><HealthRow label="Competitive Position" value={projects.some((project) => project.competitorUrls.length) ? "Competitors configured" : "Add competitors"} /><HealthRow label="Local Presence" value={projects.some((project) => project.gbpUrl) ? "GBP linked" : "Needs GBP URL"} /><HealthRow label="Priority" value={latest ? "Review latest decisions" : "Run first report"} /></div></div>
        <div className="portal-panel wide"><h2>Projects</h2>{projects.length ? <ProjectList projects={projects} navigate={navigate} /> : <p className="portal-muted">Add a website to create your first project and generate a business intelligence report.</p>}</div>
        <div className="portal-panel"><h2>Recent Reports</h2><MetricTile label="Latest" value={latest ? latest.visualStateLabel : "No reports yet"} /><MetricTile label="OSS" value={latest?.oss === null || latest?.oss === undefined ? "Not scored" : `${latest.oss}/100`} /></div>
        <div className="portal-panel"><h2>Recommendations</h2><p className="portal-muted">Recommendations appear after your first report and are organized by business impact, evidence strength, and priority.</p></div>
      </section>
    </main>
  );
}
function CreateOrganizationCard({ refresh }: { refresh: () => Promise<void> }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="portal-panel portal-first-run"><div><span className="portal-eyebrow">First organization</span><h2>Create your organization</h2><p>This becomes the secure home for projects, reports, team access, billing, API keys, referrals, and white-label settings.</p></div><div className="portal-inline-form"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Organization name, e.g. MetifeDM LLC" /><input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="organization-slug" /><button className="portal-primary" disabled={!slug || !name} onClick={async () => { setStatus(""); setError(""); try { await createTenant(slug, name); setStatus("Organization created."); await refresh(); } catch (organizationError) { setError(organizationError instanceof Error ? organizationError.message : "Unable to create organization."); } }}>Create organization</button></div>{status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}</section>
  );
}
function PortalProjects({ portal, refresh, navigate }: { portal: PortalMeResponse | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  return <main className="portal-main"><PortalPageHeader eyebrow="Projects" title="Client websites, competitors, local visibility, and reports" /><section className="portal-dashboard-grid"><ProjectCreatePanel organizations={portal?.tenants ?? []} refresh={refresh} /><div className="portal-panel wide"><h2>Client Websites</h2><ProjectList projects={portal?.projects ?? []} navigate={navigate} /></div></section></main>;
}

function ProjectCreatePanel({ organizations, refresh }: { organizations: PortalTenantSummary[]; refresh: () => Promise<void> }) {
  const [form, setForm] = useState({ targetUrl: "", projectName: "", businessType: "", targetCountry: "", targetLocation: "", competitorUrls: "", gbpUrl: "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const tenantSlug = organizations[0]?.tenantSlug ?? "";
  if (!tenantSlug) return <div className="portal-panel"><h2>Add Website</h2><p className="portal-muted">Create an organization before adding websites and reports.</p></div>;
  return (
    <div className="portal-panel"><h2>+ Add Website</h2><div className="portal-form-grid"><label><span>Website URL</span><input value={form.targetUrl} onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} placeholder="https://example.com" /></label><label><span>Project name</span><input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} placeholder="Client or business name" /></label><label><span>Business type</span><input value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} placeholder="Dentist, SaaS, law firm" /></label><label><span>Location</span><input value={form.targetLocation} onChange={(e) => setForm({ ...form, targetLocation: e.target.value })} placeholder="City / market" /></label><label><span>Country</span><input value={form.targetCountry} onChange={(e) => setForm({ ...form, targetCountry: e.target.value })} placeholder="US, IN, UK" /></label><label><span>GBP URL</span><input value={form.gbpUrl} onChange={(e) => setForm({ ...form, gbpUrl: e.target.value })} placeholder="Optional Google profile URL" /></label><label className="full"><span>Competitors</span><textarea value={form.competitorUrls} onChange={(e) => setForm({ ...form, competitorUrls: e.target.value })} placeholder="One competitor URL per line" /></label></div><button className="portal-primary full" disabled={!form.targetUrl} onClick={async () => { setStatus(""); setError(""); try { await createProject({ tenantSlug, targetUrl: form.targetUrl, projectName: form.projectName, businessType: form.businessType, targetCountry: form.targetCountry, targetLocation: form.targetLocation, gbpUrl: form.gbpUrl, competitorUrls: form.competitorUrls.split(/\n|,/).map((item) => item.trim()).filter(Boolean), monitoringConfig: { cadence: "weekly", enabled: false } }); setStatus("Website project created."); await refresh(); } catch (projectError) { setError(projectError instanceof Error ? projectError.message : "Unable to create project."); } }}>Create project</button>{status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}</div>
  );
}
function PortalProjectDetail({ workspaceId, navigate }: { workspaceId: string; navigate: (path: string) => void }) {
  const [project, setProject] = useState<PortalProjectSummary | null>(null);
  const [reports, setReports] = useState<PortalReportSummary[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!workspaceId) return;
    getProject(workspaceId).then((payload) => setProject(payload.project)).catch((err) => setError(err instanceof Error ? err.message : "Unable to load project."));
    getProjectReports(workspaceId).then((payload) => setReports(payload.items)).catch(() => setReports([]));
  }, [workspaceId]);
  if (!project) return <main className="portal-main"><PortalPageHeader eyebrow="Project" title="Loading project" /><div className="portal-alert">{error || "Loading..."}</div></main>;
  return (
    <main className="portal-main"><PortalPageHeader eyebrow="Project" title={project.projectName} actions={<button className="portal-secondary" onClick={() => navigate("/projects")}>Back to projects</button>} /><section className="portal-dashboard-grid"><div className="portal-panel wide"><h2>{safeHostLabel(project.targetUrl)}</h2><div className="portal-signal-grid"><MetricTile label="Business type" value={project.businessType ?? "Not set"} /><MetricTile label="Location" value={project.targetLocation ?? "Not set"} /><MetricTile label="Competitors" value={String(project.competitorUrls.length)} /><MetricTile label="Monitoring" value={project.monitoringConfig.enabled ? project.monitoringConfig.cadence : "Manual"} /></div><button className="portal-primary" onClick={async () => { setStatus(""); setError(""); try { const job = await runProjectScan(project.workspaceId, { mode: "full_audit", includeSeo: true }); setStatus(`Scan queued. Job ${job.jobId}.`); } catch (scanError) { setError(scanError instanceof Error ? scanError.message : "Unable to run project scan."); } }}>Run full website + SEO scan</button>{status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}</div><div className="portal-panel wide"><h2>Reports</h2><ReportList reports={reports} /></div></section></main>
  );
}

function ProjectList({ projects, navigate }: { projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  if (!projects.length) return <p className="portal-muted">No projects yet.</p>;
  return <div className="portal-table">{projects.map((project) => <button key={project.workspaceId} className="portal-table-row" onClick={() => navigate(`/projects/${project.workspaceId}`)}><span><strong>{project.projectName}</strong><small>{safeHostLabel(project.targetUrl)}</small></span><span>{project.latestReport?.visualStateLabel ?? "No report yet"}</span><span>{project.latestReport?.oss === null || project.latestReport?.oss === undefined ? "Not scored" : `${project.latestReport.oss}/100`}</span></button>)}</div>;
}

function PortalReports({ projects, navigate }: { projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  const reports = projects.map((project) => project.latestReport).filter((report): report is PortalReportSummary => Boolean(report));
  return <main className="portal-main"><PortalPageHeader eyebrow="Reports" title="Customer-safe decision reports and exports" /><section className="portal-panel wide"><ReportList reports={reports} />{!reports.length && <button className="portal-primary" onClick={() => navigate("/projects")}>Create or scan a project</button>}</section></main>;
}

function ReportList({ reports }: { reports: PortalReportSummary[] }) {
  const [downloadingId, setDownloadingId] = useState("");
  const [error, setError] = useState("");

  async function downloadPdf(report: PortalReportSummary) {
    setError("");
    setDownloadingId(report.snapshotId);
    try {
      const blob = await downloadReportPdf(report.snapshotId);
      savePortalBlob(blob, `${report.snapshotId}.pdf`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "PDF download failed.");
    } finally {
      setDownloadingId("");
    }
  }

  if (!reports.length) return <p className="portal-muted">No reports available yet.</p>;
  return <><div className="portal-table">{reports.map((report) => <div key={report.snapshotId} className="portal-table-row static"><span><strong>{safeHostLabel(report.targetUrl)}</strong><small>{new Date(report.createdAt).toLocaleString()}</small></span><span>{report.visualStateLabel}</span><span>{report.oss === null ? "Not scored" : `${report.oss}/100`}</span><a className="portal-secondary" href={report.reportUrl}>Open</a><button className="portal-secondary" type="button" disabled={downloadingId === report.snapshotId} onClick={() => void downloadPdf(report)}>{downloadingId === report.snapshotId ? "Preparing" : "PDF"}</button></div>)}</div>{error && <div className="portal-alert inline">{error}</div>}</>;
}
function savePortalBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
function PortalBilling({ tenant, plans }: { tenant: PortalTenantSummary | null; plans: PortalBillingPlan[] }) {
  const [overview, setOverview] = useState<{ plans: PortalBillingPlan[]; subscription: Record<string, unknown> | null; usage: PortalUsageOverview } | null>(null);
  useEffect(() => { if (tenant) getBillingOverview(tenant.tenantSlug).then(setOverview).catch(() => setOverview(null)); }, [tenant?.tenantSlug]);
  return <main className="portal-main"><PortalPageHeader eyebrow="Billing" title="Plan, usage, limits, and API capacity" /><section className="portal-band pricing-grid">{(overview?.plans ?? plans).map((plan) => <PricingCard key={plan.planId} plan={plan} />)}</section><section className="portal-panel"><h2>Current usage</h2><div className="portal-signal-grid"><MetricTile label="Organization" value={tenant?.branding.publicName ?? tenant?.tenantSlug ?? "No organization"} /><MetricTile label="Reports" value={`${overview?.usage.scanLimit.used ?? 0}/${overview?.usage.scanLimit.limit ?? 0}`} /><MetricTile label="API calls" value={`${overview?.usage.apiCallLimit.used ?? 0}/${overview?.usage.apiCallLimit.limit ?? 0}`} /></div></section></main>;
}
function PortalWhiteLabel({ tenant, refresh }: { tenant: PortalTenantSummary | null; refresh: () => Promise<void> }) {
  const [branding, setBranding] = useState<TenantBranding | null>(() => tenant?.branding ?? null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setBranding(tenant?.branding ?? null), [tenant?.tenantSlug]);

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Upload an image file for the logo.");
      return;
    }
    if (file.size > 750_000) {
      setError("Logo must be 750 KB or smaller for reliable self-contained storage.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding((current) => current ? { ...current, logoUrl: String(reader.result ?? "") } : current);
    reader.onerror = () => setError("Unable to read logo image.");
    reader.readAsDataURL(file);
  }

  if (!tenant || !branding) return <main className="portal-main"><PortalPageHeader eyebrow="White Label" title="Create an organization first" /></main>;
  return (
    <main className="portal-main"><PortalPageHeader eyebrow="White Label" title="Agency branding and client portal identity" /><section className="portal-dashboard-grid"><div className="portal-panel"><h2>Brand settings</h2><div className="portal-form-grid"><label><span>Public name</span><input value={branding.publicName} onChange={(e) => setBranding({ ...branding, publicName: e.target.value })} /></label><label><span>Upload logo</span><input type="file" accept="image/*" onChange={handleLogoUpload} /></label><label><span>Logo URL</span><input value={branding.logoUrl ?? ""} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} placeholder="Upload or paste logo URL" /></label><label><span>Primary color</span><input type="color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} /></label><label><span>Accent color</span><input type="color" value={branding.accentColor} onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })} /></label><label><span>Support email</span><input value={branding.supportEmail ?? ""} onChange={(e) => setBranding({ ...branding, supportEmail: e.target.value })} /></label><label><span>Custom domain</span><input value={branding.customDomain ?? ""} onChange={(e) => setBranding({ ...branding, customDomain: e.target.value })} /></label><label className="full"><span>Dashboard welcome</span><textarea value={branding.dashboardWelcomeMessage ?? ""} onChange={(e) => setBranding({ ...branding, dashboardWelcomeMessage: e.target.value })} /></label></div><button className="portal-primary full" onClick={async () => { setStatus(""); setError(""); try { await updateWhiteLabelBranding(tenant.tenantSlug, branding); setStatus("White-label settings saved."); await refresh(); } catch (brandingError) { setError(brandingError instanceof Error ? brandingError.message : "Unable to update branding."); } }}>Save white-label settings</button>{status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}</div><div className="portal-panel brand-preview" style={{ "--brand": branding.primaryColor, "--accent": branding.accentColor } as CSSProperties}>{branding.logoUrl && <img className="brand-preview-logo" src={branding.logoUrl} alt={`${branding.publicName} logo`} />}<h2>{branding.publicName}</h2><p>{branding.dashboardWelcomeMessage || "Your client portal, reports, exports, support identity, and custom domain inherit this brand."}</p><button>{branding.reportTitle}</button></div></section></main>
  );
}
function PortalAccountSecurity({ auth, security }: { auth: StoredPortalAuth | null; security: boolean }) {
  return <main className="portal-main"><PortalPageHeader eyebrow={security ? "Security" : "Account"} title={security ? "Sessions, devices, and authentication controls" : "Profile and authentication identity"} /><section className="portal-dashboard-grid"><div className="portal-panel"><h2>{auth?.user.displayName || auth?.user.email || "SYSTOLAB user"}</h2><MetricTile label="Email" value={auth?.user.email ?? "Not linked"} /><MetricTile label="Phone" value={auth?.user.phone ?? "Not linked"} /><MetricTile label="Lifecycle" value={auth?.user.lifecycleState ?? "Unknown"} /></div><div className="portal-panel"><h2>Session</h2><MetricTile label="Device" value={auth?.session.deviceLabel ?? "Current browser"} /><MetricTile label="Provider" value={auth?.session.provider ?? "Unknown"} /><MetricTile label="Expires" value={auth?.session.expiresAt ? new Date(auth.session.expiresAt).toLocaleString() : "Unknown"} /></div></section></main>;
}

function PortalOperationsPage({ path, projects, navigate }: { path: PortalPath; projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  const labels: Record<string, { eyebrow: string; title: string; intro: string; items: Array<{ title: string; body: string }> }> = {
    "/monitoring": { eyebrow: "Monitoring", title: "Scheduled scans, changes, and alert readiness", intro: "Track score movement, competitor movement, report freshness, and evidence coverage across projects.", items: [{ title: "Cadence", body: "Daily, weekly, and monthly monitoring settings are stored per project." }, { title: "Alerts", body: "Dashboard alerts can surface score drops, competitor improvements, and monitoring due states." }] },
    "/competitors": { eyebrow: "Competitors", title: "Competitor intelligence by project", intro: "Compare client websites against competitors and explain why competitors may be winning decisions.", items: [{ title: "Configured competitors", body: `${projects.reduce((sum, project) => sum + project.competitorUrls.length, 0)} competitor URLs across active projects.` }, { title: "Business implication", body: "Reports explain information gaps, trust gaps, and decision-support gaps, not just score differences." }] },
    "/recommendations": { eyebrow: "Recommendations", title: "Recommendation sequencing and outcome tracking", intro: "Prioritize what to fix now, this month, and monitor later based on validated evidence.", items: [{ title: "Outcome loop", body: "Recommendations map to reports, rescans, deltas, and business outcome attribution in the backend." }, { title: "Implementation view", body: "Developer-facing tasks stay available without diluting the executive summary." }] },
    "/team": { eyebrow: "Team", title: "Roles, users, and access boundaries", intro: "Owner, member, guest, editor, and viewer permissions isolate organization and project data.", items: [{ title: "Organization roles", body: "Owners manage billing, team, API keys, and white-label settings." }, { title: "Project roles", body: "Project owners and editors can run scans; viewers can read reports." }] },
    "/clients": { eyebrow: "Client Portal", title: "Client-safe reporting and white-label delivery", intro: "Clients can receive project dashboards, decision reports, exports, and progress history.", items: [{ title: "Client access", body: "Each project can enable or disable client visibility." }, { title: "Exports", body: "Reports link to customer-safe PDF exports and web views." }] }
  };
  const meta = labels[path] ?? labels["/monitoring"]!;
  return <main className="portal-main"><PortalPageHeader eyebrow={meta.eyebrow} title={meta.title} actions={<button className="portal-secondary" onClick={() => navigate("/projects")}>Open projects</button>} /><section className="portal-panel wide"><p>{meta.intro}</p></section><section className="portal-band two-col">{meta.items.map((item) => <PortalInfoCard key={item.title} title={item.title} body={item.body} />)}</section></main>;
}

function PortalWhiteLabelMarketing({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="White Label" title="Agency-branded client portals and reports" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band three-col"><PortalInfoCard title="Upload Logo" body="Use your agency identity across the portal, report pages, and customer-safe PDF exports." /><PortalInfoCard title="Brand Colors" body="Set primary and accent colors so the client experience feels owned by your organization." /><PortalInfoCard title="Client Portal" body="Create projects for client websites and deliver reports from a branded workspace." /></section></main>;
}

function PortalTestimonials({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Testimonials" title="Built for agencies, operators, and decision makers" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band three-col"><PortalInfoCard title="Agency Owner" body="SYSTOLAB turns audits into business conversations clients understand." /><PortalInfoCard title="Growth Team" body="The report explains what to fix first and why it matters commercially." /><PortalInfoCard title="Consultant" body="White-label delivery makes the platform feel like part of our own service stack." /></section></main>;
}

function PortalContact({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Contact" title="Talk to SYSTOLAB" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band two-col"><PortalInfoCard title="Sales" body="Create an account to evaluate complimentary reports, white-label branding, projects, and client delivery." /><PortalInfoCard title="Support" body="Use the Help Center for scan setup, report reading, white-label configuration, and account guidance." /></section></main>;
}
function PortalPricing({ plans, navigate }: { plans: PortalBillingPlan[]; navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Pricing" title="Plans for owners, agencies, partners, and enterprise teams" /><section className="portal-band pricing-grid">{plans.map((plan) => <PricingCard key={plan.planId} plan={plan} />)}</section><button className="portal-primary" onClick={() => navigate("/signup")}>Start free</button></main>;
}

function PricingCard({ plan }: { plan: PortalBillingPlan }) {
  return <div className="portal-panel pricing-card"><h2>{plan.name}</h2><p>{plan.description}</p><strong>{plan.priceCentsPerMonth === 0 ? "Free" : `$${Math.round(plan.priceCentsPerMonth / 100)}/mo`}</strong><ul>{plan.features.map((feature) => <li key={feature}><CheckCircle2 size={14} />{feature}</li>)}</ul></div>;
}

function PortalStaticPage({ eyebrow, title, items }: { eyebrow: string; title: string; items: Array<{ title: string; body: string }> }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow={eyebrow} title={title} /><section className="portal-band three-col">{items.map((item) => <PortalInfoCard key={item.title} {...item} />)}</section></main>;
}

function PortalDocs() {
  return <PortalStaticPage eyebrow="Documentation" title="SYSTOLAB-owned API, portal, and report workflow" items={[{ title: "Authentication", body: "JWT sessions, refresh tokens, OTP, password, device tracking, and Google-first login are handled by the backend." }, { title: "Projects", body: "Projects connect website, SEO, GBP, competitors, monitoring, reports, and client delivery." }, { title: "API", body: "The SYSTOLAB API supports authenticated scan creation and customer-safe report retrieval without paid third-party APIs." }]} />;
}

function PortalHelp() {
  return <PortalStaticPage eyebrow="Help Center" title="Support for owners, agencies, and client users" items={[{ title: "Run a scan", body: "Create an organization, add a website project, add competitors and GBP URL, then run a full website and SEO report." }, { title: "Read reports", body: "Start with the executive narrative, health snapshot, competitor explanation, and prioritized recommendations." }, { title: "White-label", body: "Set brand colors, logo, support identity, report labels, and custom domain from the portal." }]} />;
}

function PortalDemo({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Live Demo" title="Preview the SYSTOLAB workflow" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start with your site</button>} /><section className="portal-dashboard-grid"><div className="portal-panel wide"><h2>Demo flow</h2><div className="portal-timeline"><span>1. Add website</span><span>2. Add competitors</span><span>3. Run website + SEO scan</span><span>4. Review decision report</span><span>5. Track outcomes</span></div></div><div className="portal-panel"><h2>Demo signals</h2><MetricTile label="Trust" value="Strong" /><MetricTile label="Decision Support" value="Moderate" /><MetricTile label="Competitive Gap" value="Content clarity" /></div></section></main>;
}

function PortalPageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return <section className="portal-page-header"><div><span className="portal-eyebrow">{eyebrow}</span><h1>{title}</h1></div>{actions && <div className="portal-header-actions">{actions}</div>}</section>;
}

function PortalInfoCard({ title, body }: { title: string; body: string }) {
  return <article className="portal-panel info-card"><h2>{title}</h2><p>{body}</p></article>;
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="metric-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return <div className="health-row"><span>{label}</span><strong>{value}</strong></div>;
}

function GoogleIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>;
}

function readStoredAuth(): StoredPortalAuth | null {
  try { const raw = localStorage.getItem("systolab.auth"); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem("systolab.deviceId");
  if (existing) return existing;
  const generated = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem("systolab.deviceId", generated);
  return generated;
}

function simpleId(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}

function safeHostLabel(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "Website"; }
}

const featureCards = [
  { title: "Business Decision Reports", body: "Website and SEO findings are translated into executive decisions, health snapshots, competitor implications, and next actions." },
  { title: "Universal Authentication", body: "Google-first login, password, OTP, sessions, device tracking, and audit logs live inside the SYSTOLAB backend." },
  { title: "White-Label Portals", body: "Partners can configure brand identity, report labels, custom domains, support identity, and client-safe dashboards." },
  { title: "Project Intelligence", body: "Each project stores website, GBP, competitors, location, monitoring cadence, reports, and history inside an organization." },
  { title: "Usage and Billing Controls", body: "Free, Pro, Agency, and Enterprise style limits are enforced through scan and API usage tracking." },
  { title: "SYSTOLAB API", body: "A first-party API lets approved users create scans and retrieve reports without third-party paid data dependencies." }
];
