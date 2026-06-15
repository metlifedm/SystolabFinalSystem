import mongoose, { Schema } from "mongoose";

export interface UsageRecordDocument extends mongoose.Document {
  usageId: string;
  tenantId: string;
  tenantSlug: string;
  periodKey: string;          // "YYYY-MM"
  scansUsed: number;
  apiCallsUsed: number;
  storageUsedMb: number;
  seatsUsed: number;
  webhookDeliveriesCount: number;
  costCents: number;
  createdAt: Date;
  updatedAt: Date;
}

const UsageRecordSchema = new Schema<UsageRecordDocument>(
  {
    usageId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    periodKey: { type: String, required: true, index: true },
    scansUsed: { type: Number, required: true, default: 0 },
    apiCallsUsed: { type: Number, required: true, default: 0 },
    storageUsedMb: { type: Number, required: true, default: 0 },
    seatsUsed: { type: Number, required: true, default: 0 },
    webhookDeliveriesCount: { type: Number, required: true, default: 0 },
    costCents: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

// Unique record per tenant per month
UsageRecordSchema.index({ tenantSlug: 1, periodKey: 1 }, { unique: true });

export const UsageRecord = mongoose.model<UsageRecordDocument>("UsageRecord", UsageRecordSchema);
