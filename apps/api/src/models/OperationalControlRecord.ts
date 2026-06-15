import mongoose, { Schema } from "mongoose";

export interface OperationalControlRecordDocument extends mongoose.Document {
  recordId: string;
  controlType:
    | "disaster_recovery"
    | "observability"
    | "data_governance"
    | "intelligence_validation"
    | "scan_slo"
    | "governance_contract"
    | "data_quality"
    | "cost_intelligence"
    | "sandbox"
    | "ai_analyst_context"
    | "realtime_refresh"
    | "retention_job"
    | "benchmark_version";
  status: "passing" | "warning" | "failing" | "informational";
  scope: string;
  score?: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const OperationalControlRecordSchema = new Schema<OperationalControlRecordDocument>(
  {
    recordId: { type: String, required: true, unique: true, index: true },
    controlType: { type: String, required: true, index: true },
    status: { type: String, required: true, index: true },
    scope: { type: String, required: true, index: true },
    score: { type: Number },
    payload: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

export const OperationalControlRecord = mongoose.model<OperationalControlRecordDocument>("OperationalControlRecord", OperationalControlRecordSchema);
