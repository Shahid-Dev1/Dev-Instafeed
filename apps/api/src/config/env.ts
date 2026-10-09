import { z } from 'zod';

/** Optional string; empty values count as unset so `KEY=` in .env disables a provider. */
const optional = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_URL: z.url(),
  WEB_URL: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/, 'comma-separated scopes'),
  SHOPIFY_APP_URL: z.url(),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default('2026-10'),
  ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  // Video providers. All optional: an unset provider is reported as "not configured" instead of failing at boot.
  YOUTUBE_API_KEY: optional(),
  BUNNY_STREAM_LIBRARY_ID: optional(),
  BUNNY_STREAM_API_KEY: optional(),
  BUNNY_STREAM_CDN_HOSTNAME: optional(),
  /** Key used to verify X-BunnyStream-Signature (HMAC-SHA256 of the raw body). */
  BUNNY_STREAM_WEBHOOK_KEY: optional(),
  TIKTOK_CLIENT_KEY: optional(),
  TIKTOK_CLIENT_SECRET: optional(),
  INSTAGRAM_APP_ID: optional(),
  INSTAGRAM_APP_SECRET: optional(),
  INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.\d$/).default('v24.0'),
  /** "<app-id>|<client-token>" for Instagram oEmbed (requires Meta oEmbed Read approval). */
  META_OEMBED_TOKEN: optional(),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(5000).default(500),
  QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]+$/).default('ifq'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
