import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import type { AuthIdentifierType, AuthResponse, AuthSessionSummary, AuthTokenPair, AuthUserProfile, TenantBranding } from "@systolab/shared";
import { ArrowRight, Building2, CheckCircle2, FileText, Globe2, KeyRound, Layers, LogOut, Settings, Share2, ShieldCheck, Users } from "lucide-react";
import {
  createProject,
  generateAgencyProposal,
  downloadReportPdf,
  ensureAgency,
  getBillingOverview,
  getBillingPlans,
  getPortalMe,
  getScanJob,
  getProject,
  getProjectReports,
  getUsageOverview,
  getAgencyDashboard,
  getAgencyOperatingSystem,
  googleAuth,
  loginPassword,
  logoutAuth,
  registerPassword,
  requestOtp,
  runProjectScan,
  startFirstAnalysis,
  updateAgencyKnowledgeBase,
  updateAgencyServiceCatalog,
  updateClientWorkspaceState,
  updateWhiteLabelBranding,
  verifyOtp
} from "./api.js";
import type { AgencyDashboardResponse, AgencyOperatingSystemResponse, ClientFollowUpStatus, ClientOperatingSummary, PortalBillingPlan, PortalMeResponse, PortalProjectSummary, PortalReportSummary, PortalTenantSummary, PortalUsageOverview } from "./api.js";

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
  | "/security"
  | "/agency"
  | "/settings";

const publicPortalRoutes = new Set(["/", "/features", "/pricing", "/docs", "/help", "/demo", "/white-label", "/testimonials", "/contact", "/login", "/signup"]);

