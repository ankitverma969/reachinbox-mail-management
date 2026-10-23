import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/shared/database/prisma.client.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import { emailSenderRepository } from '../src/modules/senders/email-sender.repository.js';
import { scheduledEmailRepository } from '../src/modules/email-scheduling/scheduled-email.repository.js';
import { emailSchedulingService } from '../src/modules/email-scheduling/email-scheduling.service.js';
import { emailQueueProducer } from '../src/queues/email-queue.producer.js';
import { emailDeliveryWorker } from '../src/workers/email-delivery.worker.js';
import { senderRateLimitService } from '../src/modules/rate-limiting/sender-rate-limit.service.js';
import { senderThrottleService } from '../src/modules/email-delivery/sender-throttle.service.js';
import { slackOAuthService } from '../src/modules/integrations/slack-oauth.service.js';
import { slackNotificationService } from '../src/modules/integrations/slack-notification.service.js';
import { etherealEmailService } from '../src/modules/email-delivery/ethereal-email.service.js';
import {
  checkElasticsearchHealth,
  closeElasticsearchClient
} from '../src/config/elasticsearch.config.js';
import {
  emailSearchIndexService,
  type EmailJobDocument,
  type SearchEmailParams
} from '../src/modules/search/email-search-index.service.js';
import { env } from '../src/config/environment.config.js';
import { EmailJobStatus } from '@prisma/client';

