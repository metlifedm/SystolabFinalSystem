import mongoose, { Schema } from "mongoose";
import type { InternalIntelligenceReport, InternalReportCadence } from "@systolab/shared";

export interface InternalIntelligenceReportDocument extends mongoose.Document {
  reportId: string;
  reportType: InternalReportCadence;
  periodStartAt: Date;
  periodEndAt: Date;
  report: InternalIntelligenceReport;
  generatedBy: "scheduled" | "manual" | "event_triggered";
  createdAt: Date;
}

const InternalIntelligenceReportSchema = new Schema<InternalIntelligenceReportDocument>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    reportType: { type: String, required: true, index: true },
    periodStartAt: { type: Date, required: true, index: true },
    periodEndAt: { type: Date, required: true, index: true },
    report: { type: Schema.Types.Mixed, required: true },
    generatedBy: { type: String, required: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const InternalIntelligenceReportModel = mongoose.model<InternalIntelligenceReportDocument>("InternalIntelligenceReport", InternalIntelligenceReportSchema);