export function isPortalRoute(pathname: string): boolean {
  const path = normalizePortalPath(pathname);
  return publicPortalRoutes.has(path) || path === "/dashboard" || path === "/projects" || path.startsWith("/projects/") || ["/reports", "/monitoring", "/competitors", "/recommendations", "/team", "/clients", "/billing", "/white-label", "/account", "/security", "/agency", "/settings"].includes(path);
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
  const [agencyDashboard, setAgencyDashboard] = useState<AgencyDashboardResponse | null>(null);
  const [agencyOperating, setAgencyOperating] = useState<AgencyOperatingSystemResponse | null>(null);
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
      setAgencyDashboard(null);
      setAgencyOperating(null);
      return;
    }
    void refreshPortal();
  }, [auth?.tokens.accessToken]);

  useEffect(() => {
    const tenantSlug = portal?.tenants[0]?.tenantSlug;
    if (!tenantSlug || !auth) return;
    getUsageOverview(tenantSlug).then(setUsage).catch(() => setUsage(null));
    getAgencyDashboard(tenantSlug).then(setAgencyDashboard).catch(() => setAgencyDashboard(null));
    getAgencyOperatingSystem(tenantSlug).then(setAgencyOperating).catch(() => setAgencyOperating(null));
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

  async function refreshAgencyOperating() {
    const tenantSlug = portal?.tenants[0]?.tenantSlug;
    if (!tenantSlug) { setAgencyOperating(null); return; }
    try { setAgencyOperating(await getAgencyOperatingSystem(tenantSlug)); } catch { setAgencyOperating(null); }
  }

  function applyAuth(result: AuthResponse) {
    if (!result.tokens || !result.session) {
      setMessage(result.requiresVerification ? "Verify your account to continue." : "We could not complete sign in. Please try again.");
      return;
    }
    const nextAuth = { user: result.user, tokens: result.tokens, session: result.session };
    localStorage.setItem("systolab.auth", JSON.stringify(nextAuth));
    setAuth(nextAuth);
    setMessage("Welcome to SYSTOLAB. Your account is ready.");
    navigate("/dashboard");
  }

  function signOut() {
    if (auth?.tokens) void logoutAuth({ refreshToken: auth.tokens.refreshToken }, auth.tokens.accessToken).catch(() => undefined);
    localStorage.removeItem("systolab.auth");
    setAuth(null);
    setPortal(null);
    setAgencyOperating(null);
    navigate("/");
  }

  const protectedRoute = !publicPortalRoutes.has(path);
  const tenant = portal?.tenants[0] ?? null;

  return (
    <div className="portal-shell">
      <PortalTopNav auth={auth} path={path} navigate={navigate} signOut={signOut} />
      {message && <div className="portal-status">{message}</div>}
      {error && <div className="portal-alert">{error}</div>}
      {!auth && protectedRoute ? <PortalAuthPage mode="login" onAuth={applyAuth} /> : renderPortalPage(path, { auth, portal, tenant, plans, usage, agencyDashboard, agencyOperating, navigate, refreshPortal, refreshAgencyOperating, applyAuth })}
    </div>
  );
}

function renderPortalPage(path: string, ctx: { auth: StoredPortalAuth | null; portal: PortalMeResponse | null; tenant: PortalTenantSummary | null; plans: PortalBillingPlan[]; usage: PortalUsageOverview | null; agencyDashboard: AgencyDashboardResponse | null; agencyOperating: AgencyOperatingSystemResponse | null; navigate: (path: string) => void; refreshPortal: () => Promise<void>; refreshAgencyOperating: () => Promise<void>; applyAuth: (result: AuthResponse) => void }) {
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
  if (path === "/dashboard") return <PortalDashboard portal={ctx.portal} usage={ctx.usage} agencyDashboard={ctx.agencyDashboard} agencyOperating={ctx.agencyOperating} refresh={ctx.refreshPortal} navigate={ctx.navigate} />;
  if (path === "/projects") return <PortalProjects portal={ctx.portal} refresh={ctx.refreshPortal} navigate={ctx.navigate} />;
  if (path.startsWith("/projects/")) return <PortalProjectDetail workspaceId={path.split("/")[2] ?? ""} navigate={ctx.navigate} />;
  if (path === "/reports") return <PortalReports projects={ctx.portal?.projects ?? []} navigate={ctx.navigate} />;
  if (path === "/clients") return <PortalClients tenant={ctx.tenant} agencyOperating={ctx.agencyOperating} refresh={ctx.refreshAgencyOperating} navigate={ctx.navigate} />;
  if (path === "/billing") return <PortalBilling tenant={ctx.tenant} plans={ctx.plans} />;
  if (path === "/white-label" || path === "/agency") return <PortalWhiteLabel tenant={ctx.tenant} agencyOperating={ctx.agencyOperating} refresh={ctx.refreshPortal} refreshAgencyOperating={ctx.refreshAgencyOperating} />;
  if (path === "/settings") return <PortalSettings auth={ctx.auth} tenant={ctx.tenant} navigate={ctx.navigate} />;
  if (path === "/account" || path === "/security") return <PortalAccountSecurity auth={ctx.auth} security={path === "/security"} />;
  return <PortalOperationsPage path={path as PortalPath} projects={ctx.portal?.projects ?? []} navigate={ctx.navigate} />;
}
function PortalTopNav({ auth, path, navigate, signOut }: { auth: StoredPortalAuth | null; path: string; navigate: (path: string) => void; signOut: () => void }) {
  const customerItems = [
    { href: "/dashboard", label: "Dashboard", icon: <Layers size={16} /> },
    { href: "/reports", label: "Reports", icon: <FileText size={16} /> },
    { href: "/clients", label: "Clients", icon: <Users size={16} /> },
    { href: "/agency", label: "Agency", icon: <Building2 size={16} /> },
    { href: "/settings", label: "Settings", icon: <Settings size={16} /> }
  ];
  const publicItems: Array<[string, string]> = [["/features", "Features"], ["/pricing", "Pricing"], ["/demo", "Live Demo"], ["/docs", "Documentation"], ["/white-label", "White Label"], ["/help", "Help Center"], ["/contact", "Contact"]];
  return (
    <header className="portal-nav">
      <button className="portal-brand" onClick={() => navigate(auth ? "/dashboard" : "/")}><img src="/systolab-icon.png" alt="SYSTOLAB" /><span>SYSTOLAB</span></button>
      <nav>{auth
        ? customerItems.map((item) => <button key={item.href} className={path === item.href ? "active" : ""} onClick={() => navigate(item.href)}>{item.icon}{item.label}</button>)
        : publicItems.map(([href, label]) => <button key={href} className={path === href ? "active" : ""} onClick={() => navigate(href)}>{label}</button>)}
      </nav>
      <div className="portal-nav-actions">
        {auth ? <><button className="portal-secondary portal-account-button" onClick={() => navigate("/settings")}>{auth.user.displayName || auth.user.email || "My Account"}</button><button className="portal-icon-button" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></> : <><button className="portal-secondary" onClick={() => navigate("/login")}>Sign in</button><button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button></>}
      </div>
    </header>
  );
}function PortalLanding({ navigate }: { navigate: (path: string) => void }) {
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
          <div className="portal-signal-grid"><MetricTile label="Account" value="Secure" /><MetricTile label="My Agency" value="Branded" /><MetricTile label="My Clients" value="Organized" /><MetricTile label="My Reports" value="Web + PDF" /></div>
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
  async function continuePassword() {
    await run(async () => {
      const request = { identifierType, identifier, password, deviceId, deviceLabel: "SYSTOLAB Portal" };
      if (mode === "login") {
        onAuth(await loginPassword(request));
        return;
      }

      const registered = await registerPassword({ ...request, displayName: displayName || identifier.split("@")[0] });
      if (registered.tokens && registered.session) {
        onAuth(registered);
        return;
      }

      if (registered.requiresVerification) {
        const challenge = registered.otpChallenge;
        setOtpChallenge(challenge);
        setOtpCode(challenge.simulatedDelivery.code ?? "");
        setAuthMode("otp");
        setStatus("Verify your account to continue.");
        return;
      }

      onAuth(registered);
    });
  }

  return (
    <main className="portal-auth-layout">
      <section className="portal-auth-copy"><span className="portal-eyebrow">{mode === "signup" ? "Start free" : "Welcome back"}</span><h1>{mode === "signup" ? "Create your SYSTOLAB account" : "Sign in to SYSTOLAB"}</h1><p>{mode === "signup" ? "Create your account, analyze your first website, and receive an executive report in minutes." : "Continue to your reports, clients, agency brand, and business intelligence."}</p><div className="portal-auth-proof"><span><ShieldCheck size={16} />Protected account</span><span><KeyRound size={16} />Flexible sign in</span><span><Layers size={16} />Your reports stay organized</span></div></section>
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
        {authMode === "password" && <button className="portal-primary full" disabled={!identifier || !password} onClick={() => void continuePassword()}>{mode === "signup" ? "Create account" : "Sign in"}</button>}
        {authMode === "otp" && !otpChallenge && <button className="portal-primary full" disabled={!identifier} onClick={() => run(async () => { const challenge = await requestOtp({ identifierType, identifier, purpose: mode === "signup" ? "signup" : "login", deviceId }); setOtpChallenge(challenge); setOtpCode(challenge.simulatedDelivery.code ?? ""); })}>Send OTP</button>}
        {authMode === "otp" && otpChallenge && <button className="portal-primary full" disabled={!otpCode} onClick={() => run(async () => onAuth(await verifyOtp({ challengeId: otpChallenge.challengeId, code: otpCode, deviceId, deviceLabel: "SYSTOLAB Portal" })))}>Verify OTP</button>}
        {status && <div className="portal-status inline">{status}</div>}{error && <div className="portal-alert inline">{error}</div>}
      </section>
    </main>
  );
}

function PortalDashboard({ portal, usage, agencyDashboard, agencyOperating, refresh, navigate }: { portal: PortalMeResponse | null; usage: PortalUsageOverview | null; agencyDashboard: AgencyDashboardResponse | null; agencyOperating: AgencyOperatingSystemResponse | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const organization = portal?.tenants[0] ?? null;
  const websites = portal?.projects ?? [];
  const reports = websites
    .map((website) => website.latestReport)
    .filter((report): report is PortalReportSummary => Boolean(report))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const latest = reports[0];

  if (!latest) {
    return <PortalFirstValueJourney portal={portal} refresh={refresh} navigate={navigate} />;
  }

  const firstName = portal?.user.displayName?.split(" ")[0] || "there";
  const branding = organization?.branding;
  const milestones = [
    { label: "First website analyzed", complete: reports.length > 0, path: "/reports" },
    { label: "Upload your logo", complete: Boolean(branding?.logoUrl), path: "/agency" },
    { label: "Complete agency details", complete: Boolean(branding?.supportEmail && branding?.websiteUrl && branding?.phoneNumber), path: "/agency" },
    { label: "Invite team members", complete: (agencyOperating?.profile.teamMembers.length ?? 0) > 1, path: "/settings" },
    { label: "Generate a branded report", complete: Boolean(branding?.logoUrl && reports.length), path: "/reports" },
    { label: "Share your first client report", complete: websites.some((website) => website.clientAccessEnabled), path: "/clients" }
  ];

  return (
    <main className="portal-main">
      <PortalPageHeader
        eyebrow="Executive Dashboard"
        title={"Welcome, " + firstName + "."}
        actions={<button className="portal-primary" onClick={() => navigate("/projects")}><Globe2 size={17} />Analyze another website</button>}
      />
      <section className="portal-dashboard-grid portal-dashboard-focus">
        <div className="portal-panel wide portal-value-panel">
          <div className="portal-section-heading"><div><span className="portal-eyebrow">Latest intelligence</span><h2>{safeHostLabel(latest.targetUrl)}</h2></div><a className="portal-secondary" href={latest.brandedReportUrl || latest.reportUrl}>Open report <ArrowRight size={16} /></a></div>
          <div className="portal-signal-grid portal-four-up">
            <MetricTile label="Business readiness" value={latest.oss === null ? "Not scored" : latest.oss + "/100"} />
            <MetricTile label="Current position" value={latest.visualStateLabel} />
            <MetricTile label="Evidence coverage" value={latest.evidenceCoveragePercent + "%"} />
            <MetricTile label="Confidence" value={latest.confidenceLabel} />
          </div>
        </div>
        <div className="portal-panel">
          <h2>Business Health Snapshot</h2>
          <div className="health-snapshot compact">
            <HealthRow label="Customer Acquisition" value={latest.oss === null ? "Assessment limited" : "Measured"} />
            <HealthRow label="Customer Trust" value={latest.businessRiskStatus} />
            <HealthRow label="Decision Support" value={latest.visualStateLabel} />
            <HealthRow label="Competitive Position" value={websites.some((website) => website.competitorUrls.length) ? "Tracked" : "Ready to enrich"} />
            <HealthRow label="Local Presence" value={websites.some((website) => website.gbpUrl) ? "Connected" : "Ready to enrich"} />
          </div>
        </div>
        <div className="portal-panel wide">
          <div className="portal-section-heading"><div><h2>Recent Reports</h2><p className="portal-muted">Your latest executive intelligence is ready to review, download, and share.</p></div><button className="portal-secondary" onClick={() => navigate("/reports")}>View all</button></div>
          <ReportList reports={reports.slice(0, 4)} />
        </div>
        <div className="portal-panel">
          <h2>Agency Setup</h2>
          <div className="portal-checklist">{milestones.map((milestone) => <button key={milestone.label} onClick={() => navigate(milestone.path)} className={milestone.complete ? "complete" : ""}><CheckCircle2 size={18} /><span>{milestone.label}</span></button>)}</div>
        </div>
        <div className="portal-panel wide">
          <div className="portal-section-heading"><div><h2>Clients</h2><p className="portal-muted">Monitor active websites and open the next decision report.</p></div><button className="portal-secondary" onClick={() => navigate("/clients")}>Manage clients</button></div>
          <ProjectList projects={websites.slice(0, 5)} navigate={navigate} />
        </div>
        <div className="portal-panel">
          <h2>Report Capacity</h2>
          <MetricTile label="Used this month" value={String(usage?.scanLimit.used ?? reports.length)} />
          <MetricTile label="Available" value={usage?.scanLimit.limit === -1 ? "Unlimited" : String(Math.max(0, (usage?.scanLimit.limit ?? 0) - (usage?.scanLimit.used ?? 0)))} />
        </div>
      </section>
      <AdvancedAgencyOverview agencyDashboard={agencyDashboard} agencyOperating={agencyOperating} />
    </main>
  );
}

const intelligenceJourneyStages = [
  "Understanding Your Business",
  "Understanding Your Customers",
  "Understanding Your Competitors",
  "Evaluating Customer Trust",
  "Analyzing Local Visibility",
  "Estimating Business Opportunities",
  "Prioritizing Executive Decisions",
  "Preparing Your Executive Business Intelligence Report"
];

function PortalFirstValueJourney({ portal, refresh, navigate }: { portal: PortalMeResponse | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const [targetUrl, setTargetUrl] = useState(portal?.projects[0]?.targetUrl ?? "");
  const [phase, setPhase] = useState<"ready" | "running" | "complete" | "failed">("ready");
  const [stageIndex, setStageIndex] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  async function beginAnalysis() {
    setError("");
    const normalizedUrl = normalizeWebsiteEntry(targetUrl);
    if (!normalizedUrl) {
      setError("Enter a valid public website address.");
      return;
    }

    setPhase("running");
    setStageIndex(0);
    setProgressLabel(intelligenceJourneyStages[0] ?? "");

    try {
      const started = await startFirstAnalysis(normalizedUrl);
      await refresh();
      const maxPolls = 120;

      for (let poll = 0; poll < maxPolls && mounted.current; poll += 1) {
        await portalDelay(2500);
        let job;
        try {
          job = await getScanJob(started.job.jobId);
        } catch (pollError) {
          const status = (pollError as Error & { status?: number }).status;
          if (status === 429) {
            await portalDelay((pollError as Error & { retryAfterMs?: number }).retryAfterMs ?? 5000);
            continue;
          }
          throw pollError;
        }

        if (job.status === "completed") {
          const snapshotId = typeof job.result?.["snapshotId"] === "string" ? job.result["snapshotId"] : "";
          if (!snapshotId) throw new Error("The analysis completed, but the report could not be opened.");
          setStageIndex(intelligenceJourneyStages.length - 1);
          setProgressLabel(intelligenceJourneyStages[intelligenceJourneyStages.length - 1] ?? "");
          setPhase("complete");
          await refresh();
          window.location.assign("/reports/" + encodeURIComponent(snapshotId));
          return;
        }

        if (["failed", "dead_letter", "cancelled"].includes(job.status)) {
          throw new Error(job.errorMessage || "The website analysis could not be completed. Please try again.");
        }

        const completedSteps = job.progress?.completedSteps ?? 0;
        const totalSteps = job.progress?.totalSteps ?? 0;
        const progressStage = totalSteps > 0
          ? Math.floor((completedSteps / Math.max(totalSteps, 1)) * intelligenceJourneyStages.length)
          : Math.floor(poll / 5);
        const nextStage = Math.min(intelligenceJourneyStages.length - 1, Math.max(stageIndex, progressStage));
        setStageIndex(nextStage);
        setProgressLabel(intelligenceJourneyStages[nextStage] ?? intelligenceJourneyStages[0] ?? "");
      }

      throw new Error("Your report is taking longer than expected. It is still being prepared and will appear in Reports when complete.");
    } catch (analysisError) {
      if (!mounted.current) return;
      setPhase("failed");
      setError(analysisError instanceof Error ? analysisError.message : "Unable to analyze this website.");
    }
  }

  const firstName = portal?.user.displayName?.split(" ")[0] || "there";
  const progressPercent = phase === "ready" ? 0 : Math.round(((stageIndex + 1) / intelligenceJourneyStages.length) * 100);

  return (
    <main className="portal-main portal-first-value">
      <section className="portal-welcome-stage">
        <div className="portal-welcome-copy">
          <span className="portal-eyebrow">Welcome, {firstName}</span>
          <h1>Let's discover what may be costing this business customers.</h1>
          <p>Enter the website you want to understand. SYSTOLAB will prepare a complete Website and SEO Executive Business Intelligence Report.</p>
          <div className="portal-url-bar portal-first-url">
            <Globe2 size={21} />
            <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && phase !== "running") void beginAnalysis(); }} placeholder="https://yourwebsite.com" aria-label="Website URL" disabled={phase === "running"} />
            <button disabled={phase === "running" || !targetUrl.trim()} onClick={() => void beginAnalysis()}>{phase === "running" ? "Preparing intelligence" : "Generate Executive Business Intelligence"}</button>
          </div>
          <div className="portal-hero-actions portal-secondary-actions">
            <button className="portal-secondary" onClick={() => navigate("/demo")}>See a Sample Report</button>
            <button className="portal-secondary" onClick={() => navigate("/agency")}>Set Up My Agency</button>
          </div>
          {error && <div className="portal-alert inline">{error}</div>}
        </div>
        <div className={"portal-intelligence-journey " + (phase === "running" || phase === "complete" ? "active" : "")}>
          <div className="portal-journey-header"><span>{phase === "ready" ? "Your intelligence journey" : progressLabel}</span><strong>{progressPercent}%</strong></div>
          <div className="portal-progress-track"><span style={{ width: progressPercent + "%" }} /></div>
          <div className="portal-stage-list">{intelligenceJourneyStages.map((stage, index) => <div key={stage} className={index < stageIndex ? "complete" : index === stageIndex && phase !== "ready" ? "active" : ""}><CheckCircle2 size={18} /><span>{stage}</span></div>)}</div>
        </div>
      </section>
    </main>
  );
}

