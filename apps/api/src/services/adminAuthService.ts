import { createHash, createHmac, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { AdminAuditLog, type AdminAuditLogDocument } from "../models/AdminAuditLog.js";
import { AdminSession, type AdminSessionDocument } from "../models/AdminSession.js";
import { AdminUser, type AdminRole, type AdminUserDocument } from "../models/AdminUser.js";
import { makeId } from "../utils/crypto.js";
import { isMongoConnected } from "../db/mongoose.js";

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

interface AdminTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: "admin";
  role: AdminRole;
  email: string;
  iat: number;
  exp: number;
}

export interface VerifiedAdminToken {
  adminUserId: string;
  sessionId: string;
  jti: string;
  role: AdminRole;
  email: string;
}

// ── In-memory stores (test / no-DB mode) ──────────────────────────────────────
type MemAdminUser = {
  _id: { toString(): string };
  adminUserId: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  loginFailureCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  save(): Promise<void>;
};

type MemAdminSession = {
  sessionId: string;
  adminUserId: string;
  role: AdminRole;
  jti: string;
  tokenHash: string;
  ipHash: string;
  userAgent: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
};

const _memAdminUsers = new Map<string, MemAdminUser>();    // key: adminUserId
const _memAdminByEmail = new Map<string, string>();         // key: email → adminUserId
const _memAdminSessions = new Map<string, MemAdminSession>(); // key: jti

function makeMemAdminUser(opts: {
  adminUserId: string; email: string; passwordHash: string; role: AdminRole; createdBy: string;
}): MemAdminUser {
  const user: MemAdminUser = {
    _id: { toString: () => opts.adminUserId },
    adminUserId: opts.adminUserId,
    email: opts.email,
    passwordHash: opts.passwordHash,
    role: opts.role,
    isActive: true,
    loginFailureCount: 0,
    createdBy: opts.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async function () {
      _memAdminUsers.set(this.adminUserId, this);
      _memAdminByEmail.set(this.email, this.adminUserId);
    }
  };
  return user;
}

// ── Login ──────────────────────────────────────────────────────────────────────

export async function loginAdmin(
  email: string,
  password: string,
  ipHash: string,
  userAgent: string
): Promise<{ user: AdminUserDocument; token: string; sessionId: string }> {
  const normalized = (email ?? "").toLowerCase().trim();

  if (!isMongoConnected()) {
    const userId = _memAdminByEmail.get(normalized);
    const user = userId ? _memAdminUsers.get(userId) : undefined;
    if (!user || !user.isActive) throw new AdminAuthError("Invalid credentials.", 401);
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new AdminAuthError(`Account locked until ${user.lockedUntil.toISOString()}.`, 423);
    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      user.loginFailureCount = (user.loginFailureCount ?? 0) + 1;
      if (user.loginFailureCount >= env.adminLoginMaxAttempts) {
        user.lockedUntil = new Date(Date.now() + env.adminLockMinutes * 60_000);
      }
      throw new AdminAuthError("Invalid credentials.", 401);
    }
    user.loginFailureCount = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    const { token, sessionId } = createMemAdminSession(user, ipHash, userAgent);
    return { user: user as unknown as AdminUserDocument, token, sessionId };
  }

  const user = await AdminUser.findOne({ email: normalized });
  if (!user || !user.isActive) {
    await writeAudit({ adminEmail: normalized, role: "unknown", action: "admin.login_failed", success: false, ipHash, userAgent, metadata: { reason: "not_found_or_inactive" } });
    throw new AdminAuthError("Invalid credentials.", 401);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await writeAudit({ adminEmail: user.email, role: user.role, action: "admin.login_locked", success: false, ipHash, userAgent });
    throw new AdminAuthError(`Account locked until ${user.lockedUntil.toISOString()}.`, 423);
  }
  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    user.loginFailureCount = (user.loginFailureCount ?? 0) + 1;
    if (user.loginFailureCount >= env.adminLoginMaxAttempts) {
      user.lockedUntil = new Date(Date.now() + env.adminLockMinutes * 60_000);
    }
    await user.save();
    await writeAudit({ adminEmail: user.email, role: user.role, action: "admin.login_failed", success: false, ipHash, userAgent, metadata: { attempts: user.loginFailureCount } });
    throw new AdminAuthError("Invalid credentials.", 401);
  }
  user.loginFailureCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  const { token, sessionId } = await createAdminSession(user, ipHash, userAgent);
  await writeAudit({ adminUserId: user._id as Types.ObjectId, adminEmail: user.email, role: user.role, action: "admin.login", success: true, ipHash, userAgent, metadata: { sessionId } });
  return { user, token, sessionId };
}

