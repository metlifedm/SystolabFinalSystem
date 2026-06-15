import mongoose, { Schema } from "mongoose";

export type KgsTrend = "growing" | "stable" | "declining";

export interface KnowledgeGrowthRecordDocument extends mongoose.Document {
  kgsId: string;

  // Period covered by this snapshot
  periodStart: Date;
  periodEnd: Date;

  // KGS component scores (0-100 each)
  recommendationEffectivenessScore: number;  // Based on VRSR
  evidenceQualityScore: number;              // Avg quality class across evidence
  behavioralIntelligenceScore: number;       // VIL coverage + archetype confidence
  validationAccuracyScore: number;           // Intelligence Validation Engine accuracy
  businessDnaCoverageScore: number;          // % of workspaces with DNA profiles

  // KGS composite (0-100)
  kgsScore: number;
  kgsTrend: KgsTrend;
  kgsDelta: number;                          // vs previous period

  // Validated Recommendation Success Rate (VRSR) — primary executive metric
  vrsr: number;                              // 0-100 percent
  vrsrDelta: number;                         // vs previous period
  totalRecommendationsImplemented: number;
  totalRecommendationsValidated: number;
  totalRecommendationsSuccessful: number;

  // Activity metrics for this period
  totalScansThisPeriod: number;
  totalEvidenceGenerated: number;
  totalRecommendationsIssued: number;
  totalOpportunitiesDiscovered: number;
  totalOpportunitiesCompleted: number;

  // Intelligence depth
  highQualityEvidenceCount: number;
  verifiedEvidenceCount: number;
  avgConfidenceScore: number;

  snapshotAt: Date;
  createdAt: Date;
}

const KnowledgeGrowthRecordSchema = new Schema<KnowledgeGrowthRecordDocument>(
  {
    kgsId: { type: String, required: true, unique: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    recommendationEffectivenessScore: { type: Number, required: true, default: 0 },
    evidenceQualityScore: { type: Number, required: true, default: 0 },
    behavioralIntelligenceScore: { type: Number, required: true, default: 0 },
    validationAccuracyScore: { type: Number, required: true, default: 0 },
    businessDnaCoverageScore: { type: Number, required: true, default: 0 },
    kgsScore: { type: Number, required: true, default: 0 },
    kgsTrend: { type: String, required: true, enum: ["growing", "stable", "declining"], default: "stable" },
    kgsDelta: { type: Number, required: true, default: 0 },
    vrsr: { type: Number, required: true, default: 0 },
    vrsrDelta: { type: Number, required: true, default: 0 },
    totalRecommendationsImplemented: { type: Number, required: true, default: 0 },
    totalRecommendationsValidated: { type: Number, required: true, default: 0 },
    totalRecommendationsSuccessful: { type: Number, required: true, default: 0 },
    totalScansThisPeriod: { type: Number, required: true, default: 0 },
    totalEvidenceGenerated: { type: Number, required: true, default: 0 },
    totalRecommendationsIssued: { type: Number, required: true, default: 0 },
    totalOpportunitiesDiscovered: { type: Number, required: true, default: 0 },
    totalOpportunitiesCompleted: { type: Number, required: true, default: 0 },
    highQualityEvidenceCount: { type: Number, required: true, default: 0 },
    verifiedEvidenceCount: { type: Number, required: true, default: 0 },
    avgConfidenceScore: { type: Number, required: true, default: 0 },
    snapshotAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

KnowledgeGrowthRecordSchema.index({ snapshotAt: -1 });
KnowledgeGrowthRecordSchema.index({ kgsTrend: 1, snapshotAt: -1 });

export const KnowledgeGrowthRecord = mongoose.model<KnowledgeGrowthRecordDocument>("KnowledgeGrowthRecord", KnowledgeGrowthRecordSchema);
