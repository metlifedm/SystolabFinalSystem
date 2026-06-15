import mongoose, { Schema } from "mongoose";

export interface UserSearchActivityDocument extends mongoose.Document {
  activityId: string;
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
  sessionId?: string;
  deviceId?: string;
  tenantSlug: string;
  workspaceId: string;
  targetUrl: string;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: Date;
}

const UserSearchActivitySchema = new Schema<UserSearchActivityDocument>(
  {
    activityId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, index: true },
    userEmail: { type: String, index: true },
    userPhone: { type: String, index: true },
    userName: { type: String, index: true },
    sessionId: { type: String, index: true },
    deviceId: { type: String, index: true },
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    request: { type: Schema.Types.Mixed, required: true },
    result: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

UserSearchActivitySchema.index({ userId: 1, createdAt: -1 });
UserSearchActivitySchema.index({ tenantSlug: 1, createdAt: -1 });

export const UserSearchActivity = mongoose.model<UserSearchActivityDocument>("UserSearchActivity", UserSearchActivitySchema);
