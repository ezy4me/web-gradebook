/**
 * Google Identity Services + Drive REST.
 *
 * Токен живёт час и лежит в sessionStorage: он не нужен после закрытия вкладки,
 * а scope drive.appdata даёт доступ только к скрытой папке приложения.
 */

import { driveConfigured, googleClientId, setDriveState } from './state';

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'web-gradebook:drive-token';
const CONNECTED_KEY = 'web-gradebook:drive-known';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => TokenClient;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

let token: StoredToken | null = readToken();
let tokenClient: TokenClient | null = null;
let loading: Promise<void> | null = null;
let pending:
  | { resolve: () => void; reject: (error: Error) => void }
  | null = null;

export class DriveAuthError extends Error {
  constructor(message = 'Нужно подключить Google Drive') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

function readToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken || parsed.expiresAt <= Date.now() + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToken(response: TokenResponse): StoredToken | null {
  if (!response.access_token) return null;
  const seconds = Number(response.expires_in ?? 3600);
  const stored: StoredToken = {
    accessToken: response.access_token,
    expiresAt: Date.now() + Math.max(60, seconds - 60) * 1000,
  };
  token = stored;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
    localStorage.setItem(CONNECTED_KEY, '1');
  } catch {
    /* ignore */
  }
  return stored;
}

export function hasDriveToken(): boolean {
  token = readToken();
  return Boolean(token);
}

export function forgetDriveToken(): void {
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  setDriveState({
    status: 'disconnected',
    message: 'Доступ отозван на этом устройстве',
    error: null,
  });
}

function ensureGis(): Promise<void> {  if (!driveConfigured) return Promise.reject(new DriveAuthError('Google Drive не настроен'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('Не удалось загрузить Google Identity Services'));
    };
    if (!existing) document.head.appendChild(script);
  });
  return loading;
}

/** Заранее подтянуть GIS, чтобы кнопка «Подключить» успела в жесте пользователя. */
export async function preloadDrive(): Promise<void> {
  await ensureGis();
  ensureClient();
}

function ensureClient(): TokenClient {
  if (tokenClient) return tokenClient;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new DriveAuthError('Google Identity Services ещё не загружены');
  tokenClient = oauth2.initTokenClient({
    client_id: googleClientId,
    scope: SCOPE,
    callback: (response) => {
      if (response.error || !response.access_token) {
        const error = new Error(response.error_description ?? response.error ?? 'Доступ не выдан');
        pending?.reject(error);
        pending = null;
        setDriveState({ status: 'error', message: 'Google не выдал доступ', error: error.message });
        return;
      }
      saveToken(response);
      setDriveState({
        status: 'connected',
        message: 'Google Drive подключён',
        error: null,
      });
      pending?.resolve();
      pending = null;
    },
    error_callback: (error) => {
      const message = error.message ?? 'Окно входа закрыто';
      pending?.reject(new Error(message));
      pending = null;
      setDriveState({ status: 'error', message: 'Вход не завершён', error: message });
    },
  });
  return tokenClient;
}

/** Запросить токен. Должно вызываться из обработчика нажатия. */
export async function connectDrive(): Promise<void> {
  if (!driveConfigured) throw new DriveAuthError('Google Drive не настроен');
  await ensureGis();
  const client = ensureClient();
  setDriveState({ status: 'connecting', message: 'Открываем окно Google…', error: null });
  const known = localStorage.getItem(CONNECTED_KEY) === '1';
  const request = (prompt: string) =>
    new Promise<void>((resolve, reject) => {
      pending = { resolve, reject };
      client.requestAccessToken({ prompt });
    });
  try {
    await request(known ? '' : 'consent');
  } catch (error) {
    // Тихое обновление не сработало (истёк consent) — показываем окно ещё раз.
    if (!known) throw error;
    await request('consent');
  }
}

export async function requireToken(interactive = false): Promise<string> {
  token = readToken();
  if (token) return token.accessToken;
  if (interactive) {
    await connectDrive();
    token = readToken();
    if (token) return token.accessToken;
  }
  setDriveState({
    status: 'expired',
    message: 'Доступ истёк — подключите Drive снова',
  });
  throw new DriveAuthError();
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await requireToken(false);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`https://www.googleapis.com${path}`, { ...init, headers });
  if (response.status === 401) {
    forgetDriveToken();
    setDriveState({ status: 'expired', message: 'Доступ истёк — подключите Drive снова' });
    throw new DriveAuthError('Доступ к Google Drive истёк');
  }
  return response;
}

export async function driveJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await driveFetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive: ${response.status} ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function driveRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await driveFetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive: ${response.status} ${text.slice(0, 300)}`);
  }
  return response;
}
