import { describe, expect, it, afterEach } from "vitest";
import { isScanWorkerRunning, startScanWorker, stopScanWorker } from "./services/scanWorker.js";
import { startWebhookWorker, stopWebhookWorker } from "./services/webhookWorker.js";
import { startRetentionWorker, stopRetentionWorker } from "./services/retentionWorker.js";
import { startEventReplayWorker, stopEventReplayWorker } from "./services/eventReplayWorker.js";

afterEach(() => {
  // Ensure workers are stopped after each test to prevent timer leaks
  stopScanWorker();
  stopWebhookWorker();
  stopRetentionWorker();
  stopEventReplayWorker();
});

describe("scan worker lifecycle", () => {
  it("starts and stops cleanly", () => {
    expect(isScanWorkerRunning()).toBe(false);
    startScanWorker();
    expect(isScanWorkerRunning()).toBe(true);
    stopScanWorker();
    expect(isScanWorkerRunning()).toBe(false);
  });

  it("start is idempotent — double-start does not create two timers", () => {
    startScanWorker();
    startScanWorker();
    expect(isScanWorkerRunning()).toBe(true);
    stopScanWorker();
    expect(isScanWorkerRunning()).toBe(false);
  });

  it("stop is safe to call when already stopped", () => {
    expect(() => stopScanWorker()).not.toThrow();
    expect(() => stopScanWorker()).not.toThrow();
  });
});

describe("webhook worker lifecycle", () => {
  it("starts and stops without throwing", () => {
    expect(() => startWebhookWorker()).not.toThrow();
    expect(() => stopWebhookWorker()).not.toThrow();
  });

  it("double-start is safe", () => {
    startWebhookWorker();
    startWebhookWorker();
    expect(() => stopWebhookWorker()).not.toThrow();
  });

  it("stop is safe when not started", () => {
    expect(() => stopWebhookWorker()).not.toThrow();
  });
});

describe("retention worker lifecycle", () => {
  it("starts and stops without throwing", () => {
    expect(() => startRetentionWorker()).not.toThrow();
    expect(() => stopRetentionWorker()).not.toThrow();
  });

  it("stop is safe when not started", () => {
    expect(() => stopRetentionWorker()).not.toThrow();
  });
});

describe("event replay worker lifecycle", () => {
  it("starts and stops without throwing", () => {
    expect(() => startEventReplayWorker()).not.toThrow();
    expect(() => stopEventReplayWorker()).not.toThrow();
  });

  it("stop is safe when not started", () => {
    expect(() => stopEventReplayWorker()).not.toThrow();
  });
});
