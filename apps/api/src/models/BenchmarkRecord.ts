import mongoose, { Schema } from "mongoose";
import type { DimensionKey } from "@systolab/shared";

export interface BenchmarkRecordDocument extends mongoose.Document {
  snapshotId: string;
  tenantSlug: string;
  industryType: string;
  businessModel: string;
  geography: string;
  dimensions: Partial<Record<DimensionKey, number>>;
  oss: number;
  createdAt: Date;
}

const BenchmarkRecordSchema = new Schema<BenchmarkRecordDocument>(
  {
    snapshotId: { type: String, required: true, unique: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    industryType: { type: String, default: "uncategorized", index: true },
    businessModel: { type: String, default: "unknown", index: true },
    geography: { type: String, default: "global", index: true },
    dimensions: { type: Schema.Types.Mixed, required: true },
    oss: { type: Number, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const BenchmarkRecord = mongoose.model<BenchmarkRecordDocument>("BenchmarkRecord", BenchmarkRecordSchema);
