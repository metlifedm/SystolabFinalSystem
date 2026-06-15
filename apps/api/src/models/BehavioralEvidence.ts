import mongoose, { Schema } from "mongoose";

export type BehavioralEvidenceType =
  | "cta_friction"          // CTA Intelligence Engine
  | "form_abandonment"      // Form Intelligence Engine
  | "engagement_dropoff"    // Scroll Intelligence Engine
  | "exit_concentration"    // Exit Intelligence Engine
  | "trust_signal_avoidance" // Heatmap Intelligence Engine (deferred)
  | "rage_click_cluster"   // Friction Detection Engine
  | "dead_click_cluster"   // Friction Detection Engine
  | "scroll_avoidance"     // Scroll Intelligence Engine
  | "navigation_uncertainty" // Friction Detection Engine
  | "conversion_pathway";  // Journey Reconstruction Engine

export type ConsistencyLevel = "low" | "medium" | "high";

export interface BehavioralEvidenceDocument extends mongoose.Document {
  behavioralEvidenceId: string;
  workspaceId: string;
  tenantSlug: string;
  evidenceType: BehavioralEvidenceType;
  // Behavioral Confidence Engine
  confidenceScore: number;
  sampleSize: number;
  consistencyLevel: ConsistencyLevel;
  statisticalSignificance: boolean;
  // Supporting data
  sourceSessionIds: string[];
  sourceEventIds: string[];
  targetPage?: string;
  targetElement?: string;
  observation: string;
  metrics: Record<string, number>;
  vfsContribution?: number;
  // Downstream consumption tracking
  consumedByIntelligence: boolean;
  recommendationIds: string[];
  // Lineage
  behavioralLineageId?: string;
  // Revenue impact
  estimatedRevenueImpact?: number;
  // CIIF — Evidence Quality Classification
  qualityClass?: "low" | "medium" | "high" | "verified";
  qualityScore?: number;
  // Observation window
  observedFrom: Date;
  observedTo: Date;
  generatedAt: Date;
  createdAt: Date;
}

const BehavioralEvidenceSchema = new Schema<BehavioralEvidenceDocument>(
  {
    behavioralEvidenceId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    evidenceType: { type: String, required: true, index: true },
    confidenceScore: { type: Number, required: true, default: 0 },
    sampleSize: { type: Number, required: true, default: 0 },
    consistencyLevel: { type: String, required: true, enum: ["low", "medium", "high"], default: "low" },
    statisticalSignificance: { type: Boolean, required: true, default: false },
    sourceSessionIds: { type: [String], default: [] },
    sourceEventIds: { type: [String], default: [] },
    targetPage: { type: String },
    targetElement: { type: String },
    observation: { type: String, required: true },
    metrics: { type: Schema.Types.Mixed, default: {} },
    vfsContribution: { type: Number },
    consumedByIntelligence: { type: Boolean, required: true, default: false },
    recommendationIds: { type: [String], default: [] },
    behavioralLineageId: { type: String, index: true },
    estimatedRevenueImpact: { type: Number },
    qualityClass: { type: String, enum: ["low", "medium", "high", "verified"], index: true },
    qualityScore: { type: Number },
    observedFrom: { type: Date, required: true },
    observedTo: { type: Date, required: true },
    generatedAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

BehavioralEvidenceSchema.index({ workspaceId: 1, evidenceType: 1 });
BehavioralEvidenceSchema.index({ workspaceId: 1, generatedAt: -1 });
BehavioralEvidenceSchema.index({ workspaceId: 1, confidenceScore: -1 });

export const BehavioralEvidence = mongoose.model<BehavioralEvidenceDocument>("BehavioralEvidence", BehavioralEvidenceSchema);
