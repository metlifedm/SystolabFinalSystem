import mongoose, { Schema } from "mongoose";

export type WebhookEvent =
  | "scan.completed"
  | "scan.failed"
  | "alert.triggered"
  | "monitoring.completed"
  | "recommendation.generated";

export interface WebhookRecordDocument extends mongoose.Document {
  webhookId: string;
  tenantId: mongoose.Types.ObjectId;
  tenantSlug: string;
  workspaceId?: string;
  url: string;
  events: WebhookEvent[];
  secretHash: string;
  signingSecret?: string;
  isActive: boolean;
  lastDeliveredAt?: Date;
  failureCount: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookRecordSchema = new Schema<WebhookRecordDocument>(
  {
    webhookId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, index: true },
    url: { type: String, required: true },
    events: { type: [String], default: ["scan.completed"] },
    secretHash: { type: String, required: true },
    signingSecret: { type: String },
    isActive: { type: Boolean, default: true, index: true },
    lastDeliveredAt: { type: Date },
    failureCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true }
  },
  { timestamps: true }
);

export const WebhookRecord = mongoose.model<WebhookRecordDocument>("WebhookRecord", WebhookRecordSchema);
