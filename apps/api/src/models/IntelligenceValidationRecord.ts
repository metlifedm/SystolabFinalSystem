import mongoose, { Schema } from "mongoose";

export type ValidationArtifactType =
  | "recommendation"
  | "benchmark"
  | "revenue_estimate"
  | "behavioral_inference"
  | "confidence_score"
  | "opportunity";

export type CalibrationStatus = "well_calibrated" | "overconfident" | "underconfident" | "insufficient_data";

export interface IntelligenceValidationRecordDocument extends mongoose.Document {
  validationId: string;
  workspaceId: string;
  tenantSlug: string;

  // What is being validated
  artifactType: ValidationArtifactType;
  artifactId: string;

  // Prediction vs actual
  predictedOutcome: Record<string, unknown>;
  actualOutcome: Record<string, unknown>;

  // Accuracy assessment
  accuracyScore: number;           // 0-100
  predictionError?: number;        // abs(predicted - actual) for numeric predictions
  calibrationStatus: CalibrationStatus;

  // Confidence assessment
  predictedConfidence: number;     // What confidence was claimed
  actualConfidence?: number;       // What confidence should have been (post-hoc)
  confidenceDrift: number;         // predictedConfidence - actualConfidence (positive = overconfident)

  // Finding
  finding: string;
  actionRequired: boolean;
  adjustmentRecommended?: string;

  // Supporting evidence
  evidenceIds: string[];

  validatedAt: Date;
  createdAt: Date;
}

const IntelligenceValidationRecordSchema = new Schema<IntelligenceValidationRecordDocument>(
  {
    validationId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    artifactType: { type: String, required: true, index: true },
    artifactId: { type: String, required: true, index: true },
    predictedOutcome: { type: Schema.Types.Mixed, default: {} },
    actualOutcome: { type: Schema.Types.Mixed, default: {} },
    accuracyScore: { type: Number, required: true, default: 0 },
    predictionError: { type: Number },
    calibrationStatus: {
      type: String,
      required: true,
      enum: ["well_calibrated", "overconfident", "underconfident", "insufficient_data"],
      default: "insufficient_data",
      index: true
    },
    predictedConfidence: { type: Number, required: true, default: 0 },
    actualConfidence: { type: Number },
    confidenceDrift: { type: Number, required: true, default: 0 },
    finding: { type: String, required: true },
    actionRequired: { type: Boolean, required: true, default: false },
    adjustmentRecommended: { type: String },
    evidenceIds: { type: [String], default: [] },
    validatedAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

IntelligenceValidationRecordSchema.index({ workspaceId: 1, artifactType: 1 });
IntelligenceValidationRecordSchema.index({ workspaceId: 1, calibrationStatus: 1 });
IntelligenceValidationRecordSchema.index({ artifactType: 1, accuracyScore: -1 });

export const IntelligenceValidationRecord = mongoose.model<IntelligenceValidationRecordDocument>(
  "IntelligenceValidationRecord",
  IntelligenceValidationRecordSchema
);
