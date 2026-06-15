import mongoose, { Schema } from "mongoose";

export type ConsentMethod = "explicit" | "implied" | "opt-out";

export interface ConsentAuditEntry {
  action: "granted" | "revoked" | "updated" | "version_upgraded" | "expired";
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ConsentCategories {
  behavioral: boolean;   // VIL behavioral tracking — must be true for any VIL data collection
  analytics: boolean;    // Aggregate analytics
  marketing: boolean;    // Marketing / remarketing
}

export interface ConsentRecordDocument extends mongoose.Document {
  consentId: string;
  visitorId: string;
  workspaceId: string;
  tenantSlug: string;
  consentGiven: boolean;
  consentVersion: string;
  consentMethod: ConsentMethod;
  consentGivenAt?: Date;
  consentRevokedAt?: Date;
  isActive: boolean;
  ipHashAtConsent?: string;
  userAgentHash?: string;
  consentCategories: ConsentCategories;
  auditTrail: ConsentAuditEntry[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConsentAuditEntrySchema = new Schema<ConsentAuditEntry>(
  {
    action: { type: String, required: true },
    timestamp: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed }
  },
  { _id: false }
);

const ConsentCategoriesSchema = new Schema<ConsentCategories>(
  {
    behavioral: { type: Boolean, required: true, default: false },
    analytics: { type: Boolean, required: true, default: false },
    marketing: { type: Boolean, required: true, default: false }
  },
  { _id: false }
);

const ConsentRecordSchema = new Schema<ConsentRecordDocument>(
  {
    consentId: { type: String, required: true, unique: true, index: true },
    visitorId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    consentGiven: { type: Boolean, required: true, default: false },
    consentVersion: { type: String, required: true, default: "1.0" },
    consentMethod: { type: String, required: true, enum: ["explicit", "implied", "opt-out"], default: "explicit" },
    consentGivenAt: { type: Date },
    consentRevokedAt: { type: Date },
    isActive: { type: Boolean, required: true, default: true, index: true },
    ipHashAtConsent: { type: String },
    userAgentHash: { type: String },
    consentCategories: { type: ConsentCategoriesSchema, required: true, default: () => ({ behavioral: false, analytics: false, marketing: false }) },
    auditTrail: { type: [ConsentAuditEntrySchema], default: [] },
    expiresAt: { type: Date, index: true }
  },
  { timestamps: true, minimize: false }
);

// One active consent record per visitor per workspace
ConsentRecordSchema.index({ visitorId: 1, workspaceId: 1, isActive: 1 });
ConsentRecordSchema.index({ workspaceId: 1, consentGiven: 1 });
ConsentRecordSchema.index({ workspaceId: 1, createdAt: -1 });

export const ConsentRecord = mongoose.model<ConsentRecordDocument>("ConsentRecord", ConsentRecordSchema);
