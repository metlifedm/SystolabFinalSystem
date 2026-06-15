import {
  createHmac,
  createPublicKey,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey as CryptoJsonWebKey
} from "node:crypto";
import { getFirebaseAuth } from "../lib/firebaseAdmin.js";
import type { Request } from "express";
import type {
  AuthIdentifierType,
  AuthProviderType,
  AuthResponse,
  AuthSessionSummary,
  AuthTokenPair,
  AuthUserProfile,
  GoogleLoginRequest,
  LogoutInput,
  OtpChallengeResponse,
  OtpPurpose,
  OtpRequestInput,
  OtpVerifyInput,
  PasswordForgotInput,
  PasswordLoginInput,
  PasswordRegisterInput,
  PasswordResetChallengeResponse,
  PasswordResetInput,
  RefreshSessionInput
} from "@systolab/shared";
import { env } from "../config/env.js";
import { AuthAuditLog, type AuthAuditEvent } from "../models/AuthAuditLog.js";
import { AuthOtpChallenge } from "../models/AuthOtpChallenge.js";
import { AuthPasswordReset } from "../models/AuthPasswordReset.js";
import { AuthSession, type AuthSessionDocument } from "../models/AuthSession.js";
import { AuthThrottle } from "../models/AuthThrottle.js";
import { AuthUser, type AuthUserDocument } from "../models/AuthUser.js";
import { makeId, sha256 } from "../utils/crypto.js";
import { isMongoConnected } from "../db/mongoose.js";

// ── In-memory stores (test / no-DB mode) ──────────────────────────────────────
type MemAuthUser = {
  id: string; _id: string;
  email?: string; phone?: string; googleId?: string;
  displayName?: string; givenName?: string; familyName?: string; avatarUrl?: string;
  locale?: string; googleHostedDomain?: string; googleAvailableClaims?: string[]; googleClaimsCapturedAt?: Date;
  providers: AuthProviderType[]; emailVerified: boolean; phoneVerified: boolean; googleVerified: boolean;
  lifecycleState: string; loginFailureCount: number; lockedUntil?: Date; lastLoginAt?: Date;
  passwordHash?: string; deletedAt?: Date; createdAt: Date; updatedAt: Date;
  save(): Promise<void>;
};
type MemAuthSession = {
  sessionId: string; userId: string; deviceId: string; deviceLabel: string;
  deviceFingerprintHash: string; ipHash: string; provider: AuthProviderType;
  refreshTokenHash: string; accessTokenJti: string;
  revokedAt?: Date; expiresAt: Date; refreshExpiresAt: Date; lastSeenAt: Date; createdAt: Date;
};
type MemAuthOtp = {
  challengeId: string; userId?: string; identifierType: string; identifier: string; purpose: string;
  codeHash: string; expiresAt: Date; resendAvailableAt: Date;
  attempts: number; maxAttempts: number; consumedAt?: Date; lockedUntil?: Date;
  ipHash: string; deviceFingerprintHash: string;
  save(): Promise<void>;
};

const _memAuthUsers = new Map<string, MemAuthUser>();          // key: userId
const _memAuthByEmail = new Map<string, string>();              // email → userId
const _memAuthByPhone = new Map<string, string>();              // phone → userId
const _memAuthByGoogle = new Map<string, string>();             // googleId → userId
export const _memAuthSessionsForTest = new Map<string, MemAuthSession>(); // key: sessionId
const _memAuthOtps = new Map<string, MemAuthOtp>();            // key: challengeId

function makeMemUser(id: string, input: Record<string, unknown>): MemAuthUser {
  const user: MemAuthUser = {
    id, _id: id,
    email: input.email as string | undefined,
    phone: input.phone as string | undefined,
    googleId: input.googleId as string | undefined,
    displayName: input.displayName as string | undefined,
    givenName: input.givenName as string | undefined,
    familyName: input.familyName as string | undefined,
    avatarUrl: input.avatarUrl as string | undefined,
    locale: input.locale as string | undefined,
    googleHostedDomain: input.googleHostedDomain as string | undefined,
    googleAvailableClaims: input.googleAvailableClaims as string[] | undefined,
    googleClaimsCapturedAt: input.googleClaimsCapturedAt as Date | undefined,
    providers: (input.providers as AuthProviderType[] | undefined) ?? [],
    emailVerified: (input.emailVerified as boolean) ?? false,
    phoneVerified: (input.phoneVerified as boolean) ?? false,
    googleVerified: (input.googleVerified as boolean) ?? false,
    lifecycleState: (input.lifecycleState as string) ?? "PENDING",
    loginFailureCount: 0,
    lockedUntil: undefined,
    createdAt: new Date(), updatedAt: new Date(),
    save: async function () {
      _memAuthUsers.set(this.id, this);
      if (this.email) _memAuthByEmail.set(this.email, this.id);
      if (this.phone) _memAuthByPhone.set(this.phone, this.id);
      if (this.googleId) _memAuthByGoogle.set(this.googleId, this.id);
    }
  };
  return user;
}

interface AuthContext {
  ipHash: string;
  deviceFingerprintHash: string;
  deviceId: string;
  deviceLabel: string;
  userAgent: string;
}

interface GoogleIdentity {
  googleId: string;
  email?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  avatarUrl?: string;
  locale?: string;
  phoneNumber?: string;
  hostedDomain?: string;
  availableClaims: string[];
  emailVerified: boolean;
}

