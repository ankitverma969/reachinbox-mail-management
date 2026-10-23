import type { Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis.config.js';
import { logger } from '../../shared/logger/structured-logger.js';

const THROTTLE_LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local minGapMs = tonumber(ARGV[2])

local lastSent = redis.call('GET', key)
if lastSent then
  local diff = now - tonumber(lastSent)
  if diff < minGapMs then
    return minGapMs - diff
  end
end

-- Update lastSent timestamp and set expiry to prevent key accumulation
redis.call('SET', key, now, 'PX', minGapMs * 10)
return 0
`;

export class SenderThrottleService {
  private redisClient: Redis;

  constructor(redisClient?: Redis) {
    this.redisClient = redisClient || createRedisClient();
  }

  /**
   * Evaluates if enough time has elapsed since the sender's last dispatch.
   * Returns 0 if clear to send immediately (slot acquired).
   * Returns positive number (milliseconds to wait) if too fast.
   */
  async checkAndAcquireSlot(senderId: string, minDelaySeconds: number): Promise<number> {
    const key = `throttle:sender:${senderId}`;
    const now = Date.now();
    const minGapMs = Math.max(100, Math.floor(minDelaySeconds * 1000));

    try {
      const waitTime = (await this.redisClient.eval(
        THROTTLE_LUA_SCRIPT,
        1,
        key,
        now.toString(),
        minGapMs.toString()
      )) as number;

      return Number(waitTime) || 0;
    } catch (err) {
      logger.error({ err, senderId }, 'Error evaluating sender throttle slot in Redis');
      // On Redis failure, allow dispatch to proceed to not stall delivery
      return 0;
    }
  }

  /**
   * Enforces minimum send delay across workers.
   * If Redis indicates a wait time, pauses execution for that duration and marks the slot.
   */
  async enforceMinimumDelay(senderId: string, minDelaySeconds: number): Promise<void> {
    const waitMs = await this.checkAndAcquireSlot(senderId, minDelaySeconds);
    if (waitMs > 0) {
      logger.debug(
        { senderId, waitMs, minDelaySeconds },
        'Sender minimum delay active, pacing dispatch'
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Refresh slot timestamp after waiting
      await this.markSent(senderId, minDelaySeconds);
    }
  }

  /**
   * Explicitly updates the last send timestamp for a sender.
   */
  async markSent(senderId: string, minDelaySeconds: number): Promise<void> {
    const key = `throttle:sender:${senderId}`;
    const now = Date.now();
    const minGapMs = Math.max(100, Math.floor(minDelaySeconds * 1000));
    try {
      await this.redisClient.set(key, now.toString(), 'PX', minGapMs * 10);
    } catch (err) {
      logger.error({ err, senderId }, 'Error setting sender throttle timestamp');
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

export const senderThrottleService = new SenderThrottleService();
