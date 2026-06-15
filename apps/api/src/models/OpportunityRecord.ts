import mongoose, { Schema } from "mongoose";

export type OpportunityType =
  | "quick_win"
  | "high_impact"
  | "long_term"
  | "competitive"
  | "behavioral"
  | "revenue"
  | "trust"
  | "conversion";

export type OpportunityStatus = "active" | "in_progress" | "completed" | "dismissed";
export type EffortLevel = "low" | "medium" | "high";
export type OpportunitySource = "scan" | "behavioral" | "competitive" | "trend" | "validation" | "business_dna";

export interface OpportunityRecordDocument extends mongoose.Document {
  opportunityId: string;
  workspaceId: string;
  tenantSlug: string;

  // Classification
  opportunityType: OpportunityType;
  title: string;
  description: string;

  // Priority
  priorityScore: number;           // 0-100
  estimatedRevenueImpact?: number;
  effortLevel: EffortLevel;

  // Evidence
  evidenceIds: string[];
  behavioralEvidenceIds: string[];
  confidenceScore: number;
  qualityClass: "low" | "medium" | "high" | "verified";

  // Status
  status: OpportunityStatus;
  dismissedReason?: string;
  dismissedAt?: Date;
  completedAt?: Date;
  inProgressSince?: Date;

  // Source
  discoveredBy: OpportunitySource;
  relatedRecommendationIds: string[];

  createdAt: Date;
  updatedAt: Date;
}

const OpportunityRecordSchema = new Schema<OpportunityRecordDocument>(
  {
    opportunityId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    opportunityType: {
      type: String,
      required: true,
      index: true,
      enum: ["quick_win", "high_impact", "long_term", "competitive", "behavioral", "revenue", "trust", "conversion"]
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    priorityScore: { type: Number, required: true, default: 0 },
    estimatedRevenueImpact: { type: Number },
    effortLevel: { type: String, required: true, enum: ["low", "medium", "high"], default: "medium" },
    evidenceIds: { type: [String], default: [] },
    behavioralEvidenceIds: { type: [String], default: [] },
    confidenceScore: { type: Number, required: true, default: 0 },
    qualityClass: { type: String, required: true, enum: ["low", "medium", "high", "verified"], default: "low" },
    status: { type: String, required: true, enum: ["active", "in_progress", "completed", "dismissed"], default: "active", index: true },
    dismissedReason: { type: String },
    dismissedAt: { type: Date },
    completedAt: { type: Date },
    inProgressSince: { type: Date },
    discoveredBy: { type: String, required: true, enum: ["scan", "behavioral", "competitive", "trend", "validation", "business_dna"] },
    relatedRecommendationIds: { type: [String], default: [] }
  },
  { timestamps: true, minimize: false }
);

OpportunityRecordSchema.index({ workspaceId: 1, status: 1, priorityScore: -1 });
OpportunityRecordSchema.index({ workspaceId: 1, opportunityType: 1 });
OpportunityRecordSchema.index({ tenantSlug: 1, status: 1 });

export const OpportunityRecord = mongoose.model<OpportunityRecordDocument>("OpportunityRecord", OpportunityRecordSchema);
