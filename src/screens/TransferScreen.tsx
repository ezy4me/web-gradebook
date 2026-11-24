import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import { Badge, Button, Progress, Spinner, Textarea, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import {
  buildBackup,
  importBackup,
  parseBackup,
  type ImportResult,
} from '../db/backup';
import { createSnapshot } from '../db/snapshots';
import { QrImage, QrScanner } from '../transfer/Qr';
import { TransferPeer } from '../transfer/webrtc';
import type { TransferIntent } from '../transfer/codec';

type Mode =
  | 'intro'
  | 'gathering'
  | 'offer'
  | 'scan-answer'
  | 'scan-offer'
  | 'answer'
  | 'waiting'
  | 'sending'
  | 'receiving'
  | 'done'
  | 'error';

export function TransferScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const peerRef = useRef<TransferPeer | null>(null);
  const intentRef = useRef<TransferIntent>('send');
  const mounted = useRef(true);
  const [mode, setMode] = useState<Mode>('intro');
  const [intent, setIntent] = useState<TransferIntent>('send');
  const [code, setCode] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      peerRef.current?.close();
    };
  }, []);

  const fail = (message: string) => {
    if (!mounted.current) return;
    setError(message);
    setMode('error');
  };

  const makePeer = () => {
    const peer = new TransferPeer({
      onOpen: () => {
        if (!mounted.current) return;
        if (intentRef.current === 'send') {
          setMode('sending');
          void sendJournal();
        } else {
          setMode('receiving');
        }
      },
      onProgress: (bytes, total) => {
        if (!mounted.current) return;
        setProgress(total ? Math.round((bytes / total) * 100) : 0);
      },
      onBackup: (backup) => {
        void receiveJournal(backup);
      },
      onError: (cause) => fail(cause.message),
    });
    peerRef.current = peer;
    return peer;
  };

  const sendJournal = async () => {
    try {
      const peer = peerRef.current;
      if (!peer) return;
      const backup = await buildBackup();
      await peer.sendBackup(backup);
      if (!mounted.current) return;
      setProgress(100);
      setMode('done');
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'Не удалось отправить данные');
    }
  };

  const receiveJournal = async (raw: unknown) => {
    try {
      const backup = parseBackup(JSON.stringify(raw));
      await createSnapshot('before-import');
      const imported = await importBackup(backup, 'merge');
      if (!mounted.current) return;
      setResult(imported);
      setProgress(100);
      setMode('done');
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'Не удалось принять данные');
    }
  };

  const reset = (next: Mode = 'intro') => {
    peerRef.current?.close();
    peerRef.current = null;
    setCode('');
    setProgress(0);
    setError('');
    setResult(null);
    setManualOpen(false);
    setManualCode('');
    setMode(next);
  };

  const startHost = async (nextIntent: TransferIntent) => {
    reset('gathering');
    setIntent(nextIntent);
    intentRef.current = nextIntent;
    try {
      const peer = makePeer();
      const offer = await peer.createOffer(nextIntent);
      if (!mounted.current) return;
      setCode(offer);
      setMode('offer');
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'Не удалось создать код');
    }
  };

  const startGuest = () => {
    reset('scan-offer');
  };

  const acceptOffer = async (value: string) => {
    setMode('gathering');
    setManualOpen(false);
    try {
      const peer = makePeer();
      const { answer, intent: guestIntent } = await peer.acceptOffer(value);
      if (!mounted.current) return;
      setIntent(guestIntent);
      intentRef.current = guestIntent;
      setCode(answer);
      setProgress(0);
      setMode('answer');
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'Не удалось прочитать код');
    }
  };

  const acceptAnswer = async (value: string) => {
    setMode('gathering');
    setManualOpen(false);
    try {
      const peer = peerRef.current;
      if (!peer) throw new Error('Сначала создайте код');
      await peer.acceptAnswer(value);
      if (mounted.current) setMode((current) => (current === 'gathering' ? 'waiting' : current));
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'Не удалось прочитать ответ');
    }
  };

  const applyManual = () => {
    const value = manualCode.trim();
    if (!value) return;
    if (mode === 'scan-offer') void acceptOffer(value);
    else void acceptAnswer(value);
  };

  const busy = mode === 'gathering' || mode === 'waiting' || mode === 'sending' || mode === 'receiving';
  const receiver = intent === 'receive';

  if (mode === 'intro') {
    return (
      <Page title="Перенос по QR" subtitle="напрямую между устройствами" back backTo="/data">
        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elevated text-ink">
            <Icon name="qr" size={24} />
          </div>
          <p className="display mt-4 text-[23px] leading-snug text-ink">Два устройства, один журнал</p>
          <p className="mt-2 text-[13px] leading-relaxed text-dim">
            Одно устройство показывает QR, второе сканирует. Данные идут напрямую по Wi-Fi или
            мобильной сети, без сервера и аккаунта.
          </p>
          <div className="mt-5 space-y-2">
            <Button full size="lg" icon="upload" onClick={() => void startHost('send')}>
              Передать с этого устройства
            </Button>
            <Button full size="lg" variant="secondary" icon="download" onClick={() => void startHost('receive')}>
              Принять на это устройство
            </Button>
          </div>
          <div className="my-5 flex items-center gap-3 text-[11.5px] text-faint">
            <span className="h-px flex-1 bg-line" />
            или
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button full variant="soft" icon="qr" onClick={startGuest}>
            Сканировать код другого устройства
          </Button>
        </div>

        <div className="mt-4 space-y-2 text-[12px] leading-relaxed text-faint">
          <p>• Нужна камера на обоих устройствах — без неё коды не отсканировать.</p>
          <p>• Лучше одна сеть Wi-Fi; в закрытых сетях соединение может не подняться.</p>
          <p>• Данные передаются в зашифрованном WebRTC-канале, копия перед импортом сохраняется.</p>
        </div>
      </Page>
    );
  }

  if (mode === 'scan-offer' || mode === 'scan-answer') {
    const scanningAnswer = mode === 'scan-answer';
    return (
      <Page title={scanningAnswer ? 'Ответный код' : 'Сканировать код'} subtitle="наведите камеру" back backTo="/transfer">
        <QrScanner
          onResult={(value) => {
            if (scanningAnswer) void acceptAnswer(value);
            else void acceptOffer(value);
          }}
          onCancel={() => reset(scanningAnswer ? 'offer' : 'intro')}
        />
        <div className="mt-3">
          {manualOpen ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <Textarea
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                rows={5}
                spellCheck={false}
                placeholder="Вставьте код, начинающийся с WGB1…"
                className="font-mono text-[10px]"
                autoFocus
              />
              <Button full className="mt-3" disabled={!manualCode.trim()} onClick={applyManual}>
                Применить код
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="w-full py-2 text-[12px] text-clay underline-offset-2 hover:underline focus-ring"
            >
              Вставить код текстом
            </button>
          )}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-faint">
          {scanningAnswer
            ? 'Этот код показывает второе устройство после сканирования первого QR.'
            : 'Отсканируйте QR, который показывает первое устройство.'}
        </p>
      </Page>
    );
  }

  if (busy || mode === 'done' || mode === 'error') {
    return (
      <Page title={mode === 'done' ? 'Готово' : 'Соединение'} subtitle="WebRTC DataChannel" back backTo="/transfer">
        <div className="rounded-card border border-line bg-surface p-5">
          {mode === 'done' ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
                <Icon name="check" size={24} />
              </div>
              <p className="display mt-4 text-[24px] leading-snug text-ink">
                {result ? 'Данные приняты' : 'Данные отправлены'}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                {result
                  ? `Добавлено ${result.added}, обновлено ${result.updated}, пропущено ${result.skipped}. Более новые локальные записи сохранены.`
                  : 'Второе устройство получило журнал. Его текущие записи останутся, если они новее.'}
              </p>
              <Button full className="mt-5" onClick={() => navigate('/data')}>
                К данным
              </Button>
              <Button full variant="ghost" className="mt-1" onClick={() => reset('intro')}>
                Передать ещё
              </Button>
            </>
          ) : mode === 'error' ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
                <Icon name="alert" size={24} />
              </div>
              <p className="display mt-4 text-[22px] leading-snug text-ink">Не получилось</p>
              <p className="mt-2 break-words text-[13px] leading-relaxed text-dim">{error}</p>
              <Button full className="mt-5" onClick={() => reset('intro')}>
                Попробовать снова
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Spinner size={20} />
                <p className="text-[14px] font-medium text-ink">
                  {mode === 'sending'
                    ? 'Отправляем журнал…'
                    : mode === 'receiving'
                      ? 'Принимаем журнал…'
                      : mode === 'gathering'
                        ? 'Готовим код…'
                        : 'Ждём соединения…'}
                </p>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
                {mode === 'waiting'
                  ? receiver
                    ? 'Второе устройство отправит данные, как только канал откроется.'
                    : 'Как только канал откроется, данные уйдут автоматически.'
                  : 'Не закрывайте приложение на обоих устройствах.'}
              </p>
              {mode === 'sending' || mode === 'receiving' ? (
                <div className="mt-4">
                  <Progress value={progress} />
                  <p className="tnum mt-1.5 text-right text-[11.5px] text-faint">{progress}%</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Page>
    );
  }

  const answerStep = mode === 'answer';
  return (
    <Page
      title={answerStep ? 'Ответный код' : 'Код передачи'}
      subtitle={answerStep ? 'покажите первому устройству' : 'отсканируйте вторым устройством'}
      back
      backTo="/transfer"
    >
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={answerStep ? 'accent' : 'neutral'}>{answerStep ? 'Шаг 2 из 2' : 'Шаг 1 из 2'}</Badge>
          <span className="text-[11.5px] text-faint">
            {intent === 'send' ? 'передаём с этого устройства' : 'принимаем на это устройство'}
          </span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">
          {answerStep
            ? 'Покажите этот QR первому устройству — оно отсканирует ответ и подключится.'
            : 'Покажите этот QR второму устройству. Оно создаст ответный код.'}
        </p>
        <div className="mt-4">
          <QrImage value={code} size={300} />
        </div>
        <p className="mt-3 text-center text-[11.5px] leading-relaxed text-faint">
          {answerStep
            ? 'После сканирования соединение откроется автоматически.'
            : 'На втором устройстве: «Сканировать код другого устройства».'}
        </p>

        <div className="mt-4 space-y-2">
          {!answerStep ? (
            <Button full icon="qr" onClick={() => setMode('scan-answer')}>
              Сканировать ответ
            </Button>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              full
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(code)
                  .then(() => toast('Код скопирован'))
                  .catch(() => setManualOpen(true));
              }}
            >
              Скопировать код
            </Button>
            {!answerStep ? (
              <Button variant="secondary" full onClick={() => setManualOpen(true)}>
                Вставить ответ
              </Button>
            ) : null}
          </div>
        </div>

        {manualOpen && !answerStep ? (
          <div className="mt-3 rounded-xl border border-line bg-surface p-3">
            <Textarea
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="Вставьте ответный код WGB1…"
              className="font-mono text-[10px]"
              autoFocus
            />
            <Button full className="mt-2" disabled={!manualCode.trim()} onClick={() => void acceptAnswer(manualCode)}>
              Подключиться
            </Button>
          </div>
        ) : null}

        <details className="mt-3 rounded-xl border border-line bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[11.5px] text-faint">Показать код текстом</summary>
          <textarea
            readOnly
            value={code}
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border border-line bg-elevated/50 p-2 font-mono text-[10px] text-dim"
          />
        </details>

        <button
          type="button"
          onClick={() => reset('intro')}
          className="mt-4 w-full py-2 text-[12px] text-faint underline-offset-2 hover:underline focus-ring"
        >
          Отменить
        </button>
      </div>
    </Page>
  );
}
