import { prisma } from '../../shared/database/prisma.client.js';
import { OutboxEventType, OutboxStatus, type IndexingOutbox, type Prisma } from '@prisma/client';
import { emailSearchIndexService, type EmailJobDocument } from './email-search-index.service.js';
import { checkElasticsearchHealth } from '../../config/elasticsearch.config.js';
import { logger } from '../../shared/logger/structured-logger.js';

export class IndexingOutboxService {
  /**
   * Enqueues an outbox event for indexing an email job document.
   */
  async recordIndexJob(
    emailJobId: string,
    doc: EmailJobDocument,
    tx?: Prisma.TransactionClient
  ): Promise<IndexingOutbox> {
    const client = tx || prisma;
    return client.indexingOutbox.create({
      data: {
        emailJobId,
        eventType: OutboxEventType.INDEX_JOB,
        payload: doc as unknown as Prisma.InputJsonValue,
        status: OutboxStatus.PENDING,
        nextRetryAt: new Date()
      }
    });
  }

  /**
   * Enqueues an outbox event for updating an email document status/metadata.
   */
  async recordStatusUpdate(
    emailJobId: string,
    updates: Partial<EmailJobDocument>,
    tx?: Prisma.TransactionClient
  ): Promise<IndexingOutbox> {
    const client = tx || prisma;
    return client.indexingOutbox.create({
      data: {
        emailJobId,
        eventType: OutboxEventType.UPDATE_STATUS,
        payload: updates as unknown as Prisma.InputJsonValue,
        status: OutboxStatus.PENDING,
        nextRetryAt: new Date()
      }
    });
  }

  /**
   * Drains pending outbox records into Elasticsearch if the cluster is healthy.
   * Handles bounded exponential backoff on retries.
   */
  async drainOutboxBatch(batchSize = 50): Promise<{ processed: number; failed: number }> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      return { processed: 0, failed: 0 };
    }

    const now = new Date();
    const pendingEvents = await prisma.indexingOutbox.findMany({
      where: {
        status: OutboxStatus.PENDING,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' }
    });

    if (pendingEvents.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const event of pendingEvents) {
      try {
        if (event.eventType === OutboxEventType.INDEX_JOB) {
          await emailSearchIndexService.indexEmailJob(event.payload as unknown as EmailJobDocument);
        } else if (event.eventType === OutboxEventType.UPDATE_STATUS) {
          await emailSearchIndexService.updateStatus(
            event.emailJobId,
            event.payload as Partial<EmailJobDocument>
          );
        }

        await prisma.indexingOutbox.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.PROCESSED,
            processedAt: new Date(),
            lastError: null
          }
        });
        processed++;
      } catch (err) {
        failed++;
        const nextRetries = event.retryCount + 1;
        const isExhausted = nextRetries >= event.maxRetries;
        const backoffMs = Math.min(300000, Math.pow(2, nextRetries) * 2000); // Max 5m backoff

        logger.warn(
          {
            outboxId: event.id,
            emailJobId: event.emailJobId,
            retryCount: nextRetries,
            isExhausted,
            error: (err as Error).message
          },
          'Outbox indexing attempt failed; scheduling backoff'
        );

        await prisma.indexingOutbox.update({
          where: { id: event.id },
          data: {
            retryCount: nextRetries,
            status: isExhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            nextRetryAt: isExhausted ? null : new Date(Date.now() + backoffMs),
            lastError: (err as Error).message
          }
        });
      }
    }

    return { processed, failed };
  }

  private timer: ReturnType<typeof setInterval> | null = null;
  private isDraining = false;

  /**
   * Starts a continuously running background worker that drains pending outbox events.
   * Runs reliably without using cron jobs.
   */
  startOutboxWorker(intervalMs = 10000): void {
    if (this.timer) return;

    const tick = async () => {
      if (this.isDraining) return;
      this.isDraining = true;
      try {
        await this.drainOutboxBatch(100);
      } catch (err) {
        logger.error({ err }, 'Background outbox worker tick failed');
      } finally {
        this.isDraining = false;
      }
    };

    // Run first tick immediately, then repeat with interval
    void tick();
    this.timer = setInterval(() => {
      void tick();
    }, intervalMs);
    this.timer.unref();

    logger.info({ intervalMs }, 'Background Indexing Outbox Worker initialized successfully');
  }

  /**
   * Stops the background outbox worker during graceful shutdown.
   */
  stopOutboxWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Background Indexing Outbox Worker stopped');
    }
  }
}

export const indexingOutboxService = new IndexingOutboxService();
