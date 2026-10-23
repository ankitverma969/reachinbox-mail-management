import { scheduledEmailRepository } from './scheduled-email.repository.js';
import { emailQueueProducer } from '../../queues/email-queue.producer.js';
import { logger } from '../../shared/logger/structured-logger.js';
import { DeliveryAttemptStatus } from '@prisma/client';

export interface RecoveryResult {
  totalPendingEvaluated: number;
  reEnqueuedMissingCount: number;
  alreadyPresentInQueueCount: number;
  abandonedProcessingEvaluated: number;
  reconciledAsSentCount: number;
  revertedToScheduledCount: number;
}

export class ScheduleRecoveryService {
  /**
   * Reconciles database state with BullMQ queue on startup.
   * Handles:
   * 1. Abandoned PROCESSING jobs (worker crashed during dispatch).
   * 2. Pending jobs missing from BullMQ (Redis restart or partial failure).
   * 3. Two Generals' problem: Resolves ambiguous SMTP acceptance via delivery attempt telemetry.
   */
  async reconcileSchedulesOnStartup(): Promise<RecoveryResult> {
    logger.info('Initiating startup schedule reconciliation and recovery check...');

    const result: RecoveryResult = {
      totalPendingEvaluated: 0,
      reEnqueuedMissingCount: 0,
      alreadyPresentInQueueCount: 0,
      abandonedProcessingEvaluated: 0,
      reconciledAsSentCount: 0,
      revertedToScheduledCount: 0
    };

    // 1. Recover abandoned PROCESSING jobs older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const abandonedJobs = await scheduledEmailRepository.findAbandonedProcessingJobs(fiveMinutesAgo);
    result.abandonedProcessingEvaluated = abandonedJobs.length;

    for (const job of abandonedJobs) {
      const attempts = (job as unknown as { deliveryAttempts?: Array<{ status: DeliveryAttemptStatus; smtpMessageId?: string | null }> }).deliveryAttempts || [];
      const latestAttempt = attempts[0];

      if (latestAttempt && latestAttempt.status === DeliveryAttemptStatus.SUCCESS) {
        // SMTP server accepted the email before worker crashed.
        // Marking as SENT to avoid duplicate sending (Two Generals' Ambiguity Resolution)
        logger.warn(
          { jobId: job.id, messageId: latestAttempt.smtpMessageId },
          'Ambiguous delivery resolved: previous attempt succeeded before crash; marking SENT'
        );
        await scheduledEmailRepository.markAsSent(job.id, {
          smtpMessageId: latestAttempt.smtpMessageId
        });
        result.reconciledAsSentCount++;
      } else {
        // Did not succeed or no attempt recorded; safely revert to SCHEDULED for retry
        logger.info(
          { jobId: job.id },
          'Abandoned job without confirmed delivery reverted to SCHEDULED'
        );
        await scheduledEmailRepository.revertToScheduled(job.id);
        result.revertedToScheduledCount++;
      }
    }

    // 2. Scan pending SCHEDULED & RATE_LIMITED_RESCHEDULED jobs and verify in BullMQ
    const pendingJobs = await scheduledEmailRepository.findPendingJobs();
    result.totalPendingEvaluated = pendingJobs.length;

    for (const job of pendingJobs) {
      const isAlreadyInQueue = await emailQueueProducer.hasJob(job.idempotencyKey);

      if (isAlreadyInQueue) {
        result.alreadyPresentInQueueCount++;
        continue;
      }

      // Missing from BullMQ; re-enqueue with calculated delay
      const now = Date.now();
      const scheduledTime = job.scheduledAt.getTime();
      const delayMs = Math.max(0, scheduledTime - now);

      logger.info(
        {
          jobId: job.id,
          recipient: job.recipientEmail,
          delayMs,
          isOverdue: scheduledTime <= now
        },
        'Re-enqueueing missing scheduled job into BullMQ'
      );

      const bullJobId = await emailQueueProducer.addEmailJob(
        {
          emailJobId: job.id,
          senderId: job.senderId,
          recipientEmail: job.recipientEmail,
          idempotencyKey: job.idempotencyKey
        },
        job.scheduledAt,
        job.idempotencyKey
      );

      await scheduledEmailRepository.updateBullMqJobId(job.id, bullJobId);
      result.reEnqueuedMissingCount++;
    }

    logger.info(result, 'Startup schedule reconciliation completed');
    return result;
  }
}

export const scheduleRecoveryService = new ScheduleRecoveryService();
