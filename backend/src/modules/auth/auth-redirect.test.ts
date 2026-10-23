import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authController } from './auth.controller.js';
import { slackController } from '../integrations/slack.controller.js';
import { googleOAuthService } from './google-oauth.service.js';
import { slackOAuthService } from '../integrations/slack-oauth.service.js';
import { userRepository } from './user.repository.js';
import * as envConfig from '../../config/environment.config.js';

describe('OAuth Redirect Flow Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(envConfig.env, {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://reachinboxai4u.vercel.app'
    });
  });

  const createMockRes = () => {
    const res = {
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      cookie: vi.fn().mockReturnThis()
    } as unknown as Response;
    return res;
  };

  describe('Google OAuth Callback Redirects', () => {
    it('should redirect to /dashboard?login=success on successful authentication', async () => {
      const req = {
        query: { code: 'valid-google-code', state: 'valid-state-123' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockResolvedValue({
        googleId: 'google-12345',
        email: 'user@example.com',
        name: 'Test User',
        avatarUrl: null
      });

      vi.spyOn(userRepository, 'upsertGoogleUser').mockResolvedValue({
        id: 'user-uuid-1',
        googleId: 'google-12345',
        email: 'user@example.com',
        name: 'Test User',
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await authController.handleGoogleCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://reachinboxai4u.vercel.app/dashboard?login=success'
      );
    });

    it('should redirect to /login?error=oauth_denied when user cancels consent', async () => {
      const req = {
        query: { error: 'access_denied' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      await authController.handleGoogleCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://reachinboxai4u.vercel.app/login?error=oauth_denied'
      );
    });

    it('should redirect to /login?error=auth_failed on token exchange error or invalid state', async () => {
      const req = {
        query: { code: 'bad-code', state: 'expired-state' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      vi.spyOn(googleOAuthService, 'exchangeCodeForProfile').mockRejectedValue(
        new Error('Invalid or expired OAuth state parameter')
      );

      await authController.handleGoogleCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://reachinboxai4u.vercel.app/login?error=auth_failed'
      );
    });

    it('should sanitize wildcard FRONTEND_URL and never redirect to *.vercel.app or %2A.vercel.app', async () => {
      Object.assign(envConfig.env, {
        FRONTEND_URL: 'https://*.vercel.app'
      });

      const req = {
        query: { error: 'access_denied' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      await authController.handleGoogleCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://reachinboxai4u.vercel.app/login?error=oauth_denied'
      );
      const redirectArg = (res.redirect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(redirectArg).not.toContain('*');
      expect(redirectArg).not.toContain('%2A');
    });
  });

  describe('Slack OAuth Callback Redirects', () => {
    it('should redirect to /dashboard?slack=connected on successful integration', async () => {
      const req = {
        query: { code: 'slack-code-123', state: 'slack-state-456' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      vi.spyOn(slackOAuthService, 'handleCallback').mockResolvedValue({
        teamName: 'ReachInbox Team',
        channelName: 'general',
        userId: 'user-uuid-1'
      });

      await slackController.callback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'https://reachinboxai4u.vercel.app/dashboard?slack=connected'
      );
    });

    it('should redirect to /dashboard?slack=error with reason when error query param is present', async () => {
      const req = {
        query: { error: 'access_denied' }
      } as unknown as Request;
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      await slackController.callback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'https://reachinboxai4u.vercel.app/dashboard?slack=error&reason=access_denied'
      );
    });
  });
});
