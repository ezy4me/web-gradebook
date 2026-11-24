/**
 * Цветовые роли подгрупп.
 *
 * Намеренно не красный и не зелёный: эти цвета заняты оценками и явкой,
 * а подгруппа — это просто идентификатор, а не «хорошо / плохо».
 */
export interface SubgroupTone {
  dot: string;
  badge: string;
  cell: string;
  border: string;
  text: string;
  index: number;
}

const TONES = [
  {
    dot: 'bg-sub1',
    badge: 'bg-sub1-soft text-sub1',
    cell: 'bg-sub1-soft',
    border: 'border-sub1',
    text: 'text-sub1',
  },
  {
    dot: 'bg-sub2',
    badge: 'bg-sub2-soft text-sub2',
    cell: 'bg-sub2-soft',
    border: 'border-sub2',
    text: 'text-sub2',
  },
  {
    dot: 'bg-sub3',
    badge: 'bg-sub3-soft text-sub3',
    cell: 'bg-sub3-soft',
    border: 'border-sub3',
    text: 'text-sub3',
  },
] as const;

export function subgroupTone(index: number | null | undefined): SubgroupTone {
  const normalized = Math.max(1, index ?? 1);
  const tone = TONES[(normalized - 1) % TONES.length];
  return { ...tone, index: normalized };
}
