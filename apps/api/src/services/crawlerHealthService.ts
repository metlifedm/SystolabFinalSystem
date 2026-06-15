import { env } from "../config/env.js";

export interface CrawlOutcome {
  url: string;
  success: boolean;
  statusCode?: number;
  durationMs: number;
  softBlocked?: boolean;
  retryCount?: number;
  errorCategory?: string;
  robotsExcluded?: boolean;
  recordedAt: Date;
}

export interface CrawlerHealthSummary {
  windowSize: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorCounts: Record<string, number>;
  timeoutCount: number;
  softBlockCount: number;
  robotsExclusionCount: number;
  totalOutcomes: number;
  status: "healthy" | "degraded" | "unhealthy";
  assessedAt: Date;
}

const _window: CrawlOutcome[] = [];

export function recordCrawlOutcome(outcome: CrawlOutcome): void {
  _window.push(outcome);
  const max = Math.max(1, env.crawlerHealthWindowSize);
  while (_window.length > max) _window.shift();
}

export function getCrawlerHealthSummary(): CrawlerHealthSummary {
  const outcomes = [..._window];
  const total = outcomes.length;
  const assessedAt = new Date();

  if (total === 0) {
    return {
      windowSize: env.crawlerHealthWindowSize,
      successRate: 1,
      avgDurationMs: 0,
      p95DurationMs: 0,
      errorCounts: {},
      timeoutCount: 0,
      softBlockCount: 0,
      robotsExclusionCount: 0,
      totalOutcomes: 0,
      status: "healthy",
      assessedAt
    };
  }

  const successCount = outcomes.filter((o) => o.success).length;
  const successRate = successCount / total;

  const durations = outcomes.map((o) => o.durationMs).sort((a, b) => a - b);
  const avgDurationMs = Math.round(durations.reduce((s, d) => s + d, 0) / total);
  const p95Index = Math.min(total - 1, Math.floor(total * 0.95));
  const p95DurationMs = durations[p95Index] ?? 0;

  const errorCounts: Record<string, number> = {};
  let timeoutCount = 0;
  let softBlockCount = 0;
  let robotsExclusionCount = 0;

  for (const o of outcomes) {
    if (o.errorCategory) {
      errorCounts[o.errorCategory] = (errorCounts[o.errorCategory] ?? 0) + 1;
      if (o.errorCategory === "timeout") timeoutCount++;
    }
    if (o.softBlocked) softBlockCount++;
    if (o.robotsExcluded) robotsExclusionCount++;
  }

  let status: "healthy" | "degraded" | "unhealthy";
  if (successRate < 0.5) status = "unhealthy";
  else if (successRate < 0.8) status = "degraded";
  else status = "healthy";

  return {
    windowSize: env.crawlerHealthWindowSize,
    successRate: Math.round(successRate * 10000) / 10000,
    avgDurationMs,
    p95DurationMs,
    errorCounts,
    timeoutCount,
    softBlockCount,
    robotsExclusionCount,
    totalOutcomes: total,
    status,
    assessedAt
  };
}
