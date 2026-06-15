import mongoose, { Schema } from "mongoose";

export interface WorkspaceDocument extends mongoose.Document {
  workspaceId: string;
  tenantSlug: string;
  ownerUserId?: string;
  targetUrl: string;
  industry?: string;
  businessContext?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<WorkspaceDocument>(
  {
    workspaceId: { type: String, required: true, unique: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    ownerUserId: { type: String, index: true },
    targetUrl: { type: String, required: true, index: true },
    industry: { type: String, index: true },
    businessContext: { type: Schema.Types.Mixed },
    preferences: { type: Schema.Types.Mixed }
  },
  { timestamps: true, minimize: false }
);

export const Workspace = mongoose.model<WorkspaceDocument>("Workspace", WorkspaceSchema);
