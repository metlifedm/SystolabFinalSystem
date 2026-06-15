import mongoose, { Schema } from "mongoose";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "paused";
export type BillingInterval = "monthly" | "annual";

export interface TenantSubscriptionDocument extends mongoose.Document {
  subscriptionId: string;
  tenantId: string;
  tenantSlug: string;
  planId: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt?: Date;
  canceledAt?: Date;
  externalSubscriptionId?: string;
  externalCustomerId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSubscriptionSchema = new Schema<TenantSubscriptionDocument>(
  {
    subscriptionId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, unique: true, index: true },
    planId: { type: String, required: true, index: true },
    status: { type: String, required: true, default: "active", index: true },
    interval: { type: String, required: true, default: "monthly" },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    trialEndsAt: { type: Date },
    canceledAt: { type: Date },
    externalSubscriptionId: { type: String },
    externalCustomerId: { type: String },
    notes: { type: String }
  },
  { timestamps: true }
);

export const TenantSubscription = mongoose.model<TenantSubscriptionDocument>("TenantSubscription", TenantSubscriptionSchema);
