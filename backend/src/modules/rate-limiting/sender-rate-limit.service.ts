import type { Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis.config.js';
import { env } from '../../config/environment.config.js';
import { logger } from '../../shared/logger/structured-logger.js';

export interface QuotaReservationResult {
  allowed: boolean;
  reason?: 'SENDER_LIMIT_EXCEEDED' | 'GLOBAL_LIMIT_EXCEEDED' | 'REDIS_ERROR';
  currentSenderUsage: number;
  maxSenderLimit: number;
  currentGlobalUsage?: number;
  maxGlobalLimit?: number;
  hourWindow: string;
}

/**
 * Atomic Redis Lua script checking and reserving both sender and global hourly quotas.
 * Guarantees that neither limit is breached, and if one limit fails, no tokens are consumed.
 * Also checks if the specific email job has already reserved quota in this window to prevent
 * double-counting during retries.
 *
 * KEYS[1]: ratelimit:sender:{senderId}:{hourKey}
 * KEYS[2]: ratelimit:global:{hourKey}
 * KEYS[3]: ratelimit:job:{jobId}:{hourKey}
 * ARGV[1]: maxSenderLimit (e.g. 200)
 * ARGV[2]: hasGlobalLimit ('1' or '0')
 * ARGV[3]: maxGlobalLimit (e.g. 1000)
 * ARGV[4]: expireSeconds (e.g. 7200)
 * ARGV[5]: hasJobId ('1' or '0')
 *
 * Returns:
 *  1: Quota successfully reserved on both sender and global counters (or already reserved).
 *  0: Sender hourly quota exhausted.
 * -1: Global hourly quota exhausted.
 */
const CHECK_AND_RESERVE_QUOTA_LUA = `
local senderKey = KEYS[1]
local globalKey = KEYS[2]
local jobKey = KEYS[3]
local maxSender = tonumber(ARGV[1])
local hasGlobal = tonumber(ARGV[2])
local maxGlobal = tonumber(ARGV[3])
local expireSec = tonumber(ARGV[4])
local hasJob = tonumber(ARGV[5])

if hasJob == 1 then
  local jobVal = redis.call('GET', jobKey)
  if jobVal then
    return 1 -- Already reserved for this job in this hour window; do not double count
  end
end

local senderVal = redis.call('GET', senderKey)
local currentSender = senderVal and tonumber(senderVal) or 0

if currentSender >= maxSender then
  return 0
end

if hasGlobal == 1 then
  local globalVal = redis.call('GET', globalKey)
  local currentGlobal = globalVal and tonumber(globalVal) or 0
  if currentGlobal >= maxGlobal then
    return -1
  end
end

-- Both limits satisfied: atomically increment
local newSenderCount = redis.call('INCR', senderKey)
if newSenderCount == 1 then
  redis.call('EXPIRE', senderKey, expireSec)
end

if hasGlobal == 1 then
  local newGlobalCount = redis.call('INCR', globalKey)
  if newGlobalCount == 1 then
    redis.call('EXPIRE', globalKey, expireSec)
  end
end

if hasJob == 1 then
  redis.call('SET', jobKey, '1', 'EX', expireSec)
end

return 1
`;

export function getUtcHourKey(date = new Date()): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  return `${year}${month}${day}T${hour}`;
}

export function getNextUtcHourStart(date = new Date()): Date {
  const next = new Date(date);
  next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
  return next;
}

export class SenderRateLimitService {
  private redisClient: Redis;

  constructor(redisClient?: Redis) {
    this.redisClient = redisClient || createRedisClient();
  }

