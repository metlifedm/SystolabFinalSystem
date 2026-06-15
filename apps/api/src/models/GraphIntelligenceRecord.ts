import mongoose, { Schema } from "mongoose";

export interface GraphIntelligenceRecordDocument extends mongoose.Document {
  graphId: string;
  workspaceId: string;
  tenantSlug: string;
  snapshotId?: string;
  source: "operational_memory_graph" | "competitor_relationship_graph" | "platform_lineage";
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  createdAt: Date;
}

const GraphIntelligenceRecordSchema = new Schema<GraphIntelligenceRecordDocument>(
  {
    graphId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    snapshotId: { type: String, index: true },
    source: { type: String, required: true, index: true },
    nodes: { type: [{ type: Schema.Types.Mixed }], default: [] },
    edges: { type: [{ type: Schema.Types.Mixed }], default: [] },
    metrics: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const GraphIntelligenceRecord = mongoose.model<GraphIntelligenceRecordDocument>("GraphIntelligenceRecord", GraphIntelligenceRecordSchema);