interface SignedTokenPayload {
  sub: string;
  sid: string;
  did: string;
  jti: string;
  typ: "access";
  iat: number;
  exp: number;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function buildAuthContext(req: Request, inputDeviceId?: string, inputDeviceLabel?: string): AuthContext {
  const userAgent = String(req.headers["user-agent"] ?? "unknown-user-agent").slice(0, 300);
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const rawIp = forwarded || req.ip || req.socket.remoteAddress || "unknown-ip";
  const deviceId = sanitizeDeviceId(inputDeviceId || String(req.headers["x-systolab-device-id"] ?? "")) || makeId("dev");
  const deviceLabel = sanitizeLabel(inputDeviceLabel || String(req.headers["x-systolab-device-label"] ?? "") || userAgent.slice(0, 80));
  return {
    ipHash: hashSecret(`ip:${rawIp}`),
    deviceFingerprintHash: hashSecret(`device:${deviceId}:${userAgent}`),
    deviceId,
    deviceLabel,
    userAgent
  };
}

export async function googleLogin(input: GoogleLoginRequest, context: AuthContext): Promise<AuthResponse> {
  await enforceThrottle("login_validation", `ip:${context.ipHash}`, 12, 10 * 60_000, context);
  await enforceThrottle("login_validation", `device:${context.deviceFingerprintHash}`, 12, 10 * 60_000, context);
  await writeAudit("google_login_attempt", true, context, { metadata: { deviceId: context.deviceId } });

  const supplemental = {
    displayName: input.displayName,
    givenName: input.givenName,
    familyName: input.familyName,
    avatarUrl: input.photoURL,
    phoneNumber: input.phoneNumber,
    locale: input.locale
  };

  let google: GoogleIdentity;
  try {
    google = await verifyGoogleCredential(input.credential, supplemental);
  } catch (error) {
    await writeAudit("google_login_attempt", false, context, {
      reason: error instanceof Error ? error.message : "Google credential validation failed"
    });
    await recordLoginValidationFailure(context, "google");
    throw error;
  }
  const user = await linkOrCreateUser({
    provider: "google",
    googleId: google.googleId,
    email: google.email,
    phone: google.phoneNumber,
    displayName: google.displayName,
    givenName: google.givenName,
    familyName: google.familyName,
    avatarUrl: google.avatarUrl,
    locale: google.locale,
    googleHostedDomain: google.hostedDomain,
    googleAvailableClaims: google.availableClaims,
    emailVerified: google.emailVerified,
    googleVerified: true
  });
  await ensureUserCanAuthenticate(user);
  user.lifecycleState = "VERIFIED";
  user.googleVerified = true;
  if (google.emailVerified) user.emailVerified = true;
  user.loginFailureCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const session = await createSession(user, "google", context);
  await writeAudit("google_login_success", true, context, { user, metadata: { sessionId: session.session.sessionId } });
  return {
    user: toUserProfile(user),
    session: session.session,
    tokens: session.tokens,
    message: "Google authentication completed."
  };
}

export async function requestOtp(input: OtpRequestInput, context: AuthContext): Promise<OtpChallengeResponse> {
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  await enforceThrottle("otp_request", `ip:${context.ipHash}`, 8, 10 * 60_000, context, identifier);
  await enforceThrottle("otp_request", `device:${context.deviceFingerprintHash}`, 8, 10 * 60_000, context, identifier);
  await enforceThrottle("otp_request", `identifier:${identifier}`, 3, 10 * 60_000, context, identifier);

  const cooldown = await AuthOtpChallenge.findOne({
    identifier,
    purpose: input.purpose,
    consumedAt: { $exists: false },
    resendAvailableAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
  if (cooldown) {
    await writeAudit("throttle_triggered", false, context, { identifier, reason: "OTP resend cooldown active" });
    throw new AuthError(`OTP resend cooldown active until ${cooldown.resendAvailableAt.toISOString()}.`, 429);
  }

  const user = await linkOrCreateUser({
    provider: input.identifierType === "email" ? "email_otp" : "phone_otp",
    email: input.identifierType === "email" ? identifier : undefined,
    phone: input.identifierType === "phone" ? identifier : undefined
  });
  const challenge = await createOtpChallenge(input.identifierType, identifier, input.purpose, user, context);
  await writeAudit("otp_requested", true, context, { user, identifier, metadata: { purpose: input.purpose, challengeId: challenge.challengeId } });
  return challenge;
}

export async function verifyOtp(input: OtpVerifyInput, context: AuthContext): Promise<AuthResponse> {
  await enforceThrottle("otp_verify", `ip:${context.ipHash}`, 12, 10 * 60_000, context);
  await enforceThrottle("otp_verify", `device:${context.deviceFingerprintHash}`, 12, 10 * 60_000, context);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const challenge: any = !isMongoConnected()
    ? (_memAuthOtps.get(input.challengeId) ?? null)
    : await AuthOtpChallenge.findOne({ challengeId: input.challengeId });
  if (!challenge) throw new AuthError("Invalid OTP challenge.", 400);
  if (challenge.lockedUntil && challenge.lockedUntil > new Date()) throw new AuthError("OTP challenge is temporarily locked after 3 failed attempts.", 423);
  if (challenge.consumedAt) throw new AuthError("OTP challenge was already used.", 400);
  if (challenge.expiresAt <= new Date()) throw new AuthError("OTP challenge expired.", 400);

  const valid = compareHash(hashOtp(input.challengeId, input.code), challenge.codeHash);
  if (!valid) {
    challenge.attempts += 1;
    if (challenge.attempts >= challenge.maxAttempts) {
      challenge.lockedUntil = minutesFromNow(env.authLockMinutes);
      await lockUserById(challenge.userId?.toString(), challenge.lockedUntil);
      await writeAudit("auth_lock_applied", false, context, { identifier: challenge.identifier, reason: "OTP attempts exceeded" });
    }
    await challenge.save();
    await writeAudit("otp_verify_failed", false, context, {
      identifier: challenge.identifier,
      reason: "Invalid OTP code",
      metadata: { attempts: challenge.attempts, maxAttempts: challenge.maxAttempts }
    });
    throw new AuthError("Invalid OTP code. Authentication locks after 3 failed attempts.", challenge.lockedUntil ? 423 : 401);
  }

  challenge.consumedAt = new Date();
  await challenge.save();
  const user = await resolveChallengeUser(challenge);
  if (challenge.identifierType === "email") user.emailVerified = true;
  if (challenge.identifierType === "phone") user.phoneVerified = true;
  addProvider(user, challenge.identifierType === "email" ? "email_otp" : "phone_otp");
  user.lifecycleState = "VERIFIED";
  user.loginFailureCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const provider: AuthProviderType = challenge.identifierType === "email" ? "email_otp" : "phone_otp";
  const session = await createSession(user, provider, context);
  await writeAudit("otp_verify_success", true, context, { user, identifier: challenge.identifier, metadata: { challengeId: challenge.challengeId } });
  return {
    user: toUserProfile(user),
    session: session.session,
    tokens: session.tokens,
    message: "OTP verified and session created."
  };
}

export async function registerPassword(input: PasswordRegisterInput, context: AuthContext): Promise<AuthResponse & { otpChallenge: OtpChallengeResponse }> {
  validatePassword(input.password);
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  const user = await linkOrCreateUser({
    provider: "password",
    email: input.identifierType === "email" ? identifier : undefined,
    phone: input.identifierType === "phone" ? identifier : undefined,
    displayName: input.displayName
  });
  user.passwordHash = hashPassword(input.password);
  user.displayName = input.displayName?.trim() || user.displayName;
  addProvider(user, "password");
  user.lifecycleState = user.emailVerified || user.phoneVerified || user.googleVerified ? "VERIFIED" : "PENDING";
  await user.save();
  const otpChallenge = await createOtpChallenge(input.identifierType, identifier, "signup", user, context);
  await writeAudit("password_register", true, context, { user, identifier, metadata: { otpChallengeId: otpChallenge.challengeId } });

  return {
    user: toUserProfile(user),
    requiresVerification: user.lifecycleState === "PENDING",
    otpChallenge,
    message: "Password account created. Verify the simulated OTP before password login."
  };
}

export async function passwordLogin(input: PasswordLoginInput, context: AuthContext): Promise<AuthResponse> {
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  await enforceThrottle("login_validation", `ip:${context.ipHash}`, 12, 10 * 60_000, context, identifier);
  await enforceThrottle("login_validation", `device:${context.deviceFingerprintHash}`, 12, 10 * 60_000, context, identifier);

  const user = await findUserByIdentifier(input.identifierType, identifier);
  if (!user || !user.passwordHash) {
    await writeAudit("password_login_failed", false, context, { identifier, reason: "No password account found" });
    await recordLoginValidationFailure(context, identifier);
    throw new AuthError("Invalid login credentials.", 401);
  }
  await ensureUserCanAuthenticate(user);
  if (!verifyPassword(input.password, user.passwordHash)) {
    user.loginFailureCount += 1;
    if (user.loginFailureCount >= 3) {
      user.lifecycleState = "LOCKED";
      user.lockedUntil = minutesFromNow(env.authLockMinutes);
      await writeAudit("auth_lock_applied", false, context, { user, identifier, reason: "Password attempts exceeded" });
    }
    await user.save();
    await writeAudit("password_login_failed", false, context, {
      user,
      identifier,
      reason: "Invalid password",
      metadata: { attempts: user.loginFailureCount, maxAttempts: 3 }
    });
    if (!user.lockedUntil) await recordLoginValidationFailure(context, identifier);
    throw new AuthError("Invalid login credentials. Authentication locks after 3 failed attempts.", user.lockedUntil ? 423 : 401);
  }

  if (user.lifecycleState === "PENDING") throw new AuthError("Account requires OTP verification before password login.", 403);
  user.loginFailureCount = 0;
  user.lockedUntil = undefined;
  user.lifecycleState = "VERIFIED";
  user.lastLoginAt = new Date();
  await user.save();

  const session = await createSession(user, "password", context);
  await writeAudit("password_login_success", true, context, { user, identifier, metadata: { sessionId: session.session.sessionId } });
  return {
    user: toUserProfile(user),
    session: session.session,
    tokens: session.tokens,
    message: "Password authentication completed."
  };
}

export async function forgotPassword(input: PasswordForgotInput, context: AuthContext): Promise<PasswordResetChallengeResponse> {
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  await enforceThrottle("password_reset", `ip:${context.ipHash}`, 6, 10 * 60_000, context, identifier);
  await enforceThrottle("password_reset", `identifier:${identifier}`, 3, 10 * 60_000, context, identifier);
  const user = await findUserByIdentifier(input.identifierType, identifier);
  if (!user) {
    await writeAudit("password_reset_requested", false, context, { identifier, reason: "No account found" });
    return {
      resetId: makeId("reset"),
      maskedDestination: maskIdentifier(input.identifierType, identifier),
      expiresAt: minutesFromNow(env.authPasswordResetMinutes).toISOString(),
      maxAttempts: 3,
      simulatedDelivery: {
        mode: "backend_simulation",
        note: "If the account exists, a reset token is generated internally. No external email or SMS service is used."
      }
    };
  }

  const resetId = makeId("reset");
  const token = randomToken(24);
  const reset = await AuthPasswordReset.create({
    resetId,
    userId: user._id,
    identifierType: input.identifierType,
    identifier,
    tokenHash: hashResetToken(resetId, token),
    expiresAt: minutesFromNow(env.authPasswordResetMinutes),
    attempts: 0,
    maxAttempts: 3,
    ipHash: context.ipHash,
    deviceFingerprintHash: context.deviceFingerprintHash
  });
  await writeAudit("password_reset_requested", true, context, { user, identifier, metadata: { resetId } });
  return {
    resetId: reset.resetId,
    maskedDestination: maskIdentifier(input.identifierType, identifier),
    expiresAt: reset.expiresAt.toISOString(),
    maxAttempts: reset.maxAttempts,
    simulatedDelivery: {
      mode: "backend_simulation",
      token,
      note: "Self-contained reset token generated by backend simulation. No external email or SMS service was called."
    }
  };
}

export async function resetPassword(input: PasswordResetInput, context: AuthContext): Promise<AuthResponse> {
  validatePassword(input.newPassword);
  const reset = await AuthPasswordReset.findOne({ resetId: input.resetId });
  if (!reset) throw new AuthError("Invalid password reset challenge.", 400);
  if (reset.lockedUntil && reset.lockedUntil > new Date()) throw new AuthError("Password reset challenge is temporarily locked after 3 failed attempts.", 423);
  if (reset.consumedAt) throw new AuthError("Password reset token was already used.", 400);
  if (reset.expiresAt <= new Date()) throw new AuthError("Password reset token expired.", 400);
  if (!compareHash(hashResetToken(input.resetId, input.token), reset.tokenHash)) {
    reset.attempts += 1;
    if (reset.attempts >= reset.maxAttempts) reset.lockedUntil = minutesFromNow(env.authLockMinutes);
    await reset.save();
    await writeAudit("password_reset_failed", false, context, {
      identifier: reset.identifier,
      reason: "Invalid reset token",
      metadata: { attempts: reset.attempts, maxAttempts: reset.maxAttempts }
    });
    throw new AuthError("Invalid password reset token. Reset locks after 3 failed attempts.", reset.lockedUntil ? 423 : 401);
  }

  const user = await AuthUser.findById(reset.userId);
  if (!user) throw new AuthError("Password reset user not found.", 404);
  user.passwordHash = hashPassword(input.newPassword);
  user.loginFailureCount = 0;
  user.lockedUntil = undefined;
  user.lifecycleState = user.lifecycleState === "DELETED" || user.lifecycleState === "SUSPENDED" ? user.lifecycleState : "VERIFIED";
  addProvider(user, "password");
  reset.consumedAt = new Date();
  await user.save();
  await reset.save();
  await writeAudit("password_reset_success", true, context, { user, identifier: reset.identifier, metadata: { resetId: reset.resetId } });
  return {
    user: toUserProfile(user),
    message: "Password reset completed. Log in with the new password."
  };
}

export async function refreshSession(input: RefreshSessionInput, context: AuthContext): Promise<AuthResponse> {
  const parsed = parseRefreshToken(input.refreshToken);

  if (!isMongoConnected()) {
    const memSess = _memAuthSessionsForTest.get(parsed.sessionId);
    if (!memSess || memSess.revokedAt || memSess.refreshExpiresAt <= new Date()) throw new AuthError("Refresh session is invalid or expired.", 401);
    if (!compareHash(hashSecret(input.refreshToken), memSess.refreshTokenHash)) throw new AuthError("Refresh token does not match the active session.", 401);
    const memUser = _memAuthUsers.get(memSess.userId);
    if (!memUser) throw new AuthError("Session user not found.", 404);
    const rotated = issueTokens(memUser as unknown as AuthUserDocument, memSess.sessionId, memSess.deviceId);
    memSess.refreshTokenHash = hashSecret(rotated.refreshToken);
    memSess.accessTokenJti = readSignedToken(rotated.accessToken).jti;
    memSess.lastSeenAt = new Date();
    memSess.expiresAt = new Date(rotated.accessTokenExpiresAt);
    memSess.refreshExpiresAt = new Date(rotated.refreshTokenExpiresAt);
    const summary: AuthSessionSummary = {
      sessionId: memSess.sessionId, deviceId: memSess.deviceId, deviceLabel: memSess.deviceLabel, provider: memSess.provider,
      createdAt: memSess.createdAt.toISOString(), lastSeenAt: memSess.lastSeenAt.toISOString(),
      expiresAt: memSess.expiresAt.toISOString(), refreshExpiresAt: memSess.refreshExpiresAt.toISOString()
    };
    return { user: toUserProfile(memUser as unknown as AuthUserDocument), session: summary, tokens: rotated, message: "Session refreshed." };
  }

  const session = await AuthSession.findOne({ sessionId: parsed.sessionId });
  if (!session || session.revokedAt || session.refreshExpiresAt <= new Date()) throw new AuthError("Refresh session is invalid or expired.", 401);
  if (!compareHash(hashSecret(input.refreshToken), session.refreshTokenHash)) throw new AuthError("Refresh token does not match the active session.", 401);
  const user = await AuthUser.findById(session.userId);
  if (!user) throw new AuthError("Session user not found.", 404);
  await ensureUserCanAuthenticate(user);

  const rotated = issueTokens(user, session.sessionId, session.deviceId);
  session.refreshTokenHash = hashSecret(rotated.refreshToken);
  session.accessTokenJti = readSignedToken(rotated.accessToken).jti;
  session.lastSeenAt = new Date();
  session.expiresAt = new Date(rotated.accessTokenExpiresAt);
  session.refreshExpiresAt = new Date(rotated.refreshTokenExpiresAt);
  await session.save();
  await writeAudit("session_refresh", true, context, { user, metadata: { sessionId: session.sessionId } });
  return {
    user: toUserProfile(user),
    session: toSessionSummary(session),
    tokens: rotated,
    message: "Session refreshed."
  };
}

export async function logout(input: LogoutInput, context: AuthContext, userId?: string): Promise<{ message: string }> {
  if (!input.sessionId && !input.refreshToken) throw new AuthError("sessionId or refreshToken is required.", 400);

  if (!isMongoConnected()) {
    // Find session by sessionId or by refreshTokenHash
    let memSess: MemAuthSession | undefined;
    if (input.sessionId) {
      memSess = _memAuthSessionsForTest.get(input.sessionId);
    } else if (input.refreshToken) {
      const rHash = hashSecret(input.refreshToken);
      memSess = [..._memAuthSessionsForTest.values()].find((s) => s.refreshTokenHash === rHash);
    }
    if (memSess && !memSess.revokedAt) memSess.revokedAt = new Date();
    return { message: "Session invalidated." };
  }

  const query: Record<string, unknown> = {};
  if (input.sessionId) query.sessionId = input.sessionId;
  if (input.refreshToken) query.refreshTokenHash = hashSecret(input.refreshToken);
  if (userId) query.userId = userId;
  const session = await AuthSession.findOne(query);
  if (session && !session.revokedAt) {
    session.revokedAt = new Date();
    await session.save();
    await writeAudit("session_logout", true, context, { userId: session.userId.toString(), metadata: { sessionId: session.sessionId } });
  }
  return { message: "Session invalidated." };
}

export async function listSessions(userId: string): Promise<AuthSessionSummary[]> {
  if (!isMongoConnected()) {
    const sessions = [..._memAuthSessionsForTest.values()].filter((s) => s.userId === userId);
    sessions.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    return sessions.slice(0, 20).map((s) => ({
      sessionId: s.sessionId, deviceId: s.deviceId, deviceLabel: s.deviceLabel, provider: s.provider,
      createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(), refreshExpiresAt: s.refreshExpiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString()
    }));
  }
  const sessions = await AuthSession.find({ userId }).sort({ lastSeenAt: -1 }).limit(20);
  return sessions.map(toSessionSummary);
}

export async function revokeSession(userId: string, sessionId: string, context: AuthContext): Promise<{ message: string }> {
  const session = await AuthSession.findOne({ userId, sessionId });
  if (!session) throw new AuthError("Session not found.", 404);
  session.revokedAt = new Date();
  await session.save();
  await writeAudit("session_revoked", true, context, { userId, metadata: { sessionId } });
  return { message: "Session revoked." };
}

export async function getUserByAccessToken(accessToken: string): Promise<{ user: AuthUserDocument; session: AuthSessionDocument; payload: SignedTokenPayload }> {
  const payload = readSignedToken(accessToken);

  if (!isMongoConnected()) {
    const memSess = _memAuthSessionsForTest.get(payload.sid);
    if (!memSess || memSess.revokedAt || memSess.expiresAt <= new Date()) throw new AuthError("Access session is invalid or expired.", 401);
    const memUser = _memAuthUsers.get(memSess.userId) ?? _memAuthUsers.get(payload.sub);
    if (!memUser) throw new AuthError("Authenticated user not found.", 404);
    if (memUser.lockedUntil && memUser.lockedUntil > new Date()) throw new AuthError(`Authentication temporarily locked until ${memUser.lockedUntil.toISOString()}.`, 423);
    return { user: memUser as unknown as AuthUserDocument, session: memSess as unknown as AuthSessionDocument, payload };
  }

  const session = await AuthSession.findOne({ sessionId: payload.sid });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new AuthError("Access session is invalid or expired.", 401);
  const user = await AuthUser.findById(payload.sub);
  if (!user) throw new AuthError("Authenticated user not found.", 404);
  await ensureUserCanAuthenticate(user);
  return { user, session, payload };
}

export function toUserProfile(user: AuthUserDocument): AuthUserProfile {
  return {
    userId: user.id,
    email: user.email,
    phone: user.phone,
    googleId: user.googleId,
    displayName: user.displayName,
    givenName: user.givenName,
    familyName: user.familyName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    googleProfile: user.googleId
      ? {
          subject: user.googleId,
          hostedDomain: user.googleHostedDomain,
          picture: user.avatarUrl,
          claimsCapturedAt: user.googleClaimsCapturedAt?.toISOString(),
          availableClaims: user.googleAvailableClaims
        }
      : undefined,
    providers: user.providers,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    googleVerified: user.googleVerified,
    lifecycleState: user.lifecycleState,
    lockedUntil: user.lockedUntil?.toISOString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString()
  };
}

function toSessionSummary(session: AuthSessionDocument): AuthSessionSummary {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    deviceLabel: session.deviceLabel,
    provider: session.provider,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString()
  };
}

async function createOtpChallenge(
  identifierType: AuthIdentifierType,
  identifier: string,
  purpose: OtpPurpose,
  user: AuthUserDocument,
  context: AuthContext
): Promise<OtpChallengeResponse> {
  const challengeId = makeId("otp");
  const code = generateOtpCode();

  if (!isMongoConnected()) {
    const codeHash = hashOtp(challengeId, code);
    const expiresAt = minutesFromNow(env.authOtpTtlMinutes);
    const resendAvailableAt = secondsFromNow(env.authOtpResendCooldownSeconds);
    const otp: MemAuthOtp = {
      challengeId, userId: (user as unknown as { id: string }).id,
      identifierType, identifier, purpose, codeHash, expiresAt, resendAvailableAt,
      attempts: 0, maxAttempts: 3,
      ipHash: context.ipHash, deviceFingerprintHash: context.deviceFingerprintHash,
      save: async function () { _memAuthOtps.set(this.challengeId, this); }
    };
    _memAuthOtps.set(challengeId, otp);
    return {
      challengeId, identifierType, maskedDestination: maskIdentifier(identifierType, identifier),
      purpose, expiresAt: expiresAt.toISOString(), resendAvailableAt: resendAvailableAt.toISOString(),
      maxAttempts: 3,
      simulatedDelivery: { mode: "backend_simulation", code, note: "Self-contained OTP generated by backend simulation. No external email, SMS, or OTP delivery service was called." }
    };
  }

  const challenge = await AuthOtpChallenge.create({
    challengeId,
    userId: user._id,
    identifierType,
    identifier,
    purpose,
    codeHash: hashOtp(challengeId, code),
    expiresAt: minutesFromNow(env.authOtpTtlMinutes),
    resendAvailableAt: secondsFromNow(env.authOtpResendCooldownSeconds),
    attempts: 0,
    maxAttempts: 3,
    ipHash: context.ipHash,
    deviceFingerprintHash: context.deviceFingerprintHash
  });
  return {
    challengeId: challenge.challengeId,
    identifierType,
    maskedDestination: maskIdentifier(identifierType, identifier),
    purpose,
    expiresAt: challenge.expiresAt.toISOString(),
    resendAvailableAt: challenge.resendAvailableAt.toISOString(),
    maxAttempts: challenge.maxAttempts,
    simulatedDelivery: {
      mode: "backend_simulation",
      code,
      note: "Self-contained OTP generated by backend simulation. No external email, SMS, or OTP delivery service was called."
    }
  };
}

async function resolveChallengeUser(challenge: { userId?: unknown; identifierType: AuthIdentifierType; identifier: string }): Promise<AuthUserDocument> {
  if (!isMongoConnected() && challenge.userId) {
    const user = _memAuthUsers.get(String(challenge.userId));
    if (user) return user as unknown as AuthUserDocument;
  }
  const byId = challenge.userId && !isMongoConnected() ? null : (challenge.userId ? await AuthUser.findById(challenge.userId) : null);
  if (byId) return byId;
  return linkOrCreateUser({
    provider: challenge.identifierType === "email" ? "email_otp" : "phone_otp",
    email: challenge.identifierType === "email" ? challenge.identifier : undefined,
    phone: challenge.identifierType === "phone" ? challenge.identifier : undefined
  });
}

async function linkOrCreateUser(input: {
  provider: AuthProviderType;
  email?: string;
  phone?: string;
  googleId?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  avatarUrl?: string;
  locale?: string;
  googleHostedDomain?: string;
  googleAvailableClaims?: string[];
  emailVerified?: boolean;
  googleVerified?: boolean;
}): Promise<AuthUserDocument> {
  if (!isMongoConnected()) {
    let existingId: string | undefined;
    if (input.googleId) existingId = _memAuthByGoogle.get(input.googleId);
    if (!existingId && input.email) existingId = _memAuthByEmail.get(input.email);
    if (!existingId && input.phone) existingId = _memAuthByPhone.get(input.phone);

    let user = existingId ? _memAuthUsers.get(existingId) : undefined;
    if (!user) {
      const uid = makeId("usr");
      user = makeMemUser(uid, {
        email: input.email, phone: input.phone, googleId: input.googleId,
        displayName: input.displayName?.trim(), givenName: input.givenName?.trim(),
        familyName: input.familyName?.trim(), avatarUrl: input.avatarUrl?.trim(),
        locale: input.locale?.trim(), googleHostedDomain: input.googleHostedDomain?.trim(),
        googleAvailableClaims: input.googleAvailableClaims ? Array.from(new Set(input.googleAvailableClaims)) : undefined,
        googleClaimsCapturedAt: input.googleAvailableClaims ? new Date() : undefined,
        emailVerified: input.emailVerified ?? false,
        googleVerified: input.googleVerified ?? false,
        providers: [], lifecycleState: "PENDING"
      });
      _memAuthUsers.set(uid, user);
    } else {
      if (input.email && !user.email) { user.email = input.email; _memAuthByEmail.set(input.email, user.id); }
      if (input.phone && !user.phone) { user.phone = input.phone; _memAuthByPhone.set(input.phone, user.id); }
      if (input.googleId && !user.googleId) { user.googleId = input.googleId; _memAuthByGoogle.set(input.googleId, user.id); }
      if (input.displayName) user.displayName = input.displayName.trim();
      if (input.emailVerified) user.emailVerified = true;
      if (input.googleVerified) user.googleVerified = true;
    }
    if (!user.providers.includes(input.provider)) user.providers.push(input.provider);
    if (user.emailVerified || user.phoneVerified || user.googleVerified) user.lifecycleState = "VERIFIED";
    await user.save();
    return user as unknown as AuthUserDocument;
  }

  const or: Array<{ googleId: string } | { email: string } | { phone: string }> = [];
  if (input.googleId) or.push({ googleId: input.googleId });
  if (input.email) or.push({ email: input.email });
  if (input.phone) or.push({ phone: input.phone });

  const matches = or.length > 0 ? await AuthUser.find({ $or: or, lifecycleState: { $ne: "DELETED" } }) : [];
  const primary = matches[0] ?? new AuthUser();
  if (input.email && !primary.email) primary.email = input.email;
  if (input.phone && !primary.phone) primary.phone = input.phone;
  if (input.googleId && !primary.googleId) primary.googleId = input.googleId;
  if (input.displayName) primary.displayName = input.displayName.trim();
  if (input.givenName) primary.givenName = input.givenName.trim();
  if (input.familyName) primary.familyName = input.familyName.trim();
  if (input.avatarUrl) primary.avatarUrl = input.avatarUrl.trim();
  if (input.locale) primary.locale = input.locale.trim();
  if (input.googleHostedDomain) primary.googleHostedDomain = input.googleHostedDomain.trim();
  if (input.googleAvailableClaims) {
    primary.googleAvailableClaims = Array.from(new Set(input.googleAvailableClaims));
    primary.googleClaimsCapturedAt = new Date();
  }
  if (input.emailVerified) primary.emailVerified = true;
  if (input.googleVerified) primary.googleVerified = true;
  addProvider(primary, input.provider);
  if (primary.emailVerified || primary.phoneVerified || primary.googleVerified) primary.lifecycleState = "VERIFIED";
  await primary.save();

  for (const duplicate of matches.slice(1)) {
    duplicate.email = duplicate.email === primary.email ? undefined : duplicate.email;
    duplicate.phone = duplicate.phone === primary.phone ? undefined : duplicate.phone;
    duplicate.googleId = duplicate.googleId === primary.googleId ? undefined : duplicate.googleId;
    duplicate.lifecycleState = "DELETED";
    duplicate.deletedAt = new Date();
    await duplicate.save();
  }
  return primary;
}

async function findUserByIdentifier(type: AuthIdentifierType, identifier: string): Promise<AuthUserDocument | null> {
  if (!isMongoConnected()) {
    const uid = type === "email" ? _memAuthByEmail.get(identifier) : _memAuthByPhone.get(identifier);
    return uid ? (_memAuthUsers.get(uid) as unknown as AuthUserDocument) ?? null : null;
  }
  return AuthUser.findOne(type === "email" ? { email: identifier } : { phone: identifier });
}

function addProvider(user: AuthUserDocument, provider: AuthProviderType): void {
  const u = user as unknown as { providers: string[] };
  if (!u.providers.includes(provider)) u.providers.push(provider);
}

async function ensureUserCanAuthenticate(user: AuthUserDocument): Promise<void> {
  const u = user as unknown as MemAuthUser;
  if (u.lifecycleState === "DELETED") throw new AuthError("Account has been deleted.", 403);
  if (u.lifecycleState === "SUSPENDED") throw new AuthError("Account is suspended.", 403);
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new AuthError(`Authentication temporarily locked until ${u.lockedUntil.toISOString()}.`, 423);
  if (u.lifecycleState === "LOCKED") {
    u.lifecycleState = u.emailVerified || u.phoneVerified || u.googleVerified ? "VERIFIED" : "PENDING";
    u.loginFailureCount = 0;
    u.lockedUntil = undefined;
    await user.save();
  }
}

async function lockUserById(userId: string | undefined, lockedUntil: Date): Promise<void> {
  if (!userId) return;
  if (!isMongoConnected()) {
    const user = _memAuthUsers.get(userId);
    if (user) { user.lifecycleState = "LOCKED"; user.lockedUntil = lockedUntil; }
    return;
  }
  const user = await AuthUser.findById(userId);
  if (!user) return;
  user.lifecycleState = "LOCKED";
  user.lockedUntil = lockedUntil;
  await user.save();
}

async function createSession(user: AuthUserDocument, provider: AuthProviderType, context: AuthContext): Promise<{ session: AuthSessionSummary; tokens: AuthTokenPair }> {
  const sessionId = makeId("sess");
  const tokens = issueTokens(user, sessionId, context.deviceId);
  const payload = readSignedToken(tokens.accessToken);

  if (!isMongoConnected()) {
    const memUser = user as unknown as MemAuthUser;
    const memSess: MemAuthSession = {
      sessionId, userId: memUser.id, deviceId: context.deviceId, deviceLabel: context.deviceLabel,
      deviceFingerprintHash: context.deviceFingerprintHash, ipHash: context.ipHash, provider,
      refreshTokenHash: hashSecret(tokens.refreshToken), accessTokenJti: payload.jti,
      lastSeenAt: new Date(), expiresAt: new Date(tokens.accessTokenExpiresAt),
      refreshExpiresAt: new Date(tokens.refreshTokenExpiresAt), createdAt: new Date()
    };
    _memAuthSessionsForTest.set(sessionId, memSess);
    const summary: AuthSessionSummary = {
      sessionId, deviceId: context.deviceId, deviceLabel: context.deviceLabel, provider,
      createdAt: memSess.createdAt.toISOString(), lastSeenAt: memSess.lastSeenAt.toISOString(),
      expiresAt: memSess.expiresAt.toISOString(), refreshExpiresAt: memSess.refreshExpiresAt.toISOString(),
      revokedAt: undefined
    };
    return { session: summary, tokens };
  }

  const session = await AuthSession.create({
    sessionId,
    userId: user._id,
    deviceId: context.deviceId,
    deviceLabel: context.deviceLabel,
    deviceFingerprintHash: context.deviceFingerprintHash,
    ipHash: context.ipHash,
    provider,
    refreshTokenHash: hashSecret(tokens.refreshToken),
    accessTokenJti: payload.jti,
    lastSeenAt: new Date(),
    expiresAt: new Date(tokens.accessTokenExpiresAt),
    refreshExpiresAt: new Date(tokens.refreshTokenExpiresAt)
  });
  return { session: toSessionSummary(session), tokens };
}

function issueTokens(user: AuthUserDocument, sessionId: string, deviceId: string): AuthTokenPair {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessExp = nowSeconds + env.authAccessTokenMinutes * 60;
  const refreshExp = new Date(Date.now() + env.authRefreshTokenDays * 24 * 60 * 60 * 1000);
  const accessToken = signToken({
    sub: user.id,
    sid: sessionId,
    did: deviceId,
    jti: makeId("jti"),
    typ: "access",
    iat: nowSeconds,
    exp: accessExp
  });
  const refreshToken = `${sessionId}.${randomToken(32)}`;
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(accessExp * 1000).toISOString(),
    refreshTokenExpiresAt: refreshExp.toISOString()
  };
}

function signToken(payload: SignedTokenPayload): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "SYSTOLAB-JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", env.authJwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function readSignedToken(token: string): SignedTokenPayload {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) throw new AuthError("Invalid access token.", 401);
  const expected = createHmac("sha256", env.authJwtSecret).update(`${header}.${body}`).digest("base64url");
  if (!compareRaw(signature, expected)) throw new AuthError("Invalid access token signature.", 401);
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedTokenPayload;
  if (payload.typ !== "access" || payload.exp * 1000 <= Date.now()) throw new AuthError("Access token expired.", 401);
  return payload;
}

