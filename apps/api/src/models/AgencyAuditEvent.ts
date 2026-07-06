import mongoose, { Schema } from "mongoose";

export interface AgencyAuditEventDocument extends mongoose.Document {
  eventId: string;
  tenantSlug: string;
  workspaceId?: string;
  actorUserId?: string;
  action:
    | "agency_profile.updated"
    | "service_catalog.updated"
    | "proposal_template.updated"
    | "knowledge_base.updated"
    | "client_state.updated"
    | "recommendation_status.updated"
    | "sharing_controls.updated"
    | "proposal.generated"
    | "report.generated"
    | "client_access.viewed";
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const AgencyAuditEventSchema = new Schema<AgencyAuditEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    workspaceId: { type: String, index: true },
    actorUserId: { type: String, index: true },
    action: {
      type: String,
      required: true,
      index: true,
      enum: [
        "agency_profile.updated",
        "service_catalog.updated",
        "proposal_template.updated",
        "knowledge_base.updated",
        "client_state.updated",
        "recommendation_status.updated",
        "sharing_controls.updated",
        "proposal.generated",
        "report.generated",
        "client_access.viewed"
      ]
    },
    summary: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { minimize: false }
);

export const AgencyAuditEvent = mongoose.model<AgencyAuditEventDocument>("AgencyAuditEvent", AgencyAuditEventSchema);
