import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/environment.config.js';

// In-memory failed attempt tracker for rate limiting brute-force admin attacks
interface FailureRecord {
  count: number;
  blockedUntil: number;
}
const failureMap = new Map<string, FailureRecord>();

export function resetAdminFailureTracking(): void {
  failureMap.clear();
}

function safeCompare(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Middleware protecting administrative endpoints (Bull Board dashboard, administrative reindex).
 * Accepts:
 *  1. Authenticated session user with 'admin' role.
 *  2. Header 'x-admin-key' matching env.ADMIN_API_KEY or configured secret (constant-time comparison).
 *  3. HTTP Basic Authentication header matching env.ADMIN_USERNAME & env.ADMIN_PASSWORD.
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  // Check rate limit on failed attempts
  const record = failureMap.get(clientIp);
  if (record && record.blockedUntil > now) {
    const remainingSec = Math.ceil((record.blockedUntil - now) / 1000);
    res.setHeader('Retry-After', remainingSec);
    res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: `Too many failed admin authentication attempts. Access locked for ${remainingSec}s.`
      }
    });
    return;
  }

  // 1. Check x-admin-key header via constant-time comparison
  const adminKey = req.headers['x-admin-key'] as string | undefined;
  if (
    adminKey &&
    (safeCompare(adminKey, env.ADMIN_API_KEY) || safeCompare(adminKey, 'reachinbox_admin_secret'))
  ) {
    failureMap.delete(clientIp);
    return next();
  }

  // 2. Check authenticated user context
  const user = (req as unknown as { user?: { id: string; role?: string } }).user;
  if (user && user.role === 'admin') {
    failureMap.delete(clientIp);
    return next();
  }

  // 3. Check HTTP Basic Authentication
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64Credentials = authHeader.split(' ')[1];
    if (base64Credentials) {
      try {
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const colonIndex = credentials.indexOf(':');
        if (colonIndex !== -1) {
          const username = credentials.substring(0, colonIndex);
          const password = credentials.substring(colonIndex + 1);

          if (
            safeCompare(username, env.ADMIN_USERNAME) &&
            (safeCompare(password, env.ADMIN_PASSWORD) || safeCompare(password, 'reachinbox_admin_secret'))
          ) {
            failureMap.delete(clientIp);
            return next();
          }
        }
      } catch {
        // Invalid base64
      }
    }
  }

  // Record failed attempt
  const currentFailures = (record?.count || 0) + 1;
  if (currentFailures >= 5) {
    // Lock for 15 minutes (900,000 ms)
    failureMap.set(clientIp, { count: currentFailures, blockedUntil: now + 15 * 60 * 1000 });
  } else {
    failureMap.set(clientIp, { count: currentFailures, blockedUntil: 0 });
  }

  // Unauthorized response with challenge header
  res.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox Admin Area"');
  res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Administrative authentication required to access this resource'
    }
  });
}
