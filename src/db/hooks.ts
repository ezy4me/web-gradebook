import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type {
  Activity,
  ActivitySession,
  Attendance,
  Enrollment,
  Grade,
  Group,
  GroupMember,
  Student,
  Subject,
  Subgroup,
} from './types';
import type { Snapshot } from '../domain/grading';
import { useMemo } from 'react';

/** Живой снимок локальной базы (перерисовывается на любое изменение). */
export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(async () => {
    const [subjects, groups, groupMembers, subgroups, students, enrollments, activities, sessions, grades, attendance] =
      await Promise.all([
        db.subjects.toArray(),
        db.groups.toArray(),
        db.groupMembers.toArray(),
        db.subgroups.toArray(),
        db.students.toArray(),
        db.enrollments.toArray(),
        db.activities.toArray(),
        db.sessions.toArray(),
        db.grades.toArray(),
        db.attendance.toArray(),
      ]);
    return { subjects, groups, groupMembers, subgroups, students, enrollments, activities, sessions, grades, attendance };
  }, []);
}

export function useActiveSubjects(): Subject[] | undefined {
  const snapshot = useSnapshot();
  return useMemo(
    () =>
      snapshot?.subjects
        .filter((s) => !s.deletedAt)
        .sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.name.localeCompare(b.name, 'ru')),
    [snapshot],
  );
}

export function useSubject(subjectId: string | undefined): Subject | undefined {
  const snapshot = useSnapshot();
  return useMemo(
    () => (subjectId ? snapshot?.subjects.find((s) => s.id === subjectId && !s.deletedAt) : undefined),
    [snapshot, subjectId],
  );
}

export function useActivity(activityId: string | undefined): Activity | undefined {
  const snapshot = useSnapshot();
  return useMemo(
    () => (activityId ? snapshot?.activities.find((a) => a.id === activityId && !a.deletedAt) : undefined),
    [snapshot, activityId],
  );
}

export function useSession(sessionId: string | undefined): ActivitySession | undefined {
  const snapshot = useSnapshot();
  return useMemo(
    () => (sessionId ? snapshot?.sessions.find((s) => s.id === sessionId && !s.deletedAt) : undefined),
    [snapshot, sessionId],
  );
}

export type { Snapshot, Subject, Group, GroupMember, Subgroup, Student, Enrollment, Activity, ActivitySession, Grade, Attendance };
