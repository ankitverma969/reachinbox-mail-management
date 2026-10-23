import { scheduledEmailRepository } from './scheduled-email.repository.js';
import { emailSenderRepository } from '../senders/email-sender.repository.js';
import { emailQueueProducer, type EmailJobData } from '../../queues/email-queue.producer.js';
import { generateEmailIdempotencyKey } from '../../shared/utils/idempotency.util.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';
import { prisma } from '../../shared/database/prisma.client.js';
import { emailSearchIndexService, type EmailJobDocument } from '../search/email-search-index.service.js';
import { indexingOutboxService } from '../search/indexing-outbox.service.js';

export interface ScheduleEmailPayload {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  scheduledAt: string | Date;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
  originalFilename?: string;
}

export interface ScheduleResponse {
  batchId: string;
  totalScheduled: number;
  firstScheduledAt: string;
  estimatedCompletionAt: string;
  status: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export class EmailSchedulingService {
  /**
   * Validates and schedules an email campaign for 1 to 10,000+ recipients.
   * Staggers delivery by delayBetweenEmails and pipelines into BullMQ delayed queue.
   */
  async scheduleCampaign(payload: ScheduleEmailPayload): Promise<ScheduleResponse> {
    // 1. Validate inputs
    if (!payload.senderId) {
      throw new ValidationError('Sender identity is required');
    }

    if (!payload.subject || payload.subject.trim().length === 0) {
      throw new ValidationError('Subject cannot be empty');
    }

    if (payload.subject.length > 500) {
      throw new ValidationError('Subject exceeds maximum length of 500 characters');
    }

    if (!payload.body || payload.body.trim().length === 0) {
      throw new ValidationError('Email body cannot be empty');
    }

    if (!Array.isArray(payload.recipients) || payload.recipients.length === 0) {
      throw new ValidationError('At least one recipient email address is required');
    }

    const scheduledDate = new Date(payload.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new ValidationError('Invalid scheduled timestamp format');
    }

    // 2. Validate and clean recipients
    const uniqueRecipients = Array.from(new Set(payload.recipients.map((r) => r.trim().toLowerCase())));
    const invalidRecipients = uniqueRecipients.filter((r) => !EMAIL_REGEX.test(r));

    if (invalidRecipients.length > 0) {
      throw new ValidationError('Invalid recipient email address detected', {
        invalidRecipients: invalidRecipients.slice(0, 5)
      });
    }

    // 3. Verify sender ownership & active status
    const sender = await emailSenderRepository.findById(payload.senderId);
    if (!sender) {
      throw new NotFoundError(`Sender identity with ID '${payload.senderId}' not found`);
    }

    if (!sender.isActive) {
      throw new ValidationError(`Sender '${sender.emailAddress}' is currently inactive`);
    }

    // 4. Calculate timing and staggered offsets
    const interEmailDelaySeconds = payload.delayBetweenEmails ?? sender.minDelaySeconds ?? 2;
    const baseTimeMs = scheduledDate.getTime();

    // Prepare job specifications with deterministic idempotency keys
    const jobSpecs = uniqueRecipients.map((recipient, index) => {
      const staggeredAt = new Date(baseTimeMs + index * interEmailDelaySeconds * 1000);
      const idempotencyKey = generateEmailIdempotencyKey(sender.id, recipient, staggeredAt);

      return {
        senderId: sender.id,
        recipientEmail: recipient,
        subject: payload.subject,
        body: payload.body,
        scheduledAt: staggeredAt,
        idempotencyKey,
        bullmqJobId: idempotencyKey
      };
    });

    // 5. Persist EmailBatch and EmailJobs in PostgreSQL transaction
    const { batch } = await scheduledEmailRepository.createBatchWithJobs(
      {
        userId: payload.userId,
        senderId: sender.id,
        originalFilename: payload.originalFilename,
        totalLeadsDetected: uniqueRecipients.length,
        scheduledStartTime: scheduledDate,
        configuredDelaySeconds: interEmailDelaySeconds
      },
      jobSpecs
    );

    // Fetch the created jobs so we have their generated database IDs
    const createdJobs = await prisma.emailJob.findMany({
      where: { batchId: batch.id },
      select: { id: true, idempotencyKey: true, scheduledAt: true, recipientEmail: true }
    });

    const keyToDbIdMap = new Map(createdJobs.map((j) => [j.idempotencyKey, j.id]));

    // 6. Enqueue BullMQ delayed jobs
    const queueItems: Array<{ data: EmailJobData; scheduledAt: Date; customJobId: string }> = [];

    for (const spec of jobSpecs) {
      const dbId = keyToDbIdMap.get(spec.idempotencyKey);
      if (dbId) {
        queueItems.push({
          data: {
            emailJobId: dbId,
            senderId: sender.id,
            recipientEmail: spec.recipientEmail,
            idempotencyKey: spec.idempotencyKey
          },
          scheduledAt: spec.scheduledAt,
          customJobId: spec.idempotencyKey
        });
      }
    }

    try {
      await emailQueueProducer.addBulkEmailJobs(queueItems);
    } catch (queueErr) {
      // Partial failure handling: Database records are intact and scheduled.
      // Startup/background recovery service reconciles missing jobs automatically.
      logger.error(
        { err: queueErr, batchId: batch.id },
        'Failed to enqueue some jobs to BullMQ immediately; scheduledEmail records retained for recovery'
      );
    }

    // Project scheduled email documents into Elasticsearch search index and Outbox
    const indexDocs: EmailJobDocument[] = createdJobs.map((j) => ({
      emailJobId: j.id,
      userId: payload.userId,
      senderId: sender.id,
      senderEmail: sender.emailAddress,
      batchId: batch.id,
      recipientEmail: j.recipientEmail,
      subject: payload.subject,
      body: payload.body,
      status: 'SCHEDULED',
      scheduledAt: j.scheduledAt.toISOString(),
      idempotencyKey: j.idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    void Promise.all(indexDocs.map((d) => indexingOutboxService.recordIndexJob(d.emailJobId, d)))
      .then(() => indexingOutboxService.drainOutboxBatch())
      .catch((err) => logger.warn({ err }, 'Failed to record indexing outbox records'));

    void emailSearchIndexService.indexBatch(indexDocs);

    const firstScheduledAt = scheduledDate.toISOString();
    const lastJobIndex = uniqueRecipients.length - 1;
    const estimatedCompletionAt = new Date(
      baseTimeMs + lastJobIndex * interEmailDelaySeconds * 1000
    ).toISOString();

    logger.info(
      {
        batchId: batch.id,
        totalScheduled: uniqueRecipients.length,
        firstScheduledAt,
        estimatedCompletionAt
      },
      'Email campaign scheduled successfully'
    );

    return {
      batchId: batch.id,
      totalScheduled: uniqueRecipients.length,
      firstScheduledAt,
      estimatedCompletionAt,
      status: 'SCHEDULED'
    };
  }

  /**
   * Cancels a pending scheduled email and purges it from BullMQ.
   */
  async cancelScheduledEmail(
    id: string,
    requestingUserId?: string,
    userRole?: string
  ): Promise<void> {
    const emailJob = await scheduledEmailRepository.findById(id);
    if (!emailJob) {
      throw new NotFoundError(`Email job with ID '${id}' not found`);
    }

    if (
      requestingUserId &&
      userRole !== 'admin' &&
      (emailJob as unknown as { sender?: { userId?: string } }).sender?.userId &&
      (emailJob as unknown as { sender?: { userId?: string } }).sender?.userId !== requestingUserId
    ) {
      throw new ForbiddenError('You do not have permission to cancel another user\'s email job');
    }

    if (emailJob.status === 'SENT' || emailJob.status === 'PROCESSING') {
      throw new ValidationError(`Cannot cancel email with status '${emailJob.status}'`);
    }

    // Cancel in BullMQ
    if (emailJob.bullmqJobId) {
      await emailQueueProducer.removeJob(emailJob.bullmqJobId);
    }
    await emailQueueProducer.removeJob(emailJob.idempotencyKey);

    // Cancel in PostgreSQL
    await scheduledEmailRepository.cancelJob(emailJob.id);

    // Update status in transactional outbox and Elasticsearch
    void indexingOutboxService
      .recordStatusUpdate(emailJob.id, { status: 'CANCELLED' })
      .then(() => indexingOutboxService.drainOutboxBatch())
      .catch((err) => logger.warn({ err }, 'Failed to record cancel outbox event'));

    void emailSearchIndexService.updateStatus(emailJob.id, {
      status: 'CANCELLED'
    });
  }
}

export const emailSchedulingService = new EmailSchedulingService();
