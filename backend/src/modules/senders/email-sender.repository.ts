import { prisma } from '../../shared/database/prisma.client.js';
import type { SenderIdentity } from '@prisma/client';
import { encryptCredential, decryptCredential } from '../../shared/utils/encryption.util.js';

export interface CreateSenderDto {
  userId: string;
  emailAddress: string;
  displayName: string;
  smtpHost: string;
  smtpPort?: number;
  smtpUsername: string;
  smtpPasswordPlain: string;
  hourlyRateLimit?: number;
  minDelaySeconds?: number;
  isActive?: boolean;
}

export class EmailSenderRepository {
  async findById(id: string): Promise<SenderIdentity | null> {
    return prisma.senderIdentity.findUnique({
      where: { id }
    });
  }

  async findByUserId(userId: string): Promise<SenderIdentity[]> {
    return prisma.senderIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async create(dto: CreateSenderDto): Promise<SenderIdentity> {
    const encryptedPassword = encryptCredential(dto.smtpPasswordPlain);

    return prisma.senderIdentity.create({
      data: {
        userId: dto.userId,
        emailAddress: dto.emailAddress,
        displayName: dto.displayName,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort ?? 587,
        smtpUsername: dto.smtpUsername,
        smtpPasswordEncrypted: encryptedPassword,
        hourlyRateLimit: dto.hourlyRateLimit ?? 200,
        minDelaySeconds: dto.minDelaySeconds ?? 2,
        isActive: dto.isActive ?? true
      }
    });
  }

  async updateRateLimit(
    id: string,
    hourlyRateLimit: number,
    minDelaySeconds?: number
  ): Promise<SenderIdentity> {
    return prisma.senderIdentity.update({
      where: { id },
      data: {
        hourlyRateLimit,
        ...(minDelaySeconds !== undefined ? { minDelaySeconds } : {})
      }
    });
  }

  async setActiveStatus(id: string, isActive: boolean): Promise<SenderIdentity> {
    return prisma.senderIdentity.update({
      where: { id },
      data: { isActive }
    });
  }

  getDecryptedSmtpPassword(sender: SenderIdentity): string {
    return decryptCredential(sender.smtpPasswordEncrypted);
  }
}

export const emailSenderRepository = new EmailSenderRepository();
