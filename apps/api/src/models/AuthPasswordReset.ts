import mongoose, { Schema } from "mongoose";
import type { AuthIdentifierType } from "@systolab/shared";

export interface AuthPasswordResetDocument extends mongoose.Document {
  resetId: string;
  userId: mongoose.Types.ObjectId;
  identifierType: AuthIdentifierType;
  identifier: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedUntil?: Date;
  consumedAt?: Date;
  ipHash: string;
  deviceFingerprintHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuthPasswordResetSchema = new Schema<AuthPasswordResetDocument>(
  {
    resetId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", required: true, index: true },
    identifierType: { type: String, enum: ["email", "phone"], required: true },
    identifier: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lockedUntil: { type: Date },
    consumedAt: { type: Date },
    ipHash: { type: String, required: true, index: true },
    deviceFingerprintHash: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

export const AuthPasswordReset = mongoose.model<AuthPasswordResetDocument>("AuthPasswordReset", AuthPasswordResetSchema);
