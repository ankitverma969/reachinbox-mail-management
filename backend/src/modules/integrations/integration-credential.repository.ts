import { prisma } from '../../shared/database/prisma.client.js';
import type { SlackIntegration } from '@prisma/client';
import { encryptCredential, decryptCredential } from '../../shared/utils/encryption.util.js';

export interface UpsertSlackIntegrationDto {
  userId: string;
  slackTeamId: string;
  slackTeamName: string;
  botUserId: string;
  botTokenPlain: string;
  incomingWebhookUrlPlain?: string | null;
  defaultChannelId: string;
  defaultChannelName: string;
}

export class IntegrationCredentialRepository {
  async upsertSlackIntegration(dto: UpsertSlackIntegrationDto): Promise<SlackIntegration> {
    const encryptedToken = encryptCredential(dto.botTokenPlain);
    const encryptedWebhook = dto.incomingWebhookUrlPlain
      ? encryptCredential(dto.incomingWebhookUrlPlain)
      : null;

    return prisma.slackIntegration.upsert({
      where: {
        uq_user_slack_team: {
          userId: dto.userId,
          slackTeamId: dto.slackTeamId
        }
      },
      update: {
        slackTeamName: dto.slackTeamName,
        botUserId: dto.botUserId,
        botTokenEncrypted: encryptedToken,
        incomingWebhookUrlEncrypted: encryptedWebhook,
        defaultChannelId: dto.defaultChannelId,
        defaultChannelName: dto.defaultChannelName,
        isConnected: true
      },
      create: {
        userId: dto.userId,
        slackTeamId: dto.slackTeamId,
        slackTeamName: dto.slackTeamName,
        botUserId: dto.botUserId,
        botTokenEncrypted: encryptedToken,
        incomingWebhookUrlEncrypted: encryptedWebhook,
        defaultChannelId: dto.defaultChannelId,
        defaultChannelName: dto.defaultChannelName,
        isConnected: true
      }
    });
  }

  async findByUserId(userId: string): Promise<SlackIntegration[]> {
    return prisma.slackIntegration.findMany({
      where: { userId, isConnected: true }
    });
  }

  async findByUserAndTeam(
    userId: string,
    slackTeamId: string
  ): Promise<SlackIntegration | null> {
    return prisma.slackIntegration.findUnique({
      where: {
        uq_user_slack_team: {
          userId,
          slackTeamId
        }
      }
    });
  }

  async disconnect(userId: string, slackTeamId: string): Promise<SlackIntegration> {
    return prisma.slackIntegration.update({
      where: {
        uq_user_slack_team: {
          userId,
          slackTeamId
        }
      },
      data: {
        isConnected: false
      }
    });
  }

  getDecryptedBotToken(integration: SlackIntegration): string {
    return decryptCredential(integration.botTokenEncrypted);
  }

  getDecryptedWebhookUrl(integration: SlackIntegration): string | null {
    if (!integration.incomingWebhookUrlEncrypted) {
      return null;
    }
    return decryptCredential(integration.incomingWebhookUrlEncrypted);
  }
}

export const integrationCredentialRepository = new IntegrationCredentialRepository();
