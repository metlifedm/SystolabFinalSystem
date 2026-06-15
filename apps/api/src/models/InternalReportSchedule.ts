import mongoose, { Schema } from "mongoose";
import type { InternalReportCadence, InternalReportExportFormat } from "@systolab/shared";

export interface InternalReportScheduleDocument extends mongoose.Document {
  scheduleId: string;
  reportType: Exclude<InternalReportCadence, "custom" | "event_triggered">;
  enabled: boolean;
  exportFormats: InternalReportExportFormat[];
  lastRunAt?: Date;
  nextRunAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InternalReportScheduleSchema = new Schema<InternalReportScheduleDocument>(
  {
    scheduleId: { type: String, required: true, unique: true, index: true },
    reportType: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: true, index: true },
    exportFormats: { type: [String], default: ["pdf", "json"] },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

export const InternalReportSchedule = mongoose.model<InternalReportScheduleDocument>("InternalReportSchedule", InternalReportScheduleSchema);
