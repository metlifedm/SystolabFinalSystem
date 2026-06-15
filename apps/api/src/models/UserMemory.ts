import mongoose, { Schema } from "mongoose";

export interface UserMemoryDocument extends mongoose.Document {
  userId: string;
  workspaceId?: string;
  identity: Record<string, unknown>;
  preferences: Record<string, unknown>;
  businessContext: Record<string, unknown>;
  behavioralSignals: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
}

const UserMemorySchema = new Schema<UserMemoryDocument>(
  {
    userId: { type: String, required: true, index: true },
    workspaceId: { type: String, index: true },
    identity: { type: Schema.Types.Mixed, default: {} },
    preferences: { type: Schema.Types.Mixed, default: {} },
    businessContext: { type: Schema.Types.Mixed, default: {} },
    behavioralSignals: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, minimize: false }
);

UserMemorySchema.index({ userId: 1, workspaceId: 1 }, { unique: true, sparse: true });

export const UserMemory = mongoose.model<UserMemoryDocument>("UserMemory", UserMemorySchema);
