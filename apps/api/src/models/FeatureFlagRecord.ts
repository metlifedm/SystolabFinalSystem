import mongoose, { Schema } from "mongoose";

export interface FeatureFlagRecordDocument extends mongoose.Document {
  flagKey: string;
  description: string;
  state: "enabled" | "disabled" | "gradual";
  rolloutPercentage: number;
  workspaceAllowList: string[];
  permissionKeys: string[];
  ownerTeam: string;
  auditHistory: Array<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

const FeatureFlagRecordSchema = new Schema<FeatureFlagRecordDocument>(
  {
    flagKey: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true },
    state: { type: String, required: true, default: "disabled", index: true },
    rolloutPercentage: { type: Number, required: true, default: 0 },
    workspaceAllowList: { type: [String], default: [] },
    permissionKeys: { type: [String], default: [] },
    ownerTeam: { type: String, required: true, default: "systolab-core" },
    auditHistory: { type: [{ type: Schema.Types.Mixed }], default: [] }
  },
  { timestamps: true, minimize: false }
);

export const FeatureFlagRecord = mongoose.model<FeatureFlagRecordDocument>("FeatureFlagRecord", FeatureFlagRecordSchema);
