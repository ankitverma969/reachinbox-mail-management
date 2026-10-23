import crypto from 'crypto';

/**
 * Generates a deterministic idempotency key for an email job.
 * Ensures the same sender, recipient, and scheduled time map to a unique key.
 */
export function generateEmailIdempotencyKey(
  senderId: string,
  recipientEmail: string,
  scheduledAt: Date
): string {
  const normalizedEmail = recipientEmail.trim().toLowerCase();
  const normalizedTime = new Date(scheduledAt).toISOString();
  const rawKey = `${senderId}:${normalizedEmail}:${normalizedTime}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
