import mongoose, { Schema } from "mongoose";
import type { TenantRole } from "./TenantMembership.js";
import type { WorkspaceRole } from "./WorkspaceMembership.js";

export interface InvitationDocument extends mongoose.Document {
  invitationId: string;
  email: string;
  tenantId: mongoose.Types.ObjectId;
  tenantSlug: string;
  workspaceId?: string;
  tenantRole: TenantRole;
  workspaceRole?: WorkspaceRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date;
  acceptedBy?: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const InvitationSchema = new Schema<InvitationDocument>(
  {
    invitationId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, index: true },
    tenantRole: { type: String, enum: ["owner", "member", "guest"], required: true },
    workspaceRole: { type: String, enum: ["owner", "editor", "viewer"] },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date },
    acceptedBy: { type: Schema.Types.ObjectId, ref: "AuthUser" },
    invitedBy: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Invitation = mongoose.model<InvitationDocument>("Invitation", InvitationSchema);
