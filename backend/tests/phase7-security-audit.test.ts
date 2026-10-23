import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../src/app.js';
import { env } from '../src/config/environment.config.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import jwt from 'jsonwebtoken';

import { resetAdminFailureTracking } from '../src/middleware/admin-auth.middleware.js';

describe('Phase 7: Critical Security Audit & Hardening Suite', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    resetAdminFailureTracking();
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
  });

  afterAll(async () => {
    resetAdminFailureTracking();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('1. Developer Login Production Guardrails', () => {
    it('should reject dev-login if NODE_ENV is production or ENABLE_DEV_LOGIN is false', async () => {
      const originalNodeEnv = env.NODE_ENV;
      const originalFlag = env.ENABLE_DEV_LOGIN;

      try {
        (env as { NODE_ENV: string }).NODE_ENV = 'production';

        const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'evaluator@reachinbox.test' })
        });

        const body = (await res.json()) as { success: boolean; error: { code: string } };
        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DEV_LOGIN_DISABLED');
      } finally {
        (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
        (env as { ENABLE_DEV_LOGIN: string }).ENABLE_DEV_LOGIN = originalFlag;
      }
    });

    it('should reject malformed or invalid email in dev-login', async () => {
      if (env.ENABLE_DEV_LOGIN !== 'true') return;

      const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail' })
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });
  });

  describe('2. Admin Authentication & Rate Limiting', () => {
    it('should reject unauthorized access to /admin/queues without credentials', async () => {
      const res = await fetch(`${baseUrl}/admin/queues`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Basic realm');
    });

    it('should reject incorrect admin password', async () => {
      const wrongCredentials = Buffer.from('admin:wrong_password_123').toString('base64');
      const res = await fetch(`${baseUrl}/admin/queues`, {
        headers: {
          Authorization: `Basic ${wrongCredentials}`
        }
      });

      expect(res.status).toBe(401);
    });

    it('should authenticate with dedicated ADMIN_API_KEY header', async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/reindex`, {
        headers: {
          'x-admin-key': env.ADMIN_API_KEY
        }
      });

      // It should pass auth and return 200 or 503 if ES offline, but NOT 401
      expect(res.status).not.toBe(401);
    });

    it('should rate-limit brute force admin attacks after 5 consecutive failures', async () => {
      const attackerIp = '198.51.100.99';
      const wrongCreds = Buffer.from('admin:bruteforce_attempt').toString('base64');

      let lastStatus = 401;
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/admin/queues`, {
          headers: {
            'X-Forwarded-For': attackerIp,
            Authorization: `Basic ${wrongCreds}`
          }
        });
        lastStatus = res.status;
      }

      // After 5 attempts, should return 429 Too Many Requests
      expect(lastStatus).toBe(429);
    });
  });

  describe('3. Multi-Tenant Isolation & Ownership Enforcements', () => {
    it('should prevent User A from canceling User B scheduled email', async () => {
      // 1. Create User A and User B
      const userA = await userRepository.upsertGoogleUser({
        googleId: 'test-google-user-a-p7',
        email: 'tenant.alpha.p7@test.reachinbox.ai',
        name: 'User Alpha'
      });

      const userB = await userRepository.upsertGoogleUser({
        googleId: 'test-google-user-b-p7',
        email: 'tenant.beta.p7@test.reachinbox.ai',
        name: 'User Beta'
      });

      const tokenA = jwt.sign(
        { userId: userA.id, email: userA.email, name: userA.name, role: 'user' },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const tokenB = jwt.sign(
        { userId: userB.id, email: userB.email, name: userB.name, role: 'user' },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // 2. User B provisions sender and schedules email
      const senderBRes = await fetch(`${baseUrl}/api/v1/senders`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      const senderBData = (await senderBRes.json()) as { data: Array<{ id: string }> };
      const senderB = senderBData.data[0];

      const scheduleRes = await fetch(`${baseUrl}/api/v1/emails/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenB}`
        },
        body: JSON.stringify({
          senderId: senderB.id,
          subject: 'Confidential Beta Outreach P7',
          body: 'This belongs to User B',
          recipients: ['target@customer.com'],
          scheduledAt: new Date(Date.now() + 3600000).toISOString()
        })
      });

      expect(scheduleRes.status).toBe(201);

      // Fetch User B scheduled emails to get exact job ID
      const listBRes = await fetch(`${baseUrl}/api/v1/emails/scheduled`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      const listBData = (await listBRes.json()) as { data: Array<{ id: string; subject: string }> };
      const jobB = listBData.data.find((j) => j.subject === 'Confidential Beta Outreach P7');
      expect(jobB).toBeDefined();

      // 3. User A attempts to CANCEL User B's email
      const maliciousCancelRes = await fetch(`${baseUrl}/api/v1/emails/scheduled/${jobB?.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA}` }
      });

      expect(maliciousCancelRes.status).toBe(403);
      const cancelBody = (await maliciousCancelRes.json()) as { success: boolean };
      expect(cancelBody.success).toBe(false);

      // 4. User A attempts to SEARCH and should not see User B's record (or 503 if ES offline)
      const searchARes = await fetch(`${baseUrl}/api/v1/emails/search?q=Confidential`, {
        headers: { Authorization: `Bearer ${tokenA}` }
      });

      if (searchARes.status === 200) {
        const searchAData = (await searchARes.json()) as { data: Array<{ id: string }> };
        expect(searchAData.data.length).toBe(0);
      } else {
        expect(searchARes.status).toBe(503);
      }
    });
  });

  describe('4. Credential Masking & Secrets Sanitization', () => {
    it('should mask SMTP passwords in all sender identity endpoints', async () => {
      const user = await userRepository.upsertGoogleUser({
        googleId: 'test-google-mask-user-p7',
        email: 'mask.check.p7@test.reachinbox.ai',
        name: 'Mask Test User'
      });

      const token = jwt.sign(
        { userId: user.id, email: user.email, name: user.name, role: 'user' },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Create new sender with raw password
      const createRes = await fetch(`${baseUrl}/api/v1/senders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          emailAddress: 'outreach.p7@sales-domain.test',
          displayName: 'Outreach Team',
          smtpHost: 'smtp.mailgun.org',
          smtpPort: 587,
          smtpUsername: 'outreach.p7@sales-domain.test',
          smtpPasswordPlain: 'SuperSecretSmtpPassword123!',
          hourlyRateLimit: 50,
          minDelaySeconds: 2
        })
      });

      expect(createRes.status).toBe(201);
      const createData = (await createRes.json()) as { data: { smtpPasswordMasked: string } };
      expect(createData.data.smtpPasswordMasked).toBe('••••••••');
      expect(JSON.stringify(createData)).not.toContain('SuperSecretSmtpPassword123!');

      // Check listing endpoint
      const listRes = await fetch(`${baseUrl}/api/v1/senders`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as { data: Array<{ emailAddress: string; smtpPasswordMasked: string }> };
      const found = listData.data.find((s) => s.emailAddress === 'outreach.p7@sales-domain.test');
      expect(found).toBeDefined();
      expect(found?.smtpPasswordMasked).toBe('••••••••');
      expect(JSON.stringify(listData)).not.toContain('SuperSecretSmtpPassword123!');
    });
  });
});
