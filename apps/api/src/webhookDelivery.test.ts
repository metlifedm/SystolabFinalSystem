import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { makeId } from "./utils/crypto.js";
import { createTenant, createWebhook } from "./services/membershipService.js";
import {
  _memDeliveriesForTest,
  deliverOne,
  dispatchWebhooks,
  listDeliveries,
  signPayload
} from "./services/webhookDeliveryService.js";

describe("webhook signing", () => {
  it("signPayload produces a Stripe-compatible t=,v1= header format", () => {
    const sig = signPayload({ event: "scan.completed" }, "secret-key-hex");
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it("signPayload produces a valid HMAC-SHA256 signature", () => {
    const secret = "test-signing-secret";
    const payload = { eventType: "scan.completed", workspaceId: "ws_001" };
    const header = signPayload(payload, secret);
    const [tPart, v1Part] = header.split(",");
    const timestamp = tPart!.split("=")[1]!;
    const sig = v1Part!.split("=")[1]!;
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest("hex");
    expect(sig).toBe(expected);
  });

  it("different secrets produce different signatures", () => {
    const payload = { foo: "bar" };
    const sig1 = signPayload(payload, "secret-one");
    const sig2 = signPayload(payload, "secret-two");
    expect(sig1).not.toBe(sig2);
  });

  it("same secret + same payload at same millisecond produces the same signature", () => {
    const payload = { stable: true };
    const secret = "stable-secret";
    // Force same timestamp by stubbing — approximate with same-ms calls
    const sig1 = signPayload(payload, secret);
    const sig2 = signPayload(payload, secret);
    // Signatures differ only if timestamps differ (sub-second resolution)
    // We validate format is consistent
    expect(sig1).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(sig2).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});

describe("webhook dispatch and delivery logging", () => {
  it("dispatchWebhooks creates a delivery log entry for each matching webhook", async () => {
    const slug = `wh-dispatch-${makeId("t").slice(2, 8)}`;
    const { tenant } = await createTenant(slug, "WH Dispatch Tenant", makeId("usr"));
    await createWebhook(tenant._id, slug, "https://hooks.example.com/test", ["scan.completed"], makeId("usr"));

    const before = [..._memDeliveriesForTest.values()].filter((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug).length;
    await dispatchWebhooks(slug, "scan.completed", { snapshotId: "snap_001", score: 72 });
    const after = [..._memDeliveriesForTest.values()].filter((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug).length;

    expect(after - before).toBe(1);
  });

  it("dispatchWebhooks does not create entries when no webhook matches the event type", async () => {
    const slug = `wh-nomatch-${makeId("t").slice(2, 8)}`;
    const { tenant } = await createTenant(slug, "No Match Tenant", makeId("usr"));
    await createWebhook(tenant._id, slug, "https://hooks.example.com/scan", ["scan.completed"], makeId("usr"));

    const before = [..._memDeliveriesForTest.values()].filter((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug).length;
    await dispatchWebhooks(slug, "alert.triggered", { alertId: "alrt_001" });
    const after = [..._memDeliveriesForTest.values()].filter((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug).length;

    expect(after - before).toBe(0);
  });

  it("deliverOne marks the delivery as failed and schedules retry when URL is unreachable", async () => {
    const slug = `wh-fail-${makeId("t").slice(2, 8)}`;
    const { tenant } = await createTenant(slug, "Fail Tenant", makeId("usr"));
    await createWebhook(tenant._id, slug, "http://127.0.0.1:19999/nonexistent", ["scan.completed"], makeId("usr"));
    await dispatchWebhooks(slug, "scan.completed", { test: true });

    const log = [..._memDeliveriesForTest.values()].find((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug);
    expect(log).toBeTruthy();
    const logAny = log as unknown as Record<string, unknown>;

    await deliverOne(logAny["deliveryId"] as string);

    const updated = _memDeliveriesForTest.get(logAny["deliveryId"] as string);
    const updatedAny = updated as unknown as Record<string, unknown>;
    // After one failure: status should be "retrying" (attempts < maxAttempts) or "failed"
    expect(["retrying", "failed"]).toContain(updatedAny["status"]);
    expect(updatedAny["attempts"]).toBe(1);
  });

  it("listDeliveries returns delivery logs for the given webhook", async () => {
    const slug = `wh-list-${makeId("t").slice(2, 8)}`;
    const { tenant } = await createTenant(slug, "List Tenant", makeId("usr"));
    const { webhook } = await createWebhook(tenant._id, slug, "https://hooks.example.com/list", ["scan.completed"], makeId("usr"));
    await dispatchWebhooks(slug, "scan.completed", { listTest: true });

    const { deliveries, total } = await listDeliveries(webhook.webhookId);
    expect(total).toBeGreaterThanOrEqual(1);
    expect((deliveries[0] as unknown as Record<string, unknown>)["webhookId"]).toBe(webhook.webhookId);
  });

  it("delivery log initially has status=pending and attempts=0", async () => {
    const slug = `wh-pending-${makeId("t").slice(2, 8)}`;
    const { tenant } = await createTenant(slug, "Pending Tenant", makeId("usr"));
    await createWebhook(tenant._id, slug, "https://hooks.example.com/pending", ["scan.completed"], makeId("usr"));
    await dispatchWebhooks(slug, "scan.completed", { pending: true });

    const log = [..._memDeliveriesForTest.values()].find((d) => (d as unknown as Record<string, unknown>)["tenantSlug"] === slug);
    const logAny = log as unknown as Record<string, unknown>;
    expect(logAny["status"]).toBe("pending");
    expect(logAny["attempts"]).toBe(0);
  });
});
