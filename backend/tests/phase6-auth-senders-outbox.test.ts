import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/shared/database/prisma.client.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import { emailSenderRepository } from '../src/modules/senders/email-sender.repository.js';
import { indexingOutboxService } from '../src/modules/search/indexing-outbox.service.js';
import { env } from '../src/config/environment.config.js';
import { OutboxEventType, OutboxStatus } from '@prisma/client';

describe('Phase 6: Auth, Sender Configuration & Transactional Outbox', () => {
  let server: Server;
  let baseUrl: string;
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let userAToken: string;
  let userBToken: string;
  let senderAId: string;

  beforeAll(async () => {
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

    // 1. Setup User A
    const uA = await userRepository.upsertGoogleUser({
      googleId: 'test-google-user-a',
      email: 'user.a.phase6@reachinbox.ai',
      name: 'User Alpha',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alpha'
    });
    userA = { id: uA.id, email: uA.email };

    // 2. Setup User B
    const uB = await userRepository.upsertGoogleUser({
      googleId: 'test-google-user-b',
      email: 'user.b.phase6@reachinbox.ai',
      name: 'User Beta',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Beta'
    });
    userB = { id: uB.id, email: uB.email };
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    await prisma.indexingOutbox.deleteMany({
      where: { emailJobId: { in: ['test-outbox-job-1', 'test-outbox-job-2'] } }
    });
    await prisma.emailJob.deleteMany({
      where: { sender: { userId: { in: [userA.id, userB.id] } } }
    });
    await prisma.senderIdentity.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } }
    });
  });

  describe('1. Authentication Endpoints', () => {
    it('should issue a session token and user profile via dev-login', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userA.email, name: 'User Alpha' })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.token).toBeDefined();
      expect(data.data.user.email).toBe(userA.email);
      userAToken = data.data.token;

      // Extract set-cookie header
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('reachinbox_token=');
      expect(setCookie).toContain('HttpOnly');
    });

    it('should log in User B and issue distinct token', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userB.email, name: 'User Beta' })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      userBToken = data.data.token;
      expect(userBToken).not.toBe(userAToken);
    });

    it('should retrieve current user profile from /api/v1/auth/me with Bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.email).toBe(userA.email);
      expect(data.data.name).toBe('User Alpha');
    });

    it('should reject unauthenticated requests to /api/v1/auth/me with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/me`);
      expect(res.status).toBe(401);
    });

    it('should clear authentication cookie on logout', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST'
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeDefined();
    });
  });

  describe('2. Sender Management & Tenant Isolation', () => {
    it('should automatically provision an Ethereal sender if user has none', async () => {
      const res = await fetch(`${baseUrl}/api/v1/senders`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(1);

      const sender = data.data[0];
      senderAId = sender.id;
      expect(sender.smtpPasswordMasked).toBe('••••••••');
      expect(sender).not.toHaveProperty('smtpPasswordEncrypted');
      expect(sender).not.toHaveProperty('smtpPasswordPlain');
    });

    it('should allow User A to create a custom sender identity', async () => {
      const res = await fetch(`${baseUrl}/api/v1/senders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          emailAddress: 'custom.outreach@reachinbox.ai',
          displayName: 'Alpha Custom',
          smtpHost: env.ETHEREAL_HOST,
          smtpPort: env.ETHEREAL_PORT,
          smtpUsername: 'alpha.custom@ethereal.email',
          smtpPasswordPlain: 'AlphaPass123!',
          hourlyRateLimit: 150,
          minDelaySeconds: 3
        })
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.emailAddress).toBe('custom.outreach@reachinbox.ai');
      expect(data.data.hourlyRateLimit).toBe(150);
      expect(data.data.smtpPasswordMasked).toBe('••••••••');
    });

    it('should reject User B trying to modify User A sender (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/senders/${senderAId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${userBToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hourlyRateLimit: 50 })
      });

      expect(res.status).toBe(403);
    });

    it('should allow User A to modify their own sender', async () => {
      const res = await fetch(`${baseUrl}/api/v1/senders/${senderAId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hourlyRateLimit: 350 })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.hourlyRateLimit).toBe(350);
    });
  });

  describe('3. Transactional Outbox for Elasticsearch', () => {
    it('should persist an INDEX_JOB outbox record in PENDING state', async () => {
      const outbox = await indexingOutboxService.recordIndexJob('test-outbox-job-1', {
        emailJobId: 'test-outbox-job-1',
        userId: userA.id,
        senderId: senderAId,
        recipientEmail: 'lead@test.com',
        subject: 'Outbox Test Email',
        body: 'Outbox verification',
        status: 'SCHEDULED',
        scheduledAt: new Date().toISOString(),
        idempotencyKey: 'idemp-outbox-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      expect(outbox.id).toBeDefined();
      expect(outbox.eventType).toBe(OutboxEventType.INDEX_JOB);
      expect(outbox.status).toBe(OutboxStatus.PENDING);
    });

    it('should persist an UPDATE_STATUS outbox record in PENDING state', async () => {
      const outbox = await indexingOutboxService.recordStatusUpdate('test-outbox-job-2', {
        status: 'SENT',
        sentAt: new Date().toISOString()
      });

      expect(outbox.id).toBeDefined();
      expect(outbox.eventType).toBe(OutboxEventType.UPDATE_STATUS);
      expect(outbox.status).toBe(OutboxStatus.PENDING);
    });

    it('should attempt draining outbox batch without crashing', async () => {
      const result = await indexingOutboxService.drainOutboxBatch(10);
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('failed');
      expect(typeof result.processed).toBe('number');
      expect(typeof result.failed).toBe('number');
    });
  });
});
