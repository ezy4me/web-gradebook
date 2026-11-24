/**
 * Бэкап на Google Drive: по одному JSON-файлу на стор в скрытой appDataFolder.
 *
 * Drive — страховка, а не канал синхронизации: файл перезаписывается целиком,
 * конфликт разрешается на уровне файла (побеждает последняя запись). При
 * восстановлении строки сливаются по updatedAt, как и в остальных импортах.
 */

import type { Table } from 'dexie';
import { db } from '../db/db';
import { nowIso } from '../lib/date';
import {
  clearStoreDirty,
  dirtyStores,
  markAllStoresDirty,
  STORE_ORDER,
  subscribeDirty,
  withoutDirtyTracking,
  type StoreName,
} from '../sync/dirty';
import { driveJson, driveRequest, DriveAuthError, hasDriveToken, preloadDrive } from './google';
import { driveConfigured, getDriveState, setDriveState } from './state';

const FORMAT = 'web-gradebook-store';
const PREFIX = 'web-gradebook:';
const DEBOUNCE_MS = 2500;

let started = false;
let pushing = false;
let pending = false;
let timer: number | null = null;
let fileCache: Map<string, string> | null = null;

interface DriveFile {
  id: string;
  name: string;
}

function fileName(store: StoreName): string {
  return `${PREFIX}${store}`;
}

function tableOf(store: StoreName): Table<{ id: string; updatedAt: string }, string> {
  return (db as unknown as Record<string, Table<{ id: string; updatedAt: string }, string>>)[store];
}

async function listFiles(force = false): Promise<Map<string, string>> {
  if (fileCache && !force) return fileCache;
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    pageSize: '100',
    fields: 'files(id,name)',
    q: "'appDataFolder' in parents and trashed=false",
  });
  const data = await driveJson<{ files?: DriveFile[] }>(`/drive/v3/files?${params.toString()}`);
  const map = new Map<string, string>();
  for (const file of data.files ?? []) map.set(file.name, file.id);
  fileCache = map;
  return map;
}

