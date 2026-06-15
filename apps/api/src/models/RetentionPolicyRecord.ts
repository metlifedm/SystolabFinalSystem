import mongoose, { Schema } from "mongoose";

export type RetentionRecordType =
  | "snapshot"
  | "intelligence_event"
  | "auth_audit_log"
  | "analytics_warehouse"
  | "event_delivery"
  | "platform_alert"
  | "scan_history";

export type RetentionAction = "purge" | "archive";

export interface RetentionPolicyDocument extends mongoose.Document {
  policyId: string;
  recordType: RetentionRecordType;
  retentionDays: number;
  archiveDays?: number;
  action: RetentionAction;
  scope: "global" | "tenant" | "workspace";
  tenantSlug?: string;
  workspaceId?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RetentionPolicySchema = new Schema<RetentionPolicyDocument>(
  {
    policyId: { type: String, required: true, unique: true, index: true },
    recordType: { type: String, required: true, index: true },
    retentionDays: { type: Number, required: true },
    archiveDays: { type: Number },
    action: { type: String, required: true, default: "purge" },
    scope: { type: String, required: true, default: "global" },
    tenantSlug: { type: String, index: true },
    workspaceId: { type: String, index: true },
    enabled: { type: Boolean, required: true, default: true }
  },
  { timestamps: true }
);

RetentionPolicySchema.index({ recordType: 1, scope: 1, tenantSlug: 1, workspaceId: 1 });

export const RetentionPolicyRecord = mongoose.model<RetentionPolicyDocument>("RetentionPolicyRecord", RetentionPolicySchema);
