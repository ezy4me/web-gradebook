/**
 * Синхронизация с Supabase.
 *
 * Схема простая и устойчивая к офлайну:
 *  1. pull — читаем все строки своих таблиц (RLS) и применяем LWW по updatedAt;
 *  2. push — отправляем только «грязные» сторы через RPC sync_upsert, который
 *     обновляет строку, лишь если пришла более новая версия.
 *
 * Полный pull выбран сознательно: у преподавателя тысячи строк, а не миллионы,
 * зато нет проблем с расхождением часов и пропущенными окнами updated_at.
 */

import type { Session } from '@supabase/supabase-js';
import type { Table } from 'dexie';
import { db } from '../db/db';
import {
  clearStoreDirty,
  dirtyStores,
  markAllStoresDirty,
  markChannelDirty,
  subscribeDirty,
  withoutDirtyTracking,
} from './dirty';
import { getSyncState, setSyncState } from './state';
import { supabase, supabaseConfigured } from './supabase';
import { specFor, TABLES, type RemoteRow } from './tables';

const PULL_PAGE = 1000;
const PUSH_PAGE = 200;
const TIMER_MS = 45_000;

let started = false;
let running = false;
let queued = false;
let session: Session | null = null;
let timer: number | null = null;
let changeTimer: number | null = null;

function messageOf(error: unknown): string {
  if (!error) return 'Неизвестная ошибка';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: string; details?: string; hint?: string };
  return candidate.message ?? candidate.details ?? candidate.hint ?? 'Ошибка синхронизации';
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function applySession(next: Session | null): Promise<void> {
  session = next;
  setSyncState({
    signedIn: Boolean(next),
    email: next?.user.email ?? null,
    phase: next ? (offline() ? 'offline' : 'idle') : supabaseConfigured ? 'idle' : 'off',
    message: next ? (offline() ? 'Нет сети — изменения ждут' : 'Готово') : 'Вход не выполнен',
    error: null,
  });
}

async function pull(): Promise<void> {
  const client = supabase;
  if (!client) return;
  for (const spec of TABLES) {
    let from = 0;
    for (;;) {
      const { data, error } = await client
        .from(spec.table)
        .select('*')
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PULL_PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as RemoteRow[];
      if (!rows.length) break;

      const table = (db as unknown as Record<string, Table<{ id: string; updatedAt: string }>>)[
        spec.store
      ];
      let changed = false;
      await withoutDirtyTracking(() =>
        db.transaction('rw', table, async () => {
          for (const remote of rows) {
            let local;
            try {
              local = spec.fromRemote(remote) as { id: string; updatedAt: string };
            } catch {
              continue;
            }
            if (!local.id) continue;
            const existing = await table.get(local.id);
            if (existing && (existing.updatedAt ?? '') >= (local.updatedAt ?? '')) continue;
            await table.put(local as never);
            changed = true;
          }
        }),
      );
      // Данные пришли из Supabase — пусть Drive тоже обновит резервную копию.
      if (changed) markChannelDirty('drive', spec.store);

      if (rows.length < PULL_PAGE) break;
      from += PULL_PAGE;
    }
  }
}

async function push(): Promise<void> {
  const client = supabase;
  if (!client || !session) return;
  const userId = session.user.id;
  for (const { store, stamp } of dirtyStores('supabase')) {
    const spec = specFor(store);
    const table = (db as unknown as Record<string, Table<unknown>>)[store];
    const rows = await table.toArray();
    const payload = rows.map((row) => spec.toRemote(row, userId));
    for (let index = 0; index < payload.length; index += PUSH_PAGE) {
      const chunk = payload.slice(index, index + PUSH_PAGE);
      const { error } = await client.rpc('sync_upsert', {
        p_table: spec.table,
        p_rows: chunk,
      });
      if (error) throw error;
    }
    clearStoreDirty('supabase', store, stamp);
  }
}

export async function syncNow(reason = 'manual'): Promise<void> {
  if (!supabase || !supabaseConfigured) return;
  if (running) {
    queued = true;
    return;
  }
  if (offline()) {
    setSyncState({ phase: 'offline', message: 'Нет сети — изменения ждут' });
    return;
  }
  running = true;
  queued = false;
  setSyncState({ phase: 'syncing', message: 'Обмен с облаком…', error: null });
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      await applySession(null);
      setSyncState({ phase: 'idle', message: 'Нужен вход через Яндекс ID' });
      return;
    }
    session = data.session;

    await pull();
    await push();

    const stamp = new Date().toISOString();
    setSyncState({
      phase: 'synced',
      message: reason === 'startup' ? 'Данные с облаком совпадают' : 'Синхронизировано',
      lastSyncAt: stamp,
      error: null,
      signedIn: true,
      email: session.user.email ?? null,
    });
  } catch (error) {
    const text = messageOf(error);
    setSyncState({
      phase: offline() ? 'offline' : 'error',
      message: offline() ? 'Нет сети — изменения ждут' : 'Не удалось синхронизировать',
      error: text,
    });
  } finally {
    running = false;
    if (queued) {
      queued = false;
      window.setTimeout(() => void syncNow('queued'), 250);
    }
  }
}

/** Вызывается один раз при старте приложения. */
export function initSync(): void {
  if (!supabaseConfigured || !supabase || started) return;
  started = true;

  void supabase.auth.getSession().then(({ data }) => {
    void applySession(data.session);
    if (data.session) void syncNow('startup');
  });

  supabase.auth.onAuthStateChange((event, next) => {
    void applySession(next);
    if (event === 'SIGNED_IN' && next) {
      // Первый вход: отправляем на сервер всё, что уже есть на устройстве.
      markAllStoresDirty();
      void syncNow('signin');
    }
    if (event === 'SIGNED_OUT') {
      setSyncState({ phase: 'idle', message: 'Вход не выполнен', error: null });
    }
  });

  window.addEventListener('online', () => {
    if (getSyncState().signedIn) void syncNow('online');
  });
  window.addEventListener('offline', () => {
    setSyncState({ phase: 'offline', message: 'Нет сети — изменения ждут' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getSyncState().signedIn) void syncNow('visible');
  });
  window.addEventListener('focus', () => {
    if (getSyncState().signedIn) void syncNow('focus');
  });

  // После правки не ждём таймера: отправляем через пару секунд тишины.
  subscribeDirty('supabase', () => {
    if (!getSyncState().signedIn || offline()) return;
    if (changeTimer) window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      changeTimer = null;
      void syncNow('change');
    }, 3000);
  });

  timer = window.setInterval(() => {
    if (getSyncState().signedIn && !document.hidden) void syncNow('timer');
  }, TIMER_MS);
  void timer;
}
