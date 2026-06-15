// In-process metrics registry — no external dependencies.
// Counters (monotonic), gauges (point-in-time), histograms (distribution of values).
// Prometheus text format is generated on demand by renderPrometheusText().

type Labels = Record<string, string>;

// Encode labels to a stable key for storage
function labelsToKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

// ── Counters ────────────────────────────────────────────────────────────────────
// name -> (labelKey -> value)
const counterStore = new Map<string, Map<string, number>>();

export function incrementCounter(name: string, labels: Labels = {}, amount = 1): void {
  if (!counterStore.has(name)) counterStore.set(name, new Map());
  const m = counterStore.get(name)!;
  const k = labelsToKey(labels);
  m.set(k, (m.get(k) ?? 0) + amount);
}

export function getCounterValue(name: string, labels: Labels = {}): number {
  return counterStore.get(name)?.get(labelsToKey(labels)) ?? 0;
}

export function sumCounterValues(name: string): number {
  let total = 0;
  for (const v of (counterStore.get(name)?.values() ?? [])) total += v;
  return total;
}

// ── Gauges ─────────────────────────────────────────────────────────────────────
// name -> (labelKey -> value)
const gaugeStore = new Map<string, Map<string, number>>();

export function setGauge(name: string, value: number, labels: Labels = {}): void {
  if (!gaugeStore.has(name)) gaugeStore.set(name, new Map());
  gaugeStore.get(name)!.set(labelsToKey(labels), value);
}

export function getGaugeValue(name: string, labels: Labels = {}): number {
  return gaugeStore.get(name)?.get(labelsToKey(labels)) ?? 0;
}

// ── Histograms ──────────────────────────────────────────────────────────────────
// name -> observations array (ring-buffered at 10 000)
const histogramStore = new Map<string, number[]>();

export function recordHistogram(name: string, value: number): void {
  if (!histogramStore.has(name)) histogramStore.set(name, []);
  const obs = histogramStore.get(name)!;
  obs.push(value);
  if (obs.length > 10_000) obs.splice(0, obs.length - 10_000);
}

export function histogramPercentile(name: string, p: number): number | null {
  const obs = histogramStore.get(name);
  if (!obs || obs.length === 0) return null;
  const sorted = [...obs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

export function histogramSummary(name: string): {
  count: number;
  sum: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
} {
  const obs = histogramStore.get(name) ?? [];
  return {
    count: obs.length,
    sum: obs.reduce((a, b) => a + b, 0),
    p50: histogramPercentile(name, 50),
    p95: histogramPercentile(name, 95),
    p99: histogramPercentile(name, 99)
  };
}

// ── Prometheus text-format export ───────────────────────────────────────────────

const METRIC_HELP: Record<string, string> = {
  systolab_http_requests_total: "Total HTTP requests processed",
  systolab_http_request_duration_ms: "HTTP request duration in milliseconds",
  systolab_errors_total: "Total errors tracked",
  systolab_scan_duration_ms: "Scan execution duration in milliseconds",
  systolab_rate_limit_hits_total: "Total rate-limit threshold violations",
  systolab_uptime_seconds: "Process uptime in seconds",
  systolab_memory_heap_used_bytes: "Heap memory currently used",
  systolab_memory_heap_total_bytes: "Heap memory total allocated",
  systolab_memory_rss_bytes: "Process resident set size",
  systolab_mongo_connected: "MongoDB connection state (1=connected 0=disconnected)",
  systolab_scan_queue_queued: "Scan jobs currently queued",
  systolab_scan_queue_running: "Scan jobs currently running",
  systolab_scan_queue_failed: "Scan jobs failed",
  systolab_scan_queue_dead_letter: "Scan jobs in dead-letter queue",
  systolab_scan_avg_processing_ms: "Average scan processing time in milliseconds",
  systolab_alerts_open: "Total open alerts",
  systolab_alerts_critical: "Open critical alerts",
  systolab_alerts_warning: "Open warning alerts"
};

function labelsToPromText(key: string): string {
  return key ? `{${key}}` : "";
}

export function renderPrometheusText(): string {
  const lines: string[] = [
    "# Systolab API — operational metrics",
    `# Generated at ${new Date().toISOString()}`,
    ""
  ];

  for (const [name, samples] of counterStore) {
    if (samples.size === 0) continue;
    lines.push(`# HELP ${name} ${METRIC_HELP[name] ?? name}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [labelKey, value] of samples) {
      lines.push(`${name}${labelsToPromText(labelKey)} ${value}`);
    }
    lines.push("");
  }

  for (const [name, samples] of gaugeStore) {
    if (samples.size === 0) continue;
    lines.push(`# HELP ${name} ${METRIC_HELP[name] ?? name}`);
    lines.push(`# TYPE ${name} gauge`);
    for (const [labelKey, value] of samples) {
      lines.push(`${name}${labelsToPromText(labelKey)} ${value}`);
    }
    lines.push("");
  }

  // Histograms exported as Prometheus summary type (pre-computed quantiles)
  for (const [name, obs] of histogramStore) {
    if (obs.length === 0) continue;
    const s = histogramSummary(name);
    lines.push(`# HELP ${name} ${METRIC_HELP[name] ?? name}`);
    lines.push(`# TYPE ${name} summary`);
    if (s.p50 !== null) lines.push(`${name}{quantile="0.5"} ${s.p50}`);
    if (s.p95 !== null) lines.push(`${name}{quantile="0.95"} ${s.p95}`);
    if (s.p99 !== null) lines.push(`${name}{quantile="0.99"} ${s.p99}`);
    lines.push(`${name}_count ${s.count}`);
    lines.push(`${name}_sum ${s.sum}`);
    lines.push("");
  }

  return lines.join("\n");
}
