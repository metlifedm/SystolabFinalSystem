import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";
import type { Logger } from "../utils/logger.js";
import { incrementCounter, recordHistogram } from "../services/metricsService.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      correlationId: string;
      log: Logger;
      startedAt: number;
    }
  }
}

// Strip dynamic path segments to keep metric label cardinality bounded.
function normalizeRoute(path: string): string {
  return (path.split("?")[0] ?? path)
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, "/:id")     // MongoDB ObjectId
    .replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, "/:id")     // UUID v4
    .replace(/\/[a-z]+_[0-9a-zA-Z]{8,}(?=\/|$)/g, "/:id"); // makeId format (bkp_..., alrt_..., etc.)
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomBytes(8).toString("hex");
  const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? requestId;
  const startedAt = Date.now();

  req.requestId = requestId;
  req.correlationId = correlationId;
  req.startedAt = startedAt;
  req.log = logger.child({ requestId, correlationId });

  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", correlationId);

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const route = normalizeRoute(req.path);
    const method = req.method;
    const status = String(res.statusCode);

    incrementCounter("systolab_http_requests_total", { method, route, status });
    recordHistogram("systolab_http_request_duration_ms", durationMs);

    req.log.info("http.access", {
      method,
      url: req.originalUrl,
      route,
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader("content-length") ?? 0,
      userAgent: req.headers["user-agent"] ?? ""
    });
  });

  next();
}