  /**
   * Atomically checks and reserves quota for an email send.
   */
  async checkAndReserveQuota(
    senderId: string,
    senderHourlyLimit?: number,
    referenceDate = new Date(),
    emailJobId?: string
  ): Promise<QuotaReservationResult> {
    const hourWindow = getUtcHourKey(referenceDate);
    const senderKey = `ratelimit:sender:${senderId}:${hourWindow}`;
    const globalKey = `ratelimit:global:${hourWindow}`;
    const jobKey = emailJobId ? `ratelimit:job:${emailJobId}:${hourWindow}` : 'ratelimit:job:none';
    const hasJobId = emailJobId ? '1' : '0';

    const maxSenderLimit = senderHourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 200;
    const globalLimit = env.GLOBAL_HOURLY_EMAIL_LIMIT;
    const hasGlobalLimit = globalLimit !== undefined && globalLimit > 0 ? 1 : 0;
    const maxGlobalLimit = globalLimit ?? 0;
    const expireSeconds = 7200; // 2 hours TTL to cleanly span across current window

    try {
      const luaResult = (await this.redisClient.eval(
        CHECK_AND_RESERVE_QUOTA_LUA,
        3,
        senderKey,
        globalKey,
        jobKey,
        maxSenderLimit.toString(),
        hasGlobalLimit.toString(),
        maxGlobalLimit.toString(),
        expireSeconds.toString(),
        hasJobId
      )) as number;

      if (luaResult === 1) {
        return {
          allowed: true,
          currentSenderUsage: await this.getCurrentUsage(senderId, referenceDate),
          maxSenderLimit,
          currentGlobalUsage: hasGlobalLimit ? await this.getGlobalUsage(referenceDate) : undefined,
          maxGlobalLimit: hasGlobalLimit ? maxGlobalLimit : undefined,
          hourWindow
        };
      }

      if (luaResult === 0) {
        logger.warn(
          { senderId, hourWindow, maxSenderLimit },
          'Sender hourly rate limit reached; dispatch deferred'
        );
        return {
          allowed: false,
          reason: 'SENDER_LIMIT_EXCEEDED',
          currentSenderUsage: maxSenderLimit,
          maxSenderLimit,
          hourWindow
        };
      }

      logger.warn(
        { senderId, hourWindow, maxGlobalLimit },
        'Global hourly rate limit reached; dispatch deferred'
      );
      return {
        allowed: false,
        reason: 'GLOBAL_LIMIT_EXCEEDED',
        currentSenderUsage: await this.getCurrentUsage(senderId, referenceDate),
        maxSenderLimit,
        currentGlobalUsage: maxGlobalLimit,
        maxGlobalLimit,
        hourWindow
      };
    } catch (err) {
      logger.error({ err, senderId, hourWindow }, 'Redis failure during rate limit check');
      // If Redis fails, fail safe by deferring rather than violating provider limits
      return {
        allowed: false,
        reason: 'REDIS_ERROR',
        currentSenderUsage: 0,
        maxSenderLimit,
        hourWindow
      };
    }
  }

  async getCurrentUsage(senderId: string, referenceDate = new Date()): Promise<number> {
    const hourWindow = getUtcHourKey(referenceDate);
    const key = `ratelimit:sender:${senderId}:${hourWindow}`;
    const val = await this.redisClient.get(key);
    return val ? parseInt(val, 10) : 0;
  }

  async getGlobalUsage(referenceDate = new Date()): Promise<number> {
    const hourWindow = getUtcHourKey(referenceDate);
    const key = `ratelimit:global:${hourWindow}`;
    const val = await this.redisClient.get(key);
    return val ? parseInt(val, 10) : 0;
  }

  /**
   * Resets counter for a given window (used in test cleanups).
   */
  async resetCounter(senderId: string, referenceDate = new Date()): Promise<void> {
    const hourWindow = getUtcHourKey(referenceDate);
    const senderKey = `ratelimit:sender:${senderId}:${hourWindow}`;
    const alertKey = `slack:alerted:${senderId}:${hourWindow}`;
    const jobKeys = await this.redisClient.keys(`ratelimit:job:*:${hourWindow}`);
    const keysToDelete = [senderKey, alertKey, ...jobKeys];
    if (keysToDelete.length > 0) {
      await this.redisClient.del(...keysToDelete);
    }
  }

  /**
   * Returns next eligible sending window with deterministic tie-breaking offset
   * to preserve outreach ordering and prevent thundering herds.
   */
  getNextEligibleWindow(referenceDate = new Date(), orderOffsetMs = 0): Date {
    const nextStart = getNextUtcHourStart(referenceDate);
    return new Date(nextStart.getTime() + Math.max(0, orderOffsetMs));
  }

  async close(): Promise<void> {
    try {
      await this.redisClient.quit();
    } catch {
      this.redisClient.disconnect();
    }
  }
}

export const senderRateLimitService = new SenderRateLimitService();
