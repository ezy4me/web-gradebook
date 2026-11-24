import { db } from './db';
import {
  addStudentToGroup,
  createStudent,
  createSubject,
  ensureSubgroups,
  enrollStudent,
  findOrCreateGroup,
} from './repo';

/**
 * Импорт групп и студентов.
 *
 * Группа — самостоятельная сущность: студенты записываются в её состав и могут
 * учиться в нескольких предметах. Поддерживаются форматы:
 *
 * { "subjects": ["Веб-разработка", "Базы данных"],
 *   "groups": [{ "name": "4232", "students": [{ "name": "Иванов Иван", "subgroup": 1 }] }] }
 *
 * или плоский список:
 * [ { "name": "Иванов Иван", "group": "4232", "subgroup": 1, "subjects": ["Веб-разработка"] } ]
 *
 * `subjects` необязателен: без него студенты просто попадают в состав группы,
 * а зачислить группу в предметы можно позже одним действием.
 */

export interface StudentImportEntry {
  name: string;
  group: string;
  subgroup: number | null;
  comment: string;
}

export interface StudentsPlan {
  subjects: string[];
  entries: StudentImportEntry[];
  groups: string[];
  subgroups: { group: string; count: number }[];
  skipped: number;
}

function parseSubgroup(value: unknown): number | null {
  if (value == null || value === '') return null;
  const match = /(\d+)/.exec(String(value));
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index : null;
}

function normalizeEntry(raw: unknown): StudentImportEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const name = String(record.name ?? '').trim();
  const group = String(record.group ?? record.groupName ?? '').trim();
  if (!name || !group) return null;
  return {
    name,
    group,
    subgroup: parseSubgroup(record.subgroup ?? record.subgroupIndex),
    comment: String(record.comment ?? '').trim(),
  };
}

export function parseStudentsJson(text: string): StudentsPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }

  const entries: StudentImportEntry[] = [];
  const subjectNames = new Set<string>();
  let skipped = 0;

  const addSubjects = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) subjectNames.add(value.trim());
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) subjectNames.add(item.trim());
      }
    }
  };

  const addEntries = (list: unknown[], groupName?: string) => {
    for (const raw of list) {
      if (typeof raw === 'string') {
        const name = raw.trim();
        const group = String(groupName ?? '').trim();
        if (name && group) entries.push({ name, group, subgroup: null, comment: '' });
        else skipped += 1;
        continue;
      }
      if (raw && typeof raw === 'object') addSubjects((raw as Record<string, unknown>).subjects);
      const entry = normalizeEntry(
        groupName && raw && typeof raw === 'object'
          ? { ...(raw as Record<string, unknown>), group: groupName }
          : raw,
      );
      if (entry) entries.push(entry);
      else skipped += 1;
    }
  };

  if (Array.isArray(parsed)) {
    addEntries(parsed);
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    addSubjects(record.subject);
    addSubjects(record.subjects);

    if (Array.isArray(record.groups)) {
      for (const rawGroup of record.groups) {
        if (!rawGroup || typeof rawGroup !== 'object') {
          skipped += 1;
          continue;
        }
        const groupRecord = rawGroup as Record<string, unknown>;
        addSubjects(groupRecord.subjects);
        const groupName = String(groupRecord.name ?? groupRecord.group ?? '').trim();
        if (!groupName) {
          skipped += 1;
          continue;
        }
        const students = groupRecord.students ?? groupRecord.members ?? [];
        if (!Array.isArray(students)) {
          skipped += 1;
          continue;
        }
        addEntries(students, groupName);
      }
    } else if (Array.isArray(record.students)) {
      addEntries(record.students);
    }
  }

  if (!entries.length) {
    throw new Error('Нужен список студентов с группами: groups[].students или students[]');
  }

  const byKey = new Map<string, StudentImportEntry>();
  for (const entry of entries) {
    const key = `${entry.group.toLowerCase()}|${entry.name.toLowerCase()}`;
    byKey.set(key, entry);
  }
  const unique = [...byKey.values()].sort(
    (a, b) => a.group.localeCompare(b.group, 'ru') || a.name.localeCompare(b.name, 'ru'),
  );

  const groups = [...new Set(unique.map((entry) => entry.group))].sort((a, b) => a.localeCompare(b, 'ru'));
  const subgroups = groups.map((group) => {
    const indexes = unique
      .filter((entry) => entry.group === group && entry.subgroup != null)
      .map((entry) => entry.subgroup as number);
    return { group, count: indexes.length ? Math.max(2, ...indexes) : 2 };
  });

  return {
    subjects: [...subjectNames].sort((a, b) => a.localeCompare(b, 'ru')),
    entries: unique,
    groups,
    subgroups,
    skipped,
  };
}

