import type { Request, Response, NextFunction } from 'express';
import { emailSchedulingService } from './email-scheduling.service.js';
import { scheduledEmailRepository } from './scheduled-email.repository.js';
import { emailSenderRepository } from '../senders/email-sender.repository.js';
import { NotFoundError, ValidationError } from '../../shared/errors/AppError.js';
import type { EmailJobStatus } from '@prisma/client';

export class EmailSchedulingController {
  /**
   * Schedules an outreach email or batch of emails.
   * POST /api/v1/emails/schedule
   */
  async schedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        senderId,
        subject,
        body,
        recipients,
        scheduledAt,
        delayBetweenEmails,
        hourlyLimit,
        originalFilename
      } = req.body;

      if (!senderId) {
        throw new ValidationError('senderId is required');
      }

      const sender = await emailSenderRepository.findById(senderId);
      if (!sender) {
        throw new NotFoundError(`Sender with ID '${senderId}' not found`);
      }

      // Resolve user context from authenticated request or associated sender
      const userId = (req as unknown as { user?: { id: string } }).user?.id || sender.userId;

      const result = await emailSchedulingService.scheduleCampaign({
        userId,
        senderId,
        subject,
        body,
        recipients,
        scheduledAt,
        delayBetweenEmails,
        hourlyLimit,
        originalFilename
      });

      res.status(201).json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves paginated list of scheduled emails.
   * GET /api/v1/emails/scheduled
   */
  async getScheduled(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const senderId = req.query.senderId as string | undefined;
      const userId = req.user?.id;

      const { jobs, total } = await scheduledEmailRepository.findScheduled({
        page,
        limit,
        senderId,
        userId
      });

      const totalPages = Math.ceil(total / limit) || 1;

      res.status(200).json({
        success: true,
        data: jobs.map((job) => {
          const sender = (job as unknown as { sender?: { emailAddress: string } }).sender;
          return {
            id: job.id,
            recipientEmail: job.recipientEmail,
            subject: job.subject,
            body: job.body,
            scheduledAt: job.scheduledAt.toISOString(),
            status: job.status,
            senderEmail: sender?.emailAddress || ''
          };
        }),
        pagination: {
          page,
          limit,
          totalRecords: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves paginated list of sent/failed emails with Ethereal preview links.
   * GET /api/v1/emails/sent
   */
  async getSent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const status = req.query.status as EmailJobStatus | undefined;
      const senderId = req.query.senderId as string | undefined;
      const userId = req.user?.id;

      const { jobs, total } = await scheduledEmailRepository.findSent({
        page,
        limit,
        senderId,
        status,
        userId
      });

      const totalPages = Math.ceil(total / limit) || 1;

      res.status(200).json({
        success: true,
        data: jobs.map((job) => {
          const sender = (job as unknown as { sender?: { emailAddress: string } }).sender;
          return {
            id: job.id,
            recipientEmail: job.recipientEmail,
            subject: job.subject,
            body: job.body,
            sentAt: job.sentAt?.toISOString() || null,
            status: job.status,
            senderEmail: sender?.emailAddress || '',
            etherealPreviewUrl: job.etherealPreviewUrl || null,
            errorMessage: job.errorMessage || null
          };
        }),
        pagination: {
          page,
          limit,
          totalRecords: total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Cancels a pending scheduled email and purges BullMQ job.
   * DELETE /api/v1/emails/scheduled/:id
   */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!id) {
        throw new ValidationError('Email job ID is required');
      }
      await emailSchedulingService.cancelScheduledEmail(id, req.user?.id, req.user?.role);

      res.status(200).json({
        success: true,
        data: {
          message: 'Job cancelled successfully'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const emailSchedulingController = new EmailSchedulingController();
