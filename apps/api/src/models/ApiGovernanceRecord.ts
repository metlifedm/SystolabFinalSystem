import mongoose, { Schema } from "mongoose";

export interface ApiGovernanceRecordDocument extends mongoose.Document {
  recordId: string;
  recordType: "usage_audit" | "quota" | "webhook" | "developer_control" | "api_version";
  tenantSlug: string;
  workspaceId?: string;
  apiVersion: string;
  method?: string;
  path?: string;
  statusCode?: number;
  keyHashPrefix?: string;
  quotaWindow?: string;
  quotaLimit?: number;
  quotaUsed?: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const ApiGovernanceRecordSchema = new Schema<ApiGovernanceRecordDocument>(
  {
    recordId: { type: String, required: true, unique: true, index: true },
    recordType: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, index: true },
    apiVersion: { type: String, required: true, default: "v1", index: true },
    method: { type: String },
    path: { type: String, index: true },
    statusCode: { type: Number },
    keyHashPrefix: { type: String, index: true },
    quotaWindow: { type: String, index: true },
    quotaLimit: { type: Number },
    quotaUsed: { type: Number },
    payload: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

ApiGovernanceRecordSchema.index({ recordType: 1, tenantSlug: 1, quotaWindow: 1 });

export const ApiGovernanceRecord = mongoose.model<ApiGovernanceRecordDocument>("ApiGovernanceRecord", ApiGovernanceRecordSchema);
