import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/environment.config.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { errorHandler } from './middleware/error-handler.middleware.js';
import { NotFoundError } from './shared/errors/AppError.js';
import { checkRedisHealth } from './config/redis.config.js';
import { checkElasticsearchHealth } from './config/elasticsearch.config.js';
import { prisma } from './shared/database/prisma.client.js';
import cookieParser from 'cookie-parser';
import { emailSchedulingRoutes } from './modules/email-scheduling/email-scheduling.routes.js';
import { emailSearchRoutes } from './modules/search/email-search.routes.js';
import { slackRoutes } from './modules/integrations/slack.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { senderRoutes } from './modules/senders/sender.routes.js';
import { adminAuthMiddleware } from './middleware/admin-auth.middleware.js';
import { setupBullBoard } from './modules/dashboard/bull-board.setup.js';

export function createApp(): Express {
  const app = express();

  // Security and utilities middleware
  app.use(
    helmet({
      contentSecurityPolicy: false // Allows Bull Board dashboard assets to render cleanly
    })
  );
  app.use(
    cors({
      origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger);

  // Core API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/senders', senderRoutes);
  app.use('/api/v1/emails', emailSchedulingRoutes);
  app.use('/api/v1/emails', emailSearchRoutes);
  app.use('/api/v1/integrations/slack', slackRoutes);

  // Bull Board queue dashboard (Guarded by administrative authentication)
  app.use('/admin/queues', adminAuthMiddleware, setupBullBoard());

  // Health check endpoint
  app.get('/api/health', async (_req: Request, res: Response) => {
    const isRedisAvailable = await checkRedisHealth();
    const isElasticsearchAvailable = await checkElasticsearchHealth();
    let isDatabaseAvailable = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      isDatabaseAvailable = true;
    } catch {
      isDatabaseAvailable = false;
    }

    res.status(200).json({
      success: true,
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: {
        redis: isRedisAvailable ? 'available' : 'unavailable',
        database: isDatabaseAvailable ? 'connected' : 'disconnected',
        elasticsearch: isElasticsearchAvailable ? 'available' : 'unavailable'
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
