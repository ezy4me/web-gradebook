import { useEffect, useRef, useState } from 'react';

/** QR-код для SDP-кода. Белый фон обязателен: тёмная тема не должна ломать сканер. */
export function QrImage({ value, size = 280 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    void import('qrcode')
      .then((module) =>
        module.default.toDataURL(value, {
          errorCorrectionLevel: 'L',
          margin: 1,
          width: Math.max(320, size * 2),
          color: { dark: '#1c1a16ff', light: '#ffffffff' },
        }),
      )
      .then((data) => {
        if (!cancelled) setSrc(data);
      })
      .catch(() => {
        if (!cancelled) setError('Код не помещается в QR. Попробуйте другое устройство.');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-[12px] leading-relaxed text-danger">
        {error}
      </p>
    );
  }

  return (
    <div
      className="mx-auto flex aspect-square w-full max-w-[316px] items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-2"
    >
      {src ? (
        <img
          src={src}
          alt="QR-код для передачи данных"
          width={size}
          height={size}
          className="block h-full w-full object-contain"
        />
      ) : (
        <span className="text-[12px] text-dim">Собираем QR…</span>
      )}
    </div>
  );
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function QrScanner({
  onResult,
  onCancel,
}: {
  onResult: (value: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let stopped = false;
    let detecting = false;

    const stop = () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Камера недоступна в этом браузере');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
        await new Promise((resolve) => window.setTimeout(resolve, 300));

        const detector =
          typeof window.BarcodeDetector === 'function'
            ? new window.BarcodeDetector({ formats: ['qr_code'] })
            : null;
        let jsQR: ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | null =
          null;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        if (!detector && canvas && context) {
          const module = await import('jsqr');
          jsQR = module.default;
        }

        timer = window.setInterval(() => {
          if (stopped || detecting) return;
          const current = videoRef.current;
          if (!current || current.readyState < 2) return;
          detecting = true;
          const finish = (value: string | null) => {
            detecting = false;
            if (value) {
              stop();
              onResultRef.current(value.trim());
            }
          };
          if (detector) {
            void detector
              .detect(current)
              .then((codes) => finish(codes[0]?.rawValue ?? null))
              .catch(() => finish(null));
            return;
          }
          if (!jsQR || !canvas || !context) {
            detecting = false;
            return;
          }
          canvas.width = current.videoWidth;
          canvas.height = current.videoHeight;
          context.drawImage(current, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height);
          finish(result?.data ?? null);
        }, 300);
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Разрешите доступ к камере в настройках браузера'
            : name === 'NotFoundError'
              ? 'Камера не найдена'
              : 'Не удалось включить камеру',
        );
      }
    };

    void start();
    return () => {
      stop();
    };
  }, []);

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="aspect-[4/3] w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[58%] w-[58%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]">
            <span className="absolute inset-x-2 top-1/2 h-px bg-white/80" />
          </div>
        </div>
        {!ready && !error ? (
          <p className="absolute inset-0 flex items-center justify-center text-[13px] text-white">
            Включаем камеру…
          </p>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="text-[12px] leading-snug text-dim">
          {error ?? 'Наведите камеру на QR-код на другом устройстве'}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 text-[12px] text-clay underline-offset-2 hover:underline focus-ring"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