function AdvancedAgencyOverview({ agencyDashboard, agencyOperating }: { agencyDashboard: AgencyDashboardResponse | null; agencyOperating: AgencyOperatingSystemResponse | null }) {
  const performance = agencyOperating?.performanceIntelligence;
  return (
    <details className="portal-advanced-overview">
      <summary>Advanced agency intelligence <span>Sales, performance, and operating insights</span></summary>
      <div className="portal-signal-grid portal-four-up">
        <MetricTile label="Reports generated" value={String(agencyDashboard?.analytics.reportsGenerated ?? agencyOperating?.progress.reportsGenerated ?? 0)} />
        <MetricTile label="Clients tracked" value={String(agencyOperating?.progress.clientsTracked ?? 0)} />
        <MetricTile label="Report-to-sale rate" value={performance ? performance.reportConversion.reportToSaleRate + "%" : "Not measured"} />
        <MetricTile label="Implementation rate" value={performance ? performance.recommendationImplementation.implementationRate + "%" : "Not measured"} />
      </div>
      <div className="health-snapshot compact">
        <HealthRow label="Services to pitch first" value={agencyDashboard?.successCenter.servicesToPitchFirst.slice(0, 3).join(", ") || "Generated after client reports"} />
        <HealthRow label="Estimated deal size" value={agencyDashboard?.successCenter.estimatedDealSize || "Pending outcome data"} />
        <HealthRow label="Sales coach status" value={agencyOperating?.salesCoach.status || "Limited"} />
        <HealthRow label="Remaining priorities" value={String(agencyOperating?.progress.remainingPriorities ?? 0)} />
      </div>
    </details>
  );
}

function normalizeWebsiteEntry(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : "https://" + candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function portalDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
function PortalProjects({ portal, refresh, navigate }: { portal: PortalMeResponse | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  return <main className="portal-main"><PortalPageHeader eyebrow="Clients" title="Add a website and prepare its next executive report" /><section className="portal-dashboard-grid"><ProjectCreatePanel organizations={portal?.tenants ?? []} refresh={refresh} navigate={navigate} /><div className="portal-panel wide"><h2>Client Websites</h2><ProjectList projects={portal?.projects ?? []} navigate={navigate} /></div></section></main>;
}

function ProjectCreatePanel({ organizations, refresh, navigate }: { organizations: PortalTenantSummary[]; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const [form, setForm] = useState({
    targetUrl: "",
    projectName: "",
    clientCompanyName: "",
    contactPerson: "",
    clientLogoUrl: "",
    businessType: "",
    targetCountry: "",
    targetLocation: "",
    city: "",
    serviceArea: "",
    competitorUrls: "",
    gbpUrl: ""
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const tenantSlug = organizations[0]?.tenantSlug ?? "";

  if (!tenantSlug) {
    return <div className="portal-panel wide"><h2>Add a client website</h2><p className="portal-muted">Set up your agency identity first, then add as many client websites as your plan supports.</p><button className="portal-primary" onClick={() => navigate("/agency")}>Set Up My Agency</button></div>;
  }

  const competitorUrls = form.competitorUrls.replaceAll(String.fromCharCode(10), ",").split(",").map((item) => item.trim()).filter(Boolean);

  return (
    <div className="portal-panel wide portal-add-website">
      <span className="portal-eyebrow">New client intelligence</span>
      <h2>Add a client website</h2>
      <label className="portal-simple-field"><span>Website URL</span><input value={form.targetUrl} onChange={(event) => setForm({ ...form, targetUrl: event.target.value })} placeholder="https://clientwebsite.com" /></label>
      <details className="portal-form-advanced">
        <summary>Add optional client and market context</summary>
        <div className="portal-form-grid">
          <label><span>Client or business name</span><input value={form.projectName} onChange={(event) => setForm({ ...form, projectName: event.target.value })} placeholder="Client name" /></label>
          <label><span>Client company</span><input value={form.clientCompanyName} onChange={(event) => setForm({ ...form, clientCompanyName: event.target.value })} placeholder="Company name" /></label>
          <label><span>Contact person</span><input value={form.contactPerson} onChange={(event) => setForm({ ...form, contactPerson: event.target.value })} placeholder="Client contact" /></label>
          <label><span>Business type</span><input value={form.businessType} onChange={(event) => setForm({ ...form, businessType: event.target.value })} placeholder="Dentist, SaaS, law firm" /></label>
          <label><span>Country</span><input value={form.targetCountry} onChange={(event) => setForm({ ...form, targetCountry: event.target.value })} placeholder="US, IN, UK" /></label>
          <label><span>City</span><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value, targetLocation: event.target.value })} placeholder="City or market" /></label>
          <label><span>Service area</span><input value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} placeholder="Regions or branches" /></label>
          <label><span>Client logo URL</span><input value={form.clientLogoUrl} onChange={(event) => setForm({ ...form, clientLogoUrl: event.target.value })} placeholder="Optional image URL" /></label>
          <label><span>Google Business Profile URL</span><input value={form.gbpUrl} onChange={(event) => setForm({ ...form, gbpUrl: event.target.value })} placeholder="Optional profile URL" /></label>
          <label className="full"><span>Competitor websites</span><textarea value={form.competitorUrls} onChange={(event) => setForm({ ...form, competitorUrls: event.target.value })} placeholder="One competitor URL per line" /></label>
        </div>
      </details>
      <button className="portal-primary" disabled={!form.targetUrl.trim()} onClick={async () => {
        setStatus("");
        setError("");
        const targetUrl = normalizeWebsiteEntry(form.targetUrl);
        if (!targetUrl) {
          setError("Enter a valid public website address.");
          return;
        }
        try {
          const created = await createProject({
            tenantSlug,
            targetUrl,
            projectName: form.projectName,
            clientCompanyName: form.clientCompanyName,
            contactPerson: form.contactPerson,
            clientLogoUrl: form.clientLogoUrl,
            businessType: form.businessType,
            targetCountry: form.targetCountry,
            targetLocation: form.targetLocation || form.city,
            city: form.city,
            serviceArea: form.serviceArea,
            gbpUrl: form.gbpUrl,
            competitorUrls,
            monitoringConfig: { cadence: "weekly", enabled: false }
          });
          setStatus("Website added.");
          await refresh();
          navigate("/projects/" + encodeURIComponent(created.project.workspaceId));
        } catch (projectError) {
          setError(projectError instanceof Error ? projectError.message : "Unable to add this website.");
        }
      }}><Globe2 size={17} />Add Website</button>
      {status && <div className="portal-status inline">{status}</div>}
      {error && <div className="portal-alert inline">{error}</div>}
    </div>
  );
}
function PortalProjectDetail({ workspaceId, navigate }: { workspaceId: string; navigate: (path: string) => void }) {
  const [project, setProject] = useState<PortalProjectSummary | null>(null);
  const [reports, setReports] = useState<PortalReportSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [journeyIndex, setJourneyIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    getProject(workspaceId).then((payload) => setProject(payload.project)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load this website."));
    getProjectReports(workspaceId).then((payload) => setReports(payload.items)).catch(() => setReports([]));
  }, [workspaceId]);

  async function generateIntelligence() {
    if (!project) return;
    setGenerating(true);
    setError("");
    setJourneyIndex(0);
    setStatus(intelligenceJourneyStages[0] ?? "Preparing intelligence");

    try {
      const started = await runProjectScan(project.workspaceId, { mode: "full_audit", includeSeo: true });
      for (let poll = 0; poll < 120; poll += 1) {
        await portalDelay(2500);
        let job;
        try {
          job = await getScanJob(started.jobId);
        } catch (pollError) {
          if ((pollError as Error & { status?: number }).status === 429) {
            await portalDelay((pollError as Error & { retryAfterMs?: number }).retryAfterMs ?? 5000);
            continue;
          }
          throw pollError;
        }

        if (job.status === "completed") {
          const snapshotId = typeof job.result?.["snapshotId"] === "string" ? job.result["snapshotId"] : "";
          if (!snapshotId) throw new Error("The report was prepared but could not be opened.");
          setJourneyIndex(intelligenceJourneyStages.length - 1);
          setStatus("Your Executive Business Intelligence Report is ready.");
          const updatedReports = await getProjectReports(project.workspaceId);
          setReports(updatedReports.items);
          window.location.assign("/reports/" + encodeURIComponent(snapshotId));
          return;
        }

        if (["failed", "dead_letter", "cancelled"].includes(job.status)) {
          throw new Error(job.errorMessage || "The report could not be prepared. Please try again.");
        }

        const completed = job.progress?.completedSteps ?? 0;
        const total = job.progress?.totalSteps ?? 0;
        const index = total > 0 ? Math.floor((completed / Math.max(total, 1)) * intelligenceJourneyStages.length) : Math.floor(poll / 5);
        const nextIndex = Math.min(intelligenceJourneyStages.length - 1, Math.max(0, index));
        setJourneyIndex(nextIndex);
        setStatus(intelligenceJourneyStages[nextIndex] ?? "Preparing intelligence");
      }
      throw new Error("Your report is taking longer than expected. It will appear in Reports when complete.");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to prepare this report.");
    } finally {
      setGenerating(false);
    }
  }

  if (!project) return <main className="portal-main"><PortalPageHeader eyebrow="Client Website" title="Loading website" /><div className="portal-alert">{error || "Loading..."}</div></main>;

  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="Client Website" title={project.projectName} actions={<button className="portal-secondary" onClick={() => navigate("/clients")}>Back to clients</button>} />
      <section className="portal-dashboard-grid">
        <div className="portal-panel wide">
          <h2>{safeHostLabel(project.targetUrl)}</h2>
          <div className="portal-signal-grid">
            <MetricTile label="Client" value={project.clientCompanyName ?? project.projectName} />
            <MetricTile label="Contact" value={project.contactPerson ?? "Not set"} />
            <MetricTile label="Business type" value={project.businessType ?? "Detected during analysis"} />
            <MetricTile label="Location" value={project.city ?? project.targetLocation ?? "Detected when available"} />
            <MetricTile label="Service area" value={project.serviceArea ?? project.targetLocation ?? "Detected when available"} />
            <MetricTile label="Competitors" value={project.competitorUrls.length ? String(project.competitorUrls.length) : "Detected when available"} />
          </div>
          <button className="portal-primary" disabled={generating} onClick={() => void generateIntelligence()}>{generating ? "Preparing intelligence" : "Generate Executive Business Intelligence"}</button>
          {generating && <div className="portal-compact-progress"><div><span>{status}</span><strong>{Math.round(((journeyIndex + 1) / intelligenceJourneyStages.length) * 100)}%</strong></div><div className="portal-progress-track"><span style={{ width: Math.round(((journeyIndex + 1) / intelligenceJourneyStages.length) * 100) + "%" }} /></div></div>}
          {!generating && status && <div className="portal-status inline">{status}</div>}
          {error && <div className="portal-alert inline">{error}</div>}
        </div>
        <div className="portal-panel wide"><h2>Executive Reports</h2><ReportList reports={reports} /></div>
      </section>
    </main>
  );
}
function ProjectList({ projects, navigate }: { projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  if (!projects.length) return <p className="portal-muted">No client websites yet.</p>;
  return <div className="portal-table">{projects.map((project) => <button key={project.workspaceId} className="portal-table-row" onClick={() => navigate(`/projects/${project.workspaceId}`)}><span><strong>{project.projectName}</strong><small>{safeHostLabel(project.targetUrl)}</small></span><span>{project.latestReport?.visualStateLabel ?? "No report yet"}</span><span>{project.latestReport?.oss === null || project.latestReport?.oss === undefined ? "Not scored" : `${project.latestReport.oss}/100`}</span></button>)}</div>;
}

function PortalReports({ projects, navigate }: { projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  const reports = projects.map((project) => project.latestReport).filter((report): report is PortalReportSummary => Boolean(report));
  return <main className="portal-main"><PortalPageHeader eyebrow="Reports" title="Executive intelligence reports" actions={<button className="portal-primary" onClick={() => navigate("/projects")}><Globe2 size={17} />Analyze a website</button>} /><section className="portal-panel wide"><ReportList reports={reports} />{!reports.length && <div className="portal-empty-action"><p className="portal-muted">Your reports will appear here after the first website analysis.</p><button className="portal-primary" onClick={() => navigate("/dashboard")}>Analyze Your First Website</button></div>}</section></main>;
}

function ReportList({ reports }: { reports: PortalReportSummary[] }) {
  const [downloadingId, setDownloadingId] = useState("");
  const [sharedId, setSharedId] = useState("");
  const [error, setError] = useState("");

  async function downloadPdf(report: PortalReportSummary) {
    setError("");
    setDownloadingId(report.snapshotId);
    try {
      const blob = await downloadReportPdf(report.snapshotId);
      savePortalBlob(blob, report.snapshotId + ".pdf");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "PDF download failed.");
    } finally {
      setDownloadingId("");
    }
  }

  async function shareReport(report: PortalReportSummary) {
    setError("");
    const reportPath = report.brandedReportUrl || report.reportUrl;
    const url = new URL(reportPath, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: "Executive Business Intelligence Report", text: "Your SYSTOLAB executive report is ready.", url });
      } else {
        await copyPortalText(url);
      }
      setSharedId(report.snapshotId);
      window.setTimeout(() => setSharedId(""), 2500);
    } catch (shareError) {
      if ((shareError as DOMException).name === "AbortError") return;
      setError(shareError instanceof Error ? shareError.message : "Unable to share this report.");
    }
  }

  if (!reports.length) return <p className="portal-muted">No reports available yet.</p>;
  return <><div className="portal-table">{reports.map((report) => {
    const openUrl = report.brandedReportUrl || report.reportUrl;
    return <div key={report.snapshotId} className="portal-table-row static"><span><strong>{safeHostLabel(report.targetUrl)}</strong><small>{new Date(report.createdAt).toLocaleString()}{report.expiresAt ? " | Valid until " + new Date(report.expiresAt).toLocaleDateString() : ""}</small>{report.brandedReportUrl && <small>{report.brandedReportUrl}</small>}</span><span>{report.visualStateLabel}</span><span>{report.oss === null ? "Not scored" : report.oss + "/100"}</span><a className="portal-secondary" href={openUrl}>Open <ArrowRight size={15} /></a><button className="portal-secondary" type="button" onClick={() => void shareReport(report)}><Share2 size={15} />{sharedId === report.snapshotId ? "Shared" : "Share"}</button><button className="portal-secondary" type="button" disabled={downloadingId === report.snapshotId} onClick={() => void downloadPdf(report)}><FileText size={15} />{downloadingId === report.snapshotId ? "Preparing" : "PDF"}</button></div>;
  })}</div>{error && <div className="portal-alert inline">{error}</div>}</>;
}

