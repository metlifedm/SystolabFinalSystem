import mongoose, { Schema } from "mongoose";

export interface ApiKeyDocument extends mongoose.Document {
  tenantId: mongoose.Types.ObjectId;
  label: string;
  keyHash: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<ApiKeyDocument>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    label: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true, index: true },
    scopes: { type: [String], default: ["scans:create", "snapshots:read"] },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date }
  },
  { timestamps: true }
);

export const ApiKey = mongoose.model<ApiKeyDocument>("ApiKey", ApiKeySchema);
