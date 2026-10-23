import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { googleOAuthService } from './google-oauth.service.js';
import { userRepository } from './user.repository.js';
import { env } from '../../config/environment.config.js';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';

export class AuthController {
  private issueSessionToken(res: Response, user: { id: string; email: string; name: string; avatarUrl?: string | null }): string {
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.email.includes('admin') ? 'admin' : 'user'
      },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('reachinbox_token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    return token;
  }

  /**
   * Initiates Google OAuth 2.0 flow.
   * GET /api/v1/auth/google
   */
  async initiateGoogleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        // Return clear error if credentials not yet configured
        res.status(400).json({
          success: false,
          error: {
            code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
            message:
              'Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured. Please set them in backend/.env or use /api/v1/auth/dev-login for testing.'
          }
        });
        return;
      }

      const { url } = await googleOAuthService.generateAuthorizationUrl();
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Handles Google OAuth 2.0 callback.
   * GET /api/v1/auth/google/callback
   */
  async handleGoogleCallback(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const error = req.query.error as string | undefined;
      if (error) {
        logger.warn({ error }, 'Google OAuth access was denied or cancelled by user');
        res.redirect(`${env.FRONTEND_URL}/login?error=oauth_denied`);
        return;
      }

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;

      if (!code || !state) {
        throw new ValidationError('Missing authorization code or state in OAuth callback');
      }

      const profile = await googleOAuthService.exchangeCodeForProfile(code, state);

      // Upsert user in database
      const user = await userRepository.upsertGoogleUser({
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl
      });

      this.issueSessionToken(res, user);

      logger.info({ userId: user.id, email: user.email }, 'User authenticated successfully via Google OAuth');
      res.redirect(`${env.FRONTEND_URL}/dashboard?login=success`);
    } catch (err) {
      logger.error({ err }, 'Error during Google OAuth callback processing');
      res.redirect(`${env.FRONTEND_URL}/login?error=auth_failed`);
    }
  }

  /**
   * Retrieves the currently authenticated user's profile.
   * GET /api/v1/auth/me
   */
  async getCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Not authenticated');
      }

      const user = await userRepository.findById(req.user.id);
      if (!user) {
        throw new UnauthorizedError('User account not found');
      }

      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          role: req.user.role || 'user',
          createdAt: user.createdAt
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Logs out the current session and clears the HttpOnly cookie.
   * POST /api/v1/auth/logout
   */
  async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie('reachinbox_token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/'
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Successfully logged out'
      }
    });
  }

  /**
   * Developer login endpoint strictly for local testing and demonstration.
   * POST /api/v1/auth/dev-login
   */
  async devLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (env.NODE_ENV === 'production' || env.ENABLE_DEV_LOGIN !== 'true') {
        res.status(403).json({
          success: false,
          error: {
            code: 'DEV_LOGIN_DISABLED',
            message: 'Developer bypass login is disabled in this environment. Please authenticate via official Google OAuth.'
          }
        });
        return;
      }

      const rawEmail = (req.body?.email as string) || 'demo.lead@reachinbox.test';
      const email = rawEmail.toLowerCase().trim();
      const name = ((req.body?.name as string) || 'Alex Morgan').trim();

      // Prohibit impersonating production or reserved accounts
      if (!email.includes('@') || email.length > 120) {
        throw new ValidationError('A valid test email address is required for developer login');
      }

      const user = await userRepository.upsertGoogleUser({
        googleId: `dev-${Buffer.from(email).toString('base64').substring(0, 16)}`,
        email,
        name,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`
      });

      const token = this.issueSessionToken(res, user);

      res.status(200).json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            role: email.includes('admin') ? 'admin' : 'user'
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
