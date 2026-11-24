import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from './config';

export { supabaseConfigured };

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-application-name': 'web-gradebook' },
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase не настроен');
  return supabase;
}

/** Вход через брокер Яндекс ID (Supabase Edge Function). */
export function signInWithYandex(): void {
  if (!supabaseConfigured) throw new Error('Supabase не настроен');
  const base = supabaseUrl.replace(/\/$/, '');
  window.location.assign(`${base}/functions/v1/yandex-oauth/start`);
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
