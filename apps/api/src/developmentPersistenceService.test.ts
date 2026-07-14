import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { ReportSnapshot } from "@systolab/shared";
import { describe, expect, it } from "vitest";
import { DevelopmentFileStore } from "./services/developmentPersistenceService.js";

describe("development file persistence", () => {
  it("restores immutable snapshots and user search activities in a fresh store instance", () => {
    const filePath = resolve(process.cwd(), "tmp", `development-store-${randomUUID()}.json`);
    try {
      const firstProcess = new DevelopmentFileStore(filePath, 10, true);
      const report = {
        snapshotId: "snap_restart_001",
        createdAt: "2026-07-14T10:00:00.000Z"
      } as unknown as ReportSnapshot;
      const activity = {
        activityId: "usrscan_restart_001",
        userId: "user_001",
        userName: "Production User",
        userEmail: "user@example.com",
        targetUrl: "https://example.com",
        result: { snapshotId: report.snapshotId, oss: 72 }
      };

      firstProcess.saveSnapshot(report);
      firstProcess.saveSnapshot(report);
      firstProcess.saveSearchActivity(activity);
      firstProcess.saveSearchActivity(activity);

      const restartedProcess = new DevelopmentFileStore(filePath, 10, true);
      expect(restartedProcess.getSnapshots()).toEqual([report]);
      expect(restartedProcess.getSearchActivities()).toEqual([activity]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("enforces the configured retention limit", () => {
    const filePath = resolve(process.cwd(), "tmp", `development-store-${randomUUID()}.json`);
    try {
      const store = new DevelopmentFileStore(filePath, 2, true);
      for (const snapshotId of ["snap_1", "snap_2", "snap_3"]) {
        store.saveSnapshot({ snapshotId, createdAt: "2026-07-14T10:00:00.000Z" } as unknown as ReportSnapshot);
      }
      expect(store.getSnapshots().map((item) => item.snapshotId)).toEqual(["snap_2", "snap_3"]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});
