import mongoose, { Schema } from "mongoose";

export interface DimensionWeightMap {
  trust: number;
  accessibility: number;
  renderingQuality: number;
  stability: number;
  mobileExperience: number;
  websiteHealth: number;
  visibilityStructure: number;
  conversionReadiness: number;
  informationClarity: number;
}

export interface ScoringThresholds {
  excellent: number;
  good: number;
  fair: number;
}

export interface ScoringAlgorithmVersionDocument extends mongoose.Document {
  versionId: string;
  versionTag: string;
  algorithm: string;
  dimensionWeights: DimensionWeightMap;
  thresholds: ScoringThresholds;
  isCurrent: boolean;
  qualityCheckPassed?: boolean;
  qualityScore?: number;
  qualityNotes?: string;
  publishedAt: Date;
  deprecatedAt?: Date;
  notes?: string;
  createdAt: Date;
}

const ScoringAlgorithmVersionSchema = new Schema<ScoringAlgorithmVersionDocument>(
  {
    versionId: { type: String, required: true, unique: true, index: true },
    versionTag: { type: String, required: true, unique: true, index: true },
    algorithm: { type: String, required: true },
    dimensionWeights: { type: Schema.Types.Mixed, required: true },
    thresholds: { type: Schema.Types.Mixed, required: true },
    isCurrent: { type: Boolean, required: true, default: false, index: true },
    qualityCheckPassed: { type: Boolean },
    qualityScore: { type: Number },
    qualityNotes: { type: String },
    publishedAt: { type: Date, required: true },
    deprecatedAt: { type: Date },
    notes: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ScoringAlgorithmVersion = mongoose.model<ScoringAlgorithmVersionDocument>("ScoringAlgorithmVersion", ScoringAlgorithmVersionSchema);
