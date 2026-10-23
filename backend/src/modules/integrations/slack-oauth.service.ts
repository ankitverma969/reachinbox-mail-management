import crypto from 'crypto';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis.config.js';
import { env } from '../../config/environment.config.js';
import { integrationCredentialRepository } from './integration-credential.repository.js';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';

export interface SlackOAuthStatus {
  isConnected: boolean;
  teamName?: string;
  channelName?: string;
  lastNotificationSentAt?: string;
}

export class SlackOAuthService {
  private redisClient: Redis;

  constructor(redisClient?: Redis) {
    this.redisClient = redisClient || createRedisClient();
  }

  /**
   * Generates a cryptographically random OAuth state token, caches it in Redis with 10m TTL,
   * and returns the official Slack authorization URL.
   */
  async generateAuthorizationUrl(userId: string): Promise<{ url: string; state: string }> {
    if (!env.SLACK_CLIENT_ID) {
      throw new ValidationError('SLACK_CLIENT_ID is not configured in environment variables');
    }

    const state = crypto.randomBytes(24).toString('hex');
    const stateKey = `slack:oauth:state:${state}`;

    // Store state -> userId binding with 10-minute expiration
    await this.redisClient.set(stateKey, userId, 'EX', 600);

    const redirectUri =
      env.SLACK_CALLBACK_URL || `http://localhost:${env.PORT}/api/v1/integrations/slack/callback`;
    const scopes = ['chat:write', 'incoming-webhook'].join(',');

    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      scope: scopes,
      redirect_uri: redirectUri,
      state
    });

    const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    return { url, state };
  }

  /**
   * Validates the OAuth state and exchanges the authorization code for Slack credentials.
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<{ teamName: string; channelName: string; userId: string }> {
    if (!code || !state) {
      throw new ValidationError('Missing authorization code or state token');
    }

    const stateKey = `slack:oauth:state:${state}`;
    const userId = await this.redisClient.get(stateKey);

    if (!userId) {
      throw new UnauthorizedError('Invalid or expired Slack OAuth state parameter');
    }

    // Delete state token immediately to prevent replay
    await this.redisClient.del(stateKey);

    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
      throw new ValidationError(
        'Slack OAuth client credentials (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET) are missing'
      );
    }

    const redirectUri =
      env.SLACK_CALLBACK_URL || `http://localhost:${env.PORT}/api/v1/integrations/slack/callback`;

    // Exchange authorization code with Slack OAuth API
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      }).toString()
    });

    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      access_token?: string;
      bot_user_id?: string;
      team?: { id: string; name: string };
      incoming_webhook?: {
        url: string;
        channel: string;
        channel_id: string;
      };
      authed_user?: { id: string };
    };

    if (!data.ok || !data.access_token || !data.team) {
      logger.error({ error: data.error }, 'Slack OAuth code exchange failed');
      throw new ValidationError(`Slack OAuth exchange failed: ${data.error || 'Unknown error'}`);
    }

    // Encrypt and persist Slack credentials
    const integration = await integrationCredentialRepository.upsertSlackIntegration({
      userId,
      slackTeamId: data.team.id,
      slackTeamName: data.team.name,
      botUserId: data.bot_user_id || data.authed_user?.id || 'unknown',
      botTokenPlain: data.access_token,
      incomingWebhookUrlPlain: data.incoming_webhook?.url || null,
      defaultChannelId: data.incoming_webhook?.channel_id || 'general',
      defaultChannelName: data.incoming_webhook?.channel || '#general'
    });

    logger.info(
      { userId, teamId: data.team.id, teamName: data.team.name },
      'Slack workspace successfully connected and encrypted credentials persisted'
    );

    return {
      teamName: integration.slackTeamName,
      channelName: integration.defaultChannelName,
      userId
    };
  }

  /**
   * Retrieves connection status for the authenticated user without leaking credentials.
   */
  async getConnectionStatus(userId: string): Promise<SlackOAuthStatus> {
    const integrations = await integrationCredentialRepository.findByUserId(userId);
    if (!integrations || integrations.length === 0) {
      return { isConnected: false };
    }

    const active = integrations[0];
    if (!active) {
      return { isConnected: false };
    }

    return {
      isConnected: active.isConnected,
      teamName: active.slackTeamName,
      channelName: active.defaultChannelName,
      lastNotificationSentAt: active.updatedAt.toISOString()
    };
  }

  /**
   * Disconnects the active Slack workspace for a user.
   */
  async disconnectIntegration(userId: string): Promise<void> {
    const integrations = await integrationCredentialRepository.findByUserId(userId);
    if (!integrations || integrations.length === 0) {
      return;
    }

    for (const integration of integrations) {
      await integrationCredentialRepository.disconnect(userId, integration.slackTeamId);
    }

    logger.info({ userId }, 'Slack integration disconnected');
  }

  async close(): Promise<void> {
    try {
      await this.redisClient.quit();
    } catch {
      this.redisClient.disconnect();
    }
  }
}

export const slackOAuthService = new SlackOAuthService();
