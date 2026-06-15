import mongoose, { Schema } from "mongoose";

export interface AlertRecordDocument extends mongoose.Document {
  alertId: string;
  snapshotId: string;
  workspaceId: string;
  targetUrl: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  trigger: string;
  evidenceIds: string[];
  acknowledged: boolean;
  createdAt: Date;
}

const AlertRecordSchema = new Schema<AlertRecordDocument>(
  {
    alertId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    severity: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    trigger: { type: String, required: true },
    evidenceIds: { type: [String], default: [] },
    acknowledged: { type: Boolean, default: false }
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

AlertRecordSchema.index({ alertId: 1, snapshotId: 1 }, { unique: true });

export const AlertRecord = mongoose.model<AlertRecordDocument>("AlertRecord", AlertRecordSchema);
