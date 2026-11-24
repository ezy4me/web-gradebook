import { useState } from 'react';
import { Badge, Button, ConfirmSheet, Sheet, useToast } from './ui';
import { Icon } from './icons';
import {
  backupAllDrive,
  pushDirtyDrive,
  restoreDrive,
} from '../drive/backup';
import {
  connectDrive,
  DriveAuthError,
  forgetDriveToken,
  hasDriveToken,
} from '../drive/google';
import { driveConfigured, driveStatusLabel, useDriveState } from '../drive/state';

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

export function DriveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useDriveState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      await connectDrive();
      const files = await backupAllDrive();
      toast(`Google Drive подключён, файлов: ${files}`);
    } catch (error) {
      if (!(error instanceof DriveAuthError)) {
        toast(error instanceof Error ? error.message : 'Не удалось подключить Drive', 'danger');
      }
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    try {
      if (!hasDriveToken()) {
        await connectDrive();
      }
      const saved = await backupAllDrive();
      toast(`Резервная копия: ${saved} файлов`);
    } catch (error) {
      if (!(error instanceof DriveAuthError)) {
        toast(error instanceof Error ? error.message : 'Не удалось сохранить', 'danger');
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const result = await restoreDrive();
      if (result.missing) toast('В Google Drive пока нет резервной копии', 'danger');
      else
        toast(
          `Восстановлено: добавлено ${result.added}, обновлено ${result.updated}, пропущено ${result.skipped}`,
        );
      setConfirmRestore(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось восстановить', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const connected = hasDriveToken() || state.status === 'connected' || state.status === 'syncing';
  const tone =
    state.status === 'error'
      ? 'danger'
      : state.status === 'expired'
        ? 'warn'
        : connected
          ? 'success'
          : 'neutral';

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Google Drive"
        description="Резервная копия в appDataFolder"
        footer={
          connected ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                full
                disabled={busy}
                onClick={() => {
                  setConfirmRestore(true);
                }}
              >
                Восстановить
              </Button>
              <Button full disabled={busy} onClick={() => void backup()}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          ) : (
            <Button
              full
              size="lg"
              icon="cloud"
              disabled={!driveConfigured || busy}
              onClick={() => void connect()}
            >
              {busy ? 'Подключаем…' : 'Подключить Google Drive'}
            </Button>
          )
        }
      >
        <div className="space-y-5">
          {!driveConfigured ? (
            <div className="rounded-xl border border-line bg-elevated px-4 py-3.5">
              <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                <Icon name="info" size={17} className="text-dim" />
                Google Drive не настроен
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                Задайте <span className="font-mono text-[11.5px]">VITE_GOOGLE_CLIENT_ID</span> при сборке и
                добавьте <span className="font-mono text-[11.5px]">https://ezy4me.github.io</span> в
                Authorized JavaScript origins. Scope — только{' '}
                <span className="font-mono text-[11.5px]">drive.appdata</span>.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-surface">
                <Icon name="cloud" size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">Резервная копия</p>
                <p className="mt-0.5 text-[12px] text-faint">Скрытая папка приложения на Диске</p>
              </div>
              <Badge tone={tone}>{driveStatusLabel(state.status)}</Badge>
            </div>
          )}

          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13px] text-dim">Последняя копия</span>
              <span className="tnum text-[13px] text-ink">{formatStamp(state.lastBackupAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13px] text-dim">Состояние</span>
              <span className="text-right text-[13px] text-ink">{state.message}</span>
            </div>
          </div>

          {state.error ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
              <p className="text-[12px] font-medium text-danger">Ошибка</p>
              <p className="mt-1 break-words text-[12px] leading-relaxed text-danger">{state.error}</p>
            </div>
          ) : null}

          <p className="text-[12px] leading-relaxed text-faint">
            После подключения изменения сохраняются автоматически через пару секунд. Доступ — только к
            файлам этого приложения, остальной Диск не виден. Токен живёт час и не покидает браузер.
          </p>

          {connected ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-[12.5px] text-clay underline-offset-2 hover:underline focus-ring"
                disabled={busy}
                onClick={() => {
                  void pushDirtyDrive()
                    .then(() => toast('Изменения сохранены'))
                    .catch((error: unknown) =>
                      toast(error instanceof Error ? error.message : 'Не удалось сохранить', 'danger'),
                    );
                }}
              >
                Сохранить изменения
              </button>
              <button
                type="button"
                className="text-[12.5px] text-faint underline-offset-2 hover:underline focus-ring"
                onClick={() => {
                  forgetDriveToken();
                  toast('Google Drive отключён на этом устройстве');
                }}
              >
                Отключить
              </button>
            </div>
          ) : null}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmRestore}
        title="Восстановить из Google Drive?"
        description="Файлы с Диска сольются с локальной базой по времени изменения: более новые записи останутся, отсутствующие добавятся. Перед восстановлением можно скачать JSON-бэкап."
        confirmLabel={busy ? 'Восстанавливаем…' : 'Восстановить'}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => void restore()}
      />
    </>
  );
}
