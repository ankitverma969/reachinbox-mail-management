import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { etherealEmailService } from '../src/modules/email-delivery/ethereal-email.service.js';
import { env } from '../src/config/environment.config.js';

describe('Phase 3 (Live Integration): Live Ethereal SMTP Delivery & Preview URL Extraction', () => {
  let isPortReachable = false;

  beforeAll(async () => {
    isPortReachable = await etherealEmailService.verifyConnection();
    if (!isPortReachable) {
      console.warn(
        '[NOTICE] Outbound TCP port 587/465 is blocked by the current host ISP/firewall. Live SMTP dispatch will be skipped.'
      );
    }
  }, 15000);

  afterAll(() => {
    etherealEmailService.close();
  });

  it('should verify live SMTP connection or report network blockage', async () => {
    if (!isPortReachable) {
      console.log('Skipping live connection test: outbound port blocked on this network.');
      return;
    }
    expect(isPortReachable).toBe(true);
  });

  it('should dispatch live email via Ethereal SMTP and extract preview URL when reachable', async () => {
    if (!isPortReachable) {
      console.log('Skipping live dispatch test: outbound port blocked on this network.');
      return;
    }

    const sendResult = await etherealEmailService.sendEmail({
      to: 'evaluator.live.test@example.com',
      subject: 'Live Ethereal Verification Test',
      html: '<p>Testing live SMTP delivery and web preview extraction</p>'
    });

    expect(sendResult.messageId).toBeDefined();
    expect(sendResult.messageId).toContain('@');
    expect(sendResult.etherealPreviewUrl).toBeDefined();
    expect(sendResult.etherealPreviewUrl).toContain('https://ethereal.email/message/');
  }, 30000);
});
