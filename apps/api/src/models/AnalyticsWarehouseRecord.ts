import mongoose, { Schema } from "mongoose";

export interface AnalyticsWarehouseRecordDocument extends mongoose.Document {
  recordId: string;
  grain: "snapshot" | "daily" | "weekly" | "monthly" | "custom";
  periodStartAt: Date;
  periodEndAt: Date;
  dimensions: Record<string, unknown>;
  metrics: Record<string, unknown>;
  sourceIds: string[];
  createdAt: Date;
}

const AnalyticsWarehouseRecordSchema = new Schema<AnalyticsWarehouseRecordDocument>(
  {
    recordId: { type: String, required: true, unique: true, index: true },
    grain: { type: String, required: true, index: true },
    periodStartAt: { type: Date, required: true, index: true },
    periodEndAt: { type: Date, required: true, index: true },
    dimensions: { type: Schema.Types.Mixed, required: true },
    metrics: { type: Schema.Types.Mixed, required: true },
    sourceIds: { type: [String], default: [] }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const AnalyticsWarehouseRecord = mongoose.model<AnalyticsWarehouseRecordDocument>("AnalyticsWarehouseRecord", AnalyticsWarehouseRecordSchema);
