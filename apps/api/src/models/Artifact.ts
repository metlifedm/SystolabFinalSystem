import mongoose, { Schema } from "mongoose";

export type ArtifactType = "screenshot_full" | "screenshot_viewport";

export interface ArtifactDocument extends mongoose.Document {
  artifactId: string;
  snapshotId?: string;
  workspaceId?: string;
  pageUrl: string;
  artifactType: ArtifactType;
  mimeType: "image/png";
  sizeBytes: number;
  filePath?: string;
  data?: string;
  createdAt: Date;
}

const ArtifactSchema = new Schema<ArtifactDocument>(
  {
    artifactId: { type: String, required: true, unique: true, index: true },
    snapshotId: { type: String, index: true },
    workspaceId: { type: String, index: true },
    pageUrl: { type: String, required: true, index: true },
    artifactType: { type: String, enum: ["screenshot_full", "screenshot_viewport"], required: true },
    mimeType: { type: String, default: "image/png" },
    sizeBytes: { type: Number, required: true },
    filePath: { type: String },
    data: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const Artifact = mongoose.model<ArtifactDocument>("Artifact", ArtifactSchema);
