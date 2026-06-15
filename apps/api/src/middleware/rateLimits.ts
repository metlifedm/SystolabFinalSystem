import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { incrementCounter } from "../services/metricsService.js";

function jsonMessage(message: string) {
  return { error: { message, status: 429 } };
}

function rateLimitHandler(type: string) {
  return (_req: Request, res: Response): void => {
    incrementCounter("systolab_rate_limit_hits_total", { type });
    res.status(429).json(jsonMessage(
      type === "auth"
        ? "Too many authentication requests. Please wait before retrying."
        : type === "scan"
          ? "Too many scan requests. Please wait before starting another scan."
          : type === "scan_status"
            ? "Too many scan status checks. Please wait before polling again."
          : type === "public_api"
            ? "SYSTOLAB public API rate limit exceeded. Please retry after the current window."
            : "Too many requests. Please slow down and retry shortly."
    ));
  };
}

export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.globalRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/api/internal/"),
  handler: rateLimitHandler("global")
});

export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.authRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("auth")
});

export const scanRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.scanRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("scan")
});

export const scanStatusRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.scanStatusRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("scan_status")
});

export const publicApiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.publicApiRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("public_api")
});
