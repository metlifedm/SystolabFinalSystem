import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  Flag,
  Gauge,
  GitBranch,
  KeyRound,
  Layers,
  LineChart,
  Lock,
  Network,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  XCircle,
  Zap
} from "lucide-react";
import {
  adminLogin,
  adminLogout,
  downloadOperationsPdf,
  internalPlatformGet,
  internalPlatformPost,
  type AdminSession
} from "./api.js";

type AnyRecord = Record<string, unknown>;

interface ModuleRow {
  moduleId: string;
  name: string;
  version: string;
  dependencies: string[];
  permissions: string[];
  healthStatus: string;
  activationState: string;
  ownerTeam: string;
  auditHistory?: AnyRecord[];
}

interface JobRow {
  jobId: string;
  jobType: string;
  queue: string;
  priority: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor?: string;
  createdAt?: string;
}

interface ControlRow {
  recordId: string;
  controlType: string;
  status: string;
  scope: string;
  score?: number;
  payload?: AnyRecord;
  createdAt?: string;
}

interface WarehouseRow {
  recordId: string;
  grain: string;
  dimensions: AnyRecord;
  metrics: AnyRecord;
  sourceIds: string[];
  createdAt?: string;
}

interface FeatureFlagRow {
  flagKey: string;
  description: string;
  state: string;
  rolloutPercentage: number;
  workspaceAllowList?: string[];
  permissionKeys?: string[];
}

interface UserIntelligenceRow {
  userId: string;
  displayName: string;
  email?: string;
  phone?: string;
  googleId?: string;
  avatarUrl?: string;
  locale?: string;
  providers?: string[];
  emailVerified?: boolean;
  phoneVerified?: boolean;
  googleVerified?: boolean;
  lifecycleState?: string;
  loginFailureCount?: number;
  lockedUntil?: string;
  lastLoginAt?: string;
  createdAt?: string;
  activeSessions?: number;
  totalSessions?: number;
  totalSearches?: number;
  latestSearchAt?: string;
  latestTargetUrl?: string;
  latestOss?: number;
  sessions?: AnyRecord[];
  authTimeline?: AnyRecord[];
  searches?: AnyRecord[];
}

interface AdminBundle {
  overview: AnyRecord;
  modules: ModuleRow[];
  jobs: JobRow[];
  warehouse: WarehouseRow[];
  aiContext: AnyRecord;
  workspaces: AnyRecord[];
  evidence: AnyRecord[];
  apiGovernance: AnyRecord[];
  artifactVersions: AnyRecord[];
  disasterRecovery: ControlRow | null;
  observability: ControlRow | null;
  dataGovernance: ControlRow | null;
  validation: ControlRow[];
  slo: ControlRow[];
  realtime: ControlRow | null;
  governanceContract: ControlRow | null;
  lineage: AnyRecord[];
  dataQuality: ControlRow[];
  cost: ControlRow[];
  graph: AnyRecord[];
  featureFlags: FeatureFlagRow[];
  sandbox: ControlRow[];
  userJourney: AnyRecord;
  security: AnyRecord;
  userIntelligence: UserIntelligenceRow[];
  searchActivities: AnyRecord[];
}

const EMPTY_BUNDLE: AdminBundle = {
  overview: {},
  modules: [],
  jobs: [],
  warehouse: [],
  aiContext: {},
  workspaces: [],
  evidence: [],
  apiGovernance: [],
  artifactVersions: [],
  disasterRecovery: null,
  observability: null,
  dataGovernance: null,
  validation: [],
  slo: [],
  realtime: null,
  governanceContract: null,
  lineage: [],
  dataQuality: [],
  cost: [],
  graph: [],
  featureFlags: [],
  sandbox: [],
  userJourney: {},
  security: {},
  userIntelligence: [],
  searchActivities: []
};

const navItems = [
  { id: "executive", label: "Executive", icon: Gauge },
  { id: "scans", label: "Scans", icon: Activity },
  { id: "journey", label: "Users", icon: Users },
  { id: "decision", label: "Decision ROI", icon: BriefcaseBusiness },
  { id: "quality", label: "Quality", icon: ClipboardCheck },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "infrastructure", label: "Infrastructure", icon: Server },
  { id: "graph", label: "Graph", icon: Network }
] as const;

