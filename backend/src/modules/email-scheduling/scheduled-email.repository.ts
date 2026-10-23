import { prisma } from '../../shared/database/prisma.client.js';
import { EmailJobStatus, type EmailJob, type EmailBatch } from '@prisma/client';

export interface CreateEmailJobDto {
  batchId?: string | null;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  idempotencyKey: string;
  bullmqJobId?: string | null;
}

export interface CreateBatchDto {
  userId: string;
  senderId: string;
  originalFilename?: string | null;
  totalLeadsDetected: number;
  scheduledStartTime: Date;
  configuredDelaySeconds?: number;
}

export class ScheduledEmailRepository {
  async findById(id: string): Promise<EmailJob | null> {
    return prisma.emailJob.findUnique({
      where: { id },
      include: { sender: true }
    });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<EmailJob | null> {
    return prisma.emailJob.findUnique({
      where: { idempotencyKey }
    });
  }

  async createSingle(dto: CreateEmailJobDto): Promise<EmailJob> {
    return prisma.emailJob.create({
      data: {
        batchId: dto.batchId ?? null,
        senderId: dto.senderId,
        recipientEmail: dto.recipientEmail,
        subject: dto.subject,
        body: dto.body,
        status: EmailJobStatus.SCHEDULED,
        scheduledAt: dto.scheduledAt,
        idempotencyKey: dto.idempotencyKey,
        bullmqJobId: dto.bullmqJobId ?? null
      }
    });
  }

  async createBatchWithJobs(
    batchDto: CreateBatchDto,
    jobsDto: Omit<CreateEmailJobDto, 'batchId'>[]
  ): Promise<{ batch: EmailBatch; jobsCount: number }> {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.emailBatch.create({
        data: {
          userId: batchDto.userId,
          senderId: batchDto.senderId,
          originalFilename: batchDto.originalFilename ?? null,
          totalLeadsDetected: batchDto.totalLeadsDetected,
          scheduledStartTime: batchDto.scheduledStartTime,
          configuredDelaySeconds: batchDto.configuredDelaySeconds ?? 2
        }
      });

      const emailJobData = jobsDto.map((job) => ({
        batchId: batch.id,
        senderId: job.senderId,
        recipientEmail: job.recipientEmail,
        subject: job.subject,
        body: job.body,
        status: EmailJobStatus.SCHEDULED,
        scheduledAt: job.scheduledAt,
        idempotencyKey: job.idempotencyKey,
        bullmqJobId: job.bullmqJobId ?? null
      }));

      const result = await tx.emailJob.createMany({
        data: emailJobData
      });

      return { batch, jobsCount: result.count };
    });
  }

  async findScheduled(options: {
    page?: number;
    limit?: number;
    userId?: string;
    senderId?: string;
  }): Promise<{ jobs: EmailJob[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = {
      status: {
        in: [EmailJobStatus.SCHEDULED, EmailJobStatus.RATE_LIMITED_RESCHEDULED]
      },
      ...(options.userId ? { sender: { userId: options.userId } } : {}),
      ...(options.senderId ? { senderId: options.senderId } : {})
    };

    const [jobs, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: { sender: true }
      }),
      prisma.emailJob.count({ where })
    ]);

    return { jobs, total };
  }

  async findSent(options: {
    page?: number;
    limit?: number;
    userId?: string;
    senderId?: string;
    status?: EmailJobStatus;
  }): Promise<{ jobs: EmailJob[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = {
      status: options.status ?? EmailJobStatus.SENT,
      ...(options.userId ? { sender: { userId: options.userId } } : {}),
      ...(options.senderId ? { senderId: options.senderId } : {})
    };

    const [jobs, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
        include: { sender: true }
      }),
      prisma.emailJob.count({ where })
    ]);

    return { jobs, total };
  }

  /**
   * Atomically transitions a job to PROCESSING status to prevent concurrent workers from claiming it.
   * Returns true if successfully claimed, false if already claimed or not in SCHEDULED/RESCHEDULED state.
   */
  async claimJobForProcessing(id: string): Promise<boolean> {
    const result = await prisma.emailJob.updateMany({
      where: {
        id,
        status: {
          in: [EmailJobStatus.SCHEDULED, EmailJobStatus.RATE_LIMITED_RESCHEDULED]
        }
      },
      data: {
        status: EmailJobStatus.PROCESSING
      }
    });

    return result.count > 0;
  }

  async markAsSent(
    id: string,
    data: { smtpMessageId?: string | null; etherealPreviewUrl?: string | null }
  ): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: {
        status: EmailJobStatus.SENT,
        sentAt: new Date(),
        smtpMessageId: data.smtpMessageId ?? null,
        etherealPreviewUrl: data.etherealPreviewUrl ?? null
      }
    });
  }

  async markAsFailed(id: string, errorMessage: string): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: {
        status: EmailJobStatus.FAILED,
        failedAt: new Date(),
        errorMessage
      }
    });
  }

  async markAsRescheduled(id: string, rescheduledAt: Date): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: {
        status: EmailJobStatus.RATE_LIMITED_RESCHEDULED,
        rescheduledAt,
        retryCount: { increment: 1 }
      }
    });
  }

  async cancelJob(id: string): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: {
        status: EmailJobStatus.CANCELLED
      }
    });
  }

  /**
   * Finds all jobs eligible for future or pending delivery (SCHEDULED or RATE_LIMITED_RESCHEDULED).
   */
  async findPendingJobs(options?: { take?: number }): Promise<EmailJob[]> {
    return prisma.emailJob.findMany({
      where: {
        status: {
          in: [EmailJobStatus.SCHEDULED, EmailJobStatus.RATE_LIMITED_RESCHEDULED]
        }
      },
      take: options?.take ?? 1000,
      orderBy: { scheduledAt: 'asc' }
    });
  }

  /**
   * Finds jobs stuck in PROCESSING status older than threshold (abandoned by crashing workers).
   */
  async findAbandonedProcessingJobs(cutoffDate: Date): Promise<EmailJob[]> {
    return prisma.emailJob.findMany({
      where: {
        status: EmailJobStatus.PROCESSING,
        updatedAt: {
          lt: cutoffDate
        }
      },
      include: {
        deliveryAttempts: {
          orderBy: { attemptNumber: 'desc' },
          take: 1
        }
      }
    });
  }

  /**
   * Reverts an abandoned job back to SCHEDULED.
   */
  async revertToScheduled(id: string): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: {
        status: EmailJobStatus.SCHEDULED
      }
    });
  }

  /**
   * Updates the BullMQ job identifier for an email job.
   */
  async updateBullMqJobId(id: string, bullmqJobId: string): Promise<EmailJob> {
    return prisma.emailJob.update({
      where: { id },
      data: { bullmqJobId }
    });
  }
}

export const scheduledEmailRepository = new ScheduledEmailRepository();
