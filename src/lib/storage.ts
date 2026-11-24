/** Состояние IndexedDB в браузере: сколько занято и защищено ли хранилище от очистки. */

export interface StorageInfo {
  supported: boolean;
  usage: number;
  quota: number;
  persisted: boolean;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.estimate) {
    return { supported: false, usage: 0, quota: 0, persisted: false };
  }
  try {
    const estimate = await storage.estimate();
    const persisted = storage.persisted ? await storage.persisted() : false;
    return {
      supported: true,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      persisted,
    };
  } catch {
    return { supported: false, usage: 0, quota: 0, persisted: false };
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
