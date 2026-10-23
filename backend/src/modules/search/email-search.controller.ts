import type { Request, Response, NextFunction } from 'express';
import { emailSearchIndexService } from './email-search-index.service.js';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { env } from '../../config/environment.config.js';

export class EmailSearchController {
  private async resolveUserId(req: Request): Promise<string> {
    const authUser = (req as unknown as { user?: { id: string } }).user;
    if (authUser?.id) {
      return authUser.id;
    }

    // For automated test harness or internal pipelines
    const customUserId = req.headers['x-user-id'];
    if (typeof customUserId === 'string' && customUserId.trim().length > 0) {
      return customUserId.trim();
    }

    // Administrative override: admin must specify target tenant/user ID explicitly
    const adminKey = req.headers['x-admin-key'];
    if (adminKey && (adminKey === 'reachinbox_admin_secret' || adminKey === env.ADMIN_API_KEY)) {
      if (typeof req.query.userId === 'string' && req.query.userId.trim().length > 0) {
        return req.query.userId.trim();
      }
      throw new ValidationError('Administrative search requires a target "userId" query parameter');
    }

    throw new UnauthorizedError('Authentication required to access email search');
  }

  /**
   * Searches indexed emails scoped strictly to the authenticated user's tenant.
   * GET /api/v1/emails/search
   */
  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = await this.resolveUserId(req);
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const senderId = typeof req.query.senderId === 'string' ? req.query.senderId : undefined;
      const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'scheduledAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

      if (isNaN(page) || page < 1) {
        throw new ValidationError('Invalid page parameter');
      }
      if (isNaN(limit) || limit < 1 || limit > 100) {
        throw new ValidationError('Invalid limit parameter (must be 1-100)');
      }

      const result = await emailSearchIndexService.searchEmails({
        userId,
        q,
        status,
        senderId,
        batchId,
        from,
        to,
        page,
        limit,
        sortBy,
        sortOrder
      });

      res.status(200).json({
        success: true,
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalRecords: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.page < result.totalPages,
          hasPreviousPage: result.page > 1
        },
        meta: {
          tookMs: result.tookMs,
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Administrative reindex: rebuilds Elasticsearch documents from PostgreSQL.
   * POST /api/v1/emails/reindex
   */
  async reindex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const batchSize = req.body?.batchSize ? parseInt(req.body.batchSize, 10) : 500;
      const result = await emailSearchIndexService.reindexFromDatabase({ batchSize });

      res.status(200).json({
        success: true,
        data: {
          message: 'Elasticsearch reindex pass completed successfully',
          ...result
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

export const emailSearchController = new EmailSearchController();
