import mongoose, { Schema } from "mongoose";
import type { ReportSnapshot, ScanMode, SnapshotStatus } from "@systolab/shared";

export interface SnapshotDocument extends mongoose.Document {
  snapshotId: string;
  tenantSlug: string;
  targetUrl: string;
  mode: ScanMode;
  status: SnapshotStatus;
  report: ReportSnapshot;
  integrityHash: string;
  createdAt: Date;
}

const SnapshotSchema = new Schema<SnapshotDocument>(
  {
    snapshotId: { type: String, required: true, unique: true, index: true, immutable: true },
    tenantSlug: { type: String, required: true, index: true, immutable: true },
    targetUrl: { type: String, required: true, index: true, immutable: true },
    mode: { type: String, required: true, immutable: true },
    status: { type: String, required: true, immutable: true },
    report: { type: Schema.Types.Mixed, required: true, immutable: true },
    integrityHash: { type: String, required: true, immutable: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

SnapshotSchema.pre("save", function blockSnapshotMutation(next) {
  if (!this.isNew) {
    next(new Error("Operational Snapshots are immutable and cannot be modified after creation."));
    return;
  }
  next();
});

SnapshotSchema.pre(["updateOne", "findOneAndUpdate", "updateMany", "replaceOne"], function blockSnapshotUpdates(next) {
  next(new Error("Operational Snapshots are immutable and update operations are disabled."));
});

export const Snapshot = mongoose.model<SnapshotDocument>("Snapshot", SnapshotSchema);
