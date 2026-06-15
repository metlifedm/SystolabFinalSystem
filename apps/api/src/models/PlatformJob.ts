import mongoose, { Schema } from "mongoose";

export interface PlatformJobDocument extends mongoose.Document {
  jobId: string;
  jobType: string;
  queue: string;
  priority: number;
  status: "queued" | "scheduled" | "running" | "completed" | "failed" | "dead_letter";
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  scheduledFor: Date;
  lockedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  progress: number;
  result?: Record<string, unknown>;
  auditHistory: Array<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformJobSchema = new Schema<PlatformJobDocument>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    jobType: { type: String, required: true, index: true },
    queue: { type: String, required: true, index: true },
    priority: { type: Number, required: true, default: 5, index: true },
    status: { type: String, required: true, default: "queued", index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    scheduledFor: { type: Date, required: true, index: true },
    lockedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    errorMessage: { type: String },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    result: { type: Schema.Types.Mixed },
    auditHistory: { type: [{ type: Schema.Types.Mixed }], default: [] }
  },
  { timestamps: true, minimize: false }
);

PlatformJobSchema.index({ status: 1, queue: 1, scheduledFor: 1, priority: -1 });

export const PlatformJob = mongoose.model<PlatformJobDocument>("PlatformJob", PlatformJobSchema);
