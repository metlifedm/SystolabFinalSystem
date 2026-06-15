import { describe, expect, it } from "vitest";
import { makeId } from "./utils/crypto.js";
import {
  _seedMemoryEmailTemplate,
  getTemplate,
  sendAlertEmail,
  sendEmail,
  sendInvitationEmail,
  sendScanCompletedEmail
} from "./services/emailService.js";

describe("email service — template rendering", () => {
  it("sendEmail in simulation mode returns simulated=true without throwing", async () => {
    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test email",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello"
    });
    expect(result.messageId).toBeTruthy();
    expect(result.simulated).toBe(true);
  });

  it("sendEmail produces a unique messageId for each call", async () => {
    const r1 = await sendEmail({ to: "a@example.com", subject: "s1", bodyHtml: "<p>1</p>", bodyText: "1" });
    const r2 = await sendEmail({ to: "b@example.com", subject: "s2", bodyHtml: "<p>2</p>", bodyText: "2" });
    expect(r1.messageId).not.toBe(r2.messageId);
  });

  it("sendScanCompletedEmail does not throw in simulation mode", async () => {
    await expect(
      sendScanCompletedEmail("user@example.com", "test-tenant", {
        workspaceName: "Example Site",
        scanScore: "78",
        reportUrl: "https://app.systolab.app/test-tenant/reports/snap_001"
      })
    ).resolves.toBeUndefined();
  });

  it("sendAlertEmail does not throw in simulation mode", async () => {
    await expect(
      sendAlertEmail("ops@example.com", "test-tenant", {
        workspaceName: "Example Site",
        alertTitle: "Trust score dropped below threshold",
        alertSeverity: "high",
        dashboardUrl: "https://app.systolab.app/test-tenant"
      })
    ).resolves.toBeUndefined();
  });

  it("sendInvitationEmail does not throw in simulation mode", async () => {
    await expect(
      sendInvitationEmail("invited@example.com", "test-tenant", {
        inviterName: "Alice",
        tenantName: "ACME Corp",
        acceptUrl: "https://app.systolab.app/invitations/accept/tok_abc123",
        expiresIn: "7 days"
      })
    ).resolves.toBeUndefined();
  });
});

describe("email service — custom templates", () => {
  it("getTemplate returns null when no tenant template is configured", async () => {
    const tmpl = await getTemplate("no-templates-tenant", "scan_completed");
    expect(tmpl).toBeNull();
  });

  it("getTemplate retrieves a saved custom template for the tenant", async () => {
    const tenantSlug = `email-tmpl-${makeId("t").slice(2, 8)}`;
    _seedMemoryEmailTemplate(tenantSlug, "scan_completed", {
      subject: "Your scan is done — {{workspaceName}}",
      bodyHtml: "<p>Score: {{scanScore}}</p>",
      bodyText: "Score: {{scanScore}}",
      isActive: true
    });

    const tmpl = await getTemplate(tenantSlug, "scan_completed");
    expect(tmpl).not.toBeNull();
    expect(tmpl!.subject).toContain("{{workspaceName}}");
  });

  it("custom template {{variable}} interpolation produces correct output", async () => {
    const tenantSlug = `email-interp-${makeId("t").slice(2, 8)}`;
    _seedMemoryEmailTemplate(tenantSlug, "invitation", {
      subject: "Join {{tenantName}}",
      bodyHtml: "<p>Hi! Accept: <a href='{{acceptUrl}}'>here</a></p>",
      bodyText: "Accept: {{acceptUrl}}",
      isActive: true
    });

    await expect(
      sendInvitationEmail("join@example.com", tenantSlug, {
        inviterName: "Bob",
        tenantName: "Test Corp",
        acceptUrl: "https://app.systolab.app/invitations/accept/tok_xyz",
        expiresIn: "3 days"
      })
    ).resolves.toBeUndefined();
  });

  it("inactive templates are not returned by getTemplate", async () => {
    const tenantSlug = `email-inactive-${makeId("t").slice(2, 8)}`;
    _seedMemoryEmailTemplate(tenantSlug, "welcome", {
      subject: "Welcome!",
      bodyHtml: "<p>Welcome</p>",
      bodyText: "Welcome",
      isActive: false
    });

    const tmpl = await getTemplate(tenantSlug, "welcome");
    expect(tmpl).toBeNull();
  });
});
