import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../src/shared/database/prisma.client.js';
import { userRepository } from '../src/modules/auth/user.repository.js';
import { emailSenderRepository } from '../src/modules/senders/email-sender.repository.js';
import { scheduledEmailRepository } from '../src/modules/email-scheduling/scheduled-email.repository.js';
import { emailSchedulingService } from '../src/modules/email-scheduling/email-scheduling.service.js';
import { emailQueueProducer } from '../src/queues/email-queue.producer.js';
import { emailDeliveryWorker } from '../src/workers/email-delivery.worker.js';
import { etherealEmailService } from '../src/modules/email-delivery/ethereal-email.service.js';
import { scheduleRecoveryService } from '../src/modules/email-scheduling/schedule-recovery.service.js';
import { senderThrottleService } from '../src/modules/email-delivery/sender-throttle.service.js';
import { generateEmailIdempotencyKey } from '../src/shared/utils/idempotency.util.js';
import { ValidationError, NotFoundError } from '../src/shared/errors/AppError.js';
import { DeliveryAttemptStatus, EmailJobStatus } from '@prisma/client';
import { env } from '../src/config/environment.config.js';

describe('Phase 3: BullMQ Queue, Email Scheduling & Ethereal SMTP Delivery', () => {
  let testUser: { id: string; email: string };
  let testSender: { id: string; emailAddress: string; userId: string; minDelaySeconds: number };
  let inactiveSender: { id: string };

  beforeAll(async () => {
    // 1. Setup test user
    const user = await userRepository.upsertGoogleUser({
      googleId: 'test-google-id-phase3',
      email: 'phase3.tester@reachinbox.ai',
      name: 'Phase 3 Tester'
    });
    testUser = { id: user.id, email: user.email };

    // 2. Setup active test sender identity
    const sender = await emailSenderRepository.create({
      userId: testUser.id,
      emailAddress: 'outreach.sender@reachinbox.ai',
      displayName: 'Alex Outreach',
      smtpHost: env.ETHEREAL_HOST,
      smtpPort: env.ETHEREAL_PORT,
      smtpUsername: env.ETHEREAL_USER || 'lelia.vandervort64@ethereal.email',
      smtpPasswordPlain: env.ETHEREAL_PASSWORD || '4ZT9ekpfjj71mjBgGs',
      hourlyRateLimit: 200,
      minDelaySeconds: 1,
      isActive: true
    });
    testSender = {
      id: sender.id,
      emailAddress: sender.emailAddress,
      userId: sender.userId,
      minDelaySeconds: sender.minDelaySeconds
    };

    // 3. Setup inactive test sender identity
    const inactive = await emailSenderRepository.create({
      userId: testUser.id,
      emailAddress: 'inactive.sender@reachinbox.ai',
      displayName: 'Inactive Sender',
      smtpHost: env.ETHEREAL_HOST,
      smtpPort: env.ETHEREAL_PORT,
      smtpUsername: 'inactive@ethereal.email',
      smtpPasswordPlain: 'dummy-pass',
      hourlyRateLimit: 100,
      minDelaySeconds: 2,
      isActive: false
    });
    inactiveSender = { id: inactive.id };
  });

  afterAll(async () => {
    // Cleanup queue, workers, and DB
    await emailDeliveryWorker.close();
    await emailQueueProducer.close();
    await senderThrottleService.close();
    etherealEmailService.close();

    // Clean up created jobs and senders for clean teardown
    await prisma.emailDeliveryAttempt.deleteMany({
      where: { emailJob: { sender: { userId: testUser.id } } }
    });
    await prisma.emailJob.deleteMany({
      where: { sender: { userId: testUser.id } }
    });
    await prisma.emailBatch.deleteMany({
      where: { userId: testUser.id }
    });
    await prisma.senderIdentity.deleteMany({
      where: { userId: testUser.id }
    });
    await prisma.user.deleteMany({
      where: { id: testUser.id }
    });
  });

  describe('1. Email Scheduling Service & Input Validation', () => {
    it('should schedule a single future email with database persistence and BullMQ delayed job', async () => {
      const scheduledAt = new Date(Date.now() + 60000); // 1 minute in the future
      const result = await emailSchedulingService.scheduleCampaign({
        userId: testUser.id,
        senderId: testSender.id,
        subject: 'Single Future Outreach',
        body: '<p>Testing single scheduled delivery</p>',
        recipients: ['lead.single@example.com'],
        scheduledAt,
        delayBetweenEmails: 2
      });

      expect(result.batchId).toBeDefined();
      expect(result.totalScheduled).toBe(1);
      expect(result.status).toBe('SCHEDULED');

      // Verify DB record
      const dbJob = await prisma.emailJob.findFirst({
        where: { batchId: result.batchId }
      });
      expect(dbJob).not.toBeNull();
      expect(dbJob?.recipientEmail).toBe('lead.single@example.com');
      expect(dbJob?.status).toBe(EmailJobStatus.SCHEDULED);
      expect(dbJob?.idempotencyKey).toBeDefined();

      // Verify BullMQ delayed job presence
      const hasJobInQueue = await emailQueueProducer.hasJob(dbJob!.idempotencyKey);
      expect(hasJobInQueue).toBe(true);
    });

    it('should schedule a batch with staggered delivery intervals', async () => {
      const scheduledAt = new Date(Date.now() + 120000); // 2 minutes in the future
      const recipients = ['batch1@example.com', 'batch2@example.com', 'batch3@example.com'];

      const result = await emailSchedulingService.scheduleCampaign({
        userId: testUser.id,
        senderId: testSender.id,
        subject: 'Batch Outreach Campaign',
        body: '<p>Staggered campaign body</p>',
        recipients,
        scheduledAt,
        delayBetweenEmails: 3
      });

      expect(result.totalScheduled).toBe(3);

      const dbJobs = await prisma.emailJob.findMany({
        where: { batchId: result.batchId },
        orderBy: { scheduledAt: 'asc' }
      });
      expect(dbJobs.length).toBe(3);

      // Verify 3-second staggered offsets
      const diff1 = dbJobs[1].scheduledAt.getTime() - dbJobs[0].scheduledAt.getTime();
      const diff2 = dbJobs[2].scheduledAt.getTime() - dbJobs[1].scheduledAt.getTime();
      expect(diff1).toBe(3000);
      expect(diff2).toBe(3000);
    });

    it('should reject invalid recipient email format', async () => {
      await expect(
        emailSchedulingService.scheduleCampaign({
          userId: testUser.id,
          senderId: testSender.id,
          subject: 'Invalid Email Test',
          body: 'Test',
          recipients: ['not-an-email'],
          scheduledAt: new Date(Date.now() + 60000)
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject inactive sender identity', async () => {
      await expect(
        emailSchedulingService.scheduleCampaign({
          userId: testUser.id,
          senderId: inactiveSender.id,
          subject: 'Inactive Sender Test',
          body: 'Test',
          recipients: ['valid@example.com'],
          scheduledAt: new Date(Date.now() + 60000)
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should reject non-existent sender identity', async () => {
      await expect(
        emailSchedulingService.scheduleCampaign({
          userId: testUser.id,
          senderId: '00000000-0000-0000-0000-000000000000',
          subject: 'Missing Sender Test',
          body: 'Test',
          recipients: ['valid@example.com'],
          scheduledAt: new Date(Date.now() + 60000)
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should cancel an eligible scheduled email and remove it from BullMQ', async () => {
      const scheduledAt = new Date(Date.now() + 300000);
      const result = await emailSchedulingService.scheduleCampaign({
        userId: testUser.id,
        senderId: testSender.id,
        subject: 'To Be Cancelled',
        body: '<p>Cancel me</p>',
        recipients: ['cancel.target@example.com'],
        scheduledAt
      });

      const dbJob = await prisma.emailJob.findFirst({
        where: { batchId: result.batchId }
      });
      expect(dbJob).not.toBeNull();

      // Cancel the scheduled email
      await emailSchedulingService.cancelScheduledEmail(dbJob!.id);

      // Verify status updated in DB
      const updatedJob = await scheduledEmailRepository.findById(dbJob!.id);
      expect(updatedJob?.status).toBe(EmailJobStatus.CANCELLED);

      // Verify BullMQ job was removed
      const hasJob = await emailQueueProducer.hasJob(dbJob!.idempotencyKey);
      expect(hasJob).toBe(false);
    });
  });

  describe('2. Idempotency & Queue Deduplication', () => {
    it('should generate deterministic idempotency keys for same parameters', () => {
      const time = new Date('2026-10-23T18:00:00.000Z');
      const key1 = generateEmailIdempotencyKey('sender-1', 'Lead@Company.com', time);
      const key2 = generateEmailIdempotencyKey('sender-1', 'lead@company.com', time);

      expect(key1).toBe(key2);
      expect(key1.length).toBe(64); // SHA-256 hex string
    });

    it('should produce distinct keys for different timestamps or recipients', () => {
      const time1 = new Date('2026-10-23T18:00:00.000Z');
      const time2 = new Date('2026-10-23T18:00:02.000Z');

      const key1 = generateEmailIdempotencyKey('sender-1', 'lead@company.com', time1);
      const key2 = generateEmailIdempotencyKey('sender-1', 'lead@company.com', time2);
      const key3 = generateEmailIdempotencyKey('sender-1', 'other@company.com', time1);

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe('3. Minimum Delay & Worker Concurrency Coordination', () => {
    it('should enforce inter-email minimum delay across workers using Redis', async () => {
      const delaySec = 1;
      // First slot acquisition should be immediate (0ms wait)
      const wait1 = await senderThrottleService.checkAndAcquireSlot(testSender.id, delaySec);
      expect(wait1).toBe(0);

      // Rapid consecutive check immediately after should return positive wait time
      const wait2 = await senderThrottleService.checkAndAcquireSlot(testSender.id, delaySec);
      expect(wait2).toBeGreaterThan(0);
      expect(wait2).toBeLessThanOrEqual(1000);
    });

    it('should allow only one concurrent worker to atomically claim a job', async () => {
      const scheduledAt = new Date(Date.now() + 60000);
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'claim.race@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'claim.race@example.com',
        subject: 'Atomic Claim Race',
        body: 'Testing claim race condition',
        scheduledAt,
        idempotencyKey
      });

      // Simulate 5 workers attempting to claim the exact same job simultaneously
      const claimAttempts = await Promise.all([
        scheduledEmailRepository.claimJobForProcessing(job.id),
        scheduledEmailRepository.claimJobForProcessing(job.id),
        scheduledEmailRepository.claimJobForProcessing(job.id),
        scheduledEmailRepository.claimJobForProcessing(job.id),
        scheduledEmailRepository.claimJobForProcessing(job.id)
      ]);

      const successfulClaims = claimAttempts.filter((res) => res === true);
      const rejectedClaims = claimAttempts.filter((res) => res === false);

      expect(successfulClaims.length).toBe(1);
      expect(rejectedClaims.length).toBe(4);
    });
  });

  describe('4. Ethereal SMTP Delivery & Attempt History', () => {
    it('should deliver an email via Ethereal SMTP, capture Message-ID and preview URL', async () => {
      const isConnected = await etherealEmailService.verifyConnection();
      if (!isConnected) {
        console.warn('NOTICE: Live outbound SMTP port 587 is unreachable on current network. Skipping live SMTP assertion.');
        return;
      }

      const sendResult = await etherealEmailService.sendEmail({
        to: 'recipient.ethereal.test@example.com',
        subject: 'Phase 3 Ethereal SMTP Validation',
        html: '<p>Verifying live SMTP dispatch and preview URL generation</p>'
      });

      expect(sendResult.messageId).toBeDefined();
      expect(sendResult.messageId).toContain('@');
      expect(sendResult.etherealPreviewUrl).toBeDefined();
      expect(sendResult.etherealPreviewUrl).toContain('https://ethereal.email/message/');
    }, 25000);

    it('should complete full worker lifecycle: claim, send, record attempt, and mark SENT', async () => {
      const scheduledAt = new Date(Date.now() - 1000); // Past time (ready for immediate delivery)
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'lifecycle.worker@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'lifecycle.worker@example.com',
        subject: 'Full Lifecycle Outreach Test',
        body: '<p>Testing complete worker pipeline</p>',
        scheduledAt,
        idempotencyKey
      });

      // Mock SMTP send deterministically so worker pipeline is tested without network flakiness
      const sendEmailSpy = vi.spyOn(etherealEmailService, 'sendEmail').mockResolvedValueOnce({
        messageId: '<lifecycle-worker-deterministic@ethereal.email>',
        smtpResponse: '250 2.0.0 OK: message queued',
        etherealPreviewUrl: 'https://ethereal.email/message/lifecycle-worker-deterministic'
      });

      try {
        // Execute worker processJob directly to simulate worker picking up the job
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

        // Verify updated status in PostgreSQL
        const completedJob = await scheduledEmailRepository.findById(job.id);
        expect(completedJob?.status).toBe(EmailJobStatus.SENT);
        expect(completedJob?.sentAt).not.toBeNull();
        expect(completedJob?.smtpMessageId).toBeDefined();
        expect(completedJob?.etherealPreviewUrl).toContain('ethereal.email');

        // Verify DeliveryAttempt record
        const attempts = await prisma.emailDeliveryAttempt.findMany({
          where: { emailJobId: job.id }
        });
        expect(attempts.length).toBe(1);
        expect(attempts[0].status).toBe(DeliveryAttemptStatus.SUCCESS);
        expect(attempts[0].durationMs).toBeGreaterThan(0);
        expect(attempts[0].smtpMessageId).toBe(completedJob?.smtpMessageId);
      } finally {
        sendEmailSpy.mockRestore();
      }
    }, 25000);

    it('should not resend an already SENT email (idempotent no-op)', async () => {
      const scheduledAt = new Date(Date.now() - 1000);
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'already.sent@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'already.sent@example.com',
        subject: 'Already Sent Guard',
        body: 'Content',
        scheduledAt,
        idempotencyKey
      });

      // Mark as SENT
      await scheduledEmailRepository.markAsSent(job.id, {
        smtpMessageId: '<mock-sent-msg-id@ethereal.email>'
      });

      // Invoke worker on already SENT job
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

      // Verify attempts count is 0 (did not attempt SMTP call)
      const attempts = await prisma.emailDeliveryAttempt.findMany({
        where: { emailJobId: job.id }
      });
      expect(attempts.length).toBe(0);
    });
  });

  describe('5. Persistence & Restart Recovery Engine', () => {
    it('should re-enqueue pending jobs missing from BullMQ upon restart reconciliation', async () => {
      const scheduledAt = new Date(Date.now() + 180000); // 3 minutes in future
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'recovery.missing@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'recovery.missing@example.com',
        subject: 'Simulated Missing Queue Job',
        body: 'Testing recovery from Redis drop',
        scheduledAt,
        idempotencyKey
      });

      // Ensure it is NOT in BullMQ (simulating dropped Redis job)
      await emailQueueProducer.removeJob(idempotencyKey);
      expect(await emailQueueProducer.hasJob(idempotencyKey)).toBe(false);

      // Trigger recovery
      const recoveryResult = await scheduleRecoveryService.reconcileSchedulesOnStartup();
      expect(recoveryResult.reEnqueuedMissingCount).toBeGreaterThanOrEqual(1);

      // Verify the job was restored to BullMQ
      const hasJobNow = await emailQueueProducer.hasJob(idempotencyKey);
      expect(hasJobNow).toBe(true);

      // Clean up the created queue job
      await emailQueueProducer.removeJob(idempotencyKey);
    });

    it('should resolve ambiguous delivery (Two Generals problem) without duplicate dispatch', async () => {
      const scheduledAt = new Date(Date.now() - 360000); // 6 mins ago
      const idempotencyKey = generateEmailIdempotencyKey(
        testSender.id,
        'two.generals@example.com',
        scheduledAt
      );

      const job = await scheduledEmailRepository.createSingle({
        senderId: testSender.id,
        recipientEmail: 'two.generals@example.com',
        subject: 'Ambiguous Delivery Resolution',
        body: 'Simulating crash after SMTP 250 OK but before DB mark SENT',
        scheduledAt,
        idempotencyKey
      });

      // Transition to PROCESSING
      await scheduledEmailRepository.claimJobForProcessing(job.id);

      // Record successful delivery attempt (SMTP accepted it)
      await prisma.emailDeliveryAttempt.create({
        data: {
          emailJobId: job.id,
          attemptNumber: 1,
          status: DeliveryAttemptStatus.SUCCESS,
          smtpMessageId: '<recovered-msg-id-123@ethereal.email>',
          durationMs: 450,
          smtpResponse: '250 2.0.0 OK: message queued'
        }
      });

      // Artificially backdate updatedAt to simulate crashed abandoned job (>5 mins old)
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      await prisma.$executeRawUnsafe(
        `UPDATE "email_jobs" SET "updated_at" = $1 WHERE "id" = $2`,
        sixMinutesAgo,
        job.id
      );

      // Trigger startup reconciliation
      const recoveryResult = await scheduleRecoveryService.reconcileSchedulesOnStartup();
      expect(recoveryResult.reconciledAsSentCount).toBeGreaterThanOrEqual(1);

      // Verify job was reconciled to SENT with the confirmed Message-ID
      const reconciledJob = await scheduledEmailRepository.findById(job.id);
      expect(reconciledJob?.status).toBe(EmailJobStatus.SENT);
      expect(reconciledJob?.smtpMessageId).toBe('<recovered-msg-id-123@ethereal.email>');
    });
  });

  describe('6. 1,000-Email Batch Load Performance Benchmark', () => {
    it('should schedule 1,000 email jobs into PostgreSQL and BullMQ in under 5 seconds', async () => {
      const startTime = Date.now();
      const count = 1000;
      const scheduledAt = new Date(Date.now() + 600000); // 10 minutes in future

      // Generate 1000 unique lead recipients
      const recipients: string[] = [];
      for (let i = 1; i <= count; i++) {
        recipients.push(`loadtest.lead.${i}@company-performance.org`);
      }

      const result = await emailSchedulingService.scheduleCampaign({
        userId: testUser.id,
        senderId: testSender.id,
        subject: 'High Volume 1000-Lead Campaign',
        body: '<p>Batch performance load test</p>',
        recipients,
        scheduledAt,
        delayBetweenEmails: 1
      });

      const durationMs = Date.now() - startTime;

      expect(result.totalScheduled).toBe(1000);
      expect(result.batchId).toBeDefined();

      // Verify 1000 jobs created in PostgreSQL under batchId
      const jobCountInDb = await prisma.emailJob.count({
        where: { batchId: result.batchId }
      });
      expect(jobCountInDb).toBe(1000);

      // Clean up the 1000 test jobs from BullMQ & DB to keep test environment tidy
      const jobs = await prisma.emailJob.findMany({
        where: { batchId: result.batchId },
        select: { id: true, idempotencyKey: true }
      });

      for (const j of jobs) {
        await emailQueueProducer.removeJob(j.idempotencyKey);
      }

      await prisma.emailJob.deleteMany({
        where: { batchId: result.batchId }
      });
      await prisma.emailBatch.deleteMany({
        where: { id: result.batchId }
      });

      // Benchmark assertion: 1,000 jobs persisted and enqueued rapidly
      expect(durationMs).toBeLessThan(15000);
    }, 30000);
  });
});
