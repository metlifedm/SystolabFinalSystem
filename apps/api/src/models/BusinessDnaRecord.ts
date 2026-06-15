import mongoose, { Schema } from "mongoose";

export type BusinessMaturityLevel = "early" | "developing" | "mature" | "optimized";
export type ScoreTrend = "improving" | "declining" | "stable" | "volatile";
export type CompetitivePosition = "leading" | "competitive" | "lagging";

export interface OssHistoryEntry {
  date: Date;
  oss: number;
  snapshotId: string;
}

export interface BusinessDnaRecordDocument extends mongoose.Document {
  dnaId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;

  // Business profile
  businessType?: string;
  industry?: string;
  maturityLevel: BusinessMaturityLevel;

  // Longitudinal scan stats
  totalScans: number;
  firstScannedAt?: Date;
  lastScannedAt?: Date;

  // Recurring patterns (aggregated across scans)
  recurringStrengths: string[];
  recurringWeaknesses: string[];
  growthPatterns: string[];
  operationalTendencies: string[];

  // Recommendation history
  totalRecommendationsReceived: number;
  totalRecommendationsImplemented: number;
  implementationRate: number;
  avgEffectivenessScore: number;
  topEffectiveRecommendationTypes: string[];

  // Score trajectory
  scoreHistory: OssHistoryEntry[];
  avgOssScore: number;
  peakOssScore: number;
  scoreTrend: ScoreTrend;

  // Behavioral signals (from VIL — populated when behavioral data exists)
  dominantVisitorArchetype?: string;
  avgVisitorFrustrationScore?: number;
  topExitPages: string[];
  topConversionPaths: string[];

  // Competitive context
  competitorCount?: number;
  relativePosition?: CompetitivePosition;

  // Intelligence summaries
  businessInsights: string[];
  openOpportunityCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const OssHistoryEntrySchema = new Schema<OssHistoryEntry>(
  {
    date: { type: Date, required: true },
    oss: { type: Number, required: true },
    snapshotId: { type: String, required: true }
  },
  { _id: false }
);

const BusinessDnaRecordSchema = new Schema<BusinessDnaRecordDocument>(
  {
    dnaId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, unique: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true },
    businessType: { type: String },
    industry: { type: String, index: true },
    maturityLevel: { type: String, required: true, enum: ["early", "developing", "mature", "optimized"], default: "early" },
    totalScans: { type: Number, required: true, default: 0 },
    firstScannedAt: { type: Date },
    lastScannedAt: { type: Date },
    recurringStrengths: { type: [String], default: [] },
    recurringWeaknesses: { type: [String], default: [] },
    growthPatterns: { type: [String], default: [] },
    operationalTendencies: { type: [String], default: [] },
    totalRecommendationsReceived: { type: Number, required: true, default: 0 },
    totalRecommendationsImplemented: { type: Number, required: true, default: 0 },
    implementationRate: { type: Number, required: true, default: 0 },
    avgEffectivenessScore: { type: Number, required: true, default: 0 },
    topEffectiveRecommendationTypes: { type: [String], default: [] },
    scoreHistory: { type: [OssHistoryEntrySchema], default: [] },
    avgOssScore: { type: Number, required: true, default: 0 },
    peakOssScore: { type: Number, required: true, default: 0 },
    scoreTrend: { type: String, required: true, enum: ["improving", "declining", "stable", "volatile"], default: "stable" },
    dominantVisitorArchetype: { type: String },
    avgVisitorFrustrationScore: { type: Number },
    topExitPages: { type: [String], default: [] },
    topConversionPaths: { type: [String], default: [] },
    competitorCount: { type: Number },
    relativePosition: { type: String, enum: ["leading", "competitive", "lagging"] },
    businessInsights: { type: [String], default: [] },
    openOpportunityCount: { type: Number, required: true, default: 0 }
  },
  { timestamps: true, minimize: false }
);

BusinessDnaRecordSchema.index({ tenantSlug: 1, scoreTrend: 1 });
BusinessDnaRecordSchema.index({ tenantSlug: 1, maturityLevel: 1 });

export const BusinessDnaRecord = mongoose.model<BusinessDnaRecordDocument>("BusinessDnaRecord", BusinessDnaRecordSchema);
