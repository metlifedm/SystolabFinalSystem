import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../.env") });

type NodeEnv = "development" | "test" | "production";

const generatedDevSecrets = {
  devApiKey: randomBytes(24).toString("hex"),
  internalAdminKey: randomBytes(32).toString("hex"),
  ownerAdminKey: randomBytes(32).toString("hex"),
  managerAdminKey: randomBytes(32).toString("hex"),
  authJwtSecret: randomBytes(48).toString("hex"),
  adminJwtSecret: randomBytes(48).toString("hex")
};

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

function readString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readDevSecret(name: string, generated: string): string {
  return readString(name) ?? generated;
}

function requireProduction(name: string, errors: string[]): string {
  const value = readString(name);
  if (!value) errors.push(`${name} is required in production.`);
  return value ?? "";
}

function requireStrongProductionSecret(name: string, errors: string[]): string {
  const value = requireProduction(name, errors);
  if (value && !isStrongSecret(value)) {
    errors.push(`${name} must be at least 32 characters and must not use a placeholder/dev value.`);
  }
  return value;
}

function isStrongSecret(value: string): boolean {
  const lowered = value.toLowerCase();
  if (value.length < 32) return false;
  return ![
    "change_me",
    "changeme",
    "replace",
    "placeholder",
    "dev_",
    "local",
    "secret",
    "password",
    "example"
  ].some((fragment) => lowered.includes(fragment));
}