async function copyPortalText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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
  return <main className="portal-main"><PortalPageHeader eyebrow="Billing" title="Plan, report capacity, and API access" /><section className="portal-band pricing-grid">{(overview?.plans ?? plans).map((plan) => <PricingCard key={plan.planId} plan={plan} />)}</section><section className="portal-panel"><h2>Current usage</h2><div className="portal-signal-grid"><MetricTile label="Agency" value={tenant?.branding.publicName ?? "Not set up"} /><MetricTile label="Reports" value={`${overview?.usage.scanLimit.used ?? 0}/${overview?.usage.scanLimit.limit ?? 0}`} /><MetricTile label="API calls" value={`${overview?.usage.apiCallLimit.used ?? 0}/${overview?.usage.apiCallLimit.limit ?? 0}`} /></div></section></main>;
}
function PortalAgencyStart({ refresh }: { refresh: () => Promise<void> }) {
  const [name, setName] = useState("My Agency");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="My Agency" title="Set up your agency identity" />
      <section className="portal-panel portal-agency-start">
        <div><h2>Start with your agency name</h2><p className="portal-muted">You can add your logo, colors, contact details, and report footer next.</p></div>
        <div className="portal-inline-form">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agency name" />
          <button className="portal-primary" disabled={!name.trim() || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await ensureAgency(name.trim());
              await refresh();
            } catch (agencyError) {
              setError(agencyError instanceof Error ? agencyError.message : "Unable to set up your agency.");
            } finally {
              setSaving(false);
            }
          }}>{saving ? "Setting up" : "Set Up My Agency"}</button>
        </div>
        {error && <div className="portal-alert inline">{error}</div>}
      </section>
    </main>
  );
}

