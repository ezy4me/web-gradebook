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
import { markAllStoresDirty, markStoreDirty, STORE_ORDER } from '../sync/dirty';

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

    // Любая точечная запись помечает стор грязным для Supabase/Drive.
    for (const store of STORE_ORDER) {
      const table = (this as unknown as Record<string, Table<{ id: string }>>)[store];
      if (!table) continue;
      table.hook('creating', () => markStoreDirty(store));
      table.hook('updating', () => markStoreDirty(store));
      table.hook('deleting', () => markStoreDirty(store));
    }
  }
}

export const db = new GradebookDB();

/**
 * Очистка локальной базы. Физически строки не удаляем: ставим tombstone,
 * чтобы удаление уехало в облако и не вернулось следующим pull.
 */
export async function wipeDatabase(): Promise<void> {
  const stamp = nowIso();
  await db.transaction(
    'rw',
    [db.subjects, db.groups, db.groupMembers, db.subgroups, db.students, db.enrollments, db.activities, db.sessions, db.grades, db.attendance],
    async () => {
      await Promise.all([
        db.subjects.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.groups.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.groupMembers.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.subgroups.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.students.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.enrollments.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.activities.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.sessions.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.grades.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
        db.attendance.toCollection().modify({ deletedAt: stamp, updatedAt: stamp }),
      ]);
    },
  );
  markAllStoresDirty();
}
