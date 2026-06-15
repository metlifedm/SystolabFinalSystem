import mongoose, { Schema } from "mongoose";

export type PlanTier = "free" | "starter" | "pro" | "enterprise" | "custom";

export interface PlanLimits {
  scansPerMonth: number;       // -1 = unlimited
  apiCallsPerMonth: number;
  workspaces: number;
  seats: number;
  storageMb: number;
  webhooks: number;
  apiKeys: number;
  customDomain: boolean;
  whiteLabel: boolean;
  prioritySupport: boolean;
  dataRetentionDays: number;
}

export interface BillingPlanDocument extends mongoose.Document {
  planId: string;
  tier: PlanTier;
  name: string;
  description: string;
  priceCentsPerMonth: number;
  priceCentsPerYear?: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  createdAt: Date;
}

const BillingPlanSchema = new Schema<BillingPlanDocument>(
  {
    planId: { type: String, required: true, unique: true, index: true },
    tier: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, required: true, default: "" },
    priceCentsPerMonth: { type: Number, required: true, default: 0 },
    priceCentsPerYear: { type: Number },
    limits: { type: Schema.Types.Mixed, required: true },
    features: [{ type: String }],
    isActive: { type: Boolean, required: true, default: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const BillingPlan = mongoose.model<BillingPlanDocument>("BillingPlan", BillingPlanSchema);
