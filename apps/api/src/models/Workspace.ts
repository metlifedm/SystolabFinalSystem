import mongoose, { Schema } from "mongoose";

export type MonitoringCadence = "manual" | "daily" | "weekly" | "monthly";

export interface WorkspaceMonitoringConfig {
  cadence?: MonitoringCadence;
  enabled?: boolean;
}

export interface WorkspaceDocument extends mongoose.Document {
  workspaceId: string;
  tenantSlug: string;
  ownerUserId?: string;
  targetUrl: string;
  projectName?: string;
  clientCompanyName?: string;
  contactPerson?: string;
  clientLogoUrl?: string;
  city?: string;
  serviceArea?: string;
  businessType?: string;
  targetCountry?: string;
  targetLocation?: string;
  competitorUrls?: string[];
  gbpUrl?: string;
  monitoringConfig?: WorkspaceMonitoringConfig;
  clientAccessEnabled?: boolean;
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
    projectName: { type: String },
    clientCompanyName: { type: String },
    contactPerson: { type: String },
    clientLogoUrl: { type: String },
    city: { type: String, index: true },
    serviceArea: { type: String },
    businessType: { type: String, index: true },
    targetCountry: { type: String, index: true },
    targetLocation: { type: String, index: true },
    competitorUrls: { type: [String], default: [] },
    gbpUrl: { type: String },
    monitoringConfig: { type: Schema.Types.Mixed },
    clientAccessEnabled: { type: Boolean, default: false },
    industry: { type: String, index: true },
    businessContext: { type: Schema.Types.Mixed },
    preferences: { type: Schema.Types.Mixed }
  },
  { timestamps: true, minimize: false }
);

export const Workspace = mongoose.model<WorkspaceDocument>("Workspace", WorkspaceSchema);
