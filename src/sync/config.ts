/** Публичная конфигурация облака. Без ключей соответствующие функции выключены. */

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;
export const supabaseConfigured = Boolean(url && anonKey);
