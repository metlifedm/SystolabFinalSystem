import mongoose, { Schema } from "mongoose";

export interface ModuleRegistryEntryDocument extends mongoose.Document {
  moduleId: string;
  name: string;
  version: string;
  dependencies: string[];
  permissions: string[];
  healthStatus: "healthy" | "degraded" | "failed" | "unknown";
  activationState: "active" | "inactive" | "disabled";
  ownerTeam: string;
  compatibility: Record<string, unknown>;
  auditHistory: Array<Record<string, unknown>>;
  lastValidatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ModuleRegistryEntrySchema = new Schema<ModuleRegistryEntryDocument>(
  {
    moduleId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    version: { type: String, required: true },
    dependencies: { type: [String], default: [] },
    permissions: { type: [String], default: [] },
    healthStatus: { type: String, required: true, default: "unknown", index: true },
    activationState: { type: String, required: true, default: "active", index: true },
    ownerTeam: { type: String, required: true, default: "systolab-core" },
    compatibility: { type: Schema.Types.Mixed, default: {} },
    auditHistory: { type: [{ type: Schema.Types.Mixed }], default: [] },
    lastValidatedAt: { type: Date }
  },
  { timestamps: true, minimize: false }
);

export const ModuleRegistryEntry = mongoose.model<ModuleRegistryEntryDocument>("ModuleRegistryEntry", ModuleRegistryEntrySchema);
