import crypto from 'crypto';
import { createRedisClient } from '../../config/redis.config.js';
import { env } from '../../config/environment.config.js';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';

export interface GoogleUserProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export class GoogleOAuthService {
  private redis = createRedisClient();

  /**
   * Generates a CSRF-protected Google OAuth 2.0 authorization URL.
   */
  async generateAuthorizationUrl(customCallbackUrl?: string): Promise<{ url: string; state: string }> {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new ValidationError(
        'Google OAuth is not configured on this server (GOOGLE_CLIENT_ID is missing)'
      );
    }

    const redirectUri = customCallbackUrl || env.GOOGLE_CALLBACK_URL;
    const state = crypto.randomBytes(24).toString('hex');
    await this.redis.set(
      `oauth:google:state:${state}`,
      JSON.stringify({ status: 'pending', redirectUri }),
      'EX',
      600
    ); // 10 minute TTL

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent'
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return { url, state };
  }

  /**
   * Validates state parameter to protect against CSRF attacks and extracts stored redirectUri.
   */
  async validateAndConsumeState(state: string): Promise<{ isValid: boolean; redirectUri?: string }> {
    const key = `oauth:google:state:${state}`;
    const value = await this.redis.get(key);
    if (!value) {
      return { isValid: false };
    }
    await this.redis.del(key);

    try {
      const parsed = JSON.parse(value);
      return { isValid: true, redirectUri: parsed.redirectUri };
    } catch {
      return { isValid: true };
    }
  }

  /**
   * Validates state parameter to protect against CSRF attacks.
   */
  async validateState(state: string): Promise<boolean> {
    const result = await this.validateAndConsumeState(state);
    return result.isValid;
  }

  /**
   * Exchanges an authorization code with Google OAuth for tokens and profile information.
   */
  async exchangeCodeForProfile(
    code: string,
    state: string,
    fallbackCallbackUrl?: string
  ): Promise<GoogleUserProfile> {
    const stateResult = await this.validateAndConsumeState(state);
    if (!stateResult.isValid) {
      throw new UnauthorizedError('Invalid or expired OAuth state parameter (CSRF protection)');
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new ValidationError('Google OAuth client credentials are not configured');
    }

    const redirectUri = stateResult.redirectUri || fallbackCallbackUrl || env.GOOGLE_CALLBACK_URL;

    // 1. Exchange authorization code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error({ status: tokenResponse.status, errorText }, 'Google token exchange failed');
      throw new UnauthorizedError('Failed to exchange authorization code with Google');
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string; id_token?: string };

    // 2. Officially verify ID Token claims if returned
    if (tokenData.id_token) {
      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`
      );
      if (!tokenInfoResponse.ok) {
        throw new UnauthorizedError('Google ID token verification failed with official tokeninfo service');
      }
      const tokenInfo = (await tokenInfoResponse.json()) as {
        aud?: string;
        iss?: string;
        exp?: string | number;
        email?: string;
        email_verified?: string | boolean;
      };

      // Verify audience matches our configured Google Client ID
      if (tokenInfo.aud !== env.GOOGLE_CLIENT_ID) {
        throw new UnauthorizedError(
          `Google ID token audience mismatch. Expected ${env.GOOGLE_CLIENT_ID}, received ${tokenInfo.aud}`
        );
      }

      // Verify issuer is Google
      if (tokenInfo.iss !== 'accounts.google.com' && tokenInfo.iss !== 'https://accounts.google.com') {
        throw new UnauthorizedError(`Invalid Google ID token issuer: ${tokenInfo.iss}`);
      }

      // Verify token expiration
      const expSec = Number(tokenInfo.exp);
      if (expSec && expSec < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedError('Google ID token has expired');
      }

      // Verify email was verified by Google
      const isEmailVerified = tokenInfo.email_verified === 'true' || tokenInfo.email_verified === true;
      if (!isEmailVerified) {
        throw new UnauthorizedError('Unverified Google email accounts are not permitted to log in');
      }
    }

    // 3. Fetch user profile from Google UserInfo endpoint
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!profileResponse.ok) {
      throw new UnauthorizedError('Failed to retrieve verified user profile from Google');
    }

    const profile = (await profileResponse.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
      email_verified?: boolean;
    };

    if (!profile.sub || !profile.email) {
      throw new UnauthorizedError('Google identity profile missing required email or subject');
    }

    if (profile.email_verified === false) {
      throw new UnauthorizedError('Unverified Google email accounts cannot be authenticated');
    }

    return {
      googleId: profile.sub,
      email: profile.email.toLowerCase().trim(),
      name: profile.name || profile.email.split('@')[0] || 'User',
      avatarUrl: profile.picture || null
    };
  }

  async close(): Promise<void> {
    // Redis client is shared with BullMQ connection pool
  }
}

export const googleOAuthService = new GoogleOAuthService();
