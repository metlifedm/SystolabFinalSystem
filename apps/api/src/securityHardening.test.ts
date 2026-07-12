import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { isAllowedCorsOrigin } from "./app.js";
import {
  assertPublicHttpUrl,
  decodeResponseBody,
  isBlockedNetworkAddress,
  normalizeUrl,
  resolvePublicHttpUrl
} from "./services/truth-engine/network.js";

describe("SYSTOLAB Phase 1 security hardening", () => {
  it("allows any loopback development port without weakening production CORS", () => {
    const allowed = ["https://systolab.in", "http://127.0.0.1:5173"];

    expect(isAllowedCorsOrigin("http://127.0.0.1:5175", allowed, "development")).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:62000", allowed, "sandbox")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:5175", allowed, "production")).toBe(false);
    expect(isAllowedCorsOrigin("https://untrusted.example.com", allowed, "development")).toBe(false);
    expect(isAllowedCorsOrigin("https://systolab.in", allowed, "production")).toBe(true);
  });
  it("normalizes scan URLs while keeping only HTTP and HTTPS protocols", () => {
    expect(normalizeUrl("example.com/path#section").toString()).toBe("https://example.com/path");
    expect(normalizeUrl("http://example.com").protocol).toBe("http:");
    expect(normalizeUrl("https://example.com").protocol).toBe("https:");
    expect(() => normalizeUrl("ftp://example.com")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeUrl("https://user:pass@example.com")).toThrow("embedded credentials");
  });

  it("blocks local, private, metadata, and reserved network addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.10",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "203.0.113.5",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1"
    ];

    for (const address of blocked) {
      expect(isBlockedNetworkAddress(address), address).toBe(true);
    }

    expect(isBlockedNetworkAddress("93.184.216.34")).toBe(false);
    expect(isBlockedNetworkAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("rejects unsafe scan targets before any crawler request can run", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1")).rejects.toThrow("Private");
    await expect(assertPublicHttpUrl("http://[::1]")).rejects.toThrow("Private");
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow("Private");
    await expect(assertPublicHttpUrl("http://metadata.google.internal")).rejects.toThrow("Local and internal");
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow("Only HTTP and HTTPS");
  });

  it("converts DNS lookup failures into controlled validation errors", async () => {
    await expect(assertPublicHttpUrl("https://definitely-not-real-systolab-host.invalid")).rejects.toMatchObject({
      message: "Unable to resolve hostname: definitely-not-real-systolab-host.invalid",
      status: 400
    });
  });

  it("allows public literal IP scan targets without DNS lookup", async () => {
    const resolution = await resolvePublicHttpUrl("https://93.184.216.34/test#ignored");

    expect(resolution.url.toString()).toBe("https://93.184.216.34/test");
    expect(resolution.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("decodes compressed website responses before parsing evidence", () => {
    const html = "<html><body><h1>SYSTOLAB crawler fixture</h1></body></html>";

    expect(decodeResponseBody(zlib.gzipSync(Buffer.from(html)), "gzip")).toBe(html);
    expect(decodeResponseBody(zlib.deflateSync(Buffer.from(html)), "deflate")).toBe(html);
    expect(decodeResponseBody(zlib.brotliCompressSync(Buffer.from(html)), "br")).toBe(html);
  });
});
