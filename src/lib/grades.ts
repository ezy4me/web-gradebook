/** Пятибалльная шкала поверх процентов: 0–50 — 2, 51–70 — 3, 71–85 — 4, 86–100 — 5. */

export type GradeTone = 'grade2' | 'grade3' | 'grade4' | 'grade5';

export interface GradeBand {
  grade: 2 | 3 | 4 | 5;
  /** Нижняя граница процента включительно. */
  min: number;
  tone: GradeTone;
}

export const GRADE_BANDS: GradeBand[] = [
  { grade: 5, min: 86, tone: 'grade5' },
  { grade: 4, min: 71, tone: 'grade4' },
  { grade: 3, min: 51, tone: 'grade3' },
  { grade: 2, min: 0, tone: 'grade2' },
];

export function gradeBand(percent: number | null | undefined): GradeBand | null {
  if (percent == null || Number.isNaN(percent)) return null;
  const value = Math.max(0, Math.min(100, percent));
  return GRADE_BANDS.find((band) => value >= band.min) ?? null;
}

export function scoreBand(
  score: number | null | undefined,
  max: number,
): GradeBand | null {
  if (score == null || max <= 0) return null;
  return gradeBand((score / max) * 100);
}

/** Статические классы по тону — чтобы Tailwind их видел. */
export const GRADE_CLASSES: Record<
  GradeTone,
  { text: string; bg: string; soft: string; border: string; dot: string }
> = {
  grade2: {
    text: 'text-grade2',
    bg: 'bg-grade2',
    soft: 'bg-grade2-soft',
    border: 'border-grade2',
    dot: 'bg-grade2',
  },
  grade3: {
    text: 'text-grade3',
    bg: 'bg-grade3',
    soft: 'bg-grade3-soft',
    border: 'border-grade3',
    dot: 'bg-grade3',
  },
  grade4: {
    text: 'text-grade4',
    bg: 'bg-grade4',
    soft: 'bg-grade4-soft',
    border: 'border-grade4',
    dot: 'bg-grade4',
  },
  grade5: {
    text: 'text-grade5',
    bg: 'bg-grade5',
    soft: 'bg-grade5-soft',
    border: 'border-grade5',
    dot: 'bg-grade5',
  },
};

export function gradeScaleHint(): string {
  return '0–50 — 2, 51–70 — 3, 71–85 — 4, 86–100 — 5';
}
