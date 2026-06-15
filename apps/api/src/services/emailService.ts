import { EmailTemplate, type EmailTemplateType } from "../models/EmailTemplate.js";
import { makeId } from "../utils/crypto.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isMongoConnected } from "../db/mongoose.js";

type TemplateRecord = { subject: string; bodyHtml: string; bodyText: string; fromName?: string; fromEmail?: string; isActive: boolean };
const memoryTemplates = new Map<string, TemplateRecord>();

/** Test helper — seed a template into the in-memory store (for use when MongoDB is not available) */
export function _seedMemoryEmailTemplate(tenantSlug: string, templateType: EmailTemplateType, tmpl: TemplateRecord): void {
  memoryTemplates.set(`${tenantSlug}::${templateType}`, tmpl);
}

export interface EmailMessage {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export async function getTemplate(
  tenantSlug: string,
  templateType: EmailTemplateType
): Promise<{ subject: string; bodyHtml: string; bodyText: string; fromName?: string; fromEmail?: string } | null> {
  if (!isMongoConnected()) {
    const t = memoryTemplates.get(`${tenantSlug}::${templateType}`);
    if (!t || !t.isActive) return null;
    const { isActive: _, ...rest } = t;
    return rest;
  }
  const tmpl = await EmailTemplate.findOne({ tenantSlug, templateType, isActive: true });
  return tmpl
    ? { subject: tmpl.subject, bodyHtml: tmpl.bodyHtml, bodyText: tmpl.bodyText, fromName: tmpl.fromName, fromEmail: tmpl.fromEmail }
    : null;
}

export async function sendEmail(msg: EmailMessage): Promise<{ messageId: string; simulated: boolean }> {
  const messageId = makeId("msg");

  if (!env.emailProvider || !env.emailApiKey) {
    logger.info("email.simulated", { to: msg.to, subject: msg.subject, messageId });
    return { messageId, simulated: true };
  }

  const fromEmail = msg.fromEmail ?? env.emailFromAddress ?? "noreply@systolab.app";
  const fromName = msg.fromName ?? env.emailFromName ?? "Systolab";

  if (env.emailProvider === "sendgrid") {
    await sendViaSendGrid(msg, fromEmail, fromName, messageId);
  } else if (env.emailProvider === "mailgun") {
    await sendViaMailgun(msg, fromEmail, fromName, messageId);
  } else if (env.emailProvider === "resend") {
    await sendViaResend(msg, fromEmail, fromName, messageId);
  } else {
    logger.warn("email.unknown_provider", { provider: env.emailProvider });
  }

  return { messageId, simulated: false };
}

async function sendViaSendGrid(
  msg: EmailMessage,
  fromEmail: string,
  fromName: string,
  messageId: string
): Promise<void> {
  const body = {
    personalizations: [{ to: [{ email: msg.to }] }],
    from: { email: fromEmail, name: fromName },
    subject: msg.subject,
    content: [
      { type: "text/plain", value: msg.bodyText },
      { type: "text/html", value: msg.bodyHtml }
    ]
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.emailApiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SendGrid error ${res.status}: ${text.slice(0, 500)}`);
  }
  logger.info("email.sent", { provider: "sendgrid", to: msg.to, messageId });
}

async function sendViaMailgun(
  msg: EmailMessage,
  fromEmail: string,
  fromName: string,
  messageId: string
): Promise<void> {
  if (!env.emailMailgunDomain) throw new Error("SYSTOLAB_EMAIL_MAILGUN_DOMAIN is required for Mailgun.");
  const form = new URLSearchParams({
    from: `${fromName} <${fromEmail}>`,
    to: msg.to,
    subject: msg.subject,
    text: msg.bodyText,
    html: msg.bodyHtml
  });

  const res = await fetch(`https://api.mailgun.net/v3/${env.emailMailgunDomain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${env.emailApiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mailgun error ${res.status}: ${text.slice(0, 500)}`);
  }
  logger.info("email.sent", { provider: "mailgun", to: msg.to, messageId });
}

async function sendViaResend(
  msg: EmailMessage,
  fromEmail: string,
  fromName: string,
  messageId: string
): Promise<void> {
  const body = {
    from: `${fromName} <${fromEmail}>`,
    to: [msg.to],
    subject: msg.subject,
    html: msg.bodyHtml,
    text: msg.bodyText
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.emailApiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${text.slice(0, 500)}`);
  }
  logger.info("email.sent", { provider: "resend", to: msg.to, messageId });
}

// ── Typed send helpers ─────────────────────────────────────────────────────────

export async function sendScanCompletedEmail(
  to: string,
  tenantSlug: string,
  vars: { workspaceName: string; scanScore: string; reportUrl: string }
): Promise<void> {
  const tmpl = await getTemplate(tenantSlug, "scan_completed");
  const subject = tmpl ? renderTemplate(tmpl.subject, vars) : `Scan completed — score ${vars.scanScore}`;
  const bodyHtml = tmpl
    ? renderTemplate(tmpl.bodyHtml, vars)
    : `<p>Your scan for <strong>${vars.workspaceName}</strong> is complete. Score: <strong>${vars.scanScore}</strong>. <a href="${vars.reportUrl}">View report</a></p>`;
  const bodyText = tmpl
    ? renderTemplate(tmpl.bodyText, vars)
    : `Scan complete for ${vars.workspaceName}. Score: ${vars.scanScore}. View report: ${vars.reportUrl}`;

  await sendEmail({ to, subject, bodyHtml, bodyText, fromName: tmpl?.fromName, fromEmail: tmpl?.fromEmail });
}

export async function sendAlertEmail(
  to: string,
  tenantSlug: string,
  vars: { workspaceName: string; alertTitle: string; alertSeverity: string; dashboardUrl: string }
): Promise<void> {
  const tmpl = await getTemplate(tenantSlug, "alert_triggered");
  const subject = tmpl ? renderTemplate(tmpl.subject, vars) : `Alert: ${vars.alertTitle} [${vars.alertSeverity}]`;
  const bodyHtml = tmpl
    ? renderTemplate(tmpl.bodyHtml, vars)
    : `<p>A <strong>${vars.alertSeverity}</strong> alert was triggered for <strong>${vars.workspaceName}</strong>: ${vars.alertTitle}. <a href="${vars.dashboardUrl}">View dashboard</a></p>`;
  const bodyText = tmpl
    ? renderTemplate(tmpl.bodyText, vars)
    : `Alert [${vars.alertSeverity}] for ${vars.workspaceName}: ${vars.alertTitle}. Dashboard: ${vars.dashboardUrl}`;

  await sendEmail({ to, subject, bodyHtml, bodyText, fromName: tmpl?.fromName, fromEmail: tmpl?.fromEmail });
}

export async function sendInvitationEmail(
  to: string,
  tenantSlug: string,
  vars: { inviterName: string; tenantName: string; acceptUrl: string; expiresIn: string }
): Promise<void> {
  const tmpl = await getTemplate(tenantSlug, "invitation");
  const subject = tmpl ? renderTemplate(tmpl.subject, vars) : `You've been invited to ${vars.tenantName}`;
  const bodyHtml = tmpl
    ? renderTemplate(tmpl.bodyHtml, vars)
    : `<p>${vars.inviterName} has invited you to join <strong>${vars.tenantName}</strong>. <a href="${vars.acceptUrl}">Accept invitation</a> (expires in ${vars.expiresIn}).</p>`;
  const bodyText = tmpl
    ? renderTemplate(tmpl.bodyText, vars)
    : `${vars.inviterName} invited you to ${vars.tenantName}. Accept: ${vars.acceptUrl} (expires in ${vars.expiresIn})`;

  await sendEmail({ to, subject, bodyHtml, bodyText, fromName: tmpl?.fromName, fromEmail: tmpl?.fromEmail });
}
