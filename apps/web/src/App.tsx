import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AiceDecisionObject,
  AuthResponse,
  AuthSessionSummary,
  AuthTokenPair,
  AuthUserProfile,
  AuthIdentifierType,
  OtpChallengeResponse,
  PasswordResetChallengeResponse,
  ReportSnapshot,
  ScanMode,
  ScanRequest,
  SpecCoverageItem
} from "@systolab/shared";
import { NOT_SCORED_VISUAL_STATE, visualStateForScore } from "@systolab/shared";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Braces,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileText,
  Gauge,
  History,
  Info,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Mail,
  MapPinned,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  TrendingUp
} from "lucide-react";
import {
  createScan,
  forgotPassword,
  getAuthSessions,
  getReport,
  getInternalFullReport,
  getScanJob,
  getSpecCoverage,
  googleAuth,
  loginPassword,
  logoutAuth,
  pdfUrl,
  recordEditEvent,
  refreshAuthSession,
  registerPassword,
  requestOtp,
  resetPassword,
  revokeAuthSession,
  verifyOtp
} from "./api.js";
import type { AdminSession } from "./api.js";
import { AdminDashboard } from "./AdminDashboard.js";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "./firebase.js";

export function App() {
  if (window.location.pathname.startsWith("/internal/reports/")) return <InternalReportPage />;
  if (window.location.pathname.startsWith("/admin")) return <AdminDashboard />;

  const [report, setReport] = useState<ReportSnapshot | null>(null);
  const [coverage, setCoverage] = useState<SpecCoverageItem[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    const [, route, snapshotId] = window.location.pathname.split("/");
    if (route === "reports" && snapshotId && snapshotId !== "undefined" && snapshotId !== "null") {
      setLoadingReport(true);
      getReport(snapshotId)
        .then(setReport)
        .catch((error) => console.error(error))
        .finally(() => setLoadingReport(false));
    }
    getSpecCoverage().then(setCoverage).catch(() => setCoverage([]));
  }, []);

  useFirstPartyEditTracking(report);

  return (
    <div className="app-shell">
      <Header report={report} />
      <main>
        <AuthConsole />
        <ScanConsole onReport={setReport} />
        {loadingReport && <div className="status-line">Loading full report...</div>}
        {report ? <InternalReportView report={report} coverage={coverage} audience="customer" /> : <EmptyState coverage={coverage} />}
      </main>
    </div>
  );
}

function InternalReportPage() {
  const [report, setReport] = useState<ReportSnapshot | null>(null);
  const [coverage, setCoverage] = useState<SpecCoverageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const [, , , snapshotId] = window.location.pathname.split("/");
    const session = readStoredAdminSession();
    getSpecCoverage().then(setCoverage).catch(() => setCoverage([]));

    if (!snapshotId || snapshotId === "undefined" || snapshotId === "null") {
      setError("Invalid snapshot ID.");
      setLoading(false);
      return;
    }
    if (!session) {
      setError("Admin login required. Open /admin, sign in, then reopen this full report.");
      setLoading(false);
      return;
    }

    getInternalFullReport(snapshotId, session)
      .then(setReport)
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Unable to load full internal report."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/systolab-mark.svg" alt="" />
          <div>
            <strong>SYSTOLAB Internal Full Report</strong>
            <span>{report ? `${safeHostLabel(report.targetUrl)} - ${report.snapshotId}` : "Admin-only full intelligence plane"}</span>
          </div>
        </div>
        <a className="icon-button text-button" href="/admin">
          <ShieldCheck size={18} />
          Admin
        </a>
      </header>
      <main>
        {loading && <div className="status-line">Loading full internal report...</div>}
        {error && <div className="status-line error">{error}</div>}
        {report && <InternalReportView report={report} coverage={coverage} audience="internal" />}
      </main>
    </div>
  );
}

function readStoredAdminSession(): AdminSession | null {
  try {
    const payload = JSON.parse(localStorage.getItem("systolab.admin") ?? "{}") as Partial<AdminSession>;
    if (!payload.token || !payload.email || !payload.adminUserId) return null;
    return {
      token: payload.token,
      email: payload.email,
      adminUserId: payload.adminUserId,
      role: payload.role === "manager" ? "manager" : "owner"
    };
  } catch {
    return null;
  }
}

function useFirstPartyEditTracking(report: ReportSnapshot | null) {
  useEffect(() => {
    if (!report) return;
    void sendEditEvent("report_viewed", report, {
      oss: report.oss?.score,
      recommendationCount: report.recommendationEngine?.recommendations.length ?? 0
    });
  }, [report?.snapshotId]);

  useEffect(() => {
    if (!report || !report.recommendationEngine?.recommendations.length) return;
    void sendEditEvent("recommendation_viewed", report, {
      recommendationIds: report.recommendationEngine?.recommendations?.slice(0, 5).map((item) => item.recommendationId)
    });
  }, [report?.snapshotId]);
}

function sendEditEvent(
  eventType: "scan_started" | "scan_completed" | "report_viewed" | "report_downloaded" | "recommendation_viewed" | "rescan_started",
  report: ReportSnapshot | null,
  metadata: Record<string, unknown> = {}
) {
  return recordEditEvent({
    snapshotId: report?.snapshotId,
    sessionFingerprint: getOrCreateDeviceId(),
    eventType,
    metadata: {
      ...metadata,
      targetUrl: report?.targetUrl ?? metadata.targetUrl
    }
  }).catch(() => undefined);
}

function Header({ report }: { report: ReportSnapshot | null }) {
  const title = report?.tenantBranding?.reportTitle ?? "SYSTOLAB Revenue Health Diagnosis";
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/systolab-mark.svg" alt="" />
        <div>
          <strong>{title}</strong>
          <span>{report?.tenantBranding?.poweredByLabel ?? "Powered by SYSTOLAB Revenue Intelligence Engine"}</span>
        </div>
      </div>
      {report && (
        <a
          className="icon-button text-button"
          href={pdfUrl(report.snapshotId)}
          target="_blank"
          rel="noreferrer"
          onClick={() => void sendEditEvent("report_downloaded", report)}
        >
          <Download size={18} />
          Full PDF
        </a>
      )}
    </header>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AuthConsole() {
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [user, setUser] = useState<AuthUserProfile | null>(() => readStoredAuth()?.user ?? null);
  const [tokens, setTokens] = useState<AuthTokenPair | null>(() => readStoredAuth()?.tokens ?? null);
  const [session, setSession] = useState<AuthSessionSummary | null>(() => readStoredAuth()?.session ?? null);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState("");

  const [authStep, setAuthStep] = useState<"landing" | "google" | "email-otp" | "otp-verify" | "password" | "reset" | "reset-verify">("landing");
  const [googleEmail, setGoogleEmail] = useState("");
  const [otpType, setOtpType] = useState<AuthIdentifierType>("email");
  const [otpIdentifier, setOtpIdentifier] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<OtpChallengeResponse | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [passwordType, setPasswordType] = useState<AuthIdentifierType>("email");
  const [passwordIdentifier, setPasswordIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetType, setResetType] = useState<AuthIdentifierType>("email");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetChallenge, setResetChallenge] = useState<PasswordResetChallengeResponse | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (!tokens?.accessToken) return;
    getAuthSessions(tokens.accessToken).then((payload) => setSessions(payload.sessions)).catch(() => setSessions([]));
  }, [tokens?.accessToken]);

  function applyAuth(result: AuthResponse) {
    setAuthError("");
    setAuthStatus(result.message);
    setUser(result.user);
    if (result.tokens) setTokens(result.tokens);
    if (result.session) setSession(result.session);
    if (result.tokens && result.session) {
      localStorage.setItem("systolab.auth", JSON.stringify({ user: result.user, tokens: result.tokens, session: result.session }));
      // Session list is refreshed by the useEffect that watches tokens?.accessToken
    }
  }

  async function runAuth(action: () => Promise<void>) {
    setAuthError("");
    try {
      await action();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    }
  }

  function buildGoogleCredential() {
    const fallbackName = googleEmail.split("@")[0] || "Google User";
    return ["dev", googleEmail, `google-${simpleId(googleEmail)}`, fallbackName, "", "", "", "en"]
      .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
      .join(":");
  }

  function goBack() {
    setAuthStep("landing");
    setAuthError("");
    setOtpChallenge(null);
    setResetChallenge(null);
  }

  async function handleGoogleSignIn() {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthStep("google");
      setAuthError("");
      return;
    }
    const auth = firebaseAuth;
    await runAuth(async () => {
      const { signInWithPopup, getAdditionalUserInfo } = await import("firebase/auth");
      const result = await signInWithPopup(auth!, googleProvider);
      const idToken = await result.user.getIdToken();
      const profile = getAdditionalUserInfo(result)?.profile as Record<string, string | undefined> | null | undefined;
      applyAuth(
        await googleAuth({
          credential: idToken,
          displayName: result.user.displayName ?? undefined,
          givenName: profile?.given_name,
          familyName: profile?.family_name,
          photoURL: result.user.photoURL ?? undefined,
          phoneNumber: result.user.phoneNumber ?? undefined,
          locale: profile?.locale,
          deviceId,
          deviceLabel: "SYSTOLAB Web"
        })
      );
    });
  }

  if (user) {
    return (
      <section className="auth-console auth-console--compact">
        <div className="auth-profile-bar">
          <div className="auth-profile-identity">
            <span className="auth-profile-name">{user.displayName || user.email || user.phone || "Verified user"}</span>
            <span className="auth-profile-sub">{user.email ?? user.phone} · {user.providers.join(", ")}</span>
          </div>
          <div className="auth-profile-actions">
            {tokens && (
              <button
                className="icon-button text-button"
                onClick={() => runAuth(async () => { applyAuth(await refreshAuthSession({ refreshToken: tokens.refreshToken, deviceId })); })}
              >
                <RefreshCw size={15} />
                Refresh session
              </button>
            )}
            <button
              className="icon-button text-button"
              onClick={() =>
                runAuth(async () => {
                  if (tokens) await logoutAuth({ refreshToken: tokens.refreshToken }, tokens.accessToken);
                  localStorage.removeItem("systolab.auth");
                  setUser(null);
                  setTokens(null);
                  setSession(null);
                  setSessions([]);
                })
              }
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
        {(authStatus || authError) && <div className={authError ? "error-line" : "status-line"}>{authError || authStatus}</div>}
      </section>
    );
  }

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="SYSTOLAB Secure Access">
      <div className="auth-page-card">
        <div className="auth-logo-row">
          <img src="/systolab-mark.svg" alt="SYSTOLAB" className="auth-logo-img" />
          <span className="auth-product-line">Operational Intelligence Platform</span>
        </div>
        <h1 className="auth-page-heading">SYSTOLAB Secure Access</h1>
        <p className="auth-value-prop">Generate evidence-backed operational intelligence and business visibility reports in minutes.</p>

        {authStep === "google" ? (
          <div className="auth-expandable-form">
            <label className="auth-form-field">
              <span className="auth-field-label">Google Account Email</span>
              <input
                className="auth-form-input"
                value={googleEmail}
                onChange={(e) => setGoogleEmail(e.target.value)}
                placeholder="name@gmail.com"
                type="email"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && googleEmail) runAuth(async () => applyAuth(await googleAuth({ credential: buildGoogleCredential(), deviceId, deviceLabel: "SYSTOLAB Web" }))); }}
              />
            </label>
            <button
              className="auth-google-btn"
              disabled={!googleEmail}
              onClick={() => runAuth(async () => applyAuth(await googleAuth({ credential: buildGoogleCredential(), deviceId, deviceLabel: "SYSTOLAB Web" })))}
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <button className="auth-back-link" onClick={goBack}>← Back to sign-in options</button>
          </div>
        ) : (
          <button className="auth-google-btn" onClick={handleGoogleSignIn}>
            <GoogleIcon />
            Continue with Google
          </button>
        )}

        <div className="auth-or-divider">OR</div>

        {authStep === "landing" && (
          <button className="auth-email-btn" onClick={() => { setAuthStep("email-otp"); setAuthError(""); }}>
            <Mail size={17} />
            Email / Phone Login
          </button>
        )}

        {authStep === "email-otp" && (
          <div className="auth-expandable-form">
            <div className="auth-type-toggle">
              <button className={otpType === "email" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setOtpType("email")}>Email</button>
              <button className={otpType === "phone" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setOtpType("phone")}>Phone</button>
            </div>
            <label className="auth-form-field">
              <span className="auth-field-label">{otpType === "email" ? "Email Address" : "Phone Number"}</span>
              <input
                className="auth-form-input"
                value={otpIdentifier}
                onChange={(e) => setOtpIdentifier(e.target.value)}
                placeholder={otpType === "email" ? "name@example.com" : "+15551234567"}
                type={otpType === "email" ? "email" : "tel"}
                autoFocus
              />
            </label>
            <button
              className="auth-submit-btn"
              disabled={!otpIdentifier}
              onClick={() =>
                runAuth(async () => {
                  const challenge = await requestOtp({ identifierType: otpType, identifier: otpIdentifier, purpose: "login", deviceId });
                  setOtpChallenge(challenge);
                  setOtpCode(challenge.simulatedDelivery.code ?? "");
                  setAuthStep("otp-verify");
                })
              }
            >
              Get One-Time Code
            </button>
            <div className="auth-alt-links">
              <button className="auth-text-link" onClick={() => { setPasswordType(otpType); setPasswordIdentifier(otpIdentifier); setAuthStep("password"); setAuthError(""); }}>
                Use password instead
              </button>
            </div>
            <button className="auth-back-link" onClick={goBack}>← Back</button>
          </div>
        )}

        {authStep === "otp-verify" && (
          <div className="auth-expandable-form">
            <p className="auth-otp-hint">
              Code sent to <strong>{otpChallenge?.maskedDestination}</strong>
              {otpChallenge?.simulatedDelivery.code && <span className="auth-dev-code"> · dev: {otpChallenge.simulatedDelivery.code}</span>}
            </p>
            <label className="auth-form-field">
              <span className="auth-field-label">One-Time Code</span>
              <input
                className="auth-form-input auth-form-input--otp"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus
                placeholder="000000"
              />
            </label>
            <button
              className="auth-submit-btn"
              disabled={!otpChallenge || !otpCode}
              onClick={() =>
                runAuth(async () => {
                  if (!otpChallenge) return;
                  applyAuth(await verifyOtp({ challengeId: otpChallenge.challengeId, code: otpCode, deviceId, deviceLabel: "SYSTOLAB Web" }));
                })
              }
            >
              <KeyRound size={16} />
              Verify & Sign In
            </button>
            <button className="auth-back-link" onClick={() => { setAuthStep("email-otp"); setOtpChallenge(null); }}>← Back</button>
          </div>
        )}

        {authStep === "password" && (
          <div className="auth-expandable-form">
            <div className="auth-type-toggle">
              <button className={passwordType === "email" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setPasswordType("email")}>Email</button>
              <button className={passwordType === "phone" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setPasswordType("phone")}>Phone</button>
            </div>
            <label className="auth-form-field">
              <span className="auth-field-label">{passwordType === "email" ? "Email Address" : "Phone Number"}</span>
              <input
                className="auth-form-input"
                value={passwordIdentifier}
                onChange={(e) => setPasswordIdentifier(e.target.value)}
                placeholder={passwordType === "email" ? "name@example.com" : "+15551234567"}
                type={passwordType === "email" ? "email" : "tel"}
                autoFocus
              />
            </label>
            <label className="auth-form-field">
              <span className="auth-field-label">Password</span>
              <input
                className="auth-form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
              />
            </label>
            <button
              className="auth-submit-btn"
              disabled={!passwordIdentifier || !password}
              onClick={() =>
                runAuth(async () => {
                  applyAuth(await loginPassword({ identifierType: passwordType, identifier: passwordIdentifier, password, deviceId, deviceLabel: "SYSTOLAB Web" }));
                })
              }
            >
              Sign In
            </button>
            <div className="auth-alt-links">
              <button
                className="auth-text-link"
                disabled={!passwordIdentifier || !password}
                onClick={() =>
                  runAuth(async () => {
                    const result = await registerPassword({ identifierType: passwordType, identifier: passwordIdentifier, password, displayName: passwordIdentifier.split("@")[0], deviceId });
                    setOtpChallenge(result.otpChallenge);
                    setOtpCode(result.otpChallenge.simulatedDelivery.code ?? "");
                    applyAuth(result);
                  })
                }
              >
                Create new account
              </button>
              <button className="auth-text-link" onClick={() => { setResetType(passwordType); setResetIdentifier(passwordIdentifier); setAuthStep("reset"); setAuthError(""); }}>
                Forgot password?
              </button>
            </div>
            <button className="auth-back-link" onClick={() => setAuthStep("email-otp")}>← Back to OTP login</button>
          </div>
        )}

        {authStep === "reset" && (
          <div className="auth-expandable-form">
            <div className="auth-type-toggle">
              <button className={resetType === "email" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setResetType("email")}>Email</button>
              <button className={resetType === "phone" ? "auth-type-btn active" : "auth-type-btn"} onClick={() => setResetType("phone")}>Phone</button>
            </div>
            <label className="auth-form-field">
              <span className="auth-field-label">Registered {resetType === "email" ? "Email" : "Phone"}</span>
              <input
                className="auth-form-input"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                placeholder={resetType === "email" ? "name@example.com" : "+15551234567"}
                autoFocus
              />
            </label>
            <button
              className="auth-submit-btn"
              disabled={!resetIdentifier}
              onClick={() =>
                runAuth(async () => {
                  const challenge = await forgotPassword({ identifierType: resetType, identifier: resetIdentifier, deviceId });
                  setResetChallenge(challenge);
                  setResetToken(challenge.simulatedDelivery.token ?? "");
                  setAuthStep("reset-verify");
                })
              }
            >
              Send Reset Link
            </button>
            <button className="auth-back-link" onClick={() => setAuthStep("password")}>← Back</button>
          </div>
        )}

        {authStep === "reset-verify" && (
          <div className="auth-expandable-form">
            <p className="auth-otp-hint">
              Reset link sent to <strong>{resetChallenge?.maskedDestination}</strong>
              {resetChallenge?.simulatedDelivery.token && <span className="auth-dev-code"> · dev: {resetChallenge.simulatedDelivery.token}</span>}
            </p>
            <label className="auth-form-field">
              <span className="auth-field-label">Reset Token</span>
              <input className="auth-form-input" value={resetToken} onChange={(e) => setResetToken(e.target.value)} autoFocus />
            </label>
            <label className="auth-form-field">
              <span className="auth-field-label">New Password</span>
              <input className="auth-form-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="••••••••" />
            </label>
            <button
              className="auth-submit-btn"
              disabled={!resetChallenge || !resetToken || !newPassword}
              onClick={() =>
                runAuth(async () => {
                  if (!resetChallenge) return;
                  applyAuth(await resetPassword({ resetId: resetChallenge.resetId, token: resetToken, newPassword, deviceId }));
                })
              }
            >
              Set New Password
            </button>
            <button className="auth-back-link" onClick={() => setAuthStep("reset")}>← Back</button>
          </div>
        )}

        <div className="auth-trust-row">
          <span className="auth-trust-item"><ShieldCheck size={13} />Secure Authentication</span>
          <span className="auth-trust-item"><Lock size={13} />Privacy Protected</span>
          <span className="auth-trust-item"><CheckCircle2 size={13} />No Credit Card Required</span>
        </div>

        {authError && <p className="auth-error-msg">{authError}</p>}
        {authStatus && !authError && <p className="auth-status-msg">{authStatus}</p>}
      </div>
    </div>
  );
}

