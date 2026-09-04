import { EmailTemplate, type EmailTemplateType } from "../models/EmailTemplate.js";
import type { AuthDeliveryReceipt, AuthIdentifierType, OtpPurpose } from "@systolab/shared";
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

export class AuthenticationDeliveryError extends Error {}

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

  if (env.emailProvider === "brevo") {
    await sendViaBrevo(msg, fromEmail, fromName, messageId);
  } else if (env.emailProvider === "sendgrid") {
    await sendViaSendGrid(msg, fromEmail, fromName, messageId);
  } else if (env.emailProvider === "mailgun") {
    await sendViaMailgun(msg, fromEmail, fromName, messageId);
  } else if (env.emailProvider === "resend") {
    await sendViaResend(msg, fromEmail, fromName, messageId);
  } else {
    throw new Error(`Unsupported email provider: ${env.emailProvider}`);
  }

  return { messageId, simulated: false };
}

async function sendViaBrevo(
  msg: EmailMessage,
  fromEmail: string,
  fromName: string,
  messageId: string
): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.emailApiKey ?? "",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.bodyHtml,
      textContent: msg.bodyText,
      headers: { "X-SYSTOLAB-Message-Id": messageId }
    }),
    signal: AbortSignal.timeout(env.emailRequestTimeoutMs)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brevo email error ${response.status}: ${body.slice(0, 500)}`);
  }
  logger.info("email.sent", { provider: "brevo", messageId });
}

async function sendViaBrevoSms(recipient: string, content: string, messageId: string): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/transactionalSMS/send", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.emailApiKey ?? "",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: env.brevoSmsSender,
      recipient: recipient.replace(/\D/g, ""),
      content,
      type: "transactional",
      tag: "systolab-auth"
    }),
    signal: AbortSignal.timeout(env.emailRequestTimeoutMs)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brevo SMS error ${response.status}: ${body.slice(0, 500)}`);
  }
  logger.info("sms.sent", { provider: "brevo", messageId });
}

export async function sendAuthenticationCode(input: {
  identifierType: AuthIdentifierType;
  identifier: string;
  code: string;
  purpose: OtpPurpose;
  expiresInMinutes: number;
}): Promise<AuthDeliveryReceipt> {
  const canSendEmail = input.identifierType === "email" && env.emailProvider === "brevo" && Boolean(env.emailApiKey && env.emailFromAddress);
  const canSendSms = input.identifierType === "phone" && env.authPhoneEnabled && Boolean(env.emailApiKey && env.brevoSmsSender);

  if (!canSendEmail && !canSendSms) {
    if (env.authDeliveryPreview) {
      return {
        channel: "development_preview",
        message: "Development delivery preview. Configure Brevo before deployment.",
        previewCode: input.code
      };
    }
    throw new AuthenticationDeliveryError(
      input.identifierType === "email"
        ? "Email delivery is unavailable. Check the Brevo sender configuration."
        : "Phone sign-in is unavailable. Check the Brevo SMS configuration."
    );
  }

  const purposeLabel = input.purpose === "signup"
    ? "verify your SYSTOLAB account"
    : input.purpose === "password_reset"
      ? "reset your SYSTOLAB password"
      : "sign in to SYSTOLAB";
  const messageId = makeId("authmsg");

  try {
    if (input.identifierType === "email") {
      const safeCode = escapeHtml(input.code);
      await sendViaBrevo({
        to: input.identifier,
        subject: `Your SYSTOLAB verification code: ${input.code}`,
        bodyText: `Use ${input.code} to ${purposeLabel}. It expires in ${input.expiresInMinutes} minutes. If you did not request this, you can ignore this message.`,
        bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#10251f"><p style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#8a4b08">SYSTOLAB SECURE ACCESS</p><h1 style="font-size:24px;margin:16px 0 8px">Your verification code</h1><p style="line-height:1.6">Use this code to ${purposeLabel}.</p><div style="font-size:32px;font-weight:800;letter-spacing:.18em;padding:18px 22px;background:#f4f7f5;border:1px solid #cad8d2;border-radius:6px;text-align:center">${safeCode}</div><p style="line-height:1.6">This code expires in ${input.expiresInMinutes} minutes and can be used once.</p><p style="font-size:13px;color:#52665f">If you did not request this code, you can safely ignore this email.</p></div>`
      }, env.emailFromAddress!, env.emailFromName ?? "SYSTOLAB", messageId);
      return { channel: "email", message: "Verification code sent by email." };
    }

    await sendViaBrevoSms(
      input.identifier,
      `SYSTOLAB code: ${input.code}. Expires in ${input.expiresInMinutes} minutes. Do not share this code.`,
      messageId
    );
    return { channel: "sms", message: "Verification code sent by SMS." };
  } catch (error) {
    logger.error("auth.delivery_failed", {
      channel: input.identifierType,
      purpose: input.purpose,
      message: error instanceof Error ? error.message : String(error)
    });
    throw new AuthenticationDeliveryError("We could not send the verification code. Please try again shortly.");
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
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
