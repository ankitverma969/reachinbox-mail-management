import { Redis, type RedisOptions } from 'ioredis';
import { env } from './environment.config.js';
import { logger } from '../shared/logger/structured-logger.js';

export function getRedisConnectionOptions(): RedisOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    // BullMQ requires maxRetriesPerRequest to be null
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 200, 2000);
      return delay;
    }
  };
}

export function createRedisClient(customOptions?: Partial<RedisOptions>): Redis {
  const options = {
    ...getRedisConnectionOptions(),
    ...customOptions
  };
  const client = new Redis(options);

  client.on('error', (err: Error) => {
    logger.debug({ err: err.message }, 'Redis connection status notification');
  });

  return client;
}

export async function checkRedisHealth(): Promise<boolean> {
  const probeClient = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null // Never retry for a health check probe
  });

  // Attach silent error handler so probe failure doesn't emit unhandled errors
  probeClient.on('error', () => {});

  try {
    const connectPromise = probeClient.connect();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis connection probe timed out')), 500)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    const response = await probeClient.ping();
    await probeClient.quit();
    return response === 'PONG';
  } catch {
    probeClient.disconnect();
    return false;
  }
}
