import mongoose, { Schema } from "mongoose";

export interface ArtifactVersionRecordDocument extends mongoose.Document {
  versionId: string;
  artifactType: string;
  artifactId: string;
  snapshotId?: string;
  workspaceId?: string;
  version: string;
  hash: string;
  payload: Record<string, unknown>;
  lineage: Record<string, unknown>;
  createdAt: Date;
}

const ArtifactVersionRecordSchema = new Schema<ArtifactVersionRecordDocument>(
  {
    versionId: { type: String, required: true, unique: true, index: true },
    artifactType: { type: String, required: true, index: true },
    artifactId: { type: String, required: true, index: true },
    snapshotId: { type: String, index: true },
    workspaceId: { type: String, index: true },
    version: { type: String, required: true, index: true },
    hash: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    lineage: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const ArtifactVersionRecord = mongoose.model<ArtifactVersionRecordDocument>("ArtifactVersionRecord", ArtifactVersionRecordSchema);
