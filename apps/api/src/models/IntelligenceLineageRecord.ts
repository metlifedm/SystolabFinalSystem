import mongoose, { Schema } from "mongoose";

export interface IntelligenceLineageRecordDocument extends mongoose.Document {
  lineageId: string;
  workspaceId: string;
  tenantSlug: string;
  snapshotId: string;
  artifactType: "score" | "recommendation" | "benchmark" | "prediction" | "classification" | "insight" | "report";
  artifactId: string;
  evidenceIds: string[];
  sourceIds: string[];
  decisionPath: Array<Record<string, unknown>>;
  confidenceScore: number;
  createdAt: Date;
}

const IntelligenceLineageRecordSchema = new Schema<IntelligenceLineageRecordDocument>(
  {
    lineageId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    artifactType: { type: String, required: true, index: true },
    artifactId: { type: String, required: true, index: true },
    evidenceIds: { type: [String], default: [] },
    sourceIds: { type: [String], default: [] },
    decisionPath: { type: [{ type: Schema.Types.Mixed }], default: [] },
    confidenceScore: { type: Number, required: true, default: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const IntelligenceLineageRecord = mongoose.model<IntelligenceLineageRecordDocument>("IntelligenceLineageRecord", IntelligenceLineageRecordSchema);
