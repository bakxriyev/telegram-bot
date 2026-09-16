import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  STORAGE_CHANNEL_ID: z
    .string()
    .min(1, 'STORAGE_CHANNEL_ID is required')
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v), 'STORAGE_CHANNEL_ID must be a number'),
  ADMIN_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number)
        .filter((id) => Number.isFinite(id)),
    ),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;
