import mongoose, { Schema } from "mongoose";

export interface EvidenceArtifactDocument extends mongoose.Document {
  artifactId: string;
  snapshotId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  artifactType:
    | "screenshot"
    | "crawled_content"
    | "extracted_metadata"
    | "benchmark_evidence"
    | "recommendation_evidence"
    | "classification_evidence"
    | "scan_artifact"
    | "audit_evidence";
  contentHash: string;
  storageMode: "database_reference" | "object_store_reference" | "inline_metadata";
  payload: Record<string, unknown>;
  version: string;
  lineage: Record<string, unknown>;
  createdAt: Date;
}

const EvidenceArtifactSchema = new Schema<EvidenceArtifactDocument>(
  {
    artifactId: { type: String, required: true, unique: true, index: true, immutable: true },
    snapshotId: { type: String, required: true, index: true, immutable: true },
    workspaceId: { type: String, required: true, index: true, immutable: true },
    tenantSlug: { type: String, required: true, index: true, immutable: true },
    targetUrl: { type: String, required: true, index: true, immutable: true },
    artifactType: { type: String, required: true, index: true, immutable: true },
    contentHash: { type: String, required: true, index: true, immutable: true },
    storageMode: { type: String, required: true, default: "inline_metadata", immutable: true },
    payload: { type: Schema.Types.Mixed, required: true, immutable: true },
    version: { type: String, required: true, immutable: true },
    lineage: { type: Schema.Types.Mixed, required: true, immutable: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

EvidenceArtifactSchema.pre(["updateOne", "findOneAndUpdate", "updateMany", "replaceOne"], function blockEvidenceArtifactUpdates(next) {
  next(new Error("Evidence Repository artifacts are immutable and update operations are disabled."));
});

export const EvidenceArtifact = mongoose.model<EvidenceArtifactDocument>("EvidenceArtifact", EvidenceArtifactSchema);