export interface StudentsImportResult {
  groupsCreated: number;
  studentsCreated: number;
  memberships: number;
  enrolled: number;
  subjects: string[];
  subjectsCreated: number;
  skipped: number;
}

export async function importStudents(plan: StudentsPlan): Promise<StudentsImportResult> {
  const result: StudentsImportResult = {
    groupsCreated: 0,
    studentsCreated: 0,
    memberships: 0,
    enrolled: 0,
    subjects: plan.subjects,
    subjectsCreated: 0,
    skipped: plan.skipped,
  };

  await db.transaction(
    'rw',
    [db.subjects, db.students, db.groups, db.groupMembers, db.subgroups, db.enrollments, db.sessions],
    async () => {
      const subjectIds = new Map<string, string>();
      for (const name of plan.subjects) {
        const needle = name.toLowerCase();
        const existing = await db.subjects
          .filter((candidate) => !candidate.deletedAt && candidate.name.toLowerCase() === needle)
          .first();
        if (existing) {
          subjectIds.set(needle, existing.id);
        } else {
          const created = await createSubject({ name });
          subjectIds.set(needle, created.id);
          result.subjectsCreated += 1;
        }
      }

      const existingStudents = await db.students.filter((student) => !student.deletedAt).toArray();
      const studentByName = new Map(existingStudents.map((student) => [student.name.toLowerCase(), student]));

      const groupCache = new Map<string, { id: string; name: string }>();
      const subgroupCache = new Map<string, { id: string; index: number }[]>();

      for (const entry of plan.entries) {
        const groupKey = entry.group.toLowerCase();
        let group = groupCache.get(groupKey);
        if (!group) {
          const existingGroup = await db.groups
            .filter((candidate) => !candidate.deletedAt && candidate.name.toLowerCase() === groupKey)
            .first();
          if (existingGroup) {
            group = { id: existingGroup.id, name: existingGroup.name };
          } else {
            const created = await findOrCreateGroup(entry.group);
            group = { id: created.id, name: created.name };
            result.groupsCreated += 1;
          }
          groupCache.set(groupKey, group);
        }

        let student = studentByName.get(entry.name.toLowerCase());
        if (!student) {
          student = await createStudent(entry.name, entry.comment);
          studentByName.set(entry.name.toLowerCase(), student);
          result.studentsCreated += 1;
        }

        await addStudentToGroup(group.id, student.id);
        result.memberships += 1;

        for (const subjectId of subjectIds.values()) {
          const existing = await db.enrollments
            .where('[subjectId+studentId]')
            .equals([subjectId, student.id])
            .first();

          const cacheKey = `${subjectId}|${group.id}`;
          let subgroups = subgroupCache.get(cacheKey);
          if (!subgroups) {
            const planSubgroups = plan.subgroups.find((item) => item.group.toLowerCase() === groupKey);
            const count = Math.max(2, planSubgroups?.count ?? 0);
            const created = await ensureSubgroups(subjectId, group.id, count);
            subgroups = created.map((subgroup) => ({ id: subgroup.id, index: subgroup.index }));
            subgroupCache.set(cacheKey, subgroups);
          }
          const explicitSubgroup = entry.subgroup
            ? subgroups.find((item) => item.index === entry.subgroup) ?? null
            : null;

          if (existing && !existing.deletedAt && existing.groupId === group.id) {
            if (explicitSubgroup && existing.subgroupId !== explicitSubgroup.id) {
              await enrollStudent({
                subjectId,
                groupId: group.id,
                studentId: student.id,
                subgroupId: explicitSubgroup.id,
              });
            }
            continue;
          }

          const existingCount = await db.enrollments
            .where('[subjectId+groupId]')
            .equals([subjectId, group.id])
            .filter((enrollment) => !enrollment.deletedAt)
            .count();
          const subgroup =
            explicitSubgroup ?? subgroups[existingCount % subgroups.length] ?? null;
          await enrollStudent({
            subjectId,
            groupId: group.id,
            studentId: student.id,
            subgroupId: subgroup?.id ?? null,
          });
          result.enrolled += 1;
        }
      }
    },
  );

  return result;
}
