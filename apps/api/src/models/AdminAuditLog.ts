import mongoose, { Schema } from "mongoose";

export type AdminAuditAction =
  | "admin.login"
  | "admin.login_failed"
  | "admin.login_locked"
  | "admin.logout"
  | "admin.session_revoke"
  | "admin.create"
  | "admin.deactivate"
  | "admin.bootstrap"
  | "module.upsert"
  | "module.activate"
  | "module.validate"
  | "job.enqueue"
  | "job.run_due"
  | "warehouse.materialize"
  | "feature_flag.upsert"
  | "sandbox.run_experiment";

export interface AdminAuditLogDocument extends mongoose.Document {
  auditId: string;
  adminUserId?: mongoose.Types.ObjectId;
  adminEmail: string;
  role: string;
  action: AdminAuditAction | string;
  resource?: string;
  resourceId?: string;
  success: boolean;
  ipHash: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AdminAuditLogSchema = new Schema<AdminAuditLogDocument>(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    adminUserId: { type: Schema.Types.ObjectId, ref: "AdminUser", index: true },
    adminEmail: { type: String, required: true, index: true },
    role: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    resource: { type: String, index: true },
    resourceId: { type: String },
    success: { type: Boolean, required: true },
    ipHash: { type: String, required: true },
    userAgent: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AdminAuditLog = mongoose.model<AdminAuditLogDocument>("AdminAuditLog", AdminAuditLogSchema);
