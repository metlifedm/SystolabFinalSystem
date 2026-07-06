import mongoose, { Schema } from "mongoose";

export const agencyRecommendationStatuses = ["not_started", "in_progress", "completed", "not_applicable", "waiting_for_client"] as const;
export type AgencyRecommendationStatus = typeof agencyRecommendationStatuses[number];

export interface AgencyOperatingProfileDocument extends mongoose.Document {
  tenantSlug: string;
  profile: unknown;
  serviceCatalog: unknown[];
  proposalTemplates: unknown[];
  knowledgeBase: unknown;
  sharingDefaults: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const AgencyOperatingProfileSchema = new Schema<AgencyOperatingProfileDocument>(
  {
    tenantSlug: { type: String, required: true, unique: true, index: true },
    profile: { type: Schema.Types.Mixed, default: {} },
    serviceCatalog: { type: [Schema.Types.Mixed], default: [] },
    proposalTemplates: { type: [Schema.Types.Mixed], default: [] },
    knowledgeBase: { type: Schema.Types.Mixed, default: {} },
    sharingDefaults: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, minimize: false }
);

export const AgencyOperatingProfile = mongoose.model<AgencyOperatingProfileDocument>("AgencyOperatingProfile", AgencyOperatingProfileSchema);