// ── Logout ─────────────────────────────────────────────────────────────────────

export async function logoutAdmin(
  jti: string,
  adminEmail: string,
  role: string,
  ipHash: string,
  userAgent: string
): Promise<void> {
  if (!isMongoConnected()) {
    const session = _memAdminSessions.get(jti);
    if (session && !session.revokedAt) session.revokedAt = new Date();
    return;
  }
  const session = await AdminSession.findOne({ jti });
  if (session && !session.revokedAt) {
    session.revokedAt = new Date();
    await session.save();
  }
  await writeAudit({ adminEmail, role, action: "admin.logout", success: true, ipHash, userAgent });
}

// ── Verify token ───────────────────────────────────────────────────────────────

export async function verifyAdminToken(token: string): Promise<VerifiedAdminToken> {
  const payload = readSignedAdminToken(token);

  if (!isMongoConnected()) {
    const session = _memAdminSessions.get(payload.jti);
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AdminAuthError("Admin session expired or revoked.", 401);
    }
    return { adminUserId: payload.sub, sessionId: payload.sid, jti: payload.jti, role: payload.role, email: payload.email };
  }

  const session = await AdminSession.findOne({ jti: payload.jti });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AdminAuthError("Admin session expired or revoked.", 401);
  }
  return { adminUserId: payload.sub, sessionId: payload.sid, jti: payload.jti, role: payload.role, email: payload.email };
}

// ── Bootstrap first owner ──────────────────────────────────────────────────────

export async function bootstrapOwner(
  ownerKey: string,
  email = "owner@systolab.local",
  password = ownerKey,
  ipHash = "internal",
  userAgent = "internal"
): Promise<AdminUserDocument> {
  if (!isMongoConnected()) {
    const existing = [..._memAdminUsers.values()].find((u) => u.role === "owner" && u.isActive);
    if (existing) return existing as unknown as AdminUserDocument;
    validateEmail(email);
    validatePassword(password);
    const adminUserId = makeId("adm");
    const user = makeMemAdminUser({
      adminUserId, email: email.toLowerCase().trim(),
      passwordHash: hashPassword(password), role: "owner", createdBy: "bootstrap"
    });
    _memAdminUsers.set(adminUserId, user);
    _memAdminByEmail.set(user.email, adminUserId);
    return user as unknown as AdminUserDocument;
  }

  if (!constantTimeEquals(ownerKey, env.ownerAdminKey)) {
    await writeAudit({ adminEmail: email, role: "bootstrap", action: "admin.bootstrap", success: false, ipHash, userAgent, metadata: { reason: "invalid_owner_key" } });
    throw new AdminAuthError("Invalid bootstrap key.", 403);
  }
  const ownerCount = await AdminUser.countDocuments({ role: "owner", isActive: true });
  if (ownerCount > 0) {
    throw new AdminAuthError("Bootstrap unavailable: an active owner account already exists.", 409);
  }
  validateEmail(email);
  validatePassword(password);
  const existing = await AdminUser.findOne({ email: email.toLowerCase().trim() });
  if (existing) throw new AdminAuthError("Email already registered.", 409);

  const user = new AdminUser({
    adminUserId: makeId("adm"),
    email: email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    role: "owner",
    isActive: true,
    createdBy: "bootstrap"
  });
  await user.save();
  await writeAudit({ adminUserId: user._id as Types.ObjectId, adminEmail: user.email, role: "owner", action: "admin.bootstrap", success: true, ipHash, userAgent, metadata: { adminUserId: user.adminUserId } });
  return user;
}

