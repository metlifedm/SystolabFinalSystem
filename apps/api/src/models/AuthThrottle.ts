import mongoose, { Schema } from "mongoose";

export interface AuthThrottleDocument extends mongoose.Document {
  throttleKey: string;
  scope: string;
  attempts: number;
  firstSeenAt: Date;
  lastAttemptAt: Date;
  lockedUntil?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AuthThrottleSchema = new Schema<AuthThrottleDocument>(
  {
    throttleKey: { type: String, required: true, unique: true, index: true },
    scope: { type: String, required: true, index: true },
    attempts: { type: Number, default: 0 },
    firstSeenAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, required: true },
    lockedUntil: { type: Date },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const AuthThrottle = mongoose.model<AuthThrottleDocument>("AuthThrottle", AuthThrottleSchema);
