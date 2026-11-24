import type { Activity, ActivitySession, ActivityType, Group, Subgroup, Subject } from '../db/types';
import { addDays } from '../lib/date';

export interface SessionPlanItem {
  date: string;
  groupId: string;
  subgroupId: string | null;
}

export interface SessionPlanOptions {
  type: ActivityType;
  groupId: string;
  startDate: string;
  /** Количество сессий. */
  count: number;
  /** Шаг между сессиями в днях (7 — раз в неделю). */
  intervalDays: number;
  /** Подгруппы группы (только для лабораторных), в порядке чередования. */
  subgroups: Subgroup[];
}

/**
 * План сессий по умолчанию.
 *
 * - Лабораторные: подгруппы чередуются `1 → 2 → 1 → 2…` по датам начиная с первой.
 *   Если подгруппа одна — все сессии уходят ей. Без подгрупп лабораторную создать нельзя.
 * - Лекции/практики: одна сессия на всю группу, `subgroupId = null`.
 */
export function planSessions(options: SessionPlanOptions): SessionPlanItem[] {
  const { type, groupId, startDate, count, intervalDays, subgroups } = options;
  const total = Math.max(0, Math.floor(count));
  const step = Math.max(1, Math.floor(intervalDays));
  const plan: SessionPlanItem[] = [];

  if (type === 'lab') {
    const ordered = [...subgroups].sort((a, b) => a.index - b.index);
    if (ordered.length === 0) return [];
    for (let i = 0; i < total; i++) {
      plan.push({
        date: addDays(startDate, i * step),
        groupId,
        subgroupId: ordered[i % ordered.length].id,
      });
    }
    return plan;
  }

  for (let i = 0; i < total; i++) {
    plan.push({ date: addDays(startDate, i * step), groupId, subgroupId: null });
  }
  return plan;
}

/**
 * Следующая дата занятия у той же группы (для лабораторных — у той же подгруппы).
 * Учитываются все сессии предмета, а не только текущего занятия: по ТЗ дедлайн —
 * это дата следующего занятия подгруппы/группы.
 */
export function nextSessionDate(
  session: ActivitySession,
  sessions: ActivitySession[],
): string | null {
  let best: string | null = null;
  for (const candidate of sessions) {
    if (candidate.deletedAt) continue;
    if (candidate.subjectId !== session.subjectId) continue;
    if (candidate.groupId !== session.groupId) continue;
    if (candidate.subgroupId !== session.subgroupId) continue;
    if (candidate.date <= session.date) continue;
    if (!best || candidate.date < best) best = candidate.date;
  }
  return best;
}

/**
 * Дедлайн сессии: явное переопределение сессии → переопределение занятия →
 * дата следующей сессии этой же группы/подгруппы.
 */
export function resolveDeadline(
  activity: Activity | undefined,
  session: ActivitySession,
  sessions: ActivitySession[],
): string | null {
  if (session.deadline) return session.deadline;
  if (activity?.deadline) return activity.deadline;
  return nextSessionDate(session, sessions);
}

/**
 * Дедлайн занятия — дедлайн его последней сессии (ручной дедлайн занятия имеет приоритет).
 * `subjectSessions` — все активные сессии предмета.
 */
export function activityDeadline(
  activity: Activity,
  subjectSessions: ActivitySession[],
): string | null {
  if (activity.deadline) return activity.deadline;
  const own = subjectSessions
    .filter((session) => session.activityId === activity.id && !session.deletedAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = own[own.length - 1];
  if (!last) return null;
  return resolveDeadline(activity, last, subjectSessions);
}

/** Подпись подгруппы для сессии: «Подгруппа 1» или «Вся группа». */
export function subgroupLabel(
  session: ActivitySession,
  subgroups: Subgroup[],
): string {
  if (!session.subgroupId) return 'Вся группа';
  const sg = subgroups.find((s) => s.id === session.subgroupId);
  return sg ? sg.name.trim() || `Подгруппа ${sg.index}` : 'Подгруппа';
}

/** Сессии занятия, сгруппированные по дате (для списка внутри занятия). */
export function sessionsByDate(sessions: ActivitySession[]): { date: string; items: ActivitySession[] }[] {
  const map = new Map<string, ActivitySession[]>();
  for (const s of sessions) {
    if (s.deletedAt) continue;
    const list = map.get(s.date) ?? [];
    list.push(s);
    map.set(s.date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => (a.subgroupId ?? '').localeCompare(b.subgroupId ?? '')) }));
}

/** Группы предмета (по факту зачислений и подгрупп). */
export function subjectGroups(
  subjectId: string,
  groups: Group[],
  subgroups: Subgroup[],
): Group[] {
  const ids = new Set<string>();
  for (const sg of subgroups) if (sg.subjectId === subjectId && !sg.deletedAt) ids.add(sg.groupId);
  return groups.filter((g) => !g.deletedAt && ids.has(g.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export function groupSubgroups(subjectId: string, groupId: string, subgroups: Subgroup[]): Subgroup[] {
  return subgroups
    .filter((s) => s.subjectId === subjectId && s.groupId === groupId && !s.deletedAt)
    .sort((a, b) => a.index - b.index);
}

export function subjectEnabledTypes(subject: Subject): ActivityType[] {
  return subject.enabledTypes;
}
