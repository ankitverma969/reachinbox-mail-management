import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, disconnectDatabase } from '../src/shared/database/prisma.client.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import { emailSenderRepository } from '../src/modules/senders/email-sender.repository.js';
import { scheduledEmailRepository } from '../src/modules/email-scheduling/scheduled-email.repository.js';
import { emailDeliveryAttemptRepository } from '../src/modules/email-delivery/email-delivery-attempt.repository.js';
import { EmailJobStatus, DeliveryAttemptStatus } from '@prisma/client';
import { encryptCredential, decryptCredential } from '../src/shared/utils/encryption.util.js';

describe('Phase 2: Relational Persistence Layer & Domain Repositories', () => {
  const testRunId = `test-${Date.now()}`;
  let testUserId: string;
  let testSenderId: string;
  let testJobId: string;

  beforeAll(async () => {
    // Ensure database connection is active
    await prisma.$connect();
  });

  afterAll(async () => {
    // Teardown test data created in this test run
    try {
      if (testJobId) {
        await prisma.emailDeliveryAttempt.deleteMany({ where: { emailJobId: testJobId } });
        await prisma.emailJob.deleteMany({ where: { id: testJobId } });
      }
      if (testSenderId) {
        await prisma.senderIdentity.deleteMany({ where: { id: testSenderId } });
      }
      if (testUserId) {
        await prisma.user.deleteMany({ where: { id: testUserId } });
      }
    } catch {
      // Ignore teardown errors
    } finally {
      await disconnectDatabase();
    }
  });

  describe('Encryption Utility (AES-256-GCM)', () => {
    it('should encrypt and successfully decrypt sensitive credentials', () => {
      const secret = 'super-confidential-password-12345';
      const encrypted = encryptCredential(secret);

      expect(encrypted).not.toBe(secret);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('should throw an error when attempting to decrypt tampered data', () => {
      const secret = 'valid-password';
      const encrypted = encryptCredential(secret);
      const tampered = encrypted.slice(0, -4) + 'abcd';

      expect(() => decryptCredential(tampered)).toThrow();
    });
  });

  describe('User Repository', () => {
    it('should create and retrieve a user via Google OAuth upsert', async () => {
      const user = await userRepository.upsertGoogleUser({
        googleId: `google-${testRunId}`,
        email: `${testRunId}@example.com`,
        name: 'Test Automation User',
        avatarUrl: 'https://example.com/avatar.png'
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(`${testRunId}@example.com`);
      testUserId = user.id;

      const fetched = await userRepository.findById(user.id);
      expect(fetched?.googleId).toBe(`google-${testRunId}`);
    });
  });

  describe('Email Sender Repository', () => {
    it('should create a sender with encrypted password and allow safe decryption', async () => {
      const sender = await emailSenderRepository.create({
        userId: testUserId,
        emailAddress: `sender-${testRunId}@example.com`,
        displayName: 'Test Outreach Identity',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: 587,
        smtpUsername: 'test-user',
        smtpPasswordPlain: 'secret-smtp-password',
        hourlyRateLimit: 150,
        minDelaySeconds: 3
      });

      expect(sender).toBeDefined();
      expect(sender.smtpPasswordEncrypted).not.toBe('secret-smtp-password');
      testSenderId = sender.id;

      // Verify password decryption
      const decryptedPassword = emailSenderRepository.getDecryptedSmtpPassword(sender);
      expect(decryptedPassword).toBe('secret-smtp-password');
    });
  });

  describe('Scheduled Email Repository & Idempotency', () => {
    const idempotencyKey = `idemp-${testRunId}-001`;

    it('should create a scheduled email job with default SCHEDULED status', async () => {
      const job = await scheduledEmailRepository.createSingle({
        senderId: testSenderId,
        recipientEmail: 'lead@targetcompany.io',
        subject: 'Hello Target Company',
        body: '<p>Personalized outreach body</p>',
        scheduledAt: new Date(Date.now() + 60000),
        idempotencyKey
      });

      expect(job).toBeDefined();
      expect(job.status).toBe(EmailJobStatus.SCHEDULED);
      expect(job.idempotencyKey).toBe(idempotencyKey);
      testJobId = job.id;
    });

    it('should enforce unique idempotency constraint and reject duplicates', async () => {
      await expect(
        scheduledEmailRepository.createSingle({
          senderId: testSenderId,
          recipientEmail: 'lead-duplicate@targetcompany.io',
          subject: 'Duplicate Job Attempt',
          body: '<p>Body</p>',
          scheduledAt: new Date(Date.now() + 60000),
          idempotencyKey // Reusing same idempotencyKey
        })
      ).rejects.toThrow();
    });

    it('should reject creating an email job with non-existent foreign key senderId', async () => {
      await expect(
        scheduledEmailRepository.createSingle({
          senderId: '00000000-0000-0000-0000-000000000000',
          recipientEmail: 'orphan@targetcompany.io',
          subject: 'Invalid Sender',
          body: '<p>Body</p>',
          scheduledAt: new Date(),
          idempotencyKey: `orphan-${Date.now()}`
        })
      ).rejects.toThrow();
    });

    it('should atomically claim an email job for processing', async () => {
      // First attempt: should succeed
      const claimedFirst = await scheduledEmailRepository.claimJobForProcessing(testJobId);
      expect(claimedFirst).toBe(true);

      // Verify DB status is now PROCESSING
      const job = await scheduledEmailRepository.findById(testJobId);
      expect(job?.status).toBe(EmailJobStatus.PROCESSING);

      // Second attempt while in PROCESSING: should return false (preventing race condition)
      const claimedSecond = await scheduledEmailRepository.claimJobForProcessing(testJobId);
      expect(claimedSecond).toBe(false);
    });

    it('should transition job status to SENT and record delivery telemetry', async () => {
      const updatedJob = await scheduledEmailRepository.markAsSent(testJobId, {
        smtpMessageId: '<message-id-12345@ethereal.email>',
        etherealPreviewUrl: 'https://ethereal.email/message/test'
      });

      expect(updatedJob.status).toBe(EmailJobStatus.SENT);
      expect(updatedJob.sentAt).toBeDefined();
      expect(updatedJob.etherealPreviewUrl).toBe('https://ethereal.email/message/test');
    });
  });

  describe('Email Delivery Attempt Repository', () => {
    it('should record delivery attempts linked to scheduled email job', async () => {
      const attempt = await emailDeliveryAttemptRepository.recordAttempt({
        emailJobId: testJobId,
        attemptNumber: 1,
        status: DeliveryAttemptStatus.SUCCESS,
        durationMs: 340,
        smtpResponse: '250 2.0.0 OK: message queued',
        smtpMessageId: '<message-id-12345@ethereal.email>'
      });

      expect(attempt).toBeDefined();
      expect(attempt.attemptNumber).toBe(1);
      expect(attempt.status).toBe(DeliveryAttemptStatus.SUCCESS);

      const attempts = await emailDeliveryAttemptRepository.findByJobId(testJobId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.smtpResponse).toBe('250 2.0.0 OK: message queued');
    });
  });

  describe('Transaction Rollback Behavior', () => {
    it('should roll back batch creation if an invalid job fails constraint in transaction', async () => {
      await expect(
        scheduledEmailRepository.createBatchWithJobs(
          {
            userId: testUserId,
            senderId: testSenderId,
            totalLeadsDetected: 2,
            scheduledStartTime: new Date()
          },
          [
            {
              senderId: testSenderId,
              recipientEmail: 'valid@example.com',
              subject: 'Valid',
              body: 'Body',
              scheduledAt: new Date(),
              idempotencyKey: `tx-valid-${testRunId}`
            },
            {
              // Invalid non-existent senderId triggers foreign key violation
              senderId: '00000000-0000-0000-0000-000000000000',
              recipientEmail: 'invalid@example.com',
              subject: 'Invalid',
              body: 'Body',
              scheduledAt: new Date(),
              idempotencyKey: `tx-invalid-${testRunId}`
            }
          ]
        )
      ).rejects.toThrow();

      // Verify the first valid job was NOT committed (rolled back)
      const orphanJob = await scheduledEmailRepository.findByIdempotencyKey(`tx-valid-${testRunId}`);
      expect(orphanJob).toBeNull();
    });
  });
});
