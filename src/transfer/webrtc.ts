/**
 * WebRTC DataChannel без сервера: SDP и ICE-кандидаты передаются QR-кодами,
 * дальше данные идут напрямую между устройствами.
 *
 * STUN нужен только для обнаружения адресов; TURN нет — в сложных NAT сеть
 * может не подняться, зато данные не проходят через чужой сервер.
 */

import { decodeSignal, encodeSignal, type SignalPayload, type TransferIntent } from './codec';

export type PeerPhase =
  | 'new'
  | 'gathering'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';

export interface PeerCallbacks {
  onPhase?: (phase: PeerPhase) => void;
  onOpen?: () => void;
  onProgress?: (bytes: number, total: number) => void;
  onBackup?: (backup: unknown) => void;
  onError?: (error: Error) => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
const CHUNK = 16_000;
const MAX_BYTES = 60 * 1024 * 1024;

export class TransferPeer {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private callbacks: PeerCallbacks;
  private expected = 0;
  private received = 0;
  private chunks: Uint8Array[] = [];
  intent: TransferIntent = 'send';

  constructor(callbacks: PeerCallbacks = {}) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') this.callbacks.onPhase?.('connected');
      else if (state === 'connecting') this.callbacks.onPhase?.('connecting');
      else if (state === 'failed') {
        this.callbacks.onPhase?.('failed');
        this.callbacks.onError?.(
          new Error('Не удалось установить соединение. Устройства в одной сети Wi-Fi?'),
        );
      } else if (state === 'disconnected') {
        this.callbacks.onPhase?.('waiting');
      }
    };
  }

  private setupChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      this.callbacks.onPhase?.('connected');
      this.callbacks.onOpen?.();
    };
    channel.onclose = () => this.callbacks.onPhase?.('closed');
    channel.onerror = () => this.callbacks.onError?.(new Error('Канал передачи закрылся'));
    channel.onmessage = (event) => this.onMessage(event.data);
  }

  private onMessage(data: unknown): void {
    if (typeof data === 'string') {
      try {
        const meta = JSON.parse(data) as { type?: string; bytes?: number };
        if (meta.type === 'meta' && typeof meta.bytes === 'number') {
          if (meta.bytes <= 0 || meta.bytes > MAX_BYTES) {
            this.callbacks.onError?.(new Error('Слишком большой файл для передачи'));
            this.close();
            return;
          }
          this.expected = meta.bytes;
          this.received = 0;
          this.chunks = [];
        }
      } catch {
        /* не служебное сообщение */
      }
      return;
    }
    if (!(data instanceof ArrayBuffer) || !this.expected) return;
    const chunk = new Uint8Array(data);
    this.chunks.push(chunk);
    this.received += chunk.byteLength;
    this.callbacks.onProgress?.(this.received, this.expected);
    if (this.received < this.expected) return;

    const total = this.chunks.reduce((sum, part) => sum + part.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of this.chunks) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    this.expected = 0;
    this.received = 0;
    this.chunks = [];
    try {
      this.callbacks.onBackup?.(JSON.parse(new TextDecoder().decode(merged)));
    } catch {
      this.callbacks.onError?.(new Error('Пришёл повреждённый файл'));
    }
  }

  private async waitForIce(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') finish();
      };
      this.pc.addEventListener('icegatheringstatechange', onChange);
      window.setTimeout(finish, 4500);
    });
  }

  async createOffer(intent: TransferIntent): Promise<string> {
    this.intent = intent;
    this.callbacks.onPhase?.('gathering');
    this.setupChannel(this.pc.createDataChannel('gradebook', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForIce();
    if (!this.pc.localDescription) throw new Error('Не удалось создать код');
    return encodeSignal({ t: 'offer', intent, sdp: this.pc.localDescription.sdp });
  }

  async acceptOffer(code: string): Promise<{ answer: string; intent: TransferIntent }> {
    const signal = await decodeSignal(code);
    if (signal.t !== 'offer') throw new Error('Нужен код от первого устройства');
    this.intent = signal.intent === 'send' ? 'receive' : 'send';
    this.pc.ondatachannel = (event) => this.setupChannel(event.channel);
    this.callbacks.onPhase?.('gathering');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIce();
    if (!this.pc.localDescription) throw new Error('Не удалось создать ответный код');
    const payload: SignalPayload = { t: 'answer', intent: this.intent, sdp: this.pc.localDescription.sdp };
    return { answer: await encodeSignal(payload), intent: this.intent };
  }

  async acceptAnswer(code: string): Promise<void> {
    const signal = await decodeSignal(code);
    if (signal.t !== 'answer') throw new Error('Это не ответный код');
    this.callbacks.onPhase?.('connecting');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
  }

  async sendBackup(backup: unknown): Promise<void> {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') throw new Error('Соединение ещё не готово');
    const bytes = new TextEncoder().encode(JSON.stringify(backup));
    if (bytes.byteLength > MAX_BYTES) throw new Error('Журнал слишком большой для передачи');
    channel.send(JSON.stringify({ type: 'meta', bytes: bytes.byteLength }));
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
      while (channel.bufferedAmount > 1_000_000) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            channel.removeEventListener('bufferedamountlow', handler);
            resolve();
          };
          channel.addEventListener('bufferedamountlow', handler);
          channel.bufferedAmountLowThreshold = 256_000;
        });
      }
      const slice = bytes.slice(offset, Math.min(offset + CHUNK, bytes.byteLength));
      channel.send(slice);
      this.callbacks.onProgress?.(Math.min(offset + CHUNK, bytes.byteLength), bytes.byteLength);
    }
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.pc.close();
    this.callbacks.onPhase?.('closed');
  }
}
