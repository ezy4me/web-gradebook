import { useSyncExternalStore } from 'react';

/** Отдельный OAuth-поток Google Drive, не связанный с Supabase. */

const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
export const driveConfigured = Boolean(clientId);
export const googleClientId = clientId;

export type DriveStatus =
  | 'off'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'expired'
  | 'error';

export interface DriveState {
  configured: boolean;
  status: DriveStatus;
  lastBackupAt: string | null;
  error: string | null;
  message: string;
}

const LAST_KEY = 'web-gradebook:drive-last';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

let state: DriveState = {
  configured: driveConfigured,
  status: driveConfigured ? 'disconnected' : 'off',
  lastBackupAt: readLast(),
  error: null,
  message: driveConfigured ? 'Не подключено' : 'Ключ Google не задан',
};

const listeners = new Set<() => void>();

export function getDriveState(): DriveState {
  return state;
}

export function setDriveState(patch: Partial<DriveState>): void {
  state = { ...state, ...patch };
  if (patch.lastBackupAt) {
    try {
      localStorage.setItem(LAST_KEY, patch.lastBackupAt);
    } catch {
      /* ignore */
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeDrive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDriveState(): DriveState {
  return useSyncExternalStore(subscribeDrive, getDriveState, getDriveState);
}

export function driveStatusLabel(status: DriveStatus): string {
  switch (status) {
    case 'off':
      return 'выключено';
    case 'disconnected':
      return 'не подключено';
    case 'connecting':
      return 'подключение';
    case 'connected':
      return 'подключено';
    case 'syncing':
      return 'сохранение';
    case 'expired':
      return 'нужно войти';
    case 'error':
      return 'ошибка';
  }
}
