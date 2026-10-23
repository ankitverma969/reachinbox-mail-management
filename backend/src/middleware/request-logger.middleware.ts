import type { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger/structured-logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip
      },
      'Incoming HTTP request completed'
    );
  });

  next();
}
