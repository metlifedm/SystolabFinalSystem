import mongoose, { Schema } from "mongoose";

export interface CompetitorRelationshipRecordDocument extends mongoose.Document {
  relationshipId: string;
  snapshotId: string;
  workspaceId: string;
  tenantSlug: string;
  businessUrl: string;
  competitorUrl: string;
  competitorLabel: string;
  industryType: string;
  geography: string;
  marketSegment: string;
  primaryOss: number;
  competitorOss: number | null;
  primaryTrustScore: number | null;
  competitorTrustScore: number | null;
  primaryConversionScore: number | null;
  competitorConversionScore: number | null;
  revenueOpportunityLow: number;
  revenueOpportunityHigh: number;
  threatLevel: string;
  observations: number;
  capturedAt: Date;
  createdAt: Date;
}

const CompetitorRelationshipRecordSchema = new Schema<CompetitorRelationshipRecordDocument>(
  {
    relationshipId: { type: String, required: true, unique: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    businessUrl: { type: String, required: true, index: true },
    competitorUrl: { type: String, required: true, index: true },
    competitorLabel: { type: String, required: true },
    industryType: { type: String, required: true, index: true },
    geography: { type: String, required: true, index: true },
    marketSegment: { type: String, required: true, index: true },
    primaryOss: { type: Number, required: true },
    competitorOss: { type: Number, default: null },
    primaryTrustScore: { type: Number, default: null },
    competitorTrustScore: { type: Number, default: null },
    primaryConversionScore: { type: Number, default: null },
    competitorConversionScore: { type: Number, default: null },
    revenueOpportunityLow: { type: Number, required: true },
    revenueOpportunityHigh: { type: Number, required: true },
    threatLevel: { type: String, required: true, index: true },
    observations: { type: Number, default: 1 },
    capturedAt: { type: Date, required: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CompetitorRelationshipRecordSchema.index({ businessUrl: 1, competitorUrl: 1, snapshotId: 1 }, { unique: true });

export const CompetitorRelationshipRecord = mongoose.model<CompetitorRelationshipRecordDocument>("CompetitorRelationshipRecord", CompetitorRelationshipRecordSchema);
