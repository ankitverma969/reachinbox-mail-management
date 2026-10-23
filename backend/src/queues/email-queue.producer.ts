import { Queue, type JobsOptions } from 'bullmq';
import { getBullMqConnectionOptions } from './email-queue.connection.js';
import { logger } from '../shared/logger/structured-logger.js';

export const EMAIL_DELIVERY_QUEUE_NAME = 'email-delivery-queue';
export const DELIVER_EMAIL_JOB_NAME = 'deliver-email';

export interface EmailJobData {
  emailJobId: string;
  senderId: string;
  recipientEmail: string;
  idempotencyKey: string;
}

export class EmailQueueProducer {
  private queue: Queue<EmailJobData> | null = null;

  public getQueue(): Queue<EmailJobData> {
    if (!this.queue) {
      this.queue = new Queue<EmailJobData>(EMAIL_DELIVERY_QUEUE_NAME, {
        connection: getBullMqConnectionOptions(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: 1000,
          removeOnFail: 5000
        }
      });

      this.queue.on('error', (err) => {
        logger.error({ err: err.message }, 'BullMQ EmailQueue error occurred');
      });
    }

    return this.queue;
  }

  /**
   * Adds an email job with calculated delay based on scheduledAt.
   * Uses deterministic jobId (idempotencyKey) to prevent duplicate queued jobs.
   */
  async addEmailJob(
    data: EmailJobData,
    scheduledAt: Date,
    customJobId?: string
  ): Promise<string> {
    const queue = this.getQueue();
    const delayMs = Math.max(0, new Date(scheduledAt).getTime() - Date.now());
    const jobId = customJobId || data.idempotencyKey;

    const job = await queue.add(
      DELIVER_EMAIL_JOB_NAME,
      data,
      {
        jobId,
        delay: delayMs
      }
    );

    return job.id || jobId;
  }

  /**
   * Bulk adds jobs efficiently into BullMQ using queue.addBulk() in controlled chunks.
   * Essential for 1000+ scheduled campaigns.
   */
  async addBulkEmailJobs(
    items: Array<{ data: EmailJobData; scheduledAt: Date; customJobId?: string }>,
    chunkSize = 500
  ): Promise<string[]> {
    const queue = this.getQueue();
    const createdJobIds: string[] = [];

    for (let i = 0; i < items.length; i += chunkSize) {
      const slice = items.slice(i, i + chunkSize);
      const bulkPayloads = slice.map((item) => {
        const delayMs = Math.max(0, new Date(item.scheduledAt).getTime() - Date.now());
        const jobId = item.customJobId || item.data.idempotencyKey;
        return {
          name: DELIVER_EMAIL_JOB_NAME,
          data: item.data,
          opts: {
            jobId,
            delay: delayMs
          } as JobsOptions
        };
      });

      const addedJobs = await queue.addBulk(bulkPayloads);
      for (const j of addedJobs) {
        if (j.id) {
          createdJobIds.push(j.id);
        }
      }
    }

    return createdJobIds;
  }

  /**
   * Removes a job from the queue if it hasn't completed.
   */
  async removeJob(jobId: string): Promise<boolean> {
    const queue = this.getQueue();
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  /**
   * Checks if a job already exists in BullMQ.
   */
  async hasJob(jobId: string): Promise<boolean> {
    const queue = this.getQueue();
    const job = await queue.getJob(jobId);
    return job !== null && job !== undefined;
  }

  /**
   * Graceful close of queue connections.
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const emailQueueProducer = new EmailQueueProducer();
