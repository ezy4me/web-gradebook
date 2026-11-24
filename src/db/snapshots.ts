/**
 * Локальные снимки базы.
 *
 * Браузер не умеет молча писать произвольный файл на диск, поэтому автоматические
 * копии складываются в отдельный стор IndexedDB. Это защищает от ошибочного
 * удаления, неудачного импорта и «сломанного» дня — но не от потери устройства.
 * Для внешней копии остаётся JSON-файл и Google Drive.
 */

import { db } from './db';
import type { BackupFile, LocalSnapshot } from './types';
import { newId, nowIso } from '../lib/date';
import { getSettings } from '../lib/settings';
import { buildBackup, downloadJson, importBackup } from './backup';

const KEEP_AUTO = 8;
const KEEP_MANUAL = 6;
const CHECK_MS = 15 * 60 * 1000;

let started = false;

export const SNAPSHOT_REASON_LABEL: Record<LocalSnapshot['reason'], string> = {
  auto: 'автоматически',
  manual: 'вручную',
  'before-import': 'перед импортом',
  'before-wipe': 'перед очисткой',
};

export async function listSnapshots(): Promise<LocalSnapshot[]> {
  return db.snapshots.orderBy('createdAt').reverse().toArray();
}

export async function latestSnapshot(reason?: LocalSnapshot['reason']): Promise<LocalSnapshot | undefined> {
  const all = await listSnapshots();
  return reason ? all.find((snapshot) => snapshot.reason === reason) : all[0];
}

export async function createSnapshot(
  reason: LocalSnapshot['reason'] = 'manual',
): Promise<LocalSnapshot> {
  const backup = await buildBackup();
  const serialized = JSON.stringify(backup);
  const snapshot: LocalSnapshot = {
    id: newId(),
    createdAt: nowIso(),
    reason,
    bytes: new Blob([serialized]).size,
    backup,
  };
  await db.snapshots.add(snapshot);
  await prune();
  return snapshot;
}

async function prune(): Promise<void> {
  const all = await listSnapshots();
  const auto = all.filter((snapshot) => snapshot.reason === 'auto');
  const manual = all.filter((snapshot) => snapshot.reason !== 'auto');
  const remove = [
    ...auto.slice(KEEP_AUTO),
    ...manual.slice(KEEP_MANUAL),
  ];
  if (remove.length) await db.snapshots.bulkDelete(remove.map((snapshot) => snapshot.id));
}

/** Создать снимок, если включён автобэкап и интервал прошёл. */
export async function maybeCreateAutoSnapshot(): Promise<LocalSnapshot | null> {
  const settings = getSettings();
  if (!settings.autoSnapshot) return null;
  const subjects = await db.subjects.filter((subject) => !subject.deletedAt).count();
  if (!subjects) return null;
  const last = await latestSnapshot('auto');
  const interval = Math.max(1, settings.snapshotHours) * 60 * 60 * 1000;
  if (last && Date.now() - new Date(last.createdAt).getTime() < interval) return null;
  return createSnapshot('auto');
}

export async function restoreSnapshot(id: string) {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new Error('Копия не найдена');
  await createSnapshot('before-import');
  const result = await importBackup(snapshot.backup as BackupFile, 'replace');
  return { result, snapshot };
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id);
}

export function downloadSnapshot(snapshot: LocalSnapshot): void {
  const date = new Date(snapshot.createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
  downloadJson(snapshot.backup, `web-gradebook-snapshot-${stamp}.json`);
}

/** Проверка расписания при запуске, возврате во вкладку и раз в 15 минут. */
export function initSnapshotScheduler(): void {
  if (started) return;
  started = true;
  const check = () => {
    void maybeCreateAutoSnapshot().catch(() => {
      /* места на диске нет — не мешаем работе */
    });
  };
  check();
  window.setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
}
