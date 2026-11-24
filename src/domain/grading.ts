import type {
  Activity,
  ActivitySession,
  ActivityType,
  Attendance,
  Enrollment,
  Grade,
  Group,
  GroupMember,
  Student,
  Subject,
  Subgroup,
} from '../db/types';
import { todayIso } from '../lib/date';

/** Снимок локальной базы для чистых вычислений. */
export interface Snapshot {
  subjects: Subject[];
  groups: Group[];
  groupMembers: GroupMember[];
  subgroups: Subgroup[];
  students: Student[];
  enrollments: Enrollment[];
  activities: Activity[];
  sessions: ActivitySession[];
  grades: Grade[];
  attendance: Attendance[];
}

export const isActive = <T extends { deletedAt: string | null }>(r: T): boolean => !r.deletedAt;

/** Лекции не входят в итоговый балл: только посещаемость. */
export function isGradedType(type: ActivityType): boolean {
  return type !== 'lecture';
}

/** Вес занятия: собственный или из веса вида занятия в предмете. Лекции весят 0. */
export function activityWeight(subject: Subject | undefined, activity: Activity): number {
  if (!isGradedType(activity.type)) return 0;
  if (activity.weight != null && activity.weight >= 0) return activity.weight;
  return subject?.typeWeights[activity.type] ?? 1;
}

/** Максимальный балл занятия: собственный или шкала предмета. */
export function activityMaxScore(subject: Subject | undefined, activity: Activity): number {
  if (activity.maxScore > 0) return activity.maxScore;
  return subject?.scaleMax ?? 100;
}

export function findSubject(snap: Snapshot, subjectId: string): Subject | undefined {
  return snap.subjects.find((s) => s.id === subjectId && !s.deletedAt);
}