function PortalWhiteLabel({ tenant, agencyOperating, refresh, refreshAgencyOperating }: { tenant: PortalTenantSummary | null; agencyOperating: AgencyOperatingSystemResponse | null; refresh: () => Promise<void>; refreshAgencyOperating: () => Promise<void> }) {
  const [branding, setBranding] = useState<TenantBranding | null>(() => tenant?.branding ?? null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [serviceCatalogText, setServiceCatalogText] = useState("");
  const [knowledgeText, setKnowledgeText] = useState({ caseStudies: "", methodologies: "", faqs: "", pricing: "", serviceDescriptions: "" });
  useEffect(() => setBranding(tenant?.branding ?? null), [tenant?.tenantSlug]);
  useEffect(() => {
    setServiceCatalogText(catalogTextFromItems(agencyOperating?.serviceCatalog ?? []));
    setKnowledgeText({
      caseStudies: (agencyOperating?.knowledgeBase.caseStudies ?? []).join("\n"),
      methodologies: (agencyOperating?.knowledgeBase.methodologies ?? []).join("\n"),
      faqs: (agencyOperating?.knowledgeBase.faqs ?? []).join("\n"),
      pricing: (agencyOperating?.knowledgeBase.pricing ?? []).join("\n"),
      serviceDescriptions: (agencyOperating?.knowledgeBase.serviceDescriptions ?? []).join("\n")
    });
  }, [agencyOperating?.tenantSlug]);

  function readImageUpload(event: ChangeEvent<HTMLInputElement>, field: "logoUrl" | "faviconUrl" | "digitalSignature" | "consultantPhotoUrl") {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Upload an image file.");
      return;
    }
    if (file.size > 750_000) {
      setError("Image must be 750 KB or smaller for reliable self-contained storage.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding((current) => current ? { ...current, [field]: String(reader.result ?? "") } : current);
    reader.onerror = () => setError("Unable to read image file.");
    reader.readAsDataURL(file);
  }

  const parseLines = (value: string) => value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  const listText = (items?: string[]) => (items ?? []).join("\n");

  if (!tenant || !branding) return <PortalAgencyStart refresh={refresh} />;
  const services = branding.serviceOfferings?.length ? branding.serviceOfferings : ["SEO", "Website Development", "Google Ads", "CRO", "Local SEO", "AI Search Optimization"];
  const poweredByMode = branding.poweredByMode ?? "systolab_standard";
  const crm = branding.crmIntegration ?? { enabled: false, provider: "none" as const, deliveryMode: "internal_outbox" as const };
  const pdfSecurity = branding.pdfSecurity ?? { passwordProtected: false, downloadRestriction: "none" as const, auditDownloads: false, tamperSeal: false };
  const followUp = branding.followUpAssets ?? {};
  const successCenter = branding.agencySuccessCenter ?? { enabled: true, salesScriptTone: "consultative" as const };

  async function saveBranding() {
    if (!tenant || !branding) return;
    setStatus("");
    setError("");
    try {
      await updateWhiteLabelBranding(tenant.tenantSlug, whiteLabelEditablePayload(branding));
      setStatus("Agency settings saved.");
      await refresh();
    } catch (brandingError) {
      setError(brandingError instanceof Error ? brandingError.message : "Unable to update your agency settings.");
    }
  }

  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="My Agency" title="Your brand, contact details, and client experience" />
      <section className="portal-panel portal-agency-quick">
        <div className="portal-section-heading"><div><span className="portal-eyebrow">Quick setup</span><h2>Complete your client-facing identity</h2></div><span className="portal-setup-time">Core agency setup</span></div>
        <div className="portal-form-grid portal-agency-core-grid">
          <label><span>Company name</span><input value={branding.publicName} onChange={(event) => setBranding({ ...branding, publicName: event.target.value })} /></label>
          <label><span>Company website</span><input value={branding.websiteUrl ?? ""} onChange={(event) => setBranding({ ...branding, websiteUrl: event.target.value })} placeholder="https://agency.com" /></label>
          <label><span>Support email</span><input value={branding.supportEmail ?? ""} onChange={(event) => setBranding({ ...branding, supportEmail: event.target.value })} placeholder="support@agency.com" /></label>
          <label><span>Phone number</span><input value={branding.phoneNumber ?? ""} onChange={(event) => setBranding({ ...branding, phoneNumber: event.target.value })} placeholder="+1 555 123 4567" /></label>
          <label><span>Upload logo</span><input type="file" accept="image/*" onChange={(event) => readImageUpload(event, "logoUrl")} /></label>
          <label><span>Primary color</span><input type="color" value={branding.primaryColor} onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })} /></label>
          <label><span>Accent color</span><input type="color" value={branding.accentColor} onChange={(event) => setBranding({ ...branding, accentColor: event.target.value })} /></label>
          <label className="full"><span>Report footer</span><textarea value={branding.reportFooter ?? ""} onChange={(event) => setBranding({ ...branding, reportFooter: event.target.value })} placeholder="Agency contact and report footer text" /></label>
        </div>
        <button className="portal-primary" onClick={() => void saveBranding()}>Save Agency Branding</button>
        {status && <div className="portal-status inline">{status}</div>}
        {error && <div className="portal-alert inline">{error}</div>}
      </section>
      <details className="portal-advanced-setup">
        <summary><span>Advanced Setup</span><small>Domains, report design, proposals, CRM, PDF security, sales assets, and agency knowledge</small></summary>
        <section className="portal-dashboard-grid">
        <div className="portal-panel wide">
          <h2>Partner Information</h2>
          <div className="portal-form-grid">
            <label><span>Company name</span><input value={branding.publicName} onChange={(e) => setBranding({ ...branding, publicName: e.target.value })} /></label>
            <label><span>Website</span><input value={branding.websiteUrl ?? ""} onChange={(e) => setBranding({ ...branding, websiteUrl: e.target.value })} placeholder="https://agency.com" /></label>
            <label><span>Support email</span><input value={branding.supportEmail ?? ""} onChange={(e) => setBranding({ ...branding, supportEmail: e.target.value })} placeholder="support@agency.com" /></label>
            <label><span>Phone number</span><input value={branding.phoneNumber ?? ""} onChange={(e) => setBranding({ ...branding, phoneNumber: e.target.value })} placeholder="+1 xxx xxx xxxx" /></label>
            <label className="full"><span>Office address</span><textarea value={branding.officeAddress ?? ""} onChange={(e) => setBranding({ ...branding, officeAddress: e.target.value })} placeholder="Office address shown in report contact section" /></label>
            <label><span>Consultant name</span><input value={branding.consultantName ?? ""} onChange={(e) => setBranding({ ...branding, consultantName: e.target.value })} placeholder="Account manager" /></label>
            <label><span>Consultant email</span><input value={branding.consultantEmail ?? ""} onChange={(e) => setBranding({ ...branding, consultantEmail: e.target.value })} placeholder="consultant@agency.com" /></label>
            <label><span>Upload consultant photo</span><input type="file" accept="image/*" onChange={(event) => readImageUpload(event, "consultantPhotoUrl")} /></label>
            <label><span>Consultant photo URL</span><input value={branding.consultantPhotoUrl ?? ""} onChange={(e) => setBranding({ ...branding, consultantPhotoUrl: e.target.value })} placeholder="Optional photo" /></label>
            <label><span>Primary report domain</span><input value={branding.customDomain ?? ""} onChange={(e) => setBranding({ ...branding, customDomain: e.target.value })} placeholder="reports.agency.com" /></label>
            <label className="full"><span>Allowed report domains</span><textarea value={listText(branding.customDomains)} onChange={(e) => setBranding({ ...branding, customDomains: parseLines(e.target.value) })} placeholder="reports.agency.com\naudit.agency.com\nintelligence.company.com" /></label>
            <label><span>Domain status</span><input value={branding.customDomainStatus ?? "not_configured"} disabled /></label>
            <label><span>DNS target</span><input value={branding.customDomainVerificationTarget ?? `${tenant.tenantSlug}.systolab.app`} disabled /></label>
          </div>
        </div>

        <div className="portal-panel wide">
          <h2>Brand Assets</h2>
          <div className="portal-form-grid">
            <label><span>Upload logo</span><input type="file" accept="image/*" onChange={(event) => readImageUpload(event, "logoUrl")} /></label>
            <label><span>Logo URL</span><input value={branding.logoUrl ?? ""} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} placeholder="Upload or paste logo URL" /></label>
            <label><span>Upload favicon</span><input type="file" accept="image/*" onChange={(event) => readImageUpload(event, "faviconUrl")} /></label>
            <label><span>Favicon URL</span><input value={branding.faviconUrl ?? ""} onChange={(e) => setBranding({ ...branding, faviconUrl: e.target.value })} placeholder="Optional favicon" /></label>
            <label><span>Primary color</span><input type="color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} /></label>
            <label><span>Secondary color</span><input type="color" value={branding.secondaryColor ?? "#17201d"} onChange={(e) => setBranding({ ...branding, secondaryColor: e.target.value })} /></label>
            <label><span>Accent color</span><input type="color" value={branding.accentColor} onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })} /></label>
            <label><span>Font family</span><input value={branding.typography ?? ""} onChange={(e) => setBranding({ ...branding, typography: e.target.value })} placeholder="Inter, Arial, system" /></label>
            <label><span>Cover design</span><select value={branding.coverPageDesign ?? "executive"} onChange={(e) => setBranding({ ...branding, coverPageDesign: e.target.value as TenantBranding["coverPageDesign"] })}><option value="executive">Executive</option><option value="classic">Classic</option><option value="minimal">Minimal</option></select></label>
            <label><span>Powered by mode</span><select value={poweredByMode} onChange={(e) => setBranding({ ...branding, poweredByMode: e.target.value as TenantBranding["poweredByMode"] })}><option value="full_white_label">Full White Label</option><option value="co_branded">Co-Branded</option><option value="systolab_standard">SYSTOLAB Standard</option></select></label>
          </div>
        </div>

        <div className="portal-panel wide">
          <h2>Report Copy & Contact</h2>
          <div className="portal-form-grid">
            <label><span>Report title</span><input value={branding.reportTitle ?? ""} onChange={(e) => setBranding({ ...branding, reportTitle: e.target.value })} placeholder="Website Growth & Decision Intelligence Report" /></label>
            <label><span>Header text</span><input value={branding.reportHeaderText ?? ""} onChange={(e) => setBranding({ ...branding, reportHeaderText: e.target.value })} placeholder="Website Growth Assessment" /></label>
            <label><span>Report language</span><select value={branding.reportLanguage ?? "en"} onChange={(e) => setBranding({ ...branding, reportLanguage: e.target.value as TenantBranding["reportLanguage"] })}><option value="en">English</option><option value="ar">Arabic</option><option value="fr">French</option><option value="de">German</option><option value="es">Spanish</option><option value="hi">Hindi</option></select></label>
            <label><span>Icon style</span><select value={branding.iconStyle ?? "line"} onChange={(e) => setBranding({ ...branding, iconStyle: e.target.value as TenantBranding["iconStyle"] })}><option value="line">Line</option><option value="solid">Solid</option><option value="minimal">Minimal</option></select></label>
            <label><span>Valid days</span><input type="number" min="1" max="365" value={branding.reportValidityDays ?? 30} onChange={(e) => setBranding({ ...branding, reportValidityDays: Number(e.target.value) })} /></label>
            <label className="full"><span>Report introduction</span><textarea value={branding.reportIntroduction ?? ""} onChange={(e) => setBranding({ ...branding, reportIntroduction: e.target.value })} placeholder="Short executive introduction shown on the cover page" /></label>
            <label><span>Primary CTA label</span><input value={branding.primaryCtaLabel ?? ""} onChange={(e) => setBranding({ ...branding, primaryCtaLabel: e.target.value })} placeholder="Book a strategy call" /></label>
            <label><span>Primary CTA URL</span><input value={branding.primaryCtaUrl ?? ""} onChange={(e) => setBranding({ ...branding, primaryCtaUrl: e.target.value })} placeholder="https://agency.com/book" /></label>
            <label><span>Secondary CTA label</span><input value={branding.secondaryCtaLabel ?? ""} onChange={(e) => setBranding({ ...branding, secondaryCtaLabel: e.target.value })} placeholder="Request a proposal" /></label>
            <label><span>Secondary CTA URL</span><input value={branding.secondaryCtaUrl ?? ""} onChange={(e) => setBranding({ ...branding, secondaryCtaUrl: e.target.value })} placeholder="https://agency.com/proposal" /></label>
            <label className="full"><span>Validity statement</span><textarea value={branding.validityStatement ?? ""} onChange={(e) => setBranding({ ...branding, validityStatement: e.target.value })} placeholder="Recommendations based on scan date and valid for 30 days" /></label>
            <label><span>Thank-you page title</span><input value={branding.thankYouPageTitle ?? ""} onChange={(e) => setBranding({ ...branding, thankYouPageTitle: e.target.value })} placeholder="Thank You" /></label>
            <label><span>QR code URL</span><input value={branding.qrCodeUrl ?? ""} onChange={(e) => setBranding({ ...branding, qrCodeUrl: e.target.value })} placeholder="Optional consultation QR image URL" /></label>
            <label className="full"><span>Thank-you message</span><textarea value={branding.thankYouPageMessage ?? ""} onChange={(e) => setBranding({ ...branding, thankYouPageMessage: e.target.value })} placeholder="Final-page message for clients" /></label>
            <label><span>WhatsApp link</span><input value={branding.whatsappLink ?? ""} onChange={(e) => setBranding({ ...branding, whatsappLink: e.target.value })} placeholder="https://wa.me/..." /></label>
            <label><span>Calendar booking link</span><input value={branding.calendarBookingLink ?? ""} onChange={(e) => setBranding({ ...branding, calendarBookingLink: e.target.value })} placeholder="Booking URL" /></label>
            <label className="full"><span>Custom welcome message</span><textarea value={branding.dashboardWelcomeMessage ?? ""} onChange={(e) => setBranding({ ...branding, dashboardWelcomeMessage: e.target.value })} placeholder="Shown in portal preview and report cover context" /></label>
            <label className="full"><span>Report footer text</span><textarea value={branding.reportFooter ?? ""} onChange={(e) => setBranding({ ...branding, reportFooter: e.target.value })} placeholder="Shown in PDF footer and contact page" /></label>
            <label className="full"><span>Custom disclaimer</span><textarea value={branding.disclaimerText ?? ""} onChange={(e) => setBranding({ ...branding, disclaimerText: e.target.value })} placeholder="Custom report disclaimer" /></label>
            <label><span>Upload digital signature</span><input type="file" accept="image/*" onChange={(event) => readImageUpload(event, "digitalSignature")} /></label>
            <label><span>Digital signature URL</span><input value={branding.digitalSignature ?? ""} onChange={(e) => setBranding({ ...branding, digitalSignature: e.target.value })} placeholder="Optional signature image" /></label>
          </div>
        </div>

        <div className="portal-panel wide">
          <h2>Proposal Mode</h2>
          <div className="portal-form-grid">
            <label><span>Enable proposal mode</span><input type="checkbox" checked={Boolean(branding.proposalModeEnabled)} onChange={(e) => setBranding({ ...branding, proposalModeEnabled: e.target.checked })} /></label>
            <label><span>Estimated timeline</span><input value={branding.proposalTimeline ?? ""} onChange={(e) => setBranding({ ...branding, proposalTimeline: e.target.value })} placeholder="2-4 weeks" /></label>
            <label><span>Investment range</span><input value={branding.proposalInvestmentRange ?? ""} onChange={(e) => setBranding({ ...branding, proposalInvestmentRange: e.target.value })} placeholder="Starting from $..." /></label>
            <label><span>Agency service outcome note</span><input value={branding.proposalExpectedServiceOutcome ?? ""} onChange={(e) => setBranding({ ...branding, proposalExpectedServiceOutcome: e.target.value })} placeholder="How your service helps implement the locked findings" /></label>
            <label className="full"><span>Proposal deliverables</span><textarea value={listText(branding.proposalDeliverables)} onChange={(e) => setBranding({ ...branding, proposalDeliverables: parseLines(e.target.value) })} placeholder="Technical SEO fixes\nLanding page improvements\nLocal SEO optimization" /></label>
          </div>
        </div>

        <div className="portal-panel wide">
          <h2>CRM, PDF Security, And Follow-Up Assets</h2>
          <div className="portal-form-grid">
            <label><span>CRM enabled</span><input type="checkbox" checked={crm.enabled} onChange={(e) => setBranding({ ...branding, crmIntegration: { ...crm, enabled: e.target.checked } })} /></label>
            <label><span>CRM provider</span><select value={crm.provider} onChange={(e) => setBranding({ ...branding, crmIntegration: { ...crm, provider: e.target.value as NonNullable<TenantBranding["crmIntegration"]>["provider"] } })}><option value="none">None</option><option value="hubspot">HubSpot</option><option value="gohighlevel">GoHighLevel</option><option value="salesforce">Salesforce</option><option value="zoho">Zoho CRM</option><option value="pipedrive">Pipedrive</option><option value="custom_webhook">Custom Webhook</option></select></label>
            <label><span>CRM destination</span><input value={crm.destinationLabel ?? ""} onChange={(e) => setBranding({ ...branding, crmIntegration: { ...crm, destinationLabel: e.target.value } })} placeholder="Pipeline or list name" /></label>
            <label><span>Delivery mode</span><select value={crm.deliveryMode} onChange={(e) => setBranding({ ...branding, crmIntegration: { ...crm, deliveryMode: e.target.value as NonNullable<TenantBranding["crmIntegration"]>["deliveryMode"] } })}><option value="internal_outbox">Internal outbox</option><option value="manual_export">Manual export</option></select></label>
            <label><span>PDF password mode</span><input type="checkbox" checked={pdfSecurity.passwordProtected} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, passwordProtected: e.target.checked } })} /></label>
            <label><span>Password hint</span><input value={pdfSecurity.passwordHint ?? ""} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, passwordHint: e.target.value } })} placeholder="Shared with client separately" /></label>
            <label><span>Watermark text</span><input value={pdfSecurity.watermarkText ?? ""} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, watermarkText: e.target.value } })} placeholder="Confidential" /></label>
            <label><span>Download restriction</span><select value={pdfSecurity.downloadRestriction} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, downloadRestriction: e.target.value as NonNullable<TenantBranding["pdfSecurity"]>["downloadRestriction"] } })}><option value="none">None</option><option value="authenticated_only">Authenticated only</option><option value="expires_after_validity">Expires after validity</option></select></label>
            <label><span>Audit downloads</span><input type="checkbox" checked={pdfSecurity.auditDownloads} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, auditDownloads: e.target.checked } })} /></label>
            <label><span>Tamper seal</span><input type="checkbox" checked={pdfSecurity.tamperSeal} onChange={(e) => setBranding({ ...branding, pdfSecurity: { ...pdfSecurity, tamperSeal: e.target.checked } })} /></label>
            <label><span>Follow-up email subject</span><input value={followUp.emailSubject ?? ""} onChange={(e) => setBranding({ ...branding, followUpAssets: { ...followUp, emailSubject: e.target.value } })} placeholder="Your website growth report is ready" /></label>
            <label><span>WhatsApp message</span><input value={followUp.whatsappMessage ?? ""} onChange={(e) => setBranding({ ...branding, followUpAssets: { ...followUp, whatsappMessage: e.target.value } })} placeholder="Short WhatsApp follow-up" /></label>
            <label className="full"><span>Proposal email body</span><textarea value={followUp.proposalEmailBody ?? ""} onChange={(e) => setBranding({ ...branding, followUpAssets: { ...followUp, proposalEmailBody: e.target.value } })} placeholder="Email copy for sending the proposal" /></label>
            <label className="full"><span>Presentation summary</span><textarea value={followUp.presentationSummary ?? ""} onChange={(e) => setBranding({ ...branding, followUpAssets: { ...followUp, presentationSummary: e.target.value } })} placeholder="Short talking points for client presentation" /></label>
          </div>
        </div>

        <div className="portal-panel wide">
          <h2>Agency Success Center Defaults</h2>
          <div className="portal-form-grid">
            <label><span>Enable Success Center</span><input type="checkbox" checked={successCenter.enabled} onChange={(e) => setBranding({ ...branding, agencySuccessCenter: { ...successCenter, enabled: e.target.checked } })} /></label>
            <label><span>Default pricing tier</span><input value={successCenter.defaultPricingTier ?? ""} onChange={(e) => setBranding({ ...branding, agencySuccessCenter: { ...successCenter, defaultPricingTier: e.target.value } })} placeholder="Growth Package" /></label>
            <label><span>Sales script tone</span><select value={successCenter.salesScriptTone ?? "consultative"} onChange={(e) => setBranding({ ...branding, agencySuccessCenter: { ...successCenter, salesScriptTone: e.target.value as NonNullable<TenantBranding["agencySuccessCenter"]>["salesScriptTone"] } })}><option value="consultative">Consultative</option><option value="direct">Direct</option><option value="executive">Executive</option></select></label>
          </div>
        </div>
        <div className="portal-panel wide">
          <h2>Optional Business Details</h2>
          <div className="portal-form-grid">
            <label><span>Business registration</span><input value={branding.businessRegistration ?? ""} onChange={(e) => setBranding({ ...branding, businessRegistration: e.target.value })} /></label>
            <label><span>License number</span><input value={branding.licenseNumber ?? ""} onChange={(e) => setBranding({ ...branding, licenseNumber: e.target.value })} /></label>
            <label className="full"><span>Social media links</span><textarea value={listText(branding.socialLinks)} onChange={(e) => setBranding({ ...branding, socialLinks: parseLines(e.target.value) })} placeholder="One social profile per line" /></label>
            <label className="full"><span>Services shown on final page</span><textarea value={listText(services)} onChange={(e) => setBranding({ ...branding, serviceOfferings: parseLines(e.target.value) })} placeholder="SEO\nWebsite Development\nGoogle Ads" /></label>
          </div>
          <button className="portal-primary full" onClick={async () => {
            setStatus("");
            setError("");
            try {
              await saveBranding();
            } catch (brandingError) {
              setError(brandingError instanceof Error ? brandingError.message : "Unable to update branding.");
            }
          }}>Save white-label settings</button>
          {status && <div className="portal-status inline">{status}</div>}
          {error && <div className="portal-alert inline">{error}</div>}
        </div>

        <div className="portal-panel wide">
          <h2>Agency Service Catalog & Knowledge Base</h2>
          <p className="portal-muted">These inputs customize agency implementation notes, proposal generation, and sales enablement. SYSTOLAB intelligence findings remain locked.</p>
          <div className="portal-form-grid">
            <label className="full"><span>Service catalog</span><textarea value={serviceCatalogText} onChange={(e) => setServiceCatalogText(e.target.value)} placeholder="SEO | seo | $1500\nWebsite Development | website | Fixed project" /></label>
            <label className="full"><span>Case studies</span><textarea value={knowledgeText.caseStudies} onChange={(e) => setKnowledgeText({ ...knowledgeText, caseStudies: e.target.value })} placeholder="One case study per line" /></label>
            <label className="full"><span>Methodologies</span><textarea value={knowledgeText.methodologies} onChange={(e) => setKnowledgeText({ ...knowledgeText, methodologies: e.target.value })} placeholder="One methodology per line" /></label>
            <label className="full"><span>FAQs</span><textarea value={knowledgeText.faqs} onChange={(e) => setKnowledgeText({ ...knowledgeText, faqs: e.target.value })} placeholder="One FAQ per line" /></label>
            <label><span>Pricing notes</span><textarea value={knowledgeText.pricing} onChange={(e) => setKnowledgeText({ ...knowledgeText, pricing: e.target.value })} placeholder="One pricing rule per line" /></label>
            <label><span>Service descriptions</span><textarea value={knowledgeText.serviceDescriptions} onChange={(e) => setKnowledgeText({ ...knowledgeText, serviceDescriptions: e.target.value })} placeholder="One service description per line" /></label>
          </div>
          <button className="portal-primary full" onClick={async () => {
            if (!tenant) return;
            setStatus("");
            setError("");
            try {
              await updateAgencyServiceCatalog(tenant.tenantSlug, parseServiceCatalogText(serviceCatalogText));
              await updateAgencyKnowledgeBase(tenant.tenantSlug, {
                caseStudies: parseLines(knowledgeText.caseStudies),
                methodologies: parseLines(knowledgeText.methodologies),
                faqs: parseLines(knowledgeText.faqs),
                pricing: parseLines(knowledgeText.pricing),
                serviceDescriptions: parseLines(knowledgeText.serviceDescriptions)
              });
              setStatus("Agency operating settings saved.");
              await refreshAgencyOperating();
            } catch (operatingError) {
              setError(operatingError instanceof Error ? operatingError.message : "Unable to update agency operating settings.");
            }
          }}>Save agency operating settings</button>
        </div>

        <div className="portal-panel brand-preview" style={{ "--brand": branding.primaryColor, "--accent": branding.accentColor } as CSSProperties}>
          {branding.logoUrl && <img className="brand-preview-logo" src={branding.logoUrl} alt={`${branding.publicName} logo`} />}
          <h2>{branding.publicName}</h2>
          <p>{branding.dashboardWelcomeMessage || "Your client portal, reports, exports, support identity, and custom domain inherit this brand."}</p>
          <div className="brand-preview-lines">
            <span>{branding.websiteUrl || "Website not set"}</span>
            <span>{branding.supportEmail || "Support email not set"}</span>
            <span>{branding.phoneNumber || "Phone not set"}</span>
            <span>{branding.consultantName ? `Consultant: ${branding.consultantName}` : "Consultant not set"}</span>
            <span>{poweredByMode === "full_white_label" ? "No SYSTOLAB branding" : poweredByMode === "co_branded" ? "Powered by SYSTOLAB footer" : "SYSTOLAB standard branding"}</span>
          </div>
          <button>{branding.reportTitle || "Website Growth & Decision Intelligence Report"}</button>
        </div>
        </section>
      </details>
    </main>
  );
}
function PortalClients({ tenant, agencyOperating, refresh, navigate }: { tenant: PortalTenantSummary | null; agencyOperating: AgencyOperatingSystemResponse | null; refresh: () => Promise<void>; navigate: (path: string) => void }) {
  const [noteByClient, setNoteByClient] = useState<Record<string, string>>({});
  const [statusByClient, setStatusByClient] = useState<Record<string, ClientFollowUpStatus>>({});
  const [actionStatus, setActionStatus] = useState("");
  const [error, setError] = useState("");
  const clients = agencyOperating?.clients ?? [];
  const followUpOptions: ClientFollowUpStatus[] = ["new", "contacted", "proposal_sent", "won", "lost", "on_hold"];

  async function saveClientState(client: ClientOperatingSummary) {
    if (!tenant) return;
    setActionStatus("");
    setError("");
    try {
      await updateClientWorkspaceState(tenant.tenantSlug, client.workspaceId, { followUpStatus: statusByClient[client.workspaceId] ?? client.followUpStatus, note: noteByClient[client.workspaceId] });
      setNoteByClient((current) => ({ ...current, [client.workspaceId]: "" }));
      setActionStatus(`${client.clientName} updated.`);
      await refresh();
    } catch (clientError) {
      setError(clientError instanceof Error ? clientError.message : "Unable to update this client.");
    }
  }

  async function createProposal(client: ClientOperatingSummary) {
    if (!tenant) return;
    setActionStatus("");
    setError("");
    try {
      const proposal = await generateAgencyProposal(tenant.tenantSlug, client.workspaceId);
      setActionStatus(`${proposal.templateName} generated for ${proposal.clientName}. Services: ${proposal.recommendedServices.join(", ") || "configure service catalog"}.`);
      await refresh();
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : "Unable to generate proposal.");
    }
  }

  if (!tenant) return <main className="portal-main"><PortalPageHeader eyebrow="Clients" title="Set up your agency before managing clients" actions={<button className="portal-primary" onClick={() => navigate("/agency")}>Set Up My Agency</button>} /></main>;
  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="Clients" title="Client progress, proposals, and report sharing" actions={<button className="portal-secondary" onClick={() => navigate("/projects")}>Add website</button>} />
      <section className="portal-dashboard-grid">
        <div className="portal-panel wide"><h2>Progress Tracking</h2><div className="portal-signal-grid"><MetricTile label="Clients" value={String(agencyOperating?.progress.clientsTracked ?? clients.length)} /><MetricTile label="Reports" value={String(agencyOperating?.progress.reportsGenerated ?? 0)} /><MetricTile label="Improved" value={String(agencyOperating?.progress.improvedClients ?? 0)} /><MetricTile label="Completed recommendations" value={String(agencyOperating?.progress.completedRecommendations ?? 0)} /></div></div>
        <div className="portal-panel wide"><h2>AI Sales Coach</h2><p className="portal-muted">Private agency-only sales coaching based on the latest client reports.</p><div className="portal-table">{(agencyOperating?.salesCoach.clientPlaybooks ?? []).slice(0, 4).map((playbook) => <div key={playbook.workspaceId} className="portal-table-row static"><span><strong>{playbook.clientName}</strong><small>{playbook.nextMeetingFocus}</small></span><span>{playbook.servicesToPitch.slice(0, 2).join(", ") || "Services pending"}</span><span>{playbook.estimatedEffort}</span></div>)}</div>{!(agencyOperating?.salesCoach.clientPlaybooks.length) && <p className="portal-muted">Run client reports to generate service pitches, objections, responses, agenda, and follow-up sequence.</p>}</div>
        <div className="portal-panel"><h2>Default Sharing</h2><MetricTile label="View" value={agencyOperating?.sharingDefaults.allowView ? "Allowed" : "Blocked"} /><MetricTile label="Download" value={agencyOperating?.sharingDefaults.allowDownload ? "Allowed" : "Blocked"} /><MetricTile label="Password" value={agencyOperating?.sharingDefaults.passwordProtected ? "Required" : "Not required"} /></div>
        {actionStatus && <div className="portal-status inline wide">{actionStatus}</div>}
        {error && <div className="portal-alert inline wide">{error}</div>}
        {clients.length ? clients.map((client) => (
          <article key={client.workspaceId} className="portal-panel wide">
            <h2>{client.clientName}</h2>
            <div className="portal-signal-grid">
              <MetricTile label="Website" value={safeHostLabel(client.targetUrl)} />
              <MetricTile label="Consultant" value={client.assignedConsultant ?? "Not assigned"} />
              <MetricTile label="Follow-up" value={titleCaseStatus(client.followUpStatus)} />
              <MetricTile label="First report" value={client.firstScan?.oss === null || client.firstScan?.oss === undefined ? "Not scored" : `${client.firstScan.oss}/100`} />
              <MetricTile label="Latest report" value={client.latestScan?.oss === null || client.latestScan?.oss === undefined ? "Not scored" : `${client.latestScan.oss}/100`} />
              <MetricTile label="Score delta" value={client.scoreDelta === null ? "No trend" : formatDelta(client.scoreDelta)} />
              <MetricTile label="Competitors" value={String(client.competitors.length)} />
              <MetricTile label="Remaining priorities" value={String(client.remainingPriorities)} />
            </div>
            <div className="health-snapshot compact"><HealthRow label="Report sharing" value={`${client.sharingControls.allowView ? "View" : "No view"} / ${client.sharingControls.allowDownload ? "Download" : "No download"} / ${client.sharingControls.allowShare ? "Share" : "Private"}`} /><HealthRow label="Renewal reminder" value={client.renewalReminderAt ? formatDateLabel(client.renewalReminderAt) : "Not set"} /><HealthRow label="Latest report" value={client.latestScan ? formatDateLabel(client.latestScan.capturedAt) : "No report yet"} /></div>
            <div className="portal-form-grid">
              <label><span>Follow-up status</span><select value={statusByClient[client.workspaceId] ?? client.followUpStatus} onChange={(event) => setStatusByClient((current) => ({ ...current, [client.workspaceId]: event.target.value as ClientFollowUpStatus }))}>{followUpOptions.map((option) => <option key={option} value={option}>{titleCaseStatus(option)}</option>)}</select></label>
              <label className="full"><span>Add note</span><textarea value={noteByClient[client.workspaceId] ?? ""} onChange={(event) => setNoteByClient((current) => ({ ...current, [client.workspaceId]: event.target.value }))} placeholder="Follow-up notes, client requests, renewal reminders, or implementation context" /></label>
            </div>
            <div className="portal-hero-actions"><button className="portal-primary" onClick={() => void saveClientState(client)}>Save client state</button><button className="portal-secondary" onClick={() => void createProposal(client)}>Generate proposal</button><button className="portal-secondary" onClick={() => navigate(`/projects/${client.workspaceId}`)}>Open client</button></div>
            {client.notes.length > 0 && <div className="portal-table">{client.notes.slice(0, 3).map((note) => <div key={note.noteId} className="portal-table-row static"><span><strong>{note.body}</strong><small>{formatDateLabel(note.createdAt)}</small></span></div>)}</div>}
          </article>
        )) : <div className="portal-panel wide"><h2>No clients yet</h2><p className="portal-muted">Add a client website to track reports, competitors, notes, proposals, recommendations, and progress over time.</p><button className="portal-primary" onClick={() => navigate("/projects")}>Add website</button></div>}
      </section>
    </main>
  );
}
function PortalSettings({ auth, tenant, navigate }: { auth: StoredPortalAuth | null; tenant: PortalTenantSummary | null; navigate: (path: string) => void }) {
  return (
    <main className="portal-main">
      <PortalPageHeader eyebrow="Settings" title="Account and agency controls" />
      <section className="portal-dashboard-grid portal-settings-grid">
        <div className="portal-panel">
          <h2>My Account</h2>
          <MetricTile label="Name" value={auth?.user.displayName || "Not set"} />
          <MetricTile label="Email" value={auth?.user.email || "Not set"} />
          <button className="portal-secondary full" onClick={() => navigate("/account")}>Manage account</button>
        </div>
        <div className="portal-panel">
          <h2>Security</h2>
          <MetricTile label="Account status" value={auth?.user.lifecycleState || "Unavailable"} />
          <MetricTile label="Google" value={auth?.user.googleVerified ? "Connected" : "Not connected"} />
          <button className="portal-secondary full" onClick={() => navigate("/security")}>Review sessions</button>
        </div>
        <div className="portal-panel">
          <h2>Agency</h2>
          <MetricTile label="Name" value={tenant?.branding.publicName || "Not set up"} />
          <MetricTile label="Branding" value={tenant?.branding.logoUrl ? "Logo added" : "Needs logo"} />
          <button className="portal-secondary full" onClick={() => navigate("/agency")}>Agency settings</button>
        </div>
      </section>
      <details className="portal-advanced-overview portal-settings-advanced">
        <summary>Advanced Setup <span>Team, billing, integrations, domains, and enterprise controls</span></summary>
        <div className="portal-band three-col">
          <PortalInfoCard title="Team & Permissions" body="Manage roles and access for owners, consultants, sales users, specialists, and viewers." />
          <PortalInfoCard title="Billing & Capacity" body="Review report limits, API capacity, and plan controls." />
          <PortalInfoCard title="Brand & Integrations" body="Configure domains, proposals, CRM delivery, PDF security, and agency knowledge." />
        </div>
        <div className="portal-hero-actions">
          <button className="portal-secondary" onClick={() => navigate("/team")}>Team</button>
          <button className="portal-secondary" onClick={() => navigate("/billing")}>Billing</button>
          <button className="portal-secondary" onClick={() => navigate("/agency")}>Enterprise agency controls</button>
        </div>
      </details>
    </main>
  );
}
function PortalAccountSecurity({ auth, security }: { auth: StoredPortalAuth | null; security: boolean }) {
  return <main className="portal-main"><PortalPageHeader eyebrow={security ? "Security" : "Account"} title={security ? "Sessions, devices, and sign-in controls" : "Profile and account identity"} /><section className="portal-dashboard-grid"><div className="portal-panel"><h2>{auth?.user.displayName || auth?.user.email || "SYSTOLAB user"}</h2><MetricTile label="Email" value={auth?.user.email ?? "Not linked"} /><MetricTile label="Phone" value={auth?.user.phone ?? "Not linked"} /><MetricTile label="Account status" value={auth?.user.lifecycleState ?? "Unknown"} /></div><div className="portal-panel"><h2>Current Sign In</h2><MetricTile label="Device" value={auth?.session.deviceLabel ?? "Current browser"} /><MetricTile label="Method" value={auth?.session.provider ?? "Unknown"} /><MetricTile label="Expires" value={auth?.session.expiresAt ? new Date(auth.session.expiresAt).toLocaleString() : "Unknown"} /></div></section></main>;
}

