import mongoose, { Schema } from "mongoose";

export interface EditEventDocument extends mongoose.Document {
  eventId: string;
  workspaceId?: string;
  snapshotId?: string;
  sessionFingerprint: string;
  eventType: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}

const EditEventSchema = new Schema<EditEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, index: true },
    snapshotId: { type: String, index: true },
    sessionFingerprint: { type: String, required: true, index: true },
    eventType: { type: String, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const EditEvent = mongoose.model<EditEventDocument>("EditEvent", EditEventSchema);
