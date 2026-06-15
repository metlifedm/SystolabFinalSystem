import mongoose, { Schema } from "mongoose";

export type BackupStatus = "running" | "completed" | "failed" | "verified" | "verification_failed";
export type BackupTrigger = "scheduled" | "manual" | "api";
export type BackupMode = "full" | "collections";
export type VerificationStatus = "pass" | "fail";

export interface BackupRecordDocument extends mongoose.Document {
  backupId: string;
  status: BackupStatus;
  trigger: BackupTrigger;
  mode: BackupMode;
  collections: string[];
  sizeBytes: number;
  fileCount: number;
  backupPath: string;
  durationMs: number;
  mongoUriHash: string;
  errorMessage?: string;
  verifiedAt?: Date;
  verificationStatus?: VerificationStatus;
  verificationDetails?: Record<string, unknown>;
  completedAt?: Date;
  createdAt: Date;
}

const BackupRecordSchema = new Schema<BackupRecordDocument>(
  {
    backupId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["running", "completed", "failed", "verified", "verification_failed"],
      required: true,
      index: true
    },
    trigger: { type: String, enum: ["scheduled", "manual", "api"], required: true },
    mode: { type: String, enum: ["full", "collections"], required: true, default: "full" },
    collections: [{ type: String }],
    sizeBytes: { type: Number, required: true, default: 0 },
    fileCount: { type: Number, required: true, default: 0 },
    backupPath: { type: String, required: true },
    durationMs: { type: Number, required: true, default: 0 },
    mongoUriHash: { type: String, required: true },
    errorMessage: { type: String },
    verifiedAt: { type: Date },
    verificationStatus: { type: String, enum: ["pass", "fail"] },
    verificationDetails: { type: Schema.Types.Mixed },
    completedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

BackupRecordSchema.index({ createdAt: -1 });
BackupRecordSchema.index({ status: 1, createdAt: -1 });

export const BackupRecord = mongoose.model<BackupRecordDocument>("BackupRecord", BackupRecordSchema);
