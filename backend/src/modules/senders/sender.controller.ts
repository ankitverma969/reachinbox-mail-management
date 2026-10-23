import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { emailSenderRepository } from './email-sender.repository.js';
import { env } from '../../config/environment.config.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/errors/AppError.js';
import { prisma } from '../../shared/database/prisma.client.js';

const createSenderSchema = z.object({
  emailAddress: z.string().email('Invalid email address format'),
  displayName: z.string().min(1, 'Display name is required'),
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpUsername: z.string().min(1, 'SMTP username is required'),
  smtpPasswordPlain: z.string().min(1, 'SMTP password is required'),
  hourlyRateLimit: z.coerce.number().int().min(1).max(5000).default(200),
  minDelaySeconds: z.coerce.number().int().min(0).max(300).default(2),
  isActive: z.boolean().default(true)
});

const updateSenderSchema = z.object({
  displayName: z.string().min(1).optional(),
  hourlyRateLimit: z.coerce.number().int().min(1).max(5000).optional(),
  minDelaySeconds: z.coerce.number().int().min(0).max(300).optional(),
  isActive: z.boolean().optional()
});

export class SenderController {
  /**
   * Lists senders owned by the authenticated user.
   * GET /api/v1/senders
   */
  async listSenders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      let senders = await emailSenderRepository.findByUserId(userId);

      // If user has zero senders, automatically provision an Ethereal test sender for immediate outreach capability
      if (senders.length === 0) {
        const defaultSender = await emailSenderRepository.create({
          userId,
          emailAddress: req.user?.email || 'outreach.sender@reachinbox.ai',
          displayName: req.user?.name || 'ReachInbox Outreach',
          smtpHost: env.ETHEREAL_HOST,
          smtpPort: env.ETHEREAL_PORT,
          smtpUsername: env.ETHEREAL_USER || 'lelia.vandervort64@ethereal.email',
          smtpPasswordPlain: env.ETHEREAL_PASSWORD || '4ZT9ekpfjj71mjBgGs',
          hourlyRateLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
          minDelaySeconds: 2,
          isActive: true
        });
        senders = [defaultSender];
      }

      // Safe projection: strictly omit encrypted SMTP passwords
      const safeSenders = senders.map((s) => ({
        id: s.id,
        emailAddress: s.emailAddress,
        displayName: s.displayName,
        smtpHost: s.smtpHost,
        smtpPort: s.smtpPort,
        smtpUsername: s.smtpUsername,
        smtpPasswordMasked: '••••••••',
        hourlyRateLimit: s.hourlyRateLimit,
        minDelaySeconds: s.minDelaySeconds,
        isActive: s.isActive,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }));

      res.status(200).json({
        success: true,
        data: safeSenders
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Creates a new sender identity for the authenticated user.
   * POST /api/v1/senders
   */
  async createSender(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new ValidationError('Authenticated user required');
      }

      const parseResult = createSenderSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError('Sender validation failed', parseResult.error.format());
      }

      const payload = parseResult.data;
      const created = await emailSenderRepository.create({
        userId,
        emailAddress: payload.emailAddress,
        displayName: payload.displayName,
        smtpHost: payload.smtpHost,
        smtpPort: payload.smtpPort,
        smtpUsername: payload.smtpUsername,
        smtpPasswordPlain: payload.smtpPasswordPlain,
        hourlyRateLimit: payload.hourlyRateLimit,
        minDelaySeconds: payload.minDelaySeconds,
        isActive: payload.isActive
      });

      res.status(201).json({
        success: true,
        data: {
          id: created.id,
          emailAddress: created.emailAddress,
          displayName: created.displayName,
          smtpHost: created.smtpHost,
          smtpPort: created.smtpPort,
          smtpUsername: created.smtpUsername,
          smtpPasswordMasked: '••••••••',
          hourlyRateLimit: created.hourlyRateLimit,
          minDelaySeconds: created.minDelaySeconds,
          isActive: created.isActive,
          createdAt: created.createdAt
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Updates an existing sender identity.
   * PATCH /api/v1/senders/:id
   */
  async updateSender(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const rawId = req.params.id;
      const senderId = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!senderId || typeof senderId !== 'string') {
        throw new ValidationError('Sender ID required');
      }

      const sender = await emailSenderRepository.findById(senderId);
      if (!sender) {
        throw new NotFoundError(`Sender '${senderId}' not found`);
      }

      if (sender.userId !== userId && req.user?.role !== 'admin') {
        throw new ForbiddenError('You do not have permission to modify this sender identity');
      }

      const parseResult = updateSenderSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError('Update validation failed', parseResult.error.format());
      }

      const data = parseResult.data;
      const updated = await prisma.senderIdentity.update({
        where: { id: senderId },
        data: {
          ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
          ...(data.hourlyRateLimit !== undefined ? { hourlyRateLimit: data.hourlyRateLimit } : {}),
          ...(data.minDelaySeconds !== undefined ? { minDelaySeconds: data.minDelaySeconds } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
        }
      });

      res.status(200).json({
        success: true,
        data: {
          id: updated.id,
          emailAddress: updated.emailAddress,
          displayName: updated.displayName,
          hourlyRateLimit: updated.hourlyRateLimit,
          minDelaySeconds: updated.minDelaySeconds,
          isActive: updated.isActive,
          updatedAt: updated.updatedAt
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const senderController = new SenderController();