function ScanConsole({ onReport }: { onReport: (report: ReportSnapshot) => void }) {
  const [targetUrl, setTargetUrl] = useState("");
  const [gbpUrl, setGbpUrl] = useState("");
  const [mode, setMode] = useState<ScanMode>("fast_scan");
  const [includeSeo, setIncludeSeo] = useState(false);
  const [monthlyLeadVolume, setMonthlyLeadVolume] = useState("");
  const [competitors, setCompetitors] = useState(["", "", "", "", ""]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setScanProgress("");
    setSubmitting(true);
    const request: ScanRequest = {
      targetUrl,
      mode,
      includeSeo,
      gbpUrl: gbpUrl || undefined,
      competitorUrls: competitors.filter(Boolean),
      monthlyLeadVolume: monthlyLeadVolume ? Number(monthlyLeadVolume) : undefined
    };

    try {
      void sendEditEvent("scan_started", null, { targetUrl, mode, competitorCount: request.competitorUrls?.length ?? 0 });

      // Scan is async — backend returns 202 with a jobId, not an immediate report
      const job = await createScan(request);
      setScanProgress("Scan queued — analysing website...");

      const MAX_POLLS = 90; // 3 minutes at 2s interval
      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        let jobStatus;
        try {
          jobStatus = await getScanJob(job.jobId);
        } catch (pollError) {
          if (isRateLimitError(pollError)) {
            setScanProgress("Scan is still running - slowing status checks...");
            await new Promise<void>((resolve) => setTimeout(resolve, pollError.retryAfterMs ?? 5000));
            continue;
          }
          throw pollError;
        }

        if (jobStatus.status === "completed") {
          const snapshotId = typeof jobStatus.result?.["snapshotId"] === "string"
            ? jobStatus.result["snapshotId"]
            : undefined;
          if (!snapshotId) {
            setError("Scan completed but no report was generated.");
            return;
          }
          window.history.replaceState(null, "", `/reports/${snapshotId}`);
          const report = await getReport(snapshotId);
          onReport(report);
          void sendEditEvent("scan_completed", report, { targetUrl, mode });
          setScanProgress("");
          return;
        }

        if (jobStatus.status === "failed") {
          setError(jobStatus.errorMessage ?? "Scan failed. Please try again.");
          return;
        }

        const steps = jobStatus.progress?.completedSteps ?? 0;
        const total = jobStatus.progress?.totalSteps ?? 0;
        const pct = total > 0 ? Math.round((steps / total) * 100) : Math.min(poll * 2, 90);
        setScanProgress(`Scanning... ${pct}%`);
      }

      setError("Scan is taking longer than expected. Please refresh and check back shortly.");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed");
    } finally {
      setSubmitting(false);
      setScanProgress("");
    }
  }

  return (
    <section className="scan-console">
      <div className="scan-grid">
        <label className="field target-field">
          <span>Website URL</span>
          <div className="input-with-icon">
            <Search size={18} />
            <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://example.com" />
          </div>
        </label>
        <ModeSwitch mode={mode} setMode={setMode} />
        <button className="primary-button" disabled={!targetUrl || isSubmitting} onClick={submit}>
          <Activity size={18} />
          {isSubmitting ? "Scanning" : "Run Scan"}
        </button>
      </div>

      <div className="option-grid">
        <label className="field">
          <span>Google Business Profile URL</span>
          <input value={gbpUrl} onChange={(event) => setGbpUrl(event.target.value)} placeholder="Optional public profile URL" />
        </label>
        <label className="field">
          <span>Monthly Lead Volume</span>
          <input
            value={monthlyLeadVolume}
            onChange={(event) => setMonthlyLeadVolume(event.target.value)}
            inputMode="numeric"
            placeholder="Optional"
          />
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={includeSeo} onChange={(event) => setIncludeSeo(event.target.checked)} />
          <span>Include isolated SEO insights</span>
        </label>
      </div>

      <div className="competitor-grid">
        {competitors.map((value, index) => (
          <label className="field" key={index}>
            <span>Competitor {index + 1}</span>
            <input
              value={value}
              onChange={(event) => {
                const next = [...competitors];
                next[index] = event.target.value;
                setCompetitors(next);
              }}
              placeholder="Optional"
            />
          </label>
        ))}
      </div>
      {scanProgress && !error && <div className="status-line">{scanProgress}</div>}
      {error && <div className="error-line">{error}</div>}
    </section>
  );
}

function ModeSwitch({ mode, setMode }: { mode: ScanMode; setMode: (mode: ScanMode) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Scan mode">
      <button className={mode === "fast_scan" ? "active" : ""} onClick={() => setMode("fast_scan")}>
        <Gauge size={17} />
        Fast
      </button>
      <button className={mode === "full_audit" ? "active" : ""} onClick={() => setMode("full_audit")}>
        <ShieldCheck size={17} />
        Full
      </button>
    </div>
  );
}

function EmptyState({ coverage }: { coverage: SpecCoverageItem[] }) {
  return (
    <section className="empty-grid">
      <div className="panel hero-panel">
        <div className="panel-kicker">Revenue intelligence console</div>
        <h1>Run a deterministic structural diagnosis.</h1>
        <p>Enter a website URL to generate the full diagnostic report with evidence, scores, recommendations, competitors, proof layers, and PDF export.</p>
      </div>
      <CoveragePanel coverage={coverage} />
    </section>
  );
}

function ContentUnavailableReportView({ report, coverage, style }: { report: ReportSnapshot; coverage: SpecCoverageItem[]; style: CSSProperties }) {
  const customerAssessment = (report as unknown as {
    customerAssessment?: {
      status?: string;
      evidenceCoverage?: string;
      confidence?: string;
      oss?: string;
      reason?: string;
      recommendedAction?: string;
    };
  }).customerAssessment;
  const interpretation = report.ossInterpretation ?? fallbackOssInterpretation(report);

  return (
    <article className="report" style={style}>
      <DecisionIntelligenceBriefSection report={report} />
      <LayerDivider title="Customer Intelligence Plane" />
      <section className="verdict-band">
        <div>
          <span className="panel-kicker">Limited assessment</span>
          <h1>{customerAssessment?.status ?? "Content Unavailable"}</h1>
          <p>{customerAssessment?.reason ?? interpretation.oneLineDiagnosis ?? "Website content could not be collected."}</p>
        </div>
        <div className="oss-gauge" style={{ borderColor: report.oss?.visualState?.color ?? "#64748b" }}>
          <strong style={{ color: report.oss?.visualState?.color ?? "#64748b" }}>{customerAssessment?.oss ?? "Not Scored"}</strong>
          <span>OSS</span>
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <Info size={18} />
          <h2>Assessment Status</h2>
        </div>
        <div className="meta-strip">
          <Metric label="Status" value={customerAssessment?.status ?? "Content Unavailable"} />
          <Metric label="Evidence Coverage" value={customerAssessment?.evidenceCoverage ?? "0%"} />
          <Metric label="Confidence" value={customerAssessment?.confidence ?? "Very Limited"} />
          <Metric label="OSS" value={customerAssessment?.oss ?? "Not Scored"} />
        </div>
        <p className="decision-summary">{customerAssessment?.reason ?? "Website content could not be collected."}</p>
        <p className="muted">Business impact, risk level, conversion loss, and revenue loss were not inferred because page evidence was unavailable.</p>
      </section>

      <section className="report-section">
        <div className="section-title">
          <CheckCircle2 size={18} />
          <h2>Recommended Action</h2>
        </div>
        <p className="decision-summary">{customerAssessment?.recommendedAction ?? "Review access/security/robots settings and re-run scan."}</p>
      </section>

      <CoveragePanel coverage={coverage} />
    </article>
  );
}

function InternalReportView({ report, coverage, audience = "customer" }: { report: ReportSnapshot; coverage: SpecCoverageItem[]; audience?: "customer" | "internal" }) {
  const style = {
    "--brand": report.tenantBranding?.primaryColor,
    "--accent": report.tenantBranding?.accentColor
  } as CSSProperties;

  if (audience === "customer" && isContentUnavailableReport(report)) {
    return <ContentUnavailableReportView report={report} coverage={coverage} style={style} />;
  }

  return (
    <article className="report" style={style}>
      <DecisionIntelligenceBriefSection report={report} />
      <LayerDivider title={audience === "internal" ? "Internal Decision Layer" : "Customer Decision Layer"} />
      <section className="verdict-band">
        <div>
          <span className="panel-kicker">3-Second Executive Clarity</span>
          <h1>{report.executiveClarity?.overallWebsiteStatus}</h1>
          <p>{(report.ossInterpretation ?? fallbackOssInterpretation(report)).oneLineDiagnosis}</p>
        </div>
        <div className="oss-gauge" style={{ borderColor: report.oss?.visualState?.color }}>
          <strong style={{ color: report.oss?.visualState?.color }}>{formatOssScore(report.oss?.score, false)}</strong>
          <span>{report.oss?.visualState?.label}</span>
        </div>
      </section>

      <ActionFirstPanelSection report={report} />
      <SystemVerdictSection report={report} />
      <OssInterpretationSection report={report} />

      <section className="report-section">
        <div className="section-title">
          <FileText size={18} />
          <h2>Screenshot Verdict Card</h2>
        </div>
        <div className="verdict-card-grid">
          <Metric label="Revenue Status" value={report.verdictCard?.revenueStatus} />
          <Metric label="Business Risk Status" value={report.verdictCard?.businessRiskStatus} />
          <Metric label="Top Issue" value={report.verdictCard?.topIssue} />
          <Metric label="Recoverable Opportunity" value={report.verdictCard?.recoverableOpportunity} />
          <Metric label="Highest-Leverage Action" value={report.verdictCard?.highestLeverageAction} />
        </div>
        <p className="muted">{report.oss?.explanation}</p>
      </section>

      <BusinessRiskSection report={report} />

      <LayerDivider title="Internal Structured Insight Layer" />
      <section className="report-section">
        <div className="section-title">
          <SlidersHorizontal size={18} />
          <h2>Scan Coverage Summary</h2>
        </div>
        <div className="data-table compact">
          {report.dataInputs?.map((input) => (
            <div className="table-row" key={input.source}>
              <span>{input.source}</span>
              <strong>{input.status}</strong>
              <small>{input.reason ?? "Captured as required input."}</small>
            </div>
          ))}
        </div>
        <div className="meta-strip">
          <Metric label="Coverage" value={report.scanCoverage?.coverageLabel} />
          {audience === "internal" && <Metric label="Robots" value={report.scanCoverage?.robotsTxtStatus} />}
          <Metric label="Snapshot" value={report.snapshotId} />
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <Gauge size={18} />
          <h2>Business Vital Signs</h2>
        </div>
        <div className="vitals-grid">
          {report.businessVitalSigns?.map((sign) => (
            <div className="vital" key={sign.vitalSign}>
              <span>{sign.vitalSign}</span>
              <strong>
                <StateDot color={sign.visualState?.color ?? visualStateForScore(sign.score).color} />
                {sign.score}
              </strong>
              <em>{sign.status}</em>
            </div>
          ))}
        </div>
      </section>

      <ExecutiveTable report={report} />
      <RevenueRiskAssessment report={report} />
      <BusinessOutcomeBridge report={report} />
      <RevenueIntelligence report={report} />
      <RecommendationEngine report={report} />
      <OutcomeValidationLoop report={report} />
      <ConfidenceEngineSection report={report} />
      <IndustryBenchmark report={report} />
      <PriorityTimeline report={report} />
      <TransformationIntelligence report={report} />
      <LightweightChangeDetection report={report} />
      <ClosedLoopProof report={report} />
      <MarketReadiness report={report} />
      <GbpIdentity report={report} />
      <CompetitorComparison report={report} />
      <CompetitorIntelligence report={report} />
      <ConfidenceLayer report={report} />
      <DimensionTrace report={report} />
      <DecisionLayer report={report} />

      <LayerDivider title={audience === "internal" ? "Internal Proof Layer" : "Evidence Layer"} />
      <EvidenceCoverage report={report} />
      <EvidenceDatabase report={report} />
      <DataFreshness report={report} />
      {audience === "internal" && <GroundTruthValidationLog report={report} />}
      {audience === "internal" && <MonitoringAndAlerts report={report} />}
      {audience === "internal" && <OperationalMemory report={report} />}
      <BusinessEvolution report={report} />
      <BusinessDna report={report} />
      {audience === "internal" && <EditIntelligence report={report} />}
      {audience === "internal" && <EvidenceExplorer report={report} />}
      {audience === "internal" && <Telemetry report={report} />}
      {audience === "internal" && <ArchitectureState report={report} />}
      <VisualFramework report={report} />
      <CoveragePanel coverage={coverage} />
    </article>
  );
}

