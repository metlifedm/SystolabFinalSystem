import mongoose, { Schema } from "mongoose";

export type EffectivenessStatus = "pending" | "measuring" | "validated" | "inconclusive";

export interface RecommendationEffectivenessDocument extends mongoose.Document {
  effectivenessId: string;
  recommendationId: string;
  workspaceId: string;
  tenantSlug: string;
  recommendationType: string;
  recommendationSummary: string;
  appliedAt?: Date;
  appliedBy?: string;
  beforeEvidenceIds: string[];
  afterEvidenceIds: string[];
  baselineMetrics: Record<string, number>;
  outcomeMetrics: Record<string, number>;
  improved?: boolean;
  improvementDelta?: Record<string, number>;
  effectivenessScore?: number;
  globalApplicationCount?: number;
  globalSuccessCount?: number;
  globalSuccessRate?: number;
  status: EffectivenessStatus;
  validatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecommendationEffectivenessSchema = new Schema<RecommendationEffectivenessDocument>(
  {
    effectivenessId: { type: String, required: true, unique: true, index: true },
    recommendationId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    recommendationType: { type: String, required: true, index: true },
    recommendationSummary: { type: String, required: true },
    appliedAt: { type: Date },
    appliedBy: { type: String },
    beforeEvidenceIds: { type: [String], default: [] },
    afterEvidenceIds: { type: [String], default: [] },
    baselineMetrics: { type: Schema.Types.Mixed, default: {} },
    outcomeMetrics: { type: Schema.Types.Mixed, default: {} },
    improved: { type: Boolean },
    improvementDelta: { type: Schema.Types.Mixed },
    effectivenessScore: { type: Number },
    globalApplicationCount: { type: Number },
    globalSuccessCount: { type: Number },
    globalSuccessRate: { type: Number },
    status: {
      type: String,
      required: true,
      enum: ["pending", "measuring", "validated", "inconclusive"],
      default: "pending",
      index: true
    },
    validatedAt: { type: Date }
  },
  { timestamps: true, minimize: false }
);

RecommendationEffectivenessSchema.index({ recommendationType: 1, status: 1 });
RecommendationEffectivenessSchema.index({ workspaceId: 1, status: 1 });
RecommendationEffectivenessSchema.index({ recommendationType: 1, improved: 1 });

export const RecommendationEffectivenessRecord = mongoose.model<RecommendationEffectivenessDocument>(
  "RecommendationEffectivenessRecord",
  RecommendationEffectivenessSchema
);
