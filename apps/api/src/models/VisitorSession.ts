import mongoose, { Schema } from "mongoose";

export type DeviceType = "desktop" | "mobile" | "tablet";
export type SessionStatus = "active" | "ended" | "expired";

export interface VisitorSessionDocument extends mongoose.Document {
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  visitorId: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt?: Date;
  deviceType: DeviceType;
  browserName: string;
  browserVersion: string;
  os: string;
  screenWidth: number;
  screenHeight: number;
  country: string;
  region?: string;
  city?: string;
  landingPage: string;
  referralSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  consentId?: string;
  consentVersion?: string;
  pagesVisited: string[];
  journeyFingerprintId?: string;
  visitorFrustrationScore?: number;
  engagementScore?: number;
  visitorArchetype?: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const VisitorSessionSchema = new Schema<VisitorSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    visitorId: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    endedAt: { type: Date },
    deviceType: { type: String, required: true, enum: ["desktop", "mobile", "tablet"], default: "desktop" },
    browserName: { type: String, required: true, default: "unknown" },
    browserVersion: { type: String, required: true, default: "unknown" },
    os: { type: String, required: true, default: "unknown" },
    screenWidth: { type: Number, required: true, default: 0 },
    screenHeight: { type: Number, required: true, default: 0 },
    country: { type: String, required: true, default: "unknown" },
    region: { type: String },
    city: { type: String },
    landingPage: { type: String, required: true },
    referralSource: { type: String },
    utmSource: { type: String },
    utmMedium: { type: String },
    utmCampaign: { type: String },
    utmContent: { type: String },
    utmTerm: { type: String },
    consentId: { type: String, index: true },
    consentVersion: { type: String },
    pagesVisited: { type: [String], default: [] },
    journeyFingerprintId: { type: String, index: true },
    visitorFrustrationScore: { type: Number },
    engagementScore: { type: Number },
    visitorArchetype: { type: String },
    status: { type: String, required: true, enum: ["active", "ended", "expired"], default: "active", index: true }
  },
  { timestamps: true, minimize: false }
);

VisitorSessionSchema.index({ workspaceId: 1, status: 1 });
VisitorSessionSchema.index({ tenantSlug: 1, startedAt: -1 });
VisitorSessionSchema.index({ visitorId: 1, startedAt: -1 });
VisitorSessionSchema.index({ workspaceId: 1, lastSeenAt: -1 });

export const VisitorSession = mongoose.model<VisitorSessionDocument>("VisitorSession", VisitorSessionSchema);
