import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request } from "express";
import type {
  AuthIdentifierType,
  AuthPublicConfig,
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
import { readJsonFile, resolveRuntimeFilePath, writeJsonFile } from "./runtimeFileStore.js";
import { AuthenticationDeliveryError, sendAuthenticationCode } from "./emailService.js";

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
  codeHash: string; pendingPasswordHash?: string; expiresAt: Date; resendAvailableAt: Date;
  attempts: number; maxAttempts: number; consumedAt?: Date; lockedUntil?: Date;
  ipHash: string; deviceFingerprintHash: string;
  save(): Promise<void>;
};
type MemPasswordReset = {
  resetId: string; userId: string; identifierType: AuthIdentifierType; identifier: string;
  tokenHash: string; expiresAt: Date; attempts: number; maxAttempts: number;
  lockedUntil?: Date; consumedAt?: Date; ipHash: string; deviceFingerprintHash: string;
  save(): Promise<void>;
};
type MemAuthAudit = {
  auditId: string;
  userId?: string;
  identifier?: string;
  eventType: AuthAuditEvent;
  success: boolean;
  reason?: string;
  ipHash: string;
  deviceFingerprintHash: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

const _memAuthUsers = new Map<string, MemAuthUser>();          // key: userId
const _memAuthByEmail = new Map<string, string>();              // email → userId
const _memAuthByPhone = new Map<string, string>();              // phone → userId
const _memAuthByGoogle = new Map<string, string>();             // googleId → userId
export const _memAuthSessionsForTest = new Map<string, MemAuthSession>(); // key: sessionId
const _memAuthOtps = new Map<string, MemAuthOtp>();            // key: challengeId
const _memPasswordResets = new Map<string, MemPasswordReset>(); // key: resetId
const _memAuthAudits: MemAuthAudit[] = [];

interface PersistedAuthStore {
  schemaVersion: 1;
  users: Array<Omit<MemAuthUser, "save" | "createdAt" | "updatedAt" | "lockedUntil" | "lastLoginAt" | "googleClaimsCapturedAt" | "deletedAt"> & {
    createdAt: string;
    updatedAt: string;
    lockedUntil?: string;
    lastLoginAt?: string;
    googleClaimsCapturedAt?: string;
    deletedAt?: string;
  }>;
  sessions: Array<Omit<MemAuthSession, "createdAt" | "lastSeenAt" | "expiresAt" | "refreshExpiresAt" | "revokedAt"> & {
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    refreshExpiresAt: string;
    revokedAt?: string;
  }>;
  challenges: Array<Omit<MemAuthOtp, "save" | "expiresAt" | "resendAvailableAt" | "consumedAt" | "lockedUntil"> & {
    expiresAt: string;
    resendAvailableAt: string;
    consumedAt?: string;
    lockedUntil?: string;
  }>;
  resets: Array<Omit<MemPasswordReset, "save" | "expiresAt" | "consumedAt" | "lockedUntil"> & {
    expiresAt: string;
    consumedAt?: string;
    lockedUntil?: string;
  }>;
  audits: Array<Omit<MemAuthAudit, "createdAt"> & { createdAt: string }>;
  updatedAt: string;
}

let memoryAuthLoaded = false;

function memoryAuthPersistenceEnabled(): boolean {
  return env.memoryStore && env.nodeEnv !== "test";
}

function ensureMemoryAuthLoaded(): void {
  if (memoryAuthLoaded) return;
  memoryAuthLoaded = true;
  if (!memoryAuthPersistenceEnabled()) return;
  const payload = readJsonFile<Partial<PersistedAuthStore>>(resolveRuntimeFilePath(env.authMemoryStoreFile));
  if (!payload) return;

  for (const item of payload.users ?? []) {
    if (!item.id) continue;
    const user = makeMemUser(item.id, {
      ...item,
      createdAt: parseStoredDate(item.createdAt) ?? new Date(),
      updatedAt: parseStoredDate(item.updatedAt) ?? new Date(),
      lockedUntil: parseStoredDate(item.lockedUntil),
      lastLoginAt: parseStoredDate(item.lastLoginAt),
      googleClaimsCapturedAt: parseStoredDate(item.googleClaimsCapturedAt),
      deletedAt: parseStoredDate(item.deletedAt)
    });
    _memAuthUsers.set(user.id, user);
    if (user.email) _memAuthByEmail.set(user.email, user.id);
    if (user.phone) _memAuthByPhone.set(user.phone, user.id);
    if (user.googleId) _memAuthByGoogle.set(user.googleId, user.id);
  }

  for (const item of payload.sessions ?? []) {
    const expiresAt = parseStoredDate(item.expiresAt);
    const refreshExpiresAt = parseStoredDate(item.refreshExpiresAt);
    if (!item.sessionId || !expiresAt || !refreshExpiresAt || refreshExpiresAt <= new Date()) continue;
    _memAuthSessionsForTest.set(item.sessionId, {
      ...item,
      createdAt: parseStoredDate(item.createdAt) ?? new Date(),
      lastSeenAt: parseStoredDate(item.lastSeenAt) ?? new Date(),
      expiresAt,
      refreshExpiresAt,
      revokedAt: parseStoredDate(item.revokedAt)
    });
  }

  for (const item of payload.challenges ?? []) {
    const expiresAt = parseStoredDate(item.expiresAt);
    const resendAvailableAt = parseStoredDate(item.resendAvailableAt);
    if (!item.challengeId || !expiresAt || !resendAvailableAt || expiresAt <= new Date()) continue;
    _memAuthOtps.set(item.challengeId, {
      ...item,
      expiresAt,
      resendAvailableAt,
      consumedAt: parseStoredDate(item.consumedAt),
      lockedUntil: parseStoredDate(item.lockedUntil),
      save: async function () {
        _memAuthOtps.set(this.challengeId, this);
        persistMemoryAuth();
      }
    });
  }

  for (const item of payload.resets ?? []) {
    const expiresAt = parseStoredDate(item.expiresAt);
    if (!item.resetId || !expiresAt || expiresAt <= new Date()) continue;
    _memPasswordResets.set(item.resetId, {
      ...item,
      expiresAt,
      consumedAt: parseStoredDate(item.consumedAt),
      lockedUntil: parseStoredDate(item.lockedUntil),
      save: async function () {
        _memPasswordResets.set(this.resetId, this);
        persistMemoryAuth();
      }
    });
  }

  for (const item of payload.audits ?? []) {
    const createdAt = parseStoredDate(item.createdAt);
    if (!item.auditId || !createdAt) continue;
    _memAuthAudits.push({ ...item, createdAt });
  }
}

function persistMemoryAuth(): void {
  if (!memoryAuthPersistenceEnabled()) return;
  try {
    const users = [..._memAuthUsers.values()].map(({ save: _save, ...user }) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lockedUntil: user.lockedUntil?.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString(),
      googleClaimsCapturedAt: user.googleClaimsCapturedAt?.toISOString(),
      deletedAt: user.deletedAt?.toISOString()
    }));
    const sessions = [..._memAuthSessionsForTest.values()].map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString()
    }));
    const challenges = [..._memAuthOtps.values()].map(({ save: _save, ...challenge }) => ({
      ...challenge,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAvailableAt.toISOString(),
      consumedAt: challenge.consumedAt?.toISOString(),
      lockedUntil: challenge.lockedUntil?.toISOString()
    }));
    const resets = [..._memPasswordResets.values()].map(({ save: _save, ...reset }) => ({
      ...reset,
      expiresAt: reset.expiresAt.toISOString(),
      consumedAt: reset.consumedAt?.toISOString(),
      lockedUntil: reset.lockedUntil?.toISOString()
    }));
    const audits = _memAuthAudits.slice(-1000).map((audit) => ({
      ...audit,
      createdAt: audit.createdAt.toISOString()
    }));
    writeJsonFile(resolveRuntimeFilePath(env.authMemoryStoreFile), {
      schemaVersion: 1,
      users,
      sessions,
      challenges,
      resets,
      audits,
      updatedAt: new Date().toISOString()
    } satisfies PersistedAuthStore);
  } catch {
    // Development persistence must not make authentication unavailable.
  }
}

function parseStoredDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

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
    loginFailureCount: (input.loginFailureCount as number | undefined) ?? 0,
    lockedUntil: input.lockedUntil as Date | undefined,
    lastLoginAt: input.lastLoginAt as Date | undefined,
    passwordHash: input.passwordHash as string | undefined,
    deletedAt: input.deletedAt as Date | undefined,
    createdAt: (input.createdAt as Date | undefined) ?? new Date(),
    updatedAt: (input.updatedAt as Date | undefined) ?? new Date(),
    save: async function () {
      this.updatedAt = new Date();
      _memAuthUsers.set(this.id, this);
      if (this.email) _memAuthByEmail.set(this.email, this.id);
      if (this.phone) _memAuthByPhone.set(this.phone, this.id);
      if (this.googleId) _memAuthByGoogle.set(this.googleId, this.id);
      persistMemoryAuth();
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

export function getAuthPublicConfig(): AuthPublicConfig {
  return {
    google: {
      enabled: Boolean(env.authGoogleClientId),
      clientId: env.authGoogleClientId || undefined
    },
    password: {
      enabled: true,
      minimumLength: 12
    },
    otp: {
      emailEnabled: env.authDeliveryPreview || Boolean(env.emailProvider === "brevo" && env.emailApiKey && env.emailFromAddress),
      phoneEnabled: env.authPhoneEnabled && (env.authDeliveryPreview || Boolean(env.emailApiKey && env.brevoSmsSender)),
      length: Math.max(4, Math.min(10, env.authOtpLength)),
      expiresInMinutes: env.authOtpTtlMinutes,
      resendCooldownSeconds: env.authOtpResendCooldownSeconds
    }
  };
}

export function getDevelopmentAuthSnapshot(limit = 250) {
  ensureMemoryAuthLoaded();
  const users = [..._memAuthUsers.values()]
    .filter((user) => user.lifecycleState !== "DELETED")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, limit)
    .map((user) => ({
      ...toUserProfile(user as unknown as AuthUserDocument),
      loginFailureCount: user.loginFailureCount
    }));
  const sessions = [..._memAuthSessionsForTest.values()]
    .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
    .map((session) => ({
      sessionId: session.sessionId,
      userId: session.userId,
      deviceId: session.deviceId,
      deviceLabel: session.deviceLabel,
      provider: session.provider,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString()
    }));
  const audits = _memAuthAudits
    .slice(-Math.max(limit, 100))
    .reverse()
    .map((audit) => ({ ...audit, createdAt: audit.createdAt.toISOString() }));
  return { users, sessions, audits };
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

  let google: GoogleIdentity;
  try {
    google = await verifyGoogleCredential(input.credential);
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
  ensureIdentifierDeliveryAvailable(input.identifierType);
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  await enforceThrottle("otp_request", `ip:${context.ipHash}`, 8, 10 * 60_000, context, identifier);
  await enforceThrottle("otp_request", `device:${context.deviceFingerprintHash}`, 8, 10 * 60_000, context, identifier);
  await enforceThrottle("otp_request", `identifier:${identifier}`, 3, 10 * 60_000, context, identifier);

  const cooldown = await findActiveOtpCooldown(identifier, input.purpose);
  if (cooldown) {
    await writeAudit("throttle_triggered", false, context, { identifier, reason: "OTP resend cooldown active" });
    throw new AuthError(`OTP resend cooldown active until ${cooldown.resendAvailableAt.toISOString()}.`, 429);
  }

  const existing = await findUserByIdentifier(input.identifierType, identifier);
  let user: AuthUserDocument;
  if (input.purpose === "login") {
    if (!existing) {
      await writeAudit("otp_requested", false, context, { identifier, reason: "No account found for OTP login" });
      throw new AuthError("Unable to send a login code. Check the identifier or create an account.", 401);
    }
    await ensureUserCanAuthenticate(existing);
    user = existing;
  } else if (input.purpose === "signup") {
    if (existing && existing.lifecycleState === "VERIFIED") {
      throw new AuthError("An account already exists for this identifier. Sign in instead.", 409);
    }
    user = existing ?? await linkOrCreateUser({
      provider: input.identifierType === "email" ? "email_otp" : "phone_otp",
      email: input.identifierType === "email" ? identifier : undefined,
      phone: input.identifierType === "phone" ? identifier : undefined
    });
  } else {
    if (!existing) throw new AuthError("Unable to create an OTP challenge for this account.", 401);
    user = existing;
  }
  const challenge = await createOtpChallenge(input.identifierType, identifier, input.purpose, user, context);
  await writeAudit("otp_requested", true, context, { user, identifier, metadata: { purpose: input.purpose, challengeId: challenge.challengeId } });
  return challenge;
}

export async function verifyOtp(input: OtpVerifyInput, context: AuthContext): Promise<AuthResponse> {
  await enforceThrottle("otp_verify", `ip:${context.ipHash}`, 12, 10 * 60_000, context);
  await enforceThrottle("otp_verify", `device:${context.deviceFingerprintHash}`, 12, 10 * 60_000, context);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!isMongoConnected()) ensureMemoryAuthLoaded();
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
  if (challenge.purpose === "signup" && challenge.pendingPasswordHash) {
    user.passwordHash = challenge.pendingPasswordHash;
    addProvider(user, "password");
  }
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
  ensureIdentifierDeliveryAvailable(input.identifierType);
  const identifier = normalizeIdentifier(input.identifierType, input.identifier);
  const existing = await findUserByIdentifier(input.identifierType, identifier);
  if (existing && existing.lifecycleState !== "PENDING") {
    await writeAudit("password_register", false, context, { user: existing, identifier, reason: "Account already exists" });
    throw new AuthError("An account already exists for this identifier. Sign in or reset your password.", 409);
  }
  const user = existing ?? await linkOrCreateUser({
    provider: "password",
    email: input.identifierType === "email" ? identifier : undefined,
    phone: input.identifierType === "phone" ? identifier : undefined,
    displayName: input.displayName
  });
  user.displayName = input.displayName?.trim() || user.displayName;
  user.lifecycleState = user.emailVerified || user.phoneVerified || user.googleVerified ? "VERIFIED" : "PENDING";
  await user.save();
  const otpChallenge = await createOtpChallenge(input.identifierType, identifier, "signup", user, context, hashPassword(input.password));
  await writeAudit("password_register", true, context, { user, identifier, metadata: { otpChallengeId: otpChallenge.challengeId } });

  return {
    user: toUserProfile(user),
    requiresVerification: user.lifecycleState === "PENDING",
    otpChallenge,
    message: existing
      ? "Account verification restarted. Enter the code we sent to finish signup."
      : "Password account created. Enter the code we sent to finish signup."
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
  ensureIdentifierDeliveryAvailable(input.identifierType);
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
      delivery: {
        channel: input.identifierType === "email" ? "email" : "sms",
        message: "If an account exists, a password reset code has been sent."
      }
    };
  }

  const resetId = makeId("reset");
  const token = generateOtpCode();
  if (!isMongoConnected()) {
    ensureMemoryAuthLoaded();
    const expiresAt = minutesFromNow(env.authPasswordResetMinutes);
    const reset: MemPasswordReset = {
      resetId,
      userId: String((user as unknown as MemAuthUser).id),
      identifierType: input.identifierType,
      identifier,
      tokenHash: hashResetToken(resetId, token),
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
      ipHash: context.ipHash,
      deviceFingerprintHash: context.deviceFingerprintHash,
      save: async function () {
        _memPasswordResets.set(this.resetId, this);
        persistMemoryAuth();
      }
    };
    _memPasswordResets.set(resetId, reset);
    persistMemoryAuth();
    let delivery;
    try {
      delivery = await deliverAuthenticationCode(input.identifierType, identifier, token, "password_reset", env.authPasswordResetMinutes);
    } catch (error) {
      _memPasswordResets.delete(resetId);
      persistMemoryAuth();
      throw error;
    }
    await writeAudit("password_reset_requested", true, context, { user, identifier, metadata: { resetId } });
    return {
      resetId,
      maskedDestination: maskIdentifier(input.identifierType, identifier),
      expiresAt: expiresAt.toISOString(),
      maxAttempts: reset.maxAttempts,
      delivery
    };
  }
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
  let delivery;
  try {
    delivery = await deliverAuthenticationCode(input.identifierType, identifier, token, "password_reset", env.authPasswordResetMinutes);
  } catch (error) {
    await AuthPasswordReset.deleteOne({ resetId });
    throw error;
  }
  await writeAudit("password_reset_requested", true, context, { user, identifier, metadata: { resetId } });
  return {
    resetId: reset.resetId,
    maskedDestination: maskIdentifier(input.identifierType, identifier),
    expiresAt: reset.expiresAt.toISOString(),
    maxAttempts: reset.maxAttempts,
    delivery
  };
}

