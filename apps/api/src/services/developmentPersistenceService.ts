import type { ReportSnapshot } from "@systolab/shared";
import { env } from "../config/env.js";
import { readJsonFile, resolveRuntimeFilePath, writeJsonFile } from "./runtimeFileStore.js";

export type DevelopmentSearchActivity = Record<string, unknown>;

interface DevelopmentStorePayload {
  schemaVersion: 1;
  snapshots: ReportSnapshot[];
  searchActivities: DevelopmentSearchActivity[];
  updatedAt: string;
}

export class DevelopmentFileStore {
  private loaded = false;
  private snapshots: ReportSnapshot[] = [];
  private searchActivities: DevelopmentSearchActivity[] = [];

  constructor(
    private readonly filePath: string,
    private readonly maxRecords: number,
    private readonly enabled: boolean
  ) {}

  getSnapshots(): ReportSnapshot[] {
    this.ensureLoaded();
    return this.snapshots.slice();
  }

  saveSnapshot(report: ReportSnapshot): void {
    if (!this.enabled) return;
    this.ensureLoaded();
    if (this.snapshots.some((item) => item.snapshotId === report.snapshotId)) return;
    this.snapshots = [...this.snapshots, report].slice(-this.maxRecords);
    this.persist();
  }

  getSearchActivities(): DevelopmentSearchActivity[] {
    this.ensureLoaded();
    return this.searchActivities.slice();
  }

  saveSearchActivity(activity: DevelopmentSearchActivity): void {
    if (!this.enabled) return;
    this.ensureLoaded();
    const activityId = String(activity.activityId ?? "");
    if (activityId && this.searchActivities.some((item) => item.activityId === activityId)) return;
    this.searchActivities = [...this.searchActivities, activity].slice(-this.maxRecords);
    this.persist();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.enabled) return;
    const payload = readJsonFile<Partial<DevelopmentStorePayload>>(this.filePath);
    this.snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    this.searchActivities = Array.isArray(payload?.searchActivities) ? payload.searchActivities : [];
  }

  private persist(): void {
    writeJsonFile(this.filePath, {
      schemaVersion: 1,
      snapshots: this.snapshots,
      searchActivities: this.searchActivities,
      updatedAt: new Date().toISOString()
    } satisfies DevelopmentStorePayload);
  }
}

export function isDevelopmentFilePersistenceEnabled(): boolean {
  return env.memoryStore && env.nodeEnv !== "test";
}

const developmentStore = new DevelopmentFileStore(
  resolveRuntimeFilePath(env.developmentStoreFile),
  env.developmentStoreMaxRecords,
  isDevelopmentFilePersistenceEnabled()
);

export function getDevelopmentSnapshots(): ReportSnapshot[] {
  return developmentStore.getSnapshots();
}

export function saveDevelopmentSnapshot(report: ReportSnapshot): void {
  developmentStore.saveSnapshot(report);
}

export function getDevelopmentSearchActivities(): DevelopmentSearchActivity[] {
  return developmentStore.getSearchActivities();
}

export function saveDevelopmentSearchActivity(activity: DevelopmentSearchActivity): void {
  developmentStore.saveSearchActivity(activity);
}