// ── Create admin user (owner only) ────────────────────────────────────────────

export async function createAdminUser(
  email: string,
  password: string,
  role: AdminRole,
  createdBy = "system",
  createdByEmail = "system@systolab.local",
  ipHash = "internal",
  userAgent = "internal"
): Promise<AdminUserDocument> {
  validateEmail(email);
  validatePassword(password);

  if (!isMongoConnected()) {
    const normalized = email.toLowerCase().trim();
    if (_memAdminByEmail.has(normalized)) throw new AdminAuthError("Email already registered.", 409);
    const adminUserId = makeId("adm");
    const user = makeMemAdminUser({
      adminUserId, email: normalized, passwordHash: hashPassword(password), role, createdBy
    });
    _memAdminUsers.set(adminUserId, user);
    _memAdminByEmail.set(normalized, adminUserId);
    return user as unknown as AdminUserDocument;
  }

  const existing = await AdminUser.findOne({ email: email.toLowerCase().trim() });
  if (existing) throw new AdminAuthError("Email already registered.", 409);

  const user = new AdminUser({
    adminUserId: makeId("adm"),
    email: email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    role,
    isActive: true,
    createdBy
  });
  await user.save();
  await writeAudit({ adminEmail: createdByEmail, role: "owner", action: "admin.create", success: true, ipHash, userAgent, metadata: { newAdminId: user.adminUserId, newEmail: email, newRole: role } });
  return user;
}

// ── List / deactivate admin users ─────────────────────────────────────────────

export async function listAdminUsers(): Promise<AdminUserDocument[]> {
  if (!isMongoConnected()) return [..._memAdminUsers.values()] as unknown as AdminUserDocument[];
  return AdminUser.find({}).sort({ createdAt: 1 });
}

