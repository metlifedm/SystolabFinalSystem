import mongoose, { Schema } from "mongoose";

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "retrying";

export interface WebhookDeliveryLogDocument extends mongoose.Document {
  deliveryId: string;
  webhookId: string;
  tenantSlug: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  deliveredAt?: Date;
  createdAt: Date;
}

const WebhookDeliveryLogSchema = new Schema<WebhookDeliveryLogDocument>(
  {
    deliveryId: { type: String, required: true, unique: true, index: true },
    webhookId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    eventType: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, required: true, default: "pending", index: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 5 },
    lastAttemptAt: { type: Date },
    nextRetryAt: { type: Date, index: true },
    responseStatus: { type: Number },
    responseBody: { type: String },
    errorMessage: { type: String },
    deliveredAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

WebhookDeliveryLogSchema.index({ status: 1, nextRetryAt: 1 });

export const WebhookDeliveryLog = mongoose.model<WebhookDeliveryLogDocument>("WebhookDeliveryLog", WebhookDeliveryLogSchema);
