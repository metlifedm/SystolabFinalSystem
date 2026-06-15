import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { connectMongo } from "./db/mongoose.js";
import { startIireWorker } from "./services/iireWorker.js";
import { startMonitoringWorker } from "./services/monitoringWorker.js";
import { startScanWorker } from "./services/scanWorker.js";
import { startEventReplayWorker } from "./services/eventReplayWorker.js";
import { startRetentionWorker } from "./services/retentionWorker.js";
import { startWebhookWorker } from "./services/webhookWorker.js";
import { startVilWorker } from "./services/vilWorker.js";
import { startBackupWorker } from "./services/backupWorker.js";
import { seedDefaultPlans } from "./services/billingService.js";
import "./services/eventHandlers.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  await connectMongo();
  await seedDefaultPlans();
  const app = createApp();
  app.listen(env.port, () => {
    logger.info("server.start", { port: env.port, env: env.deploymentEnvironment, nodeEnv: env.nodeEnv });
    startScanWorker();
    startMonitoringWorker();
    startIireWorker();
    startEventReplayWorker();
    startRetentionWorker();
    startWebhookWorker();
    startVilWorker();
    startBackupWorker();
  });
}

main().catch((error) => {
  logger.error("server.fatal", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});
