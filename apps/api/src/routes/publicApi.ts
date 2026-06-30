import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authOptional } from "../middleware/authOptional.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { apiGovernance } from "../middleware/apiGovernance.js";
import { createScan, getDecision, getReport } from "./scanController.js";

export const publicApiRouter = Router();

publicApiRouter.use(apiKeyAuth);
publicApiRouter.use(apiGovernance);
publicApiRouter.use(authOptional);
publicApiRouter.post("/scans", asyncHandler(createScan));
publicApiRouter.get("/snapshots/:snapshotId", asyncHandler(getDecision));
publicApiRouter.get("/snapshots/:snapshotId/report", asyncHandler(getReport));
