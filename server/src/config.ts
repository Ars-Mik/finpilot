import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().url(),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default('finpilot-local-development-only-secret-change'),
});

export function loadConfig() {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid API configuration: ${z.prettifyError(result.error)}`);
  }
  if (new URL(result.data.DATABASE_URL).username === new URL(result.data.APP_DATABASE_URL).username) {
    throw new Error('Runtime APP_DATABASE_URL must use a dedicated non-admin database role');
  }
  if (result.data.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || result.data.SESSION_SECRET.includes('development-only'))) {
    throw new Error('Production SESSION_SECRET must be a strong random secret (at least 32 characters)');
  }
  return result.data;
}