function validateMongoUri(value: string | undefined, errors: string[]): void {
  if (!value) return;
  if (!/^mongodb(\+srv)?:\/\//i.test(value)) errors.push("MONGODB_URI must start with mongodb:// or mongodb+srv://.");
}

function validateGoogleJwks(value: string, errors: string[]): void {
  try {
    const parsed = JSON.parse(value) as { keys?: unknown } | unknown[];
    const keys = Array.isArray(parsed) ? parsed : Array.isArray(parsed.keys) ? parsed.keys : [];
    if (keys.length === 0) errors.push("SYSTOLAB_GOOGLE_JWKS_JSON must contain at least one JWK key.");
  } catch {
    errors.push("SYSTOLAB_GOOGLE_JWKS_JSON must be valid JWKS JSON, not a client secret or plain token.");
  }
}

const nodeEnv = ((process.env.NODE_ENV ?? "development") as NodeEnv);
const production = nodeEnv === "production";
const productionErrors: string[] = [];
const memoryStore = process.env.SYSTOLAB_MEMORY_STORE === "true";
const mongoUri = production ? requireProduction("MONGODB_URI", productionErrors) : readString("MONGODB_URI");
const clientOrigin = production ? requireProduction("CLIENT_ORIGIN", productionErrors) : readString("CLIENT_ORIGIN") ?? "http://127.0.0.1:5173";
validateMongoUri(mongoUri, productionErrors);

if (production && memoryStore) productionErrors.push("SYSTOLAB_MEMORY_STORE must not be true in production.");

const authJwtSecret = production
  ? requireStrongProductionSecret("SYSTOLAB_AUTH_JWT_SECRET", productionErrors)
  : readDevSecret("SYSTOLAB_AUTH_JWT_SECRET", generatedDevSecrets.authJwtSecret);
const adminJwtSecret = production
  ? requireStrongProductionSecret("SYSTOLAB_ADMIN_JWT_SECRET", productionErrors)
  : readDevSecret("SYSTOLAB_ADMIN_JWT_SECRET", generatedDevSecrets.adminJwtSecret);
const internalAdminKey = production
  ? requireStrongProductionSecret("SYSTOLAB_INTERNAL_ADMIN_KEY", productionErrors)
  : readDevSecret("SYSTOLAB_INTERNAL_ADMIN_KEY", generatedDevSecrets.internalAdminKey);
const ownerAdminKey = production
  ? requireStrongProductionSecret("SYSTOLAB_OWNER_ADMIN_KEY", productionErrors)
  : readString("SYSTOLAB_OWNER_ADMIN_KEY") ?? internalAdminKey ?? generatedDevSecrets.ownerAdminKey;
const managerAdminKey = production
  ? requireStrongProductionSecret("SYSTOLAB_MANAGER_ADMIN_KEY", productionErrors)
  : readString("SYSTOLAB_MANAGER_ADMIN_KEY") ?? internalAdminKey ?? generatedDevSecrets.managerAdminKey;

const authGoogleClientId = production ? requireProduction("SYSTOLAB_GOOGLE_CLIENT_ID", productionErrors) : readString("SYSTOLAB_GOOGLE_CLIENT_ID") ?? "systolab-local-google-client";
const authGoogleJwksJson = production ? requireProduction("SYSTOLAB_GOOGLE_JWKS_JSON", productionErrors) : readString("SYSTOLAB_GOOGLE_JWKS_JSON") ?? "";
if (production) validateGoogleJwks(authGoogleJwksJson, productionErrors);

const authAllowDevGoogleCredential = production ? false : process.env.SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL !== "false";
if (production && process.env.SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL === "true") {
  productionErrors.push("SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL must not be true in production.");
}

if (productionErrors.length > 0) {
  throw new Error(`SYSTOLAB production environment validation failed:\n- ${productionErrors.join("\n- ")}`);
}

export const env = {
  nodeEnv,
  port: readNumber("PORT", 4100),
  clientOrigin,
  mongoUri,
  deploymentEnvironment: process.env.SYSTOLAB_ENV ?? "sandbox",
  executionRegion: process.env.SYSTOLAB_REGION ?? "local",
  nodeClusterId: process.env.SYSTOLAB_NODE_CLUSTER ?? "local-1",
  buildHash: process.env.SYSTOLAB_BUILD_HASH ?? "dev",
  devApiKey: readDevSecret("SYSTOLAB_DEV_API_KEY", generatedDevSecrets.devApiKey),
  internalAdminKey,
  ownerAdminKey,
  managerAdminKey,
  memoryStore,
  adminMemoryStoreFile: readString("SYSTOLAB_ADMIN_MEMORY_STORE_FILE") ?? "tmp/systolab-admin-users.json",
  crawlTimeoutMs: readNumber("SYSTOLAB_CRAWL_TIMEOUT_MS", 12000),
  crawlMaxBytes: readNumber("SYSTOLAB_CRAWL_MAX_BYTES", 1_500_000),
  crawlMaxRedirects: readNumber("SYSTOLAB_CRAWL_MAX_REDIRECTS", 5),
  maxInternalPages: readNumber("SYSTOLAB_MAX_INTERNAL_PAGES", 5),
  monitoringWorkerEnabled: readBoolean("SYSTOLAB_MONITORING_WORKER_ENABLED", true),
  monitoringWorkerIntervalMs: readNumber("SYSTOLAB_MONITORING_WORKER_INTERVAL_MS", 60_000),
  monitoringWorkerBatchSize: readNumber("SYSTOLAB_MONITORING_WORKER_BATCH_SIZE", 3),
  scanWorkerEnabled: readBoolean("SYSTOLAB_SCAN_WORKER_ENABLED", true),
  scanWorkerIntervalMs: readNumber("SYSTOLAB_SCAN_WORKER_INTERVAL_MS", 3_000),
  scanWorkerBatchSize: readNumber("SYSTOLAB_SCAN_WORKER_BATCH_SIZE", 2),
  scanWorkerLockTimeoutMs: readNumber("SYSTOLAB_SCAN_WORKER_LOCK_TIMEOUT_MS", 300_000),
  iireWorkerEnabled: readBoolean("SYSTOLAB_IIRE_WORKER_ENABLED", true),
  iireWorkerIntervalMs: readNumber("SYSTOLAB_IIRE_WORKER_INTERVAL_MS", 300_000),
  playwrightEnabled: readBoolean("SYSTOLAB_PLAYWRIGHT_ENABLED", true),
  playwrightTimeoutMs: readNumber("SYSTOLAB_PLAYWRIGHT_TIMEOUT_MS", 15_000),
  playwrightViewportWidth: readNumber("SYSTOLAB_PLAYWRIGHT_VIEWPORT_WIDTH", 1280),
  playwrightViewportHeight: readNumber("SYSTOLAB_PLAYWRIGHT_VIEWPORT_HEIGHT", 800),
  playwrightScreenshotAllPages: readBoolean("SYSTOLAB_PLAYWRIGHT_SCREENSHOT_ALL_PAGES", false),
  artifactDir: readString("SYSTOLAB_ARTIFACT_DIR") ?? "",
  artifactSignedTokenTtlMs: readNumber("SYSTOLAB_ARTIFACT_TOKEN_TTL_MS", 3_600_000),
  artifactSecret: readString("SYSTOLAB_ARTIFACT_SECRET") ?? "",
  publicApiDailyQuota: readNumber("SYSTOLAB_PUBLIC_API_DAILY_QUOTA", 1000),
  globalRateLimitPerMinute: readNumber("SYSTOLAB_GLOBAL_RATE_LIMIT_PER_MINUTE", 45),
  authRateLimitPerMinute: readNumber("SYSTOLAB_AUTH_RATE_LIMIT_PER_MINUTE", 30),
  scanRateLimitPerMinute: readNumber("SYSTOLAB_SCAN_RATE_LIMIT_PER_MINUTE", 8),
  scanStatusRateLimitPerMinute: readNumber("SYSTOLAB_SCAN_STATUS_RATE_LIMIT_PER_MINUTE", 120),
  publicApiRateLimitPerMinute: readNumber("SYSTOLAB_PUBLIC_API_RATE_LIMIT_PER_MINUTE", 120),
  authJwtSecret,
  adminJwtSecret,
  adminSessionHours: readNumber("SYSTOLAB_ADMIN_SESSION_HOURS", 8),
  adminLoginMaxAttempts: readNumber("SYSTOLAB_ADMIN_LOGIN_MAX_ATTEMPTS", 5),
  adminLockMinutes: readNumber("SYSTOLAB_ADMIN_LOCK_MINUTES", 30),
  authAccessTokenMinutes: readNumber("SYSTOLAB_AUTH_ACCESS_TOKEN_MINUTES", 30),
  authRefreshTokenDays: readNumber("SYSTOLAB_AUTH_REFRESH_TOKEN_DAYS", 30),
  authOtpLength: readNumber("SYSTOLAB_AUTH_OTP_LENGTH", 6),
  authOtpTtlMinutes: readNumber("SYSTOLAB_AUTH_OTP_TTL_MINUTES", 10),
  authOtpResendCooldownSeconds: readNumber("SYSTOLAB_AUTH_OTP_RESEND_COOLDOWN_SECONDS", 60),
  authLockMinutes: readNumber("SYSTOLAB_AUTH_LOCK_MINUTES", 15),
  authPasswordResetMinutes: readNumber("SYSTOLAB_AUTH_PASSWORD_RESET_MINUTES", 20),
  authGoogleClientId,
  authGoogleJwksJson,
  authAllowDevGoogleCredential,
  firebaseProjectId: readString("FIREBASE_PROJECT_ID") ?? "",
  firebaseServiceAccountJson: readString("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "",
  backupDir: readString("SYSTOLAB_BACKUP_DIR") ?? "/data/backups",
  backupMaxAgeDays: readNumber("SYSTOLAB_BACKUP_MAX_AGE_DAYS", 7),
  backupMongodumpPath: readString("SYSTOLAB_BACKUP_MONGODUMP_PATH") ?? "mongodump",
  backupMongorestorePath: readString("SYSTOLAB_BACKUP_MONGORESTORE_PATH") ?? "mongorestore",
  backupCollections: readString("SYSTOLAB_BACKUP_COLLECTIONS") ?? "",
  logLevel: (readString("SYSTOLAB_LOG_LEVEL") ?? "info") as "debug" | "info" | "warn" | "error",
  metricsAuthKey: readString("SYSTOLAB_METRICS_AUTH_KEY"),
  eventBusWorkerEnabled: readBoolean("SYSTOLAB_EVENT_BUS_WORKER_ENABLED", true),
  eventBusWorkerIntervalMs: readNumber("SYSTOLAB_EVENT_BUS_WORKER_INTERVAL_MS", 5_000),
  eventBusWorkerBatchSize: readNumber("SYSTOLAB_EVENT_BUS_WORKER_BATCH_SIZE", 20),
  eventBusMaxRetries: readNumber("SYSTOLAB_EVENT_BUS_MAX_RETRIES", 3),
  retentionWorkerEnabled: readBoolean("SYSTOLAB_RETENTION_WORKER_ENABLED", true),
  retentionWorkerIntervalMs: readNumber("SYSTOLAB_RETENTION_WORKER_INTERVAL_MS", 3_600_000),
  retentionWorkerBatchSize: readNumber("SYSTOLAB_RETENTION_WORKER_BATCH_SIZE", 100),
  retentionDefaultDays: readNumber("SYSTOLAB_RETENTION_DEFAULT_DAYS", 90),
  quarantineMaxPayloadBytes: readNumber("SYSTOLAB_QUARANTINE_MAX_PAYLOAD_BYTES", 65_536),
  benchmarkMinQualityScore: readNumber("SYSTOLAB_BENCHMARK_MIN_QUALITY_SCORE", 60),
  benchmarkMaxDrift: readNumber("SYSTOLAB_BENCHMARK_MAX_DRIFT", 15),
  complianceExportDir: readString("SYSTOLAB_COMPLIANCE_EXPORT_DIR") ?? "",
  // Phase 11 — email
  emailProvider: readString("SYSTOLAB_EMAIL_PROVIDER"),        // "sendgrid" | "mailgun" | "resend"
  emailApiKey: readString("SYSTOLAB_EMAIL_API_KEY"),
  emailFromAddress: readString("SYSTOLAB_EMAIL_FROM_ADDRESS"),
  emailFromName: readString("SYSTOLAB_EMAIL_FROM_NAME"),
  emailMailgunDomain: readString("SYSTOLAB_EMAIL_MAILGUN_DOMAIN"),
  // Phase 11 — webhooks
  webhookWorkerEnabled: readBoolean("SYSTOLAB_WEBHOOK_WORKER_ENABLED", true),
  webhookWorkerIntervalMs: readNumber("SYSTOLAB_WEBHOOK_WORKER_INTERVAL_MS", 30_000),
  webhookWorkerBatchSize: readNumber("SYSTOLAB_WEBHOOK_WORKER_BATCH_SIZE", 20),
  // Crawler reliability
  crawlRetryAttempts: readNumber("SYSTOLAB_CRAWL_RETRY_ATTEMPTS", 2),
  crawlRetryBaseMs: readNumber("SYSTOLAB_CRAWL_RETRY_BASE_MS", 800),
  crawlUaRotation: readBoolean("SYSTOLAB_CRAWL_UA_ROTATION", false),
  crawlSoftBlockDetection: readBoolean("SYSTOLAB_CRAWL_SOFT_BLOCK_DETECTION", true),
  crawlerHealthWindowSize: readNumber("SYSTOLAB_CRAWLER_HEALTH_WINDOW_SIZE", 200),
  // Backup worker
  backupWorkerEnabled: readBoolean("SYSTOLAB_BACKUP_WORKER_ENABLED", false),
  backupWorkerIntervalMs: readNumber("SYSTOLAB_BACKUP_WORKER_INTERVAL_MS", 3_600_000),
  backupWorkerAutoVerify: readBoolean("SYSTOLAB_BACKUP_WORKER_AUTO_VERIFY", true)
};
