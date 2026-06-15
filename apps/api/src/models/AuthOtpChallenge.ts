import mongoose, { Schema } from "mongoose";
import type { AuthIdentifierType, OtpPurpose } from "@systolab/shared";

export interface AuthOtpChallengeDocument extends mongoose.Document {
  challengeId: string;
  userId?: mongoose.Types.ObjectId;
  identifierType: AuthIdentifierType;
  identifier: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedUntil?: Date;
  consumedAt?: Date;
  ipHash: string;
  deviceFingerprintHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuthOtpChallengeSchema = new Schema<AuthOtpChallengeDocument>(
  {
    challengeId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", index: true },
    identifierType: { type: String, enum: ["email", "phone"], required: true },
    identifier: { type: String, required: true, index: true },
    purpose: { type: String, enum: ["signup", "login", "password_reset"], required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    resendAvailableAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lockedUntil: { type: Date },
    consumedAt: { type: Date },
    ipHash: { type: String, required: true, index: true },
    deviceFingerprintHash: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

export const AuthOtpChallenge = mongoose.model<AuthOtpChallengeDocument>("AuthOtpChallenge", AuthOtpChallengeSchema);