function PortalOperationsPage({ path, projects, navigate }: { path: PortalPath; projects: PortalProjectSummary[]; navigate: (path: string) => void }) {
  const labels: Record<string, { eyebrow: string; title: string; intro: string; items: Array<{ title: string; body: string }> }> = {
    "/monitoring": { eyebrow: "Monitoring", title: "Scheduled intelligence and change alerts", intro: "Track business-readiness movement, competitor changes, report freshness, and evidence coverage across client websites.", items: [{ title: "Cadence", body: "Daily, weekly, and monthly monitoring can be configured for each client website." }, { title: "Alerts", body: "Dashboard alerts highlight score drops, competitor improvements, and reports that need refreshing." }] },
    "/competitors": { eyebrow: "Competitors", title: "Competitive intelligence by client", intro: "Compare client websites against competitors and understand why competitors may be winning customer decisions.", items: [{ title: "Configured competitors", body: String(projects.reduce((sum, project) => sum + project.competitorUrls.length, 0)) + " competitor websites are currently tracked." }, { title: "Business implication", body: "Reports explain information gaps, trust gaps, and decision-support gaps, not just score differences." }] },
    "/recommendations": { eyebrow: "Recommendations", title: "Priorities and outcome tracking", intro: "See what to improve now, this month, and later based on validated evidence.", items: [{ title: "Outcome loop", body: "Recommendations connect to future reports, measured changes, and business outcome attribution." }, { title: "Implementation view", body: "Detailed implementation tasks remain available without diluting the executive summary." }] },
    "/team": { eyebrow: "Team", title: "Team roles and access", intro: "Control who can manage agency branding, clients, reports, billing, and account settings.", items: [{ title: "Agency roles", body: "Owners control billing, team, integrations, and agency settings." }, { title: "Client access", body: "Consultants and viewers receive only the access required for their work." }] },
    "/clients": { eyebrow: "Clients", title: "Client reporting and delivery", intro: "Give clients access to live reports, exports, progress history, and completed work.", items: [{ title: "Client access", body: "Visibility can be controlled separately for each client website." }, { title: "Exports", body: "Executive reports can be viewed online and downloaded as branded PDFs." }] }
  };
  const meta = labels[path] ?? labels["/monitoring"]!;
  return <main className="portal-main"><PortalPageHeader eyebrow={meta.eyebrow} title={meta.title} actions={<button className="portal-secondary" onClick={() => navigate("/projects")}>View client websites</button>} /><section className="portal-panel wide"><p>{meta.intro}</p></section><section className="portal-band two-col">{meta.items.map((item) => <PortalInfoCard key={item.title} title={item.title} body={item.body} />)}</section></main>;
}

