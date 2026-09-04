import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "./config/env.js";
import { AuthenticationDeliveryError, sendAuthenticationCode } from "./services/emailService.js";

const original = {
  emailProvider: env.emailProvider,
  emailApiKey: env.emailApiKey,
  emailFromAddress: env.emailFromAddress,
  emailFromName: env.emailFromName,
  authDeliveryPreview: env.authDeliveryPreview,
  authPhoneEnabled: env.authPhoneEnabled,
  brevoSmsSender: env.brevoSmsSender
};

afterEach(() => {
  Object.assign(env, original);
  vi.unstubAllGlobals();
});

describe("authentication delivery", () => {
  it("sends email verification codes through Brevo without returning the code", async () => {
    Object.assign(env, {
      emailProvider: "brevo",
      emailApiKey: "test-brevo-key",
      emailFromAddress: "verified@example.com",
      emailFromName: "SYSTOLAB",
      authDeliveryPreview: false
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "brevo-message" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAuthenticationCode({
      identifierType: "email",
      identifier: "customer@example.com",
      code: "482913",
      purpose: "signup",
      expiresInMinutes: 10
    });

    expect(result).toEqual({ channel: "email", message: "Verification code sent by email." });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(new Headers(request.headers).get("api-key")).toBe("test-brevo-key");
    expect(String(request.body)).toContain("482913");
  });

  it("returns a code only in explicit non-production preview mode", async () => {
    Object.assign(env, {
      emailProvider: "",
      emailApiKey: undefined,
      emailFromAddress: undefined,
      authDeliveryPreview: true
    });

    const result = await sendAuthenticationCode({
      identifierType: "email",
      identifier: "developer@example.com",
      code: "123456",
      purpose: "login",
      expiresInMinutes: 10
    });

    expect(result.channel).toBe("development_preview");
    expect(result.previewCode).toBe("123456");
  });

  it("fails closed when production-style delivery is not configured", async () => {
    Object.assign(env, {
      emailProvider: "",
      emailApiKey: undefined,
      emailFromAddress: undefined,
      authDeliveryPreview: false
    });

    await expect(sendAuthenticationCode({
      identifierType: "email",
      identifier: "customer@example.com",
      code: "123456",
      purpose: "password_reset",
      expiresInMinutes: 20
    })).rejects.toBeInstanceOf(AuthenticationDeliveryError);
  });
});
