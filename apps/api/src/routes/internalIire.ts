import { Router } from "express";
import type { InternalReportCadence, InternalReportExportFormat } from "@systolab/shared";
import { internalAdminAuth } from "../middleware/internalAdminAuth.js";
import {
  exportInternalReport,
  generateInternalIntelligenceReport,
  getInternalReport,
  listInternalReportSchedules,
  listInternalReports,
  runDueInternalReportSchedules,
  upsertInternalReportSchedule
} from "../services/iireService.js";

export const internalIireRouter = Router();

internalIireRouter.use(internalAdminAuth);

internalIireRouter.get("/reports", async (_req, res) => {
  res.json({ items: await listInternalReports() });
});

internalIireRouter.post("/reports", async (req, res) => {
  const input = req.body as { reportType?: InternalReportCadence; startAt?: string; endAt?: string };
  const report = await generateInternalIntelligenceReport({
    reportType: input.reportType ?? "weekly",
    startAt: input.startAt,
    endAt: input.endAt,
    generatedBy: "manual"
  });
  res.status(201).json({ report });
});

internalIireRouter.get("/reports/:reportId", async (req, res) => {
  const report = await getInternalReport(String(req.params.reportId));
  if (!report) {
    res.status(404).json({ error: { message: "Internal intelligence report not found." } });
    return;
  }
  res.json(report);
});

internalIireRouter.get("/reports/:reportId/export", async (req, res) => {
  const report = await getInternalReport(String(req.params.reportId));
  if (!report) {
    res.status(404).json({ error: { message: "Internal intelligence report not found." } });
    return;
  }
  const format = normalizeFormat(req.query.format);
  const exported = await exportInternalReport(report, format);
  res.setHeader("content-type", exported.contentType);
  res.setHeader("content-disposition", `attachment; filename="${exported.filename}"`);
  res.send(exported.body);
});

internalIireRouter.get("/dashboard", async (req, res) => {
  const report = await generateInternalIntelligenceReport({
    reportType: normalizeCadence(req.query.period) ?? "weekly",
    startAt: typeof req.query.startAt === "string" ? req.query.startAt : undefined,
    endAt: typeof req.query.endAt === "string" ? req.query.endAt : undefined,
    generatedBy: "manual"
  });
  res.json(report);
});

internalIireRouter.get("/schedules", async (_req, res) => {
  res.json({ items: await listInternalReportSchedules() });
});

internalIireRouter.post("/schedules", async (req, res) => {
  const input = req.body as {
    reportType?: Exclude<InternalReportCadence, "custom" | "event_triggered">;
    enabled?: boolean;
    exportFormats?: InternalReportExportFormat[];
    runNow?: boolean;
  };
  const item = await upsertInternalReportSchedule({
    reportType: input.reportType ?? "weekly",
    enabled: input.enabled,
    exportFormats: input.exportFormats,
    runNow: input.runNow
  });
  res.status(201).json({ item });
});

internalIireRouter.post("/run-due", async (_req, res) => {
  res.json(await runDueInternalReportSchedules());
});

function normalizeFormat(value: unknown): InternalReportExportFormat {
  if (value === "pdf" || value === "csv" || value === "spreadsheet" || value === "dashboard" || value === "json") return value;
  return "json";
}

function normalizeCadence(value: unknown): InternalReportCadence | undefined {
  if (
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "annual" ||
    value === "custom" ||
    value === "event_triggered"
  ) return value;
  return undefined;
}