function multipartBody(name: string, content: string): { body: string; contentType: string } {
  const boundary = `----web-gradebook-${Math.random().toString(16).slice(2)}`;
  const metadata = JSON.stringify({
    name,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function uploadStore(store: StoreName): Promise<void> {
  const rows = await tableOf(store).toArray();
  const content = JSON.stringify({
    format: FORMAT,
    version: 1,
    store: fileName(store),
    updatedAt: nowIso(),
    records: rows,
  });
  const files = await listFiles();
  const existing = files.get(fileName(store));
  if (existing) {
    await driveRequest(`/upload/drive/v3/files/${existing}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content,
    });
    return;
  }
  const { body, contentType } = multipartBody(fileName(store), content);
  const created = await driveJson<{ id: string }>(
    '/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { 'Content-Type': contentType }, body },
  );
  files.set(fileName(store), created.id);
  fileCache = files;
}

async function pushStores(stores: StoreName[], stamps: Map<StoreName, string>): Promise<number> {
  setDriveState({ status: 'syncing', message: 'Сохраняем в Google Drive…', error: null });
  let saved = 0;
  for (const store of stores) {
    await uploadStore(store);
    const stamp = stamps.get(store);
    if (stamp) clearStoreDirty('drive', store, stamp);
    saved += 1;
  }
  const at = nowIso();
  setDriveState({
    status: 'connected',
    message: saved ? `Сохранено файлов: ${saved}` : 'Всё уже сохранено',
    lastBackupAt: at,
    error: null,
  });
  return saved;
}

/** Сохранить только изменённые сторы. */
export async function pushDirtyDrive(): Promise<number> {
  if (!driveConfigured || !hasDriveToken()) return 0;
  if (pushing) {
    pending = true;
    return 0;
  }
  pushing = true;
  try {
    const dirty = dirtyStores('drive');
    const stamps = new Map(dirty.map((item) => [item.store, item.stamp]));
    return await pushStores(
      dirty.map((item) => item.store),
      stamps,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить бэкап';
    setDriveState({
      status: error instanceof DriveAuthError ? 'expired' : 'error',
      message: 'Бэкап не сохранён',
      error: message,
    });
    throw error;
  } finally {
    pushing = false;
    if (pending) {
      pending = false;
      schedulePush();
    }
  }
}

/** Полная резервная копия всех сторов. */
export async function backupAllDrive(): Promise<number> {
  if (!driveConfigured) throw new DriveAuthError('Google Drive не настроен');
  await pushStores([...STORE_ORDER], new Map(dirtyStores('drive').map((item) => [item.store, item.stamp])));
  return STORE_ORDER.length;
}

function schedulePush(): void {
  if (!driveConfigured || !hasDriveToken()) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void pushDirtyDrive().catch(() => {
      /* статус уже обновлён */
    });
  }, DEBOUNCE_MS);
}

export interface RestoreResult {
  stores: number;
  added: number;
  updated: number;
  skipped: number;
  missing: boolean;
}

/** Скачать все файлы и слить с локальной базой по updatedAt. */
export async function restoreDrive(): Promise<RestoreResult> {
  if (!driveConfigured) throw new DriveAuthError('Google Drive не настроен');
  setDriveState({ status: 'syncing', message: 'Читаем резервную копию…', error: null });
  const files = await listFiles(true);
  let stores = 0;
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const store of STORE_ORDER) {
    const id = files.get(fileName(store));
    if (!id) continue;
    const response = await driveRequest(`/drive/v3/files/${id}?alt=media`);
    let parsed: { format?: string; records?: unknown };
    try {
      parsed = (await response.json()) as { format?: string; records?: unknown };
    } catch {
      continue;
    }
    if (parsed.format !== FORMAT || !Array.isArray(parsed.records)) continue;
    stores += 1;
    const table = tableOf(store);
    await withoutDirtyTracking(() =>
      db.transaction('rw', table, async () => {
        for (const raw of parsed.records as { id?: string; updatedAt?: string }[]) {
          if (!raw || typeof raw.id !== 'string') {
            skipped += 1;
            continue;
          }
          const existing = await table.get(raw.id);
          if (existing) {
            if ((existing.updatedAt ?? '') >= (raw.updatedAt ?? '')) {
              skipped += 1;
              continue;
            }
            updated += 1;
          } else {
            added += 1;
          }
          await table.put(raw as never);
        }
      }),
    );
  }

  if (!stores) {
    setDriveState({
      status: 'connected',
      message: 'Резервная копия не найдена',
      error: null,
    });
    return { stores: 0, added: 0, updated: 0, skipped: 0, missing: true };
  }

  // После слияния локальные данные могут быть новее — отправим их обратно.
  markAllStoresDirty();
  setDriveState({
    status: 'connected',
    message: `Восстановлено из ${stores} файлов`,
    lastBackupAt: nowIso(),
    error: null,
  });
  return { stores, added, updated, skipped, missing: false };
}

export function initDrive(): void {
  if (!driveConfigured || started) return;
  started = true;
  void preloadDrive().catch(() => {
    /* скрипт загрузится при подключении */
  });
  if (hasDriveToken()) {
    setDriveState({ status: 'connected', message: 'Google Drive подключён' });
  } else if (getDriveState().status !== 'off') {
    setDriveState({ status: 'disconnected', message: 'Google Drive не подключён' });
  }
  subscribeDirty('drive', () => {
    if (hasDriveToken()) schedulePush();
  });
  if (hasDriveToken() && dirtyStores('drive').length) schedulePush();
  window.addEventListener('online', () => {
    if (hasDriveToken()) schedulePush();
  });
  window.addEventListener('focus', () => {
    if (hasDriveToken() && dirtyStores('drive').length) schedulePush();
  });
}
