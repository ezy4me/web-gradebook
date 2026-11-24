import { useSyncExternalStore } from 'react';
import { supabaseConfigured } from './config';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncState {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  phase: SyncPhase;
  /** Короткое описание для интерфейса. */
  message: string;
  lastSyncAt: string | null;
  error: string | null;
}

const LAST_KEY = 'web-gradebook:last-sync';

function readLastSync(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

let state: SyncState = {
  configured: supabaseConfigured,
  signedIn: false,
  email: null,
  phase: supabaseConfigured ? 'idle' : 'off',
  message: supabaseConfigured ? 'Готово к входу' : 'Ключи Supabase не заданы',
  lastSyncAt: readLastSync(),
  error: null,
};

const listeners = new Set<() => void>();

export function getSyncState(): SyncState {
  return state;
}

export function setSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  if (patch.lastSyncAt) {
    try {
      localStorage.setItem(LAST_KEY, patch.lastSyncAt);
    } catch {
      /* ignore */
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

export function phaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case 'off':
      return 'выключено';
    case 'idle':
      return 'ожидает';
    case 'syncing':
      return 'синхронизация';
    case 'synced':
      return 'синхронизировано';
    case 'offline':
      return 'офлайн';
    case 'error':
      return 'ошибка';
  }
}
