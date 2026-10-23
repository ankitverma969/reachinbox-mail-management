import { prisma } from '../../shared/database/prisma.client.js';
import type { RateLimitAuditLog } from '@prisma/client';

export interface RecordDeferredEventDto {
  senderId: string;
  hourWindow: string;
  quotaLimit: number;
  slackAlertSent?: boolean;
  slackError?: string | null;
}

export class RateLimitAuditRepository {
  /**
   * Records or updates a rate-limit deferral event in PostgreSQL.
   * Atomically increments totalJobsDeferred to avoid duplicate rows for the same window.
   */
  async recordDeferredEvent(dto: RecordDeferredEventDto): Promise<RateLimitAuditLog> {
    return prisma.rateLimitAuditLog.upsert({
      where: {
        uq_rate_limit_sender_window: {
          senderId: dto.senderId,
          hourWindow: dto.hourWindow
        }
      },
      update: {
        totalJobsDeferred: { increment: 1 },
        ...(dto.slackAlertSent !== undefined ? { slackAlertSent: dto.slackAlertSent } : {}),
        ...(dto.slackError !== undefined ? { slackError: dto.slackError } : {})
      },
      create: {
        senderId: dto.senderId,
        hourWindow: dto.hourWindow,
        quotaLimit: dto.quotaLimit,
        totalJobsDeferred: 1,
        slackAlertSent: dto.slackAlertSent ?? false,
        slackError: dto.slackError ?? null
      }
    });
  }

  async findBySenderAndWindow(
    senderId: string,
    hourWindow: string
  ): Promise<RateLimitAuditLog | null> {
    return prisma.rateLimitAuditLog.findUnique({
      where: {
        uq_rate_limit_sender_window: {
          senderId,
          hourWindow
        }
      }
    });
  }

  async getRecentAudits(senderId?: string, limit = 20): Promise<RateLimitAuditLog[]> {
    return prisma.rateLimitAuditLog.findMany({
      where: senderId ? { senderId } : undefined,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { sender: true }
    });
  }
}

export const rateLimitAuditRepository = new RateLimitAuditRepository();
