import mongoose, { Schema } from "mongoose";

export interface NotificationOutboxDocument extends mongoose.Document {
  notificationId: string;
  workspaceId: string;
  snapshotId: string;
  targetUrl: string;
  alertId: string;
  channel: "dashboard" | "email_simulated";
  recipient: string;
  subject: string;
  body: string;
  status: "queued" | "delivered_simulated" | "failed";
  queuedAt: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationOutboxSchema = new Schema<NotificationOutboxDocument>(
  {
    notificationId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    alertId: { type: String, required: true, index: true },
    channel: { type: String, required: true, index: true },
    recipient: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, required: true, index: true },
    queuedAt: { type: Date, required: true },
    deliveredAt: { type: Date }
  },
  { timestamps: true }
);

export const NotificationOutbox = mongoose.model<NotificationOutboxDocument>("NotificationOutbox", NotificationOutboxSchema);
