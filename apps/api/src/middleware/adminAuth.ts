import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { AdminAuditLog } from "../models/AdminAuditLog.js";
import type { AdminRole } from "../models/AdminUser.js";
import { AdminAuthError, verifyAdminToken } from "../services/adminAuthService.js";
import { makeId } from "../utils/crypto.js";

export interface AdminActorContext {
  adminUserId: string;
  email: string;
  role: AdminRole;
  sessionId: string;
  jti: string;
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminActorContext;
    }
  }
}

// ── Core session middleware ────────────────────────────────────────────────────

export function requireAdminSession(allowedRoles: AdminRole[] = ["owner", "manager"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = String(req.headers["authorization"] ?? "");
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: { message: "Admin Bearer token required." } });
      return;
    }
    const token = authHeader.slice(7);
    try {
      const verified = await verifyAdminToken(token);
      if (!allowedRoles.includes(verified.role)) {
        res.status(403).json({ error: { message: "Insufficient admin role for this operation." } });
        return;
      }
      req.adminUser = verified;
      next();
    } catch (error) {
      const msg = error instanceof AdminAuthError ? error.message : "Invalid admin token.";
      const status = error instanceof AdminAuthError ? error.status : 401;
      res.status(status).json({ error: { message: msg } });
    }
  };
}

// ── Destructive-action protection ─────────────────────────────────────────────

export function requireDestructiveConfirm(req: Request, res: Response, next: NextFunction): void {
  if (req.headers["x-confirm-destructive"] !== "true") {
    res.status(428).json({
      error: {
        message: "Destructive action requires the x-confirm-destructive: true header.",
        code: "DESTRUCTIVE_ACTION_CONFIRM_REQUIRED"
      }
    });
    return;
  }
  next();
}

// ── Actor-aware audit logging ─────────────────────────────────────────────────
// Attaches a res.on("finish") hook; non-blocking, never throws.

export function auditAdminAction(action: string, resource?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on("finish", () => {
      const success = res.statusCode < 400;
      const actor = req.adminUser;
      const resourceId = resolveResourceId(req);
      void writeAuditEntry({
        adminUserId: actor?.adminUserId,
        adminEmail: actor?.email ?? "unknown",
        role: actor?.role ?? "unknown",
        action,
        resource,
        resourceId,
        success,
        ipHash: hashIp(req),
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300)
      });
    });
    next();
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveResourceId(req: Request): string | undefined {
  return (
    req.params["id"] ??
    req.params["moduleId"] ??
    req.params["flagKey"] ??
    req.params["sessionId"] ??
    req.params["adminUserId"] ??
    undefined
  );
}

function hashIp(req: Request): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const rawIp = forwarded || req.ip || req.socket.remoteAddress || "unknown";
  return createHmac("sha256", env.adminJwtSecret).update(`ip:${rawIp}`).digest("hex");
}

interface AuditEntry {
  adminUserId?: string;
  adminEmail: string;
  role: string;
  action: string;
  resource?: string;
  resourceId?: string;
  success: boolean;
  ipHash: string;
  userAgent: string;
}

async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    await AdminAuditLog.create({ auditId: makeId("aaudit"), ...entry });
  } catch {
    // audit failures must never block operations
  }
}
