import mongoose, { Schema } from "mongoose";

export interface ScanHistoryDocument extends mongoose.Document {
  historyId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  snapshotId: string;
  oss: number;
  dimensions: Record<string, number>;
  competitorUrls: string[];
  evidenceCount: number;
  createdAt: Date;
}

const ScanHistorySchema = new Schema<ScanHistoryDocument>(
  {
    historyId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, unique: true, index: true },
    oss: { type: Number, required: true },
    dimensions: { type: Schema.Types.Mixed, required: true },
    competitorUrls: { type: [String], default: [] },
    evidenceCount: { type: Number, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const ScanHistory = mongoose.model<ScanHistoryDocument>("ScanHistory", ScanHistorySchema);
