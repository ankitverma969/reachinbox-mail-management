import { Worker, type Job } from 'bullmq';
import { env } from '../config/environment.config.js';
import { getBullMqConnectionOptions } from '../queues/email-queue.connection.js';
import {
  EMAIL_DELIVERY_QUEUE_NAME,
  emailQueueProducer,
  type EmailJobData
} from '../queues/email-queue.producer.js';
import { scheduledEmailRepository } from '../modules/email-scheduling/scheduled-email.repository.js';
import { emailSenderRepository } from '../modules/senders/email-sender.repository.js';
import { emailDeliveryAttemptRepository } from '../modules/email-delivery/email-delivery-attempt.repository.js';
import { etherealEmailService } from '../modules/email-delivery/ethereal-email.service.js';
import { senderThrottleService } from '../modules/email-delivery/sender-throttle.service.js';
import { senderRateLimitService } from '../modules/rate-limiting/sender-rate-limit.service.js';
import { rateLimitAuditRepository } from '../modules/rate-limiting/rate-limit-audit.repository.js';
import { slackNotificationService } from '../modules/integrations/slack-notification.service.js';
import { emailSearchIndexService } from '../modules/search/email-search-index.service.js';
import { indexingOutboxService } from '../modules/search/indexing-outbox.service.js';
import { logger } from '../shared/logger/structured-logger.js';
import { DeliveryAttemptStatus, EmailJobStatus } from '@prisma/client';

export class EmailDeliveryWorker {
  private worker: Worker<EmailJobData> | null = null;
  private isShuttingDown = false;

