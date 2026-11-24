/** Утилиты идентификаторов и дат. Даты сессий — всегда локальные календарные `YYYY-MM-DD`. */

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Фолбэк для небезопасных контекстов (http по локальной сети).
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Сегодняшняя локальная дата в формате YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Разбор YYYY-MM-DD в локальную полночь (без сдвигов часовых поясов). */
export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function diffDays(a: string, b: string): number {
  const ms = fromIsoDate(a).getTime() - fromIsoDate(b).getTime();
  return Math.round(ms / 86_400_000);
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** 14.03.2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = fromIsoDate(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** 14 мар — компактно для карточек. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = fromIsoDate(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** пт, 14 мар — компактно для строк сессий. */
export function formatDateCompact(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = fromIsoDate(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** пн, 14 марта */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = fromIsoDate(iso);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}

export type DeadlineState = 'none' | 'future' | 'today' | 'overdue';

export function deadlineState(deadline: string | null, today = todayIso()): DeadlineState {
  if (!deadline) return 'none';
  const delta = diffDays(deadline, today);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  return 'future';
}

/** Относительная подпись дедлайна: «сегодня», «завтра», «просрочен на 3 дн.». */
export function relativeDeadline(deadline: string | null, today = todayIso()): string {
  if (!deadline) return 'без дедлайна';
  const delta = diffDays(deadline, today);
  if (delta === 0) return 'дедлайн сегодня';
  if (delta === 1) return 'дедлайн завтра';
  if (delta > 1) return `дедлайн через ${delta} дн.`;
  const late = -delta;
  const word = late % 10 === 1 && late % 100 !== 11 ? 'день' : late % 10 >= 2 && late % 10 <= 4 && (late % 100 < 10 || late % 100 >= 20) ? 'дня' : 'дней';
  return `просрочен на ${late} ${word}`;
}
