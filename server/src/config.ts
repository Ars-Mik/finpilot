import 'dotenv/config';
import { z } from 'zod';

const runtimeSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_DATABASE_URL: z.url(),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default('finpilot-local-development-only-secret-change'),
  // A CIDR/address list understood by Express, or explicit `direct` (no proxy).
  // Never use "true" or a numeric hop count for a public deployment.
  TRUSTED_PROXY_CIDRS: z.string().trim().optional(),
});

const adminSchema = z.object({
  DATABASE_URL: z.url(),
  APP_DATABASE_URL: z.url(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv, context: string): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid ${context} configuration: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// Only called by the API process. Admin credentials are NOT needed at runtime.
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parseOrThrow(runtimeSchema, env, 'API');
  const url = new URL(config.CLIENT_ORIGIN);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLIENT_ORIGIN must be a single origin without path, credentials, query or fragment');
  }

  const proxies = config.TRUSTED_PROXY_CIDRS?.trim();
  if (proxies && /(^|,)\s*(true|false|all|\*|0\.0\.0\.0\/0|::\/0|\d+)\s*(,|$)/i.test(proxies)) {
    throw new Error('TRUSTED_PROXY_CIDRS must name specific trusted addresses/subnets, or "direct"');
  }
  if (config.NODE_ENV === 'production') {
    if (!env.SESSION_SECRET || !/^[a-f0-9]{64}$/i.test(config.SESSION_SECRET)) {
      throw new Error('Production SESSION_SECRET must be a freshly generated 32-byte hex value');
    }
    if (url.protocol !== 'https:') {
      throw new Error('Production CLIENT_ORIGIN must use HTTPS');
    }
    if (!proxies) {
      throw new Error('Production TRUSTED_PROXY_CIDRS is required (use "direct" if there is no proxy)');
    }
  }
  return { ...config, CLIENT_ORIGIN: url.origin };
}

// Only for migrations and scheduled cleanup jobs; never call from server.ts.
export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parseOrThrow(adminSchema, env, 'database maintenance');
  if (new URL(config.DATABASE_URL).username === new URL(config.APP_DATABASE_URL).username) {
    throw new Error('APP_DATABASE_URL must use a dedicated non-admin database role');
  }
  return config;
}
