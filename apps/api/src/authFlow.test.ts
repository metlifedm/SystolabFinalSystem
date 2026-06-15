import { describe, expect, it } from "vitest";
import { sha256 } from "./utils/crypto.js";
import {
  _memAuthSessionsForTest,
  getUserByAccessToken,
  listSessions,
  logout,
  passwordLogin,
  registerPassword,
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
  const code = reg.otpChallenge.simulatedDelivery.code!;
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
    expect(reg.otpChallenge.simulatedDelivery.code).toBeTruthy();
    expect(reg.otpChallenge.simulatedDelivery.mode).toBe("backend_simulation");
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
