// ============================================================================
// yandex-oauth — Supabase Edge Function (СХЕМА ЭТАПА 2, к UI ещё не подключена)
// ============================================================================
// Зачем: hosted Supabase не позволяет зарегистрировать Яндекс как OAuth-провайдера,
// а Яндекс ID не отдаёт OIDC-дискавери. Функция выступает брокером:
//   1) /start    — state + PKCE, редирект на oauth.yandex.ru;
//   2) /callback — обмен code на токен, чтение профиля, создание/поиск пользователя
//                  Supabase через admin API и возврат одноразового token_hash.
//                  Клиент завершает вход: supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }).
//
// Секреты функции (supabase secrets set ...):
//   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET
//   APP_URL (https://ezy4me.github.io/web-gradebook/)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OAUTH_STATE_SECRET (>= 32 символов)
// Redirect URI в Яндекс OAuth:
//   https://<project-ref>.supabase.co/functions/v1/yandex-oauth/callback
//
// Токены Яндекса не сохраняются. После verifyOtp у клиента обычная сессия Supabase,
// и дальше работают RLS-политики auth.uid() = user_id.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const YANDEX_AUTHORIZE = 'https://oauth.yandex.ru/authorize';
const YANDEX_TOKEN = 'https://oauth.yandex.ru/token';
const YANDEX_INFO = 'https://login.yandex.ru/info?format=json';
const STATE_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface StatePayload {
  nonce: string;
  verifier: string;
  exp: number;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();

  const clientId = Deno.env.get('YANDEX_CLIENT_ID');
  const clientSecret = Deno.env.get('YANDEX_CLIENT_SECRET');
  const appUrl = Deno.env.get('APP_URL') ?? 'http://127.0.0.1:5173/web-gradebook/';
  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!clientId || !clientSecret || !stateSecret || !supabaseUrl || !serviceKey) {
    return json({ error: 'function_not_configured' }, 500);
  }

  const callbackUrl = `${url.origin}${url.pathname.replace(/\/start$|\/callback$/, '')}/callback`;

  if (action === 'start') {
    const verifier = randomToken(48);
    const challenge = b64urlEncode(await sha256(verifier));
    const payload: StatePayload = { nonce: randomToken(16), verifier, exp: Date.now() + STATE_TTL_MS };
    const encoded = b64urlEncode(encoder.encode(JSON.stringify(payload)));
    const state = `${encoded}.${b64urlEncode(await hmac(encoded, stateSecret))}`;

    const authorize = new URL(YANDEX_AUTHORIZE);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', callbackUrl);
    authorize.searchParams.set('scope', 'login:email login:info');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    return redirect(authorize.toString());
  }

  if (action === 'callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';
    if (!code) return json({ error: 'missing_code' }, 400);

    const separator = state.lastIndexOf('.');
    if (separator <= 0) return json({ error: 'invalid_state' }, 400);
    const encoded = state.slice(0, separator);
    const signature = state.slice(separator + 1);
    if (!safeEqual(signature, b64urlEncode(await hmac(encoded, stateSecret)))) {
      return json({ error: 'invalid_state' }, 400);
    }

    let payload: StatePayload;
    try {
      payload = JSON.parse(decoder.decode(b64urlDecode(encoded))) as StatePayload;
    } catch {
      return json({ error: 'invalid_state' }, 400);
    }
    if (!payload.exp || payload.exp < Date.now()) return json({ error: 'state_expired' }, 400);

    const tokenResponse = await fetch(YANDEX_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: payload.verifier,
      }),
    });
    if (!tokenResponse.ok) return json({ error: 'yandex_token_failed' }, 502);
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) return json({ error: 'yandex_token_failed' }, 502);

    const infoResponse = await fetch(YANDEX_INFO, {
      headers: { authorization: `OAuth ${token.access_token}` },
    });
    if (!infoResponse.ok) return json({ error: 'yandex_profile_failed' }, 502);
    const profile = (await infoResponse.json()) as {
      id?: string;
      login?: string;
      default_email?: string;
      emails?: string[];
      real_name?: string;
      display_name?: string;
    };
    const yandexId = profile.id;
    const email = profile.default_email ?? profile.emails?.[0];
    if (!yandexId || !email) return json({ error: 'yandex_profile_incomplete' }, 502);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Поиск по app_metadata.yandex_id или email (пагинация admin.listUsers).
    let userId: string | undefined;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: 'supabase_admin_failed' }, 500);
      const found = data.users.find(
        (user) =>
          (user.app_metadata as Record<string, unknown> | undefined)?.yandex_id === yandexId ||
          user.email === email,
      );
      if (found) userId = found.id;
      if (data.users.length < 1000) break;
    }

    if (!userId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          name: profile.real_name ?? profile.display_name ?? profile.login ?? email,
          provider: 'yandex',
        },
        app_metadata: { provider: 'yandex', yandex_id: yandexId },
      });
      if (error || !created.user) return json({ error: 'supabase_user_create_failed' }, 500);
      userId = created.user.id;
    }

    // Одноразовый token_hash: клиент завершает вход через verifyOtp.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError || !link.properties?.hashed_token) {
      return json({ error: 'supabase_link_failed' }, 500);
    }

    const destination = new URL(appUrl);
    destination.hash = `#/auth?token_hash=${encodeURIComponent(link.properties.hashed_token)}`;
    void userId;
    return redirect(destination.toString());
  }

  return json({ error: 'not_found' }, 404);
});

// Осталось сделать на этапе 2 (здесь только брокер):
//   * клиентский маршрут #/auth: supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
//   * mutation queue и pull/push (docs/ARCHITECTURE.md, раздел 4);
//   * таблица oauth_states — если понадобится серверный nonce вместо подписи state.