function PortalWhiteLabelMarketing({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="White Label" title="Agency-branded client portals and reports" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band three-col"><PortalInfoCard title="Upload Logo" body="Use your agency identity across the portal, report pages, and customer-safe PDF exports." /><PortalInfoCard title="Brand Colors" body="Set primary and accent colors so the client experience feels owned by your organization." /><PortalInfoCard title="Client Portal" body="Add client websites and deliver reports through a fully branded client experience." /></section></main>;
}

function PortalTestimonials({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Testimonials" title="Built for agencies, operators, and decision makers" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band three-col"><PortalInfoCard title="Agency Owner" body="SYSTOLAB turns complex findings into business conversations clients understand." /><PortalInfoCard title="Growth Team" body="The report explains what to fix first and why it matters commercially." /><PortalInfoCard title="Consultant" body="White-label delivery makes the platform feel like part of our own service stack." /></section></main>;
}

function PortalContact({ navigate }: { navigate: (path: string) => void }) {
  return <main className="portal-main public"><PortalPageHeader eyebrow="Contact" title="Talk to SYSTOLAB" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Start Free</button>} /><section className="portal-band two-col"><PortalInfoCard title="Sales" body="Create an account to evaluate complimentary reports, agency branding, client management, and report delivery." /><PortalInfoCard title="Support" body="Use the Help Center for website analysis, report reading, agency branding, and account guidance." /></section></main>;
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
  return <PortalStaticPage eyebrow="Documentation" title="SYSTOLAB reports, client portal, and API" items={[{ title: "Authentication", body: "Google-first sign in, password access, one-time codes, and device sessions protect each account." }, { title: "Clients", body: "Each client website connects Website, SEO, local visibility, competitors, monitoring, reports, and delivery." }, { title: "API", body: "The SYSTOLAB API supports authenticated report generation and retrieval without paid third-party data APIs." }]} />;
}

function PortalHelp() {
  return <PortalStaticPage eyebrow="Help Center" title="Support for owners, agencies, and client users" items={[{ title: "Generate a report", body: "Enter a website to receive Website and SEO intelligence. Add competitor and local profile context whenever it is useful." }, { title: "Read reports", body: "Start with the executive narrative, health snapshot, competitor explanation, and prioritized recommendations." }, { title: "White-label", body: "Set brand colors, logo, support identity, report labels, and custom domain from the portal." }]} />;
}

function PortalDemo({ navigate }: { navigate: (path: string) => void }) {
  const [view, setView] = useState<"executive" | "evidence">("executive");
  return (
    <main className="portal-main public">
      <PortalPageHeader eyebrow="Interactive Sample Report" title="Experience the report before analyzing your website" actions={<button className="portal-primary" onClick={() => navigate("/signup")}>Analyze Your Website</button>} />
      <div className="portal-demo-toolbar">
        <div className="portal-segmented"><button className={view === "executive" ? "active" : ""} onClick={() => setView("executive")}>Executive View</button><button className={view === "evidence" ? "active" : ""} onClick={() => setView("evidence")}>Forensic View</button></div>
        <span>Illustrative sample</span>
      </div>
      {view === "executive" ? (
        <section className="portal-dashboard-grid portal-demo-report">
          <div className="portal-panel wide portal-value-panel">
            <span className="portal-eyebrow">Executive Summary</span>
            <h2>A strong business foundation with a clear opportunity to reduce customer decision friction.</h2>
            <p>The website explains its services clearly and provides visible contact paths. The largest opportunity is helping evaluating customers compare options, understand the process, and reach local trust evidence earlier.</p>
          </div>
          <div className="portal-panel">
            <h2>Business Health Snapshot</h2>
            <div className="health-snapshot compact"><HealthRow label="Customer Acquisition" value="Strong" /><HealthRow label="Customer Trust" value="Strong" /><HealthRow label="Decision Support" value="Moderate" /><HealthRow label="Competitive Position" value="Competitive" /><HealthRow label="Local Presence" value="Needs attention" /></div>
          </div>
          <div className="portal-panel wide">
            <h2>Why Competitors Are Winning</h2>
            <p>Competitors provide more decision-support content, including clearer process explanations, customer questions, and trust examples. This can reduce uncertainty before a prospect makes contact.</p>
            <div className="portal-signal-grid"><MetricTile label="Client decision support" value="Moderate" /><MetricTile label="Competitor decision support" value="Strong" /><MetricTile label="Priority" value="Close information gaps" /></div>
          </div>
          <div className="portal-panel">
            <h2>90-Day Priority</h2>
            <div className="portal-timeline"><span>Week 1: Clarify priority contact paths</span><span>Weeks 2-4: Answer high-intent questions</span><span>Month 2: Strengthen trust evidence</span><span>Month 3: Expand competitive authority</span></div>
          </div>
        </section>
      ) : (
        <section className="portal-panel portal-demo-evidence">
          <div className="portal-section-heading"><div><h2>Evidence behind the decisions</h2><p className="portal-muted">Expand each item to inspect the illustrative source observation and how it supports the conclusion.</p></div><span className="portal-evidence-strength">Evidence strength: High</span></div>
          <details><summary><span>Primary contact path is visible</span><strong>Validated</strong></summary><p>Observed in the primary navigation and first viewport. This supports a strong contact-access finding.</p><code>Header action: Request a consultation</code></details>
          <details><summary><span>Service process lacks a clear sequence</span><strong>Validated</strong></summary><p>Service pages explain outcomes but do not show what happens after a customer makes contact. This supports a decision-friction opportunity.</p><code>Observed process steps: 0 structured steps</code></details>
          <details><summary><span>Competitor answers more pre-contact questions</span><strong>Comparative</strong></summary><p>The illustrative competitor covers pricing guidance, timelines, and preparation questions that the client example does not answer.</p><code>Question families covered: client 3, competitor 7</code></details>
        </section>
      )}
    </main>
  );
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

function implementationNotesText(notes?: TenantBranding["agencyImplementationNotes"]): string {
  return (notes ?? []).map((item) => [item.recommendationId, item.note].filter(Boolean).join(" | ")).join("\n");
}

function parseImplementationNotes(value: string): TenantBranding["agencyImplementationNotes"] {
  return value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [first, ...rest] = line.split("|").map((part) => part.trim());
      if (rest.length === 0) return { note: first ?? "" };
      return { recommendationId: first || undefined, note: rest.join(" | ") };
    })
    .filter((item) => item.note);
}