export function subjectActivities(snap: Snapshot, subjectId: string): Activity[] {
  return snap.activities
    .filter((a) => a.subjectId === subjectId && !a.deletedAt)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function activitySessions(snap: Snapshot, activityId: string): ActivitySession[] {
  return snap.sessions
    .filter((s) => s.activityId === activityId && !s.deletedAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function subjectSessions(snap: Snapshot, subjectId: string): ActivitySession[] {
  return snap.sessions.filter((s) => s.subjectId === subjectId && !s.deletedAt);
}

export function findSession(snap: Snapshot, sessionId: string): ActivitySession | undefined {
  return snap.sessions.find((s) => s.id === sessionId && !s.deletedAt);
}

export function findActivity(snap: Snapshot, activityId: string): Activity | undefined {
  return snap.activities.find((a) => a.id === activityId && !a.deletedAt);
}

/** Зачисление студента в предмет. */
export function enrollmentOf(
  snap: Snapshot,
  subjectId: string,
  studentId: string,
): Enrollment | undefined {
  return snap.enrollments.find(
    (e) => e.subjectId === subjectId && e.studentId === studentId && !e.deletedAt,
  );
}

/**
 * Состав сессии: для лабораторной — студенты выбранной подгруппы,
 * для лекции/практики — студенты группы целиком.
 *
 * Если подгруппы у группы нет или студент не распределён — он попадает в список:
 * по умолчанию показывается вся группа, а не пустой экран.
 */
export function sessionRoster(snap: Snapshot, session: ActivitySession): Student[] {
  const groupHasSubgroups = snap.subgroups.some(
    (subgroup) =>
      !subgroup.deletedAt &&
      subgroup.subjectId === session.subjectId &&
      subgroup.groupId === session.groupId,
  );
  const useSubgroup = Boolean(session.subgroupId) && groupHasSubgroups;
  return snap.enrollments
    .filter(
      (e) =>
        !e.deletedAt &&
        e.subjectId === session.subjectId &&
        e.groupId === session.groupId &&
        (!useSubgroup || e.subgroupId === session.subgroupId || e.subgroupId == null),
    )
    .map((e) => snap.students.find((s) => s.id === e.studentId && !s.deletedAt))
    .filter((s): s is Student => Boolean(s))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function gradeOf(
  snap: Snapshot,
  sessionId: string,
  studentId: string,
): Grade | undefined {
  return snap.grades.find(
    (g) => g.sessionId === sessionId && g.studentId === studentId && !g.deletedAt,
  );
}

export function attendanceOf(
  snap: Snapshot,
  sessionId: string,
  studentId: string,
): Attendance | undefined {
  return snap.attendance.find(
    (a) => a.sessionId === sessionId && a.studentId === studentId && !a.deletedAt,
  );
}

/** Сессии предмета, которые относятся к студенту (лабораторные — по его подгруппе). */
function studentSessions(snap: Snapshot, subjectId: string, studentId: string): ActivitySession[] {
  const enrollment = enrollmentOf(snap, subjectId, studentId);
  if (!enrollment) return [];
  const activities = new Map(subjectActivities(snap, subjectId).map((a) => [a.id, a]));
  return subjectSessions(snap, subjectId).filter((session) => {
    const activity = activities.get(session.activityId);
    if (!activity) return false;
    if (session.groupId !== enrollment.groupId) return false;
    if (activity.type !== 'lab') return true;
    // Сессия без подгруппы — занятие для всей группы (в т.ч. если подгруппы не заданы).
    if (session.subgroupId == null) return true;
    return Boolean(enrollment.subgroupId) && session.subgroupId === enrollment.subgroupId;
  });
}

export interface TypeBreakdown {
  graded: number;
  total: number;
  averagePercent: number | null;
  finalPercent: number | null;
}

export interface StudentProgress {
  studentId: string;
  /** Взвешенный процент по всем ожидаемым сессиям, пропуски = 0. Итоговая оценка. */
  finalPercent: number | null;
  /** Взвешенный процент только по выставленным оценкам. */
  averagePercent: number | null;
  /** Доля выставленных оценок от ожидаемых, %. */
  completion: number;
  graded: number;
  total: number;
  present: number;
  attendanceSessions: number;
  lecturePresent: number;
  lectureSessions: number;
  byType: Record<ActivityType, TypeBreakdown>;
  series: { date: string; percent: number }[];
  passed: boolean;
  earnedWeighted: number;
  maxWeighted: number;
}

interface SessionCell {
  session: ActivitySession;
  activity: Activity;
  weight: number;
  max: number;
  score: number | null;
  present: boolean | null;
}

function cellsForStudent(snap: Snapshot, subjectId: string, studentId: string): SessionCell[] {
  const subject = findSubject(snap, subjectId);
  const activities = new Map(subjectActivities(snap, subjectId).map((a) => [a.id, a]));
  const cells: SessionCell[] = [];
  for (const session of studentSessions(snap, subjectId, studentId).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )) {
    const activity = activities.get(session.activityId);
    if (!activity) continue;
    const grade = gradeOf(snap, session.id, studentId);
    const attendance = attendanceOf(snap, session.id, studentId);
    cells.push({
      session,
      activity,
      weight: activityWeight(subject, activity),
      max: activityMaxScore(subject, activity),
      score: grade?.score ?? null,
      present: attendance ? attendance.present : null,
    });
  }
  return cells;
}

function weightedPercent(cells: SessionCell[]): { percent: number | null; weight: number; earned: number; max: number } {
  let weightSum = 0;
  let earned = 0;
  let maxWeighted = 0;
  for (const cell of cells) {
    if (cell.max <= 0) continue;
    weightSum += cell.weight;
    maxWeighted += cell.weight;
    earned += cell.weight * Math.min(Math.max(cell.score ?? 0, 0), cell.max) / cell.max;
  }
  if (weightSum <= 0) return { percent: null, weight: 0, earned: 0, max: 0 };
  return { percent: (earned / weightSum) * 100, weight: weightSum, earned, max: maxWeighted };
}

const EMPTY_TYPE: TypeBreakdown = { graded: 0, total: 0, averagePercent: null, finalPercent: null };

export function computeStudentProgress(
  snap: Snapshot,
  subjectId: string,
  studentId: string,
): StudentProgress {
  const subject = findSubject(snap, subjectId);
  const cells = cellsForStudent(snap, subjectId, studentId);
  const gradable = cells.filter((cell) => isGradedType(cell.activity.type));
  const gradedCells = gradable.filter((c) => c.score != null);

  const overall = weightedPercent(gradable);
  const average = weightedPercent(gradedCells);

  const byType = {
    lecture: { ...EMPTY_TYPE },
    practice: { ...EMPTY_TYPE },
    lab: { ...EMPTY_TYPE },
  } as Record<ActivityType, TypeBreakdown>;
  for (const type of ['lecture', 'practice', 'lab'] as ActivityType[]) {
    const all = cells.filter((c) => c.activity.type === type);
    const graded = all.filter((c) => c.score != null);
    byType[type] = isGradedType(type)
      ? {
          graded: graded.length,
          total: all.length,
          averagePercent: weightedPercent(graded).percent,
          finalPercent: all.length ? weightedPercent(all).percent : null,
        }
      : { graded: 0, total: all.length, averagePercent: null, finalPercent: null };
  }

  const series: { date: string; percent: number }[] = [];
  const seen = new Set<string>();
  const today = todayIso();
  const pastCells = gradable.filter((cell) => cell.session.date <= today);
  for (const cell of pastCells) {
    if (!seen.has(cell.session.date)) {
      seen.add(cell.session.date);
      const upto = pastCells.filter((c) => c.session.date <= cell.session.date);
      const p = weightedPercent(upto).percent;
      if (p != null) series.push({ date: cell.session.date, percent: p });
    }
  }

  const present = cells.filter((c) => c.present === true).length;
  const attendanceSessions = cells.filter((c) => c.present != null).length;
  const lectureCells = cells.filter((cell) => cell.activity.type === 'lecture');
  const lecturePresent = lectureCells.filter((cell) => cell.present === true).length;
  const threshold = subject?.passThreshold ?? 51;

  return {
    studentId,
    finalPercent: overall.percent,
    averagePercent: average.percent,
    completion: gradable.length ? (gradedCells.length / gradable.length) * 100 : 0,
    graded: gradedCells.length,
    total: gradable.length,
    present,
    attendanceSessions,
    lecturePresent,
    lectureSessions: lectureCells.length,
    byType,
    series,
    passed: overall.percent != null && overall.percent >= threshold,
    earnedWeighted: overall.earned,
    maxWeighted: overall.max,
  };
}

export interface RankedStudent {
  student: Student;
  progress: StudentProgress;
  rank: number;
}

/** Рейтинг студентов группы по итоговому проценту (без оценок — в конце). */
export function groupRanking(
  snap: Snapshot,
  subjectId: string,
  groupId: string,
): RankedStudent[] {
  const students = snap.enrollments
    .filter((e) => !e.deletedAt && e.subjectId === subjectId && e.groupId === groupId)
    .map((e) => snap.students.find((s) => s.id === e.studentId && !s.deletedAt))
    .filter((s): s is Student => Boolean(s))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const rows = students.map((student) => ({
    student,
    progress: computeStudentProgress(snap, subjectId, student.id),
  }));
  rows.sort((a, b) => {
    const pa = a.progress.finalPercent;
    const pb = b.progress.finalPercent;
    if (pa == null && pb == null) return a.student.name.localeCompare(b.student.name, 'ru');
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa || a.student.name.localeCompare(b.student.name, 'ru');
  });

  let lastValue: number | null = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    const value = row.progress.finalPercent;
    let rank: number;
    if (value == null) rank = 0;
    else if (lastValue != null && Math.abs(value - lastValue) < 0.0001) rank = lastRank;
    else {
      rank = index + 1;
      lastValue = value;
      lastRank = rank;
    }
    return { ...row, rank };
  });
}

export interface SessionStats {
  rosterCount: number;
  graded: number;
  present: number;
  absent: number;
  marked: number;
  averagePercent: number | null;
  attendanceOnly: boolean;
}

export function sessionStats(snap: Snapshot, session: ActivitySession): SessionStats {
  const subject = findSubject(snap, session.subjectId);
  const activity = findActivity(snap, session.activityId);
  const roster = sessionRoster(snap, session);
  const attendanceOnly = activity ? !isGradedType(activity.type) : false;
  let graded = 0;
  let sum = 0;
  let present = 0;
  let absent = 0;
  let marked = 0;
  const max = activity ? activityMaxScore(subject, activity) : 100;
  for (const student of roster) {
    if (!attendanceOnly) {
      const grade = gradeOf(snap, session.id, student.id);
      if (grade && grade.score != null) {
        graded += 1;
        sum += (grade.score / max) * 100;
      }
    }
    const attendance = attendanceOf(snap, session.id, student.id);
    if (attendance) {
      marked += 1;
      if (attendance.present) present += 1;
      else absent += 1;
    }
  }
  return {
    rosterCount: roster.length,
    graded,
    present,
    absent,
    marked,
    averagePercent: graded ? sum / graded : null,
    attendanceOnly,
  };
}

export interface ActivitySummary {
  sessions: number;
  rosterCount: number;
  graded: number;
  totalCells: number;
  completion: number;
  averagePercent: number | null;
  attended: number;
  attendanceMarked: number;
  attendanceOnly: boolean;
}

export function summarizeActivity(snap: Snapshot, activity: Activity): ActivitySummary {
  const sessions = activitySessions(snap, activity.id);
  const attendanceOnly = !isGradedType(activity.type);
  let graded = 0;
  let totalCells = 0;
  let sum = 0;
  let rosterCount = 0;
  let attended = 0;
  let attendanceMarked = 0;
  const subject = findSubject(snap, activity.subjectId);
  const max = activityMaxScore(subject, activity);
  for (const session of sessions) {
    const roster = sessionRoster(snap, session);
    rosterCount = Math.max(rosterCount, roster.length);
    totalCells += roster.length;
    for (const student of roster) {
      if (!attendanceOnly) {
        const grade = gradeOf(snap, session.id, student.id);
        if (grade && grade.score != null) {
          graded += 1;
          sum += (grade.score / max) * 100;
        }
      }
      const attendance = attendanceOf(snap, session.id, student.id);
      if (attendance) {
        attendanceMarked += 1;
        if (attendance.present) attended += 1;
      }
    }
  }
  return {
    sessions: sessions.length,
    rosterCount,
    graded,
    totalCells,
    completion: totalCells
      ? (attendanceOnly ? attendanceMarked / totalCells : graded / totalCells) * 100
      : 0,
    averagePercent: graded ? sum / graded : null,
    attended,
    attendanceMarked,
    attendanceOnly,
  };
}

export interface GroupDistribution {
  bucket: string;
  count: number;
}

export interface GroupStats {
  group: Group;
  students: number;
  averagePercent: number | null;
  completion: number;
  distribution: GroupDistribution[];
  lagging: RankedStudent[];
  ranking: RankedStudent[];
}

const BUCKETS = [
  { bucket: '< 60%', from: -Infinity, to: 60 },
  { bucket: '60–74%', from: 60, to: 75 },
  { bucket: '75–89%', from: 75, to: 90 },
  { bucket: '90–100%', from: 90, to: Infinity },
];

export function computeGroupStats(snap: Snapshot, subjectId: string, groupId: string): GroupStats {
  const subject = findSubject(snap, subjectId);
  const group = snap.groups.find((g) => g.id === groupId) ?? {
    id: groupId,
    name: 'Группа',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
  };
  const ranking = groupRanking(snap, subjectId, groupId);
  const withGrades = ranking.filter((r) => r.progress.finalPercent != null);
  const averagePercent = withGrades.length
    ? withGrades.reduce((acc, r) => acc + (r.progress.finalPercent ?? 0), 0) / withGrades.length
    : null;
  const completion = ranking.length
    ? ranking.reduce((acc, r) => acc + r.progress.completion, 0) / ranking.length
    : 0;
  const distribution = BUCKETS.map((b) => ({
    bucket: b.bucket,
    count: withGrades.filter(
      (r) => (r.progress.finalPercent ?? 0) >= b.from && (r.progress.finalPercent ?? 0) < b.to,
    ).length,
  }));
  const threshold = subject?.passThreshold ?? 51;
  const lagging = ranking.filter(
    (r) => r.progress.finalPercent != null && r.progress.finalPercent < threshold,
  );
  return {
    group,
    students: ranking.length,
    averagePercent,
    completion,
    distribution,
    lagging,
    ranking,
  };
}

export interface SubjectOverview {
  activities: number;
  sessions: number;
  students: number;
  graded: number;
  totalCells: number;
  completion: number;
  averagePercent: number | null;
  overdueDeadlines: number;
  lectureSessions: number;
  lecturePresent: number;
  lectureMarked: number;
}

export function subjectOverview(snap: Snapshot, subjectId: string): SubjectOverview {
  const activities = subjectActivities(snap, subjectId);
  const sessions = subjectSessions(snap, subjectId);
  const enrollments = snap.enrollments.filter((e) => !e.deletedAt && e.subjectId === subjectId);
  let graded = 0;
  let totalCells = 0;
  let sum = 0;
  let lectureSessions = 0;
  let lecturePresent = 0;
  let lectureMarked = 0;
  const subject = findSubject(snap, subjectId);
  const activityMap = new Map(activities.map((a) => [a.id, a]));
  for (const session of sessions) {
    const activity = activityMap.get(session.activityId);
    if (!activity) continue;
    const roster = sessionRoster(snap, session);
    if (!isGradedType(activity.type)) {
      lectureSessions += 1;
      for (const student of roster) {
        const attendance = attendanceOf(snap, session.id, student.id);
        if (attendance) {
          lectureMarked += 1;
          if (attendance.present) lecturePresent += 1;
        }
      }
      continue;
    }
    totalCells += roster.length;
    const max = activityMaxScore(subject, activity);
    for (const student of roster) {
      const grade = gradeOf(snap, session.id, student.id);
      if (grade && grade.score != null) {
        graded += 1;
        sum += (grade.score / max) * 100;
      }
    }
  }
  const today = todayIso();
  const overdue = sessions.filter((s) => s.date < today && studentMissingGrades(snap, s)).length;
  return {
    activities: activities.length,
    sessions: sessions.length,
    students: enrollments.length,
    graded,
    totalCells,
    completion: totalCells ? (graded / totalCells) * 100 : 0,
    averagePercent: graded ? sum / graded : null,
    overdueDeadlines: overdue,
    lectureSessions,
    lecturePresent,
    lectureMarked,
  };
}

/** Есть ли в сессии студенты без оценки (для лекций — без отметки посещаемости). */
export function studentMissingGrades(snap: Snapshot, session: ActivitySession): boolean {
  const activity = findActivity(snap, session.activityId);
  const roster = sessionRoster(snap, session);
  const attendanceOnly = activity ? !isGradedType(activity.type) : false;
  return roster.some((student) => {
    if (attendanceOnly) return !attendanceOf(snap, session.id, student.id);
    const grade = gradeOf(snap, session.id, student.id);
    return !grade || grade.score == null;
  });
}

/** Группы предмета: по подгруппам, зачислениям и сессиям. */
export function collectSubjectGroups(snap: Snapshot, subjectId: string): Group[] {
  const ids = new Set<string>();
  for (const subgroup of snap.subgroups) {
    if (subgroup.subjectId === subjectId && !subgroup.deletedAt) ids.add(subgroup.groupId);
  }
  for (const enrollment of snap.enrollments) {
    if (enrollment.subjectId === subjectId && !enrollment.deletedAt) ids.add(enrollment.groupId);
  }
  for (const session of snap.sessions) {
    if (session.subjectId === subjectId && !session.deletedAt) ids.add(session.groupId);
  }
  return snap.groups
    .filter((group) => !group.deletedAt && ids.has(group.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Состав группы: явные участники + все, кто зачислен в её предметы. */
export function groupStudents(snap: Snapshot, groupId: string): Student[] {
  const ids = new Set<string>();
  for (const member of snap.groupMembers) {
    if (!member.deletedAt && member.groupId === groupId) ids.add(member.studentId);
  }
  for (const enrollment of snap.enrollments) {
    if (!enrollment.deletedAt && enrollment.groupId === groupId) ids.add(enrollment.studentId);
  }
  return snap.students
    .filter((student) => !student.deletedAt && ids.has(student.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Предметы, в которые группа зачислена или для которых у неё есть занятия. */
export function groupSubjects(snap: Snapshot, groupId: string): Subject[] {
  const ids = new Set<string>();
  for (const subgroup of snap.subgroups) {
    if (subgroup.groupId === groupId && !subgroup.deletedAt) ids.add(subgroup.subjectId);
  }
  for (const enrollment of snap.enrollments) {
    if (enrollment.groupId === groupId && !enrollment.deletedAt) ids.add(enrollment.subjectId);
  }
  for (const session of snap.sessions) {
    if (session.groupId === groupId && !session.deletedAt) ids.add(session.subjectId);
  }
  return snap.subjects
    .filter((subject) => !subject.deletedAt && ids.has(subject.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, max: number): string {
  if (value == null) return '—';
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${fixed} / ${max}`;
}
