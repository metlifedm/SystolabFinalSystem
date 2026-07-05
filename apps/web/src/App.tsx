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
  DecisionTimelineOutput,
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
  ListChecks,
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
  downloadReportPdf,
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
import { UniversalPortal, isPortalRoute } from "./UniversalPortal.js";
import { firebaseAuth, googleProvider, isFirebaseConfigured } from "./firebase.js";

export function App() {
  if (window.location.pathname.startsWith("/internal/reports/")) return <InternalReportPage />;
  if (window.location.pathname.startsWith("/admin")) return <AdminDashboard />;
  if (isPortalRoute(window.location.pathname)) return <UniversalPortal />;

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
          <img src="/systolab-icon.png" alt="SYSTOLAB" />
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
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  async function downloadPdf() {
    if (!report) return;
    setPdfError("");
    setPdfDownloading(true);
    try {
      const blob = await downloadReportPdf(report.snapshotId);
      saveBlob(blob, `${report.snapshotId}.pdf`);
      await sendEditEvent("report_downloaded", report);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "PDF download failed.");
    } finally {
      setPdfDownloading(false);
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/systolab-icon.png" alt="SYSTOLAB" />
        <div>
          <strong>{title}</strong>
          <span>{report?.tenantBranding?.poweredByLabel ?? "Powered by SYSTOLAB Revenue Intelligence Engine"}</span>
        </div>
      </div>
      {report && (
        <div className="header-actions">
          {pdfError && <span className="status-line error compact">{pdfError}</span>}
          <button className="icon-button text-button" type="button" disabled={pdfDownloading} onClick={() => void downloadPdf()}>
            <Download size={18} />
            {pdfDownloading ? "Preparing PDF" : "Full PDF"}
          </button>
        </div>
      )}
    </header>
  );
}
function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
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
            <span className="auth-profile-sub">{user.email ?? user.phone} Ã‚Â· {user.providers.join(", ")}</span>
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
          <img src="/systolab-icon.png" alt="SYSTOLAB" className="auth-logo-img" />
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
            <button className="auth-back-link" onClick={goBack}>Back to sign-in options</button>
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
            <button className="auth-back-link" onClick={goBack}>Back</button>
          </div>
        )}

        {authStep === "otp-verify" && (
          <div className="auth-expandable-form">
            <p className="auth-otp-hint">
              Code sent to <strong>{otpChallenge?.maskedDestination}</strong>
              {otpChallenge?.simulatedDelivery.code && <span className="auth-dev-code"> Ã‚Â· dev: {otpChallenge.simulatedDelivery.code}</span>}
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
            <button className="auth-back-link" onClick={() => { setAuthStep("email-otp"); setOtpChallenge(null); }}>Back</button>
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
                placeholder="********"
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
            <button className="auth-back-link" onClick={() => setAuthStep("email-otp")}>Back to OTP login</button>
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
            <button className="auth-back-link" onClick={() => setAuthStep("password")}>Back</button>
          </div>
        )}

        {authStep === "reset-verify" && (
          <div className="auth-expandable-form">
            <p className="auth-otp-hint">
              Reset link sent to <strong>{resetChallenge?.maskedDestination}</strong>
              {resetChallenge?.simulatedDelivery.token && <span className="auth-dev-code"> Ã‚Â· dev: {resetChallenge.simulatedDelivery.token}</span>}
            </p>
            <label className="auth-form-field">
              <span className="auth-field-label">Reset Token</span>
              <input className="auth-form-input" value={resetToken} onChange={(e) => setResetToken(e.target.value)} autoFocus />
            </label>
            <label className="auth-form-field">
              <span className="auth-field-label">New Password</span>
              <input className="auth-form-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="********" />
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
            <button className="auth-back-link" onClick={() => setAuthStep("reset")}>Back</button>
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

      // Scan is async - backend returns 202 with a jobId, not an immediate report
      const job = await createScan(request);
      setScanProgress("Scan queued - analysing website...");

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
      {/* <div className="scan-grid">
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
      {error && <div className="error-line">{error}</div>} */}
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

function ContentUnavailableReportView({ report, style }: { report: ReportSnapshot; style: CSSProperties }) {
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
        <p className="decision-summary">{customerAssessment?.recommendedAction ?? "Review access/security settings and re-run scan."}</p>
      </section>

    </article>
  );
}

interface CustomerBusinessReport {
  businessReadinessScore: number | null;
  scoreLabel: string;
  businessType: string;
  isEcommerce: boolean;
  verdict: string;
  verdictExplanation: string;
  executiveNarrative: string;
  businessDecisionSnapshot: Array<{ area: string; status: string; meaning: string }>;
  businessHealthSnapshot: Array<{ area: string; status: string; meaning: string }>;
  hesitationAreas: Array<{ area: string; whatIsHappening: string; whyItMatters: string; action: string; confidence: string }>;
  competitorNarrative: {
    title: string;
    summary: string;
    momentum: string;
    costOfDelay: string;
    limitations: string[];
  };
  topPriority: {
    recommendedPriority: string;
    whyItMatters: string;
    expectedBusinessBenefit: string;
    confidence: string;
    effort: string;
    firstAction: string;
  };
  expectedBusinessOutcomes: Array<{ improvement: string; expectedOutcome: string; confidence: string }>;
  businessInitiatives: Array<{ title: string; outcome: string; actions: string[]; confidence: string }>;
  seoBusinessQuestions: Array<{ question: string; answer: string; businessMeaning: string; action: string; confidence: string }>;
  highestRoiAction: {
    action: string;
    whyItMatters: string;
    confidence: string;
    window: string;
  };
  decisionTimeline: DecisionTimelineOutput | null;
  businessDecisionSummary: {
    confidenceScore: string;
    evidenceStrength: string;
    decisions: Array<{ title: string; meaning: string; priority: string }>;
    businessDrivers: Array<{ title: string; driver: string; meaning: string }>;
    revenueImpactAreas: Array<{ area: string; businessImpact: string; confidence: string }>;
    priorityActions: Array<{ title: string; action: string; priority: string }>;
    limitations: string[];
  };
  revenueLeaks: Array<{
    title: string;
    issue: string;
    customerImpact: string;
    action: string;
    confidence: string;
  }>;
  businessRisks: Array<{
    title: string;
    risk: string;
    customerImpact: string;
    action: string;
    confidence: string;
  }>;
  intelligenceSummaries: Array<{
    section: "search" | "questions" | "confidence" | "trustProof" | "journey";
    title: string;
    status: string;
    meaning: string;
    action: string;
    confidence: string;
  }>;
  localVisibility: {
    status: string;
    gbpScore: string;
    localVisibilityScore: string;
    businessProfileCompleteness: string;
    identityConsistency: string;
    reviewAnalysis: { status: string; finding: string; gap: string; action: string };
    serviceAreaClarity: { status: string; evidence: string; action: string };
    citationCoverage: { status: string; score: string; action: string };
    localCompetitorComparison: Array<{ competitor: string; position: string; reason: string }>;
    localVisibilityOpportunities: Array<{ area: string; status: string; action: string; confidence: string }>;
    limitations: string[];
  };
  competitorContentComparison: {
    status: string;
    summary: string;
    comparedCompetitors: string[];
    contentGaps: Array<{ competitor: string; area: string; clientEvidence: string; competitorEvidence: string; scoreComparison?: string; implication?: string; decisionImpact: string; action: string }>;
    missingContentTypes: Array<{ contentType: string; status: string; action: string }>;
    limitations: string[];
  };
  questionCoverage: {
    status: string;
    coverageScore: string;
    questionsCustomersAsk: string[];
    questionsAnsweredOnWebsite: string[];
    questionsMissingFromWebsite: string[];
    questionsCompetitorsAnswer: string[];
    action: string;
    confidence: string;
  };
  competitorWinReasons: {
    status: string;
    summary: string;
    reasons: Array<{ competitor: string; reason: string; proof: string; decisionImpact: string; action: string }>;
  };
  revenueLeakage: {
    status: string;
    valueContext: string;
    leakageAreas: Array<{ area: string; score: string; status: string; businessArea: string; customerImpact: string; action: string; confidence: string }>;
    limitation: string;
  };
  outcomeAttribution: {
    status: string;
    summary: string;
    outcomeLinks: Array<{ issue: string; businessAreas: string; strength: string; influence: string; explanation: string; confidence: string }>;
    boundary: string;
  };
  dependencySummary: {
    status: string;
    summary: string;
    businessConnections: Array<{ issue: string; role: string; rationale: string }>;
    fixOrderWarnings: string[];
  };
  recommendationRoadmap: {
    status: string;
    summary: string;
    phases: Array<{ phase: string; focus: string; timeframe: string; actions: Array<{ action: string; rationale: string; confidence: string; lifecycleState: string }> }>;
  };
  psychology: Array<{
    label: string;
    reading: string;
    businessMeaning: string;
  }>;
  impactSummary: string[];
  recommendedActions: Array<{
    title: string;
    action: string;
    reason: string;
    businessExplanation: string;
    technicalTasks: string[];
    confidence: string;
  }>;
  competitorGaps: Array<{
    competitor: string;
    area: string;
    position: string;
    decisionImpact: string;
  }>;
  commerceSignals: Array<{
    label: string;
    status: string;
    action: string;
  }>;
  visualSummary: {
    status: string;
    detail: string;
    confidence: string;
  };
  visualMarkers: Array<{
    label: string;
    status: string;
    decisionImpact: string;
    action: string;
    confidence: string;
  }>;
  evidenceItems: Array<{
    id: string;
    title: string;
    confidence: string;
    meaning: string;
  }>;
}

function CustomerBusinessReportView({ report, style }: { report: ReportSnapshot; style: CSSProperties }) {
  const customer = buildCustomerBusinessReport(report);
  const scoreColor = customer.businessReadinessScore === null ? "#64748b" : visualStateForScore(customer.businessReadinessScore).color;

  return (
    <article className="report customer-business-report" style={style}>
      <section className="customer-hero">
        <div>
          <span className="panel-kicker">Business Decision Intelligence</span>
          <h1>{customer.verdict}</h1>
          <p>{customer.verdictExplanation}</p>
          <div className="customer-tags">
            <span>{customer.businessType}</span>
            {customer.isEcommerce && <span>E-commerce Intelligence Active</span>}
            <span>{report.scanCoverage?.coverageLabel ?? "Assessment breadth unavailable"}</span>
          </div>
        </div>
        <div className="business-score" style={{ borderColor: scoreColor }}>
          <strong style={{ color: scoreColor }}>{customer.businessReadinessScore === null ? "Not Scored" : `${customer.businessReadinessScore}/100`}</strong>
          <span>Business Readiness Score</span>
          <em>{customer.scoreLabel}</em>
        </div>
      </section>

      <CustomerExecutiveNarrativeSection narrative={customer.executiveNarrative} />
      <CustomerBusinessDecisionSnapshotSection snapshot={customer.businessDecisionSnapshot} />
      <CustomerHesitationAreasSection areas={customer.hesitationAreas} />
      <CustomerCompetitorNarrativeSection narrative={customer.competitorNarrative} />
      <CustomerRevenueLeakageSection leakage={customer.revenueLeakage} />
      <CustomerTopPrioritySection priority={customer.topPriority} />
      <CustomerExpectedBusinessOutcomesSection outcomes={customer.expectedBusinessOutcomes} />
      <CustomerBusinessInitiativesSection initiatives={customer.businessInitiatives} />

      <CustomerBusinessDecisionSummary summary={customer.businessDecisionSummary} />
      <CustomerDecisionTimelineSection timeline={customer.decisionTimeline} />

      <CustomerCategoryHeader
        title="Website Intelligence"
        description="Customer trust, conversion readiness, decision confidence, usability, and revenue-impacting website factors."
      />

      <section className="report-section">
        <div className="section-title">
          <DollarSign size={18} />
          <h2>Top Three Revenue Leaks</h2>
        </div>
        <div className="revenue-leak-grid">
          {customer.revenueLeaks.map((leak, index) => (
            <div className="revenue-leak-card" key={leak.title}>
              <span>Leak {index + 1}</span>
              <h3>{leak.title}</h3>
              <p>{leak.issue}</p>
              <small>{leak.customerImpact}</small>
              <strong>{leak.action}</strong>
              <em>{leak.confidence}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <AlertTriangle size={18} />
          <h2>Top Three Business Risks</h2>
        </div>
        <div className="revenue-leak-grid">
          {customer.businessRisks.map((risk, index) => (
            <div className="revenue-leak-card" key={risk.title}>
              <span>Risk {index + 1}</span>
              <h3>{risk.title}</h3>
              <p>{risk.risk}</p>
              <small>{risk.customerImpact}</small>
              <strong>{risk.action}</strong>
              <em>{risk.confidence}</em>
            </div>
          ))}
        </div>
      </section>

      <CustomerIntelligenceSummary
        title="Decision Confidence Summary"
        icon={<ShieldCheck size={18} />}
        items={customer.intelligenceSummaries.filter((item) => item.section === "confidence")}
      />
      <CustomerIntelligenceSummary
        title="Trust Proof Coverage Summary"
        icon={<CheckCircle2 size={18} />}
        items={customer.intelligenceSummaries.filter((item) => item.section === "trustProof")}
      />
      <CustomerIntelligenceSummary
        title="Customer Journey Breakpoint Summary"
        icon={<MapPinned size={18} />}
        items={customer.intelligenceSummaries.filter((item) => item.section === "journey")}
      />

      <CustomerCategoryHeader
        title="Visibility Intelligence"
        description="Search visibility readiness, topical coverage, discoverability, local presence, freshness, and organic growth opportunities."
      />

      <CustomerSeoBusinessQuestionsSection questions={customer.seoBusinessQuestions} />
      <CustomerIntelligenceSummary
        title="Visibility Opportunity Summary"
        icon={<Search size={18} />}
        items={customer.intelligenceSummaries.filter((item) => item.section === "search")}
      />
      <CustomerLocalVisibilitySection localVisibility={customer.localVisibility} />
      <CustomerQuestionCoverageSection coverage={customer.questionCoverage} />

      <section className="report-section">
        <div className="section-title">
          <Activity size={18} />
          <h2>Customer Psychology Analysis</h2>
        </div>
        <div className="psychology-grid">
          {customer.psychology.map((item) => (
            <div className="psychology-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.reading}</strong>
              <p>{item.businessMeaning}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <MapPinned size={18} />
          <h2>Visual Intelligence</h2>
        </div>
        <div className="visual-intelligence-grid">
          <div className="visual-summary-card">
            <span>{customer.visualSummary.status}</span>
            <strong>{customer.visualSummary.confidence}</strong>
            <p>{customer.visualSummary.detail}</p>
          </div>
          {customer.visualMarkers.map((marker) => (
            <div className="visual-marker-card" key={`${marker.label}-${marker.status}`}>
              <span>{marker.label}</span>
              <strong>{marker.status}</strong>
              <p>{marker.decisionImpact}</p>
              <small>{marker.action}</small>
              <em>{marker.confidence}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <BarChart3 size={18} />
          <h2>Business Impact Summary</h2>
        </div>
        <div className="business-impact-list">
          {customer.impactSummary.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </section>

      <CustomerOutcomeAttributionSection attribution={customer.outcomeAttribution} />
      <CustomerDependencySummarySection dependency={customer.dependencySummary} />
      <CustomerRecommendationRoadmapSection roadmap={customer.recommendationRoadmap} />

      {customer.isEcommerce && (
        <section className="report-section">
          <div className="section-title">
            <Gauge size={18} />
            <h2>E-commerce Intelligence</h2>
          </div>
          <div className="data-table compact">
            {customer.commerceSignals.map((signal) => (
              <div className="table-row" key={signal.label}>
                <span>{signal.label}</span>
                <strong>{signal.status}</strong>
                <small>{signal.action}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="report-section">
        <div className="section-title">
          <CheckCircle2 size={18} />
          <h2>Supporting Recommendation Detail</h2>
        </div>
        <div className="data-table compact customer-actions-table">
          {customer.recommendedActions.map((action) => (
            <div className="table-row action-with-details" key={action.title}>
              <span>{action.title}</span>
              <strong>{action.businessExplanation}</strong>
              <small>Evidence basis: {customerRecommendationEvidenceNote(action.reason)} Confidence: {action.confidence}.</small>
              <details className="evidence-implementation-panel">
                <summary>Evidence & Implementation</summary>
                <p>{action.action}</p>
                <ul className="implementation-task-list">
                  {action.technicalTasks.map((task) => <li key={task}>{task}</li>)}
                </ul>
              </details>
            </div>
          ))}
        </div>
      </section>

      <section className="report-section">
        <div className="section-title">
          <ShieldCheck size={18} />
          <h2>Competitor Gap Analysis</h2>
        </div>
        {customer.competitorGaps.length > 0 ? (
          <div className="data-table compact">
            {customer.competitorGaps.map((gap) => (
              <div className="table-row" key={`${gap.competitor}-${gap.area}`}>
                <span>{gap.area}</span>
                <strong>{gap.position}</strong>
                <small>{gap.competitor}: {gap.decisionImpact}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No validated competitor gap was available in this scan. Add competitor URLs to compare trust, clarity, confidence, conversion readiness, and mobile experience.</p>
        )}
      </section>

      <CustomerCompetitorContentComparisonSection comparison={customer.competitorContentComparison} />
      <CustomerCompetitorWinReasonsSection winReasons={customer.competitorWinReasons} />

      <details className="report-section customer-evidence-details">
        <summary>
          <span>Supporting Evidence (Optional)</span>
          <strong>{customer.evidenceItems.length} supporting finding{customer.evidenceItems.length === 1 ? "" : "s"}</strong>
        </summary>
        <p className="muted">Explore the observations that support each business conclusion. This section is intended for technical teams and implementation partners who want additional context behind the recommendations.</p>
        <div className="data-table compact">
          {customer.evidenceItems.map((item, index) => (
            <div className="table-row" key={item.id}>
              <span>Finding {index + 1}</span>
              <strong>{item.title}</strong>
              <small>{item.meaning} Confidence: {item.confidence}.</small>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function CustomerExecutiveNarrativeSection({ narrative }: { narrative: string }) {
  if (!narrative.trim()) return null;
  return (
    <section className="report-section executive-narrative-card">
      <div className="section-title">
        <FileText size={18} />
        <h2>Executive Summary</h2>
      </div>
      <p className="decision-summary">{narrative}</p>
    </section>
  );
}

function CustomerBusinessDecisionSnapshotSection({ snapshot }: { snapshot: CustomerBusinessReport["businessDecisionSnapshot"] }) {
  if (!snapshot.length) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <Gauge size={18} />
        <h2>Business Decision Snapshot</h2>
      </div>
      <div className="customer-intelligence-grid business-health-grid">
        {snapshot.map((item) => (
          <div className="customer-intelligence-card business-health-card" key={item.area}>
            <span>{item.area}</span>
            <strong>{item.status}</strong>
            <p>{item.meaning}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerHesitationAreasSection({ areas }: { areas: CustomerBusinessReport["hesitationAreas"] }) {
  if (!areas.length) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <AlertTriangle size={18} />
        <h2>Where Customers Hesitate</h2>
      </div>
      <div className="customer-intelligence-grid">
        {areas.map((item) => (
          <div className="customer-intelligence-card" key={`${item.area}-${item.whatIsHappening}`}>
            <span>{item.area}</span>
            <strong>{item.whatIsHappening}</strong>
            <p>{item.whyItMatters}</p>
            <small>{item.action}</small>
            <em>{item.confidence}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerCompetitorNarrativeSection({ narrative }: { narrative: CustomerBusinessReport["competitorNarrative"] }) {
  if (!narrative.summary.trim()) return null;
  return (
    <section className="report-section competitor-narrative-card">
      <div className="section-title">
        <ShieldCheck size={18} />
        <h2>{narrative.title || "Why Customers May Choose Competitors"}</h2>
      </div>
      <p className="decision-summary">{narrative.summary}</p>
      <div className="meta-strip">
        <Metric label="Competitive Momentum" value={narrative.momentum} />
        <Metric label="Cost Of Delay" value={narrative.costOfDelay} />
      </div>
      {narrative.limitations.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}

function CustomerTopPrioritySection({ priority }: { priority: CustomerBusinessReport["topPriority"] }) {
  return (
    <section className="report-section highest-roi-card">
      <div className="section-title">
        <TrendingUp size={18} />
        <h2>Business Priority This Week</h2>
      </div>
      <div className="roi-action-grid">
        <div>
          <span className="panel-kicker">What To Fix First</span>
          <h3>{priority.recommendedPriority}</h3>
          <p>{priority.firstAction}</p>
          <h4>Why This Is Your Top Priority</h4>
          <p>{priority.whyItMatters}</p>
          <strong>{priority.expectedBusinessBenefit}</strong>
        </div>
        <div className="roi-action-meta">
          <Metric label="Confidence" value={priority.confidence} />
          <Metric label="Effort" value={priority.effort} />
        </div>
      </div>
    </section>
  );
}

function CustomerExpectedBusinessOutcomesSection({ outcomes }: { outcomes: CustomerBusinessReport["expectedBusinessOutcomes"] }) {
  if (!outcomes.length) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>Expected Business Outcomes</h2>
      </div>
      <div className="data-table compact customer-actions-table">
        {outcomes.map((item) => (
          <div className="table-row" key={item.improvement}>
            <span>{item.improvement}</span>
            <strong>{item.expectedOutcome}</strong>
            <small>{item.confidence}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerBusinessInitiativesSection({ initiatives }: { initiatives: CustomerBusinessReport["businessInitiatives"] }) {
  if (!initiatives.length) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <ListChecks size={18} />
        <h2>Business Initiatives</h2>
      </div>
      <div className="customer-intelligence-grid business-initiative-grid">
        {initiatives.map((initiative) => (
          <div className="customer-intelligence-card" key={initiative.title}>
            <span>{initiative.title}</span>
            <strong>{initiative.outcome}</strong>
            <ul className="initiative-action-list">
              {initiative.actions.map((action) => <li key={action}>{action}</li>)}
            </ul>
            <em>{initiative.confidence}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerSeoBusinessQuestionsSection({ questions }: { questions: CustomerBusinessReport["seoBusinessQuestions"] }) {
  if (!questions.length) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <Search size={18} />
        <h2>SEO Business Questions</h2>
      </div>
      <div className="customer-intelligence-grid seo-question-grid">
        {questions.map((item) => (
          <div className="customer-intelligence-card" key={item.question}>
            <span>{item.question}</span>
            <strong>{item.answer}</strong>
            <p>{item.businessMeaning}</p>
            <small>{item.action}</small>
            <em>{item.confidence}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerDecisionTimelineSection({ timeline }: { timeline: DecisionTimelineOutput | null }) {
  if (!timeline) return null;
  return (
    <section className="report-section">
      <div className="section-title">
        <History size={18} />
        <h2>Decision Timeline</h2>
      </div>
      <p className="decision-summary">{timeline.summary}</p>
      <div className="meta-strip four-up">
        <Metric label="Lifecycle" value={timeline.currentLifecycle.replaceAll("_", " ")} />
        <Metric label="Status" value={timeline.status.replaceAll("_", " ")} />
        <Metric label="Snapshots" value={String(timeline.points.length)} />
        <Metric label="Engine" value={timeline.versionLedger.engineVersion} />
      </div>
      <div className="customer-intelligence-grid">
        {timeline.points.slice(-4).map((point) => (
          <div className="customer-intelligence-card" key={point.snapshotId}>
            <span>{formatDate(point.capturedAt)}</span>
            <strong>{point.oss === null ? "Not Scored" : "Business Readiness " + point.oss + "/100"}</strong>
            <p>{point.topDecision}</p>
            <small>{point.topRecommendedAction}</small>
            <em>Confidence {point.confidenceScore}% - Evidence coverage {point.evidenceCoveragePercent}%</em>
          </div>
        ))}
      </div>
      {timeline.events.length > 0 && (
        <div className="data-table compact customer-actions-table">
          {timeline.events.slice(-8).map((event) => (
            <div className="table-row" key={event.eventId}>
              <span>{formatDate(event.capturedAt)}</span>
              <strong>{event.title}</strong>
              <small>{event.summary} {event.businessMeaning} Confidence: {event.confidenceScore}%.</small>
            </div>
          ))}
        </div>
      )}
      <div className="meta-strip">
        <Metric label="Decision Framework" value={timeline.versionLedger.decisionFrameworkVersion} />
        <Metric label="Report Template" value={timeline.versionLedger.reportTemplateVersion} />
        <Metric label="Source Of Truth" value={timeline.platformGovernance.sourceOfTruth} />
      </div>
      {timeline.limitations.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}

function CustomerBusinessDecisionSummary({ summary }: { summary: CustomerBusinessReport["businessDecisionSummary"] }) {
  const hasRows = summary.decisions.length > 0 || summary.priorityActions.length > 0 || summary.revenueImpactAreas.length > 0;
  if (!hasRows) return null;

  return (
    <section className="report-section">
      <div className="section-title">
        <ListChecks size={18} />
        <h2>Business Decision Summary</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Decision Confidence" value={summary.confidenceScore} />
        <Metric label="Evidence Strength" value={summary.evidenceStrength} />
        <Metric label="Business Decisions" value={String(summary.decisions.length)} />
        <Metric label="Priority Actions" value={String(summary.priorityActions.length)} />
      </div>
      {summary.decisions.length > 0 && (
        <div className="data-table compact">
          {summary.decisions.slice(0, 5).map((item, index) => (
            <div className="table-row" key={`${item.title}-${index}`}>
              <span>{item.title}</span>
              <strong>{item.priority}</strong>
              <small>{item.meaning}</small>
            </div>
          ))}
        </div>
      )}
      {summary.priorityActions.length > 0 && (
        <div className="data-table compact customer-actions-table">
          {summary.priorityActions.slice(0, 5).map((item, index) => (
            <div className="table-row" key={`${item.title}-${index}`}>
              <span>{item.title}</span>
              <strong>{item.action}</strong>
              <small>{item.priority}</small>
            </div>
          ))}
        </div>
      )}
      {summary.limitations.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}
function CustomerCategoryHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="customer-category-header">
      <span>{title}</span>
      <p>{description}</p>
    </div>
  );
}

function CustomerIntelligenceSummary({
  title,
  icon,
  items
}: {
  title: string;
  icon: JSX.Element;
  items: CustomerBusinessReport["intelligenceSummaries"];
}) {
  return (
    <section className="report-section">
      <div className="section-title">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="customer-intelligence-grid">
        {items.length > 0 ? items.map((item) => (
          <div className="customer-intelligence-card" key={`${title}-${item.title}`}>
            <span>{item.title}</span>
            <strong>{item.status}</strong>
            <p>{item.meaning}</p>
            <small>{item.action}</small>
            <em>{item.confidence}</em>
          </div>
        )) : (
          <div className="customer-intelligence-card">
            <span>{title}</span>
            <strong>Not enough evidence</strong>
            <p>This scan did not collect enough validated evidence for a separate summary in this area.</p>
            <small>Run a fuller scan or add more relevant website content before making conclusions.</small>
            <em>Limited confidence</em>
          </div>
        )}
      </div>
    </section>
  );
}

function CustomerRevenueLeakageSection({ leakage }: { leakage: CustomerBusinessReport["revenueLeakage"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <DollarSign size={18} />
        <h2>Revenue Leakage Analysis</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={leakage.status} />
        <Metric label="Value Context" value={leakage.valueContext} />
        <Metric label="Boundary" value={leakage.limitation} />
      </div>
      <div className="revenue-leak-grid extended-grid">
        {leakage.leakageAreas.map((item) => (
          <div className="revenue-leak-card" key={item.area}>
            <span>{item.businessArea}</span>
            <h3>{item.area}</h3>
            <p>{item.score} - {item.status}</p>
            <small>{item.customerImpact}</small>
            <strong>{item.action}</strong>
            <em>{item.confidence}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerLocalVisibilitySection({ localVisibility }: { localVisibility: CustomerBusinessReport["localVisibility"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <MapPinned size={18} />
        <h2>Local Presence Intelligence</h2>
      </div>
      <div className="meta-strip four-up">
        <Metric label="Business Profile" value={localVisibility.gbpScore} />
        <Metric label="Local Presence" value={localVisibility.localVisibilityScore} />
        <Metric label="Profile Completeness" value={localVisibility.businessProfileCompleteness} />
        <Metric label="Identity Clarity" value={localVisibility.identityConsistency} />
      </div>
      <div className="customer-intelligence-grid">
        <div className="customer-intelligence-card">
          <span>Review Analysis</span>
          <strong>{localVisibility.reviewAnalysis.status}</strong>
          <p>{localVisibility.reviewAnalysis.finding}</p>
          <small>{localVisibility.reviewAnalysis.gap}</small>
          <em>{localVisibility.reviewAnalysis.action}</em>
        </div>
        <div className="customer-intelligence-card">
          <span>Service Area Clarity</span>
          <strong>{localVisibility.serviceAreaClarity.status}</strong>
          <p>{localVisibility.serviceAreaClarity.evidence}</p>
          <small>{localVisibility.serviceAreaClarity.action}</small>
        </div>
        <div className="customer-intelligence-card">
          <span>Citation Coverage</span>
          <strong>{localVisibility.citationCoverage.status}</strong>
          <p>{localVisibility.citationCoverage.score}</p>
          <small>{localVisibility.citationCoverage.action}</small>
        </div>
      </div>
      {localVisibility.localVisibilityOpportunities.length > 0 && (
        <div className="data-table compact customer-actions-table">
          {localVisibility.localVisibilityOpportunities.map((item) => (
            <div className="table-row" key={`${item.area}-${item.status}`}>
              <span>{item.area}</span>
              <strong>{item.status}</strong>
              <small>{item.action} Confidence: {item.confidence}.</small>
            </div>
          ))}
        </div>
      )}
      {localVisibility.localCompetitorComparison.length > 0 && (
        <div className="data-table compact customer-actions-table">
          {localVisibility.localCompetitorComparison.map((item) => (
            <div className="table-row" key={`${item.competitor}-${item.position}`}>
              <span>{item.competitor}</span>
              <strong>{item.position}</strong>
              <small>{item.reason}</small>
            </div>
          ))}
        </div>
      )}
      {localVisibility.limitations.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}

function CustomerQuestionCoverageSection({ coverage }: { coverage: CustomerBusinessReport["questionCoverage"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <Info size={18} />
        <h2>Customer Question Coverage Summary</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={coverage.status} />
        <Metric label="Coverage Score" value={coverage.coverageScore} />
        <Metric label="Confidence" value={coverage.confidence} />
      </div>
      <div className="data-table compact question-coverage-table">
        <div className="table-row">
          <span>Questions Customers Ask</span>
          <strong>{String(coverage.questionsCustomersAsk.length)}</strong>
          <small>{joinCustomerList(coverage.questionsCustomersAsk)}</small>
        </div>
        <div className="table-row">
          <span>Answered On Website</span>
          <strong>{String(coverage.questionsAnsweredOnWebsite.length)}</strong>
          <small>{joinCustomerList(coverage.questionsAnsweredOnWebsite)}</small>
        </div>
        <div className="table-row">
          <span>Missing From Website</span>
          <strong>{String(coverage.questionsMissingFromWebsite.length)}</strong>
          <small>{joinCustomerList(coverage.questionsMissingFromWebsite)}</small>
        </div>
        <div className="table-row">
          <span>Competitor Answers</span>
          <strong>{String(coverage.questionsCompetitorsAnswer.length)}</strong>
          <small>{joinCustomerList(coverage.questionsCompetitorsAnswer)}</small>
        </div>
        <div className="table-row">
          <span>Recommended Action</span>
          <strong>Answer gaps</strong>
          <small>{coverage.action}</small>
        </div>
      </div>
    </section>
  );
}

function CustomerOutcomeAttributionSection({ attribution }: { attribution: CustomerBusinessReport["outcomeAttribution"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <BarChart3 size={18} />
        <h2>What Affects Revenue Most</h2>
      </div>
      <p className="decision-summary">{attribution.summary}</p>
      {attribution.outcomeLinks.length > 0 ? (
        <div className="data-table compact customer-actions-table">
          {attribution.outcomeLinks.map((item) => (
            <div className="table-row" key={`${item.issue}-${item.businessAreas}`}>
              <span>{item.issue}</span>
              <strong>{item.businessAreas}</strong>
              <small>{item.explanation} Strength: {item.strength}; influence: {item.influence}; confidence: {item.confidence}.</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No evidence-bound business impact link passed the reporting threshold in this scan.</p>
      )}
      <p className="muted">{attribution.boundary}</p>
    </section>
  );
}

function CustomerDependencySummarySection({ dependency }: { dependency: CustomerBusinessReport["dependencySummary"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <Layers size={18} />
        <h2>What To Fix Before Other Work</h2>
      </div>
      <p className="decision-summary">{dependency.summary}</p>
      {dependency.businessConnections.length > 0 ? (
        <div className="data-table compact customer-actions-table">
          {dependency.businessConnections.map((item) => (
            <div className="table-row" key={`${item.issue}-${item.role}`}>
              <span>{item.issue}</span>
              <strong>{item.role}</strong>
              <small>{item.rationale}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No fix-order relationship passed the reporting threshold in this scan.</p>
      )}
      {dependency.fixOrderWarnings.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}

function CustomerRecommendationRoadmapSection({ roadmap }: { roadmap: CustomerBusinessReport["recommendationRoadmap"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <ListChecks size={18} />
        <h2>Implementation Roadmap</h2>
      </div>
      <p className="decision-summary">{roadmap.summary}</p>
      <div className="customer-roadmap-grid">
        {roadmap.phases.map((phase) => (
          <div className="customer-roadmap-card" key={phase.phase}>
            <span>{phase.phase}</span>
            <strong>{phase.focus}</strong>
            <em>{phase.timeframe}</em>
            {phase.actions.length > 0 ? phase.actions.map((action, index) => (
              <p key={`${phase.phase}-${index}`}>{action.action} <small>{action.confidence}; {action.lifecycleState}.</small></p>
            )) : <p>No action in this phase from the current evidence.</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerCompetitorContentComparisonSection({ comparison }: { comparison: CustomerBusinessReport["competitorContentComparison"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <Search size={18} />
        <h2>Website vs Competitor Content Comparison</h2>
      </div>
      <div className="meta-strip">
        <Metric label="Status" value={comparison.status} />
        <Metric label="Competitors" value={comparison.comparedCompetitors.length ? comparison.comparedCompetitors.join(", ") : "Not assessed"} />
        <Metric label="Summary" value={comparison.summary} />
      </div>
      {comparison.contentGaps.length > 0 ? (
        <div className="data-table compact customer-actions-table">
          {comparison.contentGaps.map((item) => (
            <div className="table-row" key={`${item.competitor}-${item.area}`}>
              <span>{item.area}</span>
              <strong>{item.scoreComparison ?? `${item.clientEvidence} vs ${item.competitorEvidence}`}</strong>
              <small>{item.competitor}: {item.implication ?? item.decisionImpact} {item.action}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No validated competitor content advantage was available in this scan.</p>
      )}
      <div className="data-table compact customer-actions-table">
        {comparison.missingContentTypes.map((item) => (
          <div className="table-row" key={item.contentType}>
            <span>{item.contentType}</span>
            <strong>{item.status}</strong>
            <small>{item.action}</small>
          </div>
        ))}
      </div>
      {comparison.limitations.map((item) => <p className="muted" key={item}>{item}</p>)}
    </section>
  );
}

function CustomerCompetitorWinReasonsSection({ winReasons }: { winReasons: CustomerBusinessReport["competitorWinReasons"] }) {
  return (
    <section className="report-section">
      <div className="section-title">
        <ShieldCheck size={18} />
        <h2>Why Competitors Are Winning</h2>
      </div>
      <p className="decision-summary">{winReasons.summary}</p>
      {winReasons.reasons.length > 0 ? (
        <div className="data-table compact customer-actions-table">
          {winReasons.reasons.map((item) => (
            <div className="table-row" key={`${item.competitor}-${item.reason}`}>
              <span>{item.competitor}</span>
              <strong>{item.reason}</strong>
              <small>{item.proof} {item.decisionImpact} {item.action}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No specific competitor win reason was validated beyond score-level comparison.</p>
      )}
    </section>
  );
}
function buildCustomerBusinessReport(report: ReportSnapshot): CustomerBusinessReport {
  const dimensions = report.dimensions ?? [];
  const score = typeof report.oss?.score === "number" && report.oss.scoringStatus !== "not_scored" ? report.oss.score : null;
  const businessType = detectBusinessType(report);
  const isEcommerce = businessType === "E-commerce Store" || hasCommerceSignals(report);
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const recommendations = dedupeCustomerActions(report);
  const highest = recommendations[0];
  const confidenceScore = report.confidenceEngine?.overallConfidenceScore ?? averageConfidence(report);
  const competitorGaps = buildCustomerCompetitorGaps(report);
  const revenueLeaks = buildRevenueLeaks(report, recommendations, competitorGaps);
  const highestRoiReason =
    highest?.reason ??
    (weakest
      ? `${businessDimensionLabel(weakest.label)} is the weakest validated area, so improving it is most likely to reduce customer hesitation.`
      : "The report did not validate a stronger opportunity, so start with clearer next-step messaging.");

  return {
    businessReadinessScore: score,
    scoreLabel: businessReadinessLabel(score),
    businessType,
    isEcommerce,
    verdict: customerVerdict(score, weakest),
    verdictExplanation: customerVerdictExplanation(report, weakest, strongest),
    executiveNarrative: buildCustomerExecutiveNarrative(report, score, weakest, strongest, competitorGaps),
    businessDecisionSnapshot: buildBusinessDecisionSnapshot(report, score, weakest, competitorGaps),
    businessHealthSnapshot: buildBusinessDecisionSnapshot(report, score, weakest, competitorGaps),
    hesitationAreas: buildCustomerHesitationAreas(report),
    competitorNarrative: buildCustomerCompetitorNarrative(report),
    topPriority: buildCustomerTopPriority(report, highest, weakest, confidenceScore),
    expectedBusinessOutcomes: buildCustomerExpectedBusinessOutcomes(report),
    businessInitiatives: buildCustomerBusinessInitiatives(report, recommendations),
    seoBusinessQuestions: buildSeoBusinessQuestions(report),
    decisionTimeline: buildCustomerDecisionTimeline(report),
    highestRoiAction: {
      action: highest?.action ?? report.actionFirstPanel?.fallbackAction ?? "Clarify the main customer action and re-run the assessment.",
      whyItMatters: highestRoiReason,
      confidence: `${Math.max(0, Math.min(100, Math.round(highest?.score ?? confidenceScore)))}%`,
      window: priorityToBusinessWindow(highest?.priority ?? report.priorityTimeline?.thisMonth?.[0]?.category ?? "THIS MONTH")
    },
    revenueLeaks,
    businessDecisionSummary: buildCustomerBusinessDecisionSummary(report),
    businessRisks: buildCustomerBusinessRisks(report, recommendations),
    intelligenceSummaries: buildCustomerIntelligenceSummaries(report),
    localVisibility: buildCustomerLocalVisibility(report),
    competitorContentComparison: buildCustomerCompetitorContentComparison(report),
    questionCoverage: buildCustomerQuestionCoverage(report),
    competitorWinReasons: buildCustomerCompetitorWinReasons(report),
    revenueLeakage: buildCustomerRevenueLeakage(report),
    outcomeAttribution: buildCustomerOutcomeAttribution(report),
    dependencySummary: buildCustomerDependencySummary(report),
    recommendationRoadmap: buildCustomerRecommendationRoadmap(report),
    psychology: buildCustomerPsychology(report),
    impactSummary: buildBusinessImpactSummary(report, revenueLeaks, competitorGaps),
    recommendedActions: recommendations.slice(0, 6).map((item, index) => ({
      title: `Action ${index + 1}`,
      action: item.action,
      reason: item.reason,
      businessExplanation: businessExplanationForAction(item.action, item.reason),
      technicalTasks: technicalTasksForAction(item.action),
      confidence: `${Math.round(item.score)}%`
    })),
    competitorGaps,
    commerceSignals: buildCommerceSignals(report),
    visualSummary: buildVisualSummary(report),
    visualMarkers: buildVisualMarkers(report),
    evidenceItems: buildCustomerEvidenceItems(report)
  };
}

function buildCustomerExecutiveNarrative(
  report: ReportSnapshot,
  score: number | null,
  weakest: ReportSnapshot["dimensions"][number] | undefined,
  strongest: ReportSnapshot["dimensions"][number] | undefined,
  competitorGaps: CustomerBusinessReport["competitorGaps"]
): string {
  const payload = (report as unknown as { customerExecutiveNarrative?: string }).customerExecutiveNarrative;
  if (typeof payload === "string" && payload.trim()) return customerSafeText(payload);
  const evidence = customerValidatedFindingCount(report);
  if (score === null || evidence <= 0) {
    return "Website content was not available for a full customer decision assessment. SYSTOLAB did not infer business impact, risk, conversion loss, or revenue loss without validated current-scan evidence.";
  }
  const foundation = score >= 80 ? "strong" : score >= 65 ? "solid" : score >= 50 ? "recoverable" : "fragile";
  const strongestText = strongest
    ? `${businessDimensionLabel(strongest.label)} is currently the strongest signal for customer confidence.`
    : "The scan found some usable customer decision signals.";
  const weakLabel = weakest ? businessDimensionLabel(weakest.label).toLowerCase() : "decision support";
  const competitorText = competitorGaps.length
    ? "Competitors generally provide stronger decision-support content in the areas listed below, which may influence customers during evaluation."
    : "Competitor intelligence did not validate a stronger external advantage in this scan.";
  return `Your business presents a ${foundation} foundation for customer trust and conversion. ${strongestText} The largest opportunity is improving ${weakLabel} so visitors reach key information and act with less friction. ${competitorText}`;
}

function buildBusinessDecisionSnapshot(
  report: ReportSnapshot,
  score: number | null,
  weakest: ReportSnapshot["dimensions"][number] | undefined,
  competitorGaps: CustomerBusinessReport["competitorGaps"]
): CustomerBusinessReport["businessDecisionSnapshot"] {
  const payload = (report as unknown as {
    customerBusinessDecisionSnapshot?: CustomerBusinessReport["businessDecisionSnapshot"];
    customerBusinessHealthSnapshot?: CustomerBusinessReport["businessDecisionSnapshot"];
  }).customerBusinessDecisionSnapshot ?? (report as unknown as { customerBusinessHealthSnapshot?: CustomerBusinessReport["businessDecisionSnapshot"] }).customerBusinessHealthSnapshot;
  if (Array.isArray(payload) && payload.length) return payload.map((item) => ({ ...item, area: customerSafeText(item.area), status: customerSafeText(item.status), meaning: customerSafeText(item.meaning) }));

  const decisionConfidence = averageNullable([scoreForDimension(report, "trust"), scoreForDimension(report, "informationClarity"), scoreForDimension(report, "conversionReadiness"), scoreForDimension(report, "mobileExperience")]);
  const revenue = buildCustomerRevenueLeakage(report);
  const priorityLabel = weakest ? `Improve ${businessDimensionLabel(weakest.label)}` : "Improve Decision Support";
  return [
    { area: "Business Readiness", status: healthStatusForScore(score), meaning: "How ready the website appears to support customer trust, understanding, and action based on validated scan evidence." },
    { area: "Customer Decision Confidence", status: healthStatusForScore(decisionConfidence), meaning: "How confidently a visitor can understand the offer, trust the business, and choose the next step." },
    { area: "Competitive Position", status: competitorGaps.length ? competitiveMomentumForGapCount(competitorGaps.length) : "Competitive", meaning: competitorGaps.length ? "Validated competitor evidence suggests stronger decision support in selected areas." : "No validated competitor advantage was found from the available comparison evidence." },
    { area: "Revenue Opportunity", status: revenue.valueContext, meaning: "The practical opportunity indicated by current customer friction, not a guaranteed revenue claim." },
    { area: "Priority Focus", status: priorityLabel, meaning: "The first business area to improve based on the weakest validated customer decision signal." }
  ];
}

function buildCustomerHesitationAreas(report: ReportSnapshot): CustomerBusinessReport["hesitationAreas"] {
  const payload = (report as unknown as { customerHesitationAreas?: CustomerBusinessReport["hesitationAreas"] }).customerHesitationAreas;
  if (Array.isArray(payload) && payload.length) return payload.map((item) => ({
    area: customerSafeText(item.area),
    whatIsHappening: customerSafeText(item.whatIsHappening),
    whyItMatters: customerSafeText(item.whyItMatters),
    action: customerSafeText(item.action),
    confidence: customerSafeText(item.confidence)
  }));

  const weak = (report.dimensions ?? [])
    .filter((dimension) => dimension.score < 76)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((dimension) => ({
      area: businessDimensionLabel(dimension.label),
      whatIsHappening: `${businessDimensionLabel(dimension.label)} is ${dimension.score}/100 in the validated scan evidence.`,
      whyItMatters: customerImpactForDimension(dimension.key),
      action: actionForDimensionKey(dimension.key),
      confidence: `${dimension.confidenceScore}% ${dimension.confidenceLevel}`
    }));
  return weak.length ? weak : [{
    area: "Customer Decision Path",
    whatIsHappening: "No major hesitation area passed the reporting threshold in this scan.",
    whyItMatters: "The validated evidence suggests the current decision path is broadly usable.",
    action: "Maintain proof, clarity, contact visibility, and customer-answer coverage while monitoring competitors.",
    confidence: customerEvidenceStrengthLabel(report)
  }];
}

function buildCustomerCompetitorNarrative(report: ReportSnapshot): CustomerBusinessReport["competitorNarrative"] {
  const payload = (report as unknown as { customerCompetitorNarrative?: Partial<CustomerBusinessReport["competitorNarrative"]> }).customerCompetitorNarrative;
  if (payload?.summary) {
    return {
      title: customerSafeText(payload.title ?? "Why Customers May Choose Competitors"),
      summary: customerSafeText(payload.summary),
      momentum: customerSafeText(payload.momentum ?? "Not assessed"),
      costOfDelay: customerSafeText(payload.costOfDelay ?? "No evidence-bound cost of delay was generated."),
      limitations: textArray(payload.limitations)
    };
  }
  const gaps = buildCustomerCompetitorContentComparison(report).contentGaps;
  return {
    title: "Why Customers May Choose Competitors",
    summary: gaps.length
      ? "Based on the validated pages analysed, competitors may present stronger trust signals, answer more customer questions, or make services easier to evaluate. These differences may encourage potential customers to compare alternatives before contacting your business."
      : "This scan did not validate a specific competitor advantage beyond the available score-level comparison.",
    momentum: competitiveMomentumForGapCount(gaps.length),
    costOfDelay: gaps.length
      ? "While these decision gaps remain unresolved, potential customers may continue comparing alternatives before contacting your business. Competitors may strengthen their customer experience and visibility over time, making it harder to improve your relative competitive position."
      : "No evidence-bound cost of delay was generated for competitor movement in this scan.",
    limitations: gaps.length ? buildCustomerCompetitorContentComparison(report).limitations : ["Add competitor URLs and allow full content collection to compare FAQs, process detail, pricing cues, trust proof, and educational depth."]
  };
}

function buildCustomerTopPriority(
  report: ReportSnapshot,
  highest: { action: string; reason: string; score: number; priority?: string } | undefined,
  weakest: ReportSnapshot["dimensions"][number] | undefined,
  confidenceScore: number
): CustomerBusinessReport["topPriority"] {
  const payload = (report as unknown as { customerTopPriority?: Partial<CustomerBusinessReport["topPriority"]> }).customerTopPriority;
  if (payload?.recommendedPriority) {
    return {
      recommendedPriority: customerSafeText(payload.recommendedPriority),
      whyItMatters: customerSafeText(payload.whyItMatters ?? "This is the highest-confidence next improvement from current evidence."),
      expectedBusinessBenefit: customerSafeText(payload.expectedBusinessBenefit ?? "The customer decision path becomes clearer and easier to act on."),
      confidence: customerSafeText(payload.confidence ?? `${Math.round(confidenceScore)}%`),
      effort: customerSafeText(payload.effort ?? "Medium"),
      firstAction: customerSafeText(payload.firstAction ?? "Complete the highest-confidence action first, then re-scan to validate improvement.")
    };
  }
  const action = highest?.action ?? (weakest ? actionForDimensionKey(weakest.key) : "Improve the clearest customer decision gap first.");
  return {
    recommendedPriority: customerSafeText(action),
    whyItMatters: "Improving this area is expected to reduce customer hesitation at a key decision point. Based on validated evidence, it is the improvement most likely to strengthen customer confidence or next-step clarity first.",
    expectedBusinessBenefit: expectedOutcomeForAction(action),
    confidence: `${Math.max(0, Math.min(100, Math.round(highest?.score ?? confidenceScore)))}%`,
    effort: effortForAction(action),
    firstAction: firstActionForRecommendation(action)
  };
}

function buildCustomerExpectedBusinessOutcomes(report: ReportSnapshot): CustomerBusinessReport["expectedBusinessOutcomes"] {
  const payload = (report as unknown as { customerExpectedBusinessOutcomes?: CustomerBusinessReport["expectedBusinessOutcomes"] }).customerExpectedBusinessOutcomes;
  if (Array.isArray(payload) && payload.length) return payload.map((item) => ({
    improvement: customerSafeText(item.improvement),
    expectedOutcome: customerSafeText(item.expectedOutcome),
    confidence: customerSafeText(item.confidence)
  }));
  const confidence = customerEvidenceStrengthLabel(report);
  return [
    { improvement: "Customer decision path", expectedOutcome: "More visitors understand your offer and are more likely to enquire.", confidence },
    { improvement: "Trust signals", expectedOutcome: "More customers feel confident contacting your business.", confidence },
    { improvement: "Local presence", expectedOutcome: "Better visibility among nearby customers searching for your services.", confidence },
    { improvement: "Customer question coverage", expectedOutcome: "Fewer unanswered objections during the buying process.", confidence }
  ];
}

function buildCustomerBusinessInitiatives(
  report: ReportSnapshot,
  recommendations: Array<{ action: string; reason: string; score: number; priority?: string }>
): CustomerBusinessReport["businessInitiatives"] {
  const payload = (report as unknown as { customerBusinessInitiatives?: CustomerBusinessReport["businessInitiatives"] }).customerBusinessInitiatives;
  if (Array.isArray(payload) && payload.length) return payload.map((item) => ({
    title: customerSafeText(item.title),
    outcome: customerSafeText(item.outcome),
    actions: textArray(item.actions),
    confidence: customerSafeText(item.confidence)
  }));
  const actions = recommendations.map((recommendation) => recommendation.action).filter(Boolean);
  const fallback = actions.length ? actions : [report.actionFirstPanel?.fallbackAction ?? "Improve the weakest validated customer decision area first."];
  const buckets = [
    { title: "Business Initiative 1 - Increase Customer Enquiries", outcome: "Clarify the offer, improve contact visibility, and simplify the next step.", actions: actions.filter((action) => initiativeBucket(action) === "enquiries") },
    { title: "Business Initiative 2 - Build Customer Confidence", outcome: "Add stronger trust proof, credibility signals, and answers to common customer concerns.", actions: actions.filter((action) => initiativeBucket(action) === "confidence") },
    { title: "Business Initiative 3 - Increase Discoverability", outcome: "Improve visibility structure, customer-answer coverage, and local presence.", actions: actions.filter((action) => initiativeBucket(action) === "discoverability") }
  ];
  return buckets.map((bucket, index) => ({
    title: bucket.title,
    outcome: bucket.outcome,
    actions: (bucket.actions.length ? bucket.actions : [fallback[index % fallback.length]]).map(customerSafeText).slice(0, 4),
    confidence: customerEvidenceStrengthLabel(report)
  }));
}

function buildSeoBusinessQuestions(report: ReportSnapshot): CustomerBusinessReport["seoBusinessQuestions"] {
  const payload = (report as unknown as { customerSeoBusinessQuestions?: CustomerBusinessReport["seoBusinessQuestions"] }).customerSeoBusinessQuestions;
  if (Array.isArray(payload) && payload.length) {
    return payload.map((item) => ({
      question: customerSafeText(item.question),
      answer: customerSafeText(item.answer),
      businessMeaning: customerSafeText(item.businessMeaning),
      action: customerSafeText(item.action),
      confidence: customerSafeText(item.confidence)
    }));
  }
  const visibility = scoreForDimension(report, "visibilityStructure");
  const clarity = scoreForDimension(report, "informationClarity");
  const questionCoverage = buildCustomerQuestionCoverage(report);
  const competitorContent = buildCustomerCompetitorContentComparison(report);
  const missingCount = questionCoverage.questionsMissingFromWebsite.length;
  const competitorGapCount = competitorContent.contentGaps.length;
  return [
    {
      question: "Can customers find your business?",
      answer: healthStatusForScore(visibility),
      businessMeaning: visibility === null ? "Search visibility could not be scored from current evidence." : `Search visibility readiness is ${Math.round(visibility)}/100, which affects discovery before customers compare options.`,
      action: actionForDimensionKey("visibilityStructure"),
      confidence: customerEvidenceStrengthLabel(report)
    },
    {
      question: "What are customers searching for that you do not answer?",
      answer: missingCount ? `${missingCount} question gap${missingCount === 1 ? "" : "s"}` : "No major question gap validated",
      businessMeaning: missingCount ? joinCustomerList(questionCoverage.questionsMissingFromWebsite.slice(0, 4)) : "Current evidence did not validate a separate unanswered-question cluster.",
      action: questionCoverage.action,
      confidence: questionCoverage.confidence
    },
    {
      question: "Why are competitors appearing above you?",
      answer: competitorGapCount ? `${competitorGapCount} competitor advantage${competitorGapCount === 1 ? "" : "s"}` : "Not validated",
      businessMeaning: competitorGapCount ? "Competitors provide more information that helps customers compare services and make confident decisions." : "Competitor evidence did not validate a stronger decision-support reason in this scan.",
      action: competitorGapCount ? competitorContent.contentGaps[0]?.action ?? "Close validated competitor content gaps." : "Add competitor URLs and collect full evidence before drawing a stronger conclusion.",
      confidence: customerEvidenceStrengthLabel(report)
    },
    {
      question: "Where are you losing organic traffic?",
      answer: clarity !== null && visibility !== null && visibility < clarity ? "Discovery structure" : "Content decision support",
      businessMeaning: "Organic traffic is most likely limited where discoverability, topical depth, local signals, or customer-answer coverage is incomplete.",
      action: visibility !== null && visibility < 70 ? actionForDimensionKey("visibilityStructure") : "Add decision-stage service content, FAQs, comparison support, and helpful educational pages.",
      confidence: customerEvidenceStrengthLabel(report)
    },
    {
      question: "Which SEO improvements will create the greatest business impact?",
      answer: "Prioritized roadmap",
      businessMeaning: "The strongest SEO work should also improve trust, clarity, conversion readiness, and customer confidence, not only rankings.",
      action: buildCustomerRecommendationRoadmap(report).phases.find((phase) => phase.actions.length)?.actions[0]?.action ?? actionForDimensionKey("visibilityStructure"),
      confidence: customerEvidenceStrengthLabel(report)
    },
    {
      question: "How confident are these recommendations?",
      answer: customerEvidenceStrengthLabel(report),
      businessMeaning: "Confidence rises when current-scan evidence covers enough pages, validated findings, questions, competitors, and business signals.",
      action: "Use the Evidence & Implementation panel for technical tasks, then re-scan to validate improvement.",
      confidence: `${Math.round(report.confidenceEngine?.overallConfidenceScore ?? averageConfidence(report))}%`
    }
  ];
}

function buildCustomerDecisionTimeline(report: ReportSnapshot): DecisionTimelineOutput | null {
  const fromPayload = (report as unknown as { decisionTimeline?: DecisionTimelineOutput }).decisionTimeline;
  if (fromPayload?.points?.length) return fromPayload;
  const evolution = report.businessEvolutionEngine;
  if (!evolution?.timeline?.length) return null;
  const points = evolution.timeline.map((point) => ({
    snapshotId: point.snapshotId,
    capturedAt: point.capturedAt,
    scanDate: point.capturedAt,
    reportLifecycle: "available" as const,
    status: report.status,
    oss: point.oss,
    visualStateLabel: report.oss?.visualState?.label ?? "Unknown",
    businessRiskStatus: report.businessRiskStatus?.classification ?? "UNKNOWN",
    confidenceScore: Math.round(report.confidenceEngine?.overallConfidenceScore ?? averageConfidence(report)),
    evidenceCoveragePercent: Math.round(((report.evidenceCoverageSummary?.pages ?? []).filter((page) => page.coverageStatus === "Complete").length / Math.max(1, report.evidenceCoverageSummary?.pages?.length ?? 1)) * 100),
    totalPagesSampled: report.evidenceCoverageSummary?.totalPagesSampled ?? 0,
    totalEvidenceObjects: report.evidenceCoverageSummary?.totalEvidenceObjects ?? report.evidenceObjects?.length ?? 0,
    strongestSignal: report.dimensions?.slice().sort((a, b) => b.score - a.score)[0]?.label ?? "Not enough evidence",
    weakestSignal: report.dimensions?.slice().sort((a, b) => a.score - b.score)[0]?.label ?? "Not enough evidence",
    topDecision: point.topCause,
    topRecommendedAction: report.recommendationEngine?.recommendations?.[0]?.action ?? report.executiveClarity?.recommendedFirstAction ?? "Re-run scan after evidence is available",
    engineVersion: report.executionProvenance?.systemVersion ?? "SYSTOLAB V1",
    intelligenceModelVersion: report.executionProvenance?.systemVersion ?? "SYSTOLAB V1",
    decisionFrameworkVersion: report.reportGovernance?.version ?? "SYSTOLAB Governance v1.0",
    reportTemplateVersion: report.structuredOutputSchema?.schemaVersion ?? "report-template-v1"
  }));
  return {
    status: points.length <= 1 ? "baseline_only" : "active",
    targetUrl: report.targetUrl,
    tenantSlug: report.tenantBranding.slug,
    generatedAt: new Date().toISOString(),
    currentSnapshotId: report.snapshotId,
    currentLifecycle: report.status === "completed" ? "available" : "limited",
    summary: evolution.causeNarrative,
    platformGovernance: {
      sourceOfTruth: "SYSTOLAB Intelligence Engine",
      mutationPolicy: "immutable_snapshot_history",
      ethicsPolicy: "SYSTOLAB separates observed, inferred, and estimated conclusions."
    },
    versionLedger: {
      engineVersion: report.executionProvenance?.systemVersion ?? "SYSTOLAB V1",
      intelligenceModelVersion: report.executionProvenance?.systemVersion ?? "SYSTOLAB V1",
      decisionFrameworkVersion: report.reportGovernance?.version ?? "SYSTOLAB Governance v1.0",
      reportTemplateVersion: report.structuredOutputSchema?.schemaVersion ?? "report-template-v1",
      currentScanDate: report.freshness?.capturedAt ?? report.createdAt
    },
    points,
    events: [],
    limitations: ["Timeline is built from available immutable report history for this website."]
  };
}

function dedupeCustomerBusinessDecisions(
  decisions: CustomerBusinessReport["businessDecisionSummary"]["decisions"]
): CustomerBusinessReport["businessDecisionSummary"]["decisions"] {
  return dedupeBy(decisions, (item) => canonicalDecisionKey(`${item.meaning} ${item.priority}`))
    .slice(0, 4)
    .map((item, index) => ({ ...item, title: `Business Decision ${index + 1}` }));
}

function dedupeCustomerPriorityActions(
  actions: CustomerBusinessReport["businessDecisionSummary"]["priorityActions"]
): CustomerBusinessReport["businessDecisionSummary"]["priorityActions"] {
  return dedupeBy(actions, (item) => canonicalDecisionKey(`${item.action} ${item.priority}`))
    .slice(0, 4)
    .map((item, index) => ({ ...item, title: `Priority Action ${index + 1}` }));
}

function canonicalDecisionKey(value: string): string {
  const text = value.toLowerCase();
  if (/mobile|viewport|resource|speed|responsive|tap/.test(text)) return "mobile_conversion_path";
  if (/trust|review|testimonial|proof|credib|guarantee|certif|case stud/.test(text)) return "customer_trust";
  if (/competitor|compare|comparison|alternative|versus/.test(text)) return "competitor_decision_support";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "customer_questions";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "search_visibility";
  if (/conversion|cta|book|buy|form|lead|checkout|contact path|action path|ready to act|next step|taking action|take action|act but need/.test(text)) return "conversion_readiness";
  if (/clarity|message|offer|explain|information/.test(text)) return "offer_clarity";
  return text.replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

function buildCustomerBusinessDecisionSummary(report: ReportSnapshot): CustomerBusinessReport["businessDecisionSummary"] {
  const payload = (report as unknown as { customerBusinessDecisionSummary?: Partial<CustomerBusinessReport["businessDecisionSummary"]> }).customerBusinessDecisionSummary;
  const contract = (report as unknown as { globalOutputContract?: ReportSnapshot["globalOutputContract"] }).globalOutputContract;
  const fallback = contract && contract.status !== "content_unavailable" ? {
    confidenceScore: `${Math.round(contract.confidenceScore)}%`,
    evidenceStrength: customerEvidenceStrengthLabel(report),
    decisions: contract.keyDecisionSummary.map((item, index) => ({
      title: `Business decision ${index + 1}`,
      meaning: customerSafeText(item.summary),
      priority: customerSafeText(item.priorityTier)
    })),
    businessDrivers: contract.rootCauseClusters.map((item, index) => ({
      title: `Business driver ${index + 1}`,
      driver: customerSafeText(item.primaryCausalDriver),
      meaning: customerSafeText(item.rootCauseStatement)
    })),
    revenueImpactAreas: contract.revenueImpactAreas.map((item) => ({
      area: customerSafeText(item.impactArea),
      businessImpact: customerSafeText(item.businessImpact),
      confidence: `${Math.round(item.confidenceScore)}%`
    })),
    priorityActions: contract.actionPlanMapping.map((item, index) => ({
      title: `Priority action ${index + 1}`,
      action: customerSafeText(item.authoritativeAction),
      priority: customerSafeText(item.priorityTier)
    })),
    limitations: textArray(contract.limitations)
  } : undefined;

  return {
    confidenceScore: customerSafeText(payload?.confidenceScore ?? fallback?.confidenceScore ?? "0%"),
    evidenceStrength: customerSafeText(payload?.evidenceStrength ?? fallback?.evidenceStrength ?? customerEvidenceStrengthLabel(report)),
    decisions: dedupeCustomerBusinessDecisions(normalizeRows(payload?.decisions).length ? normalizeRows(payload?.decisions) : fallback?.decisions ?? []),
    businessDrivers: normalizeRows(payload?.businessDrivers).length ? normalizeRows(payload?.businessDrivers) : fallback?.businessDrivers ?? [],
    revenueImpactAreas: normalizeRows(payload?.revenueImpactAreas).length ? normalizeRows(payload?.revenueImpactAreas) : fallback?.revenueImpactAreas ?? [],
    priorityActions: dedupeCustomerPriorityActions(normalizeRows(payload?.priorityActions).length ? normalizeRows(payload?.priorityActions) : fallback?.priorityActions ?? []),
    limitations: textArray(payload?.limitations).length ? textArray(payload?.limitations) : fallback?.limitations ?? []
  };
}
function buildCustomerLocalVisibility(report: ReportSnapshot): CustomerBusinessReport["localVisibility"] {
  const payload = (report as unknown as { customerLocalVisibility?: Partial<CustomerBusinessReport["localVisibility"]> }).customerLocalVisibility;
  return {
    status: customerSafeText(payload?.status ?? report.gbpIdentity?.status ?? "Not assessed"),
    gbpScore: customerSafeText(payload?.gbpScore ?? (report.gbpIdentity ? `${report.gbpIdentity.identityConsistencyScore}/100` : "Not assessed")),
    localVisibilityScore: customerSafeText(payload?.localVisibilityScore ?? "Not assessed"),
    businessProfileCompleteness: customerSafeText(payload?.businessProfileCompleteness ?? report.gbpIdentity?.profileCompletenessLevel ?? "Not Assessed"),
    identityConsistency: customerSafeText(payload?.identityConsistency ?? report.gbpIdentity?.identityMismatchFlag ?? "Not assessed"),
    reviewAnalysis: {
      status: customerSafeText(payload?.reviewAnalysis?.status ?? "Review and rating trends not assessed"),
      finding: customerSafeText(payload?.reviewAnalysis?.finding ?? "The current scan did not collect verified review count, rating trend, or business profile history evidence."),
      gap: customerSafeText(payload?.reviewAnalysis?.gap ?? "Add visible review/rating proof or provide profile data before drawing review-trend conclusions."),
      action: customerSafeText(payload?.reviewAnalysis?.action ?? "Show current reviews, rating proof, testimonial depth, service proof, and local credibility near decision points.")
    },
    serviceAreaClarity: {
      status: customerSafeText(payload?.serviceAreaClarity?.status ?? "Service-area evidence limited"),
      evidence: customerSafeText(payload?.serviceAreaClarity?.evidence ?? "No strong service-area, hours, map, or local contact signal was validated."),
      action: customerSafeText(payload?.serviceAreaClarity?.action ?? "Clarify address, phone, hours, service areas, appointment path, and local proof.")
    },
    citationCoverage: {
      status: customerSafeText(payload?.citationCoverage?.status ?? "Not assessed"),
      score: customerSafeText(payload?.citationCoverage?.score ?? "Not assessed"),
      action: customerSafeText(payload?.citationCoverage?.action ?? "Strengthen directory, association, partner, listing, media, and authority-reference signals where they support credibility.")
    },
    localCompetitorComparison: normalizeRows(payload?.localCompetitorComparison),
    localVisibilityOpportunities: normalizeRows(payload?.localVisibilityOpportunities),
    limitations: textArray(payload?.limitations)
  };
}

function buildCustomerCompetitorContentComparison(report: ReportSnapshot): CustomerBusinessReport["competitorContentComparison"] {
  const payload = (report as unknown as { customerCompetitorContentComparison?: Partial<CustomerBusinessReport["competitorContentComparison"]> }).customerCompetitorContentComparison;
  const fallbackGaps = buildCustomerCompetitorGaps(report).map((gap) => ({
    competitor: gap.competitor,
    area: gap.area,
    clientEvidence: "Client weaker",
    competitorEvidence: "Competitor stronger",
    scoreComparison: gap.position,
    implication: "Competitors provide more information that helps customers compare services and make confident decisions. This reduces uncertainty before customers contact them.",
    decisionImpact: gap.decisionImpact,
    action: "Close the competitor information gap with clearer proof, answers, transparency, or decision-support content."
  }));
  return {
    status: customerSafeText(payload?.status ?? (fallbackGaps.length ? "Competitor content gaps detected" : "Not assessed")),
    summary: customerSafeText(payload?.summary ?? (fallbackGaps.length ? "SYSTOLAB found areas where compared competitors provide stronger customer decision support." : "No validated competitor content advantage was available in this scan.")),
    comparedCompetitors: textArray(payload?.comparedCompetitors),
    contentGaps: normalizeRows(payload?.contentGaps).length ? normalizeRows(payload?.contentGaps) : fallbackGaps,
    missingContentTypes: normalizeRows(payload?.missingContentTypes),
    limitations: textArray(payload?.limitations)
  };
}

function buildCustomerQuestionCoverage(report: ReportSnapshot): CustomerBusinessReport["questionCoverage"] {
  const payload = (report as unknown as { customerQuestionCoverage?: Partial<CustomerBusinessReport["questionCoverage"]> }).customerQuestionCoverage;
  return {
    status: customerSafeText(payload?.status ?? "Not assessed"),
    coverageScore: customerSafeText(payload?.coverageScore ?? "Not assessed"),
    questionsCustomersAsk: textArray(payload?.questionsCustomersAsk),
    questionsAnsweredOnWebsite: textArray(payload?.questionsAnsweredOnWebsite),
    questionsMissingFromWebsite: textArray(payload?.questionsMissingFromWebsite),
    questionsCompetitorsAnswer: textArray(payload?.questionsCompetitorsAnswer).length ? textArray(payload?.questionsCompetitorsAnswer) : ["Competitor question-answer coverage was not validated in this scan."],
    action: customerSafeText(payload?.action ?? "Add direct answers for price, process, trust, comparison, objections, contact, service area, availability, and decision-stage questions."),
    confidence: customerSafeText(payload?.confidence ?? "Limited confidence")
  };
}

function buildCustomerCompetitorWinReasons(report: ReportSnapshot): CustomerBusinessReport["competitorWinReasons"] {
  const payload = (report as unknown as { customerCompetitorWinReasons?: Partial<CustomerBusinessReport["competitorWinReasons"]> }).customerCompetitorWinReasons;
  const fallback = buildCustomerCompetitorGaps(report).map((gap) => ({
    competitor: gap.competitor,
    reason: `${gap.competitor} appears stronger in ${gap.area}.`,
    proof: gap.position,
    decisionImpact: gap.decisionImpact,
    action: "Improve the matching customer decision area with stronger content, proof, and next-step support."
  }));
  const payloadReasons = normalizeRows<CustomerBusinessReport["competitorWinReasons"]["reasons"][number]>(payload?.reasons);
  const reasons = payloadReasons.length ? payloadReasons : fallback;
  return {
    status: customerSafeText(payload?.status ?? (reasons.length ? "Validated competitor advantage detected" : "Not validated")),
    summary: customerSafeText(payload?.summary ?? (reasons.length ? "Competitors provide more information that helps customers compare services and make confident decisions. This reduces uncertainty before customers contact them." : "This scan did not validate why a competitor is winning beyond score-level comparison.")),
    reasons
  };
}

function buildCustomerRevenueLeakage(report: ReportSnapshot): CustomerBusinessReport["revenueLeakage"] {
  const payload = (report as unknown as { customerRevenueLeakage?: Partial<CustomerBusinessReport["revenueLeakage"]> }).customerRevenueLeakage;
  const fallbackAreas = ["trust", "conversionReadiness", "informationClarity", "visibilityStructure"].map((key) => {
    const dimension = (report.dimensions ?? []).find((item) => item.key === key);
    return {
      area: leakTitleForDimension(key, businessDimensionLabel(key)),
      score: typeof dimension?.score === "number" ? `${dimension.score}/100` : "Not assessed",
      status: dimension?.classification ?? "Not assessed",
      businessArea: businessDimensionLabel(key),
      customerImpact: customerImpactForDimension(key),
      action: actionForDimensionKey(key),
      confidence: dimension ? `${dimension.confidenceScore}% ${dimension.confidenceLevel}` : "Limited confidence"
    };
  });
  return {
    status: customerSafeText(payload?.status ?? report.revenueIntelligence?.status ?? "Not assessed"),
    valueContext: customerSafeText(payload?.valueContext ?? (report.revenueIntelligence?.revenueOpportunityRange ? `${opportunityLabel(report.revenueIntelligence.revenueOpportunityRange.label)}: ${report.revenueIntelligence.revenueOpportunityRange.low}-${report.revenueIntelligence.revenueOpportunityRange.high}` : "Revenue leakage is not estimated without validated current-scan evidence.")),
    leakageAreas: normalizeRows(payload?.leakageAreas).length ? normalizeRows(payload?.leakageAreas) : fallbackAreas,
    limitation: customerSafeText(payload?.limitation ?? "These are structural leakage categories supported by scan evidence, not guaranteed revenue outcomes.")
  };
}

function buildCustomerOutcomeAttribution(report: ReportSnapshot): CustomerBusinessReport["outcomeAttribution"] {
  const payload = (report as unknown as { customerBusinessOutcomeSummary?: Partial<CustomerBusinessReport["outcomeAttribution"]> }).customerBusinessOutcomeSummary;
  return {
    status: customerSafeText(payload?.status ?? "Not assessed"),
    summary: customerSafeText(payload?.summary ?? "No business impact link passed the current evidence threshold."),
    outcomeLinks: normalizeRows(payload?.outcomeLinks),
    boundary: customerSafeText(payload?.boundary ?? "Business impact links are directional and evidence-bound; they do not claim actual revenue loss without verified performance data.")
  };
}

function buildCustomerDependencySummary(report: ReportSnapshot): CustomerBusinessReport["dependencySummary"] {
  const payload = (report as unknown as { customerIssueConnectionSummary?: Partial<CustomerBusinessReport["dependencySummary"]> }).customerIssueConnectionSummary;
  return {
    status: customerSafeText(payload?.status ?? "Not assessed"),
    summary: customerSafeText(payload?.summary ?? "No issue connection passed the evidence threshold."),
    businessConnections: normalizeRows(payload?.businessConnections),
    fixOrderWarnings: textArray(payload?.fixOrderWarnings)
  };
}

function buildCustomerRecommendationRoadmap(report: ReportSnapshot): CustomerBusinessReport["recommendationRoadmap"] {
  const payload = (report as unknown as { customerImplementationRoadmap?: Partial<CustomerBusinessReport["recommendationRoadmap"]> }).customerImplementationRoadmap;
  const phases = normalizeRows<CustomerBusinessReport["recommendationRoadmap"]["phases"][number]>(payload?.phases);
  return {
    status: customerSafeText(payload?.status ?? (phases.some((phase) => phase.actions?.length) ? "Sequenced" : "Not assessed")),
    summary: customerSafeText(payload?.summary ?? "Recommendations are grouped into practical phases."),
    phases: phases.length ? phases : [
      { phase: "Phase 1", focus: "Fix trust and critical blockers", timeframe: "FIX NOW", actions: [] },
      { phase: "Phase 2", focus: "Fix conversion and decision clarity", timeframe: "THIS MONTH", actions: [] },
      { phase: "Phase 3", focus: "Fix authority and visibility support", timeframe: "MONITOR", actions: [] },
      { phase: "Phase 4", focus: "Capture demand and monitor gains", timeframe: "Follow-up", actions: [] }
    ]
  };
}

function normalizeRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(customerSafeText).filter(Boolean) : [];
}

function competitiveMomentumForGapCount(gapCount: number): string {
  if (gapCount <= 0) return "Stable";
  if (gapCount === 1) return "Watch Closely";
  if (gapCount <= 3) return "Losing Ground";
  return "High Competitive Pressure";
}

function expectedOutcomeForAction(action: string): string {
  const text = action.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) return "Visitors can more quickly understand how to contact your business or request a quote.";
  if (/viewport|resource|mobile|speed|responsive/.test(text)) return "Mobile visitors can understand the offer and reach the next step with less abandonment risk.";
  if (/trust|review|testimonial|proof|credib|guarantee|certif/.test(text)) return "More customers may feel confident contacting the business before comparing alternatives.";
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) return "Fewer customers need to leave the site to answer buying-stage questions.";
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) return "Customers can find and understand the right pages more easily.";
  return "The customer decision path becomes clearer and easier to act on.";
}

function effortForAction(action: string): string {
  const text = action.toLowerCase();
  if (/schema|entity|citation|local|resource|speed|technical|render|responsive/.test(text)) return "Medium";
  if (/redesign|architecture|migration|checkout|booking/.test(text)) return "High";
  return "Low";
}

function firstActionForRecommendation(action: string): string {
  const text = action.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) return "Make the main contact or quote action visible near the first customer decision point.";
  if (/trust|review|testimonial|proof|credib/.test(text)) return "Place the strongest proof near high-intent pages and contact paths.";
  if (/question|faq|answer|pricing|cost|process/.test(text)) return "Add clear answers for the highest-intent customer questions first.";
  if (/visibility|search|local|schema|entity|citation/.test(text)) return "Start with the visibility signals that also help customers understand the business.";
  return "Complete the highest-confidence action first, then re-scan to validate improvement.";
}

function initiativeBucket(action: string): "enquiries" | "confidence" | "discoverability" {
  const text = action.toLowerCase();
  if (/trust|review|testimonial|proof|credib|guarantee|certif|case stud|question|faq|answer|pricing|cost|process|objection/.test(text)) return "confidence";
  if (/visibility|search|local|schema|entity|citation|discover|topic|internal link/.test(text)) return "discoverability";
  return "enquiries";
}

function actionForDimensionKey(key: string): string {
  if (key === "trust") return "Add stronger proof, reviews, testimonials, certifications, guarantees, and credibility cues.";
  if (key === "conversionReadiness") return "Clarify the primary action path and remove friction before form, booking, contact, or purchase.";
  if (key === "informationClarity") return "Explain the offer, process, pricing cues, outcomes, and next steps more clearly.";
  if (key === "visibilityStructure") return "Improve discoverability, page structure, entity cues, local signals, and internal linking.";
  return "Improve the weakest validated customer decision area first.";
}

function joinCustomerList(items: string[]): string {
  return items.length ? items.map(customerSafeText).join(" ") : "Not validated in this scan.";
}
function customerRecommendationEvidenceNote(reason: string): string {
  const safe = customerSafeText(reason);
  if (!safe) return "Validated evidence supports this recommendation.";
  if (/revenue|opportunity|recoverable|monthly|value units?|estimate|leakage/i.test(safe)) {
    return "Validated evidence supports this recommendation; the structural opportunity estimate is summarized in the Executive Summary and Revenue Opportunity sections.";
  }
  return safe;
}

function businessExplanationForAction(action: string, reason: string): string {
  const text = `${action} ${reason}`.toLowerCase();
  if (/primary cta|cta presence|call to action|contact visibility|request a quote/.test(text)) {
    return "Help visitors immediately understand how to contact your business or request a quote.";
  }
  if (/viewport|resource|mobile|contact|cta|action path|speed|responsive/.test(text)) {
    return "Make it easier for mobile visitors to quickly understand your offer and contact your business. This reduces abandonment among high-intent visitors.";
  }
  if (/trust|review|testimonial|proof|credib|guarantee|certif/.test(text)) {
    return "Give visitors stronger reasons to trust the business before they compare alternatives or decide to contact you.";
  }
  if (/competitor|compare|comparison|alternative|versus/.test(text)) {
    return "Close the information gap that may make competitors feel safer or easier to choose during customer comparison.";
  }
  if (/question|faq|answer|pricing|cost|process|objection/.test(text)) {
    return "Answer the questions customers ask before they contact, book, or buy so fewer people leave to research elsewhere.";
  }
  if (/visibility|search|local|schema|entity|citation|discover/.test(text)) {
    return "Help customers find the right pages and understand the business faster when they are searching for a solution.";
  }
  if (/conversion|form|booking|checkout|lead|buy|contact/.test(text)) {
    return "Make the next step clearer so interested visitors can move from interest to action with less friction.";
  }
  return "Improve the customer decision path so visitors can understand the offer, trust the business, and take the next step with less hesitation.";
}

function technicalTasksForAction(action: string): string[] {
  const safeAction = customerSafeText(action);
  const text = safeAction.toLowerCase();
  const tasks = new Set<string>();
  if (/viewport|responsive/.test(text)) tasks.add("Improve viewport and responsive layout behavior.");
  if (/resource|speed|weight|load/.test(text)) tasks.add("Reduce resource weight and loading friction.");
  if (/mobile|tap|contact|cta|action path/.test(text)) tasks.add("Make mobile contact and primary action paths easier to reach.");
  if (/review|testimonial|proof|trust|credib/.test(text)) tasks.add("Add visible trust proof near high-intent decision points.");
  if (/faq|question|answer|pricing|cost|process/.test(text)) tasks.add("Add direct answers for pricing, process, objections, and decision-stage questions.");
  if (/schema|entity|citation|local|search|visibility/.test(text)) tasks.add("Strengthen entity, local, internal-linking, and structured visibility cues where supported by evidence.");
  tasks.add(safeAction);
  return Array.from(tasks).slice(0, 5);
}

function scoreForDimension(report: ReportSnapshot, key: string): number | null {
  const dimension = (report.dimensions ?? []).find((item) => item.key === key || item.label === key);
  return typeof dimension?.score === "number" && Number.isFinite(dimension.score) ? dimension.score : null;
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const scores = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function firstNullable(values: Array<number | null | undefined>): number | null {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function numberFromText(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function healthStatusForScore(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not Assessed";
  if (score >= 75) return "Strong";
  if (score >= 55) return "Moderate";
  return "Needs Improvement";
}

function detectBusinessType(report: ReportSnapshot): string {
  const declared = report.industryBenchmarkEngine?.industryType?.trim();
  if (declared && declared !== "general") return titleCase(declared.replaceAll("_", " "));
  const haystack = customerSearchText(report);
  const tests: Array<[string, string[]]> = [
    ["E-commerce Store", ["shopify", "woocommerce", "magento", "bigcommerce", "cart", "checkout", "product page", "shipping", "refund"]],
    ["Dental Clinic", ["dentist", "dental", "orthodont", "implant", "teeth"]],
    ["Law Firm", ["lawyer", "attorney", "legal", "law firm", "case evaluation"]],
    ["Real Estate Company", ["real estate", "property", "realtor", "listing", "homes for sale"]],
    ["Restaurant", ["restaurant", "menu", "reservation", "order online", "dining"]],
    ["SaaS Company", ["saas", "software", "platform", "subscription", "demo"]],
    ["Agency", ["agency", "marketing", "branding", "creative", "campaign"]],
    ["Healthcare Provider", ["clinic", "doctor", "healthcare", "appointment", "patient"]],
    ["Educational Institution", ["school", "course", "university", "academy", "training"]],
    ["Local Service Business", ["service area", "book now", "estimate", "repair", "installation"]]
  ];
  return tests.find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))?.[0] ?? "Business Website";
}

function hasCommerceSignals(report: ReportSnapshot): boolean {
  return ["shopify", "woocommerce", "magento", "bigcommerce", "cart", "checkout", "product", "refund", "shipping"].some((keyword) =>
    customerSearchText(report).includes(keyword)
  );
}

function customerSearchText(report: ReportSnapshot): string {
  const safeEvidenceItems = (report as unknown as { customerEvidenceItems?: Array<{ title?: string; meaning?: string }> }).customerEvidenceItems ?? [];
  const values = [
    report.targetUrl,
    report.industryBenchmarkEngine?.industryType,
    report.decisionSummary,
    ...(report.decisions ?? []).map((decision) => `${decision.category} ${decision.impactExplanation} ${decision.recommendedActionPath}`),
    ...safeEvidenceItems.map((item) => `${item.title ?? ""} ${item.meaning ?? ""}`),
    ...(report.recommendationEngine?.recommendations ?? []).map((recommendation) => `${recommendation.issue} ${recommendation.action}`)
  ];
  return values.join(" ").toLowerCase();
}

function businessReadinessLabel(score: number | null): string {
  if (score === null) return "Content unavailable";
  if (score >= 85) return "Ready to grow";
  if (score >= 70) return "Good foundation";
  if (score >= 50) return "Growth friction";
  return "High leakage risk";
}

function customerVerdict(score: number | null, weakest: ReportSnapshot["dimensions"][number] | undefined): string {
  if (score === null) return "Content could not be evaluated";
  if (score >= 85) return "The website is ready to convert more of the right visitors";
  if (score >= 70) return "The website is mostly ready, with a few growth leaks to close";
  if (score >= 50) return `${businessDimensionLabel(weakest?.label ?? "Customer Decision")} is creating avoidable growth friction`;
  return "Customers may lose confidence before taking action";
}

function customerVerdictExplanation(
  report: ReportSnapshot,
  weakest: ReportSnapshot["dimensions"][number] | undefined,
  strongest: ReportSnapshot["dimensions"][number] | undefined
): string {
  const pages = report.evidenceCoverageSummary?.totalPagesSampled ?? report.scanCoverage?.sampledPages ?? 0;
  const evidence = customerValidatedFindingCount(report);
  if (pages <= 0 || evidence <= 0) return "SYSTOLAB did not infer business impact because validated website evidence was unavailable.";
  const weak = weakest ? `${businessDimensionLabel(weakest.label)} is the main validated constraint` : "No single dominant constraint was validated";
  const strong = strongest ? `${businessDimensionLabel(strongest.label)} is the strongest current signal` : "validated strengths were limited";
  return `${weak}. ${strong}. This report translates those signals into customer decision impact using ${evidence} validated evidence item${evidence === 1 ? "" : "s"}.`;
}

function dedupeCustomerActions(report: ReportSnapshot): Array<{ action: string; reason: string; score: number; priority?: string }> {
  const candidates = [
    ...(report.recommendationEngine?.recommendations ?? []).map((recommendation) => ({
      action: customerSafeText(recommendation.action),
      reason: customerSafeText(recommendation.revenueIntelligenceMapping || recommendation.issue),
      score: recommendation.confidenceScore,
      priority: recommendation.priority
    })),
    ...(report.actionFirstPanel?.items ?? []).map((item) => ({
      action: customerSafeText(item.executableFix),
      reason: customerSafeText(item.businessReason),
      score: item.expectedDirectionalImpact?.conversionReadiness ? 75 : 65,
      priority: "THIS MONTH"
    })),
    ...(report.priorityTimeline?.fixNow ?? []).map((item) => ({
      action: customerSafeText(item.action),
      reason: `${item.structuralSeverity} severity with ${item.evidenceStrength} evidence.`,
      score: item.evidenceStrength === "High" ? 85 : item.evidenceStrength === "Moderate" ? 72 : 60,
      priority: item.category
    })),
    ...(report.priorityTimeline?.thisMonth ?? []).map((item) => ({
      action: customerSafeText(item.action),
      reason: `${item.structuralSeverity} severity with ${item.evidenceStrength} evidence.`,
      score: item.evidenceStrength === "High" ? 80 : item.evidenceStrength === "Moderate" ? 70 : 58,
      priority: item.category
    }))
  ];
  return dedupeBy(candidates.filter((item) => item.action.trim()), (item) => item.action);
}

function buildRevenueLeaks(
  report: ReportSnapshot,
  actions: Array<{ action: string; reason: string; score: number; priority?: string }>,
  competitorGaps: CustomerBusinessReport["competitorGaps"]
): CustomerBusinessReport["revenueLeaks"] {
  const action = actions[0]?.action ?? "Clarify the customer journey and call-to-action.";
  const dimensionLeaks = (report.dimensions ?? [])
    .filter((dimension) => dimension.score < 76)
    .sort((a, b) => a.score - b.score)
    .map((dimension) => {
      const label = businessDimensionLabel(dimension.label);
      return {
        title: leakTitleForDimension(dimension.key, label),
        issue: `${label} is at ${dimension.score}/100, which indicates avoidable decision friction.`,
        customerImpact: customerImpactForDimension(dimension.key),
        action,
        confidence: `${dimension.confidenceScore ?? 70}% confidence`
      };
    });

  const firstCompetitorGap = competitorGaps[0];
  const competitorLeak = firstCompetitorGap
    ? [{
        title: "Competitive Confidence Gap",
        issue: `${firstCompetitorGap.competitor} appears stronger in ${firstCompetitorGap.area}.`,
        customerImpact: "A visitor comparing options may feel safer choosing the competitor if this gap is visible.",
        action: actions.find((item) => item.action.toLowerCase().includes(firstCompetitorGap.area.toLowerCase()))?.action ?? action,
        confidence: "Directional competitor evidence"
      }]
    : [];

  return [...dimensionLeaks, ...competitorLeak].slice(0, 3);
}

function buildCustomerBusinessRisks(
  report: ReportSnapshot,
  actions: Array<{ action: string; reason: string; score: number; priority?: string }>
): CustomerBusinessReport["businessRisks"] {
  const action = actions[0]?.action ?? "Improve the weakest customer decision area first.";
  const dimensionRisks = (report.dimensions ?? [])
    .filter((dimension) => dimension.score < 76)
    .sort((a, b) => a.score - b.score)
    .map((dimension) => {
      const label = businessDimensionLabel(dimension.label);
      return {
        title: `${label} Risk`,
        risk: `${label} is currently ${dimension.classification.toLowerCase()} at ${dimension.score}/100.`,
        customerImpact: customerImpactForDimension(dimension.key),
        action,
        confidence: `${dimension.confidenceScore ?? 70}% confidence`
      };
    });

  const nativeRisks = nativeEvidence(report)
    .filter((evidence) => evidenceScore(evidence) < 60)
    .map((evidence) => ({
      title: customerSafeText(String(evidence.normalizedInput?.label ?? "Business Decision Gap")),
      risk: customerSafeText(evidence.rawValue),
      customerImpact: intelligenceMeaningForSignal(String(evidence.normalizedInput?.signalKey ?? "")),
      action: actionForNativeSignal(String(evidence.normalizedInput?.signalKey ?? "")),
      confidence: `${Math.round(evidence.groundTruthConfidence ?? 60)}% confidence`
    }));

  return dedupeBy([...dimensionRisks, ...nativeRisks], (item) => `${item.title}-${item.action}`).slice(0, 3);
}

function buildCustomerIntelligenceSummaries(report: ReportSnapshot): CustomerBusinessReport["intelligenceSummaries"] {
  const safeSummaries = (report as unknown as { customerIntelligenceSummaries?: CustomerBusinessReport["intelligenceSummaries"] }).customerIntelligenceSummaries;
  if (safeSummaries?.length) return safeSummaries.slice(0, 15);

  const signals = nativeEvidence(report);
  const summaries = [
    ...summaryForSignals(
      signals,
      "search",
      [
        "native_search_to_sale_support_score",
        "native_geo_ai_readiness_score",
        "native_seo_technical_foundation_score",
        "native_schema_coverage_score",
        "native_topic_authority_coverage_score",
        "native_search_demand_coverage_score",
        "native_serp_opportunity_readiness_score",
        "native_ranking_opportunity_priority_score",
        "native_entity_clarity_score",
        "native_citation_credibility_score",
        "native_local_visibility_opportunity_score",
        "native_content_freshness_score",
        "native_competitor_content_gap_score"
      ]
    ),
    ...summaryForSignals(signals, "questions", ["native_customer_question_coverage_score"]),
    ...summaryForSignals(signals, "confidence", ["native_decision_confidence_score"]),
    ...summaryForSignals(signals, "trustProof", ["native_trust_proof_coverage_score"]),
    ...summaryForSignals(signals, "journey", ["native_customer_journey_continuity_score"])
  ];
  return dedupeBy(summaries, (item) => `${item.section}-${item.title}`).slice(0, 15);
}

function summaryForSignals(
  evidenceObjects: ReportSnapshot["evidenceObjects"],
  section: CustomerBusinessReport["intelligenceSummaries"][number]["section"],
  signalKeys: string[]
): CustomerBusinessReport["intelligenceSummaries"] {
  return evidenceObjects
    .filter((evidence) => signalKeys.includes(String(evidence.normalizedInput?.signalKey ?? "")))
    .slice(0, 3)
    .map((evidence) => {
      const signalKey = String(evidence.normalizedInput?.signalKey ?? "");
      const score = evidenceScore(evidence);
      return {
        section,
        title: customerSafeText(String(evidence.normalizedInput?.label ?? evidence.sourceType)),
        status: score >= 75 ? "Strong support" : score >= 55 ? "Needs improvement" : "Coverage gap detected",
        meaning: intelligenceMeaningForSignal(signalKey),
        action: actionForNativeSignal(signalKey),
        confidence: `${Math.round(evidence.groundTruthConfidence ?? 60)}% evidence confidence`
      };
    });
}

function nativeEvidence(report: ReportSnapshot): ReportSnapshot["evidenceObjects"] {
  return (report.evidenceObjects ?? []).filter((evidence) => String(evidence.normalizedInput?.sourceModule ?? "").startsWith("systolab_"));
}

function evidenceScore(evidence: ReportSnapshot["evidenceObjects"][number]): number {
  const value = evidence.normalizedInput?.value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 100 : 0;
  return 0;
}

function intelligenceMeaningForSignal(signalKey: string): string {
  if (signalKey.includes("question_coverage")) return "Customers may still have unanswered questions before they feel ready to contact, book, or buy.";
  if (signalKey.includes("decision_confidence")) return "Visitors may understand the offer but hesitate because proof, clarity, reassurance, or transparency is incomplete.";
  if (signalKey.includes("trust_proof")) return "Weak proof can make customers delay decisions or compare competitors with stronger credibility signals.";
  if (signalKey.includes("journey")) return "The path from discovery to action may contain friction that interrupts confidence before conversion.";
  if (signalKey.includes("topic_authority")) return "Customers may be unable to find enough helpful service information to build confidence before contacting the business.";
  if (signalKey.includes("search_demand")) return "Customer demand may exist around services, questions, comparisons, timing, or trust topics that the current website does not cover strongly enough.";
  if (signalKey.includes("serp")) return "Search-result presentation opportunities may be missed when answer formats, local cues, reviews, visuals, or comparison support are incomplete.";
  if (signalKey.includes("ranking_opportunity")) return "Visibility opportunities should be prioritized by evidence strength, customer relevance, trust gaps, and business impact rather than ranking promises.";
  if (signalKey.includes("local_visibility")) return "Local customers may need clearer location, availability, service-area, contact, and credibility signals before choosing the business.";
  if (signalKey.includes("entity_clarity")) return "Customers and search systems may need clearer signals about the business, services, locations, people, and expertise.";
  if (signalKey.includes("citation")) return "Discoverability and credibility may be stronger when the business has clearer reputation, association, listing, and authority signals.";
  if (signalKey.includes("freshness")) return "Older or stale content can make customers question whether the offer, service, or information is still current.";
  if (signalKey.includes("competitor_content_gap")) return "A competitor appears to give customers stronger supporting information in an area that affects comparison decisions.";
  if (signalKey.includes("geo") || signalKey.includes("search_to_sale") || signalKey.includes("seo") || signalKey.includes("schema")) return "Search demand may not be fully connected to clear answers, entity clarity, and conversion support.";
  if (signalKey.includes("local")) return "Local customers may need stronger location, availability, service-area, and contact reassurance.";
  if (signalKey.includes("ecommerce")) return "Purchase decisions may need stronger product, shipping, return, payment, review, and support confidence.";
  return "This evidence affects customer confidence, clarity, trust, or action readiness.";
}

function actionForNativeSignal(signalKey: string): string {
  if (signalKey.includes("question_coverage")) return "Add direct answers for pricing, process, comparison, objection, trust, and decision-stage questions.";
  if (signalKey.includes("decision_confidence")) return "Add clearer proof, policies, pricing cues, process steps, reassurance, and next-step guidance.";
  if (signalKey.includes("trust_proof")) return "Add testimonials, reviews, certifications, portfolio proof, case studies, awards, or client credibility signals.";
  if (signalKey.includes("journey")) return "Reduce navigation friction and make trust cues, key content, and CTAs visible along the path to action.";
  if (signalKey.includes("topic_authority")) return "Build stronger educational pages, service guides, supporting resources, and answers around the topics customers need before deciding.";
  if (signalKey.includes("search_demand")) return "Add content for uncovered demand topics, service/product needs, comparison questions, local intent, reputation concerns, and seasonal or timing needs.";
  if (signalKey.includes("serp")) return "Structure key pages with direct answers, FAQ-style sections, review proof, visual support, comparison context, and clear local/entity cues.";
  if (signalKey.includes("ranking_opportunity")) return "Prioritize low-effort, medium-term, and strategic visibility improvements that also strengthen trust, clarity, and conversion readiness.";
  if (signalKey.includes("local_visibility")) return "Clarify phone, address, opening hours, service area, appointments, directions, and local credibility.";
  if (signalKey.includes("entity_clarity")) return "Clarify business identity, service names, product/service relationships, team expertise, locations, and structured entity signals.";
  if (signalKey.includes("citation")) return "Strengthen reputation, association, directory, listing, partner, and authority references where they support business credibility.";
  if (signalKey.includes("freshness")) return "Update outdated pages, refresh service information, remove expired offers, and add current dates or reviewed content where useful.";
  if (signalKey.includes("competitor_content_gap")) return "Close the competitor information gap by adding stronger educational, proof, transparency, or decision-support content.";
  if (signalKey.includes("geo")) return "Create self-contained answer blocks, clear entities, topical sections, and citation-friendly explanations.";
  if (signalKey.includes("search_to_sale")) return "Connect search-intent content to proof, offer clarity, and a visible conversion path.";
  if (signalKey.includes("seo") || signalKey.includes("schema")) return "Improve metadata, headings, canonical/indexability signals, internal links, schema, and foundational page structure.";
  if (signalKey.includes("local")) return "Clarify phone, address, opening hours, service area, appointments, directions, and local credibility.";
  if (signalKey.includes("ecommerce")) return "Strengthen product proof, reviews, checkout clarity, shipping, returns, secure payment, and support reassurance.";
  return "Improve the supporting content and proof around this customer decision area.";
}

function buildCustomerPsychology(report: ReportSnapshot): CustomerBusinessReport["psychology"] {
  const scoreFor = (key: string) => report.dimensions?.find((dimension) => dimension.key === key)?.score;
  const trust = scoreFor("trust");
  const clarity = scoreFor("informationClarity");
  const conversion = scoreFor("conversionReadiness");
  const mobile = scoreFor("mobileExperience");
  return [
    {
      label: "Perceived Trust",
      reading: psychologyReading(trust, "Strong trust cues", "Trust still needs reinforcement", "Visitors may hesitate before believing the offer"),
      businessMeaning: "Trust affects whether a visitor feels safe enough to call, submit a form, book, or buy."
    },
    {
      label: "Decision Clarity",
      reading: psychologyReading(clarity, "The page direction is reasonably clear", "Some visitors may need more explanation", "Visitors may feel unsure what this business does or why it matters"),
      businessMeaning: "Clarity reduces confusion and helps visitors understand the next best step quickly."
    },
    {
      label: "Motivation To Act",
      reading: psychologyReading(conversion, "The action path is visible", "The next step can be stronger", "Visitors may leave without taking action"),
      businessMeaning: "Conversion readiness determines whether interest turns into a lead, booking, quote request, or sale."
    },
    {
      label: "Mobile Confidence",
      reading: psychologyReading(mobile, "Mobile visitors should be able to move forward", "Mobile friction may slow decisions", "Phone users may abandon before reaching the offer"),
      businessMeaning: "Many customers decide on mobile first, so small-screen friction directly affects lead and purchase opportunities."
    }
  ];
}

function buildBusinessImpactSummary(
  report: ReportSnapshot,
  leaks: CustomerBusinessReport["revenueLeaks"],
  gaps: CustomerBusinessReport["competitorGaps"]
): string[] {
  const summary = [
    leaks[0]?.customerImpact ?? "The current evidence did not validate a major revenue leak.",
    report.revenueIntelligence?.revenueOpportunityRange?.label
      ? `${opportunityLabel(report.revenueIntelligence.revenueOpportunityRange.label)} is directional guidance, not a guaranteed financial forecast.`
      : "Revenue opportunity is shown only when supported by validated current-scan evidence.",
    gaps.length > 0
      ? "Competitor gaps show where a comparison-shopping customer may see stronger trust, clarity, or confidence elsewhere."
      : "Competitor impact was not concluded because validated competitor evidence was unavailable."
  ];
  return dedupeBy(summary.map(customerSafeText), (item) => item);
}

function buildCustomerCompetitorGaps(report: ReportSnapshot): CustomerBusinessReport["competitorGaps"] {
  return (report.competitorComparison ?? [])
    .flatMap((comparison) =>
      (comparison.evidenceTraceabilityMap ?? [])
        .filter((row) => row.position === "primary_weaker")
        .map((row) => ({
          competitor: comparison.competitorLabel || safeHostLabel(comparison.competitorUrl),
          area: businessDimensionLabel(row.dimensionLabel),
          position: "Competitor appears stronger",
          decisionImpact: `${businessDimensionLabel(row.dimensionLabel)} can influence whether a visitor feels more confident choosing one business over another.`
        }))
    )
    .slice(0, 5);
}

function buildCommerceSignals(report: ReportSnapshot): CustomerBusinessReport["commerceSignals"] {
  const text = customerSearchText(report);
  const conversion = report.dimensions?.find((dimension) => dimension.key === "conversionReadiness")?.score ?? 0;
  const trust = report.dimensions?.find((dimension) => dimension.key === "trust")?.score ?? 0;
  return [
    {
      label: "Product Confidence",
      status: text.includes("review") || text.includes("testimonial") ? "Social proof visible" : "Review and proof signals need review",
      action: "Show product proof, ratings, testimonials, or trust cues close to purchase decisions."
    },
    {
      label: "Checkout Friction",
      status: conversion >= 75 ? "Purchase path appears stronger" : "Purchase path may need clearer next steps",
      action: "Make add-to-cart, checkout, pricing, and delivery expectations easy to understand."
    },
    {
      label: "Refund And Shipping Confidence",
      status: text.includes("shipping") || text.includes("refund") || text.includes("return") ? "Policy cues detected" : "Policy reassurance not clearly detected",
      action: "Place shipping, return, refund, and support reassurance near product and checkout decisions."
    },
    {
      label: "Trust Badges",
      status: trust >= 75 ? "Trust foundation is usable" : "Trust reinforcement should be stronger",
      action: "Add payment security, guarantees, support, review, and business credibility signals where purchase anxiety happens."
    }
  ];
}

function buildVisualSummary(report: ReportSnapshot): CustomerBusinessReport["visualSummary"] {
  const visualEvidence = getVisualEvidence(report);
  const screenshotCount = visualEvidence.filter((evidence) => Boolean(evidence.screenshotRef)).length;
  if (screenshotCount > 0) {
    return {
      status: "Screenshot-linked evidence available",
      confidence: `${visualEvidence.length} visual signal${visualEvidence.length === 1 ? "" : "s"}`,
      detail: "SYSTOLAB found customer-facing page evidence connected to visual placement, visibility, or rendered content."
    };
  }
  if (visualEvidence.length > 0) {
    return {
      status: "Visual placement evidence available",
      confidence: `${visualEvidence.length} visual signal${visualEvidence.length === 1 ? "" : "s"}`,
      detail: "SYSTOLAB validated page visibility conditions, but screenshot evidence is not available in this customer report."
    };
  }
  return {
    status: "Visual evidence limited",
    confidence: "Limited visual confidence",
    detail: "SYSTOLAB did not validate screenshot-level placement in this scan, so visual conclusions are limited to the collected website evidence."
  };
}

function buildVisualMarkers(report: ReportSnapshot): CustomerBusinessReport["visualMarkers"] {
  const visualEvidence = getVisualEvidence(report);
  if (visualEvidence.length === 0) {
    return [{
      label: "Attention Path",
      status: "Visual placement not validated",
      decisionImpact: "SYSTOLAB did not infer above-fold attention flow because visual evidence was unavailable.",
      action: "Run a full scan with visual rendering enabled before making layout-specific conclusions.",
      confidence: "Limited evidence"
    }];
  }
  return dedupeBy(
    visualEvidence.map((evidence) => {
      const dimension = businessDimensionLabel(String(evidence.dimensionRefs?.[0] ?? evidence.normalizedInput?.signalKey ?? "Customer Decision"));
      const visibility = String(evidence.renderVisibility ?? (evidence.screenshotRef ? "visible_above_fold" : "not_applicable"));
      return {
        label: dimension,
        status: visualVisibilityLabel(visibility),
        decisionImpact: visualDecisionImpact(visibility, dimension),
        action: visualActionForDimension(dimension),
        confidence: `${Math.max(0, Math.min(100, Math.round(evidence.groundTruthConfidence ?? 60)))}% confidence`
      };
    }),
    (marker) => `${marker.label}-${marker.status}`
  ).slice(0, 4);
}

function getVisualEvidence(report: ReportSnapshot): ReportSnapshot["evidenceObjects"] {
  return (report.evidenceObjects ?? []).filter((evidence) =>
    Boolean(evidence.renderVisibility) ||
    Boolean(evidence.screenshotRef) ||
    evidence.validationMethod === "headless_render_verification" ||
    evidence.sourceType === "render"
  );
}

function visualVisibilityLabel(visibility: string): string {
  if (visibility === "visible_above_fold") return "Visible in the first decision area";
  if (visibility === "visible_below_fold") return "Visible after scrolling";
  if (visibility === "hidden") return "Not clearly visible";
  if (visibility === "dynamically_injected") return "Appears after page behavior";
  if (visibility === "not_rendered") return "Not visually rendered";
  return "Visual placement available";
}

function visualDecisionImpact(visibility: string, dimension: string): string {
  if (visibility === "visible_above_fold") return `${dimension} is supported early enough to help visitors decide with less friction.`;
  if (visibility === "visible_below_fold") return `${dimension} may reach only visitors who scroll, which can weaken early confidence.`;
  if (visibility === "hidden") return `${dimension} may not be seen when customers are deciding whether to trust or act.`;
  if (visibility === "dynamically_injected") return `${dimension} depends on page behavior, so some visitors may miss it on slow or interrupted sessions.`;
  if (visibility === "not_rendered") return `${dimension} could not be visually confirmed in the rendered page state.`;
  return `${dimension} has visual evidence, but placement strength should be reviewed in the live page experience.`;
}

function visualActionForDimension(dimension: string): string {
  const normalized = dimension.toLowerCase();
  if (normalized.includes("trust")) return "Place proof, reviews, guarantees, or credentials near the moment customers decide.";
  if (normalized.includes("conversion")) return "Make the primary next step visible before secondary content competes for attention.";
  if (normalized.includes("message") || normalized.includes("clarity")) return "Keep the offer, audience, and next action clear in the first visible page area.";
  if (normalized.includes("mobile")) return "Review the mobile first screen for readable content, spacing, and accessible action buttons.";
  return "Review the first visible page area and move the strongest decision cues closer to the customer action path.";
}

function buildCustomerEvidenceItems(report: ReportSnapshot): CustomerBusinessReport["evidenceItems"] {
  const safeRows = (report as unknown as { customerEvidenceItems?: Array<{ title?: string; confidence?: string; meaning?: string }> }).customerEvidenceItems;
  if (safeRows?.length) {
    return safeRows.slice(0, 18).map((item, index) => ({
      id: `finding-${index + 1}`,
      title: customerSafeText(item.title ?? "Validated Website Finding"),
      confidence: customerSafeText(item.confidence ?? "Evidence-bound"),
      meaning: customerSafeText(item.meaning ?? "Validated website evidence supports this finding.")
    }));
  }

  const databaseRows = (report.evidenceDatabase ?? []).map((evidence) => ({
    id: evidence.evidenceId,
    title: customerSafeText(evidence.issue),
    confidence: `${evidence.confidenceScore}%`,
    meaning: customerSafeText(evidence.confidenceReason)
  }));
  const fallbackRows = (report.evidenceObjects ?? []).slice(0, 12).map((evidence) => ({
    id: evidence.evidenceId,
    title: businessDimensionLabel(String(evidence.normalizedInput?.signalKey ?? evidence.sourceType)),
    confidence: `${evidence.groundTruthConfidence}%`,
    meaning: customerSafeText(evidence.groundTruthMeaning ?? evidence.confidenceBasis ?? "Validated website evidence supports this finding.")
  }));
  return dedupeBy([...databaseRows, ...fallbackRows], (item) => item.id).slice(0, 18);
}

function customerValidatedFindingCount(report: ReportSnapshot): number {
  const coverage = report.evidenceCoverageSummary as unknown as { totalEvidenceObjects?: number; totalValidatedFindings?: number } | undefined;
  const safeRows = (report as unknown as { customerEvidenceItems?: unknown[] }).customerEvidenceItems;
  return coverage?.totalValidatedFindings ?? coverage?.totalEvidenceObjects ?? safeRows?.length ?? report.evidenceObjects?.length ?? 0;
}

function customerEvidenceStrengthLabel(report: ReportSnapshot): string {
  const sampledPages = report.evidenceCoverageSummary?.totalPagesSampled ?? report.scanCoverage?.sampledPages ?? 0;
  const validatedFindings = customerValidatedFindingCount(report);
  if (sampledPages <= 0 || validatedFindings <= 0) return "Very limited";
  if (sampledPages < 2 || validatedFindings < 4) return "Limited";
  if (validatedFindings < 10) return "Moderate";
  return "Strong";
}
function averageConfidence(report: ReportSnapshot): number {
  const scores = [report.confidenceEngine?.overallConfidenceScore, ...(report.confidenceLayer ?? []).map((item) => item.confidenceScore)].filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return 60;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function businessDimensionLabel(label: string): string {
  return customerSafeText(label)
    .replace(/Rendering Quality/gi, "Content Visibility")
    .replace(/Visibility Structure/gi, "Discovery Structure")
    .replace(/Website Health/gi, "Business Website Health")
    .replace(/Conversion Readiness/gi, "Conversion Readiness")
    .replace(/Information Clarity/gi, "Message Clarity")
    .replace(/Mobile Experience/gi, "Mobile Experience");
}

function leakTitleForDimension(key: string, fallback: string): string {
  const titles: Record<string, string> = {
    trust: "Customer Confidence Gap",
    conversionReadiness: "Conversion Friction Point",
    informationClarity: "Message Clarity Leak",
    mobileExperience: "Mobile Decision Friction",
    visibilityStructure: "Discovery Opportunity",
    websiteHealth: "Website Reliability Concern",
    renderingQuality: "Content Visibility Risk",
    stability: "Access Reliability Risk"
  };
  return titles[key] ?? `${fallback} Opportunity`;
}

function customerImpactForDimension(key: string): string {
  const impacts: Record<string, string> = {
    trust: "Visitors may question credibility before contacting, booking, or buying.",
    conversionReadiness: "Interested visitors may not see a clear next step and leave without converting.",
    informationClarity: "Visitors may need extra effort to understand the offer, which increases drop-off risk.",
    mobileExperience: "Phone users may struggle to move forward at the exact moment they are ready to act.",
    visibilityStructure: "Customers may not find or understand the most important pages quickly enough.",
    websiteHealth: "Reliability gaps can make the business feel less established or less safe.",
    renderingQuality: "Important content may not be visible early enough for visitors to keep engaging.",
    stability: "Access friction can interrupt customer momentum before trust is built."
  };
  return impacts[key] ?? "This gap may reduce customer confidence during the decision process.";
}

function psychologyReading(score: number | undefined, high: string, medium: string, low: string): string {
  if (score === undefined) return "Insufficient evidence to judge";
  if (score >= 76) return high;
  if (score >= 56) return medium;
  return low;
}

function priorityToBusinessWindow(priority: string): string {
  if (priority === "FIX NOW") return "Fix this week";
  if (priority === "THIS MONTH") return "Improve this month";
  if (priority === "MONITOR") return "Monitor after priority fixes";
  return customerSafeText(priority);
}

function opportunityLabel(label: string): string {
  return customerSafeText(label)
    .replace(/Monthly Value Units/gi, "Revenue Leak Opportunity")
    .replace(/Value Units/gi, "Opportunity Units")
    .replace(/Opportunity Cost/gi, "Lost Opportunity Area");
}

function customerSafeText(value: unknown): string {
  return String(value ?? "Not Available")
    .replace(/\bEO-[A-Za-z0-9-]+/g, "validated finding")
    .replace(/\bEV-[A-Za-z0-9-]+/g, "validated finding")
    .replace(/\bREC-[A-Za-z0-9-]+/g, "recommendation")
    .replace(/\bTRACE-[A-Za-z0-9-]+/gi, "internal reference")
    .replace(/\bOSS\b/g, "Business Readiness Score")
    .replace(/Operational Site Score/gi, "Business Readiness Score")
    .replace(/Global Output Contract/gi, "Business Decision Summary")
    .replace(/Action Plan Mapping/gi, "Priority Action Summary")
    .replace(/canonical issue ids?/gi, "business decision references")
    .replace(/canonical issues?/gi, "business decisions")
    .replace(/canonical/gi, "business")
    .replace(/dependency intelligence/gi, "fix-order guidance")
    .replace(/dependency chains?/gi, "issue connections")
    .replace(/dependencies/gi, "fix-order relationships")
    .replace(/attribution/gi, "business impact link")
    .replace(/robots\.txt|robots/gi, "website access rules")
    .replace(/crawler|crawl/gi, "content collection")
    .replace(/parser|parsing/gi, "content analysis")
    .replace(/\bHTTP\b/gi, "website access")
    .replace(/\bDOM\b/gi, "page structure")
    .replace(/Monthly Value Units/gi, "Revenue Leak Opportunity")
    .replace(/\bEO\b/g, "Evidence")
    .replace(/evidence objects?/gi, "validated findings")
    .replace(/\bGTCS\b/g, "Evidence Confidence")
    .replace(/\bGBP\b/g, "Business Profile")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function InternalReportView({ report, coverage, audience = "customer" }: { report: ReportSnapshot; coverage: SpecCoverageItem[]; audience?: "customer" | "internal" }) {
  const style = {
    "--brand": report.tenantBranding?.primaryColor,
    "--accent": report.tenantBranding?.accentColor
  } as CSSProperties;

  if (audience === "customer" && isContentUnavailableReport(report)) {
    return <ContentUnavailableReportView report={report} style={style} />;
  }

  if (audience === "customer") {
    return <CustomerBusinessReportView report={report} style={style} />;
  }

  return <FullReportDetailsView report={report} coverage={coverage} audience={audience} style={style} />;
}

function FullReportDetailsView({
  report,
  coverage,
  audience,
  style
}: {
  report: ReportSnapshot;
  coverage: SpecCoverageItem[];
  audience: "customer" | "internal";
  style: CSSProperties;
}) {
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
          <Metric label="Robots" value={report.scanCoverage?.robotsTxtStatus} />
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
      <GroundTruthValidationLog report={report} />
      <MonitoringAndAlerts report={report} />
      <OperationalMemory report={report} />
      <BusinessEvolution report={report} />
      <BusinessDna report={report} />
      <EditIntelligence report={report} />
      <EvidenceExplorer report={report} />
      <Telemetry report={report} />
      <ArchitectureState report={report} />
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

// Revenue Risk & Business Impact Assessment

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
            <strong>{revenue.revenueOpportunityRange?.low} - {revenue.revenueOpportunityRange?.high}</strong>
            <em>{revenue.revenueOpportunityRange?.unit?.replaceAll("_", " ")}</em>
            <p>{revenue.revenueOpportunityRange?.label}</p>
          </div>
          <div className="opportunity-estimate-card">
            <span>Conversion Potential</span>
            <strong>{revenue.conversionPotentialRange?.low} - {revenue.conversionPotentialRange?.high}</strong>
            <em>{revenue.conversionPotentialRange?.unit?.replaceAll("_", " ")}</em>
            <p>{revenue.conversionPotentialRange?.label}</p>
          </div>
          <div className="opportunity-estimate-card">
            <span>Opportunity Cost Range</span>
            <strong>{revenue.opportunityCostRange?.low} - {revenue.opportunityCostRange?.high}</strong>
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
            <em>0-7 Days</em>
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
            <em>1-4 Weeks</em>
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
            <em>1-3 Months</em>
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
      firstAction: "Review website access and security settings before re-running the assessment.",
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
      recommendedNextAction: "Review access/security settings and re-run scan."
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
