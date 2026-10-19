import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
});

export function loadConfig() {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid API configuration: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
