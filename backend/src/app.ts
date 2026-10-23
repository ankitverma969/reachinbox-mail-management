import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/environment.config.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { errorHandler } from './middleware/error-handler.middleware.js';
import { NotFoundError } from './shared/errors/AppError.js';
import { checkRedisHealth } from './config/redis.config.js';

export function createApp(): Express {
  const app = express();

  // Security and utilities middleware
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger);

  // Health check endpoint
  app.get('/api/health', async (_req: Request, res: Response) => {
    const isRedisAvailable = await checkRedisHealth();

    res.status(200).json({
      success: true,
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: {
        redis: isRedisAvailable ? 'available' : 'unavailable',
        database: 'configured',
        elasticsearch: 'configured'
      }
    });
  });

  // Catch unhandled routes
  app.use((req: Request, _res: Response, next) => {
    next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
  });

  // Global centralized error handling
  app.use(errorHandler);

  return app;
}
