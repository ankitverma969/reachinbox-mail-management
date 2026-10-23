import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/AppError.js';
import { logger } from '../shared/logger/structured-logger.js';
import { env } from '../config/environment.config.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();

  // Handle known operational AppErrors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.constructor.name,
        message: err.message,
        details: err.details || null
      },
      meta: { timestamp }
    });
    return;
  }

  // Handle Zod schema validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'ValidationError',
        message: 'Request payload validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message
        }))
      },
      meta: { timestamp }
    });
    return;
  }

  // Handle unexpected or programmer errors
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled internal server error');

  res.status(500).json({
    success: false,
    error: {
      code: 'InternalServerError',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : (err as Error)?.message || 'Internal Server Error'
    },
    meta: { timestamp }
  });
}
