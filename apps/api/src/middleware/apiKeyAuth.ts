import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ApiKey } from "../models/ApiKey.js";
import { defaultBranding, Tenant } from "../models/Tenant.js";
import { sha256 } from "../utils/crypto.js";

declare global {
  namespace Express {
    interface Request {
      tenantBranding?: ReturnType<typeof defaultBranding>;
      tenantDoc?: import("../models/Tenant.js").TenantDocument;
    }
  }
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = req.header("x-systolab-api-key");
  if (!rawKey) {
    res.status(401).json({ error: { message: "x-systolab-api-key header is required." } });
    return;
  }

  if (env.nodeEnv !== "production" && rawKey === env.devApiKey) {
    req.tenantBranding = defaultBranding();
    next();
    return;
  }

  const keyHash = sha256(rawKey);
  const apiKey = await ApiKey.findOne({ keyHash, isActive: true });
  if (!apiKey) {
    res.status(401).json({ error: { message: "Invalid SYSTOLAB API key." } });
    return;
  }

  const tenant = await Tenant.findById(apiKey.tenantId);
  if (!tenant || !tenant.isActive) {
    res.status(403).json({ error: { message: "Tenant is inactive or unavailable." } });
    return;
  }

  apiKey.lastUsedAt = new Date();
  await apiKey.save();
  req.tenantDoc = tenant;
  req.tenantBranding = {
    tenantId: tenant.id,
    slug: tenant.slug,
    publicName: tenant.publicName,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    accentColor: tenant.accentColor,
    reportTitle: tenant.reportTitle,
    poweredByLabel: tenant.poweredByLabel,
    footerLabel: tenant.footerLabel,
    customDomain: tenant.customDomain
  };
  next();
}
