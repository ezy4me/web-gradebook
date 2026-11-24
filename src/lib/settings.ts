import { useSyncExternalStore } from 'react';
import type { AppSettings, ThemeMode } from '../db/types';
import { newId, nowIso } from '../lib/date';

const STORAGE_KEY = 'web-gradebook:settings';

function defaults(): AppSettings {
  return {
    id: 'app',
    theme: 'system',
    pinHash: null,
    pinSalt: null,
    autoLockMinutes: 5,
    shortSubjectNames: false,
    autoSnapshot: true,
    snapshotHours: 24,
    lastSubjectId: null,
    updatedAt: nowIso(),
  };
}

function read(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...defaults(), ...parsed, id: 'app' };
  } catch {
    return defaults();
  }
}

let state: AppSettings = read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* приватный режим — настройки останутся в памяти */
  }
}

export function getSettings(): AppSettings {
  return state;
}

export function updateSettings(patch: Partial<Omit<AppSettings, 'id'>>): void {
  state = { ...state, ...patch, updatedAt: nowIso() };
  persist();
  if (patch.theme) applyTheme(patch.theme);
  emit();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  const color = resolved === 'dark' ? '#151412' : '#f2f1ec';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getSettings().theme === 'system') applyTheme('system');
  };
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}

/* --------------------------------- PIN ---------------------------------- */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  }
  // Резервный (небезопасный контекст): детерминированный хеш без WebCrypto.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + data[i], 0x85ebca6b) >>> 0;
  }
  return `fallback:${h1.toString(16)}${h2.toString(16)}`;
}

export async function setPin(pin: string): Promise<void> {
  const salt = newId();
  const pinHash = await sha256(`${salt}:${pin}`);
  updateSettings({ pinSalt: salt, pinHash });
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!state.pinHash || !state.pinSalt) return true;
  const hash = await sha256(`${state.pinSalt}:${pin}`);
  if (hash === state.pinHash) return true;
  // Хеш мог быть создан в небезопасном контексте, а проверка идёт в безопасном
  // (или наоборот) — пробуем второй алгоритм.
  const legacy = await legacyHash(`${state.pinSalt}:${pin}`);
  return legacy === state.pinHash;
}

async function legacyHash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + data[i], 0x85ebca6b) >>> 0;
  }
  return `fallback:${h1.toString(16)}${h2.toString(16)}`;
}

export function clearPin(): void {
  updateSettings({ pinHash: null, pinSalt: null });
}
