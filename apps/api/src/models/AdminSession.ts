import mongoose, { Schema } from "mongoose";
import type { AdminRole } from "./AdminUser.js";

export interface AdminSessionDocument extends mongoose.Document {
  sessionId: string;
  adminUserId: mongoose.Types.ObjectId;
  role: AdminRole;
  jti: string;
  tokenHash: string;
  ipHash: string;
  userAgent: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

const AdminSessionSchema = new Schema<AdminSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    adminUserId: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true, index: true },
    role: { type: String, enum: ["owner", "manager"], required: true },
    jti: { type: String, required: true, unique: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    ipHash: { type: String, required: true },
    userAgent: { type: String, default: "" },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AdminSession = mongoose.model<AdminSessionDocument>("AdminSession", AdminSessionSchema);