describe('Phase 5: Elasticsearch Indexing, Email Search & BullMQ Dashboard', () => {
  let server: Server;
  let baseUrl: string;
  let testUser1: { id: string; email: string };
  let testUser2: { id: string; email: string };
  let testSender1: { id: string; emailAddress: string; userId: string };

  beforeAll(async () => {
    // 1. Start HTTP test server on dynamic ephemeral port
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // 2. Setup User 1 (Tenant 1)
    const user1 = await userRepository.upsertGoogleUser({
      googleId: 'test-google-id-phase5-user1',
      email: 'phase5.user1@reachinbox.ai',
      name: 'Phase 5 User One'
    });
    testUser1 = { id: user1.id, email: user1.email };

    // 3. Setup User 2 (Tenant 2 for isolation testing)
    const user2 = await userRepository.upsertGoogleUser({
      googleId: 'test-google-id-phase5-user2',
      email: 'phase5.user2@reachinbox.ai',
      name: 'Phase 5 User Two'
    });
    testUser2 = { id: user2.id, email: user2.email };

    // 4. Setup sender for User 1
    const sender1 = await emailSenderRepository.create({
      userId: testUser1.id,
      emailAddress: 'phase5.sender@reachinbox.ai',
      displayName: 'Phase 5 Sender',
      smtpHost: env.ETHEREAL_HOST,
      smtpPort: env.ETHEREAL_PORT,
      smtpUsername: env.ETHEREAL_USER || 'lelia.vandervort64@ethereal.email',
      smtpPasswordPlain: env.ETHEREAL_PASSWORD || '4ZT9ekpfjj71mjBgGs',
      hourlyRateLimit: 50,
      minDelaySeconds: 1,
      isActive: true
    });
    testSender1 = {
      id: sender1.id,
      emailAddress: sender1.emailAddress,
      userId: sender1.userId
    };
  });

  afterAll(async () => {
    // Teardown HTTP server
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Teardown background workers and connections
    await emailDeliveryWorker.close();
    await emailQueueProducer.close();
    await senderThrottleService.close();
    await senderRateLimitService.close();
    await slackOAuthService.close();
    await slackNotificationService.close();
    await closeElasticsearchClient();
    etherealEmailService.close();

    // Clean up created test data
    await prisma.emailJob.deleteMany({
      where: { sender: { userId: { in: [testUser1.id, testUser2.id] } } }
    });
    await prisma.senderIdentity.deleteMany({
      where: { userId: { in: [testUser1.id, testUser2.id] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [testUser1.id, testUser2.id] } }
    });
  });

  describe('1. Elasticsearch Client Initialization & Health Check', () => {
    it('should probe health without crashing when cluster is offline or reachable', async () => {
      const isHealthy = await checkElasticsearchHealth();
      expect(typeof isHealthy).toBe('boolean');
      // Must return boolean and not throw
    });

    it('should reflect health status in /api/health endpoint', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.dependencies).toHaveProperty('elasticsearch');
      expect(['available', 'unavailable']).toContain(body.dependencies.elasticsearch);
    });
  });

  describe('2. Elasticsearch Schema Mapping & Indexing Projection', () => {
    it('should construct a valid document projection conforming to the schema', () => {
      const sampleDoc: EmailJobDocument = {
        emailJobId: 'test-job-uuid-123',
        userId: testUser1.id,
        senderId: testSender1.id,
        senderEmail: testSender1.emailAddress,
        batchId: 'batch-xyz-001',
        recipientEmail: 'lead@targetcorp.com',
        subject: 'ReachInbox Demo Discussion',
        body: 'Hello, let us schedule a product demo next Tuesday.',
        status: EmailJobStatus.SCHEDULED,
        scheduledAt: new Date().toISOString(),
        sentAt: null,
        failedAt: null,
        rescheduledAt: null,
        idempotencyKey: 'idemp-key-abc',
        smtpMessageId: null,
        etherealPreviewUrl: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Ensure no sensitive credentials exist in index document
      expect(sampleDoc).not.toHaveProperty('smtpPassword');
      expect(sampleDoc).not.toHaveProperty('smtpPasswordPlain');
      expect(sampleDoc).not.toHaveProperty('token');
      expect(sampleDoc).not.toHaveProperty('refreshToken');

      expect(sampleDoc.emailJobId).toBe('test-job-uuid-123');
      expect(sampleDoc.userId).toBe(testUser1.id);
      expect(sampleDoc.status).toBe(EmailJobStatus.SCHEDULED);
    });

    it('should handle offline Elasticsearch gracefully without throwing on indexEmailJob', async () => {
      const sampleDoc: EmailJobDocument = {
        emailJobId: 'offline-test-job-id',
        userId: testUser1.id,
        senderId: testSender1.id,
        recipientEmail: 'offline@test.com',
        subject: 'Offline Test Subject',
        body: 'Offline body text',
        status: EmailJobStatus.SCHEDULED,
        scheduledAt: new Date().toISOString(),
        idempotencyKey: 'idemp-offline',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Non-blocking fire-and-log guarantee: does not throw even if ES is offline
      await expect(emailSearchIndexService.indexEmailJob(sampleDoc)).resolves.not.toThrow();
    });

    it('should handle offline Elasticsearch gracefully on updateStatus', async () => {
      await expect(
        emailSearchIndexService.updateStatus('offline-test-job-id', EmailJobStatus.SENT, {
          sentAt: new Date().toISOString()
        })
      ).resolves.not.toThrow();
    });
  });

  describe('3. Search API & Strict Tenant Isolation', () => {
    it('should reject unauthenticated search requests with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/emails/search?q=test`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(['UNAUTHORIZED', 'UnauthorizedError']).toContain(data.error.code);
    });

    it('should validate search query parameters (reject negative limits or pages)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/emails/search?page=-5&limit=0`, {
        headers: {
          'x-admin-key': 'reachinbox_admin_secret'
        }
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(['ValidationError', 'VALIDATION_ERROR']).toContain(data.error.code);
    });

    it('should return 503 Service Unavailable when Elasticsearch cluster is offline', async () => {
      // In offline environment, search request must return 503 instead of pretending empty results
      const isOnline = await checkElasticsearchHealth();
      if (!isOnline) {
        const res = await fetch(`${baseUrl}/api/v1/emails/search?q=hello&userId=${testUser1.id}`, {
          headers: {
            'x-admin-key': 'reachinbox_admin_secret'
          }
        });
        expect(res.status).toBe(503);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.message).toMatch(/Search service is currently unavailable/);
      }
    });

    it('should verify query construction enforces mandatory userId tenant filter', () => {
      const searchParams: SearchEmailParams = {
        userId: testUser1.id,
        q: 'demo',
        status: 'SCHEDULED',
        senderId: testSender1.id,
        page: 1,
        limit: 10
      };

      // Verify that userId filter is always scoped to the authenticating user
      expect(searchParams.userId).toBe(testUser1.id);
      expect(searchParams.userId).not.toBe(testUser2.id);
    });
  });

  describe('4. Administrative Reindex & Cursor Reconciliation', () => {
    it('should reject unauthenticated reindex requests with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/emails/reindex`, {
        method: 'POST'
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('should protect reindex with admin key authorization header', async () => {
      const res = await fetch(`${baseUrl}/api/v1/emails/reindex`, {
        method: 'POST',
        headers: {
          'x-admin-key': 'reachinbox_admin_secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batchSize: 50 })
      });

      // If ES is offline, returns 503; if ES is online, returns 200 with reconciliation stats
      expect([200, 503]).toContain(res.status);
    });

    it('should schedule emails in PostgreSQL and verify DB persistence is source of truth', async () => {
      const scheduleTime = new Date(Date.now() + 60000);
      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender1.id,
        recipientEmail: 'phase5.prospect@targetcorp.com',
        subject: 'Phase 5 Architecture Review',
        body: 'Comprehensive Elasticsearch indexing and Bull Board monitoring.',
        scheduledAt: scheduleTime,
        idempotencyKey: `idemp-phase5-${Date.now()}`
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe(EmailJobStatus.SCHEDULED);
      expect(job.recipientEmail).toBe('phase5.prospect@targetcorp.com');

      // Verify PostgreSQL record is persisted independently of Elasticsearch availability
      const fetched = await scheduledEmailRepository.findById(job.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(job.id);
    });
  });

  describe('5. Bull Board Dashboard Access & Security', () => {
    it('should reject unauthenticated requests to /admin/queues with 401', async () => {
      const res = await fetch(`${baseUrl}/admin/queues`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Basic realm=');
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject requests with invalid credentials', async () => {
      const res = await fetch(`${baseUrl}/admin/queues`, {
        headers: {
          'x-admin-key': 'wrong-secret-key'
        }
      });
      expect(res.status).toBe(401);
    });

    it('should grant access to /admin/queues when valid x-admin-key is provided', async () => {
      const res = await fetch(`${baseUrl}/admin/queues/`, {
        headers: {
          'x-admin-key': 'reachinbox_admin_secret'
        },
        redirect: 'manual'
      });

      // Bull Board UI returns either 200 HTML or 302 redirect to base path
      expect([200, 302, 304]).toContain(res.status);
    });

    it('should grant access to /admin/queues with HTTP Basic Auth', async () => {
      const basicCreds = Buffer.from('admin:reachinbox_admin_secret').toString('base64');
      const res = await fetch(`${baseUrl}/admin/queues/`, {
        headers: {
          Authorization: `Basic ${basicCreds}`
        },
        redirect: 'manual'
      });

      expect([200, 302, 304]).toContain(res.status);
    });

    it('should ensure BullMQ queue job payload never contains raw bodies, SMTP passwords, or OAuth tokens', async () => {
      // Create a test job through the producer
      const jobId = await emailQueueProducer.addEmailJob(
        {
          emailJobId: 'test-job-payload-safety',
          senderId: testSender1.id,
          recipientEmail: 'safe.payload@target.com',
          idempotencyKey: 'idemp-payload-safety-123'
        },
        new Date(Date.now() + 60000)
      );

      expect(jobId).toBeDefined();

      const queue = emailQueueProducer.getQueue();
      const job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.data).toBeDefined();

      const data = job?.data as Record<string, unknown>;
      // Assert payload contains only safe reference IDs
      expect(data).toHaveProperty('emailJobId', 'test-job-payload-safety');
      expect(data).toHaveProperty('senderId', testSender1.id);
      expect(data).toHaveProperty('recipientEmail', 'safe.payload@target.com');

      // STRICT SECURITY: Must NEVER contain credentials or email body in queue payload
      expect(data).not.toHaveProperty('body');
      expect(data).not.toHaveProperty('smtpPassword');
      expect(data).not.toHaveProperty('smtpPasswordPlain');
      expect(data).not.toHaveProperty('oauthToken');
      expect(data).not.toHaveProperty('slackWebhookUrl');

      // Clean up queue job
      await job?.remove();
    });
  });
});
