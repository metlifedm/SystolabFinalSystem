// Structured JSON logger — no external dependencies.
// Outputs to stdout for info/debug, stderr for warn/error.
// Log level is controlled by SYSTOLAB_LOG_LEVEL env var.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SERVICE = "systolab-api";
const PID = process.pid;

function currentLevel(): LogLevel {
  const raw = (process.env.SYSTOLAB_LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : "info";
}

export class Logger {
  private readonly context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra });
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE,
      env: process.env.SYSTOLAB_ENV ?? "sandbox",
      pid: PID,
      ...this.context,
      ...(fields ?? {}),
      message
    };
    const line = JSON.stringify(entry) + "\n";
    if (level === "error" || level === "warn") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  debug(message: string, fields?: Record<string, unknown>): void { this.write("debug", message, fields); }
  info(message: string, fields?: Record<string, unknown>): void { this.write("info", message, fields); }
  warn(message: string, fields?: Record<string, unknown>): void { this.write("warn", message, fields); }
  error(message: string, fields?: Record<string, unknown>): void { this.write("error", message, fields); }
}

export const logger = new Logger();
