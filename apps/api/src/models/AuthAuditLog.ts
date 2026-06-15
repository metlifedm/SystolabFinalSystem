import mongoose, { Schema } from "mongoose";

export type AuthAuditEvent =
  | "google_login_attempt"
  | "google_login_success"
  | "otp_requested"
  | "otp_verify_failed"
  | "otp_verify_success"
  | "password_register"
  | "password_login_failed"
  | "password_login_success"
  | "password_reset_requested"
  | "password_reset_failed"
  | "password_reset_success"
  | "session_refresh"
  | "session_logout"
  | "session_revoked"
  | "auth_lock_applied"
  | "throttle_triggered"
  | "suspicious_activity";

export interface AuthAuditLogDocument extends mongoose.Document {
  auditId: string;
  userId?: mongoose.Types.ObjectId;
  identifier?: string;
  eventType: AuthAuditEvent;
  success: boolean;
  reason?: string;
  ipHash: string;
  deviceFingerprintHash: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuthAuditLogSchema = new Schema<AuthAuditLogDocument>(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "AuthUser", index: true },
    identifier: { type: String, index: true },
    eventType: { type: String, required: true, index: true },
    success: { type: Boolean, required: true, index: true },
    reason: { type: String },
    ipHash: { type: String, required: true, index: true },
    deviceFingerprintHash: { type: String, required: true, index: true },
    userAgent: { type: String },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuthAuditLog = mongoose.model<AuthAuditLogDocument>("AuthAuditLog", AuthAuditLogSchema);