function ReportView({ decision, coverage }: { decision: AiceDecisionObject; coverage: SpecCoverageItem[] }) {
  const style = {
    "--brand": "#145f63",
    "--accent": "#2f9f83"
  } as CSSProperties;
  const confidenceColor = decision.confidence_score >= 75 ? "#16845b" : decision.confidence_score >= 45 ? "#b87500" : "#b3261e";
  const revenueRange = formatDecisionRange(decision.revenue_impact_range);

  return (
    <article className="report" style={style}>
      <LayerDivider title="Customer Intelligence Plane" />
      <section className="verdict-band">
        <div>
          <span className="panel-kicker">Evidence-bound decision report</span>
          <h1>{decision.risk_level === "UNKNOWN" ? "Assessment Limited" : `${titleCase(decision.risk_level)} Risk`}</h1>
          <p>{decision.evidence_summary.overview}</p>
        </div>
        <div className="oss-gauge" style={{ borderColor: confidenceColor }}>
          <strong style={{ color: confidenceColor }}>{decision.confidence_score}%</strong>
          <span>Confidence</span>
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <ShieldCheck size={18} />
          <h2>Assessment Boundary</h2>
        </div>
        <div className="verdict-card-grid">
          <Metric label="Target" value={safeHostLabel(decision.target)} />
          <Metric label="Risk Level" value={titleCase(decision.risk_level)} />
          <Metric label="Coverage" value={`${decision.coverage_score}% ${decision.evidence_summary.coverage_status}`} />
          <Metric label="Access Restriction Detected" value={decision.access_restriction_detected ? "Yes" : "No" } />
        </div>
        {decision.assessment_limitation && <p className="muted">{decision.assessment_limitation}</p>}
      </section>

      <section className="report-section">
        <div className="section-title">
          <FileText size={18} />
          <h2>Evidence Summary</h2>
        </div>
        <div className="meta-strip">
          <Metric label="Sampled Pages" value={String(decision.evidence_summary.sampled_pages)} />
          <Metric label="Strongest Signal" value={decision.evidence_summary.strongest_business_signal} />
          <Metric label="Weakest Signal" value={decision.evidence_summary.weakest_business_signal} />
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <BarChart3 size={18} />
          <h2>Evidence Coverage Heatmap</h2>
        </div>
        <div className="data-table compact">
          {decision.evidence_heatmap_summary.map((item) => (
            <div className="table-row" key={item.area}>
              <span>{item.area}</span>
              <strong>{titleCase(item.coverage)}</strong>
              <small>{item.business_meaning}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <DollarSign size={18} />
          <h2>Business Impact Boundary</h2>
        </div>
        <div className="verdict-card-grid">
          <Metric label="Impact" value={decision.impact} />
          <Metric label="Opportunity Range" value={revenueRange} />
          <Metric label="Time Sensitivity" value={decision.time_sensitivity} />
          <Metric label="Action Window" value={decision.recommended_action_window} />
        </div>
        <p className="muted">{decision.if_not_fixed_outcome}</p>
      </section>

      <section className="report-section action-first-panel">
        <div className="section-title">
          <CheckCircle2 size={18} />
          <h2>Recommended Action</h2>
        </div>
        <p>{decision.final_recommendation}</p>
      </section>

      <CoveragePanel coverage={coverage} />
    </article>
  );
}

function LayerDivider({ title }: { title: string }) {
  return (
    <div className="layer-divider">
      <span>{title}</span>
    </div>
  );
}

function DecisionIntelligenceBriefSection({ report }: { report: ReportSnapshot }) {
  const brief = getDecisionIntelligenceBrief(report);
  const score = brief.executiveDecisionMatrix.executiveDecisionScore;
  const state = typeof score === "number" ? visualStateForScore(score) : NOT_SCORED_VISUAL_STATE;

  return (
    <section className="report-section decision-brief-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>SYSTOLAB Decision Intelligence Brief</h2>
      </div>

      <div className="decision-brief-verdict">
        <div>
          <span className="panel-kicker">1. Executive Verdict</span>
          <h3>{brief.executiveVerdict.currentSituation}</h3>
          <p>{brief.executiveVerdict.seriousness}</p>
          <p>{brief.executiveVerdict.likelyBusinessImpact}</p>
        </div>
        <div className="decision-brief-score" style={{ borderColor: state.color }}>
          <strong style={{ color: state.color }}>{formatOssScore(score, false)}</strong>
          <span>{score === null ? "Not Scored" : "EDS"}</span>
        </div>
      </div>

      <div className="decision-brief-banner" style={{ borderColor: state.color }}>
        <span className="panel-kicker">2. Executive Action Banner</span>
        <strong>{brief.executiveActionBanner.classification}</strong>
        <p>{brief.executiveActionBanner.message}</p>
      </div>

      <div className="decision-brief-block">
        <span className="panel-kicker">3. Executive Decision Matrix</span>
        <div className="meta-strip decision-brief-matrix">
          <Metric label="Executive Decision Score" value={formatOssScore(score)} />
          <Metric label="Risk Level" value={brief.executiveDecisionMatrix.riskLevel} />
          <Metric label="Executive Priority" value={brief.executiveDecisionMatrix.executivePriority} />
          <Metric label="Time Sensitivity" value={brief.executiveDecisionMatrix.timeSensitivity} />
          <Metric label="Competitive Position" value={brief.executiveDecisionMatrix.competitivePosition} />
          <Metric label="Primary Constraint" value={brief.executiveDecisionMatrix.primaryBusinessConstraint} />
          <Metric label="Potential Impact" value={brief.executiveDecisionMatrix.potentialBusinessImpact} />
          <Metric label="If Not Addressed" value={brief.executiveDecisionMatrix.ifNotAddressedOutcome} />
          <Metric label="Next Action" value={brief.executiveDecisionMatrix.recommendedNextAction} />
        </div>
      </div>

      <div className="decision-brief-block">
        <span className="panel-kicker">4. Action Plan</span>
        <div className="decision-brief-actions">
          {brief.actionPlan.map((item) => (
            <div className="decision-brief-action" key={`${item.priority}-${item.action}`}>
              <strong>{item.priority}</strong>
              <span>{item.action}</span>
              <p>{item.rationale}</p>
              <small>
                {item.confidenceScore}% confidence - {item.evidenceIds.length > 0 ? `${item.evidenceIds.length} supporting evidence object${item.evidenceIds.length === 1 ? "" : "s"}` : "evidence support limited"}
              </small>
            </div>
          ))}
        </div>
      </div>

      <div className="decision-brief-grid">
        <div className="decision-brief-block">
          <span className="panel-kicker">5. Why This Matters</span>
          <p className="decision-summary">{brief.whyThisMatters.overallCondition}</p>
          <div className="meta-strip compact-strip">
            <Metric label="Strongest Validated Areas" value={brief.whyThisMatters.strongestValidatedDimensions.join(", ") || "Not Assessed"} />
            <Metric label="Weakest Validated Area" value={brief.whyThisMatters.weakestValidatedDimension} />
          </div>
          <p className="muted">{brief.whyThisMatters.businessSignificance}</p>
        </div>

        <div className="decision-brief-block">
          <span className="panel-kicker">6. Competitive Position Analysis</span>
          <p className="decision-summary">{brief.competitivePositionAnalysis.summary}</p>
          <div className="meta-strip compact-strip">
            <Metric label="Benchmark Status" value={brief.competitivePositionAnalysis.benchmarkStatus} />
            <Metric label="Competitor Status" value={brief.competitivePositionAnalysis.competitorStatus} />
          </div>
          <div className="decision-brief-position-list">
            {brief.competitivePositionAnalysis.dimensionPositions.slice(0, 5).map((position) => (
              <span key={position.dimension}>
                {position.dimensionLabel}: <strong>{position.position}</strong>
              </span>
            ))}
            {brief.competitivePositionAnalysis.dimensionPositions.length === 0 && <span>Benchmark dimensions were not available from validated evidence.</span>}
          </div>
        </div>
      </div>

      <div className="decision-brief-block">
        <span className="panel-kicker">7. Executive Reliability Panel</span>
        <div className="meta-strip decision-brief-reliability">
          <Metric label="Evidence Coverage" value={brief.executiveReliabilityPanel.evidenceCoverage} />
          <Metric label="Page Coverage" value={brief.executiveReliabilityPanel.crawlCoverage} />
          <Metric label="Assessment Confidence" value={brief.executiveReliabilityPanel.assessmentConfidence} />
          <Metric label="Benchmark Confidence" value={brief.executiveReliabilityPanel.benchmarkConfidence} />
          <Metric label="Trust Signals" value={brief.executiveReliabilityPanel.assessmentTrustSignals} />
          <Metric label="Report Reliability" value={brief.executiveReliabilityPanel.overallReportReliability} />
        </div>
        <ul className="decision-brief-limitations">
          {brief.executiveReliabilityPanel.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Revenue Risk & Business Impact Assessment ─────────────────────────────────

interface RriLevel {
  label: string;
  color: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
}

function computeRRI(report: ReportSnapshot): number {
  const dims = report.dimensions ?? [];
  const trust = dims.find((d) => d.key === "trust")?.score;
  const conversion = dims.find((d) => d.key === "conversionReadiness")?.score;
  const mobile = dims.find((d) => d.key === "mobileExperience")?.score;
  const clarity = dims.find((d) => d.key === "informationClarity")?.score;
  const available = [trust, conversion, mobile, clarity].filter((s): s is number => s !== undefined);
  const ossRisk = 100 - (report.oss?.score ?? 0);
  if (available.length === 0) return Math.min(100, Math.max(0, Math.round(ossRisk)));
  const avgDimRisk = available.reduce((a, b) => a + (100 - b), 0) / available.length;
  return Math.min(100, Math.max(0, Math.round(ossRisk * 0.6 + avgDimRisk * 0.4)));
}

function getRriLevel(rri: number): RriLevel {
  if (rri <= 20) return { label: "Low Revenue Risk",         color: "#22C55E", textColor: "#14532D", bgColor: "#F0FDF4", borderColor: "#BBF7D0" };
  if (rri <= 40) return { label: "Moderate Revenue Risk",    color: "#84CC16", textColor: "#3F6212", bgColor: "#F7FEE7", borderColor: "#D9F99D" };
  if (rri <= 60) return { label: "Significant Revenue Risk", color: "#F59E0B", textColor: "#78350F", bgColor: "#FFFBEB", borderColor: "#FDE68A" };
  if (rri <= 80) return { label: "High Revenue Risk",        color: "#F97316", textColor: "#7C2D12", bgColor: "#FFF7ED", borderColor: "#FED7AA" };
  return            { label: "Critical Revenue Risk",        color: "#EF4444", textColor: "#7F1D1D", bgColor: "#FEF2F2", borderColor: "#FECACA" };
}

function rriBusinessContext(report: ReportSnapshot, rri: number): string {
  const dims = report.dimensions ?? [];
  const dimMap: Record<string, string> = {
    trust: "visitor trust signaling",
    conversionReadiness: "conversion readiness",
    mobileExperience: "mobile experience quality",
    informationClarity: "information clarity",
  };
  const weakDims = Object.entries(dimMap)
    .filter(([key]) => { const d = dims.find((x) => x.key === key); return d !== undefined && d.score < 60; })
    .map(([, label]) => label);
  const verb =
    rri >= 80 ? "critically limiting" :
    rri >= 60 ? "significantly limiting" :
    rri >= 40 ? "noticeably reducing" :
    rri >= 20 ? "moderately affecting" : "minimally impacting";
  if (weakDims.length === 0) {
    return "The structural analysis indicates that the current website configuration maintains a relatively stable foundation. Continued monitoring and targeted optimisation will support improvement in visitor engagement, lead generation potential, and overall conversion readiness.";
  }
  const weakList =
    weakDims.length === 1 ? weakDims[0]! :
    weakDims.length === 2 ? `${weakDims[0]!} and ${weakDims[1]!}` :
    `${weakDims.slice(0, -1).join(", ")}, and ${weakDims[weakDims.length - 1]!}`;
  return `Structural analysis has identified observable gaps in ${weakList}. These conditions are ${verb} visitor confidence, inquiry rates, and lead generation effectiveness. Visitors encountering these structural limitations are more likely to disengage before converting, widening the performance gap between this website and better-optimised competitors in the same category.`;
}

function recPriorityColor(priority: string): string {
  const p = priority.toUpperCase();
  if (p.includes("FIX") || p.includes("CRITICAL")) return "#EF4444";
  if (p.includes("MONTH") || p.includes("HIGH")) return "#F97316";
  if (p.includes("MONITOR") || p.includes("MEDIUM")) return "#F59E0B";
  return "#3B82F6";
}

function recPriorityLabel(priority: string): string {
  const p = priority.toUpperCase();
  if (p.includes("FIX")) return "Critical";
  if (p.includes("MONTH")) return "High";
  if (p.includes("MONITOR")) return "Medium";
  return priority;
}

function RevenueRiskAssessment({ report }: { report: ReportSnapshot }) {
  const rri = computeRRI(report);
  const level = getRriLevel(rri);
  const context = rriBusinessContext(report, rri);
  const engine = report.recommendationEngine ?? fallbackRecommendationEngine(report);
  const recs = engine.recommendations?.slice(0, 3) ?? [];
  const revenue = normalizeRevenueIntelligence(report);
  const timeline = report.priorityTimeline ?? fallbackPriorityTimeline(report);
  const benchmark = report.industryBenchmarkEngine ?? fallbackIndustryBenchmark(report);
  const hasBenchmark = benchmark.sampleSize > 0;

  const dims = report.dimensions ?? [];
  const businessDimKeys = ["trust", "conversionReadiness", "mobileExperience", "informationClarity"];
  const dimLabelMap: Record<string, string> = {
    trust: "Trust Signaling",
    conversionReadiness: "Conversion Readiness",
    mobileExperience: "Mobile Experience",
    informationClarity: "Information Clarity",
  };
  const weakestDims = dims
    .filter((d) => businessDimKeys.includes(d.key))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  const projectedMovement = recs.reduce((sum, r) => sum + r.expectedScoreMovement, 0);

  return (
    <section className="report-section">
      <div className="section-title">
        <DollarSign size={18} />
        <h2>Revenue Risk &amp; Business Impact Assessment</h2>
      </div>

      {/* RRI gauge + gradient scale */}
      <div className="rri-header" style={{ background: level.bgColor, border: `1px solid ${level.borderColor}` }}>
        <div className="rri-gauge" style={{ borderColor: level.color }}>
          <strong style={{ color: level.color }}>{rri}</strong>
          <span style={{ color: level.textColor }}>RRI</span>
        </div>
        <div className="rri-meta">
          <div className="rri-label" style={{ color: level.textColor }}>{level.label}</div>
          <div className="rri-scale">
            <div className="rri-indicator" style={{ left: `${Math.min(96, Math.max(4, rri))}%`, borderColor: level.color }} />
          </div>
          <div className="rri-scale-labels">
            <span>Low</span><span>Moderate</span><span>Significant</span><span>High</span><span>Critical</span>
          </div>
        </div>
      </div>
      <p className="muted">{context}</p>

      {/* Business Impact Summary */}
      <div className="impact-summary-card">
        <h3>Business Impact Summary</h3>
        <div className="impact-summary-grid">
          <div className="impact-summary-item">
            <span>Current Risk Level</span>
            <strong style={{ color: level.color }}>{level.label}</strong>
          </div>
          <div className="impact-summary-item">
            <span>Primary Limiting Factors</span>
            <strong>
              {weakestDims.length > 0
                ? weakestDims.map((d) => dimLabelMap[d.key] ?? d.label).join(", ")
                : "No critical gaps detected"}
            </strong>
          </div>
          <div className="impact-summary-item">
            <span>Potential Outcome if Addressed</span>
            <strong>
              {recs.length > 0
                ? `+${projectedMovement} projected OSS pts across top ${recs.length} action${recs.length !== 1 ? "s" : ""}`
                : "Re-run scan for projected outcomes"}
            </strong>
          </div>
        </div>
      </div>

      {/* Estimated Opportunity Range */}
      <div className="opportunity-panel">
        <h3>Estimated Opportunity Range</h3>
        <p>Modelled from observed website conditions, collected evidence, and benchmark intelligence. These figures represent directional planning estimates only.</p>
        <div className="opportunity-estimates">
          <div className="opportunity-estimate-card">
            <span>Revenue Opportunity</span>
            <strong>{revenue.revenueOpportunityRange?.low} – {revenue.revenueOpportunityRange?.high}</strong>
            <em>{revenue.revenueOpportunityRange?.unit?.replaceAll("_", " ")}</em>
            <p>{revenue.revenueOpportunityRange?.label}</p>
          </div>
          <div className="opportunity-estimate-card">
            <span>Conversion Potential</span>
            <strong>{revenue.conversionPotentialRange?.low} – {revenue.conversionPotentialRange?.high}</strong>
            <em>{revenue.conversionPotentialRange?.unit?.replaceAll("_", " ")}</em>
            <p>{revenue.conversionPotentialRange?.label}</p>
          </div>
          <div className="opportunity-estimate-card">
            <span>Opportunity Cost Range</span>
            <strong>{revenue.opportunityCostRange?.low} – {revenue.opportunityCostRange?.high}</strong>
            <em>{revenue.opportunityCostRange?.unit?.replaceAll("_", " ")}</em>
            <p>{revenue.opportunityCostRange?.label ?? "Not estimated because validated evidence was insufficient"}</p>
          </div>
          <div className="opportunity-estimate-card">
            <span>Competitor Pressure</span>
            <strong>{revenue.competitorRevenuePressure?.pressureLevel}</strong>
            <p>{revenue.competitorRevenuePressure?.explanation}</p>
          </div>
        </div>
        <p className="opportunity-disclaimer">These estimates are derived from structural analysis, evidence patterns, and benchmark comparisons. They are directional planning inputs and must not be interpreted as guaranteed revenue, financial projections, or investment returns.</p>
      </div>

      {/* Cost of Inaction */}
      <div className="inaction-card">
        <h3>
          <AlertTriangle size={16} style={{ color: "#F97316", flexShrink: 0 }} />
          Cost of Inaction
        </h3>
        <p>Unresolved structural gaps allow performance differences between this website and better-optimised alternatives to compound over time. Visitors who encounter friction are less likely to return, and delayed improvements widen the competitive gap in trust positioning, conversion readiness, and visibility.</p>
        <div className="inaction-factors">
          <div className="inaction-factor">
            <strong>Visitor Confidence Erosion</strong>
            <p>Continued gaps in trust signaling and information clarity may suppress inquiry rates and cause visitors to favour alternatives before reaching a decision point.</p>
          </div>
          <div className="inaction-factor">
            <strong>Lead Generation Gap</strong>
            <p>Structural friction in conversion pathways reduces lead capture effectiveness, limiting the business&apos;s ability to grow its pipeline from organic and direct traffic.</p>
          </div>
          <div className="inaction-factor">
            <strong>Competitive Positioning Risk</strong>
            <p>Better-optimised competitors operating in the same category continue to improve their structural readiness. Delays in addressing identified gaps may widen this performance differential.</p>
          </div>
          <div className="inaction-factor">
            <strong>Engagement &amp; Retention Impact</strong>
            <p>Poor mobile experience and unclear information hierarchy increase bounce risk, reducing the effectiveness of all traffic acquisition efforts and lowering repeat visit potential.</p>
          </div>
        </div>
      </div>

      {/* Priority Recovery Opportunities */}
      <div className="rri-subsection-header">
        <KeyRound size={15} />
        <strong>Priority Recovery Opportunities</strong>
      </div>
      {recs.length === 0 ? (
        <div className="placeholder-block">
          <strong>No recommendations available</strong>
          <p>Re-run the scan to generate prioritised recovery recommendations.</p>
        </div>
      ) : (
        <div className="recovery-grid">
          {recs.map((rec) => {
            const pColor = recPriorityColor(rec.priority);
            return (
              <div className="recovery-card" key={rec.recommendationId}>
                <div className="recovery-priority" style={{ color: pColor }}>
                  <div className="priority-dot" style={{ background: pColor }} />
                  {recPriorityLabel(rec.priority)} Priority
                </div>
                <h4>{rec.issue}</h4>
                <p>{rec.action}</p>
                <div className="recovery-meta">
                  <div className="recovery-meta-item">
                    <span>Expected Impact</span>
                    <strong>+{rec.expectedScoreMovement} OSS pts</strong>
                  </div>
                  <div className="recovery-meta-item">
                    <span>Confidence</span>
                    <strong>{rec.confidenceScore}%</strong>
                  </div>
                </div>
                {rec.revenueIntelligenceMapping && (
                  <small style={{ color: "var(--muted)", fontSize: "11px", lineHeight: 1.4, display: "block" }}>{rec.revenueIntelligenceMapping}</small>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Improvement Roadmap */}
      <div className="rri-subsection-header" style={{ marginTop: "20px" }}>
        <Clock size={15} />
        <strong>Improvement Roadmap</strong>
      </div>
      <div className="roadmap-grid">
        <div className="roadmap-phase roadmap-phase--immediate">
          <div className="roadmap-phase-header">
            <div className="roadmap-phase-dot" style={{ background: "#EF4444" }} />
            <span>Immediate Actions</span>
            <em>0–7 Days</em>
          </div>
          {(timeline.fixNow?.length ?? 0) === 0 ? (
            <div className="roadmap-empty">No immediate actions required</div>
          ) : (
            timeline.fixNow?.slice(0, 3).map((item) => (
              <div className="roadmap-action" key={item.actionId}>{item.action}</div>
            ))
          )}
        </div>
        <div className="roadmap-phase roadmap-phase--short">
          <div className="roadmap-phase-header">
            <div className="roadmap-phase-dot" style={{ background: "#F59E0B" }} />
            <span>Short-Term Improvements</span>
            <em>1–4 Weeks</em>
          </div>
          {(timeline.thisMonth?.length ?? 0) === 0 ? (
            <div className="roadmap-empty">No short-term actions identified</div>
          ) : (
            timeline.thisMonth?.slice(0, 3).map((item) => (
              <div className="roadmap-action" key={item.actionId}>{item.action}</div>
            ))
          )}
        </div>
        <div className="roadmap-phase roadmap-phase--long">
          <div className="roadmap-phase-header">
            <div className="roadmap-phase-dot" style={{ background: "#3B82F6" }} />
            <span>Long-Term Optimisation</span>
            <em>1–3 Months</em>
          </div>
          {(timeline.monitor?.length ?? 0) === 0 ? (
            <div className="roadmap-empty">No long-term initiatives identified</div>
          ) : (
            timeline.monitor?.slice(0, 3).map((item) => (
              <div className="roadmap-action" key={item.actionId}>{item.action}</div>
            ))
          )}
        </div>
      </div>

      {/* Benchmark Context */}
      {hasBenchmark && (
        <div className="benchmark-context">
          <h3>Benchmark Context</h3>
          <p>The following positions reflect how the analysed website compares against similar businesses across key structural dimensions. These comparisons are generalised and evidence-based; they do not expose competitor-sensitive data or guarantee market positions.</p>
          <div className="benchmark-positions">
            {benchmark.currentPosition?.slice(0, 4).map((pos) => (
              <div className="benchmark-position" key={pos.dimension}>
                <span>{pos.dimensionLabel}</span>
                <strong>Score {pos.score}</strong>
                <em>{pos.position}</em>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transparency Notice */}
      <div className="transparency-notice">
        <Info size={15} style={{ flexShrink: 0, color: "#64748B", marginTop: "2px" }} />
        <p>Revenue Risk Index values, Opportunity Range estimates, Cost of Inaction assessments, benchmark observations, and business impact projections are analytical estimates generated from observed website conditions, collected evidence, intelligence models, and benchmark patterns. These insights support prioritisation and planning. They must not be interpreted as guarantees of future revenue, lead volume, conversion improvements, financial performance, or business outcomes.</p>
      </div>
    </section>
  );
}

function ActionFirstPanelSection({ report }: { report: ReportSnapshot }) {
  const panel = report.actionFirstPanel ?? fallbackActionFirstPanel(report);
  return (
    <section className="report-section action-first">
      <div className="section-title">
        <KeyRound size={18} />
        <h2>Action First Panel</h2>
      </div>
      {(panel.items?.length ?? 0) === 0 ? (
        <div className="placeholder-block">
          <strong>{panel.status?.replaceAll("_", " ")}</strong>
          <p>{panel.fallbackAction}</p>
        </div>
      ) : (
        <div className="action-grid">
          {panel.items?.map((item) => (
            <div className="action-card" key={item.actionId}>
              <span>{item.effortLevel} effort</span>
              <strong>{item.issue}</strong>
              <p>{item.executableFix}</p>
              <p>{item.businessReason}</p>
              <div className="impact-list">
                <small>{item.expectedDirectionalImpact?.informationClarity}</small>
                <small>{item.expectedDirectionalImpact?.conversionReadiness}</small>
                <small>{item.expectedDirectionalImpact?.trustStrength}</small>
              </div>
              <small>Cluster {item.evidenceClusterId} | EO {item.evidenceIds?.join(", ")}</small>
            </div>
          ))}
        </div>
      )}
      <p className="muted">{panel.fallbackAction}</p>
    </section>
  );
}

function SystemVerdictSection({ report }: { report: ReportSnapshot }) {
  const verdict = report.systemVerdict ?? fallbackSystemVerdict(report);
  return (
    <section className="report-section verdict-line">
      <div className="section-title">
        <AlertTriangle size={18} />
        <h2>System Verdict</h2>
      </div>
      <strong>{verdict.line}</strong>
      <small>{verdict.evidenceIds?.join(", ") || "Evidence references unavailable in this snapshot."}</small>
    </section>
  );
}

function OssInterpretationSection({ report }: { report: ReportSnapshot }) {
  const interpretation = report.ossInterpretation ?? fallbackOssInterpretation(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Gauge size={18} />
        <h2>OSS Score Interpretation</h2>
      </div>
      <div className="meta-strip">
        <Metric label="OSS" value={formatOssScore(interpretation.score)} />
        <Metric label="Strict Class" value={interpretation.label} />
        <Metric label="Range" value={interpretation.range} />
      </div>
      <p className="decision-summary">{interpretation.oneLineDiagnosis}</p>
      <p className="muted">{interpretation.meaning}</p>
    </section>
  );
}

function BusinessRiskSection({ report }: { report: ReportSnapshot }) {
  const risk = report.businessRiskStatus ?? fallbackBusinessRisk(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <AlertTriangle size={18} />
        <h2>Business Risk Status</h2>
      </div>
      <div className="risk-layout">
        <Metric label="Classification" value={risk.classification} />
        <Metric label="Risk Level" value={risk.level} />
        <div className="risk-copy">
          <strong>{risk.primaryRiskDriver}</strong>
          <p>{risk.explanation}</p>
          <small>{risk.evidenceIds?.join(", ") || "Evidence references unavailable in this snapshot."}</small>
        </div>
      </div>
    </section>
  );
}

function EvidenceCoverage({ report }: { report: ReportSnapshot }) {
  const coverage = report.evidenceCoverageSummary ?? fallbackEvidenceCoverage(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Layers size={18} />
        <h2>Evidence Coverage Summary</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Pages Sampled" value={String(coverage.totalPagesSampled)} />
        <Metric label="Evidence Objects" value={String(coverage.totalEvidenceObjects)} />
        <Metric label="Coverage Label" value={report.scanCoverage?.coverageLabel} />
      </div>
      <div className="coverage-page-grid">
        {coverage.pages?.map((page) => (
          <div className="coverage-page" key={`${page.url}-${page.role}`}>
            <span>{page.role}</span>
            <strong>{page.coverageStatus}</strong>
            <p>{page.url}</p>
            <small>
              HTTP {page.httpStatus} | {page.evidenceCount} EO | {page.keySignals?.join(", ") || "No key signals"}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceDatabase({ report }: { report: ReportSnapshot }) {
  const evidenceDatabase = report.evidenceDatabase ?? fallbackEvidenceDatabase(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Braces size={18} />
        <h2>Evidence Database</h2>
      </div>
      <div className="system-grid">
        {evidenceDatabase.slice(0, 8).map((evidence) => (
          <div className="system-card" key={evidence.evidenceId}>
            <span>{evidence.evidenceType?.replaceAll("_", " ")}</span>
            <strong>{evidence.evidenceId}: {evidence.issue}</strong>
            <p>Before: {evidence.before ?? "None"}</p>
            <p>After: {evidence.after ?? "None"}</p>
            <small>Confidence {evidence.confidenceScore}% | {evidence.confidenceReason}</small>
            <small>Lineage: {evidence.lineage?.previousSnapshotId ?? "Baseline"} {"->"} {evidence.lineage?.snapshotId}</small>
            <small>EO {evidence.lineage?.sourceEvidenceIds?.join(", ") || "No EO"} | REC {evidence.lineage?.recommendationIds?.join(", ") || "None"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataFreshness({ report }: { report: ReportSnapshot }) {
  const freshness = report.freshness;
  return (
    <section className="report-section">
      <div className="section-title">
        <CalendarClock size={18} />
        <h2>Data Freshness & Validity Window</h2>
      </div>
      <div className="meta-strip freshness-strip">
        <Metric label="Captured At" value={formatDate(freshness?.capturedAt)} />
        <Metric label="Cache Status" value={freshness?.cacheStatus?.replaceAll("_", " ")} />
        <Metric label="Validity Window" value={freshness ? `${freshness.validityWindowHours} hours` : undefined} />
        <Metric label="Staleness Risk" value={freshness?.stalenessRisk} />
        <Metric label="Next Scan" value={formatDate(freshness?.nextRecommendedScanAt)} />
      </div>
    </section>
  );
}

function ExecutiveTable({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <FileText size={18} />
        <h2>Executive Summary</h2>
      </div>
      <div className="data-table">
        <div className="table-head">
          <span>Area</span>
          <span>Status</span>
          <span>Observed Condition</span>
          <span>Business Impact</span>
          <span>Priority</span>
        </div>
        {report.executiveSummaryTable?.map((row) => (
          <div className="table-row five" key={row.area}>
            <strong>{row.area}</strong>
            <span>{row.currentStatus}</span>
            <span>{row.observedCondition}</span>
            <span>{row.businessImpact}</span>
            <span>{row.priorityLevel}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BusinessOutcomeBridge({ report }: { report: ReportSnapshot }) {
  const bridge = report.businessOutcomeBridge ?? fallbackOutcomeBridge(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>Business Outcome Bridge</h2>
      </div>
      <div className="outcome-grid">
        {bridge.map((item) => (
          <div className="outcome-card" key={item.bridgeId}>
            <span>{item.opportunityRange} Opportunity</span>
            <strong>{item.structuralFinding}</strong>
            <p>{item.mappedBusinessOutcome}</p>
            <p>{item.transformationMapping}</p>
            <div className="impact-list">
              <small>{item.quantifiedUpliftRange?.informationClarity}</small>
              <small>{item.quantifiedUpliftRange?.conversionReadiness}</small>
              <small>{item.quantifiedUpliftRange?.trustStrength}</small>
            </div>
            <small>Confidence {item.confidenceScore}% | {item.evidenceIds?.join(", ") || "Evidence not available"}</small>
            <em>{item.limitation}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function RevenueIntelligence({ report }: { report: ReportSnapshot }) {
  const revenue = report.revenueIntelligence ?? fallbackRevenueIntelligence(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>Revenue Intelligence Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={revenue.status?.replaceAll("_", " ")} />
        <Metric label="Confidence" value={`${revenue.confidenceScore}%`} />
        <Metric label="Competitor Pressure" value={revenue.competitorRevenuePressure?.pressureLevel} />
      </div>
      <p className="muted">{revenue.confidenceBasis}</p>
      <div className="revenue-grid">
        {[revenue.trafficRange, revenue.conversionPotentialRange, revenue.revenueOpportunityRange, revenue.opportunityCostRange].map((estimate) => (
          <div className="revenue-card" key={estimate.label}>
            <span>{estimate.unit?.replaceAll("_", " ")}</span>
            <strong>{estimate.low} - {estimate.high}</strong>
            <p>{estimate.label}</p>
            <small>Confidence {estimate.confidenceScore}% | EO {estimate.evidenceIds?.join(", ") || "No EO"}</small>
          </div>
        ))}
      </div>
      <p className="muted">{revenue.competitorRevenuePressure?.explanation}</p>
    </section>
  );
}

function RecommendationEngine({ report }: { report: ReportSnapshot }) {
  const engine = report.recommendationEngine ?? fallbackRecommendationEngine(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <KeyRound size={18} />
        <h2>Recommendation Engine</h2>
      </div>
      <p className="muted">{engine.mappingSystem?.explanation}</p>
      <div className="recommendation-grid">
        {engine.recommendations?.map((recommendation) => (
          <div className="recommendation-card" key={recommendation.recommendationId}>
            <span>{recommendation.priority}</span>
            <strong>{recommendation.issue}</strong>
            <p>{recommendation.action}</p>
            <small>+{recommendation.expectedScoreMovement} projected score movement | Confidence {recommendation.confidenceScore}%</small>
            <small>{recommendation.revenueIntelligenceMapping}</small>
            <small>EO {recommendation.evidenceIds?.join(", ") || "No EO"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function OutcomeValidationLoop({ report }: { report: ReportSnapshot }) {
  const loop = report.recommendationOutcomeLoop ?? fallbackOutcomeValidation(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <RefreshCw size={18} />
        <h2>Recommendation Outcome Validation Loop</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={loop.status?.replaceAll("_", " ")} />
        <Metric label="Previous Snapshot" value={loop.previousSnapshotId ?? "Baseline"} />
        <Metric label="Validations" value={String(loop.validations?.length ?? 0)} />
      </div>
      <p className="muted">{loop.summary}</p>
      <div className="system-grid">
        {loop.validations?.map((validation) => (
          <div className="system-card" key={validation.recommendationId}>
            <span>{validation.implementedStatus?.replaceAll("_", " ")}</span>
            <strong>{validation.recommendationId}</strong>
            <p>{validation.recommendation}</p>
            <small>Detected {validation.detectedAt ?? "Pending"} | OSS {validation.ossDelta === null ? "Pending" : formatDifference(validation.ossDelta)}</small>
            <small>Impact {validation.revenueImpact?.low}-{validation.revenueImpact?.high} {validation.revenueImpact?.unit?.replaceAll("_", " ")}</small>
            <small>Confidence {validation.confidenceScore}% | {validation.confidenceReasons?.join(" ")}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfidenceEngineSection({ report }: { report: ReportSnapshot }) {
  const confidence = report.confidenceEngine ?? fallbackConfidenceEngine(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <ShieldCheck size={18} />
        <h2>Confidence Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Overall Confidence" value={`${confidence.overallConfidenceScore}%`} />
        <Metric label="Level" value={confidence.confidenceLevel} />
        <Metric label="Factors" value={String(confidence.factors?.length ?? 0)} />
      </div>
      <div className="system-grid">
        {confidence.factors?.map((factor) => (
          <div className="system-card" key={factor.factorId}>
            <span>{factor.weight}% weight</span>
            <strong>{factor.label}: {factor.score}%</strong>
            <p>{factor.reason}</p>
            <small>EO {factor.evidenceIds?.join(", ") || "No EO"}</small>
          </div>
        ))}
      </div>
      <div className="system-grid compact-system-grid">
        {confidence.estimateExplanations?.map((item) => (
          <div className="system-card" key={item.area}>
            <span>{item.area}</span>
            <strong>{item.confidenceScore}%</strong>
            <p>{item.reasons?.join(" ")}</p>
            <small>Missing: {item.missingInputs?.join(", ") || "None"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function IndustryBenchmark({ report }: { report: ReportSnapshot }) {
  const benchmark = report.industryBenchmarkEngine ?? fallbackIndustryBenchmark(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>Industry Benchmark Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Industry" value={benchmark.industryType} />
        <Metric label="Dataset" value={benchmark.status?.replaceAll("_", " ")} />
        <Metric label="Sample Size" value={String(benchmark.sampleSize)} />
      </div>
      <div className="comparison-table">
        <div className="comparison-head">
          <span>Dimension</span>
          <span>Client</span>
          <span>Average</span>
          <span>Delta</span>
          <span>Position</span>
        </div>
        {benchmark.currentPosition?.map((row) => (
          <div className="proof-row" key={row.dimension}>
            <span>{row.dimensionLabel}</span>
            <strong>{row.score}</strong>
            <strong>{row.industryAverage}</strong>
            <strong>{formatDifference(row.delta)}</strong>
            <em>{row.position}</em>
          </div>
        ))}
      </div>
      <p className="muted">{benchmark.limitations?.join(" ")}</p>
    </section>
  );
}

function PriorityTimeline({ report }: { report: ReportSnapshot }) {
  const timeline = report.priorityTimeline ?? fallbackPriorityTimeline(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <CalendarClock size={18} />
        <h2>Priority Timeline Framework</h2>
      </div>
      <div className="timeline-grid">
        <TimelineColumn title="FIX NOW" items={timeline.fixNow} />
        <TimelineColumn title="THIS MONTH" items={timeline.thisMonth} />
        <TimelineColumn title="MONITOR" items={timeline.monitor} />
      </div>
    </section>
  );
}

function TimelineColumn({ title, items }: { title: string; items: ReportSnapshot["priorityTimeline"]["fixNow"] }) {
  return (
    <div className="timeline-column">
      <div className="timeline-column-head">
        <h3>{title}</h3>
        <span>{items?.length ?? 0}</span>
      </div>
      {(items?.length ?? 0) === 0 ? (
        <p className="timeline-empty">No actions in this category.</p>
      ) : (
        items.map((item) => (
          <div className="timeline-item" key={item.actionId}>
            <strong>{item.action}</strong>
            <div className="timeline-meta">
              <span>{item.timeWindow}</span>
              <span>{item.structuralSeverity} severity</span>
              <span>{item.evidenceStrength} evidence</span>
            </div>
            <small>EO {item.evidenceIds?.join(", ") || "No evidence object"}</small>
          </div>
        ))
      )}
    </div>
  );
}

function TransformationIntelligence({ report }: { report: ReportSnapshot }) {
  const projection = report.transformationIntelligence ?? fallbackTransformation(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>Transformation Intelligence Layer</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Current OSS" value={String(projection.currentOss)} />
        <Metric label="Projected OSS" value={String(projection.projectedOss)} />
        <Metric label="Projected Delta" value={`+${projection.projectedDelta}`} />
      </div>
      <p className="muted">{projection.projectionBasis}</p>
      <div className="projection-grid">
        {projection.dimensionProjections?.map((item) => (
          <div className="projection-card" key={item.dimension}>
            <span>{item.dimensionLabel}</span>
            <strong>
              {item.currentScore} {"->"} {item.projectedScore} (+{item.projectedDelta})
            </strong>
            <p>{item.recommendedActionPath}</p>
            <small>{item.evidenceIds?.join(", ") || "Evidence not available"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function LightweightChangeDetection({ report }: { report: ReportSnapshot }) {
  const changeDetection = report.lightweightChangeDetection ?? fallbackChangeDetection(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <RefreshCw size={18} />
        <h2>Lightweight Change Detection</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={changeDetection.status?.replaceAll("_", " ")} />
        <Metric label="Compared Snapshot" value={changeDetection.comparedSnapshotId ?? "Baseline"} />
        <Metric label="Changes" value={String(changeDetection.changes.length)} />
      </div>
      <p className="muted">{changeDetection.explanation}</p>
      <div className="change-grid">
        {changeDetection.changes?.map((change) => (
          <div className="change-card" key={change.changeId}>
            <span>{change.direction}</span>
            <strong>{change.area}</strong>
            <p>{change.beforeState} {"->"} {change.afterState}</p>
            <small>Confidence {change.confidenceScore}% | REC {change.recommendationIds?.join(", ") || "None"} | EO {change.evidenceIds?.join(", ") || "No EO"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClosedLoopProof({ report }: { report: ReportSnapshot }) {
  const proof = report.closedLoopProofSystem ?? fallbackClosedLoop(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <RefreshCw size={18} />
        <h2>Closed-Loop Proof System</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={proof.status?.replaceAll("_", " ")} />
        <Metric label="Before OSS" value={String(proof.beforeOss)} />
        <Metric label="After OSS" value={proof.afterOss === undefined ? "Pending re-scan" : String(proof.afterOss)} />
      </div>
      <p className="muted">{proof.explanation}</p>
      <div className="comparison-table">
        <div className="comparison-head">
          <span>Dimension</span>
          <span>Before</span>
          <span>After</span>
          <span>Delta</span>
          <span>Status</span>
        </div>
        {proof.dimensionDeltas?.map((row) => (
          <div className="proof-row" key={row.dimension}>
            <span>{row.dimensionLabel}</span>
            <strong>{row.beforeScore}</strong>
            <strong>{row.afterScore ?? "Pending"}</strong>
            <strong>{row.delta === undefined ? "Pending" : formatDifference(row.delta)}</strong>
            <em>{proof.status === "comparison_available" ? "Compared" : "Baseline"}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArchitectureState({ report }: { report: ReportSnapshot }) {
  const architecture = report.architectureState ?? fallbackArchitectureState();
  return (
    <section className="report-section">
      <div className="section-title">
        <Layers size={18} />
        <h2>Layered Intelligence Architecture</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Flow" value={architecture.flow.join(" -> ")} />
        <Metric label="Active V1 Engines" value={String(architecture.activeV1Engines?.length ?? 0)} />
        <Metric label="Staged Engines" value={String(architecture.stagedFutureEngines?.length ?? 0)} />
      </div>
      <p className="muted">{architecture.eventDrivenContract}</p>
      <div className="architecture-grid">
        {architecture.stagedFutureEngines?.map((engine) => (
          <div className="architecture-card" key={engine.engine}>
            <span>{engine.status?.replaceAll("_", " ")}</span>
            <strong>{engine.engine}</strong>
            <p>{engine.activationNote}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MarketReadiness({ report }: { report: ReportSnapshot }) {
  const market = report.marketReadinessPosition ?? fallbackMarketReadiness(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>Market Readiness Position</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Dataset" value={market.datasetLabel} />
        <Metric label="Status" value={market.status?.replaceAll("_", " ")} />
        <Metric label="Confidence" value={`${market.comparativeConfidenceScore}%`} />
      </div>
      <p className="muted">{market.limitation}</p>
      <div className="market-grid">
        {market.positions?.map((position) => (
          <div className="market-card" key={position.dimension}>
            <span>{position.dimensionLabel}</span>
            <strong>{position.position}</strong>
            <p>Score {position.score}</p>
            <small>{position.evidenceIds?.join(", ") || "Evidence not available"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function GbpIdentity({ report }: { report: ReportSnapshot }) {
  const gbp = report.gbpIdentity ?? fallbackGbpIdentity(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <MapPinned size={18} />
        <h2>GBP Identity Intelligence</h2>
      </div>
      {gbp.status === "not_assessed" ? (
        <div className="placeholder-block">
          <strong>Not Assessed in This Scan</strong>
          <p>Add a Google Business Profile URL to enable local identity, profile completeness, and consistency analysis.</p>
        </div>
      ) : (
        <>
          <div className="meta-strip gbp-strip">
            <Metric label="GBP Status" value={gbp.status?.replaceAll("_", " ")} />
            <Metric label="Identity Score" value={String(gbp.identityConsistencyScore)} />
            <Metric label="Mismatch Flag" value={gbp.identityMismatchFlag?.replaceAll("_", " ")} />
            <Metric label="Confidence" value={`${gbp.confidenceScore}% ${gbp.confidenceLevel}`} />
            <Metric label="Completeness" value={gbp.profileCompletenessLevel} />
          </div>
          <div className="gbp-overview">
            <div>
              <span>Observed Business Name</span>
              <strong>{gbp.extractedBusinessName ?? "Limited from public page"}</strong>
            </div>
            <div>
              <span>Observed Category</span>
              <strong>{gbp.extractedCategory ?? "Limited from public page"}</strong>
            </div>
            <div>
              <span>Final Public URL</span>
              <strong>{gbp.finalUrl ?? gbp.inputUrl ?? "Unavailable"}</strong>
            </div>
          </div>
          <div className="signal-grid">
            {(gbp.signals ?? []).map((signal) => (
              <div className="signal" key={signal.label}>
                <span>{signal.label}</span>
                <strong>{signal.status}</strong>
                <p>{signal.observedValue}</p>
                <small>{signal.evidenceIds?.join(", ") || "Supplementary evidence"}</small>
              </div>
            ))}
          </div>
          <div className="note-grid">
            <div>
              <strong>Consistency Notes</strong>
              {(gbp.consistencyNotes ?? []).map((note) => <p key={note}>{note}</p>)}
            </div>
            <div>
              <strong>Limitations</strong>
              {(gbp.limitations ?? []).map((note) => <p key={note}>{note}</p>)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CompetitorComparison({ report }: { report: ReportSnapshot }) {
  const comparisons = (report.competitorComparison ?? []).map((comparison) => normalizeComparison(report, comparison));
  return (
    <section className="report-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>Client vs Competitor Structural Comparison</h2>
      </div>
      {comparisons.length === 0 ? (
        <div className="placeholder-block">
          <strong>Not Assessed in This Scan</strong>
          <p>Add competitor websites to enable side-by-side structural comparison without rankings, winners, or market claims.</p>
        </div>
      ) : (
        <div className="competitor-report-grid">
          {comparisons.map((comparison) => (
            <div className="competitor-card" key={comparison.competitorUrl}>
              <div className="competitor-card-head">
                <div>
                  <span>{comparison.status === "assessed" ? "Assessed Competitor" : "Competitor Limited"}</span>
                  <strong>{comparison.competitorLabel}</strong>
                  <small>{comparison.competitorUrl}</small>
                </div>
                <div className="mini-score-pair">
                  <Metric label="Client OSS" value={String(comparison.primaryOss)} />
                  <Metric label="Competitor OSS" value={comparison.competitorOss === null ? "Unavailable" : String(comparison.competitorOss)} />
                </div>
              </div>
              <p className="muted">{comparison.structuralGapSummary}</p>
              {comparison.failureReason && <p className="error-line">{comparison.failureReason}</p>}
              <div className="meta-strip comparison-summary">
                <Metric label="Client Stronger" value={String(comparison.primaryStrengthCount)} />
                <Metric label="Competitor Stronger" value={String(comparison.competitorStrengthCount)} />
                <Metric label="Equivalent" value={String(comparison.equivalentCount)} />
                <Metric label="Pages" value={String(comparison.assessedPages)} />
              </div>
              <div className="comparison-table">
                <div className="comparison-head">
                  <span>Dimension</span>
                  <span>Client</span>
                  <span>Competitor</span>
                  <span>Difference</span>
                  <span>Position</span>
                </div>
                {comparison.evidenceTraceabilityMap?.map((row) => (
                  <details className="comparison-row" key={`${comparison.competitorUrl}-${row.dimension}`}>
                    <summary>
                      <span>{row.dimensionLabel}</span>
                      <strong>{row.primaryScore}</strong>
                      <strong>{row.competitorScore ?? "N/A"}</strong>
                      <strong>{row.competitorScore === null ? "N/A" : formatDifference(row.difference)}</strong>
                      <em>{positionLabel(row.position)}</em>
                    </summary>
                    <small>
                      Client EO: {row.primaryEvidenceIds?.join(", ") || "None"} | Competitor EO:{" "}
                      {row.competitorEvidenceIds?.join(", ") || "None"}
                    </small>
                  </details>
                ))}
              </div>
              <p className="muted">{comparison.dataAvailability}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CompetitorIntelligence({ report }: { report: ReportSnapshot }) {
  const engine = report.competitorIntelligenceEngine ?? fallbackCompetitorIntelligence(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <History size={18} />
        <h2>Competitor Intelligence Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={engine.status?.replaceAll("_", " ")} />
        <Metric label="Tracked Competitors" value={String(engine.competitors?.length ?? 0)} />
      </div>
      <p className="muted">{engine.explanation}</p>
      <div className="system-grid">
        {engine.competitors?.map((competitor) => (
          <div className="system-card" key={competitor.competitorUrl}>
            <span>{competitor.timeline.length} timeline point(s)</span>
            <strong>{competitor.competitorLabel}</strong>
            <p>Latest OSS movement: {competitor.latestMovement?.ossDelta === null ? "Pending" : formatDifference(competitor.latestMovement?.ossDelta)}</p>
            <small>{competitor.competitorUrl}</small>
            {competitor.latestMovement?.changedDimensions.slice(0, 4).map((change) => (
              <small key={change.dimension}>
                {change.dimensionLabel}: {change.beforeScore ?? "N/A"} {"->"} {change.afterScore ?? "N/A"} ({change.delta === null ? "N/A" : formatDifference(change.delta)})
              </small>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function fallbackGbpIdentity(report: ReportSnapshot): ReportSnapshot["gbpIdentity"] {
  const input = report.dataInputs?.find((item) => item.source === "Google Business Profile URL");
  const provided = input?.status === "Provided";
  return {
    status: provided ? "limited" : "not_assessed",
    inputUrl: provided ? input?.reason : undefined,
    identityMismatchFlag: provided ? "insufficient_evidence" : "not_assessed",
    identityConsistencyScore: 0,
    confidenceScore: 0,
    confidenceLevel: "Limited",
    profileCompletenessLevel: provided ? "Limited" : "Not Assessed",
    signals: [],
    consistencyNotes: [
      provided
        ? "This snapshot was generated before the GBP Identity Intelligence schema was added. Re-run the scan to populate GBP signals."
        : "No Google Business Profile URL was provided."
    ],
    limitations: [
      provided
        ? "Legacy snapshot compatibility mode is active for this report."
        : "GBP Identity was not assessed in this scan."
    ],
    evidenceIds: []
  };
}

function fallbackActionFirstPanel(report: ReportSnapshot): ReportSnapshot["actionFirstPanel"] {
  const decisions = report.decisions ?? [];
  return {
    layer: "decision",
    status: decisions.length > 0 ? "actions_required" : "no_immediate_structural_fix_detected",
    items: decisions.slice(0, 3).map((decision, index) => ({
      actionId: `LEGACY-AFP-${index + 1}`,
      issue: decision.decisionClassification,
      executableFix: decision.recommendedActionPath,
      businessReason: decision.impactExplanation,
      effortLevel: decision.category === "Structural Priority: High" ? "medium" : "low",
      expectedDirectionalImpact: {
        informationClarity: "+5-9% clarity improvement",
        conversionReadiness: "+8-12% conversion readiness",
        trustStrength: "+3-6% trust improvement"
      },
      evidenceIds: decision.evidenceTraceReferences,
      evidenceClusterId: "legacy-decision-cluster"
    })),
    fallbackAction: "Legacy snapshot compatibility mode. Re-run the scan to populate the strict Action First Panel."
  };
}

function fallbackSystemVerdict(report: ReportSnapshot): ReportSnapshot["systemVerdict"] {
  const firstDecision = report.decisions?.[0];
  return {
    layer: "decision",
    line: firstDecision
      ? `${firstDecision.decisionClassification} is the primary structural condition, and it matters because ${firstDecision.impactExplanation.toLowerCase()}`
      : `${report.executiveClarity?.primaryConversionBlocker ?? "A structural condition"} is the primary structural condition, and it matters because it affects visible clarity and action readiness.`,
    primaryIssue: firstDecision?.decisionClassification ?? report.executiveClarity?.primaryConversionBlocker,
    businessConsequence: firstDecision?.impactExplanation ?? report.executiveClarity?.primaryOpportunity,
    evidenceIds: firstDecision?.evidenceTraceReferences ?? []
  };
}

function fallbackOssInterpretation(report: ReportSnapshot): ReportSnapshot["ossInterpretation"] {
  const score = report.oss?.score;
  if (typeof score !== "number") {
    return {
      layer: "decision",
      score: null,
      strictClassification: "not_scored",
      label: "Not Scored",
      range: "N/A",
      oneLineDiagnosis: "Website content could not be collected, so OSS was not scored.",
      meaning: "No structural conclusion was generated because validated page evidence was unavailable.",
      visualState: report.oss?.visualState ?? NOT_SCORED_VISUAL_STATE
    };
  }
  const visualState = report.oss?.visualState ?? visualStateForScore(score);
  const common = {
    layer: "decision" as const,
    score,
    visualState
  };
  if (score < 40) {
    return {
      ...common,
      strictClassification: "critical_structural_failure",
      label: "Critical Structural Failure",
      range: "0-39",
      oneLineDiagnosis: "Core observable structure is critically limited.",
      meaning: "Critical structural failure means multiple observable website foundations are missing or unreliable."
    };
  }
  if (score < 75) {
    return {
      ...common,
      strictClassification: "structural_friction",
      label: "Structural Friction",
      range: "40-74",
      oneLineDiagnosis: report.executiveClarity?.primaryConversionBlocker,
      meaning: "Structural friction means the website is usable but contains observable clarity, trust, or conversion obstacles."
    };
  }
  return {
    ...common,
    strictClassification: "minor_optimization_opportunities",
    label: "Minor Optimization Opportunities",
    range: "75-100",
    oneLineDiagnosis: report.executiveClarity?.primaryOpportunity,
    meaning: "Minor optimization opportunities means core structure is stable and the report should guide targeted improvements."
  };
}

function fallbackBusinessRisk(report: ReportSnapshot): ReportSnapshot["businessRiskStatus"] {
  return {
    classification: (report.verdictCard?.businessRiskStatus ?? "").startsWith("Critical")
      ? "CRITICAL"
      : (report.verdictCard?.businessRiskStatus ?? "").startsWith("High")
        ? "HIGH"
        : (report.verdictCard?.businessRiskStatus ?? "").startsWith("Medium")
          ? "MEDIUM"
          : "LOW",
    level: report.verdictCard?.businessRiskStatus,
    primaryRiskDriver: report.verdictCard?.topIssue,
    explanation:
      "Business Risk Status was derived from the verdict card because this legacy snapshot does not contain the dedicated risk section.",
    evidenceIds: report.decisions?.[0]?.evidenceTraceReferences ?? []
  };
}

function fallbackEvidenceCoverage(report: ReportSnapshot): ReportSnapshot["evidenceCoverageSummary"] {
  const pages = Object.entries(report.scanCoverage?.pageRoles ?? {}).map(([url, role]) => {
    const evidence = (report.evidenceObjects ?? []).filter((item) => item.url === url);
    return {
      url,
      role,
      httpStatus: "not_fetched" as const,
      evidenceCount: evidence.length,
      coverageStatus: evidence.length >= 20 ? "Complete" as const : evidence.length >= 8 ? "Partial" as const : "Limited" as const,
      keySignals: Array.from(new Set(evidence.map((item) => String(item.normalizedInput.signalKey ?? item.sourceType)))).slice(0, 8)
    };
  });

  return {
    totalPagesSampled: report.scanCoverage?.sampledPages,
    totalEvidenceObjects: report.evidenceObjects?.length ?? 0,
    pages: pages.length > 0 ? pages : [{
      url: report.targetUrl,
      role: "scan",
      httpStatus: "not_fetched",
      evidenceCount: report.evidenceObjects?.length ?? 0,
      coverageStatus: "Limited",
      keySignals: []
    }]
  };
}

function fallbackOutcomeBridge(report: ReportSnapshot): ReportSnapshot["businessOutcomeBridge"] {
  return (report.decisions ?? []).slice(0, 4).map((decision, index) => ({
    bridgeId: `LEGACY-BOB-${index + 1}`,
    structuralFinding: decision.decisionClassification,
    mappedBusinessOutcome: decision.impactExplanation,
    quantifiedUpliftRange: {
      informationClarity: "+5-9% clarity improvement",
      conversionReadiness: "+8-12% conversion readiness",
      trustStrength: "+3-6% trust improvement"
    },
    opportunityRange: decision.category === "Structural Priority: High" ? "High" : decision.category === "Optimization Required" ? "Moderate" : "Limited",
    transformationMapping: decision.recommendedActionPath,
    evidenceIds: decision.evidenceTraceReferences,
    confidenceScore: decision.confidenceScore,
    limitation: "Legacy snapshot bridge. Re-run the scan for the full Business Outcome Bridge model."
  }));
}

function fallbackRevenueIntelligence(report: ReportSnapshot): ReportSnapshot["revenueIntelligence"] {
  const evidenceIds = Array.from(new Set((report.decisions ?? []).flatMap((decision) => decision.evidenceTraceReferences)));
  const conversion = report.dimensions?.find((dimension) => dimension.key === "conversionReadiness");
  const trust = report.dimensions?.find((dimension) => dimension.key === "trust");
  const clarity = report.dimensions?.find((dimension) => dimension.key === "informationClarity");
  const confidenceScore = Math.round(
    ((conversion?.confidenceScore ?? 60) * 0.4) +
      ((trust?.confidenceScore ?? 60) * 0.25) +
      ((clarity?.confidenceScore ?? 60) * 0.2) +
      5
  );
  const friction = Math.max(0, 100 - (report.oss?.score ?? 0));
  const pressureRows = (report.competitorComparison ?? []).flatMap((comparison) =>
    (comparison.evidenceTraceabilityMap ?? []).filter((row) => row.position === "primary_weaker")
  );

  return {
    status: "input_limited",
    confidenceScore,
    confidenceBasis:
      "Legacy snapshot compatibility mode. Revenue Intelligence V1 needs a fresh scan to persist full structural estimate data.",
    trafficRange: {
      label: "Estimated monthly traffic readiness range",
      low: Math.max(50, Math.round(800 * ((report.oss?.score ?? 0) / 100))),
      high: Math.max(120, Math.round(1800 * Math.max(0.35, (report.oss?.score ?? 0) / 100))),
      unit: "monthly_visits",
      confidenceScore,
      rationale: "Derived from OSS structural readiness because first-party traffic data is not available in this legacy snapshot.",
      evidenceIds
    },
    conversionPotentialRange: {
      label: "Estimated conversion potential range",
      low: Number(Math.max(0.4, ((conversion?.score ?? (report.oss?.score ?? 0)) / 100) * 1.2).toFixed(2)),
      high: Number(Math.min(6, Math.max(0.8, ((conversion?.score ?? (report.oss?.score ?? 0)) / 100) * 1.2 + friction / 35)).toFixed(2)),
      unit: "conversion_rate_percent",
      confidenceScore: conversion?.confidenceScore ?? confidenceScore,
      rationale: "Derived from conversion readiness and observable structural friction.",
      evidenceIds: conversion?.evidenceIds ?? evidenceIds
    },
    revenueOpportunityRange: {
      label: "Estimated recoverable monthly value range",
      low: Math.round(friction * 0.08),
      high: Math.round(friction * 0.22),
      unit: "monthly_value_units",
      confidenceScore,
      rationale: "No analytics, CRM, payment, or lead-value inputs are available, so SYSTOLAB reports value units instead of currency.",
      evidenceIds
    },
    opportunityCostRange: {
      label: "Estimated monthly opportunity cost range",
      low: Math.round(friction * 0.06),
      high: Math.round(friction * 0.31),
      unit: "opportunity_cost_units",
      confidenceScore,
      rationale: "Uses OSS friction and weakest validated dimensions to estimate structural opportunity cost units.",
      evidenceIds
    },
    competitorRevenuePressure: {
      status: (report.competitorComparison ?? []).length > 0 ? "assessed" : "not_assessed",
      pressureLevel: pressureRows.length >= 4 ? "High" : pressureRows.length >= 2 ? "Moderate" : pressureRows.length > 0 ? "Low" : "Unknown",
      explanation:
        pressureRows.length > 0
          ? `${pressureRows.length} competitor dimension row(s) show the client structurally weaker; this is structural pressure only.`
          : "No competitor structural pressure was available in this snapshot.",
      evidenceIds: pressureRows.flatMap((row) => [...row.primaryEvidenceIds, ...row.competitorEvidenceIds])
    },
    limitations: [
      "Revenue Intelligence estimates structural opportunity and value ranges only.",
      "No external APIs, analytics data, ad data, CRM data, or financial systems were used.",
      "Fresh scans persist the full V1 revenue intelligence layer."
    ]
  };
}

function normalizeRevenueIntelligence(report: ReportSnapshot): ReportSnapshot["revenueIntelligence"] {
  const fallback = fallbackRevenueIntelligence(report);
  const current = report.revenueIntelligence as Partial<ReportSnapshot["revenueIntelligence"]> | undefined;
  if (!current) return fallback;

  return {
    ...fallback,
    ...current,
    trafficRange: { ...fallback.trafficRange, ...(current.trafficRange ?? {}) },
    conversionPotentialRange: { ...fallback.conversionPotentialRange, ...(current.conversionPotentialRange ?? {}) },
    revenueOpportunityRange: { ...fallback.revenueOpportunityRange, ...(current.revenueOpportunityRange ?? {}) },
    opportunityCostRange: { ...fallback.opportunityCostRange, ...(current.opportunityCostRange ?? {}) },
    competitorRevenuePressure: { ...fallback.competitorRevenuePressure, ...(current.competitorRevenuePressure ?? {}) },
    limitations: current.limitations ?? fallback.limitations
  };
}

function fallbackRecommendationEngine(report: ReportSnapshot): ReportSnapshot["recommendationEngine"] {
  const source = (report.decisions ?? []).length > 0
    ? report.decisions
    : [...(report.dimensions ?? [])].sort((a, b) => a.score - b.score).slice(0, 3).map((dimension, index) => ({
        decisionId: `LEGACY-DIM-${index + 1}`,
        category: dimension.score < 60 ? "Structural Priority: High" as const : dimension.score < 75 ? "Optimization Required" as const : "Monitoring Suggested" as const,
        decisionClassification: `${dimension.label}: ${dimension.classification}`,
        evidenceTraceReferences: dimension.evidenceIds,
        impactExplanation: dimension.businessMeaning,
        recommendedActionPath: "Re-run scan for a full recommendation action path.",
        confidenceScore: dimension.confidenceScore,
        confidenceLevel: dimension.confidenceLevel
      }));

  return {
    status: source.length > 0 ? "generated" : "limited",
    recommendations: source.map((decision, index) => {
      const dimension = report.dimensions?.find((item) =>
        decision.decisionClassification.toLowerCase().startsWith(item.label.toLowerCase())
      );
      const priority: ReportSnapshot["recommendationEngine"]["recommendations"][number]["priority"] =
        decision.category === "Structural Priority: High" ? "FIX NOW" : decision.category === "Optimization Required" ? "THIS MONTH" : "MONITOR";
      const expectedScoreMovement = dimension
        ? dimension.score < 40 ? 22 : dimension.score < 60 ? 16 : dimension.score < 75 ? 10 : 5
        : 6;
      return {
        recommendationId: `LEGACY-REC-${index + 1}`,
        sourceDecisionId: decision.decisionId,
        issue: decision.decisionClassification,
        action: decision.recommendedActionPath,
        priority,
        mappedDimensions: dimension ? [dimension.key] : [],
        expectedScoreMovement,
        revenueIntelligenceMapping: "Legacy recommendation mapped to structural opportunity units; re-run for full persisted revenue mapping.",
        confidenceScore: decision.confidenceScore,
        evidenceIds: decision.evidenceTraceReferences,
        changeValidationPlan: "Re-scan after implementation and compare OSS, dimension movement, and linked evidence objects."
      };
    }),
    mappingSystem: {
      rule: "one_recommendation_one_change_cluster",
      explanation:
        "Each recommendation maps to one issue, one action, one evidence set, and one future change-validation cluster."
    }
  };
}

function fallbackChangeDetection(report: ReportSnapshot): ReportSnapshot["lightweightChangeDetection"] {
  return {
    status: "baseline_only",
    changes: [],
    explanation:
      `Snapshot ${report.snapshotId} is treated as the baseline. Re-scan the same target to generate lightweight change records.`
  };
}

function fallbackArchitectureState(): ReportSnapshot["architectureState"] {
  return {
    flow: [
      "identity_context",
      "data",
      "truth_evidence",
      "intelligence",
      "revenue_intelligence",
      "confidence",
      "automation",
      "action_alert",
      "outcome_validation"
    ],
    activeV1Engines: [
      "Scan History Tracking",
      "Evidence Collection",
      "OSS Scoring Engine",
      "Revenue Intelligence Engine",
      "Recommendation Engine",
      "Competitor Snapshot Analysis",
      "Confidence Engine",
      "Lightweight Change Detection"
    ],
    stagedFutureEngines: [
      {
        engine: "Operational Memory Graph",
        status: "architecturally_integrated",
        activationNote: "Event and history records provide graph-ready nodes and edges for future activation."
      },
      {
        engine: "Business Evolution Engine",
        status: "staged_for_future_activation",
        activationNote: "Chronological growth narratives activate after multiple validated snapshots per workspace."
      },
      {
        engine: "Outcome Validation Engine",
        status: "architecturally_integrated",
        activationNote: "Recommendation IDs and change records create the validation path for future outcome scoring."
      },
      {
        engine: "Competitive Threat Radar",
        status: "staged_for_future_activation",
        activationNote: "Competitor snapshots and comparison rows are stored for recurring monitoring."
      },
      {
        engine: "Business DNA Engine",
        status: "staged_for_future_activation",
        activationNote: "Pattern extraction activates after sufficient scan history and recommendation outcomes."
      },
      {
        engine: "Edit Intelligence System",
        status: "staged_for_future_activation",
        activationNote: "Behavioral event contracts are reserved without exposing passive inference directly to users."
      }
    ],
    eventDrivenContract:
      "Layers communicate through standardized SYSTOLAB event envelopes and immutable snapshot/history records; no layer mutates another layer's internal logic."
  };
}

function fallbackEvidenceDatabase(report: ReportSnapshot): ReportSnapshot["evidenceDatabase"] {
  return (report.decisions ?? []).slice(0, 5).map((decision, index) => ({
    evidenceId: `LEGACY-EV-${index + 1}`,
    issue: decision.decisionClassification,
    before: null,
    after: decision.recommendedActionPath,
    confidenceScore: decision.confidenceScore,
    confidenceReason: "Legacy snapshot compatibility row built from decision evidence references.",
    evidenceType: "issue_state",
    lineage: {
      snapshotId: report.snapshotId,
      sourceEvidenceIds: decision.evidenceTraceReferences,
      recommendationIds: [],
      validationTraceIds: []
    },
    capturedAt: report.createdAt
  }));
}

function fallbackOutcomeValidation(report: ReportSnapshot): ReportSnapshot["recommendationOutcomeLoop"] {
  const recommendations = report.recommendationEngine?.recommendations ?? fallbackRecommendationEngine(report).recommendations;
  return {
    status: "baseline_pending",
    validations: recommendations.map((recommendation) => ({
      recommendationId: recommendation.recommendationId,
      recommendation: recommendation.action,
      implementedStatus: "pending_baseline",
      ossDelta: null,
      dimensionDeltas: recommendation.mappedDimensions?.map((dimensionKey) => {
        const dimension = report.dimensions?.find((item) => item.key === dimensionKey);
        return {
          dimension: dimensionKey,
          dimensionLabel: dimension?.label ?? dimensionKey,
          beforeScore: null,
          afterScore: dimension?.score ?? 0,
          delta: null
        };
      }),
      improvementStatus: "pending",
      revenueImpact: {
        label: "Pending structural impact value units",
        low: 0,
        high: 0,
        unit: "monthly_value_units",
        confidenceScore: 0,
        rationale: "A second scan is required to validate this recommendation.",
        evidenceIds: recommendation.evidenceIds
      },
      confidenceScore: 0,
      confidenceReasons: ["A baseline scan is required before outcome validation can run."],
      evidenceIds: recommendation.evidenceIds
    })),
    summary: "Legacy snapshot baseline. Re-scan after implementation to validate recommendation outcomes."
  };
}

function fallbackConfidenceEngine(report: ReportSnapshot): ReportSnapshot["confidenceEngine"] {
  const overall = report.confidenceLayer?.[0]?.confidenceScore ?? 0;
  return {
    overallConfidenceScore: overall,
    confidenceLevel: report.confidenceLayer?.[0]?.confidenceLevel ?? "Limited",
    factors: (report.confidenceLayer ?? []).slice(0, 5).map((item, index) => ({
      factorId: `LEGACY-CONF-${index + 1}`,
      label: item.intelligenceArea,
      score: item.confidenceScore,
      weight: index === 0 ? 30 : 15,
      reason: item.basis,
      evidenceIds: []
    })),
    estimateExplanations: [
      {
        area: "Revenue Estimate",
        confidenceScore: report.revenueIntelligence?.confidenceScore ?? 0,
        reasons: [report.revenueIntelligence?.confidenceBasis ?? "Legacy snapshot has limited revenue confidence explanation."],
        missingInputs: ["Analytics access", "CRM data", "External traffic API intentionally not used"],
        evidenceIds: report.revenueIntelligence?.revenueOpportunityRange.evidenceIds ?? []
      }
    ]
  };
}

function fallbackIndustryBenchmark(report: ReportSnapshot): ReportSnapshot["industryBenchmarkEngine"] {
  return {
    status: "low_coverage",
    industryType: "local_service",
    datasetVersion: "legacy.compat",
    sampleSize: 0,
    verticalAverages: [],
    currentPosition: report.dimensions?.map((dimension) => ({
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      score: dimension.score,
      industryAverage: 0,
      position: "Not Assessed",
      delta: 0
    })),
    limitations: ["Legacy snapshot does not include industry benchmark engine output. Re-run scan to populate seeded internal benchmarks."]
  };
}

function fallbackCompetitorIntelligence(report: ReportSnapshot): ReportSnapshot["competitorIntelligenceEngine"] {
  return {
    status: (report.competitorComparison ?? []).length > 0 ? "limited" : "not_assessed",
    competitors: (report.competitorComparison ?? []).map((competitor) => ({
      competitorUrl: competitor.competitorUrl,
      competitorLabel: competitor.competitorLabel,
      timeline: [{
        snapshotId: report.snapshotId,
        capturedAt: report.createdAt,
        oss: competitor.competitorOss,
        dimensions: Object.fromEntries(competitor.evidenceTraceabilityMap?.map((row) => [row.dimension, row.competitorScore ?? undefined]))
      }],
      latestMovement: {
        ossDelta: null,
        changedDimensions: []
      }
    })),
    explanation: "Legacy snapshot has competitor comparison but no historical competitor timeline."
  };
}

function fallbackMonitoringScheduler(report: ReportSnapshot): ReportSnapshot["monitoringScheduler"] {
  const baseDate = report.createdAt ? new Date(report.createdAt) : new Date();
  const next = new Date(baseDate);
  next.setUTCDate(next.getUTCDate() + 7);
  return {
    status: "manual_only",
    scheduleId: `legacy-${report.snapshotId}`,
    cadence: "weekly",
    enabled: false,
    lastRunAt: report.createdAt,
    nextRunAt: next.toISOString(),
    targetUrl: report.targetUrl,
    competitorUrls: report.competitorComparison?.map((item) => item.competitorUrl) ?? [],
    alertChannels: ["dashboard"]
  };
}

function fallbackAlertEngine(_report: ReportSnapshot): ReportSnapshot["alertEngine"] {
  return {
    status: "no_alerts",
    alerts: []
  };
}

function fallbackOperationalMemory(report: ReportSnapshot): ReportSnapshot["operationalMemoryGraph"] {
  return {
    status: "limited_history",
    nodes: [
      { nodeId: `legacy-website-${report.snapshotId}`, type: "website", label: report.targetUrl, metadata: { targetUrl: report.targetUrl } },
      { nodeId: `legacy-snapshot-${report.snapshotId}`, type: "snapshot", label: report.snapshotId, metadata: { snapshotId: report.snapshotId } }
    ],
    edges: [{
      edgeId: `legacy-edge-${report.snapshotId}`,
      from: `legacy-website-${report.snapshotId}`,
      to: `legacy-snapshot-${report.snapshotId}`,
      relationship: "has_snapshot",
      confidenceScore: 100
    }],
    summary: "Legacy snapshot memory graph contains website and snapshot baseline nodes only."
  };
}

function fallbackBusinessEvolution(report: ReportSnapshot): ReportSnapshot["businessEvolutionEngine"] {
  const score = report.oss?.score;
  return {
    status: "baseline_only",
    timeline: typeof score === "number" ? [{
      snapshotId: report.snapshotId,
      capturedAt: report.createdAt,
      oss: score,
      topCause: report.executiveClarity?.primaryConversionBlocker
    }] : [],
    trend: "baseline",
    scoreDelta: 0,
    causeNarrative: "This snapshot is treated as the baseline for business evolution tracking."
  };
}

function fallbackBusinessDna(report: ReportSnapshot): ReportSnapshot["businessDnaEngine"] {
  const strengths = (report.dimensions ?? []).filter((dimension) => dimension.score >= 75).map((dimension) => dimension.label);
  const weaknesses = (report.dimensions ?? []).filter((dimension) => dimension.score < 60).map((dimension) => dimension.label);
  return {
    status: "baseline_profile",
    strengths: strengths.length ? strengths : ["No dominant strength detected yet"],
    weaknesses: weaknesses.length ? weaknesses : ["No critical weakness detected"],
    growthStyle: "baseline_only",
    recurringPatterns: ["More history is required for recurring pattern detection."],
    confidenceScore: report.confidenceLayer?.[0]?.confidenceScore ?? 0
  };
}

function fallbackThreatRadar(report: ReportSnapshot): ReportSnapshot["competitiveThreatRadar"] {
  return {
    status: (report.competitorComparison ?? []).length > 0 ? "active" : "not_assessed",
    threatLevel: "UNKNOWN",
    threats: [],
    explanation: "Legacy snapshot does not include threat radar movement analysis."
  };
}

function fallbackEditIntelligence(report: ReportSnapshot): ReportSnapshot["editIntelligenceSystem"] {
  return {
    status: "collector_ready",
    sessionFingerprint: report.snapshotId,
    observedSignals: [],
    abandonmentRisk: "unknown",
    churnInference: "not_enough_behavior",
    funnelAnalytics: [
      { step: "scan_started", observed: true, evidenceIds: [] },
      { step: "report_viewed", observed: false, evidenceIds: [] }
    ],
    limitations: ["Legacy snapshot fallback. First-party edit events are collected through the SYSTOLAB backend."]
  };
}

function fallbackPriorityTimeline(report: ReportSnapshot): ReportSnapshot["priorityTimeline"] {
  const items = (report.decisions ?? []).map((decision, index) => ({
    actionId: `LEGACY-PT-${index + 1}`,
    action: decision.recommendedActionPath,
    category: decision.category === "Structural Priority: High" ? "FIX NOW" as const : decision.category === "Optimization Required" ? "THIS MONTH" as const : "MONITOR" as const,
    timeWindow: decision.category === "Structural Priority: High" ? "0-7 days" as const : decision.category === "Optimization Required" ? "7-30 days" as const : "ongoing" as const,
    structuralSeverity: decision.category === "Structural Priority: High" ? "High" as const : decision.category === "Optimization Required" ? "Medium" as const : "Low" as const,
    evidenceStrength: decision.confidenceLevel,
    evidenceIds: decision.evidenceTraceReferences
  }));

  return {
    fixNow: items.filter((item) => item.category === "FIX NOW"),
    thisMonth: items.filter((item) => item.category === "THIS MONTH"),
    monitor: items.filter((item) => item.category === "MONITOR")
  };
}

function fallbackTransformation(report: ReportSnapshot): ReportSnapshot["transformationIntelligence"] {
  const dimensions = [...(report.dimensions ?? [])].sort((a, b) => a.score - b.score).slice(0, 5);
  const dimensionProjections = dimensions.map((dimension) => {
    const delta = dimension.score < 40 ? 22 : dimension.score < 60 ? 16 : dimension.score < 75 ? 10 : 5;
    return {
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      currentScore: dimension.score,
      projectedScore: Math.min(100, dimension.score + delta),
      projectedDelta: delta,
      recommendedActionPath: report.decisions?.find((decision) => decision.decisionClassification.startsWith(dimension.label))?.recommendedActionPath ?? "Re-run scan for a full transformation action path.",
      evidenceIds: dimension.evidenceIds
    };
  });
  const projectedDelta = Math.round(dimensionProjections.reduce((sum, item) => sum + item.projectedDelta, 0) / 2.8) || 0;

  return {
    currentOss: report.oss?.score ?? 0,
    projectedOss: Math.min(100, (report.oss?.score ?? 0) + projectedDelta),
    projectedDelta,
    projectionBasis: "Legacy snapshot projection. Re-run the scan for the full deterministic Transformation Intelligence Layer.",
    dimensionProjections
  };
}

function fallbackClosedLoop(report: ReportSnapshot): ReportSnapshot["closedLoopProofSystem"] {
  return {
    status: "baseline_only",
    baselineSnapshotId: report.snapshotId,
    beforeOss: report.oss?.score ?? 0,
    dimensionDeltas: (report.dimensions ?? []).map((dimension) => ({
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      beforeScore: dimension.score
    })),
    explanation: "This snapshot is the baseline. Re-run after fixes to generate a delta comparison."
  };
}

function fallbackMarketReadiness(report: ReportSnapshot): ReportSnapshot["marketReadinessPosition"] {
  return {
    status: report.benchmarkContext?.status ?? "not_available",
    datasetLabel: report.benchmarkContext?.datasetLabel ?? "SYSTOLAB Comparative Reference Dataset (v1.0)",
    comparativeConfidenceScore: report.benchmarkContext?.comparativeConfidenceScore ?? 0,
    positions: (report.dimensions ?? []).map((dimension) => ({
      dimension: dimension.key,
      dimensionLabel: dimension.label,
      position: "Not Assessed",
      score: dimension.score,
      evidenceIds: dimension.evidenceIds
    })),
    limitation: "Benchmark coverage is low or unavailable, so readiness positions are not approximated."
  };
}

function fallbackGroundTruthValidationLog(report: ReportSnapshot): ReportSnapshot["groundTruthValidationLog"] {
  const checks = [
    { check: "Primary CTA" as const, signalKeys: ["cta_present"] },
    { check: "Primary CTA Above Fold" as const, signalKeys: ["primary_cta_above_fold"] },
    { check: "H1 Heading" as const, signalKeys: ["h1_present"] },
    { check: "Trust Signals" as const, signalKeys: ["privacy_link_present", "about_link_present", "contact_signal_present"] }
  ];

  return checks.map((check, index) => {
    const evidence = (report.evidenceObjects ?? []).filter((item) =>
      check.signalKeys.includes(String(item.normalizedInput.signalKey))
    );
    const evidenceIds = evidence.map((item) => item.evidenceId);
    const gtcsScore = evidence.length
      ? Math.round(evidence.reduce((sum, item) => sum + item.groundTruthConfidence, 0) / evidence.length)
      : 0;
    return {
      logId: `LEGACY-GTV-${index + 1}`,
      check: check.check,
      signalKeys: check.signalKeys,
      httpResult: "not_checked" as const,
      domResult: evidence.length > 0 ? "found" as const : "not_found" as const,
      renderResult: "not_rendered" as const,
      outcome: evidence.length > 0 ? `${check.check} has linked legacy evidence.` : `${check.check} was not found in legacy evidence.`,
      gtcsScore,
      gtcsMeaning: gtcsMeaning(gtcsScore),
      evidenceIds,
      validationTraceIds: (report.validationTrace ?? []).filter((trace) => trace.evidenceId && evidenceIds.includes(trace.evidenceId)).map((trace) => trace.traceId)
    };
  });
}

function normalizeComparison(
  report: ReportSnapshot,
  comparison: ReportSnapshot["competitorComparison"][number]
): ReportSnapshot["competitorComparison"][number] {
  const rows = (comparison.evidenceTraceabilityMap ?? []).map((row) => {
    const difference =
      typeof row.difference === "number"
        ? row.difference
        : typeof row.competitorScore === "number"
          ? row.primaryScore - row.competitorScore
          : 0;

    return {
      ...row,
      dimensionLabel: row.dimensionLabel ?? row.dimension,
      competitorScore: row.competitorScore ?? null,
      difference,
      position: row.position ?? (Math.abs(difference) <= 5 ? "structurally_equivalent" : difference > 0 ? "primary_stronger" : "primary_weaker")
    };
  });

  const primaryStrengthCount = comparison.primaryStrengthCount ?? rows.filter((row) => row.position === "primary_stronger").length;
  const competitorStrengthCount = comparison.competitorStrengthCount ?? rows.filter((row) => row.position === "primary_weaker").length;
  const equivalentCount = comparison.equivalentCount ?? rows.filter((row) => row.position === "structurally_equivalent").length;

  return {
    ...comparison,
    status: comparison.status ?? "assessed",
    competitorUrl: comparison.competitorUrl,
    competitorLabel: comparison.competitorLabel ?? safeHostLabel(comparison.competitorUrl),
    primaryOss: comparison.primaryOss ?? report.oss?.score,
    competitorOss: comparison.competitorOss ?? null,
    assessedPages: comparison.assessedPages ?? 0,
    structuralGapSummary:
      comparison.structuralGapSummary ??
      `${primaryStrengthCount} dimension(s) structurally stronger for the client, ${competitorStrengthCount} dimension(s) structurally stronger for the competitor, and ${equivalentCount} structurally equivalent.`,
    primaryStrengthCount,
    competitorStrengthCount,
    equivalentCount,
    dataAvailability: comparison.dataAvailability ?? "Legacy comparison snapshot; re-run scan for complete competitor data availability.",
    evidenceTraceabilityMap: rows
  };
}

function ConfidenceLayer({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <CheckCircle2 size={18} />
        <h2>Intelligence Confidence</h2>
      </div>
      <div className="confidence-grid">
        {report.confidenceLayer?.slice(0, 8).map((metric) => (
          <div className="confidence" key={metric.intelligenceArea}>
            <span>{metric.intelligenceArea}</span>
            <strong>{metric.confidenceScore}%</strong>
            <em>{metric.confidenceLevel} Confidence</em>
            <small>{metric.basis}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function DimensionTrace({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <Braces size={18} />
        <h2>Score Engine Trace</h2>
      </div>
      {report.dimensions?.map((dimension) => (
        <details className="trace-detail" key={dimension.key}>
          <summary>
            <span>
              <StateDot color={dimension.visualState?.color ?? visualStateForScore(dimension.score).color} />
              {dimension.label}
            </span>
            <strong>{dimension.score}</strong>
          </summary>
          <div className="trace-grid">
            {dimension.trace?.map((factor) => (
              <div className="trace-factor" key={factor.factorId}>
                <span>{factor.label}</span>
                <strong>{factor.contribution} / {factor.weight}</strong>
                <small>{factor.evidenceIds?.join(", ") || "No supporting evidence"}</small>
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

function DecisionLayer({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <KeyRound size={18} />
        <h2>SYSTEM DECISION SUMMARY - ACTIONABLE STRUCTURAL OUTCOME</h2>
      </div>
      <p className="decision-summary">{report.decisionSummary}</p>
      <div className="decision-grid">
        {report.decisions?.map((decision) => (
          <div className="decision" key={decision.decisionId}>
            <span>{decision.category}</span>
            <strong>{decision.decisionClassification}</strong>
            <p>{decision.impactExplanation}</p>
            <p>{decision.recommendedActionPath}</p>
            <small>Confidence {decision.confidenceScore}% - {decision.evidenceTraceReferences?.join(", ")}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function GroundTruthValidationLog({ report }: { report: ReportSnapshot }) {
  const logs = report.groundTruthValidationLog ?? fallbackGroundTruthValidationLog(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <CheckCircle2 size={18} />
        <h2>Ground Truth Validation Log</h2>
      </div>
      <div className="validation-grid">
        {logs.map((log) => (
          <div className="validation-card" key={log.logId}>
            <span>{log.check}</span>
            <strong>{log.outcome}</strong>
            <div className="meta-strip compact-metrics">
              <Metric label="HTTP" value={log.httpResult?.replaceAll("_", " ")} />
              <Metric label="DOM" value={log.domResult?.replaceAll("_", " ")} />
              <Metric label="Render" value={log.renderResult?.replaceAll("_", " ")} />
              <Metric label="GTCS" value={`${log.gtcsScore}%`} />
            </div>
            <p>{log.gtcsMeaning}</p>
            <small>Signals {log.signalKeys?.join(", ")} | EO {log.evidenceIds?.join(", ") || "None"} | Trace {log.validationTraceIds?.join(", ") || "None"}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function MonitoringAndAlerts({ report }: { report: ReportSnapshot }) {
  const monitoring = report.monitoringScheduler ?? fallbackMonitoringScheduler(report);
  const alerts = report.alertEngine ?? fallbackAlertEngine(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <CalendarClock size={18} />
        <h2>Monitoring Scheduler & Alert Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Monitoring" value={monitoring.status?.replaceAll("_", " ")} />
        <Metric label="Cadence" value={monitoring.cadence} />
        <Metric label="Next Run" value={formatDate(monitoring.nextRunAt)} />
        <Metric label="Alerts" value={String(alerts.alerts?.length ?? 0)} />
      </div>
      <div className="system-grid">
        {(alerts.alerts?.length ?? 0) === 0 ? (
          <div className="system-card">
            <span>{alerts.status?.replaceAll("_", " ")}</span>
            <strong>No active alerts</strong>
            <p>Dashboard alert routing is ready for score drops, competitor movement, validated recommendations, and revenue pressure.</p>
          </div>
        ) : (
          alerts.alerts.map((alert) => (
            <div className="system-card" key={alert.alertId}>
              <span>{alert.severity}</span>
              <strong>{alert.title}</strong>
              <p>{alert.message}</p>
              <small>{alert.type?.replaceAll("_", " ")} | {alert.trigger}</small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function OperationalMemory({ report }: { report: ReportSnapshot }) {
  const graph = report.operationalMemoryGraph ?? fallbackOperationalMemory(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Layers size={18} />
        <h2>Operational Memory Graph</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={graph.status?.replaceAll("_", " ")} />
        <Metric label="Nodes" value={String(graph.nodes?.length ?? 0)} />
        <Metric label="Edges" value={String(graph.edges?.length ?? 0)} />
      </div>
      <p className="muted">{graph.summary}</p>
      <div className="system-grid compact-system-grid">
        {graph.nodes?.slice(0, 6).map((node) => (
          <div className="system-card" key={node.nodeId}>
            <span>{node.type}</span>
            <strong>{node.label}</strong>
            <small>{node.nodeId}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function BusinessEvolution({ report }: { report: ReportSnapshot }) {
  const evolution = report.businessEvolutionEngine ?? fallbackBusinessEvolution(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>Business Evolution Engine</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={evolution.status?.replaceAll("_", " ")} />
        <Metric label="Trend" value={evolution.trend} />
        <Metric label="Score Delta" value={formatDifference(evolution.scoreDelta)} />
      </div>
      <p className="muted">{evolution.causeNarrative}</p>
      <div className="system-grid compact-system-grid">
        {evolution.timeline?.map((point) => (
          <div className="system-card" key={point.snapshotId}>
            <span>{formatDate(point.capturedAt)}</span>
            <strong>OSS {point.oss}</strong>
            <p>{point.topCause}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BusinessDna({ report }: { report: ReportSnapshot }) {
  const dna = report.businessDnaEngine ?? fallbackBusinessDna(report);
  const threat = report.competitiveThreatRadar ?? fallbackThreatRadar(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Activity size={18} />
        <h2>Business DNA & Competitive Threat Radar</h2>
      </div>
      <div className="meta-strip">
        <Metric label="DNA Status" value={dna.status?.replaceAll("_", " ")} />
        <Metric label="Growth Style" value={dna.growthStyle?.replaceAll("_", " ")} />
        <Metric label="Threat Level" value={threat.threatLevel} />
      </div>
      <div className="system-grid">
        <div className="system-card">
          <span>Strengths</span>
          <strong>{dna.strengths.join(", ")}</strong>
          <p>Weaknesses: {dna.weaknesses.join(", ")}</p>
          <small>Confidence {dna.confidenceScore}%</small>
        </div>
        <div className="system-card">
          <span>{threat.status?.replaceAll("_", " ")}</span>
          <strong>{threat.explanation}</strong>
          {threat.threats?.slice(0, 4).map((item) => (
            <small key={`${item.competitorUrl}-${item.threatType}`}>{item.severity}: {item.reason}</small>
          ))}
        </div>
      </div>
    </section>
  );
}

function EditIntelligence({ report }: { report: ReportSnapshot }) {
  const edit = report.editIntelligenceSystem ?? fallbackEditIntelligence(report);
  return (
    <section className="report-section">
      <div className="section-title">
        <Activity size={18} />
        <h2>Edit Intelligence System</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={edit.status?.replaceAll("_", " ")} />
        <Metric label="Abandonment Risk" value={edit.abandonmentRisk} />
        <Metric label="Churn" value={edit.churnInference?.replaceAll("_", " ")} />
      </div>
      <div className="system-grid">
        {edit.funnelAnalytics?.map((step) => (
          <div className="system-card" key={step.step}>
            <span>{step.observed ? "observed" : "not observed"}</span>
            <strong>{step.step?.replaceAll("_", " ")}</strong>
            <small>{edit.sessionFingerprint}</small>
          </div>
        ))}
      </div>
      <p className="muted">{edit.limitations?.join(" ")}</p>
    </section>
  );
}

function EvidenceExplorer({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <ShieldCheck size={18} />
        <h2>Evidence Explorer</h2>
      </div>
      <div className="evidence-list">
        {(report.evidenceObjects ?? []).map((evidence) => {
          const traces = (report.validationTrace ?? []).filter((trace) => trace.evidenceId === evidence.evidenceId);
          return (
          <details className="evidence" key={evidence.evidenceId}>
            <summary>
              <strong>{evidence.evidenceId}</strong>
              <span>{evidence.sourceType.toUpperCase()}</span>
              <em>{evidence.groundTruthConfidence}% GTCS</em>
            </summary>
            <dl>
              <dt>Page</dt>
              <dd>{evidence.url}</dd>
              <dt>Selector Path</dt>
              <dd>{evidence.selectorPath ?? "Not applicable"}</dd>
              <dt>Raw Value</dt>
              <dd>{evidence.rawValue}</dd>
              <dt>Validation Method</dt>
              <dd>{evidence.validationMethod ?? "Not assigned"}</dd>
              <dt>Confidence Basis</dt>
              <dd>{evidence.confidenceBasis}</dd>
              <dt>GTCS Meaning</dt>
              <dd>{evidence.groundTruthMeaning ?? gtcsMeaning(evidence.groundTruthConfidence)}</dd>
              <dt>Render State</dt>
              <dd>{evidence.renderState ?? "not_rendered"}</dd>
              <dt>Render Visibility</dt>
              <dd>{evidence.renderVisibility ?? "not_applicable"}</dd>
              <dt>Render Verification</dt>
              <dd>{evidence.renderVerification ?? "No render verification attached to this evidence object."}</dd>
              <dt>Validation Trace</dt>
              <dd>{traces.map((trace) => `${trace.traceId}: ${trace.outcome}`).join(" | ") || "No trace linked."}</dd>
            </dl>
            {evidence.rawDomSnapshot && <pre>{evidence.rawDomSnapshot}</pre>}
          </details>
          );
        })}
      </div>
    </section>
  );
}

function Telemetry({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <History size={18} />
        <h2>Raw Signal Telemetry Stream</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Crawler Stability" value={report.systemHealthState?.crawlerStability} />
        <Metric label="Parser Success" value={`${report.systemHealthState?.parserSuccessRate}%`} />
        <Metric label="Render Engine" value={report.systemHealthState?.renderEngineStatus?.replaceAll("_", " ")} />
        <Metric label="Memory" value={`${report.systemHealthState?.memoryUsageMb} MB`} />
        <Metric label="CPU Load" value={`${report.systemHealthState?.cpuLoadPercent ?? 0}%`} />
        <Metric label="Error Rate" value={`${Math.round((report.systemHealthState?.errorRate ?? 0) * 100)}%`} />
        <Metric label="Queue Latency" value={`${report.systemHealthState?.queueLatencyMs} ms`} />
        <Metric label="Reliability" value={report.systemHealthState?.overallReliability} />
      </div>
      <div className="telemetry-list">
        {report.rawSignalTelemetry?.slice(0, 40).map((event) => (
          <div className={`telemetry ${event.level}`} key={event.eventId}>
            <span>{event.stage}</span>
            <strong>{event.message}</strong>
            <small>{event.timestamp}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function VisualFramework({ report }: { report: ReportSnapshot }) {
  return (
    <section className="report-section final-framework">
      <h2>SYSTOLAB Visual Intelligence Framework</h2>
      <div className="framework-grid">
        {[
          ...(report.oss?.visualState ? [report.oss.visualState] : []),
          ...(report.dimensions ?? []).map((dimension) => dimension.visualState)
        ].filter(isVisualState).filter((state, index, array) => array.findIndex((item) => item.key === state.key) === index).map((state) => (
          <div className="framework" key={state.key}>
            <StateDot color={state.color} />
            <strong>{state.label}</strong>
            <span>{state.range[0]}-{state.range[1]}</span>
            <p>{state.businessMeaning}</p>
          </div>
        ))}
      </div>
      <p className="muted">
        Visual Intelligence Colors represent observable website conditions only and must not be interpreted as business performance,
        revenue potential, search ranking position, market value, or future outcomes.
      </p>
      <p className="footer-brand">{report.tenantBranding?.footerLabel}</p>
    </section>
  );
}

function CoveragePanel({ coverage }: { coverage: SpecCoverageItem[] }) {
  const counts = useMemo(() => {
    return coverage.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [coverage]);

  return (
    <section className="panel coverage-panel">
      <div className="section-title">
        <ShieldCheck size={18} />
        <h2>Specification Coverage</h2>
      </div>
      <div className="coverage-counts">
        {Object.entries(counts).map(([status, count]) => (
          <Metric key={status} label={status} value={String(count)} />
        ))}
      </div>
      <div className="coverage-list">
        {coverage.slice(0, 8).map((item) => (
          <div key={item.id}>
            <strong>{item.id}</strong>
            <span>{item.status}</span>
            <p>{item.requirement}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDifference(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function positionLabel(position: "primary_stronger" | "primary_weaker" | "structurally_equivalent") {
  if (position === "primary_stronger") return "Client stronger";
  if (position === "primary_weaker") return "Competitor stronger";
  return "Equivalent";
}

function gtcsMeaning(score: number) {
  if (score >= 85) return "High GTCS: strong deterministic confidence from available HTTP, DOM, parser, or render evidence.";
  if (score >= 70) return "Moderate GTCS: usable confidence with a documented validation limitation.";
  if (score >= 50) return "Limited GTCS: review before major implementation work.";
  return "Low GTCS: retained as a limitation or failure signal.";
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem("systolab.deviceId");
  if (existing) return existing;
  const generated = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem("systolab.deviceId", generated);
  return generated;
}

function readStoredAuth(): { user: AuthUserProfile; tokens: AuthTokenPair; session: AuthSessionSummary } | null {
  try {
    const raw = localStorage.getItem("systolab.auth");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function simpleId(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}

function safeHostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "Competitor";
  }
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDecisionRange(range: AiceDecisionObject["revenue_impact_range"]) {
  if (range.low === 0 && range.high === 0) return range.label;
  const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  return `${range.label}: ${formatter.format(range.low)}-${formatter.format(range.high)} ${range.unit?.replaceAll("_", " ")}`;
}

function getDecisionIntelligenceBrief(report: ReportSnapshot): ReportSnapshot["decisionIntelligenceBrief"] {
  const candidate = (report as Partial<ReportSnapshot>).decisionIntelligenceBrief;
  if (
    candidate?.executiveVerdict &&
    candidate.executiveActionBanner &&
    candidate.executiveDecisionMatrix &&
    Array.isArray(candidate.actionPlan) &&
    candidate.whyThisMatters &&
    candidate.competitivePositionAnalysis &&
    candidate.executiveReliabilityPanel
  ) {
    return candidate;
  }
  return fallbackDecisionIntelligenceBrief(report);
}

function fallbackDecisionIntelligenceBrief(report: ReportSnapshot): ReportSnapshot["decisionIntelligenceBrief"] {
  if (isContentUnavailableReport(report)) return fallbackUnavailableDecisionBrief(report);

  const score = typeof report.oss?.score === "number" ? report.oss.score : null;
  if (score === null) return fallbackUnavailableDecisionBrief(report);

  const dimensions = report.dimensions ?? [];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const strongest = [...dimensions].sort((a, b) => b.score - a.score).slice(0, 3);
  const businessRisk = report.businessRiskStatus ?? fallbackBusinessRisk(report);
  const recommendations = report.recommendationEngine ?? fallbackRecommendationEngine(report);
  const actionPanel = report.actionFirstPanel ?? fallbackActionFirstPanel(report);
  const market = report.marketReadinessPosition ?? fallbackMarketReadiness(report);
  const benchmarkStatus = fallbackBriefBenchmarkStatus(market);
  const competitorStatus = fallbackBriefCompetitorStatus(report);
  const coverage = report.evidenceCoverageSummary as Partial<ReportSnapshot["evidenceCoverageSummary"]> | undefined;
  const sampledPages = coverage?.totalPagesSampled ?? report.scanCoverage?.sampledPages ?? 0;
  const evidenceCount = coverage?.totalEvidenceObjects ?? report.evidenceObjects?.length ?? 0;
  const confidenceScore = report.confidenceEngine?.overallConfidenceScore ?? averageBriefConfidence(report.confidenceLayer ?? []);
  const firstAction = recommendations.recommendations[0]?.action ?? actionPanel.items[0]?.executableFix ?? actionPanel.fallbackAction;
  const impact = fallbackBriefImpact(report, evidenceCount);

  return {
    executiveVerdict: {
      currentSituation: `The website is scored at OSS ${score}/100 with ${businessRisk.level.toLowerCase()}.`,
      seriousness: businessRisk.explanation,
      firstAction,
      urgency: fallbackBriefTimeSensitivity(score),
      likelyBusinessImpact: impact,
      evidenceBasis: `${sampledPages} sampled page${sampledPages === 1 ? "" : "s"} and ${evidenceCount} validated evidence object${evidenceCount === 1 ? "" : "s"} support this brief.`
    },
    executiveActionBanner: {
      classification: fallbackBriefClassification(score),
      message: weakest ? `Primary validated focus: ${weakest.label} at ${weakest.score}/100.` : "No single validated structural constraint was detected.",
      urgency: fallbackBriefTimeSensitivity(score)
    },
    executiveDecisionMatrix: {
      executiveDecisionScore: score,
      riskLevel: fallbackBriefRiskLevel(businessRisk.classification),
      executivePriority: fallbackBriefPriority(score),
      timeSensitivity: fallbackBriefTimeSensitivity(score),
      competitivePosition: benchmarkStatus,
      primaryBusinessConstraint: weakest ? `${weakest.label} is the lowest validated dimension at ${weakest.score}/100.` : businessRisk.primaryRiskDriver,
      potentialBusinessImpact: impact,
      ifNotAddressedOutcome: report.systemVerdict?.businessConsequence ?? businessRisk.primaryRiskDriver,
      recommendedNextAction: firstAction
    },
    actionPlan: fallbackBriefActionPlan(report, weakest, firstAction, confidenceScore),
    whyThisMatters: {
      overallCondition: `The assessment is based on current observable website structure and produced OSS ${score}/100.`,
      strongestValidatedDimensions: strongest.map((dimension) => `${dimension.label} (${dimension.score}/100)`),
      weakestValidatedDimension: weakest ? `${weakest.label} (${weakest.score}/100)` : "No weak dimension was validated.",
      businessSignificance: report.systemVerdict?.businessConsequence ?? businessRisk.primaryRiskDriver
    },
    competitivePositionAnalysis: {
      summary: fallbackBriefCompetitiveSummary(benchmarkStatus, competitorStatus, market),
      benchmarkStatus,
      competitorStatus,
      dimensionPositions: (market.positions ?? []).map((position) => ({
        dimension: position.dimension,
        dimensionLabel: position.dimensionLabel,
        position: position.position,
        confidenceScore: market.comparativeConfidenceScore,
        evidenceIds: position.evidenceIds
      }))
    },
    executiveReliabilityPanel: {
      evidenceCoverage: `${sampledPages} sampled page${sampledPages === 1 ? "" : "s"}, ${evidenceCount} validated evidence object${evidenceCount === 1 ? "" : "s"}.`,
      crawlCoverage: report.scanCoverage?.coverageLabel ?? "Not Available",
      assessmentConfidence: `${confidenceScore}% (${briefConfidenceLevel(confidenceScore)})`,
      benchmarkConfidence: market.comparativeConfidenceScore > 0 ? `${market.comparativeConfidenceScore}% (${market.status.replaceAll("_", " ")})` : "Not available",
      assessmentTrustSignals: fallbackBriefTrustSignals(report),
      overallReportReliability: briefConfidenceLevel(Math.min(confidenceScore, fallbackBriefCoverageReliability(sampledPages, evidenceCount))),
      limitations: fallbackBriefLimitations(report, market)
    }
  };
}

function fallbackUnavailableDecisionBrief(report: ReportSnapshot): ReportSnapshot["decisionIntelligenceBrief"] {
  return {
    executiveVerdict: {
      currentSituation: "Website content could not be collected, so the current situation cannot be scored from validated page evidence.",
      seriousness: "No structural risk level or revenue impact was inferred because evidence coverage is 0%.",
      firstAction: "Review website access, security, and robots settings before re-running the assessment.",
      urgency: "Not Applicable",
      likelyBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      evidenceBasis: "0 sampled pages and 0 validated page evidence objects were available."
    },
    executiveActionBanner: {
      classification: "Unable to Assess",
      message: "Content was unavailable, so SYSTOLAB did not assign OSS, risk, competitor position, or revenue impact.",
      urgency: "Not Applicable"
    },
    executiveDecisionMatrix: {
      executiveDecisionScore: null,
      riskLevel: "Unable to Assess",
      executivePriority: "Not Applicable",
      timeSensitivity: "Not Applicable",
      competitivePosition: "Benchmark Data Unavailable",
      primaryBusinessConstraint: "Website content could not be collected.",
      potentialBusinessImpact: "Unable to calculate from validated current-scan evidence.",
      ifNotAddressedOutcome: "No outcome projection was generated because page evidence was unavailable.",
      recommendedNextAction: "Review access/security/robots settings and re-run scan."
    },
    actionPlan: [
      {
        priority: "Priority 1",
        action: "Review website access and security settings.",
        rationale: "The assessment could not collect page content, so access must be reviewed before conclusions can be generated.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      },
      {
        priority: "Priority 2",
        action: "Allow analysis access to public website content.",
        rationale: "Validated page content is required before OSS, recommendations, and benchmark position can be assessed.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      },
      {
        priority: "Priority 3",
        action: "Re-run the assessment after access is resolved.",
        rationale: "A new assessment is required to create validated evidence and score the website.",
        confidenceScore: 0,
        confidenceLevel: "Limited",
        evidenceIds: []
      }
    ],
    whyThisMatters: {
      overallCondition: "The report is limited to an access outcome, not a structural diagnosis.",
      strongestValidatedDimensions: [],
      weakestValidatedDimension: "Not assessed because website content was unavailable.",
      businessSignificance: "Business impact was not inferred because no current-scan page evidence was available."
    },
    competitivePositionAnalysis: {
      summary: "Benchmark and competitor position were not assessed because website content could not be collected.",
      benchmarkStatus: "Benchmark Data Unavailable",
      competitorStatus: "Competitor Data Unavailable",
      dimensionPositions: []
    },
    executiveReliabilityPanel: {
      evidenceCoverage: "0 sampled pages, 0 validated page evidence objects.",
      crawlCoverage: report.scanCoverage?.coverageLabel ?? "0% evidence coverage - content unavailable",
      assessmentConfidence: "0% (Limited)",
      benchmarkConfidence: "Not available",
      assessmentTrustSignals: "Not assessed because website content could not be collected.",
      overallReportReliability: "Limited",
      limitations: [
        "Website content could not be collected.",
        "OSS, business risk, revenue impact, and competitor position were not scored.",
        "Re-run the assessment after access is resolved."
      ]
    }
  };
}

function fallbackBriefClassification(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveActionBanner"]["classification"] {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Healthy but Optimize";
  if (score >= 50) return "Action Recommended";
  if (score >= 25) return "High Risk";
  return "Critical Attention Required";
}

function fallbackBriefPriority(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["executivePriority"] {
  if (score >= 90) return "Monitor";
  if (score >= 75) return "Optimize";
  if (score >= 50) return "Improve";
  if (score >= 25) return "Act";
  return "Escalate";
}

function fallbackBriefTimeSensitivity(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["timeSensitivity"] {
  if (score >= 90) return "Monitor (Ongoing)";
  if (score >= 75) return "Short-Term (1-4 weeks)";
  if (score >= 50) return "This Month (7-30 days)";
  return "Immediate (0-7 days)";
}

function fallbackBriefRiskLevel(classification: ReportSnapshot["businessRiskStatus"]["classification"]): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["riskLevel"] {
  if (classification === "LOW") return "Low Risk";
  if (classification === "MEDIUM") return "Medium Risk";
  if (classification === "HIGH") return "High Risk";
  if (classification === "CRITICAL") return "Critical Risk";
  return "Unable to Assess";
}

function fallbackBriefBenchmarkStatus(market: ReportSnapshot["marketReadinessPosition"]): ReportSnapshot["decisionIntelligenceBrief"]["executiveDecisionMatrix"]["competitivePosition"] {
  if (market.status !== "available" || market.comparativeConfidenceScore <= 0) return "Benchmark Data Unavailable";
  const assessed = market.positions.filter((position) => position.position !== "Not Assessed");
  if (assessed.length === 0) return "Benchmark Data Unavailable";
  const above = assessed.filter((position) => position.position === "Above Benchmark").length;
  const below = assessed.filter((position) => position.position === "Below Benchmark").length;
  if (above > below) return "Above Benchmark";
  if (below > above) return "Below Benchmark";
  return "At Benchmark";
}

function fallbackBriefCompetitorStatus(report: ReportSnapshot): ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["competitorStatus"] {
  const assessed = (report.competitorComparison ?? []).filter((comparison) => comparison.status === "assessed" && typeof comparison.competitorOss === "number");
  if (assessed.length === 0) return "Competitor Data Unavailable";
  const ahead = assessed.filter((comparison) => comparison.primaryOss >= (comparison.competitorOss ?? 0) + 3).length;
  const behind = assessed.filter((comparison) => (comparison.competitorOss ?? 0) >= comparison.primaryOss + 3).length;
  if (ahead > 0 && behind === 0) return "Ahead of Compared Competitors";
  if (behind > 0 && ahead === 0) return "Behind Compared Competitors";
  return "Mixed Position";
}

function fallbackBriefImpact(report: ReportSnapshot, evidenceCount: number): string {
  const revenue = normalizeRevenueIntelligence(report);
  if (evidenceCount <= 0 || revenue.status !== "estimated") return "Unable to calculate from validated current-scan evidence.";
  const range = revenue.revenueOpportunityRange;
  const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  return `${range.label}: ${formatter.format(range.low)}-${formatter.format(range.high)} ${range.unit.replaceAll("_", " ")}. This is a structural opportunity estimate, not actual revenue.`;
}

function fallbackBriefActionPlan(
  report: ReportSnapshot,
  weakest: ReportSnapshot["dimensions"][number] | undefined,
  firstAction: string,
  confidenceScore: number
): ReportSnapshot["decisionIntelligenceBrief"]["actionPlan"] {
  const plan: ReportSnapshot["decisionIntelligenceBrief"]["actionPlan"] = [];
  const seen = new Set<string>();
  const recommendations = report.recommendationEngine ?? fallbackRecommendationEngine(report);
  const actionPanel = report.actionFirstPanel ?? fallbackActionFirstPanel(report);

  const push = (action: string, rationale: string, score: number, evidenceIds: string[]) => {
    const clean = action.trim();
    if (!clean || seen.has(clean.toLowerCase()) || plan.length >= 3) return;
    seen.add(clean.toLowerCase());
    plan.push({
      priority: `Priority ${plan.length + 1}` as "Priority 1" | "Priority 2" | "Priority 3",
      action: clean,
      rationale,
      confidenceScore: Math.max(0, Math.min(100, Math.round(score))),
      confidenceLevel: briefConfidenceLevel(score),
      evidenceIds
    });
  };

  for (const recommendation of recommendations.recommendations) {
    push(recommendation.action, `${recommendation.issue}. ${recommendation.revenueIntelligenceMapping}`, recommendation.confidenceScore, recommendation.evidenceIds);
  }
  for (const item of actionPanel.items) {
    push(item.executableFix, item.businessReason, weakest?.confidenceScore ?? confidenceScore, item.evidenceIds);
  }
  if (weakest) {
    push(`Resolve the weakest validated dimension: ${weakest.label}.`, `${weakest.label} is currently the lowest validated dimension at ${weakest.score}/100.`, weakest.confidenceScore, weakest.evidenceIds);
  }
  push(firstAction, "This is the highest-priority action available from the report evidence.", confidenceScore, []);
  push("Re-run the assessment after priority fixes are implemented.", "A follow-up scan is required to validate whether observable structure improved.", Math.min(confidenceScore, 80), []);
  push("Review only validated report findings before selecting additional work.", "This keeps execution bounded to evidence collected during the current assessment.", confidenceScore, []);
  push("Prioritize fixes with explicit evidence support.", "Evidence-supported changes are required before SYSTOLAB can validate improvement in a later assessment.", confidenceScore, []);

  return plan;
}

function fallbackBriefCompetitiveSummary(
  benchmarkStatus: ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["benchmarkStatus"],
  competitorStatus: ReportSnapshot["decisionIntelligenceBrief"]["competitivePositionAnalysis"]["competitorStatus"],
  market: ReportSnapshot["marketReadinessPosition"]
): string {
  const dimensionCount = market.positions.filter((position) => position.position !== "Not Assessed").length;
  const benchmarkText =
    benchmarkStatus === "Benchmark Data Unavailable"
      ? "Benchmark comparison is unavailable from the current evidence."
      : `The site is ${benchmarkStatus.toLowerCase()} based on available benchmark dimensions.`;
  const competitorText =
    competitorStatus === "Competitor Data Unavailable"
      ? "No competitor conclusion was generated because competitor evidence was unavailable or not assessed."
      : `Compared competitor status: ${competitorStatus.toLowerCase()}.`;
  return `${benchmarkText} ${competitorText} ${dimensionCount} benchmark dimension${dimensionCount === 1 ? "" : "s"} had comparable evidence.`;
}

function fallbackBriefTrustSignals(report: ReportSnapshot): string {
  const trustEvidence = (report.evidenceObjects ?? []).filter((evidence) => evidence.dimensionRefs?.includes("trust"));
  if (trustEvidence.length === 0) return "No trust evidence objects were validated in this scan.";
  return `${trustEvidence.length} trust evidence object${trustEvidence.length === 1 ? "" : "s"} validated.`;
}

function fallbackBriefLimitations(report: ReportSnapshot, market: ReportSnapshot["marketReadinessPosition"]): string[] {
  const limitations: string[] = [];
  if (market.status !== "available") limitations.push("Benchmark confidence is limited by available comparison coverage.");
  if ((report.competitorComparison ?? []).filter((comparison) => comparison.status === "assessed").length === 0) {
    limitations.push("Competitor position is unavailable because no competitor comparison completed with validated evidence.");
  }
  if (normalizeRevenueIntelligence(report).status !== "estimated") limitations.push("Revenue impact is not calculated when current evidence is input-limited.");
  if ((report.evidenceCoverageSummary?.totalPagesSampled ?? report.scanCoverage?.sampledPages ?? 0) < 2) limitations.push("Coverage is based on a small page sample.");
  return limitations.length > 0 ? limitations : ["No additional reliability limitation was detected beyond standard evidence-bound interpretation."];
}

function averageBriefConfidence(confidenceLayer: ReportSnapshot["confidenceLayer"]): number {
  if (confidenceLayer.length === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(confidenceLayer.reduce((sum, item) => sum + item.confidenceScore, 0) / confidenceLayer.length)));
}

function fallbackBriefCoverageReliability(sampledPages: number, evidenceCount: number): number {
  if (sampledPages <= 0 || evidenceCount <= 0) return 0;
  if (sampledPages >= 3 && evidenceCount >= 20) return 90;
  if (sampledPages >= 2 && evidenceCount >= 10) return 80;
  if (sampledPages >= 1 && evidenceCount >= 5) return 70;
  return 55;
}

function briefConfidenceLevel(score: number): ReportSnapshot["decisionIntelligenceBrief"]["executiveReliabilityPanel"]["overallReportReliability"] {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  if (safeScore >= 90) return "Very High";
  if (safeScore >= 80) return "High";
  if (safeScore >= 70) return "Moderate";
  return "Limited";
}

function isContentUnavailableReport(report: ReportSnapshot): boolean {
  return !report.oss || report.status === "content_unavailable" || report.oss.scoringStatus === "not_scored" || report.oss.score === null;
}

function formatOssScore(value: number | null | undefined, withDenominator = true): string {
  if (typeof value !== "number") return "Not Scored";
  return withDenominator ? `${value}/100` : String(value);
}

function isVisualState(state: ReportSnapshot["oss"]["visualState"] | null | undefined): state is ReportSnapshot["oss"]["visualState"] {
  return Boolean(state?.key && state.label && state.range && state.color);
}

function isRateLimitError(error: unknown): error is Error & { status: 429; retryAfterMs?: number } {
  return error instanceof Error && (error as { status?: number }).status === 429;
}

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  const displayValue = value === null || value === undefined || value === "" ? "Not Available" : String(value);
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}

function StateDot({ color }: { color: string }) {
  return <span className="state-dot" style={{ background: color }} />;
}
