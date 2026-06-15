import { describe, expect, it } from "vitest";
import { sha256 } from "./utils/crypto.js";
import {
  getUserByAccessToken,
  passwordLogin,
  registerPassword,
  verifyOtp
} from "./services/authService.js";

type AuthCtx = Parameters<typeof registerPassword>[1];

function ctx(seed: string): AuthCtx {
  return {
    ipHash: sha256(`abuse-ip-${seed}`),
    deviceFingerprintHash: sha256(`abuse-fp-${seed}`),
    deviceId: `abuse-dev-${seed}`,
    deviceLabel: "Abuse Test",
    userAgent: "vitest/abuse"
  };
}

async function createVerifiedUser(email: string, seed: string) {
  const c = ctx(seed);
  const reg = await registerPassword(
    { identifierType: "email", identifier: email, password: "Secure!Pass1234", displayName: "Abuse Test" },
    c
  );
  const code = reg.otpChallenge.simulatedDelivery.code!;
  const verified = await verifyOtp({ challengeId: reg.otpChallenge.challengeId, code }, c);
  return { tokens: verified.tokens!, userId: verified.user.userId };
}

function tamperPayload(token: string): string {
  const [header, body, sig] = token.split(".");
  // Decode, mutate sub claim, re-encode — signature will no longer match
  const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
  decoded["sub"] = "tampered_user_id";
  const newBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  return `${header}.${newBody}.${sig}`;
}

function truncateToken(token: string): string {
  return token.slice(0, token.length - 10);
}

describe("auth abuse — token integrity", () => {
  it("rejects a token with a tampered payload (HMAC mismatch)", async () => {
    const { tokens } = await createVerifiedUser("tamper@example.com", "tamper1");
    const tampered = tamperPayload(tokens.accessToken);
    await expect(getUserByAccessToken(tampered)).rejects.toThrow();
  });

  it("rejects a token with a truncated signature", async () => {
    const { tokens } = await createVerifiedUser("truncate@example.com", "trunc1");
    await expect(getUserByAccessToken(truncateToken(tokens.accessToken))).rejects.toThrow();
  });

  it("rejects a completely fabricated token string", async () => {
    await expect(getUserByAccessToken("this.is.not.a.real.token")).rejects.toThrow();
  });

  it("rejects an empty token", async () => {
    await expect(getUserByAccessToken("")).rejects.toThrow();
  });

  it("rejects a token with only two segments (missing signature)", async () => {
    await expect(getUserByAccessToken("header.payload")).rejects.toThrow();
  });

  it("rejects a refresh token used as an access token", async () => {
    const { tokens } = await createVerifiedUser("wrong-type@example.com", "wt1");
    // Refresh tokens are not base64url JWTs — they're sessionId.randomHex
    await expect(getUserByAccessToken(tokens.refreshToken)).rejects.toThrow();
  });
});

describe("auth abuse — brute-force and lockout", () => {
  it("locks the account after 3 consecutive wrong-password attempts", async () => {
    const email = `lockout-${Date.now()}@example.com`;
    await createVerifiedUser(email, `lockout-${Date.now()}`);

    // Each wrong attempt uses a different IP to avoid IP throttle, but same user account
    for (let i = 0; i < 3; i++) {
      await expect(
        passwordLogin(
          { identifierType: "email", identifier: email, password: "WrongPassword!" },
          ctx(`lockout-ip-${i}-${Date.now()}`)
        )
      ).rejects.toThrow();
    }

    // 4th attempt — account should now be locked
    const loginResult = passwordLogin(
      { identifierType: "email", identifier: email, password: "Secure!Pass1234" },
      ctx(`lockout-after-${Date.now()}`)
    );
    await expect(loginResult).rejects.toThrow();
  });

  it("rejects login with wrong password immediately", async () => {
    const email = `wrong-pw-${Date.now()}@example.com`;
    await createVerifiedUser(email, `wp-${Date.now()}`);
    await expect(
      passwordLogin(
        { identifierType: "email", identifier: email, password: "DefinitelyWrong!" },
        ctx(`wp-ctx-${Date.now()}`)
      )
    ).rejects.toThrow("Invalid login credentials");
  });

  it("rejects login for a non-existent account", async () => {
    await expect(
      passwordLogin(
        { identifierType: "email", identifier: "nobody@notexist.example.com", password: "Any!Password123" },
        ctx(`nouser-${Date.now()}`)
      )
    ).rejects.toThrow("Invalid login credentials");
  });

  it("rejects OTP verification with an invalid code", async () => {
    const c = ctx(`bad-otp-${Date.now()}`);
    const reg = await registerPassword(
      { identifierType: "email", identifier: `bad-otp-${Date.now()}@example.com`, password: "Secure!Pass1234", displayName: "Bad OTP" },
      c
    );
    await expect(
      verifyOtp({ challengeId: reg.otpChallenge.challengeId, code: "000000" }, c)
    ).rejects.toThrow();
  });

  it("rejects OTP verification with the correct code used twice (replay attack)", async () => {
    const c = ctx(`replay-${Date.now()}`);
    const reg = await registerPassword(
      { identifierType: "email", identifier: `replay-${Date.now()}@example.com`, password: "Secure!Pass1234", displayName: "Replay" },
      c
    );
    const code = reg.otpChallenge.simulatedDelivery.code!;
    // First use — succeeds
    await verifyOtp({ challengeId: reg.otpChallenge.challengeId, code }, c);
    // Second use — replay
    await expect(verifyOtp({ challengeId: reg.otpChallenge.challengeId, code }, c)).rejects.toThrow();
  });
});
