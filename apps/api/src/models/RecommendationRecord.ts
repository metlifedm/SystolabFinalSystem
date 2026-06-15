import mongoose, { Schema } from "mongoose";

export interface RecommendationRecordDocument extends mongoose.Document {
  recommendationId: string;
  snapshotId: string;
  workspaceId: string;
  targetUrl: string;
  issue: string;
  action: string;
  priority: string;
  evidenceIds: string[];
  confidenceScore: number;
  createdAt: Date;
}

const RecommendationRecordSchema = new Schema<RecommendationRecordDocument>(
  {
    recommendationId: { type: String, required: true, unique: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    issue: { type: String, required: true },
    action: { type: String, required: true },
    priority: { type: String, required: true, index: true },
    evidenceIds: { type: [String], default: [] },
    confidenceScore: { type: Number, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const RecommendationRecord = mongoose.model<RecommendationRecordDocument>("RecommendationRecord", RecommendationRecordSchema);
