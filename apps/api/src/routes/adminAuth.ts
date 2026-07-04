import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { requireAdminSession } from "../middleware/adminAuth.js";
import type { AdminRole } from "../models/AdminUser.js";
import {
  AdminAuthError,
  adminOwnerExists,
  bootstrapOwner,
  createAdminUser,
  deactivateAdminUser,
  listAdminAuditLogs,
  listAdminSessions,
  listAdminUsers,
  loginAdmin,
  logoutAdmin,
  revokeAdminSession
} from "../services/adminAuthService.js";

export const adminAuthRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Try again later." } }
});

// ── POST /login ────────────────────────────────────────────────────────────────

adminAuthRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const ownerExists = await adminOwnerExists();
    res.json({ ownerExists, setupRequired: !ownerExists, storageMode: env.memoryStore ? "memory" : "persistent" });
  } catch (error) {
    handleError(error, res);
  }
});
adminAuthRouter.post("/login", loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: { message: "email and password are required." } });
    return;
  }
  try {
    const ctx = requestContext(req);
    const { user, token, sessionId } = await loginAdmin(email, password, ctx.ipHash, ctx.userAgent);
    res.json({
      token,
      adminUserId: user.adminUserId,
      email: user.email,
      role: user.role,
      sessionId,
      expiresIn: env.adminSessionHours * 3600
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /logout ───────────────────────────────────────────────────────────────

adminAuthRouter.post("/logout", requireAdminSession(), async (req: Request, res: Response) => {
  try {
    const ctx = requestContext(req);
    const actor = req.adminUser!;
    await logoutAdmin(actor.jti, actor.email, actor.role, ctx.ipHash, ctx.userAgent);
    res.json({ message: "Logged out." });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /me ────────────────────────────────────────────────────────────────────

adminAuthRouter.get("/me", requireAdminSession(), (req: Request, res: Response) => {
  res.json({
    adminUserId: req.adminUser!.adminUserId,
    email: req.adminUser!.email,
    role: req.adminUser!.role,
    sessionId: req.adminUser!.sessionId
  });
});

// ── GET /sessions ──────────────────────────────────────────────────────────────

adminAuthRouter.get("/sessions", requireAdminSession(), async (req: Request, res: Response) => {
  const sessions = await listAdminSessions(req.adminUser!.adminUserId);
  res.json({
    items: sessions.map((s) => ({
      sessionId: s.sessionId,
      role: s.role,
      ipHash: s.ipHash,
      userAgent: s.userAgent,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt
    }))
  });
});

// ── DELETE /sessions/:sessionId ────────────────────────────────────────────────

adminAuthRouter.delete("/sessions/:sessionId", requireAdminSession(), async (req: Request, res: Response) => {
  try {
    const ctx = requestContext(req);
    const actor = req.adminUser!;
    await revokeAdminSession(req.params.sessionId!, actor.adminUserId, actor.email, actor.role, ctx.ipHash, ctx.userAgent);
    res.json({ message: "Session revoked." });
  } catch (error) {
    handleError(error, res);
  }
});

// ── POST /bootstrap — creates the first owner account ─────────────────────────
// Only works when no active owner exists. Requires SYSTOLAB_OWNER_ADMIN_KEY.

adminAuthRouter.post("/bootstrap", async (req: Request, res: Response) => {
  const { ownerKey, email, password } = req.body as { ownerKey?: string; email?: string; password?: string };
  if (!ownerKey || !email || !password) {
    res.status(400).json({ error: { message: "ownerKey, email, and password are required." } });
    return;
  }
  try {
    const ctx = requestContext(req);
    const user = await bootstrapOwner(ownerKey, email, password, ctx.ipHash, ctx.userAgent);
    res.status(201).json({ message: "Owner account created.", adminUserId: user.adminUserId, email: user.email, role: user.role });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /admins ────────────────────────────────────────────────────────────────

adminAuthRouter.get("/admins", requireAdminSession(["owner"]), async (_req: Request, res: Response) => {
  const users = await listAdminUsers();
  res.json({
    items: users.map((u) => ({
      adminUserId: u.adminUserId,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdBy: u.createdBy,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt
    }))
  });
});

// ── POST /admins ───────────────────────────────────────────────────────────────

adminAuthRouter.post("/admins", requireAdminSession(["owner"]), async (req: Request, res: Response) => {
  const { email, password, role } = req.body as { email?: string; password?: string; role?: AdminRole };
  if (!email || !password || !role) {
    res.status(400).json({ error: { message: "email, password, and role are required." } });
    return;
  }
  if (role !== "owner" && role !== "manager") {
    res.status(400).json({ error: { message: "role must be owner or manager." } });
    return;
  }
  try {
    const ctx = requestContext(req);
    const actor = req.adminUser!;
    const user = await createAdminUser(email, password, role, actor.adminUserId, actor.email, ctx.ipHash, ctx.userAgent);
    res.status(201).json({ adminUserId: user.adminUserId, email: user.email, role: user.role, createdAt: user.createdAt });
  } catch (error) {
    handleError(error, res);
  }
});

// ── PATCH /admins/:adminUserId/deactivate ─────────────────────────────────────

adminAuthRouter.patch("/admins/:adminUserId/deactivate", requireAdminSession(["owner"]), async (req: Request, res: Response) => {
  try {
    const ctx = requestContext(req);
    const actor = req.adminUser!;
    const user = await deactivateAdminUser(req.params.adminUserId!, actor.adminUserId, actor.email, ctx.ipHash, ctx.userAgent);
    res.json({ message: "Admin user deactivated.", adminUserId: user.adminUserId, email: user.email });
  } catch (error) {
    handleError(error, res);
  }
});

// ── GET /audit-logs ────────────────────────────────────────────────────────────

adminAuthRouter.get("/audit-logs", requireAdminSession(["owner"]), async (req: Request, res: Response) => {
  const raw = Number(req.query["limit"] ?? 100);
  const limit = Number.isFinite(raw) ? Math.min(raw, 500) : 100;
  const logs = await listAdminAuditLogs(limit);
  res.json({ items: logs });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function requestContext(req: Request): { ipHash: string; userAgent: string } {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const rawIp = forwarded || req.ip || "unknown";
  return {
    ipHash: createHmac("sha256", env.adminJwtSecret).update(`ip:${rawIp}`).digest("hex"),
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300)
  };
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof AdminAuthError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  res.status(500).json({ error: { message: "Internal server error." } });
}
