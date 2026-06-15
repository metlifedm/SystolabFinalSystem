import mongoose, { Schema } from "mongoose";

export interface MonitoringScheduleDocument extends mongoose.Document {
  scheduleId: string;
  workspaceId: string;
  tenantSlug: string;
  targetUrl: string;
  cadence: "daily" | "weekly" | "monthly";
  enabled: boolean;
  competitorUrls: string[];
  alertChannels: string[];
  lastRunAt?: Date;
  nextRunAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MonitoringScheduleSchema = new Schema<MonitoringScheduleDocument>(
  {
    scheduleId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    targetUrl: { type: String, required: true, index: true },
    cadence: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: true, index: true },
    competitorUrls: { type: [String], default: [] },
    alertChannels: { type: [String], default: ["dashboard"] },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

export const MonitoringSchedule = mongoose.model<MonitoringScheduleDocument>("MonitoringSchedule", MonitoringScheduleSchema);
