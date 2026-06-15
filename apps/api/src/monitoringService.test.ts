import { describe, expect, it } from "vitest";
import { findDueMonitoringSchedules, markMonitoringScheduleRun, upsertMonitoringSchedule } from "./services/monitoringService.js";

describe("SYSTOLAB monitoring scheduler", () => {
  it("stores due schedules and advances the next run after execution", async () => {
    const schedule = await upsertMonitoringSchedule({
      targetUrl: "https://example.com",
      tenantSlug: "test",
      cadence: "weekly",
      competitorUrls: ["https://www.iana.org"],
      alertChannels: ["dashboard", "email_simulated"],
      runNow: true
    });

    expect(schedule.enabled).toBe(true);
    expect(schedule.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());

    const due = await findDueMonitoringSchedules(new Date(), 10);
    expect(due.some((item) => item.scheduleId === schedule.scheduleId)).toBe(true);

    const advanced = await markMonitoringScheduleRun(schedule, new Date("2026-06-07T00:00:00.000Z"));
    expect(advanced.lastRunAt?.toISOString()).toBe("2026-06-07T00:00:00.000Z");
    expect(advanced.nextRunAt.toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });
});
