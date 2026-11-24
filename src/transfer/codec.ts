/**
 * Упаковка SDP в короткий QR-код.
 *
 * SDP с ICE-кандидатами — это 1–2 КБ текста; gzip уменьшает его в несколько раз,
 * base64url делает безопасным для QR. Без сжатия код может не влезть в один QR.
 */

export type TransferIntent = 'send' | 'receive';

export interface SignalPayload {
  t: 'offer' | 'answer';
  intent: TransferIntent;
  sdp: string;
}

const PREFIX = 'WGB1';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return bytes;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeSignal(payload: SignalPayload): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await gzip(raw);
  const compressedFlag = compressed.length < raw.length ? 'g' : 'p';
  const body = compressedFlag === 'g' ? compressed : raw;
  return `${PREFIX}.${compressedFlag}.${bytesToBase64(body)}`;
}

export async function decodeSignal(code: string): Promise<SignalPayload> {
  const trimmed = code.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('Это не код переноса web-gradebook');
  const [, flag, body] = parts;
  let bytes = base64ToBytes(body);
  if (flag === 'g') bytes = await gunzip(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Код повреждён — отсканируйте заново');
  }
  const candidate = parsed as Partial<SignalPayload>;
  if (!candidate || (candidate.t !== 'offer' && candidate.t !== 'answer') || !candidate.sdp) {
    throw new Error('В коде нет описания соединения');
  }
  return {
    t: candidate.t,
    intent: candidate.intent === 'receive' ? 'receive' : 'send',
    sdp: String(candidate.sdp),
  };
}
