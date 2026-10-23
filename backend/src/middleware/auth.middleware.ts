import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment.config.js';
import { UnauthorizedError } from '../shared/errors/AppError.js';
import { prisma } from '../shared/database/prisma.client.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
}

/**
 * Validates session JWT from HttpOnly cookie or Authorization Bearer header.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Check HttpOnly cookie
    if (req.cookies && typeof req.cookies.reachinbox_token === 'string') {
      token = req.cookies.reachinbox_token;
    }

    // 2. Check Authorization Bearer header
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // 3. Fallback to x-user-id header if present (for test harnesses or internal requests)
    if (!token && req.headers['x-user-id'] && typeof req.headers['x-user-id'] === 'string') {
      const user = await prisma.user.findUnique({
        where: { id: req.headers['x-user-id'] }
      });
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          role: 'user'
        };
        return next();
      }
    }

    if (!token) {
      throw new UnauthorizedError('Authentication required to access this resource');
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        avatarUrl: decoded.avatarUrl,
        role: decoded.role || 'user'
      };
      next();
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Optional authentication: attaches user if valid token exists, but does not reject if unauthenticated.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    if (req.cookies && typeof req.cookies.reachinbox_token === 'string') {
      token = req.cookies.reachinbox_token;
    }

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          name: decoded.name,
          avatarUrl: decoded.avatarUrl,
          role: decoded.role || 'user'
        };
      } catch {
        // Silently ignore invalid token in optional auth
      }
    }
    next();
  } catch {
    next();
  }
}
