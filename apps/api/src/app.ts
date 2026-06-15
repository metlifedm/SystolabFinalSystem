import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";
import { authRateLimit, globalRateLimit, publicApiRateLimit } from "./middleware/rateLimits.js";
import { adminAuthRouter } from "./routes/adminAuth.js";
import { agencyRouter } from "./routes/agency.js";
import { authRouter } from "./routes/auth.js";
import { coverageRouter } from "./routes/coverage.js";
import { healthRouter } from "./routes/health.js";
import { intelligenceRouter } from "./routes/intelligence.js";
import { internalIireRouter } from "./routes/internalIire.js";
import { internalPlatformRouter } from "./routes/internalPlatform.js";
import { invitationsRouter } from "./routes/invitations.js";
import artifactsRouter from "./routes/artifacts.js";
import { metricsRouter } from "./routes/metrics.js";
import { publicApiRouter } from "./routes/publicApi.js";
import { reportsRouter } from "./routes/reports.js";
import { scansRouter } from "./routes/scans.js";
import { tenantsRouter } from "./routes/tenants.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { vilRouter } from "./routes/vil.js";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(requestContext);
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(globalRateLimit);

  app.get("/", (_req, res) => {
    res.json({
      service: "SYSTOLAB Internal Truth Engine API",
      status: "online",
      docs: "/api/coverage"
    });
  });

  app.use("/health", healthRouter);
  app.use("/api/admin/auth", authRateLimit, adminAuthRouter);
  app.use("/api/auth", authRateLimit, authRouter);
  app.use("/api/scans", scansRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/coverage", coverageRouter);
  app.use("/api/intelligence", intelligenceRouter);
  app.use("/api/agency", agencyRouter);
  app.use("/api/tenants", tenantsRouter);
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/artifacts", artifactsRouter);
  app.use("/api/internal/iire", internalIireRouter);
  app.use("/api/internal/platform", internalPlatformRouter);
  app.use("/api/vil", vilRouter);
  app.use("/v1", publicApiRateLimit, publicApiRouter);
  app.use("/metrics", metricsRouter);
  app.use(errorHandler);

  return app;
}
