import mongoose, { Schema } from "mongoose";

export type VisitorArchetype =
  | "trust_seeker"
  | "price_checker"
  | "research_visitor"
  | "conversion_ready"
  | "returning_visitor"
  | "frustrated_visitor"
  | "unclassified";

export interface VisitorDnaRecordDocument extends mongoose.Document {
  visitorDnaId: string;
  workspaceId: string;
  tenantSlug: string;

  // Archetype
  archetype: VisitorArchetype;
  archetypeLabel: string;
  archetypeDescription: string;

  // Volume
  sessionCount: number;
  sampleSize: number;
  shareOfTotalSessions: number;    // 0-100 percent

  // Behavioral averages
  avgPagesVisited: number;
  avgDwellMs: number;
  avgMaxScrollDepth: number;
  avgVisitorFrustrationScore: number;
  conversionRate: number;          // 0-100 percent

  // Journey patterns
  commonEntryPages: string[];
  commonExitPages: string[];
  commonPathPatterns: string[];    // e.g. "Home→Pricing→Exit"

  // Confidence
  confidenceScore: number;
  consistencyLevel: "low" | "medium" | "high";
  statisticalSignificance: boolean;

  // Revenue
  estimatedConversionValue?: number;

  // Observation window
  observedFrom: Date;
  observedTo: Date;

  createdAt: Date;
  updatedAt: Date;
}

const VisitorDnaRecordSchema = new Schema<VisitorDnaRecordDocument>(
  {
    visitorDnaId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    archetype: {
      type: String,
      required: true,
      index: true,
      enum: ["trust_seeker", "price_checker", "research_visitor", "conversion_ready", "returning_visitor", "frustrated_visitor", "unclassified"]
    },
    archetypeLabel: { type: String, required: true },
    archetypeDescription: { type: String, required: true },
    sessionCount: { type: Number, required: true, default: 0 },
    sampleSize: { type: Number, required: true, default: 0 },
    shareOfTotalSessions: { type: Number, required: true, default: 0 },
    avgPagesVisited: { type: Number, required: true, default: 0 },
    avgDwellMs: { type: Number, required: true, default: 0 },
    avgMaxScrollDepth: { type: Number, required: true, default: 0 },
    avgVisitorFrustrationScore: { type: Number, required: true, default: 0 },
    conversionRate: { type: Number, required: true, default: 0 },
    commonEntryPages: { type: [String], default: [] },
    commonExitPages: { type: [String], default: [] },
    commonPathPatterns: { type: [String], default: [] },
    confidenceScore: { type: Number, required: true, default: 0 },
    consistencyLevel: { type: String, required: true, enum: ["low", "medium", "high"], default: "low" },
    statisticalSignificance: { type: Boolean, required: true, default: false },
    estimatedConversionValue: { type: Number },
    observedFrom: { type: Date, required: true },
    observedTo: { type: Date, required: true }
  },
  { timestamps: true, minimize: false }
);

VisitorDnaRecordSchema.index({ workspaceId: 1, archetype: 1 }, { unique: true });
VisitorDnaRecordSchema.index({ tenantSlug: 1, archetype: 1 });

export const VisitorDnaRecord = mongoose.model<VisitorDnaRecordDocument>("VisitorDnaRecord", VisitorDnaRecordSchema);
