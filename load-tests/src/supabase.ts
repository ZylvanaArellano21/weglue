import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LoadTestConfig } from './types.js';

export function serviceClient(config: LoadTestConfig): SupabaseClient {
  if (!config.serviceRoleKey) throw new Error('LOADTEST_SUPABASE_SERVICE_ROLE_KEY is required for this command');
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function userClient(config: LoadTestConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function unwrap<T>(result: { data: T | null; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data as T;
}

export async function inChunks<T>(values: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let start = 0; start < values.length; start += size) await fn(values.slice(start, start + size));
}
