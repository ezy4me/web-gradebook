import { useState } from 'react';
import { Badge, Button, Sheet, useToast } from './ui';
import { Icon } from './icons';
import { supabaseConfigured } from '../sync/config';
import { getSyncState, phaseLabel, useSyncState } from '../sync/state';

function formatStamp(iso: string | null): string {
  if (!iso) return 'ещё не было';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PHASE_TONE = {
  off: 'neutral',
  idle: 'neutral',
  syncing: 'steel',
  synced: 'success',
  offline: 'warn',
  error: 'danger',
} as const;

export function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useSyncState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Синхронизация"
      description="Supabase · вход через Яндекс ID"
      footer={
        state.signedIn ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              full
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { signOut } = await import('../sync/supabase');
                await signOut();
                setBusy(false);
                toast('Вы вышли из синхронизации');
              }}
            >
              Выйти
            </Button>
            <Button
              full
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { syncNow } = await import('../sync/engine');
                await syncNow('manual');
                setBusy(false);
                const next = getSyncState();
                if (next.phase === 'error') toast(next.error ?? 'Ошибка синхронизации', 'danger');
                else toast('Синхронизация завершена');
              }}
            >
              {busy ? 'Синхронизируем…' : 'Синхронизировать'}
            </Button>
          </div>
        ) : (
          <Button
            full
            size="lg"
            disabled={!supabaseConfigured || busy}
            icon="cloud"
            onClick={async () => {
              try {
                setBusy(true);
                const { signInWithYandex } = await import('../sync/supabase');
                signInWithYandex();
              } catch (error) {
                setBusy(false);
                toast(error instanceof Error ? error.message : 'Не удалось начать вход', 'danger');
              }
            }}
          >
            Войти через Яндекс ID
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {!supabaseConfigured ? (
          <div className="rounded-xl border border-line bg-elevated px-4 py-3.5">
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
              <Icon name="info" size={17} className="text-dim" />
              Синхронизация не подключена
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
              Сборка должна получить <span className="font-mono text-[11.5px]">VITE_SUPABASE_URL</span> и{' '}
              <span className="font-mono text-[11.5px]">VITE_SUPABASE_ANON_KEY</span>. Схема и Edge
              Function уже лежат в репозитории — выполните <span className="font-mono text-[11.5px]">supabase/schema.sql</span> и
              задеплойте <span className="font-mono text-[11.5px]">yandex-oauth</span>.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-faint">
              Без ключей приложение работает как раньше: всё хранится только на устройстве.
            </p>
          </div>
        ) : null}

        {state.signedIn ? (
          <>
            <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-surface">
                <Icon name="cloud" size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{state.email ?? 'Аккаунт'}</p>
                <p className="mt-0.5 text-[12px] text-faint">Яндекс ID · Supabase</p>
              </div>
              <Badge tone={PHASE_TONE[state.phase]}>{phaseLabel(state.phase)}</Badge>
            </div>

            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] text-dim">Последняя синхронизация</span>
                <span className="tnum text-[13px] text-ink">{formatStamp(state.lastSyncAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] text-dim">Состояние</span>
                <span className="text-[13px] text-ink">{state.message}</span>
              </div>
            </div>

            {state.error ? (
              <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
                <p className="text-[12px] font-medium text-danger">Ошибка</p>
                <p className="mt-1 break-words text-[12px] leading-relaxed text-danger">{state.error}</p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-danger/80">
                  Если функция sync_upsert не найдена — примените обновлённый supabase/schema.sql.
                </p>
              </div>
            ) : null}

            <p className="text-[12px] leading-relaxed text-faint">
              Изменения уходят в облако автоматически: при возврате в приложение, по кнопке и раз в
              45 секунд. Офлайн-правки сохраняются и отправятся, когда появится сеть. На каждом
              устройстве войдите тем же Яндекс ID.
            </p>
          </>
        ) : supabaseConfigured ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-dim">
              Войдите, чтобы журнал открывался на телефоне и компьютере. Баллы, посещаемость и
              студенты синхронизируются между устройствами, локальная копия остаётся основной.
            </p>
            <ul className="space-y-1.5 text-[12px] leading-relaxed text-faint">
              <li>• Доступ к строкам защищён RLS: только ваш аккаунт.</li>
              <li>• PIN и тема не синхронизируются — это настройки устройства.</li>
              <li>• Конфликты решаются по времени последнего изменения.</li>
            </ul>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
