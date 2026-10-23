import { PrismaClient } from '@prisma/client';
import { logger } from '../logger/structured-logger.js';
import { env } from '../../config/environment.config.js';

// Global singleton pattern to prevent multiple PrismaClient instances in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' }
          ]
        : [{ emit: 'event', level: 'error' }]
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log Prisma database events
if (env.NODE_ENV === 'development') {
  (prisma as unknown as { $on: (event: string, callback: (e: { query: string; duration: number }) => void) => void }).$on(
    'query',
    (e) => {
      logger.debug({ query: e.query, durationMs: e.duration }, 'Database query executed');
    }
  );
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
