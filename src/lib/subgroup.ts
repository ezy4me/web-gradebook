/** Цветовые роли подгрупп: 1 — глина, 2 — мох, 3 — сталь, дальше по кругу. */
export interface SubgroupTone {
  dot: string;
  badge: string;
  border: string;
  text: string;
  index: number;
}

const TONES = [
  {
    dot: 'bg-clay',
    badge: 'bg-clay-soft text-clay',
    border: 'border-clay',
    text: 'text-clay',
  },
  {
    dot: 'bg-moss',
    badge: 'bg-moss-soft text-moss',
    border: 'border-moss',
    text: 'text-moss',
  },
  {
    dot: 'bg-steel',
    badge: 'bg-steel-soft text-steel',
    border: 'border-steel',
    text: 'text-steel',
  },
] as const;

export function subgroupTone(index: number | null | undefined): SubgroupTone {
  const normalized = Math.max(1, index ?? 1);
  const tone = TONES[(normalized - 1) % TONES.length];
  return { ...tone, index: normalized };
}
