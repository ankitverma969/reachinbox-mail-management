import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  FRONTEND_URL: z
    .string()
    .optional()
    .transform((val) => {
      // Check alternate environment variables if FRONTEND_URL is empty
      let url = val || process.env.CLIENT_URL || process.env.APP_URL;
      if (!url && process.env.VERCEL_URL) {
        url = `https://${process.env.VERCEL_URL}`;
      }

      if (!url || url.trim() === '') {
        return process.env.NODE_ENV === 'production'
          ? 'https://reachinboxai4u.vercel.app'
          : 'http://localhost:5173';
      }

      url = url.trim();

      // Reject/sanitize wildcard patterns (*.vercel.app, %2A.vercel.app)
      if (url.includes('*') || url.includes('%2A')) {
        return process.env.NODE_ENV === 'production'
          ? 'https://reachinboxai4u.vercel.app'
          : 'http://localhost:5173';
      }

      // Ensure protocol is present
      if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }

      // Strip trailing slashes
      return url.replace(/\/+$/, '');
    }),
  CORS_ORIGIN: z.string().optional(),

  // Database
  DATABASE_URL: z.string().default(
    'postgresql://reachinbox:reachinbox_secret@localhost:5432/reachinbox_db?schema=public'
  ),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX_PREFIX: z.string().default('reachinbox'),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),

  // Worker Settings
  EMAIL_WORKER_CONCURRENCY: z.coerce.number().default(5),
  MIN_EMAIL_SEND_DELAY_MS: z.coerce.number().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().default(200),
  GLOBAL_HOURLY_EMAIL_LIMIT: z.coerce.number().optional(),

  // OAuth & Credentials (optional at foundation stage)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:5000/api/v1/auth/google/callback'),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_CALLBACK_URL: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DEFAULT_CHANNEL_ID: z.string().default('D0CBFH91A5B'),

  // Dedicated Admin Credentials for Bull Board & Ops
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('reachinbox_admin_2026!'),
  ADMIN_API_KEY: z.string().default('reachinbox_admin_secret_key_2026'),

  // SMTP Settings (optional at foundation stage)
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().default(587),
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASSWORD: z.string().optional(),

  // Security & Authentication Flags
  ENABLE_DEV_LOGIN: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().default('development_jwt_secret_key_minimum_32_characters_long_for_reachinbox'),
  ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (data.ADMIN_PASSWORD === 'reachinbox_admin_2026!') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_PASSWORD'],
        message: 'Default ADMIN_PASSWORD cannot be used in production. Please set a dedicated strong password.'
      });
    }
    if (data.JWT_SECRET === 'development_jwt_secret_key_minimum_32_characters_long_for_reachinbox') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'Default JWT_SECRET cannot be used in production. Please set a unique secret.'
      });
    }
    if (data.ENABLE_DEV_LOGIN === 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENABLE_DEV_LOGIN'],
        message: 'Developer bypass login (ENABLE_DEV_LOGIN=true) is strictly forbidden in production mode.'
      });
    }
  }

  if (data.ADMIN_PASSWORD && data.JWT_SECRET && data.ADMIN_PASSWORD === data.JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ADMIN_PASSWORD'],
      message: 'ADMIN_PASSWORD must not be the same as JWT_SECRET.'
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Environment validation failure:\n${errorDetails}`);
  }
  return result.data;
}

export const env = parseEnvironment();
