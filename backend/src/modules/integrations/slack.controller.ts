import type { Request, Response, NextFunction } from 'express';
import { slackOAuthService } from './slack-oauth.service.js';
import { slackNotificationService } from './slack-notification.service.js';
import { userRepository } from '../auth/user.repository.js';
import { env } from '../../config/environment.config.js';
import { ValidationError } from '../../shared/errors/AppError.js';

export class SlackController {
  private async resolveUserId(req: Request): Promise<string> {
    const authUser = (req as unknown as { user?: { id: string } }).user;
    if (authUser?.id) {
      return authUser.id;
    }

    // Isolated development boundary: resolve or create development user
    const devUser = await userRepository.upsertGoogleUser({
      googleId: 'dev-operator-reachinbox',
      email: 'operator@reachinbox.ai',
      name: 'ReachInbox Operator'
    });
    return devUser.id;
  }

  /**
   * Initiates Slack OAuth 2.0 flow by redirecting to Slack consent screen.
   * GET /api/v1/integrations/slack/authorize
   */
  async authorize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = await this.resolveUserId(req);
      const { url } = await slackOAuthService.generateAuthorizationUrl(userId);
      res.redirect(302, url);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Handles Slack OAuth 2.0 callback, exchanging authorization code for credentials.
   * GET /api/v1/integrations/slack/callback
   */
  async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const error = req.query.error as string;

      if (error) {
        res.redirect(302, `${env.FRONTEND_URL}/dashboard?slack=error&reason=${encodeURIComponent(error)}`);
        return;
      }

      if (!code || !state) {
        throw new ValidationError('Missing required Slack authorization code or state token');
      }

      await slackOAuthService.handleCallback(code, state);
      res.redirect(302, `${env.FRONTEND_URL}/dashboard?slack=connected`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Retrieves connection health and workspace metadata.
   * GET /api/v1/integrations/slack/status
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = await this.resolveUserId(req);
      const status = await slackOAuthService.getConnectionStatus(userId);

      res.status(200).json({
        success: true,
        data: status,
        meta: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Disconnects active Slack workspace integration.
   * DELETE /api/v1/integrations/slack/disconnect
   */
  async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = await this.resolveUserId(req);
      await slackOAuthService.disconnectIntegration(userId);

      res.status(200).json({
        success: true,
        data: {
          message: 'Slack integration disconnected successfully'
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
   * Sends a test alert to the connected Slack channel.
   * POST /api/v1/integrations/slack/test
   */
  async sendTestNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = await this.resolveUserId(req);
      const result = await slackNotificationService.sendRateLimitAlert({
        userId,
        senderId: 'test-sender-id',
        senderEmail: 'outreach@reachinbox.ai',
        quotaLimit: 200,
        hourWindow: 'TEST-WINDOW',
        deferredCount: 0,
        nextWindowTime: new Date(Date.now() + 3600000)
      });

      if (!result.delivered) {
        res.status(400).json({
          success: false,
          error: {
            code: 'SLACK_DELIVERY_FAILED',
            message: result.error || 'Failed to dispatch test notification to Slack'
          }
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          message: `Test notification delivered to ${result.channel || 'Slack'}`
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

export const slackController = new SlackController();
