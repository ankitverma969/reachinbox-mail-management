import type { Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis.config.js';
import { integrationCredentialRepository } from './integration-credential.repository.js';
import { env } from '../../config/environment.config.js';
import { logger } from '../../shared/logger/structured-logger.js';

export interface RateLimitAlertParams {
  userId: string;
  senderId: string;
  senderEmail: string;
  quotaLimit: number;
  hourWindow: string;
  deferredCount: number;
  nextWindowTime: Date;
}

export interface SlackNotificationResult {
  delivered: boolean;
  deduplicated?: boolean;
  channel?: string;
  error?: string;
}

export class SlackNotificationService {
  private redisClient: Redis;

  constructor(redisClient?: Redis) {
    this.redisClient = redisClient || createRedisClient();
  }

  /**
   * Dispatches an operational rate-limit alert to the operator's Slack channel.
   * Atomically deduplicates via Redis so only one alert is transmitted per sender per hour window.
   */
  async sendRateLimitAlert(params: RateLimitAlertParams): Promise<SlackNotificationResult> {
    const dedupeKey = `slack:alerted:${params.senderId}:${params.hourWindow}`;

    try {
      // Atomic deduplication: SET key 1 EX 7200 NX
      // Only the first worker to encounter the limit acquires the lock
      const acquired = await this.redisClient.set(dedupeKey, '1', 'EX', 7200, 'NX');
      if (!acquired) {
        logger.debug(
          { senderId: params.senderId, hourWindow: params.hourWindow },
          'Slack alert already transmitted for this window; skipping duplicate notification'
        );
        return { delivered: true, deduplicated: true };
      }

      // 1. Resolve Slack credentials
      const integrations = await integrationCredentialRepository.findByUserId(params.userId);
      const activeIntegration = integrations.find((i) => i.isConnected);

      let botToken: string | null = null;
      let webhookUrl: string | null = null;
      let targetChannel = env.SLACK_DEFAULT_CHANNEL_ID || 'D0CBFH91A5B';

      if (activeIntegration) {
        botToken = integrationCredentialRepository.getDecryptedBotToken(activeIntegration);
        webhookUrl = integrationCredentialRepository.getDecryptedWebhookUrl(activeIntegration);
        targetChannel = activeIntegration.defaultChannelId || activeIntegration.defaultChannelName || targetChannel;
      } else if (env.SLACK_BOT_TOKEN) {
        // Fallback to environment bot token
        botToken = env.SLACK_BOT_TOKEN;
      }

      if (!botToken && !webhookUrl) {
        logger.info(
          { userId: params.userId, senderId: params.senderId },
          'No active Slack integration found; rate-limit alert skipped without error'
        );
        return { delivered: false, error: 'NO_ACTIVE_SLACK_INTEGRATION' };
      }

      // 2. Format rich Block Kit message
      const nextWindowFormatted = params.nextWindowTime.toUTCString();
      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 ReachInbox Alert: Hourly Rate Limit Reached',
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender:*\n\`${params.senderEmail}\``
            },
            {
              type: 'mrkdwn',
              text: `*Hourly Quota:*\n*${params.quotaLimit} emails/hr*`
            },
            {
              type: 'mrkdwn',
              text: `*Window:*\n${params.hourWindow} (UTC)`
            },
            {
              type: 'mrkdwn',
              text: `*Next Eligible Dispatch:*\n_${nextWindowFormatted}_`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Status:* Remaining queued outreach emails have been *automatically deferred* to the next hour window. Zero emails were dropped or marked as failed.`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ *ReachInbox Distributed Rate-Limit Protection Engine*'
            }
          ]
        }
      ];

      // 3. Dispatch to Slack API
      let success = false;
      let responseError: string | undefined;

      if (webhookUrl) {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks })
        });
        success = res.ok;
        if (!res.ok) {
          responseError = `Webhook error HTTP ${res.status}`;
        }
      } else if (botToken) {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: targetChannel,
            blocks,
            text: `ReachInbox Alert: Hourly rate limit reached for sender ${params.senderEmail}`
          })
        });

        const data = (await res.json()) as { ok: boolean; error?: string };
        success = data.ok;
        if (!data.ok) {
          responseError = data.error || 'Slack chat.postMessage failed';
        }
      }

      if (success) {
        logger.info(
          { senderEmail: params.senderEmail, channel: targetChannel },
          'Slack rate-limit alert successfully delivered'
        );
        return { delivered: true, channel: targetChannel };
      } else {
        logger.error(
          { error: responseError, senderEmail: params.senderEmail },
          'Failed to deliver Slack rate-limit alert'
        );
        return { delivered: false, error: responseError };
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      logger.error(
        { err: errorMsg, senderId: params.senderId },
        'Exception occurred transmitting Slack notification'
      );
      return { delivered: false, error: errorMsg };
    }
  }

  async close(): Promise<void> {
    try {
      await this.redisClient.quit();
    } catch {
      this.redisClient.disconnect();
    }
  }
}

export const slackNotificationService = new SlackNotificationService();
