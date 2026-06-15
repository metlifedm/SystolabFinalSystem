import mongoose, { Schema } from "mongoose";

export type QuarantineType =
  | "malformed_payload"
  | "schema_violation"
  | "quality_gate_failure"
  | "benchmark_quality_failure"
  | "policy_violation";

export type QuarantineResolution = "pending" | "approved" | "rejected";

export interface QuarantineDocument extends mongoose.Document {
  quarantineId: string;
  quarantineType: QuarantineType;
  sourceRoute: string;
  sourceModel?: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  reason: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  resolution: QuarantineResolution;
  createdAt: Date;
}

const QuarantineSchema = new Schema<QuarantineDocument>(
  {
    quarantineId: { type: String, required: true, unique: true, index: true },
    quarantineType: { type: String, required: true, index: true },
    sourceRoute: { type: String, required: true, index: true },
    sourceModel: { type: String },
    payloadHash: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, required: true },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
    resolution: { type: String, required: true, default: "pending", index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const QuarantineRecord = mongoose.model<QuarantineDocument>("QuarantineRecord", QuarantineSchema);