  public start(): Worker<EmailJobData> {
    if (this.worker) {
      return this.worker;
    }

    const concurrency = Math.max(1, env.EMAIL_WORKER_CONCURRENCY);
    logger.info(
      { concurrency, queue: EMAIL_DELIVERY_QUEUE_NAME },
      'Starting BullMQ EmailDeliveryWorker'
    );

    this.worker = new Worker<EmailJobData>(
      EMAIL_DELIVERY_QUEUE_NAME,
      async (job: Job<EmailJobData>) => {
        return this.processJob(job);
      },
      {
        connection: getBullMqConnectionOptions(),
        concurrency,
        lockDuration: 30000,
        stalledInterval: 15000,
        maxStalledCount: 2
      }
    );

    this.worker.on('completed', (job: Job<EmailJobData>) => {
      logger.info(
        { jobId: job.id, emailJobId: job.data.emailJobId },
        'EmailDeliveryWorker completed job successfully'
      );
    });

    this.worker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
      logger.error(
        { jobId: job?.id, emailJobId: job?.data?.emailJobId, error: err.message },
        'EmailDeliveryWorker job failed'
      );
    });

    this.worker.on('error', (err: Error) => {
      logger.error({ error: err.message }, 'BullMQ Worker internal error');
    });

    return this.worker;
  }

  /**
   * Processes an individual email delivery job.
   */
  async processJob(job: Job<EmailJobData>): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Worker is shutting down; job will be requeued');
    }

    const { emailJobId } = job.data;
    const startTime = Date.now();

    // 1. Fetch source of truth from PostgreSQL
    const emailJob = await scheduledEmailRepository.findById(emailJobId);
    if (!emailJob) {
      logger.warn(
        { emailJobId, bullJobId: job.id },
        'EmailJob not found in database; acknowledging job to prevent retry loop'
      );
      return;
    }

    // 2. Validate current lifecycle state
    if (emailJob.status === EmailJobStatus.SENT) {
      logger.info(
        { emailJobId },
        'EmailJob is already SENT; skipping redundant delivery (idempotency guard)'
      );
      return;
    }

    if (emailJob.status === EmailJobStatus.CANCELLED) {
      logger.info({ emailJobId }, 'EmailJob was CANCELLED; skipping delivery');
      return;
    }

    // 3. Atomically claim job to prevent concurrent processing by another worker
    const claimed = await scheduledEmailRepository.claimJobForProcessing(emailJob.id);
    if (!claimed) {
      logger.warn(
        { emailJobId, currentStatus: emailJob.status },
        'EmailJob could not be claimed for PROCESSING (already claimed or terminal); skipping'
      );
      return;
    }

    // 4. Validate sender identity
    const sender = await emailSenderRepository.findById(emailJob.senderId);
    if (!sender) {
      const errorMsg = `Sender identity ${emailJob.senderId} does not exist`;
      await scheduledEmailRepository.markAsFailed(emailJob.id, errorMsg);
      throw new Error(errorMsg);
    }

    if (!sender.isActive) {
      const errorMsg = `Sender identity ${sender.emailAddress} is inactive`;
      await scheduledEmailRepository.markAsFailed(emailJob.id, errorMsg);
      throw new Error(errorMsg);
    }

    // 5. Enforce cross-worker minimum send delay
    const minDelaySec = sender.minDelaySeconds ?? Math.floor(env.MIN_EMAIL_SEND_DELAY_MS / 1000);
    await senderThrottleService.enforceMinimumDelay(sender.id, minDelaySec);

    // 6. Atomically check and reserve sender and global hourly quota
    const quotaResult = await senderRateLimitService.checkAndReserveQuota(
      sender.id,
      sender.hourlyRateLimit,
      new Date(),
      emailJob.id
    );

    if (!quotaResult.allowed) {
      // Quota exhausted: defer to next eligible hour window
      const orderOffsetMs = (emailJob.retryCount || 0) * 1000;
      const nextWindow = senderRateLimitService.getNextEligibleWindow(new Date(), orderOffsetMs);

      logger.info(
        {
          emailJobId: emailJob.id,
          senderId: sender.id,
          reason: quotaResult.reason,
          rescheduledAt: nextWindow.toISOString()
        },
        'Hourly rate limit reached; deferring email to next eligible sending window'
      );

      // Persist rescheduled timestamp and status in PostgreSQL
      await scheduledEmailRepository.markAsRescheduled(emailJob.id, nextWindow);

      // Project update into transactional outbox and Elasticsearch
      void indexingOutboxService
        .recordStatusUpdate(emailJob.id, {
          status: 'RATE_LIMITED_RESCHEDULED',
          rescheduledAt: nextWindow.toISOString()
        })
        .then(() => indexingOutboxService.drainOutboxBatch())
        .catch((err) => logger.warn({ err }, 'Failed to record rate limit outbox event'));

      void emailSearchIndexService.updateStatus(emailJob.id, {
        status: 'RATE_LIMITED_RESCHEDULED',
        rescheduledAt: nextWindow.toISOString()
      });

      // Reschedule in BullMQ delayed queue
      await emailQueueProducer.addEmailJob(
        job.data,
        nextWindow,
        job.id || job.data.idempotencyKey
      );

      // Record rate-limit audit log
      await rateLimitAuditRepository.recordDeferredEvent({
        senderId: sender.id,
        hourWindow: quotaResult.hourWindow,
        quotaLimit: quotaResult.maxSenderLimit
      });

      // Dispatch Slack alert asynchronously without blocking job completion
      void slackNotificationService
        .sendRateLimitAlert({
          userId: sender.userId,
          senderId: sender.id,
          senderEmail: sender.emailAddress,
          quotaLimit: quotaResult.maxSenderLimit,
          hourWindow: quotaResult.hourWindow,
          deferredCount: 1,
          nextWindowTime: nextWindow
        })
        .then((alertResult) => {
          if (alertResult.delivered) {
            void rateLimitAuditRepository.recordDeferredEvent({
              senderId: sender.id,
              hourWindow: quotaResult.hourWindow,
              quotaLimit: quotaResult.maxSenderLimit,
              slackAlertSent: true
            });
          } else if (alertResult.error) {
            void rateLimitAuditRepository.recordDeferredEvent({
              senderId: sender.id,
              hourWindow: quotaResult.hourWindow,
              quotaLimit: quotaResult.maxSenderLimit,
              slackAlertSent: false,
              slackError: alertResult.error
            });
          }
        });

      return;
    }

    // 7. Decrypt sender SMTP credentials if configured
    let smtpPassword = '';
    try {
      smtpPassword = emailSenderRepository.getDecryptedSmtpPassword(sender);
    } catch {
      smtpPassword = env.ETHEREAL_PASSWORD || '';
    }

    const currentAttempt = (job.attemptsMade || 0) + 1;

    // 7. Dispatch via SMTP
    try {
      const sendResult = await etherealEmailService.sendEmail({
        from: `"${sender.displayName}" <${sender.emailAddress}>`,
        to: emailJob.recipientEmail,
        subject: emailJob.subject,
        html: emailJob.body,
        smtpConfig: {
          host: sender.smtpHost,
          port: sender.smtpPort,
          user: sender.smtpUsername,
          pass: smtpPassword
        }
      });

      const durationMs = Date.now() - startTime;

      // 8. Persist successful delivery attempt
      await emailDeliveryAttemptRepository.recordAttempt({
        emailJobId: emailJob.id,
        attemptNumber: currentAttempt,
        status: DeliveryAttemptStatus.SUCCESS,
        durationMs,
        smtpResponse: sendResult.smtpResponse,
        smtpMessageId: sendResult.messageId
      });

      // 9. Update database status to SENT
      await scheduledEmailRepository.markAsSent(emailJob.id, {
        smtpMessageId: sendResult.messageId,
        etherealPreviewUrl: sendResult.etherealPreviewUrl
      });

      // Project SENT status into transactional outbox and Elasticsearch
      void indexingOutboxService
        .recordStatusUpdate(emailJob.id, {
          status: 'SENT',
          sentAt: new Date().toISOString(),
          smtpMessageId: sendResult.messageId,
          etherealPreviewUrl: sendResult.etherealPreviewUrl
        })
        .then(() => indexingOutboxService.drainOutboxBatch())
        .catch((err) => logger.warn({ err }, 'Failed to record sent outbox event'));

      void emailSearchIndexService.updateStatus(emailJob.id, {
        status: 'SENT',
        sentAt: new Date().toISOString(),
        smtpMessageId: sendResult.messageId,
        etherealPreviewUrl: sendResult.etherealPreviewUrl
      });

      logger.info(
        {
          emailJobId: emailJob.id,
          recipient: emailJob.recipientEmail,
          messageId: sendResult.messageId,
          etherealPreviewUrl: sendResult.etherealPreviewUrl
        },
        'Email successfully delivered and recorded in database'
      );
    } catch (deliveryError) {
      const durationMs = Date.now() - startTime;
      const err = deliveryError as Error;

      // Record failed delivery attempt
      await emailDeliveryAttemptRepository.recordAttempt({
        emailJobId: emailJob.id,
        attemptNumber: currentAttempt,
        status: DeliveryAttemptStatus.TEMPORARY_FAILURE,
        durationMs,
        errorMessage: err.message
      });

      // If max attempts exhausted, mark FAILED in database
      const maxAttempts = job.opts.attempts || 3;
      if (currentAttempt >= maxAttempts) {
        await scheduledEmailRepository.markAsFailed(
          emailJob.id,
          `Exhausted all ${maxAttempts} delivery attempts. Last error: ${err.message}`
        );
        // Project FAILED status into transactional outbox and Elasticsearch
        void indexingOutboxService
          .recordStatusUpdate(emailJob.id, {
            status: 'FAILED',
            failedAt: new Date().toISOString(),
            errorMessage: err.message
          })
          .then(() => indexingOutboxService.drainOutboxBatch())
          .catch((outboxErr) => logger.warn({ outboxErr }, 'Failed to record failed outbox event'));

        void emailSearchIndexService.updateStatus(emailJob.id, {
          status: 'FAILED',
          failedAt: new Date().toISOString(),
          errorMessage: err.message
        });
      } else {
        // Revert to SCHEDULED for next backoff retry
        await scheduledEmailRepository.revertToScheduled(emailJob.id);
      }

      throw deliveryError;
    }
  }

  /**
   * Graceful worker shutdown.
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    if (this.worker) {
      logger.info('Closing EmailDeliveryWorker gracefully');
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const emailDeliveryWorker = new EmailDeliveryWorker();