function parseRefreshToken(token: string): { sessionId: string } {
  const [sessionId, secret] = token.split(".");
  if (!sessionId || !secret) throw new AuthError("Invalid refresh token.", 401);
  return { sessionId };
}

async function verifyGoogleCredential(
  credential: string,
  supplemental?: {
    displayName?: string;
    givenName?: string;
    familyName?: string;
    avatarUrl?: string;
    phoneNumber?: string;
    locale?: string;
  }
): Promise<GoogleIdentity> {
  if (!credential) throw new AuthError("Google credential is required.", 400);

  // Dev-mode simulated credential
  if (credential.startsWith("dev:")) {
    if (env.nodeEnv === "production" || !env.authAllowDevGoogleCredential) throw new AuthError("Development Google credential is disabled.", 403);
    const [, emailRaw, googleIdRaw, nameRaw, givenRaw, familyRaw, avatarRaw, localeRaw] = credential
      .split(":")
      .map((part, index) => (index === 0 ? part : safeDecode(part)));
    const email = emailRaw ? normalizeIdentifier("email", emailRaw) : undefined;
    const googleId = googleIdRaw || (email ? `google-${sha256(email).slice(0, 16)}` : undefined);
    const displayName = nameRaw || [givenRaw, familyRaw].filter(Boolean).join(" ") || email?.split("@")[0];
    if (!googleId) throw new AuthError("Development Google credential must include email or Google ID.", 400);
    return {
      googleId,
      email,
      displayName,
      givenName: givenRaw,
      familyName: familyRaw,
      avatarUrl: avatarRaw,
      locale: localeRaw,
      availableClaims: ["sub", ...(email ? ["email", "email_verified"] : []), "name", "given_name", "family_name", "picture", "locale"],
      emailVerified: Boolean(email)
    };
  }

  const [headerRaw, payloadRaw, signatureRaw] = credential.split(".");
  if (!headerRaw || !payloadRaw || !signatureRaw) throw new AuthError("Google credential must be a JWT ID token.", 400);

  // Peek at the issuer to route to the correct verifier
  const rawPayload = JSON.parse(Buffer.from(payloadRaw, "base64url").toString("utf8")) as { iss?: string };

  // Firebase ID token (issued by Firebase Auth, not Google Sign-In directly)
  if (typeof rawPayload.iss === "string" && rawPayload.iss.startsWith("https://securetoken.google.com/")) {
    return verifyFirebaseIdToken(credential, supplemental);
  }

  // Standard Google Sign-In JWT (RS256, issued by accounts.google.com)
  const header = JSON.parse(Buffer.from(headerRaw, "base64url").toString("utf8")) as { alg?: string; kid?: string };
  const payload = JSON.parse(Buffer.from(payloadRaw, "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    locale?: string;
    hd?: string;
    exp?: number;
  };
  if (header.alg !== "RS256") throw new AuthError("Unsupported Google credential signature algorithm.", 400);
  if (!payload.sub || !payload.exp) throw new AuthError("Google credential is missing required claims.", 400);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss ?? "")) throw new AuthError("Google credential issuer is invalid.", 401);
  if (payload.aud !== env.authGoogleClientId) throw new AuthError("Google credential audience is invalid.", 401);
  if (payload.exp * 1000 <= Date.now()) throw new AuthError("Google credential expired.", 401);
  const jwk = findConfiguredGoogleJwk(header.kid);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const verified = verifySignature("RSA-SHA256", Buffer.from(`${headerRaw}.${payloadRaw}`), publicKey, Buffer.from(signatureRaw, "base64url"));
  if (!verified) throw new AuthError("Google credential signature verification failed.", 401);
  return {
    googleId: payload.sub,
    email: payload.email ? normalizeIdentifier("email", payload.email) : undefined,
    displayName: supplemental?.displayName || payload.name,
    givenName: supplemental?.givenName || payload.given_name,
    familyName: supplemental?.familyName || payload.family_name,
    avatarUrl: supplemental?.avatarUrl || payload.picture,
    locale: supplemental?.locale || payload.locale,
    phoneNumber: supplemental?.phoneNumber,
    hostedDomain: payload.hd,
    availableClaims: Object.keys(payload).sort(),
    emailVerified: Boolean(payload.email_verified)
  };
}

