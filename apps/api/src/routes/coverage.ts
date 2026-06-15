import { Router } from "express";
import { specCoverage } from "../specCoverage.js";

export const coverageRouter = Router();

coverageRouter.get("/", (_req, res) => {
  res.json({
    total: specCoverage.length,
    items: specCoverage
  });
});
