import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSafeFrontendBaseUrl,
  buildFrontendRedirectUrl,
  resolveOAuthCallbackUrl,
  CANONICAL_PRODUCTION_FRONTEND,
  CANONICAL_DEV_FRONTEND
} from './redirect.util.js';
import * as envConfig from '../../config/environment.config.js';

describe('OAuth Redirect URL Security & Formatting Utility', () => {
  const originalEnv = { ...envConfig.env };

  afterEach(() => {
    Object.assign(envConfig.env, originalEnv);
    vi.restoreAllMocks();
  });

  describe('getSafeFrontendBaseUrl', () => {
    it('should return valid configured frontend URL without trailing slashes', () => {
      Object.assign(envConfig.env, {
        FRONTEND_URL: 'https://reachinboxai4u.vercel.app/'
      });

      const url = getSafeFrontendBaseUrl();
      expect(url).toBe('https://reachinboxai4u.vercel.app');
    });

    it('should reject wildcard *.vercel.app and fallback to canonical production URL in production', () => {
      Object.assign(envConfig.env, {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://*.vercel.app'
      });

      const url = getSafeFrontendBaseUrl();
      expect(url).toBe(CANONICAL_PRODUCTION_FRONTEND);
      expect(url).not.toContain('*');
      expect(url).not.toContain('%2A');
    });

    it('should reject URL-encoded wildcard %2A.vercel.app and fallback to canonical origin', () => {
      Object.assign(envConfig.env, {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://%2A.vercel.app'
      });

      const url = getSafeFrontendBaseUrl();
      expect(url).toBe(CANONICAL_PRODUCTION_FRONTEND);
    });

    it('should fallback to local dev frontend when in development mode and URL is empty or wildcard', () => {
      Object.assign(envConfig.env, {
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://*.vercel.app'
      });

      const url = getSafeFrontendBaseUrl();
      expect(url).toBe(CANONICAL_DEV_FRONTEND);
    });
  });

  describe('buildFrontendRedirectUrl', () => {
    beforeEach(() => {
      Object.assign(envConfig.env, {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://reachinboxai4u.vercel.app'
      });
    });

    it('should construct exact Google OAuth success redirect', () => {
      const redirectUrl = buildFrontendRedirectUrl('/dashboard?login=success');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/dashboard?login=success');
    });

    it('should construct exact Google OAuth failure redirect', () => {
      const redirectUrl = buildFrontendRedirectUrl('/login?error=auth_failed');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/login?error=auth_failed');
    });

    it('should construct exact Google OAuth denied redirect', () => {
      const redirectUrl = buildFrontendRedirectUrl('/login?error=oauth_denied');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/login?error=oauth_denied');
    });

    it('should construct exact Slack OAuth success redirect', () => {
      const redirectUrl = buildFrontendRedirectUrl('/dashboard?slack=connected');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/dashboard?slack=connected');
    });

    it('should construct exact Slack OAuth error redirect with encoded reason', () => {
      const reason = encodeURIComponent('access_denied');
      const redirectUrl = buildFrontendRedirectUrl(`/dashboard?slack=error&reason=${reason}`);
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/dashboard?slack=error&reason=access_denied');
    });

    it('should protect against open redirect attacks via protocol-relative URLs (//attacker.com)', () => {
      const redirectUrl = buildFrontendRedirectUrl('//attacker.com/steal-token');
      // Must not start with //attacker.com
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/attacker.com/steal-token');
      expect(redirectUrl.startsWith('https://reachinboxai4u.vercel.app/')).toBe(true);
    });

    it('should normalize paths missing a leading slash', () => {
      const redirectUrl = buildFrontendRedirectUrl('dashboard?login=success');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/dashboard?login=success');
    });

    it('should never produce wildcards even if FRONTEND_URL is misconfigured as *.vercel.app', () => {
      Object.assign(envConfig.env, {
        FRONTEND_URL: 'https://*.vercel.app'
      });

      const redirectUrl = buildFrontendRedirectUrl('/dashboard?login=success');
      expect(redirectUrl).toBe('https://reachinboxai4u.vercel.app/dashboard?login=success');
      expect(redirectUrl).not.toContain('%2A');
      expect(redirectUrl).not.toContain('*');
    });
  });

  describe('resolveOAuthCallbackUrl', () => {
    it('should resolve to Vercel callback URL when request host is vercel.app', () => {
      const req = {
        headers: { host: 'reachinboxai4u.vercel.app' }
      };

      expect(resolveOAuthCallbackUrl(req, 'google')).toBe(
        'https://reachinboxai4u.vercel.app/api/v1/auth/google/callback'
      );
      expect(resolveOAuthCallbackUrl(req, 'slack')).toBe(
        'https://reachinboxai4u.vercel.app/api/v1/integrations/slack/callback'
      );
    });

    it('should resolve to AWS callback URL when request host is 52.23.237.61:5000', () => {
      const req = {
        headers: { host: '52.23.237.61:5000' }
      };

      expect(resolveOAuthCallbackUrl(req, 'google')).toBe(
        'http://52.23.237.61:5000/api/v1/auth/google/callback'
      );
      expect(resolveOAuthCallbackUrl(req, 'slack')).toBe(
        'http://52.23.237.61:5000/api/v1/integrations/slack/callback'
      );
    });

    it('should resolve to Vercel callback URL when x-forwarded-host is vercel.app', () => {
      const req = {
        headers: {
          host: '172.31.16.245:5000',
          'x-forwarded-host': 'reachinboxai4u.vercel.app'
        }
      };

      expect(resolveOAuthCallbackUrl(req, 'google')).toBe(
        'https://reachinboxai4u.vercel.app/api/v1/auth/google/callback'
      );
    });
  });
});
