import type { NextFunction, Request, Response } from "express";
import type { AuthSessionSummary, AuthUserProfile } from "@systolab/shared";
import { getUserByAccessToken, toUserProfile } from "../services/authService.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: AuthUserProfile;
        session: AuthSessionSummary;
      };
    }
  }
}

export async function authOptional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    next();
    return;
  }
  try {
    const { user, session } = await getUserByAccessToken(token);
    req.auth = {
      user: toUserProfile(user),
      session: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        deviceLabel: session.deviceLabel,
        provider: session.provider,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString()
      }
    };
  } catch {
    req.auth = undefined;
  }
  next();
}
