import type { NextFunction, Request, Response } from "express";
import { checkApiQuota, recordApiGovernanceUsage } from "../services/platformControlPlaneService.js";
import { sha256 } from "../utils/crypto.js";

export async function apiGovernance(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantSlug = req.tenantBranding?.slug ?? "unknown";
  const rawKey = req.header("x-systolab-api-key") ?? "";
  const keyHashPrefix = rawKey ? sha256(rawKey).slice(0, 12) : undefined;
  const quota = await checkApiQuota({ tenantSlug, keyHashPrefix });

  if (!quota.allowed) {
    res.status(429).json({
      error: {
        message: "SYSTOLAB API quota exceeded for this quota window.",
        quotaWindow: quota.quotaWindow,
        quotaLimit: quota.quotaLimit,
        quotaUsed: quota.quotaUsed
      }
    });
    return;
  }

  res.on("finish", () => {
    void recordApiGovernanceUsage({
      tenantSlug,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      keyHashPrefix,
      apiVersion: "v1",
      payload: {
        ip: req.ip,
        userAgent: req.header("user-agent") ?? "unknown",
        quotaWindow: quota.quotaWindow
      }
    }).catch(() => undefined);
  });

  next();
}
