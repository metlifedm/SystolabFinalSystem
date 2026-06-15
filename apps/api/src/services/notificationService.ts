import type { ReportSnapshot } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";
import { NotificationOutbox } from "../models/NotificationOutbox.js";
import { makeId } from "../utils/crypto.js";
import { sendAlertEmail } from "./emailService.js";

export interface NotificationOutboxItem {
  notificationId: string;
  workspaceId: string;
  snapshotId: string;
  targetUrl: string;
  alertId: string;
  channel: "dashboard" | "email_simulated";
  recipient: string;
  subject: string;
  body: string;
  status: "queued" | "delivered_simulated" | "failed";
  queuedAt: string;
  deliveredAt?: string;
}

const memoryNotifications: NotificationOutboxItem[] = [];

export async function queueAlertNotifications(report: ReportSnapshot, workspaceId: string): Promise<NotificationOutboxItem[]> {
  if (report.alertEngine.alerts.length === 0) return [];
  const queuedAt = new Date();
  const jobs = report.alertEngine.alerts.flatMap((alert) =>
    report.monitoringScheduler.alertChannels.map((channel) => ({
      notificationId: makeId("ntf"),
      workspaceId,
      snapshotId: report.snapshotId,
      targetUrl: report.targetUrl,
      alertId: alert.alertId,
      channel,
      recipient: channel === "dashboard" ? "dashboard" : `${report.tenantBranding.slug}@systolab.local`,
      subject: `[SYSTOLAB] ${alert.title}`,
      body: `${alert.message}\n\nTarget: ${report.targetUrl}\nTrigger: ${alert.trigger}\nSnapshot: ${report.snapshotId}`,
      status: channel === "email_simulated" ? "delivered_simulated" as const : "queued" as const,
      queuedAt: queuedAt.toISOString(),
      deliveredAt: channel === "email_simulated" ? queuedAt.toISOString() : undefined
    }))
  );

  // Fire real emails for jobs whose recipient is a real address (not the local placeholder)
  for (const job of jobs) {
    if (job.channel !== "dashboard" && !job.recipient.endsWith("@systolab.local")) {
      void sendAlertEmail(job.recipient, report.tenantBranding.slug, {
        workspaceName: report.targetUrl,
        alertTitle: job.subject,
        alertSeverity: "alert",
        dashboardUrl: `https://app.systolab.app/${report.tenantBranding.slug}`
      }).catch(() => undefined);
    }
  }

  if (!isMongoConnected()) {
    memoryNotifications.push(...jobs);
    return jobs;
  }

  await NotificationOutbox.insertMany(
    jobs.map((job) => ({
      ...job,
      queuedAt: new Date(job.queuedAt),
      deliveredAt: job.deliveredAt ? new Date(job.deliveredAt) : undefined
    })),
    { ordered: false }
  ).catch(() => undefined);
  return jobs;
}

export async function listNotificationOutbox(limit = 100): Promise<NotificationOutboxItem[]> {
  if (!isMongoConnected()) return [...memoryNotifications].slice(-limit).reverse();
  const rows = await NotificationOutbox.find({}).sort({ queuedAt: -1 }).limit(limit).lean();
  return rows.map((row) => ({
    notificationId: row.notificationId,
    workspaceId: row.workspaceId,
    snapshotId: row.snapshotId,
    targetUrl: row.targetUrl,
    alertId: row.alertId,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    queuedAt: row.queuedAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString()
  }));
}
