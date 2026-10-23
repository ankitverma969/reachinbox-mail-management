import { createApp } from './app.js';
import { env } from './config/environment.config.js';
import { logger } from './shared/logger/structured-logger.js';
import { emailDeliveryWorker } from './workers/email-delivery.worker.js';
import { emailQueueProducer } from './queues/email-queue.producer.js';
import { scheduleRecoveryService } from './modules/email-scheduling/schedule-recovery.service.js';
import { senderThrottleService } from './modules/email-delivery/sender-throttle.service.js';
import { senderRateLimitService } from './modules/rate-limiting/sender-rate-limit.service.js';
import { slackOAuthService } from './modules/integrations/slack-oauth.service.js';
import { slackNotificationService } from './modules/integrations/slack-notification.service.js';
import { etherealEmailService } from './modules/email-delivery/ethereal-email.service.js';
import { prisma } from './shared/database/prisma.client.js';
import { emailSearchIndexService } from './modules/search/email-search-index.service.js';
import { indexingOutboxService } from './modules/search/indexing-outbox.service.js';
import { closeElasticsearchClient } from './config/elasticsearch.config.js';

const app = createApp();

const server = app.listen(env.PORT, async () => {
  logger.info(
    {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      workerConcurrency: env.EMAIL_WORKER_CONCURRENCY
    },
    `ReachInbox Backend Server initialized and listening on port ${env.PORT}`
  );

  try {
    // 1. Start BullMQ Email Delivery Worker Daemon
    emailDeliveryWorker.start();

    // 2. Perform Startup Persistence and Reconciliation Check
    await scheduleRecoveryService.reconcileSchedulesOnStartup();

    // 3. Ensure Elasticsearch index mapping exists (non-blocking if ES offline)
    await emailSearchIndexService.ensureIndexExists().catch((err: unknown) => {
      logger.warn({ err }, 'Elasticsearch index verification deferred; cluster may be offline or starting');
    });

    // 4. Start continuously running background Outbox Worker for durable ES sync
    indexingOutboxService.startOutboxWorker(10000);
  } catch (startupErr) {
    logger.error({ err: startupErr }, 'Error during background engine startup and reconciliation');
  }
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Termination signal received. Closing services gracefully');

  // Force close after 10s timeout
  const forceTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout expiration');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  try {
    // 1. Close HTTP server
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });

    // 2. Stop BullMQ Worker (finishes in-flight jobs, stops accepting new)
    await emailDeliveryWorker.close();

    // 3. Close BullMQ Queue Producer
    await emailQueueProducer.close();

    // 4. Close Redis throttle & rate limiting clients
    await senderThrottleService.close();
    await senderRateLimitService.close();
    await slackOAuthService.close();
    await slackNotificationService.close();

    // 5. Close SMTP transporters & background outbox worker
    etherealEmailService.close();
    indexingOutboxService.stopOutboxWorker();

    // 6. Close Elasticsearch client connection
    await closeElasticsearchClient();

    // 7. Disconnect Prisma
    await prisma.$disconnect();

    logger.info('All subsystems shut down cleanly. Exiting process');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error occurred during graceful shutdown sequence');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
