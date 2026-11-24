import { useEffect, useRef, useState } from 'react';
import { verifyPin } from '../lib/settings';
import { Icon } from './icons';
import { Button, Input } from './ui';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    const ok = await verifyPin(pin);
    setBusy(false);
    if (ok) {
      onUnlock();
      return;
    }
    setError(true);
    setPin('');
    inputRef.current?.focus();
    window.setTimeout(() => setError(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-bg safe-top safe-bottom">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-line text-clay">
          <Icon name="lock" size={22} />
        </div>
        <h1 className="display text-center text-[26px] leading-tight text-ink">Журнал закрыт</h1>
        <p className="mt-1.5 text-center text-[13px] text-dim">Введите PIN-код устройства</p>

        <div className="mt-8 w-full max-w-[260px]">
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            placeholder="••••"
            aria-label="PIN-код"
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            className={`h-14 text-center text-[22px] tracking-[0.4em] ${error ? 'border-danger' : ''}`}
          />
          <p className={`mt-2 h-4 text-center text-[12px] ${error ? 'text-danger' : 'text-faint'}`}>
            {error ? 'Неверный PIN-код' : ' '}
          </p>
          <Button full size="lg" onClick={() => void submit()} disabled={pin.length < 4 || busy} className="mt-1">
            {busy ? 'Проверяем…' : 'Разблокировать'}
          </Button>
        </div>
      </div>
      <p className="px-6 pb-5 text-center text-[11.5px] leading-relaxed text-faint">
        Данные хранятся только на этом устройстве. PIN защищает доступ к интерфейсу.
      </p>
    </div>
  );
}