async function verifyFirebaseIdToken(
  idToken: string,
  supplemental?: {
    displayName?: string;
    givenName?: string;
    familyName?: string;
    avatarUrl?: string;
    phoneNumber?: string;
    locale?: string;
  }
): Promise<GoogleIdentity> {
  if (!env.firebaseProjectId && !env.firebaseServiceAccountJson) {
    throw new AuthError("Firebase is not configured on this server. Set FIREBASE_PROJECT_ID.", 500);
  }
  let decoded: Awaited<ReturnType<ReturnType<typeof getFirebaseAuth>["verifyIdToken"]>>;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken);
  } catch {
    throw new AuthError("Firebase ID token verification failed.", 401);
  }

  // Extract the underlying Google UID from Firebase identities map
  const firebaseExtra = decoded.firebase as {
    identities?: { "google.com"?: string[]; phone?: string[] };
    sign_in_provider?: string;
  } | undefined;
  const googleUid = firebaseExtra?.identities?.["google.com"]?.[0] ?? decoded.uid;
  const firebasePhone = firebaseExtra?.identities?.phone?.[0] ?? decoded.phone_number;

  const email = decoded.email ? normalizeIdentifier("email", decoded.email) : undefined;
  return {
    googleId: googleUid,
    email,
    displayName: supplemental?.displayName || (decoded.name as string | undefined),
    givenName: supplemental?.givenName,
    familyName: supplemental?.familyName,
    avatarUrl: supplemental?.avatarUrl || (decoded.picture as string | undefined),
    locale: supplemental?.locale,
    phoneNumber: supplemental?.phoneNumber || firebasePhone,
    availableClaims: Object.keys(decoded).sort(),
    emailVerified: decoded.email_verified ?? false
  };
}

