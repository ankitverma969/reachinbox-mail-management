import { type ConnectionOptions } from 'bullmq';
import { getRedisConnectionOptions, createRedisClient } from '../config/redis.config.js';
import type { Redis } from 'ioredis';

let sharedConnection: Redis | null = null;

export function getBullMqConnectionOptions(): ConnectionOptions {
  return getRedisConnectionOptions();
}

export function getSharedBullMqRedis(): Redis {
  if (!sharedConnection) {
    sharedConnection = createRedisClient();
  }
  return sharedConnection;
}

export async function closeSharedBullMqRedis(): Promise<void> {
  if (sharedConnection) {
    try {
      await sharedConnection.quit();
    } catch {
      sharedConnection.disconnect();
    } finally {
      sharedConnection = null;
    }
  }
}
