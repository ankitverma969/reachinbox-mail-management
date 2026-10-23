import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { googleOAuthService } from './google-oauth.service.js';
import { userRepository } from './user.repository.js';
import { env } from '../../config/environment.config.js';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';
import { buildFrontendRedirectUrl, resolveOAuthCallbackUrl } from '../../shared/utils/redirect.util.js';

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

      const callbackUrl = resolveOAuthCallbackUrl(req, 'google');
      const { url } = await googleOAuthService.generateAuthorizationUrl(callbackUrl);
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
        res.redirect(buildFrontendRedirectUrl('/login?error=oauth_denied'));
        return;
      }

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;

      if (!code || !state) {
        throw new ValidationError('Missing authorization code or state in OAuth callback');
      }

      const fallbackCallbackUrl = resolveOAuthCallbackUrl(req, 'google');
      const profile = await googleOAuthService.exchangeCodeForProfile(code, state, fallbackCallbackUrl);

      // Upsert user in database
      const user = await userRepository.upsertGoogleUser({
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl
      });

      this.issueSessionToken(res, user);

      logger.info({ userId: user.id, email: user.email }, 'User authenticated successfully via Google OAuth');
      res.redirect(buildFrontendRedirectUrl('/dashboard?login=success'));
    } catch (err) {
      logger.error({ err }, 'Error during Google OAuth callback processing');
      res.redirect(buildFrontendRedirectUrl('/login?error=auth_failed'));
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
   * Email authentication endpoint.
   * If the account exists in the database, authenticates the user and issues a session token.
   * If the account does not exist (fresh email), registration via this endpoint is not accepted,
   * requiring the user to authenticate via official Google OAuth.
   * POST /api/v1/auth/login or /api/v1/auth/dev-login
   */
  async loginWithEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawEmail = (req.body?.email as string) || '';
      const email = rawEmail.toLowerCase().trim();

      if (!email || !email.includes('@') || email.length > 120) {
        throw new ValidationError('A valid email address is required');
      }

      // Check if user account already exists in database
      const user = await userRepository.findByEmail(email);
      if (!user) {
        res.status(404).json({
          success: false,
          error: {
            code: 'ACCOUNT_NOT_FOUND',
            message: 'No account found with this email. Please authenticate via official Google OAuth or register first.'
          }
        });
        return;
      }

      const token = this.issueSessionToken(res, user);

      logger.info({ userId: user.id, email: user.email }, 'User logged in via email successfully');

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

  /**
   * Developer login endpoint alias for backward compatibility.
   * POST /api/v1/auth/dev-login
   */
  async devLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.loginWithEmail(req, res, next);
  }
}

export const authController = new AuthController();