function findConfiguredGoogleJwk(kid: string | undefined): CryptoJsonWebKey & { kid?: string } {
  if (!env.authGoogleJwksJson) {
    throw new AuthError("Google JWKS is not configured. Set SYSTOLAB_GOOGLE_JWKS_JSON for self-contained production verification.", 500);
  }
  const parsed = JSON.parse(env.authGoogleJwksJson) as { keys?: Array<CryptoJsonWebKey & { kid?: string }> } | Array<CryptoJsonWebKey & { kid?: string }>;
  const keys = Array.isArray(parsed) ? parsed : parsed.keys ?? [];
  const jwk = keys.find((key) => !kid || key.kid === kid);
  if (!jwk) throw new AuthError("Configured Google JWKS does not contain the token key ID.", 401);
  return jwk;
}

async function enforceThrottle(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  context: AuthContext,
  identifier?: string
): Promise<void> {
  if (!isMongoConnected()) return; // throttle disabled in memory mode
  const now = new Date();
  const throttleKey = `${scope}:${key}`;
  let throttle = await AuthThrottle.findOne({ throttleKey });
  if (throttle?.lockedUntil && throttle.lockedUntil > now) {
    await writeAudit("throttle_triggered", false, context, { identifier, reason: `${scope} throttle locked`, metadata: { throttleKey } });
    throw new AuthError(`${scope.replaceAll("_", " ")} temporarily locked until ${throttle.lockedUntil.toISOString()}.`, 429);
  }
  if (!throttle || now.getTime() - throttle.firstSeenAt.getTime() > windowMs) {
    throttle = await AuthThrottle.findOneAndUpdate(
      { throttleKey },
      { throttleKey, scope, attempts: 1, firstSeenAt: now, lastAttemptAt: now, lockedUntil: undefined, metadata: { identifier } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return;
  }
  throttle.attempts += 1;
  throttle.lastAttemptAt = now;
  if (throttle.attempts > limit) {
    throttle.lockedUntil = minutesFromNow(env.authLockMinutes);
    await writeAudit("throttle_triggered", false, context, { identifier, reason: `${scope} limit exceeded`, metadata: { throttleKey, attempts: throttle.attempts } });
  }
  await throttle.save();
  if (throttle.lockedUntil && throttle.lockedUntil > now) {
    throw new AuthError(`${scope.replaceAll("_", " ")} temporarily locked until ${throttle.lockedUntil.toISOString()}.`, 429);
  }
}

async function recordLoginValidationFailure(context: AuthContext, identifier: string): Promise<void> {
  if (!isMongoConnected()) return;
  await recordFailureThrottle("login_validation_failure", `ip:${context.ipHash}`, context, identifier);
  await recordFailureThrottle("login_validation_failure", `device:${context.deviceFingerprintHash}`, context, identifier);
  await recordFailureThrottle("login_validation_failure", `identifier:${hashSecret(identifier)}`, context, identifier);
}

async function recordFailureThrottle(scope: string, key: string, context: AuthContext, identifier: string): Promise<void> {
  const now = new Date();
  const throttleKey = `${scope}:${key}`;
  let throttle = await AuthThrottle.findOne({ throttleKey });
  if (throttle?.lockedUntil && throttle.lockedUntil > now) {
    await writeAudit("throttle_triggered", false, context, { identifier, reason: `${scope} locked`, metadata: { throttleKey } });
    throw new AuthError("Login validation is temporarily locked after 3 failed attempts.", 423);
  }
  if (!throttle || now.getTime() - throttle.firstSeenAt.getTime() > 10 * 60_000) {
    throttle = await AuthThrottle.findOneAndUpdate(
      { throttleKey },
      { throttleKey, scope, attempts: 1, firstSeenAt: now, lastAttemptAt: now, lockedUntil: undefined, metadata: { identifierHash: hashSecret(identifier) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return;
  }
  throttle.attempts += 1;
  throttle.lastAttemptAt = now;
  if (throttle.attempts >= 3) {
    throttle.lockedUntil = minutesFromNow(env.authLockMinutes);
    await writeAudit("auth_lock_applied", false, context, { identifier, reason: "Login validation attempts exceeded", metadata: { throttleKey } });
  }
  await throttle.save();
  if (throttle.lockedUntil && throttle.lockedUntil > now) {
    throw new AuthError("Login validation is temporarily locked after 3 failed attempts.", 423);
  }
}

async function writeAudit(
  eventType: AuthAuditEvent,
  success: boolean,
  context: AuthContext,
  input: {
    user?: AuthUserDocument;
    userId?: string;
    identifier?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  await AuthAuditLog.create({
    auditId: makeId("audit"),
    userId: input.user?._id ?? input.userId,
    identifier: input.identifier,
    eventType,
    success,
    reason: input.reason,
    ipHash: context.ipHash,
    deviceFingerprintHash: context.deviceFingerprintHash,
    userAgent: context.userAgent,
    metadata: input.metadata
  }).catch(() => undefined);
}

function normalizeIdentifier(type: AuthIdentifierType, value: string): string {
  const trimmed = String(value ?? "").trim();
  if (type === "email") {
    const normalized = trimmed.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new AuthError("Valid email is required.", 400);
    return normalized;
  }
  const normalized = trimmed.replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,16}$/.test(normalized)) throw new AuthError("Valid phone number is required.", 400);
  return normalized;
}

function maskIdentifier(type: AuthIdentifierType, value: string): string {
  if (type === "email") {
    const [name = "", domain = ""] = value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function validatePassword(password: string): void {
  if (password.length < 10) throw new AuthError("Password must be at least 10 characters.", 400);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new AuthError("Password must include letters and numbers.", 400);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:v1:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [, version, salt, hash] = stored.split(":");
  if (version !== "v1" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString("base64url");
  return compareRaw(candidate, hash);
}

function hashSecret(input: string): string {
  return createHmac("sha256", env.authJwtSecret).update(input).digest("hex");
}

function hashOtp(challengeId: string, code: string): string {
  return hashSecret(`otp:${challengeId}:${code}`);
}

function hashResetToken(resetId: string, token: string): string {
  return hashSecret(`reset:${resetId}:${token}`);
}

function compareHash(candidateHash: string, storedHash: string): boolean {
  return compareRaw(candidateHash, storedHash);
}

function compareRaw(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function generateOtpCode(): string {
  const digits = Math.max(4, Math.min(10, env.authOtpLength));
  const max = 10 ** digits;
  return String(randomBytes(4).readUInt32BE(0) % max).padStart(digits, "0");
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sanitizeDeviceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80);
}

function sanitizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "Unknown device";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