export async function resetPassword(input: PasswordResetInput, context: AuthContext): Promise<AuthResponse> {
  validatePassword(input.newPassword);
  if (!isMongoConnected()) ensureMemoryAuthLoaded();
  const reset = !isMongoConnected()
    ? (_memPasswordResets.get(input.resetId) ?? null)
    : await AuthPasswordReset.findOne({ resetId: input.resetId });
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

  const user = !isMongoConnected()
    ? (_memAuthUsers.get(String(reset.userId)) as unknown as AuthUserDocument | undefined)
    : await AuthUser.findById(reset.userId);
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
    ensureMemoryAuthLoaded();
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
    persistMemoryAuth();
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
    ensureMemoryAuthLoaded();
    // Find session by sessionId or by refreshTokenHash
    let memSess: MemAuthSession | undefined;
    if (input.sessionId) {
      memSess = _memAuthSessionsForTest.get(input.sessionId);
    } else if (input.refreshToken) {
      const rHash = hashSecret(input.refreshToken);
      memSess = [..._memAuthSessionsForTest.values()].find((s) => s.refreshTokenHash === rHash);
    }
    if (memSess && !memSess.revokedAt) {
      memSess.revokedAt = new Date();
      persistMemoryAuth();
    }
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
    ensureMemoryAuthLoaded();
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
  if (!isMongoConnected()) {
    ensureMemoryAuthLoaded();
    const session = _memAuthSessionsForTest.get(sessionId);
    if (!session || session.userId !== userId) throw new AuthError("Session not found.", 404);
    session.revokedAt = new Date();
    persistMemoryAuth();
    return { message: "Session revoked." };
  }
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
    ensureMemoryAuthLoaded();
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

async function findActiveOtpCooldown(
  identifier: string,
  purpose: OtpPurpose
): Promise<{ resendAvailableAt: Date } | null> {
  const now = new Date();
  if (!isMongoConnected()) {
    ensureMemoryAuthLoaded();
    return [..._memAuthOtps.values()]
      .filter((challenge) =>
        challenge.identifier === identifier &&
        challenge.purpose === purpose &&
        !challenge.consumedAt &&
        challenge.resendAvailableAt > now
      )
      .sort((left, right) => right.resendAvailableAt.getTime() - left.resendAvailableAt.getTime())[0] ?? null;
  }

  return AuthOtpChallenge.findOne({
    identifier,
    purpose,
    consumedAt: { $exists: false },
    resendAvailableAt: { $gt: now }
  }).sort({ createdAt: -1 });
}

async function createOtpChallenge(
  identifierType: AuthIdentifierType,
  identifier: string,
  purpose: OtpPurpose,
  user: AuthUserDocument,
  context: AuthContext,
  pendingPasswordHash?: string
): Promise<OtpChallengeResponse> {
  const challengeId = makeId("otp");
  const code = generateOtpCode();

  if (!isMongoConnected()) {
    ensureMemoryAuthLoaded();
    ensureMemoryAuthLoaded();
    const codeHash = hashOtp(challengeId, code);
    const expiresAt = minutesFromNow(env.authOtpTtlMinutes);
    const resendAvailableAt = secondsFromNow(env.authOtpResendCooldownSeconds);
    const otp: MemAuthOtp = {
      challengeId, userId: (user as unknown as { id: string }).id,
      identifierType, identifier, purpose, codeHash, pendingPasswordHash, expiresAt, resendAvailableAt,
      attempts: 0, maxAttempts: 3,
      ipHash: context.ipHash, deviceFingerprintHash: context.deviceFingerprintHash,
      save: async function () {
        _memAuthOtps.set(this.challengeId, this);
        persistMemoryAuth();
      }
    };
    _memAuthOtps.set(challengeId, otp);
    persistMemoryAuth();
    let delivery;
    try {
      delivery = await deliverAuthenticationCode(identifierType, identifier, code, purpose, env.authOtpTtlMinutes);
    } catch (error) {
      _memAuthOtps.delete(challengeId);
      persistMemoryAuth();
      throw error;
    }
    return {
      challengeId, identifierType, maskedDestination: maskIdentifier(identifierType, identifier),
      purpose, expiresAt: expiresAt.toISOString(), resendAvailableAt: resendAvailableAt.toISOString(),
      maxAttempts: 3,
      delivery
    };
  }

  const challenge = await AuthOtpChallenge.create({
    challengeId,
    userId: user._id,
    identifierType,
    identifier,
    purpose,
    codeHash: hashOtp(challengeId, code),
    pendingPasswordHash,
    expiresAt: minutesFromNow(env.authOtpTtlMinutes),
    resendAvailableAt: secondsFromNow(env.authOtpResendCooldownSeconds),
    attempts: 0,
    maxAttempts: 3,
    ipHash: context.ipHash,
    deviceFingerprintHash: context.deviceFingerprintHash
  });
  let delivery;
  try {
    delivery = await deliverAuthenticationCode(identifierType, identifier, code, purpose, env.authOtpTtlMinutes);
  } catch (error) {
    await AuthOtpChallenge.deleteOne({ challengeId });
    throw error;
  }
  return {
    challengeId: challenge.challengeId,
    identifierType,
    maskedDestination: maskIdentifier(identifierType, identifier),
    purpose,
    expiresAt: challenge.expiresAt.toISOString(),
    resendAvailableAt: challenge.resendAvailableAt.toISOString(),
    maxAttempts: challenge.maxAttempts,
    delivery
  };
}

async function deliverAuthenticationCode(
  identifierType: AuthIdentifierType,
  identifier: string,
  code: string,
  purpose: OtpPurpose,
  expiresInMinutes: number
) {
  try {
    return await sendAuthenticationCode({ identifierType, identifier, code, purpose, expiresInMinutes });
  } catch (error) {
    if (error instanceof AuthenticationDeliveryError) throw new AuthError(error.message, 503);
    throw error;
  }
}

function ensureIdentifierDeliveryAvailable(identifierType: AuthIdentifierType): void {
  if (identifierType === "phone" && !env.authPhoneEnabled) {
    throw new AuthError("Phone authentication is not enabled. Use email or Google sign-in.", 400);
  }
}

async function resolveChallengeUser(challenge: { userId?: unknown; identifierType: AuthIdentifierType; identifier: string }): Promise<AuthUserDocument> {
  if (!isMongoConnected() && challenge.userId) {
    ensureMemoryAuthLoaded();
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
    ensureMemoryAuthLoaded();
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
    ensureMemoryAuthLoaded();
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
    ensureMemoryAuthLoaded();
    const user = _memAuthUsers.get(userId);
    if (user) {
      user.lifecycleState = "LOCKED";
      user.lockedUntil = lockedUntil;
      persistMemoryAuth();
    }
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
    ensureMemoryAuthLoaded();
    const memUser = user as unknown as MemAuthUser;
    const memSess: MemAuthSession = {
      sessionId, userId: memUser.id, deviceId: context.deviceId, deviceLabel: context.deviceLabel,
      deviceFingerprintHash: context.deviceFingerprintHash, ipHash: context.ipHash, provider,
      refreshTokenHash: hashSecret(tokens.refreshToken), accessTokenJti: payload.jti,
      lastSeenAt: new Date(), expiresAt: new Date(tokens.accessTokenExpiresAt),
      refreshExpiresAt: new Date(tokens.refreshTokenExpiresAt), createdAt: new Date()
    };
    _memAuthSessionsForTest.set(sessionId, memSess);
    persistMemoryAuth();
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

const googleTokenVerifier = new OAuth2Client();

async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
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

  if (!env.authGoogleClientId) throw new AuthError("Google sign-in is not configured.", 503);

  try {
    const ticket = await googleTokenVerifier.verifyIdToken({
      idToken: credential,
      audience: env.authGoogleClientId
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new AuthError("Google credential is missing the account identifier.", 401);
    const claims = payload as typeof payload & { locale?: string };
    return {
      googleId: payload.sub,
      email: payload.email ? normalizeIdentifier("email", payload.email) : undefined,
      displayName: payload.name,
      givenName: payload.given_name,
      familyName: payload.family_name,
      avatarUrl: payload.picture,
      locale: claims.locale,
      hostedDomain: payload.hd,
      availableClaims: Object.keys(payload).sort(),
      emailVerified: Boolean(payload.email_verified)
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("Google credential verification failed. Please try Google sign-in again.", 401);
  }
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
  if (!isMongoConnected()) {
    ensureMemoryAuthLoaded();
    _memAuthAudits.push({
      auditId: makeId("audit"),
      userId: input.user ? String((input.user as unknown as MemAuthUser).id) : input.userId,
      identifier: input.identifier,
      eventType,
      success,
      reason: input.reason,
      ipHash: context.ipHash,
      deviceFingerprintHash: context.deviceFingerprintHash,
      userAgent: context.userAgent,
      metadata: input.metadata,
      createdAt: new Date()
    });
    if (_memAuthAudits.length > 1000) _memAuthAudits.splice(0, _memAuthAudits.length - 1000);
    persistMemoryAuth();
    return;
  }
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
  if (password.length < 12) throw new AuthError("Password must be at least 12 characters.", 400);
  if (password.length > 128) throw new AuthError("Password must not exceed 128 characters.", 400);
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new AuthError("Password must include uppercase, lowercase, number, and symbol characters.", 400);
  }
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
