import { env } from '../../config/environment.config.js';
import { logger } from '../logger/structured-logger.js';

export const CANONICAL_PRODUCTION_FRONTEND = 'https://reachinboxai4u.vercel.app';
export const CANONICAL_DEV_FRONTEND = 'http://localhost:5173';

/**
 * Returns a validated, fully-qualified safe frontend base origin for redirects.
 * Guarantees that wildcard patterns (like *.vercel.app) or malicious inputs
 * are never used as a browser redirect target.
 */
export function getSafeFrontendBaseUrl(): string {
  let candidate = (env.FRONTEND_URL || '').trim();

  // If candidate is empty or undefined, use environment-appropriate canonical URL
  if (!candidate) {
    return env.NODE_ENV === 'production' ? CANONICAL_PRODUCTION_FRONTEND : CANONICAL_DEV_FRONTEND;
  }

  // Detect and reject wildcard patterns (*.vercel.app, %2A.vercel.app, etc.)
  if (candidate.includes('*') || candidate.includes('%2A')) {
    logger.warn(
      { candidate, fallback: CANONICAL_PRODUCTION_FRONTEND },
      'Wildcard detected in frontend redirect URL. Wildcards cannot be used as redirect targets; falling back to canonical frontend origin.'
    );
    return env.NODE_ENV === 'production' ? CANONICAL_PRODUCTION_FRONTEND : CANONICAL_DEV_FRONTEND;
  }

  // Ensure protocol is present
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  // Strip trailing slashes
  return candidate.replace(/\/+$/, '');
}

/**
 * Builds a safe absolute redirect URL for OAuth success, error, or integration callbacks.
 * Protects strictly against:
 * 1. Wildcard hostnames (*.vercel.app -> %2A.vercel.app)
 * 2. Open redirect vulnerabilities via protocol-relative URLs (//evil.com)
 * 3. Malformed URL concatenation (double slashes)
 *
 * @param path Relative path starting with / (e.g., '/dashboard?login=success')
 * @returns Fully qualified, safe redirect URL
 */
export function buildFrontendRedirectUrl(path: string): string {
  const base = getSafeFrontendBaseUrl();

  let cleanPath = (path || '/').trim();

  // Enforce leading slash
  if (!cleanPath.startsWith('/')) {
    cleanPath = `/${cleanPath}`;
  }

  // Prevent protocol-relative URL exploits (//attacker.com)
  if (cleanPath.startsWith('//')) {
    cleanPath = cleanPath.replace(/^\/+/, '/');
  }

  return `${base}${cleanPath}`;
}
