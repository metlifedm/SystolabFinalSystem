import { describe, expect, it } from "vitest";
import { sha256 } from "./utils/crypto.js";
import {
  _memAuthSessionsForTest,
  forgotPassword,
  getDevelopmentAuthSnapshot,
  getUserByAccessToken,
  listSessions,
  logout,
  passwordLogin,
  registerPassword,
  resetPassword,
  refreshSession,
  verifyOtp
} from "./services/authService.js";

type AuthCtx = Parameters<typeof registerPassword>[1];

function ctx(seed: string): AuthCtx {
  return {
    ipHash: sha256(`ip-${seed}`),
    deviceFingerprintHash: sha256(`fp-${seed}`),
    deviceId: `dev-${seed}`,
    deviceLabel: "Test Browser",
    userAgent: "vitest/1.0"
  };
}

// Helper: register + verify OTP → returns token pair
async function createVerifiedUser(email: string, password: string, seed: string) {
  const c = ctx(seed);
  const reg = await registerPassword(
    { identifierType: "email", identifier: email, password, displayName: "Test User" },
    c
  );
  const code = reg.otpChallenge.delivery.previewCode!;
  const verified = await verifyOtp({ challengeId: reg.otpChallenge.challengeId, code }, c);
  return { tokens: verified.tokens!, userId: verified.user.userId, ctx: c };
}

describe("auth — registration and login flow", () => {
  it("registers a new user and returns a simulated OTP code", async () => {
    const reg = await registerPassword(
      { identifierType: "email", identifier: "reg-test@example.com", password: "Secure!Pass1234", displayName: "Reg Test" },
      ctx("reg")
    );
    expect(reg.user.email).toBe("reg-test@example.com");
    expect(reg.otpChallenge.challengeId).toBeTruthy();
    expect(reg.otpChallenge.delivery.previewCode).toBeTruthy();
    expect(reg.otpChallenge.delivery.channel).toBe("development_preview");
    expect(getDevelopmentAuthSnapshot().users.some((user) => user.userId === reg.user.userId)).toBe(true);
  });

  it("verifying OTP issues a signed access token and refresh token", async () => {
    const { tokens } = await createVerifiedUser("otp-verify@example.com", "Secure!Pass1234", "otp1");
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.accessTokenExpiresAt).toBeTruthy();
  });

  it("getUserByAccessToken resolves the user from a valid access token", async () => {
    const { tokens, userId } = await createVerifiedUser("get-user@example.com", "Secure!Pass1234", "gu1");
    const { user } = await getUserByAccessToken(tokens.accessToken);
    expect(user.id).toBe(userId);
  });

  it("passwordLogin succeeds for a verified user with correct credentials", async () => {
    await createVerifiedUser("pw-login@example.com", "Secure!Pass1234", "pwl1");
    const result = await passwordLogin(
      { identifierType: "email", identifier: "pw-login@example.com", password: "Secure!Pass1234" },
      ctx("pwl1b")
    );
    expect(result.tokens).toBeTruthy();
    expect(result.user.email).toBe("pw-login@example.com");
  });

  it("does not let signup overwrite an existing account password", async () => {
    const email = `duplicate-${Date.now()}@example.com`;
    const originalPassword = "Original!Pass1234";
    await createVerifiedUser(email, originalPassword, `duplicate-${Date.now()}`);

    await expect(registerPassword(
      { identifierType: "email", identifier: email, password: "Attacker!Pass1234", displayName: "Duplicate" },
      ctx(`duplicate-attempt-${Date.now()}`)
    )).rejects.toThrow("account already exists");

    const login = await passwordLogin(
      { identifierType: "email", identifier: email, password: originalPassword },
      ctx(`duplicate-login-${Date.now()}`)
    );
    expect(login.tokens?.accessToken).toBeTruthy();
  });

  it("lets an unverified signup restart verification without creating a duplicate account", async () => {
    const email = `pending-${Date.now()}@example.com`;
    const first = await registerPassword(
      { identifierType: "email", identifier: email, password: "First!Pass1234", displayName: "Pending User" },
      ctx(`pending-first-${Date.now()}`)
    );
    const restarted = await registerPassword(
      { identifierType: "email", identifier: email, password: "Second!Pass1234", displayName: "Pending User" },
      ctx(`pending-second-${Date.now()}`)
    );

    expect(restarted.user.userId).toBe(first.user.userId);
    expect(restarted.message).toContain("verification restarted");
    await verifyOtp(
      { challengeId: restarted.otpChallenge.challengeId, code: restarted.otpChallenge.delivery.previewCode! },
      ctx(`pending-verify-${Date.now()}`)
    );
    const login = await passwordLogin(
      { identifierType: "email", identifier: email, password: "Second!Pass1234" },
      ctx(`pending-login-${Date.now()}`)
    );
    expect(login.tokens?.accessToken).toBeTruthy();
  });

  it("completes the self-contained password reset flow without MongoDB", async () => {
    const email = `reset-${Date.now()}@example.com`;
    await createVerifiedUser(email, "Before!Pass1234", `reset-user-${Date.now()}`);
    const reset = await forgotPassword(
      { identifierType: "email", identifier: email },
      ctx(`reset-request-${Date.now()}`)
    );

    expect(reset.delivery.previewCode).toBeTruthy();
    await resetPassword(
      { resetId: reset.resetId, token: reset.delivery.previewCode!, newPassword: "After!Pass1234" },
      ctx(`reset-complete-${Date.now()}`)
    );
    const login = await passwordLogin(
      { identifierType: "email", identifier: email, password: "After!Pass1234" },
      ctx(`reset-login-${Date.now()}`)
    );
    expect(login.tokens?.accessToken).toBeTruthy();
  });

  it("listSessions returns at least the session created on login", async () => {
    const { userId } = await createVerifiedUser("sessions@example.com", "Secure!Pass1234", "ses1");
    const sessions = await listSessions(userId);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.every((s) => typeof s.sessionId === "string")).toBe(true);
  });

  it("logout invalidates the session so the access token can no longer be used", async () => {
    const { tokens, userId } = await createVerifiedUser("logout@example.com", "Secure!Pass1234", "lo1");
    const { session } = await getUserByAccessToken(tokens.accessToken);

    await logout({ refreshToken: tokens.refreshToken }, ctx("lo1"), userId);

    await expect(getUserByAccessToken(tokens.accessToken)).rejects.toThrow();
  });

  it("refreshSession issues a new access token", async () => {
    const { tokens } = await createVerifiedUser("refresh@example.com", "Secure!Pass1234", "ref1");
    const refreshed = await refreshSession({ refreshToken: tokens.refreshToken }, ctx("ref1"));
    expect(refreshed.tokens?.accessToken).toBeTruthy();
    expect(refreshed.tokens?.accessToken).not.toBe(tokens.accessToken);
  });
});

describe("auth — session expiry", () => {
  it("rejects an access token whose session has expired in the database", async () => {
    const { tokens, userId } = await createVerifiedUser("expired@example.com", "Secure!Pass1234", "exp1");
    const sessions = await listSessions(userId);
    const sessionId = sessions[0]!.sessionId;

    // Expire the session directly in the in-memory store
    const memSess = _memAuthSessionsForTest.get(sessionId);
    if (memSess) memSess.expiresAt = new Date(Date.now() - 1000);

    await expect(getUserByAccessToken(tokens.accessToken)).rejects.toThrow();
  });
});
