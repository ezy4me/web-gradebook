/**
 * «Грязные» сторы для облачных каналов.
 *
 * У Supabase и Google Drive независимые карты: каждый канал снимает свою отметку
 * после успешной отправки и не «съедает» изменение у другого. Вместо очереди на
 * каждую запись храним отметку времени по стору — набор данных преподавателя
 * небольшой, поэтому push целиком стора дешевле и надёжнее: не теряется при
 * bulk-операциях, импорте и modify(). Отметки живут в localStorage, чтобы
 * пережить перезапуск вкладки.
 */

export type StoreName =
  | 'subjects'
  | 'groups'
  | 'groupMembers'
  | 'subgroups'
  | 'students'
  | 'enrollments'
  | 'activities'
  | 'sessions'
  | 'grades'
  | 'attendance';

export type SyncChannel = 'supabase' | 'drive';

export const CHANNELS: SyncChannel[] = ['supabase', 'drive'];

export const STORE_ORDER: StoreName[] = [
  'subjects',
  'groups',
  'groupMembers',
  'subgroups',
  'students',
  'enrollments',
  'activities',
  'sessions',
  'grades',
  'attendance',
];

type DirtyMap = Partial<Record<StoreName, string>>;

const KEY_PREFIX = 'web-gradebook:dirty:';
const listeners: Record<SyncChannel, Set<() => void>> = {
  supabase: new Set(),
  drive: new Set(),
};
const memory: Partial<Record<SyncChannel, DirtyMap>> = {};
let suppressed = 0;

function key(channel: SyncChannel): string {
  return `${KEY_PREFIX}${channel}`;
}

function read(channel: SyncChannel): DirtyMap {
  const cached = memory[channel];
  if (cached) return cached;
  let parsed: DirtyMap = {};
  try {
    const raw = localStorage.getItem(key(channel));
    parsed = raw ? (JSON.parse(raw) as DirtyMap) : {};
  } catch {
    parsed = {};
  }
  memory[channel] = parsed;
  return parsed;
}

function write(channel: SyncChannel, value: DirtyMap, notify = true): void {
  memory[channel] = value;
  try {
    localStorage.setItem(key(channel), JSON.stringify(value));
  } catch {
    /* приватный режим — остаёмся в памяти */
  }
  if (notify) for (const listener of listeners[channel]) listener();
}

/** Пометить стор грязным сразу для Supabase и Google Drive. */
export function markStoreDirty(store: StoreName): void {
  if (suppressed > 0) return;
  const stamp = new Date().toISOString();
  for (const channel of CHANNELS) {
    write(channel, { ...read(channel), [store]: stamp });
  }
}

/** Пометить только один канал (например, данные пришли из Supabase — нужен бэкап Drive). */
export function markChannelDirty(channel: SyncChannel, store: StoreName): void {
  if (suppressed > 0) return;
  write(channel, { ...read(channel), [store]: new Date().toISOString() });
}

export function markAllStoresDirty(): void {
  const stamp = new Date().toISOString();
  const next: DirtyMap = {};
  for (const store of STORE_ORDER) next[store] = stamp;
  for (const channel of CHANNELS) write(channel, next);
}

export function dirtyStores(channel: SyncChannel): { store: StoreName; stamp: string }[] {
  const current = read(channel);
  return STORE_ORDER.filter((store) => Boolean(current[store])).map((store) => ({
    store,
    stamp: current[store] as string,
  }));
}

/** Снять отметку, только если за время push стор не изменился снова. */
export function clearStoreDirty(channel: SyncChannel, store: StoreName, stamp: string): void {
  const current = read(channel);
  if (current[store] !== stamp) return;
  const next = { ...current };
  delete next[store];
  write(channel, next, false);
}

export function hasDirtyStores(channel: SyncChannel): boolean {
  return dirtyStores(channel).length > 0;
}

export function subscribeDirty(channel: SyncChannel, listener: () => void): () => void {
  listeners[channel].add(listener);
  return () => listeners[channel].delete(listener);
}

/** Записи, пришедшие из облака, не должны снова становиться «грязными». */
export async function withoutDirtyTracking<T>(fn: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await fn();
  } finally {
    suppressed -= 1;
  }
}
