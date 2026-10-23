import { createApp } from './app.js';
import { env } from './config/environment.config.js';
import { logger } from './shared/logger/structured-logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      nodeEnv: env.NODE_ENV
    },
    `ReachInbox Backend Server initialized and listening on port ${env.PORT}`
  );
});

function gracefulShutdown(signal: string): void {
  logger.info({ signal }, 'Termination signal received. Closing HTTP server gracefully');
  server.close(() => {
    logger.info('HTTP server closed. Exiting process');
    process.exit(0);
  });

  // Force close after 10s timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout expiration');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
