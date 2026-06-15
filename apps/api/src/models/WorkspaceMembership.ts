import mongoose, { Schema } from "mongoose";

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceMembershipDocument extends mongoose.Document {
  membershipId: string;
  userId: mongoose.Types.ObjectId;
  workspaceId: string;
  tenantId: mongoose.Types.ObjectId;
  tenantSlug: string;
  role: WorkspaceRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMembershipSchema = new Schema<WorkspaceMembershipDocument>(
  {
    membershipId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    role: { type: String, enum: ["owner", "editor", "viewer"], required: true },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

WorkspaceMembershipSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });

export const WorkspaceMembership = mongoose.model<WorkspaceMembershipDocument>("WorkspaceMembership", WorkspaceMembershipSchema);