type AdminTab = (typeof navItems)[number]["id"];

export function AdminDashboard() {
  const [session, setSession] = useState<AdminSession | null>(readAdminSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bundle, setBundle] = useState<AdminBundle>(EMPTY_BUNDLE);
  const [activeTab, setActiveTab] = useState<AdminTab>("executive");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const connected = session !== null;
  const owner = session?.role === "owner";

  useEffect(() => {
    if (!session) return;
    void refresh();
  }, [session]);

  useEffect(() => {
    if (!session || !autoRefresh) return;
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [session, autoRefresh]);

  async function handleLogin() {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const result = await adminLogin(email, password);
      const newSession: AdminSession = { token: result.token, role: result.role, email: result.email, adminUserId: result.adminUserId };
      setSession(newSession);
      localStorage.setItem("systolab.admin", JSON.stringify(newSession));
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    if (session) {
      try { await adminLogout(session.token); } catch { /* best effort */ }
    }
    localStorage.removeItem("systolab.admin");
    setSession(null);
    setBundle(EMPTY_BUNDLE);
  }

  async function refresh(silent = false) {
    if (!session) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const loaded = await loadAdminBundle(session);
      setBundle(loaded);
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load admin dashboard");
      if (!silent) { setSession(null); localStorage.removeItem("systolab.admin"); }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function ownerAction(label: string, action: () => Promise<unknown>) {
    if (!owner) return;
    setLoading(true);
    setError("");
    try {
      await action();
      setStatus(`${label} completed`);
      await refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setLoading(false);
    }
  }

  async function exportPdf() {
    setError("");
    try {
      if (!session) return;
      const blob = await downloadOperationsPdf(session);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `systolab-operations-${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    }
  }

  if (!connected) {
    return (
      <div className="admin-shell admin-shell--login">
        <section className="admin-login-panel">
          <div className="admin-login-mark">
            <ShieldCheck size={34} />
          </div>
          <div>
            <p className="eyebrow">SYSTOLAB internal</p>
            <h1>Operations Intelligence Center</h1>
            <p className="admin-login-copy">Owner and Manager access for platform observability, governance, security, intelligence quality, and autonomous module discovery.</p>
          </div>
          <div className="admin-login-form">
            <label className="field">
              <span>Admin email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" autoComplete="current-password" onKeyDown={(e) => { if (e.key === "Enter") void handleLogin(); }} />
            </label>
            <button className="primary-button" type="button" disabled={!email || !password || loading} onClick={() => void handleLogin()}>
              <KeyRound size={17} />
              {loading ? "Signing in..." : "Sign In"}
            </button>
            {error && <div className="error-line">{error}</div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src="/systolab-mark.svg" alt="" />
          <div>
            <strong>SYSTOLAB OIC</strong>
            <span>{session?.role === "owner" ? "Owner control plane" : "Manager visibility mode"}</span>
          </div>
        </div>
        <nav className="admin-nav" aria-label="Operations sections">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={activeTab === item.id ? "active" : ""} type="button" onClick={() => setActiveTab(item.id)}>
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="admin-access-card">
          <span>{session?.email ?? ""}</span>
          <strong>{session?.role ?? ""}</strong>
          <small>{owner ? "Full governance controls enabled" : "Read-only operational visibility"}</small>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-commandbar">
          <div>
            <p className="eyebrow">Real-time platform operating system</p>
            <h1>Operations Intelligence Center</h1>
          </div>
          <div className="admin-actions">
            <button className="icon-button" type="button" title="Refresh" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" type="button" title={autoRefresh ? "Disable auto refresh" : "Enable auto refresh"} onClick={() => setAutoRefresh((value) => !value)}>
              <Zap size={18} className={autoRefresh ? "admin-live-icon" : ""} />
            </button>
            <button className="icon-button text-button" type="button" onClick={() => void exportPdf()}>
              <Download size={18} />
              PDF
            </button>
            <button className="icon-button" type="button" title="Sign out" onClick={() => void handleLogout()}>
              <XCircle size={18} />
            </button>
          </div>
        </header>

        {(status || error) && (
          <div className={error ? "admin-status admin-status--error" : "admin-status"}>
            {error || status}
          </div>
        )}

        {activeTab === "executive" && <ExecutiveSection bundle={bundle} />}
        {activeTab === "scans" && session && <ScanSection bundle={bundle} owner={owner} runAction={ownerAction} session={session} />}
        {activeTab === "journey" && <UserJourneySection bundle={bundle} />}
        {activeTab === "decision" && <DecisionSection bundle={bundle} />}
        {activeTab === "quality" && <QualitySection bundle={bundle} />}
        {activeTab === "security" && <SecuritySection bundle={bundle} />}
        {activeTab === "infrastructure" && session && <InfrastructureSection bundle={bundle} owner={owner} runAction={ownerAction} session={session} />}
        {activeTab === "graph" && <GraphSection bundle={bundle} />}
      </main>
    </div>
  );
}

async function loadAdminBundle(session: AdminSession): Promise<AdminBundle> {
  return internalPlatformGet<AdminBundle>("/dashboard", session);
}

function ExecutiveSection({ bundle }: { bundle: AdminBundle }) {
  const score = stabilityScore(bundle);
  const latestWarehouse = bundle.warehouse[0];
  const summary = executiveSummary(bundle, score);
  return (
    <section className="admin-grid admin-grid--executive">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Sparkles} title="Executive Intelligence Overview" subtitle="Continuously updated operational, commercial, quality, and learning visibility." />
        <div className="admin-kpi-grid">
          <Metric label="Registered users" value={num(bundle.userJourney.registeredUsers)} />
          <Metric label="Active users" value={num(bundle.userJourney.activeUsers)} />
          <Metric label="Active sessions" value={num(bundle.userJourney.activeSessions)} />
          <Metric label="Scan volume" value={num(metric(latestWarehouse, "scans"))} />
          <Metric label="Avg OSS" value={num(metric(latestWarehouse, "averageOss"))} />
          <Metric label="Reports" value={num(metric(latestWarehouse, "completedScans"))} />
          <Metric label="Recommendations" value={num(metric(latestWarehouse, "recommendations"))} />
          <Metric label="Revenue units" value={num(metric(latestWarehouse, "estimatedRevenueHighUnits"))} />
        </div>
        <div className="admin-summary-list">
          {summary.map((item) => (
            <div key={item} className="admin-summary-item">
              <Bot size={16} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        <SectionHead icon={Gauge} title="Operational Stability Score" subtitle="Transparent, auditable, lineage-aware score." />
        <div className="admin-score-ring">
          <strong>{score}</strong>
          <span>OSS ops</span>
        </div>
        <ScoreFactor label="Module health" value={percent(moduleHealth(bundle.modules))} />
        <ScoreFactor label="Data quality" value={percent(avgControl(bundle.dataQuality))} />
        <ScoreFactor label="Validation" value={percent(avgControl(bundle.validation))} />
        <ScoreFactor label="Scan SLO" value={percent(avgControl(bundle.slo))} />
        <p className="admin-note">Any future OSS logic change must pass governance, versioning, sandbox validation, benchmark recalculation, and historical comparability protection.</p>
      </div>

      <div className="admin-panel">
        <SectionHead icon={Layers} title="Autonomous Surface Discovery" subtitle="Modules discovered from the backend registry." />
        <div className="surface-list">
          {bundle.modules.slice(0, 10).map((item) => (
            <div key={item.moduleId} className="surface-row">
              <StatusDot status={item.healthStatus} />
              <div>
                <strong>{item.name}</strong>
                <span>{item.moduleId} - {item.version}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScanSection({ bundle, owner, runAction, session }: { bundle: AdminBundle; owner: boolean; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; session: AdminSession }) {
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Activity} title="Scan Intelligence Center" subtitle="Queue, lifecycle, latency, report creation, and replay intelligence." />
        <div className="admin-toolbar">
          <button className="primary-button" type="button" disabled={!owner} title={owner ? "Run due jobs" : "Owner access required"} onClick={() => void runAction("Run due jobs", () => internalPlatformPost("/jobs/run-due", { limit: 10 }, session, { destructive: true }))}>
            <Play size={16} />
            Run Due Jobs
          </button>
          <button className="secondary-button" type="button" disabled={!owner} title={owner ? "Materialize warehouse" : "Owner access required"} onClick={() => void runAction("Warehouse materialization", () => internalPlatformPost("/warehouse/materialize", { grain: "daily" }, session, { destructive: true }))}>
            <Database size={16} />
            Materialize
          </button>
        </div>
        <DataTable
          columns={["Job", "Queue", "Priority", "Status", "Attempts"]}
          rows={bundle.jobs.slice(0, 14).map((job) => [job.jobType, job.queue, String(job.priority), job.status, `${job.attempts}/${job.maxAttempts}`])}
        />
      </div>
      <ControlPanel title="Scan SLO" icon={Gauge} controls={bundle.slo} empty="No scan SLO records yet." />
      <div className="admin-panel">
        <SectionHead icon={GitBranch} title="Scan Replay Intelligence" subtitle="Lifecycle reconstruction from lineage, evidence, graph, and job records." />
        <ReplaySteps bundle={bundle} />
      </div>
    </section>
  );
}

function UserJourneySection({ bundle }: { bundle: AdminBundle }) {
  const timeline = arr(bundle.userJourney.timeline);
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Users} title="User Intelligence Center" subtitle="Every user, profile, session, search, report output, auth event, and engagement signal." />
        <div className="admin-kpi-grid compact">
          <Metric label="Registered" value={num(bundle.userJourney.registeredUsers)} />
          <Metric label="Active" value={num(bundle.userJourney.activeUsers)} />
          <Metric label="Sessions" value={num(bundle.userJourney.activeSessions)} />
          <Metric label="New 7d" value={num(bundle.userJourney.newUsers7d)} />
        </div>
        <DataTable
          columns={["User", "Email / Phone", "State", "Sessions", "Searches", "Latest search", "Latest OSS"]}
          rows={bundle.userIntelligence.slice(0, 30).map((user) => [
            user.displayName || user.userId,
            [user.email, user.phone].filter(Boolean).join(" / "),
            String(user.lifecycleState ?? "UNKNOWN"),
            `${user.activeSessions ?? 0}/${user.totalSessions ?? 0}`,
            String(user.totalSearches ?? 0),
            user.latestTargetUrl ?? "none",
            user.latestOss === undefined ? "n/a" : String(user.latestOss)
          ])}
        />
      </div>
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Search} title="User Search And Report Ledger" subtitle="What each user searched and what intelligence they received." />
        <DataTable
          columns={["User", "Searched URL", "Mode", "Snapshot", "OSS", "Risk", "Recommendations", "Revenue high", "Internal"]}
          rows={bundle.searchActivities.slice(0, 40).map((activity) => {
            const request = (activity.request as AnyRecord | undefined) ?? {};
            const result = (activity.result as AnyRecord | undefined) ?? {};
            const revenue = (result.revenueOpportunity as AnyRecord | undefined) ?? {};
            const snapshotId = String(result.snapshotId ?? "");
            return [
              String(activity.userName ?? activity.userEmail ?? "Anonymous visitor"),
              String(activity.targetUrl ?? request.targetUrl ?? ""),
              String(request.mode ?? ""),
              snapshotId,
              String(result.oss ?? ""),
              String(result.businessRisk ?? ""),
              String(result.recommendationCount ?? 0),
              String(revenue.high ?? 0),
              snapshotId ? <FullReportLink snapshotId={snapshotId} /> : "n/a"
            ];
          })}
        />
      </div>
      <UserDetailGrid users={bundle.userIntelligence.slice(0, 12)} />
      <div className="admin-panel">
        <SectionHead icon={LineChart} title="Adoption Signals" subtitle="Behavioral interpretation from first-party events." />
        <SignalList title="Retention" items={strArr(bundle.userJourney.retentionSignals)} />
        <SignalList title="Churn risk" items={strArr(bundle.userJourney.churnRisks)} />
        <SignalList title="Conversion drivers" items={strArr(bundle.userJourney.conversionDrivers)} />
      </div>
      <div className="admin-panel">
        <SectionHead icon={Activity} title="Authentication Timeline" subtitle="Recent login, OTP, password, session, lock, and throttle events." />
        <Timeline items={timeline.slice(0, 18)} primary="eventType" secondary="identifier" statusKey="success" />
      </div>
    </section>
  );
}

function UserDetailGrid({ users }: { users: UserIntelligenceRow[] }) {
  if (!users.length) {
    return (
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Users} title="User Profiles" subtitle="Profile details, sessions, auth timeline, and recent searches." />
        <p className="admin-note">No users have been recorded yet.</p>
      </div>
    );
  }
  return (
    <div className="admin-panel admin-panel--wide">
      <SectionHead icon={Users} title="User Profiles" subtitle="Name, email, phone, providers, sessions, verification, and recent report outputs." />
      <div className="user-detail-grid">
        {users.map((user) => (
          <article key={user.userId} className="user-detail-card">
            <div className="user-card-head">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{initials(user.displayName || user.email || user.phone || "U")}</span>}
              <div>
                <strong>{user.displayName || user.email || user.phone || "Unnamed user"}</strong>
                <small>{user.userId}</small>
              </div>
            </div>
            <dl className="user-facts">
              <dt>Email</dt><dd>{user.email ?? "not captured"}</dd>
              <dt>Phone</dt><dd>{user.phone ?? "not captured"}</dd>
              <dt>Providers</dt><dd>{(user.providers ?? []).join(", ") || "none"}</dd>
              <dt>Verified</dt><dd>{[user.emailVerified ? "email" : "", user.phoneVerified ? "phone" : "", user.googleVerified ? "google" : ""].filter(Boolean).join(", ") || "no"}</dd>
              <dt>State</dt><dd>{user.lifecycleState ?? "UNKNOWN"}</dd>
              <dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd>
              <dt>Searches</dt><dd>{String(user.totalSearches ?? 0)}</dd>
              <dt>Latest target</dt><dd>{user.latestTargetUrl ?? "none"}</dd>
            </dl>
            <div className="mini-ledger">
              <strong>Recent searches</strong>
              {(user.searches ?? []).slice(0, 4).map((search) => {
                const result = (search.result as AnyRecord | undefined) ?? {};
                const snapshotId = String(result.snapshotId ?? "");
                return (
                  <span key={String(search.activityId)}>
                    {String(search.targetUrl ?? "")} - OSS {String(result.oss ?? "n/a")} - {snapshotId || "no snapshot"}
                    {snapshotId && <FullReportLink snapshotId={snapshotId} compact />}
                  </span>
                );
              })}
              {!(user.searches ?? []).length && <span>No searches recorded.</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DecisionSection({ bundle }: { bundle: AdminBundle }) {
  const recommendationLineage = bundle.lineage.filter((item) => String(item.artifactType) === "recommendation");
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={BriefcaseBusiness} title="Decision Intelligence And ROI" subtitle="Recommendation to action to outcome to business impact." />
        <div className="admin-kpi-grid compact">
          <Metric label="Recommendation lineage" value={String(recommendationLineage.length)} />
          <Metric label="Outcome validations" value={num(metric(bundle.warehouse[0], "validationRows"))} />
          <Metric label="Value units" value={num(metric(bundle.warehouse[0], "estimatedRevenueHighUnits"))} />
          <Metric label="Graph records" value={String(bundle.graph.length)} />
        </div>
        <DataTable
          columns={["Artifact", "Confidence", "Evidence", "Decision path"]}
          rows={recommendationLineage.slice(0, 12).map((item) => [
            String(item.artifactId ?? "recommendation"),
            String(item.confidenceScore ?? 0),
            String((item.evidenceIds as unknown[] | undefined)?.length ?? 0),
            compactJson(item.decisionPath)
          ])}
        />
      </div>
      <ControlPanel title="Outcome Validation" icon={ClipboardCheck} controls={bundle.validation} empty="No validation controls yet." />
      <ControlPanel title="Cost And Profitability" icon={LineChart} controls={bundle.cost} empty="No cost controls yet." />
    </section>
  );
}

function QualitySection({ bundle }: { bundle: AdminBundle }) {
  return (
    <section className="admin-grid">
      <ControlPanel title="Intelligence Quality Center" icon={ClipboardCheck} controls={bundle.validation} empty="No intelligence validation records yet." wide />
      <ControlPanel title="Data Quality" icon={Database} controls={bundle.dataQuality} empty="No data quality records yet." />
      <div className="admin-panel">
        <SectionHead icon={ShieldCheck} title="Governance Contract" subtitle="Single source of truth for rules and scoring methods." />
        <ControlSummary control={bundle.governanceContract} />
        <SignalList title="Policy" items={strArr(bundle.governanceContract?.payload?.governs)} />
      </div>
      <div className="admin-panel">
        <SectionHead icon={Layers} title="Artifact Versioning" subtitle="OSS, classification, recommendation, benchmark, confidence, and report versions." />
        <DataTable
          columns={["Artifact", "Version", "Hash"]}
          rows={bundle.artifactVersions.slice(0, 8).map((item) => [String(item.artifactType ?? ""), String(item.version ?? ""), String(item.hash ?? "").slice(0, 16)])}
        />
      </div>
    </section>
  );
}

function SecuritySection({ bundle }: { bundle: AdminBundle }) {
  const security = bundle.security;
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={ShieldCheck} title="Security Intelligence Layer" subtitle="Authentication, sessions, suspicious activity, API governance, and investigation signals." />
        <div className="admin-kpi-grid compact">
          <Metric label="Posture" value={String(security.securityPosture ?? "stable")} />
          <Metric label="Auth failures" value={num(security.authFailures)} />
          <Metric label="Locks" value={num(security.lockEvents)} />
          <Metric label="Throttles" value={num(security.throttleEvents)} />
        </div>
        <Timeline items={arr(security.recentEvents).slice(0, 16)} primary="eventType" secondary="reason" statusKey="success" />
      </div>
      <div className="admin-panel">
        <SectionHead icon={KeyRound} title="API Governance" subtitle="Auth, quota, audit, versioning, and developer controls." />
        <DataTable
          columns={["Path", "Status", "Quota"]}
          rows={bundle.apiGovernance.slice(0, 10).map((item) => [String(item.path ?? ""), String(item.statusCode ?? ""), `${String(item.quotaUsed ?? 0)}/${String(item.quotaLimit ?? 0)}`])}
        />
      </div>
      <ControlPanel title="Data Governance" icon={Lock} controls={bundle.dataGovernance ? [bundle.dataGovernance] : []} empty="No data governance status." />
    </section>
  );
}

function InfrastructureSection({ bundle, owner, runAction, session }: { bundle: AdminBundle; owner: boolean; runAction: (label: string, action: () => Promise<unknown>) => Promise<void>; session: AdminSession }) {
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Server} title="Infrastructure Intelligence Center" subtitle="Registry, jobs, observability, feature activation, DR, and sandbox controls." />
        <div className="admin-toolbar">
          <button className="primary-button" type="button" disabled={!owner} onClick={() => void runAction("Module validation", () => internalPlatformPost("/modules/validate", {}, session))}>
            <CheckCircle2 size={16} />
            Validate Modules
          </button>
          <button className="secondary-button" type="button" disabled={!owner} onClick={() => void runAction("Sandbox experiment", () => internalPlatformPost("/sandbox/experiments", { experimentName: "dashboard-shadow-calibration", sampleSize: 5 }, session, { destructive: true }))}>
            <Bot size={16} />
            Run Sandbox
          </button>
        </div>
        <div className="module-grid">
          {bundle.modules.map((item) => (
            <div key={item.moduleId} className="module-tile">
              <div>
                <StatusDot status={item.healthStatus} />
                <strong>{item.name}</strong>
              </div>
              <span>{item.moduleId}</span>
              <small>{item.activationState} - {item.version} - deps {item.dependencies.length}</small>
            </div>
          ))}
        </div>
      </div>
      <ControlPanel title="Observability" icon={Activity} controls={bundle.observability ? [bundle.observability] : []} empty="No observability state." />
      <ControlPanel title="Disaster Recovery" icon={AlertTriangle} controls={bundle.disasterRecovery ? [bundle.disasterRecovery] : []} empty="No DR state." />
      <div className="admin-panel">
        <SectionHead icon={Flag} title="Feature Flags" subtitle="Controlled rollout and workspace activation." />
        <DataTable columns={["Flag", "State", "Rollout"]} rows={bundle.featureFlags.map((flag) => [flag.flagKey, flag.state, `${flag.rolloutPercentage}%`])} />
      </div>
    </section>
  );
}

function GraphSection({ bundle }: { bundle: AdminBundle }) {
  return (
    <section className="admin-grid">
      <div className="admin-panel admin-panel--wide">
        <SectionHead icon={Network} title="Knowledge Graph And Lineage Explorer" subtitle="Business, scan, competitor, recommendation, evidence, benchmark, outcome, and history relationships." />
        <div className="admin-kpi-grid compact">
          <Metric label="Graph records" value={String(bundle.graph.length)} />
          <Metric label="Lineage rows" value={String(bundle.lineage.length)} />
          <Metric label="Evidence artifacts" value={String(bundle.evidence.length)} />
          <Metric label="Workspaces" value={String(bundle.workspaces.length)} />
        </div>
        <DataTable
          columns={["Graph", "Source", "Nodes", "Edges"]}
          rows={bundle.graph.slice(0, 12).map((item) => [
            String(item.graphId ?? ""),
            String(item.source ?? ""),
            String((item.metrics as AnyRecord | undefined)?.nodes ?? 0),
            String((item.metrics as AnyRecord | undefined)?.edges ?? 0)
          ])}
        />
      </div>
      <div className="admin-panel">
        <SectionHead icon={GitBranch} title="Lineage" subtitle="Traceability from decisions back to evidence." />
        <DataTable
          columns={["Artifact", "Type", "Evidence"]}
          rows={bundle.lineage.slice(0, 10).map((item) => [String(item.artifactId ?? ""), String(item.artifactType ?? ""), String((item.evidenceIds as unknown[] | undefined)?.length ?? 0)])}
        />
      </div>
      <div className="admin-panel">
        <SectionHead icon={Search} title="Workspace Intelligence" subtitle="Tenant-isolated environments." />
        <DataTable columns={["Workspace", "Tenant", "Target"]} rows={bundle.workspaces.slice(0, 10).map((item) => [String(item.workspaceId ?? ""), String(item.tenantSlug ?? ""), String(item.targetUrl ?? "")])} />
      </div>
    </section>
  );
}

function SectionHead({ icon: Icon, title, subtitle }: { icon: typeof Gauge; title: string; subtitle: string }) {
  return (
    <div className="admin-section-head">
      <div className="admin-section-icon">
        <Icon size={18} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreFactor({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-factor">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="score-track">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ControlPanel({ title, icon, controls, empty, wide = false }: { title: string; icon: typeof Gauge; controls: ControlRow[]; empty: string; wide?: boolean }) {
  return (
    <div className={wide ? "admin-panel admin-panel--wide" : "admin-panel"}>
      <SectionHead icon={icon} title={title} subtitle="Auditable operational control record." />
      {controls.length ? controls.slice(0, 10).map((control) => <ControlSummary key={control.recordId} control={control} />) : <p className="admin-note">{empty}</p>}
    </div>
  );
}

function ControlSummary({ control }: { control: ControlRow | null }) {
  if (!control) return <p className="admin-note">No control record available.</p>;
  return (
    <div className="control-summary">
      <div>
        <StatusDot status={control.status} />
        <strong>{control.controlType}</strong>
      </div>
      <span>{control.status} - score {control.score ?? "n/a"} - {control.scope}</span>
    </div>
  );
}

function FullReportLink({ snapshotId, compact = false }: { snapshotId: string; compact?: boolean }) {
  return (
    <a
      className={compact ? "admin-inline-link admin-inline-link--compact" : "admin-inline-link"}
      href={`/internal/reports/${encodeURIComponent(snapshotId)}`}
      target="_blank"
      rel="noreferrer"
    >
      Full report
    </a>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="admin-note">No records available.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`row-${index}`}>
              {row.map((cell, cellIndex) => <td key={`cell-${index}-${cellIndex}`}>{cell || "n/a"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items, primary, secondary, statusKey }: { items: AnyRecord[]; primary: string; secondary: string; statusKey?: string }) {
  if (!items.length) return <p className="admin-note">No timeline records available.</p>;
  return (
    <div className="admin-timeline">
      {items.map((item, index) => (
        <div key={`${String(item[primary])}-${index}`} className="timeline-item">
          <StatusDot status={statusKey ? String(item[statusKey]) : "healthy"} />
          <div>
            <strong>{String(item[primary] ?? "event")}</strong>
            <span>{String(item[secondary] ?? "")}</span>
            <small>{formatDate(item.createdAt)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function SignalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="signal-list">
      <strong>{title}</strong>
      {items.length ? items.map((item) => <span key={item}>{item}</span>) : <span>No signal detected.</span>}
    </div>
  );
}

function ReplaySteps({ bundle }: { bundle: AdminBundle }) {
  const steps = [
    ["Discovery", bundle.evidence.length],
    ["Classification", bundle.artifactVersions.filter((item) => String(item.artifactType).includes("classification")).length],
    ["Benchmark", bundle.artifactVersions.filter((item) => String(item.artifactType).includes("benchmark")).length],
    ["OSS", bundle.artifactVersions.filter((item) => String(item.artifactType).includes("oss")).length],
    ["Recommendation", bundle.lineage.filter((item) => String(item.artifactType) === "recommendation").length],
    ["Report", bundle.artifactVersions.filter((item) => String(item.artifactType).includes("report")).length]
  ];
  return (
    <div className="replay-steps">
      {steps.map(([label, count]) => (
        <div key={String(label)}>
          <CheckCircle2 size={16} />
          <span>{String(label)}</span>
          <strong>{String(count)}</strong>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const normalized = String(status).toLowerCase();
  const tone = normalized.includes("fail") || normalized.includes("risk") || normalized === "false" ? "bad" : normalized.includes("warn") || normalized.includes("degrad") ? "warn" : "good";
  return <i className={`status-dot ${tone}`} aria-hidden="true" />;
}

function readAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem("systolab.admin");
    if (!raw) return null;
    const payload = JSON.parse(raw) as Partial<AdminSession>;
    if (!payload.token || !payload.email || !payload.adminUserId) return null;
    return { token: payload.token, email: payload.email, adminUserId: payload.adminUserId, role: payload.role === "manager" ? "manager" : "owner" };
  } catch {
    return null;
  }
}

function stabilityScore(bundle: AdminBundle): number {
  return Math.round((moduleHealth(bundle.modules) + avgControl(bundle.dataQuality) + avgControl(bundle.validation) + avgControl(bundle.slo)) / 4);
}

function moduleHealth(modules: ModuleRow[]): number {
  if (!modules.length) return 0;
  return (modules.filter((item) => item.healthStatus === "healthy" && item.activationState === "active").length / modules.length) * 100;
}

function avgControl(controls: ControlRow[]): number {
  const values = controls.map((item) => Number(item.score ?? 0)).filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function executiveSummary(bundle: AdminBundle, score: number): string[] {
  const notes = [
    `Operational Stability Score is ${score}, derived from module health, validation, data quality, and scan SLO controls.`,
    `${bundle.modules.length} module(s) are visible through autonomous surface discovery.`,
    `${bundle.jobs.filter((job) => job.status === "dead_letter" || job.status === "failed").length} job(s) currently require operational attention.`,
    `Security posture is ${String(bundle.security.securityPosture ?? "stable")}.`,
    `${bundle.lineage.length} lineage record(s) and ${bundle.graph.length} graph record(s) are available for explainability.`
  ];
  if (bundle.featureFlags.some((flag) => flag.state !== "enabled")) notes.push("Some feature flags are staged or disabled; rollout controls are active.");
  return notes;
}

function metric(row: WarehouseRow | undefined, key: string): unknown {
  return row?.metrics?.[key] ?? 0;
}

function arr(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter((item): item is AnyRecord => typeof item === "object" && item !== null) : [];
}

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function num(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return String(value ?? "0");
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(parsed);
}

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function compactJson(value: unknown): string {
  if (!value) return "n/a";
  return JSON.stringify(value).slice(0, 120);
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}
