import mongoose, { Schema } from "mongoose";

export type PlatformAlertSeverity = "info" | "warning" | "critical";
export type PlatformAlertCategory = "scan" | "job" | "backup" | "security" | "dependency" | "slo" | "system";
export type PlatformAlertStatus = "open" | "acknowledged" | "resolved";

export interface PlatformAlertDocument extends mongoose.Document {
  alertId: string;
  alertKey: string;
  severity: PlatformAlertSeverity;
  category: PlatformAlertCategory;
  status: PlatformAlertStatus;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  autoResolved: boolean;
  createdAt: Date;
}

const PlatformAlertSchema = new Schema<PlatformAlertDocument>(
  {
    alertId: { type: String, required: true, unique: true, index: true },
    alertKey: { type: String, required: true, index: true },
    severity: { type: String, enum: ["info", "warning", "critical"], required: true, index: true },
    category: { type: String, enum: ["scan", "job", "backup", "security", "dependency", "slo", "system"], required: true, index: true },
    status: { type: String, enum: ["open", "acknowledged", "resolved"], required: true, default: "open", index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    autoResolved: { type: Boolean, required: true, default: false }
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

PlatformAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
PlatformAlertSchema.index({ alertKey: 1, status: 1 });
PlatformAlertSchema.index({ createdAt: -1 });

export const PlatformAlert = mongoose.model<PlatformAlertDocument>("PlatformAlert", PlatformAlertSchema);
