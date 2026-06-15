import mongoose, { Schema } from "mongoose";

export type ExportType =
  | "gdpr_erasure"
  | "gdpr_portability"
  | "soc2_audit"
  | "custom";

export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export interface ComplianceExportDocument extends mongoose.Document {
  exportId: string;
  exportType: ExportType;
  requestedBy: string;
  scope: "workspace" | "tenant" | "user";
  targetId: string;
  status: ExportStatus;
  recordsIncluded: number;
  exportPath?: string;
  requestedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
  errorMessage?: string;
  notes?: string;
}

const ComplianceExportSchema = new Schema<ComplianceExportDocument>(
  {
    exportId: { type: String, required: true, unique: true, index: true },
    exportType: { type: String, required: true, index: true },
    requestedBy: { type: String, required: true, index: true },
    scope: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    status: { type: String, required: true, default: "pending", index: true },
    recordsIncluded: { type: Number, required: true, default: 0 },
    exportPath: { type: String },
    requestedAt: { type: Date, required: true },
    completedAt: { type: Date },
    expiresAt: { type: Date },
    errorMessage: { type: String },
    notes: { type: String }
  },
  { timestamps: false }
);

export const ComplianceExportRecord = mongoose.model<ComplianceExportDocument>("ComplianceExportRecord", ComplianceExportSchema);
