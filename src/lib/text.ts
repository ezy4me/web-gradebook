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
 * Инициалы предмета для компактного списка: «Веб-разработка» → «ВР»,
 * «Базы данных» → «БД». Служебные слова и предлоги не отбрасываем — преподаватель
 * узнаёт предмет по первым буквам, а не по эвристике.
 */
export function subjectInitials(name: string, max = 3): string {
  const cleaned = name
    .replace(/[«»"“”'’()\[\]`]/g, ' ')
    .replace(/[–—/]/g, ' ')
    .trim();
  const words = cleaned.split(/[\s-]+/).filter(Boolean);
  const letters = words
    .map((word) => Array.from(word)[0] ?? '')
    .filter(Boolean)
    .join('')
    .slice(0, max)
    .toUpperCase();
  if (letters) return letters;
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || '—';
}
