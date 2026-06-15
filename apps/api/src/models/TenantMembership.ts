import mongoose, { Schema } from "mongoose";

export type TenantRole = "owner" | "member" | "guest";

export interface TenantMembershipDocument extends mongoose.Document {
  membershipId: string;
  userId: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  tenantSlug: string;
  role: TenantRole;
  isActive: boolean;
  invitedBy?: mongoose.Types.ObjectId;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TenantMembershipSchema = new Schema<TenantMembershipDocument>(
  {
    membershipId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    role: { type: String, enum: ["owner", "member", "guest"], required: true },
    isActive: { type: Boolean, default: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "AuthUser" },
    joinedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

TenantMembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

export const TenantMembership = mongoose.model<TenantMembershipDocument>("TenantMembership", TenantMembershipSchema);
