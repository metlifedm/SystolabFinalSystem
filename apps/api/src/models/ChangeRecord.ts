import mongoose, { Schema } from "mongoose";

export interface ChangeRecordDocument extends mongoose.Document {
  changeId: string;
  snapshotId: string;
  comparedSnapshotId?: string;
  workspaceId: string;
  targetUrl: string;
  area: string;
  beforeState: string;
  afterState: string;
  direction: "improved" | "declined" | "unchanged";
  evidenceIds: string[];
  recommendationIds: string[];
  confidenceScore: number;
  createdAt: Date;
}

const ChangeRecordSchema = new Schema<ChangeRecordDocument>(
  {
    changeId: { type: String, required: true, unique: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    comparedSnapshotId: { type: String, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    area: { type: String, required: true },
    beforeState: { type: String, required: true },
    afterState: { type: String, required: true },
    direction: { type: String, required: true, index: true },
    evidenceIds: { type: [String], default: [] },
    recommendationIds: { type: [String], default: [] },
    confidenceScore: { type: Number, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ChangeRecord = mongoose.model<ChangeRecordDocument>("ChangeRecord", ChangeRecordSchema);
