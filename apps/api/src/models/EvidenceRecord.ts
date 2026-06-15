import mongoose, { Schema } from "mongoose";

export interface EvidenceRecordDocument extends mongoose.Document {
  evidenceId: string;
  snapshotId: string;
  previousSnapshotId?: string;
  workspaceId: string;
  targetUrl: string;
  issue: string;
  before: string | null;
  after: string | null;
  confidenceScore: number;
  confidenceReason: string;
  evidenceType: string;
  sourceEvidenceIds: string[];
  recommendationIds: string[];
  validationTraceIds: string[];
  capturedAt: Date;
  // CIIF — Evidence Quality Classification
  qualityClass?: "low" | "medium" | "high" | "verified";
  qualityScore?: number;
  qualityReason?: string;
  qualityEvaluatedAt?: Date;
  createdAt: Date;
}

const EvidenceRecordSchema = new Schema<EvidenceRecordDocument>(
  {
    evidenceId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    previousSnapshotId: { type: String, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    issue: { type: String, required: true },
    before: { type: String, default: null },
    after: { type: String, default: null },
    confidenceScore: { type: Number, required: true },
    confidenceReason: { type: String, required: true },
    evidenceType: { type: String, required: true, index: true },
    sourceEvidenceIds: { type: [String], default: [] },
    recommendationIds: { type: [String], default: [] },
    validationTraceIds: { type: [String], default: [] },
    capturedAt: { type: Date, required: true },
    qualityClass: { type: String, enum: ["low", "medium", "high", "verified"], index: true },
    qualityScore: { type: Number },
    qualityReason: { type: String },
    qualityEvaluatedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

EvidenceRecordSchema.index({ evidenceId: 1, snapshotId: 1 }, { unique: true });

export const EvidenceRecord = mongoose.model<EvidenceRecordDocument>("EvidenceRecord", EvidenceRecordSchema);
