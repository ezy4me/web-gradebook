import type { Activity, ActivitySession, Subject } from '../db/types';
import { isGradedType, subjectActivities, subjectSessions, type Snapshot } from './grading';

export interface WorkRow {
  activity: Activity;
  session: ActivitySession | null;
  score: number | null;
  present: boolean | null;
  comment: string;
}

/**
 * Работы студента по предмету: ровно одна строка на занятие.
 *
 * Раньше в список попадали занятия других групп и занятия без сессий — из-за этого
 * «Лабораторная 1» появлялась дважды. Теперь берём только занятия, у которых есть
 * сессия этой группы, а для лабораторных — сессия подгруппы студента (или общая).
 */
export function studentActivityRows(
  snapshot: Snapshot,
  subject: Subject,
  studentId: string,
  groupId: string,
  subgroupId: string | null,
): WorkRow[] {
  const activities = subjectActivities(snapshot, subject.id);
  const sessions = subjectSessions(snapshot, subject.id).filter((session) => {
    if (session.groupId !== groupId) return false;
    const activity = activities.find((a) => a.id === session.activityId);
    if (!activity) return false;
    if (activity.type !== 'lab') return true;
    if (session.subgroupId == null) return true;
    return Boolean(subgroupId) && session.subgroupId === subgroupId;
  });
  const activityIds = new Set(sessions.map((session) => session.activityId));

  return activities
    .filter((activity) => activityIds.has(activity.id))
    .map((activity) => {
      const activitySessions = sessions
        .filter((session) => session.activityId === activity.id)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = activitySessions[activitySessions.length - 1] ?? null;
      let score: number | null = null;
      let comment = '';
      let present: boolean | null = null;
      for (const session of activitySessions) {
        const grade = snapshot.grades.find(
          (g) => g.sessionId === session.id && g.studentId === studentId && !g.deletedAt,
        );
        const attendance = snapshot.attendance.find(
          (a) => a.sessionId === session.id && a.studentId === studentId && !a.deletedAt,
        );
        if (grade?.score != null) score = grade.score;
        if (grade?.comment) comment = grade.comment;
        if (attendance) present = attendance.present;
      }
      return { activity, session: last, score, present, comment };
    })
    .sort((a, b) => {
      const left = a.session?.date ?? '';
      const right = b.session?.date ?? '';
      return left.localeCompare(right);
    });
}

export function worksByType<T extends WorkRow>(
  rows: T[],
): { type: Activity['type']; rows: T[] }[] {
  const order: Activity['type'][] = ['practice', 'lab', 'lecture'];
  return order
    .map((type) => ({ type, rows: rows.filter((row) => row.activity.type === type) }))
    .filter((group) => group.rows.length > 0);
}

export function isPassed(
  subject: Subject,
  row: WorkRow,
  max: number,
): boolean | null {
  if (row.score == null || max <= 0 || !isGradedType(row.activity.type)) return null;
  return (row.score / max) * 100 >= subject.passThreshold;
}
