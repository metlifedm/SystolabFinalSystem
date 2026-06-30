import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { makeId } from "./utils/crypto.js";
import {
  enqueuePlatformJob,
  getPlatformJob,
  getScanQueueMetrics,
  listScanJobs
} from "./services/platformControlPlaneService.js";
import { isScanWorkerRunning, runScanWorkerCycle, startScanWorker, stopScanWorker } from "./services/scanWorker.js";
import { assertPublicHttpUrl, isBlockedNetworkAddress, normalizeUrl } from "./services/truth-engine/network.js";

describe("scan job â€” enqueue and retrieve", () => {
  it("enqueuePlatformJob creates a scan job in queued status", async () => {
    const job = await enqueuePlatformJob({
      jobType: "scan.execution",
      queue: "scan",
      payload: {
        targetUrl: "https://fixture.example.com",
        tenantSlug: "fixture-tenant",
        mode: "fast_scan",
        competitorUrls: []
      }
    });

    expect(job.jobId).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.queue).toBe("scan");
    expect(job.jobType).toBe("scan.execution");
  });

  it("getPlatformJob returns the job by ID", async () => {
    const job = await enqueuePlatformJob({
      jobType: "scan.execution",
      queue: "scan",
      payload: { targetUrl: "https://get-job.example.com", tenantSlug: "fixture-tenant", mode: "fast_scan" }
    });

    const found = await getPlatformJob(job.jobId);
    expect(found?.jobId).toBe(job.jobId);
    expect(found?.payload["targetUrl"]).toBe("https://get-job.example.com");
  });

  it("listScanJobs returns recently queued jobs", async () => {
    const uniqueUrl = `https://list-jobs-${makeId("url")}.example.com`;
    await enqueuePlatformJob({
      jobType: "scan.execution",
      queue: "scan",
      payload: { targetUrl: uniqueUrl, tenantSlug: "fixture-tenant", mode: "fast_scan" }
    });

    const jobs = await listScanJobs(50);
    expect(jobs.some((j) => j.payload["targetUrl"] === uniqueUrl)).toBe(true);
  });

  it("getScanQueueMetrics returns numeric depth and stats", async () => {
    const metrics = await getScanQueueMetrics();
    expect(typeof metrics.queued).toBe("number");
    expect(typeof metrics.running).toBe("number");
    expect(metrics.queued).toBeGreaterThanOrEqual(0);
  });

  it("job payload preserves competitorUrls array", async () => {
    const competitors = ["https://comp-a.example.com", "https://comp-b.example.com"];
    const job = await enqueuePlatformJob({
      jobType: "scan.execution",
      queue: "scan",
      payload: { targetUrl: "https://with-competitors.example.com", tenantSlug: "comp-test", mode: "full_audit", competitorUrls: competitors }
    });
    expect(job.payload["competitorUrls"]).toEqual(competitors);
  });

  it("higher-priority jobs have a higher priority value", async () => {
    const highPriority = await enqueuePlatformJob({ jobType: "scan.execution", queue: "scan", priority: 9, payload: { targetUrl: "https://hi.example.com", tenantSlug: "p-test", mode: "full_audit" } });
    const lowPriority = await enqueuePlatformJob({ jobType: "scan.execution", queue: "scan", priority: 1, payload: { targetUrl: "https://lo.example.com", tenantSlug: "p-test", mode: "fast_scan" } });
    expect(highPriority.priority).toBeGreaterThan(lowPriority.priority!);
  });

  it("allows repeated scan status polling without hitting the scan creation limit", async () => {
    const job = await enqueuePlatformJob({
      jobType: "scan.execution",
      queue: "scan",
      payload: { targetUrl: "https://status-poll.example.com", tenantSlug: "poll-test", mode: "fast_scan" }
    });
    const app = createApp();
    const server = await listenOnRandomPort(app);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (let index = 0; index < 12; index += 1) {
        const response = await fetch(`${baseUrl}/api/scans/${job.jobId}`);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
    } finally {
      await closeServer(server);
    }
  });

  it("returns 400 for unresolvable scan targets without crashing the API", async () => {
    const app = createApp();
    const server = await listenOnRandomPort(app);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUrl: "https://definitely-not-real-systolab-host.invalid", mode: "fast_scan" })
      });
      const payload = await response.json() as { error?: { message?: string; status?: number } };

      expect(response.status).toBe(400);
      expect(payload.error?.message).toBe("Unable to resolve hostname: definitely-not-real-systolab-host.invalid");
      expect(payload.error?.status).toBe(400);

      const health = await fetch(`${baseUrl}/`);
      expect(health.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });
});

describe("scan worker â€” lifecycle", () => {
  it("startScanWorker sets isRunning to true, stopScanWorker sets it back to false", () => {
    expect(isScanWorkerRunning()).toBe(false);
    startScanWorker();
    expect(isScanWorkerRunning()).toBe(true);
    stopScanWorker();
    expect(isScanWorkerRunning()).toBe(false);
  });

  it("startScanWorker is idempotent â€” calling twice does not double-register the timer", () => {
    startScanWorker();
    startScanWorker(); // Second call should be a no-op
    expect(isScanWorkerRunning()).toBe(true);
    stopScanWorker();
    expect(isScanWorkerRunning()).toBe(false);
  });

  it("runScanWorkerCycle returns a result object without throwing (even with no pending jobs)", async () => {
    const result = await runScanWorkerCycle();
    expect(typeof result.processed).toBe("number");
    expect(Array.isArray(result.completed)).toBe(true);
    expect(Array.isArray(result.failures)).toBe(true);
  });
});

describe("scan security â€” SSRF prevention", () => {
  it("rejects private IPv4 scan targets", async () => {
    await expect(assertPublicHttpUrl("http://192.168.1.1")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://10.0.0.1")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://172.16.0.1")).rejects.toThrow();
  });

  it("rejects loopback addresses", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[::1]")).rejects.toThrow();
  });

  it("rejects cloud metadata endpoints", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://metadata.google.internal")).rejects.toThrow();
  });

  it("rejects non-HTTP/HTTPS protocols", async () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow();
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow();
  });

  it("rejects URLs with embedded credentials", async () => {
    expect(() => normalizeUrl("https://user:pass@example.com")).toThrow("embedded credentials");
  });

  it("allows legitimate public scan targets", async () => {
    expect(() => normalizeUrl("https://example.com")).not.toThrow();
    expect(() => normalizeUrl("http://example.com/path")).not.toThrow();
    expect(isBlockedNetworkAddress("93.184.216.34")).toBe(false);
  });
});

function listenOnRandomPort(app: ReturnType<typeof createApp>): Promise<ReturnType<typeof app.listen>> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server: ReturnType<ReturnType<typeof createApp>["listen"]>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
