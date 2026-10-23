import { prisma } from '../../shared/database/prisma.client.js';
import { DeliveryAttemptStatus, type EmailDeliveryAttempt } from '@prisma/client';

export interface RecordDeliveryAttemptDto {
  emailJobId: string;
  attemptNumber: number;
  status: DeliveryAttemptStatus;
  durationMs?: number | null;
  smtpResponse?: string | null;
  smtpMessageId?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
}

export class EmailDeliveryAttemptRepository {
  async recordAttempt(dto: RecordDeliveryAttemptDto): Promise<EmailDeliveryAttempt> {
    return prisma.emailDeliveryAttempt.create({
      data: {
        emailJobId: dto.emailJobId,
        attemptNumber: dto.attemptNumber,
        status: dto.status,
        durationMs: dto.durationMs ?? null,
        smtpResponse: dto.smtpResponse ?? null,
        smtpMessageId: dto.smtpMessageId ?? null,
        errorMessage: dto.errorMessage ?? null,
        errorCode: dto.errorCode ?? null
      }
    });
  }

  async findByJobId(emailJobId: string): Promise<EmailDeliveryAttempt[]> {
    return prisma.emailDeliveryAttempt.findMany({
      where: { emailJobId },
      orderBy: { attemptNumber: 'asc' }
    });
  }

  async getLatestAttempt(emailJobId: string): Promise<EmailDeliveryAttempt | null> {
    return prisma.emailDeliveryAttempt.findFirst({
      where: { emailJobId },
      orderBy: { attemptNumber: 'desc' }
    });
  }
}

export const emailDeliveryAttemptRepository = new EmailDeliveryAttemptRepository();
