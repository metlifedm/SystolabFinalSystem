import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AdminAuthError, verifyAdminToken } from "../services/adminAuthService.js";

export async function internalAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = String(req.headers["authorization"] ?? "");

  // Primary path: DB-backed admin session via Bearer token.
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const verified = await verifyAdminToken(token);
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

  // Fallback: env-key authentication.
  const supplied = String(req.headers["x-systolab-internal-key"] ?? "");
  if (!supplied || !constantTimeEquals(supplied, env.internalAdminKey)) {
    res.status(403).json({ error: { message: "Internal SYSTOLAB admin access is required." } });
    return;
  }
  next();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
