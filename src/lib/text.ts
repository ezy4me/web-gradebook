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
