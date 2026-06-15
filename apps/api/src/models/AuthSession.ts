import mongoose, { Schema } from "mongoose";
import type { AuthProviderType } from "@systolab/shared";

export interface AuthSessionDocument extends mongoose.Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  deviceLabel: string;
  deviceFingerprintHash: string;
  ipHash: string;
  provider: AuthProviderType;
  refreshTokenHash: string;
  accessTokenJti: string;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt?: Date;
}

const AuthSessionSchema = new Schema<AuthSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true, index: true },
    deviceId: { type: String, required: true, index: true },
    deviceLabel: { type: String, required: true },
    deviceFingerprintHash: { type: String, required: true, index: true },
    ipHash: { type: String, required: true, index: true },
    provider: { type: String, required: true },
    refreshTokenHash: { type: String, required: true, index: true },
    accessTokenJti: { type: String, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    refreshExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date }
  },
  { timestamps: true }
);

export const AuthSession = mongoose.model<AuthSessionDocument>("AuthSession", AuthSessionSchema);
