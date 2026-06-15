import mongoose, { Schema } from "mongoose";

export type DeliveryStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "failed"
  | "dead_letter"
  | "skipped";

export interface EventDeliveryDocument extends mongoose.Document {
  deliveryId: string;
  eventId: string;
  subscriptionId: string;
  subscriberId: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastAttemptAt?: Date;
  processedAt?: Date;
  errorMessage?: string;
  resultPayload?: Record<string, unknown>;
  createdAt: Date;
}

const EventDeliverySchema = new Schema<EventDeliveryDocument>(
  {
    deliveryId: { type: String, required: true, unique: true, index: true },
    eventId: { type: String, required: true, index: true },
    subscriptionId: { type: String, required: true, index: true },
    subscriberId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "processing", "delivered", "failed", "dead_letter", "skipped"],
      required: true,
      default: "pending",
      index: true
    },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    nextRetryAt: { type: Date, required: true, index: true },
    lastAttemptAt: { type: Date },
    processedAt: { type: Date },
    errorMessage: { type: String },
    resultPayload: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

// Compound unique prevents duplicate delivery for the same (event, subscription) pair
EventDeliverySchema.index({ eventId: 1, subscriptionId: 1 }, { unique: true });
// Primary queue index: pick up due deliveries ordered by nextRetryAt
EventDeliverySchema.index({ status: 1, nextRetryAt: 1 });
// Admin views
EventDeliverySchema.index({ status: 1, createdAt: -1 });
EventDeliverySchema.index({ subscriberId: 1, status: 1, createdAt: -1 });

export const EventDeliveryRecord = mongoose.model<EventDeliveryDocument>(
  "EventDeliveryRecord",
  EventDeliverySchema
);
