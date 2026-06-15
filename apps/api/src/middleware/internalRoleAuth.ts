import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AdminAuthError, verifyAdminToken } from "../services/adminAuthService.js";

export type InternalAdminRole = "owner" | "manager";

// req.adminUser is declared in adminAuth.ts and shared via global augmentation.
// internalAdminRole is kept here for routes that only need the role scalar.
declare global {
  namespace Express {
    interface Request {
      internalAdminRole?: InternalAdminRole;
    }
  }
}

export function internalRoleAuth(allowedRoles: InternalAdminRole[] = ["owner", "manager"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = String(req.headers["authorization"] ?? "");

    // Primary path: DB-backed admin session via Bearer token.
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const verified = await verifyAdminToken(token);
        if (!allowedRoles.includes(verified.role)) {
          res.status(403).json({ error: { message: "Insufficient admin role for this operation." } });
          return;
        }
        req.adminUser = verified;
        req.internalAdminRole = verified.role;
        next();
      } catch (error) {
        const msg = error instanceof AdminAuthError ? error.message : "Invalid admin token.";
        const status = error instanceof AdminAuthError ? error.status : 401;
        res.status(status).json({ error: { message: msg } });
      }
      return;
    }

    // Fallback: env-key authentication (backward compat / bootstrap / dev).
    const supplied = String(req.headers["x-systolab-internal-key"] ?? "");
    const requestedRole = String(req.headers["x-systolab-admin-role"] ?? "owner") as InternalAdminRole;
    const role = resolveEnvKeyRole(supplied, requestedRole);

    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        error: { message: "Admin authentication required. Provide a valid admin Bearer token." }
      });
      return;
    }

    req.internalAdminRole = role;
    next();
  };
}

export function ownerOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.internalAdminRole !== "owner") {
    res.status(403).json({ error: { message: "Owner access is required for this operation." } });
    return;
  }
  next();
}

function resolveEnvKeyRole(supplied: string, requestedRole: InternalAdminRole): InternalAdminRole | null {
  if (!supplied) return null;
  if (env.nodeEnv !== "production" && constantTimeEquals(supplied, env.internalAdminKey)) {
    return requestedRole === "manager" ? "manager" : "owner";
  }
  if (constantTimeEquals(supplied, env.ownerAdminKey)) return "owner";
  if (constantTimeEquals(supplied, env.managerAdminKey)) return "manager";
  return null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
