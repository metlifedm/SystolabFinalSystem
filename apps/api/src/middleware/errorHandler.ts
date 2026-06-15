import type { ErrorRequestHandler } from "express";
import { incrementCounter } from "../services/metricsService.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const explicitStatus = typeof (error as { status?: unknown }).status === "number" ? Number((error as { status?: number }).status) : undefined;
  const status = explicitStatus ?? (/not found/i.test(message) ? 404 : /invalid|required|allowed|blocked/i.test(message) ? 400 : 500);

  incrementCounter("systolab_errors_total", {
    type: status >= 500 ? "server_error" : "client_error",
    status: String(status)
  });

  if (status >= 500) {
    const reqLog = (req as typeof req & { log?: { error(msg: string, fields?: Record<string, unknown>): void } }).log;
    if (reqLog) {
      reqLog.error("unhandled_error", { status, message, stack: error instanceof Error ? error.stack : undefined });
    }
  }

  res.status(status).json({ error: { message, status } });
};
