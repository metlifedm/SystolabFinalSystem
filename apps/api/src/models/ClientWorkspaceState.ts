import mongoose, { Schema } from "mongoose";
import { agencyRecommendationStatuses, type AgencyRecommendationStatus } from "./AgencyOperatingProfile.js";

export type ClientFollowUpStatus = "new" | "contacted" | "proposal_sent" | "won" | "lost" | "on_hold";

export interface ClientWorkspaceStateDocument extends mongoose.Document {
  tenantSlug: string;
  workspaceId: string;
  assignedConsultantUserId?: string;
  assignedConsultantName?: string;
  followUpStatus: ClientFollowUpStatus;
  renewalReminderAt?: Date;
  notes: Array<{
    noteId: string;
    body: string;
    createdBy?: string;
    createdAt: Date;
  }>;
  recommendationStatuses: Array<{
    recommendationId: string;
    status: AgencyRecommendationStatus;
    note?: string;
    updatedBy?: string;
    updatedAt: Date;
  }>;
  sharingControls: {
    allowView: boolean;
    allowDownload: boolean;
    allowPrint: boolean;
    allowShare: boolean;
    passwordProtected: boolean;
    passwordHint?: string;
    accessExpiresAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ClientWorkspaceStateSchema = new Schema<ClientWorkspaceStateDocument>(
  {
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, unique: true, index: true },
    assignedConsultantUserId: { type: String },
    assignedConsultantName: { type: String },
    followUpStatus: {
      type: String,
      enum: ["new", "contacted", "proposal_sent", "won", "lost", "on_hold"],
      default: "new"
    },
    renewalReminderAt: { type: Date },
    notes: {
      type: [
        {
          noteId: { type: String, required: true },
          body: { type: String, required: true },
          createdBy: { type: String },
          createdAt: { type: Date, default: Date.now }
        }
      ],
      default: []
    },
    recommendationStatuses: {
      type: [
        {
          recommendationId: { type: String, required: true },
          status: { type: String, enum: agencyRecommendationStatuses, default: "not_started" },
          note: { type: String },
          updatedBy: { type: String },
          updatedAt: { type: Date, default: Date.now }
        }
      ],
      default: []
    },
    sharingControls: {
      type: Schema.Types.Mixed,
      default: {
        allowView: true,
        allowDownload: true,
        allowPrint: true,
        allowShare: false,
        passwordProtected: false
      }
    }
  },
  { timestamps: true, minimize: false }
);

export const ClientWorkspaceState = mongoose.model<ClientWorkspaceStateDocument>("ClientWorkspaceState", ClientWorkspaceStateSchema);
