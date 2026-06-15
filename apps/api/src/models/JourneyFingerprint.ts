import mongoose, { Schema } from "mongoose";

export interface JourneyStep {
  page: string;
  enteredAt: Date;
  exitedAt?: Date;
  dwellMs: number;
  maxScrollDepth: number;
  eventCount: number;
}

export interface JourneyFingerprintDocument extends mongoose.Document {
  fingerprintId: string;
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  path: JourneyStep[];
  entryPage: string;
  exitPage?: string;
  totalPages: number;
  totalDurationMs: number;
  conversionOccurred: boolean;
  abandonmentPage?: string;
  patternHash: string;
  archetypeMatch?: string;
  createdAt: Date;
}

const JourneyStepSchema = new Schema<JourneyStep>(
  {
    page: { type: String, required: true },
    enteredAt: { type: Date, required: true },
    exitedAt: { type: Date },
    dwellMs: { type: Number, required: true, default: 0 },
    maxScrollDepth: { type: Number, required: true, default: 0 },
    eventCount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const JourneyFingerprintSchema = new Schema<JourneyFingerprintDocument>(
  {
    fingerprintId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    path: { type: [JourneyStepSchema], default: [] },
    entryPage: { type: String, required: true },
    exitPage: { type: String },
    totalPages: { type: Number, required: true, default: 1 },
    totalDurationMs: { type: Number, required: true, default: 0 },
    conversionOccurred: { type: Boolean, required: true, default: false },
    abandonmentPage: { type: String },
    patternHash: { type: String, required: true, index: true },
    archetypeMatch: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

JourneyFingerprintSchema.index({ workspaceId: 1, patternHash: 1 });
JourneyFingerprintSchema.index({ workspaceId: 1, archetypeMatch: 1 });

export const JourneyFingerprint = mongoose.model<JourneyFingerprintDocument>("JourneyFingerprint", JourneyFingerprintSchema);
