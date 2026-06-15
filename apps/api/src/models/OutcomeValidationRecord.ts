import mongoose, { Schema } from "mongoose";

export interface OutcomeValidationRecordDocument extends mongoose.Document {
  validationId: string;
  recommendationId: string;
  snapshotId: string;
  previousSnapshotId?: string;
  workspaceId: string;
  targetUrl: string;
  implementedStatus: string;
  improvementStatus: string;
  ossDelta: number | null;
  revenueImpactLow: number;
  revenueImpactHigh: number;
  confidenceScore: number;
  evidenceIds: string[];
  detectedAt?: Date;
  createdAt: Date;
}

const OutcomeValidationRecordSchema = new Schema<OutcomeValidationRecordDocument>(
  {
    validationId: { type: String, required: true, unique: true, index: true },
    recommendationId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    previousSnapshotId: { type: String, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    implementedStatus: { type: String, required: true, index: true },
    improvementStatus: { type: String, required: true, index: true },
    ossDelta: { type: Number, default: null },
    revenueImpactLow: { type: Number, required: true },
    revenueImpactHigh: { type: Number, required: true },
    confidenceScore: { type: Number, required: true },
    evidenceIds: { type: [String], default: [] },
    detectedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const OutcomeValidationRecord = mongoose.model<OutcomeValidationRecordDocument>("OutcomeValidationRecord", OutcomeValidationRecordSchema);
