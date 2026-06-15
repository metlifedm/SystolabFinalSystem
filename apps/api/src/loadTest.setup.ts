/**
 * Load test seed and configuration helper.
 *
 * Run before any HTTP load test to pre-populate fixture data:
 *   npx tsx src/loadTest.setup.ts
 *
 * Compatible with autocannon, k6, Artillery, or any HTTP benchmarking tool.
 * Output is a JSON config file consumed by the load test script.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeId } from "./utils/crypto.js";
import { connectMongo } from "./db/mongoose.js";
import { createTenant, createWebhook } from "./services/membershipService.js";
import { registerPassword, verifyOtp } from "./services/authService.js";
import { seedDefaultPlans, activateSubscription, getPlanByTier } from "./services/billingService.js";

export interface LoadTestConfig {
  baseUrl: string;
  tenantSlug: string;
  accessToken: string;
  workspaceId: string;
  webhookId: string;
  scanTargetUrl: string;
  scenarios: LoadTestScenario[];
}

export interface LoadTestScenario {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus: number;
  ratePerSecond: number;
  durationSeconds: number;
}

async function seedLoadTestFixtures(baseUrl: string): Promise<LoadTestConfig> {
  const slug = `load-${makeId("t").slice(2, 10)}`;
  const userId = makeId("usr");
  const email = `loadtest-${makeId("u")}@systolab.local`;
  const password = "LoadTest!Secure123";

  const ctx = {
    ipHash: makeId("ip"),
    deviceFingerprintHash: makeId("fp"),
    deviceId: makeId("dev"),
    deviceLabel: "Load Test Runner",
    userAgent: "systolab-load-test/1.0"
  };

  // Create tenant
  const { tenant } = await createTenant(slug, `Load Test Tenant ${slug}`, userId);

  // Register user and get access token
  const reg = await registerPassword({ identifierType: "email", identifier: email, password, displayName: "Load Tester" }, ctx);
  const code = reg.otpChallenge.simulatedDelivery.code!;
  const auth = await verifyOtp({ challengeId: reg.otpChallenge.challengeId, code }, ctx);
  const accessToken = auth.tokens!.accessToken;

  // Create webhook
  const { webhook } = await createWebhook(tenant._id, slug, "https://hooks.example.com/load-test", ["scan.completed"], userId);

  // Seed billing plans and activate pro plan
  await seedDefaultPlans();
  const proPlan = await getPlanByTier("pro");
  if (proPlan) {
    await activateSubscription(tenant._id.toString(), slug, proPlan.planId);
  }

  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const scanTargetUrl = "https://example.com";
  const workspaceId = `ws_${makeId("ws").slice(3, 15)}`;

  const config: LoadTestConfig = {
    baseUrl,
    tenantSlug: slug,
    accessToken,
    workspaceId,
    webhookId: webhook.webhookId,
    scanTargetUrl,
    scenarios: [
      {
        name: "GET /health — liveness probe",
        method: "GET",
        path: "/health",
        expectedStatus: 200,
        ratePerSecond: 100,
        durationSeconds: 30
      },
      {
        name: "POST /api/scans — enqueue scan job",
        method: "POST",
        path: "/api/scans",
        headers: authHeader,
        body: { targetUrl: scanTargetUrl, tenantSlug: slug, mode: "fast_scan" },
        expectedStatus: 202,
        ratePerSecond: 10,
        durationSeconds: 30
      },
      {
        name: "GET /api/tenants/:slug/billing — billing overview",
        method: "GET",
        path: `/api/tenants/${slug}/billing`,
        headers: authHeader,
        expectedStatus: 200,
        ratePerSecond: 20,
        durationSeconds: 30
      },
      {
        name: "GET /api/agency/:slug/dashboard — agency dashboard",
        method: "GET",
        path: `/api/agency/${slug}/dashboard`,
        headers: authHeader,
        expectedStatus: 200,
        ratePerSecond: 15,
        durationSeconds: 30
      },
      {
        name: "GET /api/tenants/:slug/webhooks/:id/deliveries — delivery log",
        method: "GET",
        path: `/api/tenants/${slug}/webhooks/${webhook.webhookId}/deliveries`,
        headers: authHeader,
        expectedStatus: 200,
        ratePerSecond: 10,
        durationSeconds: 30
      }
    ]
  };

  return config;
}

// ── Standalone runner ──────────────────────────────────────────────────────────

if (process.argv[1]?.includes("loadTest.setup")) {
  const baseUrl = process.env["LOAD_TEST_BASE_URL"] ?? "http://127.0.0.1:4100";
  const outputPath = resolve(process.cwd(), "load-test-config.json");

  console.log(`Connecting to database…`);
  await connectMongo();

  console.log(`Seeding load test fixtures for ${baseUrl}…`);
  const config = await seedLoadTestFixtures(baseUrl);

  writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`Load test config written to: ${outputPath}`);
  console.log(`Tenant: ${config.tenantSlug}`);
  console.log(`Scenarios: ${config.scenarios.length}`);
  process.exit(0);
}