function whiteLabelEditablePayload(branding: TenantBranding): Partial<TenantBranding> {
  return {
    publicName: branding.publicName,
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    consultantPhotoUrl: branding.consultantPhotoUrl,
    consultantEmail: branding.consultantEmail,
    consultantDesignation: branding.consultantDesignation,
    websiteUrl: branding.websiteUrl,
    phoneNumber: branding.phoneNumber,
    officeAddress: branding.officeAddress,
    googleMapsUrl: branding.googleMapsUrl,
    businessRegistration: branding.businessRegistration,
    licenseNumber: branding.licenseNumber,
    socialLinks: branding.socialLinks,
    consultantName: branding.consultantName,
    disclaimerText: branding.disclaimerText,
    coverPageDesign: branding.coverPageDesign,
    reportIntroduction: branding.reportIntroduction,
    reportHeaderText: branding.reportHeaderText,
    thankYouPageTitle: branding.thankYouPageTitle,
    thankYouPageMessage: branding.thankYouPageMessage,
    iconStyle: branding.iconStyle,
    qrCodeUrl: branding.qrCodeUrl,
    whatsappLink: branding.whatsappLink,
    whatsappNumber: branding.whatsappNumber,
    calendarBookingLink: branding.calendarBookingLink,
    digitalSignature: branding.digitalSignature,
    primaryCtaLabel: branding.primaryCtaLabel,
    primaryCtaUrl: branding.primaryCtaUrl,
    secondaryCtaLabel: branding.secondaryCtaLabel,
    secondaryCtaUrl: branding.secondaryCtaUrl,
    reportValidityDays: branding.reportValidityDays,
    validityStatement: branding.validityStatement,
    proposalModeEnabled: branding.proposalModeEnabled,
    proposalTimeline: branding.proposalTimeline,
    proposalInvestmentRange: branding.proposalInvestmentRange,
    proposalDeliverables: branding.proposalDeliverables,
    proposalExpectedServiceOutcome: branding.proposalExpectedServiceOutcome,
    proposalPageContent: branding.proposalPageContent,
    pricingPageContent: branding.pricingPageContent,
    crmIntegration: branding.crmIntegration,
    pdfSecurity: branding.pdfSecurity,
    reportLanguage: branding.reportLanguage,
    currency: branding.currency,
    timeZone: branding.timeZone,
    followUpAssets: branding.followUpAssets,
    agencySuccessCenter: branding.agencySuccessCenter,
    serviceOfferings: branding.serviceOfferings,
    aboutCompany: branding.aboutCompany,
    whyChooseUs: branding.whyChooseUs,
    portfolioItems: branding.portfolioItems,
    testimonials: branding.testimonials,
    agencyImplementationNotes: branding.agencyImplementationNotes,
    poweredByMode: branding.poweredByMode,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    accentColor: branding.accentColor,
    typography: branding.typography,
    loginBackgroundUrl: branding.loginBackgroundUrl,
    dashboardWelcomeMessage: branding.dashboardWelcomeMessage,
    emailSenderName: branding.emailSenderName,
    supportEmail: branding.supportEmail,
    privacyPolicyUrl: branding.privacyPolicyUrl,
    termsOfServiceUrl: branding.termsOfServiceUrl,
    reportTitle: branding.reportTitle,
    reportFooter: branding.reportFooter,
    customDomain: branding.customDomain,
    customDomains: branding.customDomains
  };
}
function catalogTextFromItems(items: AgencyOperatingSystemResponse["serviceCatalog"]) {
  return items.map((item) => [item.name, item.category, item.startingPrice ?? item.pricingModel ?? ""].filter(Boolean).join(" | ")).join("\n");
}

function parseServiceCatalogText(value: string): AgencyOperatingSystemResponse["serviceCatalog"] {
  const items: AgencyOperatingSystemResponse["serviceCatalog"] = [];
  value.split(/\n/).forEach((line, index) => {
    const [name, category, price] = line.split("|").map((part) => part.trim());
    if (name) items.push({ serviceId: `svc_custom_${index + 1}`, name, category: category || "other", startingPrice: price || undefined, active: true });
  });
  return items;
}
function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function titleCaseStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

function safeHostLabel(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "Website"; }
}

const featureCards = [
  { title: "Business Decision Reports", body: "Website and SEO findings are translated into executive decisions, health snapshots, competitor implications, and next actions." },
  { title: "Secure Account Access", body: "Google-first sign in, password access, one-time codes, and device controls protect customer accounts." },
  { title: "White-Label Portals", body: "Partners can configure brand identity, report labels, custom domains, support identity, and client-safe dashboards." },
  { title: "Client Intelligence", body: "Each client keeps its website, local visibility, competitors, location, monitoring, reports, and history together." },
  { title: "Usage and Billing Controls", body: "Free, Pro, Agency, and Enterprise plan limits are enforced through report and API usage tracking." },
  { title: "SYSTOLAB API", body: "A first-party API lets approved users generate intelligence and retrieve reports without paid data dependencies." }
];
