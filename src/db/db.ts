import Dexie, { type Table } from 'dexie';
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
import { newId, nowIso } from '../lib/date';

/**
 * Локальная база (IndexedDB / Dexie) — единственный источник истины для UI.
 * Схема повторяет серверную (Supabase), имена сторов в drivestash — с префиксом
 * `web-gradebook:` (см. docs/ARCHITECTURE.md).
 */
export class GradebookDB extends Dexie {
  subjects!: Table<Subject, string>;
  groups!: Table<Group, string>;
  groupMembers!: Table<GroupMember, string>;
  subgroups!: Table<Subgroup, string>;
  students!: Table<Student, string>;
  enrollments!: Table<Enrollment, string>;
  activities!: Table<Activity, string>;
  sessions!: Table<ActivitySession, string>;
  grades!: Table<Grade, string>;
  attendance!: Table<Attendance, string>;

  constructor() {
    super('web-gradebook');
    this.version(1).stores({
      subjects: 'id, name, archivedAt, updatedAt',
      groups: 'id, name, updatedAt',
      subgroups: 'id, subjectId, groupId, [subjectId+groupId], updatedAt',
      students: 'id, name, updatedAt',
      enrollments: 'id, subjectId, studentId, groupId, [subjectId+groupId], [subjectId+studentId], subgroupId, updatedAt',
      activities: 'id, subjectId, type, [subjectId+order], updatedAt',
      sessions: 'id, subjectId, activityId, groupId, subgroupId, date, [activityId+date], [subjectId+date], updatedAt',
      grades: 'id, subjectId, activityId, sessionId, studentId, [sessionId+studentId], [subjectId+studentId], updatedAt',
      attendance: 'id, subjectId, sessionId, studentId, [sessionId+studentId], updatedAt',
    });
    // v2: состав группы становится глобальной сущностью.
    this.version(2)
      .stores({
        groupMembers: 'id, groupId, studentId, [groupId+studentId], updatedAt',
      })
      .upgrade(async (tx) => {
        const enrollments = (await tx.table('enrollments').toArray()) as Enrollment[];
        const seen = new Set<string>();
        const stamp = nowIso();
        const rows: GroupMember[] = [];
        for (const enrollment of enrollments) {
          if (enrollment.deletedAt) continue;
          const key = `${enrollment.groupId}|${enrollment.studentId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            id: newId(),
            groupId: enrollment.groupId,
            studentId: enrollment.studentId,
            createdAt: stamp,
            updatedAt: stamp,
            deletedAt: null,
          });
        }
        if (rows.length) await tx.table('groupMembers').bulkAdd(rows);
      });
  }
}

export const db = new GradebookDB();

/** Полная очистка локальной базы (используется в настройках). */
export async function wipeDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.subjects, db.groups, db.groupMembers, db.subgroups, db.students, db.enrollments, db.activities, db.sessions, db.grades, db.attendance],
    async () => {
      await Promise.all([
        db.subjects.clear(),
        db.groups.clear(),
        db.groupMembers.clear(),
        db.subgroups.clear(),
        db.students.clear(),
        db.enrollments.clear(),
        db.activities.clear(),
        db.sessions.clear(),
        db.grades.clear(),
        db.attendance.clear(),
      ]);
    },
  );
}
