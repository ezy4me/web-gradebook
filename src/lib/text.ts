/** Склонение существительных по числу: plural(3, 'сессия', 'сессии', 'сессий'). */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count);
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return few;
  return many;
}

export function countLabel(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}

/**
 * Инициалы предмета для компактного списка.
 *
 * Берём первые буквы всех слов, а разделители сохраняем: «Веб-разработка» → «В-Р»,
 * «Базы данных» → «Б Д». Так короткое имя остаётся узнаваемым и не склеивается
 * в нечитаемую аббревиатуру.
 */
export function subjectInitials(name: string): string {
  const cleaned = name
    .replace(/[«»"“”'’()\[\]`.,]/g, ' ')
    .replace(/[–—/]/g, ' ')
    .trim();
  const tokens = cleaned.split(/(\s+|-)/);
  let result = '';
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      if (result && !result.endsWith(' ') && !result.endsWith('-')) result += ' ';
      continue;
    }
    if (token === '-') {
      if (result && !result.endsWith(' ') && !result.endsWith('-')) result += '-';
      continue;
    }
    const letters = Array.from(token).filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (letters.length) result += letters[0].toUpperCase();
  }
  return result.trim().replace(/\s+/g, ' ').replace(/\s?-\s?/g, '-') || '—';
}
