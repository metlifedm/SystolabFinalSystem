import mongoose, { Schema } from "mongoose";
import type { IntelligenceLayerKey, SystolabEventType } from "@systolab/shared";

export interface IntelligenceEventDocument extends mongoose.Document {
  eventId: string;
  eventType: SystolabEventType;
  layer: IntelligenceLayerKey;
  snapshotId?: string;
  workspaceId?: string;
  userId?: string;
  targetUrl?: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  trace: Record<string, unknown>;
  createdAt: Date;
}

const IntelligenceEventSchema = new Schema<IntelligenceEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    layer: { type: String, required: true, index: true },
    snapshotId: { type: String, index: true },
    workspaceId: { type: String, index: true },
    userId: { type: String, index: true },
    targetUrl: { type: String, index: true },
    schemaVersion: { type: Number, required: true, default: 1 },
    payload: { type: Schema.Types.Mixed, required: true },
    trace: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

IntelligenceEventSchema.index({ eventType: 1, createdAt: -1 });

export const IntelligenceEvent = mongoose.model<IntelligenceEventDocument>("IntelligenceEvent", IntelligenceEventSchema);
