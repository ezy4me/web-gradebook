import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  Field,
  Input,
  Row,
  SectionTitle,
  Segmented,
  Select,
  Sheet,
  useToast,
} from '../components/ui';
import { Icon } from '../components/icons';
import { clearPin, setPin, updateSettings, useSettings, verifyPin } from '../lib/settings';
import type { ThemeMode } from '../db/types';

type PinMode = 'set' | 'change' | 'disable';

export function SettingsScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [pinMode, setPinMode] = useState<PinMode | null>(null);

  return (
    <Page title="Настройки" subtitle="вид, доступ и данные">
      <SectionTitle>Оформление</SectionTitle>
      <Segmented
        value={settings.theme}
        onChange={(theme: ThemeMode) => updateSettings({ theme })}
        options={[
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
          { value: 'system', label: 'Системная' },
        ]}
      />
      <p className="mt-2 text-[12px] leading-snug text-faint">
        «Системная» повторяет настройку телефона. Тема применяется до первой отрисовки.
      </p>

      <SectionTitle>Доступ</SectionTitle>
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <Row
          label={settings.pinHash ? 'PIN установлен' : 'PIN не задан'}
          hint={settings.pinHash ? 'Блокировка при запуске и после простоя' : 'Защищает интерфейс на этом устройстве'}
          right={
            <Badge tone={settings.pinHash ? 'success' : 'neutral'}>{settings.pinHash ? 'вкл' : 'выкл'}</Badge>
          }
        />
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {settings.pinHash ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setPinMode('change')}>
                Изменить PIN
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setPinMode('disable')}>
                Отключить
              </Button>
            </>
          ) : (
            <Button size="sm" icon="lock" onClick={() => setPinMode('set')}>
              Установить PIN
            </Button>
          )}
        </div>
        {settings.pinHash ? (
          <div className="px-4 py-3">
            <p className="mb-2 text-[12.5px] text-dim">Блокировать после простоя</p>
            <Select
              value={String(settings.autoLockMinutes)}
              onChange={(event) => updateSettings({ autoLockMinutes: Number(event.target.value) || 5 })}
              aria-label="Автоблокировка"
              className="h-11"
            >
              {[1, 2, 5, 10, 15, 30].map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {minutes} мин
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <SectionTitle>Данные</SectionTitle>
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <Row label="Экспорт и импорт" hint="Полный бэкап JSON, восстановление, очистка" onClick={() => navigate('/data')} />
        <Row label="Google Drive" hint="Резервная копия в appDataFolder" right={<Badge tone="warn">этап 3</Badge>} />
        <Row label="Supabase" hint="Синхронизация через Яндекс ID" right={<Badge tone="warn">этап 2</Badge>} />
      </div>

      <SectionTitle>О приложении</SectionTitle>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-surface">
          <Icon name="book" size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium text-ink">web-gradebook</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            Офлайн-журнал преподавателя: предметы, группы, занятия, сессии, баллы и посещаемость.
            Версия 0.6.0.
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            Данные не покидают устройство. React, Vite, Dexie, Tailwind. Сделано для работы одной рукой
            на паре.
          </p>
        </div>
      </div>

      <PinSheet
        mode={pinMode}
        onClose={() => setPinMode(null)}
        onDone={(message) => {
          toast(message);
          setPinMode(null);
        }}
      />
    </Page>
  );
}

function PinSheet({
  mode,
  onClose,
  onDone,
}: {
  mode: PinMode | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent('');
    setPinValue('');
    setConfirm('');
  };

  const title =
    mode === 'set' ? 'Установить PIN' : mode === 'change' ? 'Изменить PIN' : 'Отключить PIN';
  const needsCurrent = mode === 'change' || mode === 'disable';
  const needsNew = mode !== 'disable';

  const submit = async () => {
    if (!mode || busy) return;
    setBusy(true);
    try {
      if (needsCurrent) {
        const ok = await verifyPin(current);
        if (!ok) {
          toast('Текущий PIN неверный', 'danger');
          return;
        }
      }
      if (mode === 'disable') {
        clearPin();
        onDone('PIN отключён');
        return;
      }
      if (!/^\d{4,8}$/.test(pin)) {
        toast('PIN — от 4 до 8 цифр', 'danger');
        return;
      }
      if (pin !== confirm) {
        toast('PIN-коды не совпадают', 'danger');
        return;
      }
      await setPin(pin);
      reset();
      onDone(mode === 'set' ? 'PIN установлен' : 'PIN изменён');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={Boolean(mode)}
      onClose={() => {
        reset();
        onClose();
      }}
      title={title}
      description={
        mode === 'disable'
          ? 'Приложение перестанет спрашивать PIN при запуске.'
          : 'PIN хранится как SHA-256 с солью, не в открытом виде.'
      }
      footer={
        <Button
          full
          size="lg"
          variant={mode === 'disable' ? 'danger' : 'primary'}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Проверяем…' : mode === 'disable' ? 'Отключить PIN' : 'Сохранить'}
        </Button>
      }
    >
      <div className="space-y-4">
        {needsCurrent ? (
          <Field label="Текущий PIN" htmlFor="pin-current">
            <Input
              id="pin-current"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={current}
              onChange={(event) => setCurrent(event.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </Field>
        ) : null}
        {needsNew ? (
          <>
            <Field label="Новый PIN (4–8 цифр)" htmlFor="pin-new">
              <Input
                id="pin-new"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(event) => setPinValue(event.target.value.replace(/\D/g, ''))}
                autoFocus={!needsCurrent}
              />
            </Field>
            <Field label="Повторите PIN" htmlFor="pin-confirm">
              <Input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        ) : null}
        <p className="text-[12px] leading-relaxed text-faint">
          Восстановления PIN нет: если забыть код, останется только очистить данные браузера. Делайте
          JSON-бэкапы.
        </p>
      </div>
    </Sheet>
  );
}
