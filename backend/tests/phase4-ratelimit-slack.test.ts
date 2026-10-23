import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/shared/database/prisma.client.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import { emailSenderRepository } from '../src/modules/senders/email-sender.repository.js';
import { scheduledEmailRepository } from '../src/modules/email-scheduling/scheduled-email.repository.js';
import { senderRateLimitService, getUtcHourKey, getNextUtcHourStart } from '../src/modules/rate-limiting/sender-rate-limit.service.js';
import { rateLimitAuditRepository } from '../src/modules/rate-limiting/rate-limit-audit.repository.js';
import { slackOAuthService } from '../src/modules/integrations/slack-oauth.service.js';
import { slackNotificationService } from '../src/modules/integrations/slack-notification.service.js';
import { integrationCredentialRepository } from '../src/modules/integrations/integration-credential.repository.js';
import { emailQueueProducer } from '../src/queues/email-queue.producer.js';
import { emailDeliveryWorker } from '../src/workers/email-delivery.worker.js';
import { generateEmailIdempotencyKey } from '../src/shared/utils/idempotency.util.js';
import { EmailJobStatus } from '@prisma/client';
import { env } from '../src/config/environment.config.js';

describe('Phase 4: Distributed Hourly Rate Limiting & Slack OAuth Notifications', () => {
  let testUser: { id: string; email: string };
  let testSender: { id: string; emailAddress: string; userId: string; hourlyRateLimit: number };

  beforeAll(async () => {
    // 1. Setup user
    const user = await userRepository.upsertGoogleUser({
      googleId: 'test-google-id-phase4',
      email: 'phase4.tester@reachinbox.ai',
      name: 'Phase 4 Tester'
    });
    testUser = { id: user.id, email: user.email };

    // 2. Setup sender with custom hourly rate limit of 3 for testing
    const sender = await emailSenderRepository.create({
      userId: testUser.id,
      emailAddress: 'rate.limited.sender@reachinbox.ai',
      displayName: 'Rate Limit Tester',
      smtpHost: env.ETHEREAL_HOST,
      smtpPort: env.ETHEREAL_PORT,
      smtpUsername: env.ETHEREAL_USER || 'lelia.vandervort64@ethereal.email',
      smtpPasswordPlain: env.ETHEREAL_PASSWORD || '4ZT9ekpfjj71mjBgGs',
      hourlyRateLimit: 3, // Low limit to test quota threshold and rollover
      minDelaySeconds: 1,
      isActive: true
    });
    testSender = {
      id: sender.id,
      emailAddress: sender.emailAddress,
      userId: sender.userId,
      hourlyRateLimit: sender.hourlyRateLimit
    };
  });

  afterAll(async () => {
    // Teardown services
    await emailDeliveryWorker.close();
    await emailQueueProducer.close();
    await senderRateLimitService.close();
    await slackOAuthService.close();
    await slackNotificationService.close();

    // Clean up test DB data
    await prisma.rateLimitAuditLog.deleteMany({
      where: { senderId: testSender.id }
    });
    await prisma.slackIntegration.deleteMany({
      where: { userId: testUser.id }
    });
    await prisma.emailDeliveryAttempt.deleteMany({
      where: { emailJob: { senderId: testSender.id } }
    });
    await prisma.emailJob.deleteMany({
      where: { senderId: testSender.id }
    });
    await prisma.emailBatch.deleteMany({
      where: { senderId: testSender.id }
    });
    await prisma.senderIdentity.deleteMany({
      where: { id: testSender.id }
    });
    await prisma.user.deleteMany({
      where: { id: testUser.id }
    });
  });

  describe('1. Distributed Redis Atomic Rate Limiting', () => {
    it('should allow reserving quota when below hourly limit', async () => {
      await senderRateLimitService.resetCounter(testSender.id);

      const res1 = await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      expect(res1.allowed).toBe(true);
      expect(res1.currentSenderUsage).toBe(1);

      const res2 = await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      expect(res2.allowed).toBe(true);
      expect(res2.currentSenderUsage).toBe(2);

      const res3 = await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      expect(res3.allowed).toBe(true);
      expect(res3.currentSenderUsage).toBe(3);
    });

    it('should reject reservation once hourly limit is reached', async () => {
      // 4th request on a limit of 3 must be rejected
      const res4 = await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      expect(res4.allowed).toBe(false);
      expect(res4.reason).toBe('SENDER_LIMIT_EXCEEDED');
      expect(res4.currentSenderUsage).toBe(3);
    });

    it('should coordinate atomic quota reservations across concurrent workers without overdraft', async () => {
      await senderRateLimitService.resetCounter(testSender.id);
      const limit = 5;

      const runId = Date.now();
      // Simulate 10 workers concurrently racing for 5 slots
      const promises = Array.from({ length: 10 }).map((_, i) =>
        senderRateLimitService.checkAndReserveQuota(testSender.id, limit, new Date(), `job-race-${runId}-${i}`)
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter((r) => r.allowed).length;
      const rejectedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(5);
      expect(rejectedCount).toBe(5);

      const finalUsage = await senderRateLimitService.getCurrentUsage(testSender.id);
      expect(finalUsage).toBe(5);
    });

    it('should prevent double-counting when a job is retried in the same hour window', async () => {
      await senderRateLimitService.resetCounter(testSender.id);
      const testJobId = `job-retry-dedupe-${Date.now()}`;

      // First reservation for this job
      const first = await senderRateLimitService.checkAndReserveQuota(testSender.id, 5, new Date(), testJobId);
      expect(first.allowed).toBe(true);
      const usage1 = await senderRateLimitService.getCurrentUsage(testSender.id);
      expect(usage1).toBe(1);

      // Simulated retry of the exact same job in the same hour window
      const retry = await senderRateLimitService.checkAndReserveQuota(testSender.id, 5, new Date(), testJobId);
      expect(retry.allowed).toBe(true);

      // Usage counter must NOT have incremented again
      const usage2 = await senderRateLimitService.getCurrentUsage(testSender.id);
      expect(usage2).toBe(1);
    });

    it('should format UTC hour keys and next hour rollover boundaries accurately', () => {
      const date = new Date('2026-10-23T14:45:00.000Z');
      const hourKey = getUtcHourKey(date);
      expect(hourKey).toBe('20261023T14');

      const nextHour = getNextUtcHourStart(date);
      expect(nextHour.toISOString()).toBe('2026-10-23T15:00:00.000Z');
    });
  });

  describe('2. Rate-Limit Rescheduling & Worker Integration', () => {
    it('should defer an outreach job to next hour window when quota is exhausted', async () => {
      await senderRateLimitService.resetCounter(testSender.id);
      // Consume all 3 slots
      await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);
      await senderRateLimitService.checkAndReserveQuota(testSender.id, 3);

      const scheduledAt = new Date();
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'deferred.lead@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'deferred.lead@example.com',
        subject: 'Rate Limited Deferral Test',
        body: '<p>Testing automatic next-hour deferral</p>',
        scheduledAt,
        idempotencyKey
      });

      // Execute worker processJob on the job (quota is 0 remaining)
      await emailDeliveryWorker.processJob({
        id: idempotencyKey,
        data: {
          emailJobId: job.id,
          senderId: testSender.id,
          recipientEmail: job.recipientEmail,
          idempotencyKey
        },
        opts: { attempts: 3 },
        attemptsMade: 0
      } as any);

      // Verify that database status was updated to RATE_LIMITED_RESCHEDULED (not FAILED or SENT)
      const updatedJob = await scheduledEmailRepository.findById(job.id);
      expect(updatedJob?.status).toBe(EmailJobStatus.RATE_LIMITED_RESCHEDULED);
      expect(updatedJob?.rescheduledAt).not.toBeNull();
      expect(updatedJob?.rescheduledAt!.getTime()).toBeGreaterThan(Date.now());

      // Verify RateLimitAuditLog was created in PostgreSQL
      const currentWindow = getUtcHourKey();
      const auditLog = await rateLimitAuditRepository.findBySenderAndWindow(testSender.id, currentWindow);
      expect(auditLog).not.toBeNull();
      expect(auditLog?.senderId).toBe(testSender.id);
      expect(auditLog?.totalJobsDeferred).toBeGreaterThanOrEqual(1);

      // Clean up deferred job from BullMQ
      await emailQueueProducer.removeJob(idempotencyKey);
    });
  });

  describe('3. Slack OAuth Lifecycle & Credential Security', () => {
    it('should generate secure CSRF state and validate during callback', async () => {
      const { url, state } = await slackOAuthService.generateAuthorizationUrl(testUser.id);
      expect(url).toContain('https://slack.com/oauth/v2/authorize');
      expect(url).toContain(state);
      expect(state.length).toBe(48); // 24-byte hex

      // Invalid state parameter should reject
      await expect(
        slackOAuthService.handleCallback('dummy-code', 'invalid-state-token')
      ).rejects.toThrow();
    });

    it('should encrypt and persist Slack bot credentials securely', async () => {
      const dummyBotToken = 'xoxb-dummy-integration-token-987654';
      const dummyWebhook = 'https://hooks.slack.com/services/T000/B000/XXXX';

      const saved = await integrationCredentialRepository.upsertSlackIntegration({
        userId: testUser.id,
        slackTeamId: 'T-PHASE4-TEST',
        slackTeamName: 'ReachInbox Test Workspace',
        botUserId: 'U-BOT-PHASE4',
        botTokenPlain: dummyBotToken,
        incomingWebhookUrlPlain: dummyWebhook,
        defaultChannelId: 'C-ALERTS',
        defaultChannelName: '#outreach-alerts'
      });

      expect(saved.id).toBeDefined();
      expect(saved.isConnected).toBe(true);
      // Verify token in DB is encrypted (not plaintext)
      expect(saved.botTokenEncrypted).not.toBe(dummyBotToken);
      expect(saved.botTokenEncrypted).toContain(':'); // IV:AuthTag:Ciphertext format

      // Verify decrypted token matches original
      const decrypted = integrationCredentialRepository.getDecryptedBotToken(saved);
      expect(decrypted).toBe(dummyBotToken);

      // Disconnect lifecycle
      const disconnected = await integrationCredentialRepository.disconnect(testUser.id, 'T-PHASE4-TEST');
      expect(disconnected.isConnected).toBe(false);
    });
  });

  describe('4. Real Slack Notifications & Atomic Deduplication', () => {
    it('should atomically deduplicate Slack notifications per sender per hour window', async () => {
      const hourWindow = getUtcHourKey();

      // First alert: acquires lock and attempts dispatch
      const res1 = await slackNotificationService.sendRateLimitAlert({
        userId: testUser.id,
        senderId: testSender.id,
        senderEmail: testSender.emailAddress,
        quotaLimit: 3,
        hourWindow,
        deferredCount: 1,
        nextWindowTime: getNextUtcHourStart()
      });

      // Second alert in the same window: must be deduplicated
      const res2 = await slackNotificationService.sendRateLimitAlert({
        userId: testUser.id,
        senderId: testSender.id,
        senderEmail: testSender.emailAddress,
        quotaLimit: 3,
        hourWindow,
        deferredCount: 2,
        nextWindowTime: getNextUtcHourStart()
      });

      expect(res2.delivered).toBe(true);
      expect(res2.deduplicated).toBe(true);
    });

    it('should dispatch a live alert via Slack API when real bot token is available', async () => {
      if (!env.SLACK_BOT_TOKEN) {
        return; // Skip if no live token in test environment
      }

      const alertRes = await slackNotificationService.sendRateLimitAlert({
        userId: testUser.id,
        senderId: 'live-test-sender',
        senderEmail: 'alex.sales@reachinbox.ai',
        quotaLimit: 200,
        hourWindow: `TEST-${Date.now()}`,
        deferredCount: 42,
        nextWindowTime: new Date(Date.now() + 3600000)
      });

      expect(alertRes.delivered).toBe(true);
    }, 15000);
  });
});
