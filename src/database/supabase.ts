import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Server-side Supabase client using the SERVICE ROLE key.
 * This key bypasses RLS and must NEVER be exposed to clients/frontend.
 * It is only used here, inside the bot's backend process.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
