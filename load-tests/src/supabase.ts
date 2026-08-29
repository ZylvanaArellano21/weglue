import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LoadTestConfig } from './config.js';

export type AnyClient = SupabaseClient<any, any, any>;

export function serviceClient(config: LoadTestConfig): AnyClient {
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function anonClient(config: LoadTestConfig, storageKey?: string): AnyClient {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey },
  });
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' })), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function unwrap<T>(result: { data: T; error: any }, label: string): T {
  if (result.error) {
    const error = new Error(`${label}: ${result.error.message ?? String(result.error)}`) as Error & Record<string, unknown>;
    Object.assign(error, result.error);
    throw error;
  }
  return result.data;
}

export async function query<T>(
  operation: Promise<{ data: T; error: any }>,
  config: LoadTestConfig,
  label: string,
): Promise<T> {
  return unwrap(await withTimeout(operation, config.requestTimeoutMs, label), label);
}

export function authErrorClass(error: unknown): string {
  const e = error as { status?: number; code?: string; message?: string };
  const message = (e?.message ?? '').toLowerCase();
  if (e?.status === 429 || message.includes('over_email_send_rate_limit')) return '429 over_email_send_rate_limit';
  if (e?.status && e.status >= 500) return '5xx';
  if (message.includes('timeout')) return 'timeout';
  return e?.code ? `auth/${e.code}` : 'auth/other';
}