export async function deactivateAdminUser(
  targetAdminUserId: string,
  actorAdminUserId = "system",
  actorEmail = "system@systolab.local",
  ipHash = "internal",
  userAgent = "internal"
): Promise<AdminUserDocument> {
  if (targetAdminUserId === actorAdminUserId) throw new AdminAuthError("Cannot deactivate your own account.", 400);

  if (!isMongoConnected()) {
    const user = _memAdminUsers.get(targetAdminUserId);
    if (!user) throw new AdminAuthError("Admin user not found.", 404);
    user.isActive = false;
    return user as unknown as AdminUserDocument;
  }

  const user = await AdminUser.findOne({ adminUserId: targetAdminUserId });
  if (!user) throw new AdminAuthError("Admin user not found.", 404);
  user.isActive = false;
  await user.save();
  await AdminSession.updateMany({ adminUserId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  await writeAudit({ adminEmail: actorEmail, role: "owner", action: "admin.deactivate", success: true, ipHash, userAgent, metadata: { targetAdminUserId, targetEmail: user.email } });
  return user;
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export async function listAdminSessions(adminUserId: string): Promise<AdminSessionDocument[]> {
  const user = await AdminUser.findOne({ adminUserId });
  if (!user) return [];
  return AdminSession.find({ adminUserId: user._id, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
}

export async function revokeAdminSession(
  sessionId: string,
  actorAdminUserId: string,
  actorEmail: string,
  role: string,
  ipHash: string,
  userAgent: string
): Promise<void> {
  const user = await AdminUser.findOne({ adminUserId: actorAdminUserId });
  if (!user) throw new AdminAuthError("Admin user not found.", 404);
  const session = await AdminSession.findOne({ sessionId, adminUserId: user._id });
  if (!session) throw new AdminAuthError("Session not found.", 404);
  session.revokedAt = new Date();
  await session.save();
  await writeAudit({ adminUserId: user._id as Types.ObjectId, adminEmail: actorEmail, role, action: "admin.session_revoke", success: true, ipHash, userAgent, metadata: { sessionId } });
}

// ── Audit logs ─────────────────────────────────────────────────────────────────

export async function listAdminAuditLogs(limit = 100): Promise<AdminAuditLogDocument[]> {
  return AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(limit);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function createMemAdminSession(user: MemAdminUser, ipHash: string, userAgent: string): { token: string; sessionId: string } {
  const sessionId = makeId("asess");
  const jti = makeId("ajti");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + env.adminSessionHours * 60 * 60 * 1000);

  const payload: AdminTokenPayload = {
    sub: user.adminUserId, sid: sessionId, jti, typ: "admin",
    role: user.role, email: user.email, iat: now, exp: Math.floor(expiresAt.getTime() / 1000)
  };
  const token = signAdminToken(payload);

  _memAdminSessions.set(jti, {
    sessionId, adminUserId: user.adminUserId, role: user.role, jti,
    tokenHash: sha256local(token), ipHash, userAgent: userAgent.slice(0, 300),
    expiresAt, createdAt: new Date()
  });

  return { token, sessionId };
}

async function createAdminSession(
  user: AdminUserDocument,
  ipHash: string,
  userAgent: string
): Promise<{ token: string; sessionId: string }> {
  const sessionId = makeId("asess");
  const jti = makeId("ajti");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + env.adminSessionHours * 60 * 60 * 1000);

  const payload: AdminTokenPayload = {
    sub: user.adminUserId,
    sid: sessionId,
    jti,
    typ: "admin",
    role: user.role,
    email: user.email,
    iat: now,
    exp: Math.floor(expiresAt.getTime() / 1000)
  };
  const token = signAdminToken(payload);

  await AdminSession.create({
    sessionId,
    adminUserId: user._id,
    role: user.role,
    jti,
    tokenHash: sha256local(token),
    ipHash,
    userAgent: userAgent.slice(0, 300),
    expiresAt
  });

  return { token, sessionId };
}

function signAdminToken(payload: AdminTokenPayload): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "SYSTOLAB-ADMIN-JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", env.adminJwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function readSignedAdminToken(token: string): AdminTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AdminAuthError("Invalid admin token.", 401);
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", env.adminJwtSecret).update(`${header}.${body}`).digest("base64url");
  if (!compareRaw(sig, expected)) throw new AdminAuthError("Invalid admin token signature.", 401);
  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminTokenPayload;
  } catch {
    throw new AdminAuthError("Malformed admin token.", 401);
  }
  if (payload.typ !== "admin") throw new AdminAuthError("Invalid admin token type.", 401);
  if (payload.exp * 1000 <= Date.now()) throw new AdminAuthError("Admin token expired.", 401);
  return payload;
}

function hashPassword(password: string): string {
  const salt = randomUUID().replace(/-/g, "");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const derived = scryptSync(password, salt, 64).toString("hex");
    return compareRaw(derived, hash);
  } catch {
    return false;
  }
}

function compareRaw(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const l = createHash("sha256").update(left).digest();
  const r = createHash("sha256").update(right).digest();
  return timingSafeEqual(l, r);
}

function sha256local(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function validateEmail(email: string): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AdminAuthError("A valid email address is required.", 400);
  }
}

function validatePassword(password: string): void {
  if (!password || password.length < 12) {
    throw new AdminAuthError("Password must be at least 12 characters.", 400);
  }
}

interface AuditArgs {
  adminUserId?: Types.ObjectId;
  adminEmail: string;
  role: string;
  action: string;
  resource?: string;
  resourceId?: string;
  success: boolean;
  ipHash: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
}

async function writeAudit(args: AuditArgs): Promise<void> {
  try {
    await AdminAuditLog.create({ auditId: makeId("aaudit"), ...args });
  } catch {
    // audit failures must never block operations
  }
}

// Re-export for use in middleware
export type { AdminRole, AdminAuditLogDocument };
