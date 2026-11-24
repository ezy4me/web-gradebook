import { type Table } from 'dexie';
import { db } from './db';
import type { BackupFile } from './types';
import { newId, nowIso } from '../lib/date';

const FORMAT = 'web-gradebook-backup';

/** Полный снимок локальной базы (включая soft-deleted записи — для точного восстановления). */
export async function buildBackup(): Promise<BackupFile> {
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
  return {
    format: FORMAT,
    version: 2,
    exportedAt: nowIso(),
    data: {
      subjects,
      groups,
      groupMembers,
      subgroups,
      students,
      enrollments,
      activities,
      sessions,
      grades,
      attendance,
    },
  };
}

export function backupFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `web-gradebook-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup();
  downloadJson(backup, backupFileName());
}

export interface BackupSummary {
  subjects: number;
  students: number;
  activities: number;
  sessions: number;
  grades: number;
  attendance: number;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  return {
    subjects: backup.data.subjects.filter((s) => !s.deletedAt).length,
    students: backup.data.students.filter((s) => !s.deletedAt).length,
    activities: backup.data.activities.filter((a) => !a.deletedAt).length,
    sessions: backup.data.sessions.filter((s) => !s.deletedAt).length,
    grades: backup.data.grades.filter((g) => !g.deletedAt).length,
    attendance: backup.data.attendance.filter((a) => !a.deletedAt).length,
  };
}

/** Разбор и валидация файла бэкапа. Бросает Error с понятным сообщением. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Неверная структура файла');
  const candidate = parsed as Partial<BackupFile>;
  if (candidate.format !== FORMAT) throw new Error('Это не бэкап web-gradebook');
  if (candidate.version !== 1 && candidate.version !== 2) {
    throw new Error(`Неподдерживаемая версия бэкапа: ${String(candidate.version)}`);
  }
  const data = candidate.data;
  if (!data || typeof data !== 'object') throw new Error('В бэкапе отсутствует блок data');
  const required: (keyof BackupFile['data'])[] = [
    'subjects',
    'groups',
    'subgroups',
    'students',
    'enrollments',
    'activities',
    'sessions',
    'grades',
    'attendance',
  ];
  for (const key of required) {
    if (!Array.isArray(data[key])) throw new Error(`Повреждён раздел «${key}»`);
  }
  if (!Array.isArray(data.groupMembers)) data.groupMembers = [];
  return candidate as BackupFile;
}

export type ImportMode = 'replace' | 'merge';

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Импорт бэкапа.
 * - replace: полностью заменяет локальные данные.
 * - merge: last-write-wins по `updatedAt` (совпадающие id), новые записи добавляются.
 */
export async function importBackup(backup: BackupFile, mode: ImportMode): Promise<ImportResult> {
  type SnapshotTable = Table<{ id: string; updatedAt: string }>;
  const pairs: { key: keyof BackupFile['data']; table: SnapshotTable }[] = [
    { key: 'subjects', table: db.subjects as unknown as SnapshotTable },
    { key: 'groups', table: db.groups as unknown as SnapshotTable },
    { key: 'groupMembers', table: db.groupMembers as unknown as SnapshotTable },
    { key: 'subgroups', table: db.subgroups as unknown as SnapshotTable },
    { key: 'students', table: db.students as unknown as SnapshotTable },
    { key: 'enrollments', table: db.enrollments as unknown as SnapshotTable },
    { key: 'activities', table: db.activities as unknown as SnapshotTable },
    { key: 'sessions', table: db.sessions as unknown as SnapshotTable },
    { key: 'grades', table: db.grades as unknown as SnapshotTable },
    { key: 'attendance', table: db.attendance as unknown as SnapshotTable },
  ];
  const tables = pairs.map((p) => p.table);

  let added = 0;
  let updated = 0;
  let skipped = 0;

  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') {
      await Promise.all(tables.map((table) => table.clear()));
    }
    for (const { key, table } of pairs) {
      const rows = backup.data[key];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row.id !== 'string') {
          skipped += 1;
          continue;
        }
        const existing = mode === 'merge' ? await table.get(row.id) : undefined;
        if (existing) {
          if ((existing.updatedAt ?? '') >= (row.updatedAt ?? '')) {
            skipped += 1;
            continue;
          }
          updated += 1;
        } else {
          added += 1;
        }
        await table.put(row);
      }
    }
  });

  await deriveMembershipsFromEnrollments();

  return { added, updated, skipped };
}

/** Бэкапы v1 не содержат groupMembers — восстанавливаем состав по зачислениям. */
async function deriveMembershipsFromEnrollments(): Promise<void> {
  const enrollments = await db.enrollments.filter((enrollment) => !enrollment.deletedAt).toArray();
  for (const enrollment of enrollments) {
    const existing = await db.groupMembers
      .where('[groupId+studentId]')
      .equals([enrollment.groupId, enrollment.studentId])
      .first();
    if (existing) {
      if (existing.deletedAt) await db.groupMembers.update(existing.id, { deletedAt: null });
      continue;
    }
    await db.groupMembers.add({
      id: newId(),
      groupId: enrollment.groupId,
      studentId: enrollment.studentId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    });
  }
}
