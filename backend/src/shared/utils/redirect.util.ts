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

export const AWS_BACKEND_BASE_URL = 'http://52.23.237.61:5000';
export const VERCEL_FRONTEND_BASE_URL = 'https://reachinboxai4u.vercel.app';

/**
 * Resolves the appropriate OAuth callback URL (Google or Slack) dynamically.
 * Supports both Vercel base URL and AWS EC2 base URL, ensuring that OAuth
 * callback URLs match the domain the user initiated the flow from.
 */
export function resolveOAuthCallbackUrl(
  req?: { headers?: Record<string, string | string[] | undefined> },
  type: 'google' | 'slack' = 'google'
): string {
  const path = type === 'google' ? '/api/v1/auth/google/callback' : '/api/v1/integrations/slack/callback';

  const hostHeader = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '');

  // 1. If incoming request was proxied via Vercel or originated from Vercel domain
  if (hostHeader.includes('vercel.app')) {
    return `${VERCEL_FRONTEND_BASE_URL}${path}`;
  }

  // 2. If incoming request was directed to AWS EC2 public IP or domain
  if (hostHeader.includes('52.23.237.61')) {
    return `${AWS_BACKEND_BASE_URL}${path}`;
  }

  // 3. If an explicit valid callback is configured in env (e.g. for custom deployments)
  const configuredEnv = type === 'google' ? env.GOOGLE_CALLBACK_URL : env.SLACK_CALLBACK_URL;
  if (configuredEnv && !configuredEnv.includes('*') && !configuredEnv.includes('%2A')) {
    // If running in production on EC2/Vercel and env says localhost, prefer canonical production URL
    if (env.NODE_ENV === 'production' && configuredEnv.includes('localhost')) {
      return `${VERCEL_FRONTEND_BASE_URL}${path}`;
    }
    return configuredEnv;
  }

  // 4. Default based on NODE_ENV
  if (env.NODE_ENV === 'production') {
    return `${VERCEL_FRONTEND_BASE_URL}${path}`;
  }

  return `http://localhost:${env.PORT || 5000}${path}`;
}

