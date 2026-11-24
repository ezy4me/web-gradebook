import { db } from './db';
import {
  createActivity,
  createSession,
  createSubject,
  ensureSubgroups,
  findOrCreateGroup,
} from './repo';
import { ACTIVITY_TYPE_LABEL, type ActivityType } from './types';
import { todayIso } from '../lib/date';

/**
 * Импорт расписания из формата web-schedule (плоский список пар с датами).
 *
 * Пример:
 * [{ "day": "Понедельник", "time": "08:00", "dates": ["07.09"],
 *    "group": "4433", "type": "л.р.", "subject": "…", "room": "7 / 219" }]
 *
 * Каждая дата пары становится отдельным занятием с одной сессией: так журнал
 * повторяет сетку пар и позволяет оценивать каждую встречу. Для лабораторных
 * подгруппы чередуются 1 → 2 → 1 → 2 по датам (как в правилах проекта).
 */

export interface ScheduleLesson {
  dates: string[];
  group: string;
  type: string;
  subject: string;
  time?: string;
  day?: string;
  room?: string;
}

export interface ScheduleEntry {
  date: string;
  time: string;
  subject: string;
  group: string;
  type: ActivityType;
}

export interface SchedulePlan {
  startYear: number;
  entries: ScheduleEntry[];
  subjects: string[];
  groups: string[];
  skipped: number;
  range: { from: string; to: string } | null;
}

const TYPE_MAP: Record<string, ActivityType> = {
  лек: 'lecture',
  лекция: 'lecture',
  лекции: 'lecture',
  пр: 'practice',
  прак: 'practice',
  практика: 'practice',
  практики: 'practice',
  'л.р.': 'lab',
  'л.р': 'lab',
  лаб: 'lab',
  лаба: 'lab',
  лабораторная: 'lab',
  лабораторные: 'lab',
};

export function defaultStartYear(today = todayIso()): number {
  const [year, month] = today.split('-').map(Number);
  return month >= 8 ? year : year - 1;
}

function toIsoDate(value: string, startYear: number): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year: number;
  if (match[3]) {
    year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  } else {
    year = month >= 8 ? startYear : startYear + 1;
  }
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseScheduleJson(text: string, startYear = defaultStartYear()): SchedulePlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }

  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { lessons?: unknown[] })?.lessons)
      ? ((parsed as { lessons: unknown[] }).lessons as unknown[])
      : [];

  if (!list.length) {
    throw new Error('Нужен плоский список пар: массив объектов с dates, group, type, subject');
  }

  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      skipped += 1;
      continue;
    }
    const lesson = raw as Partial<ScheduleLesson>;
    if (!lesson.subject || !lesson.group || !Array.isArray(lesson.dates)) {
      skipped += 1;
      continue;
    }
    const type = TYPE_MAP[String(lesson.type ?? '').trim().toLowerCase()];
    if (!type) {
      skipped += 1;
      continue;
    }
    const groups = String(lesson.group)
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean);
    const subject = String(lesson.subject).trim();

    for (const group of groups) {
      for (const rawDate of lesson.dates) {
        const date = toIsoDate(String(rawDate), startYear);
        if (!date) {
          skipped += 1;
          continue;
        }
        const key = `${subject}|${group}|${type}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ date, subject, group, type, time: lesson.time ?? '' });
      }
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return {
    startYear,
    entries,
    subjects: [...new Set(entries.map((entry) => entry.subject))].sort((a, b) => a.localeCompare(b, 'ru')),
    groups: [...new Set(entries.map((entry) => entry.group))].sort((a, b) => a.localeCompare(b, 'ru')),
    skipped,
    range: entries.length
      ? { from: entries[0].date, to: entries[entries.length - 1].date }
      : null,
  };
}

export interface ScheduleImportResult {
  subjectsCreated: number;
  groupsCreated: number;
  activities: number;
  sessions: number;
  skipped: number;
}

export async function importSchedule(plan: SchedulePlan): Promise<ScheduleImportResult> {
  const result: ScheduleImportResult = {
    subjectsCreated: 0,
    groupsCreated: 0,
    activities: 0,
    sessions: 0,
    skipped: 0,
  };

  await db.transaction(
    'rw',
    [db.subjects, db.groups, db.subgroups, db.activities, db.sessions],
    async () => {
      const subjectIds = new Map<string, { id: string; name: string }>();
      const groupCache = new Map<string, string>();
      const subgroupCache = new Map<string, string[]>();

      // Нумерация занятий — в пределах предмета, группы и вида.
      const activities = await db.activities.filter((activity) => !activity.deletedAt).toArray();
      const activityType = new Map(activities.map((activity) => [activity.id, activity.type]));
      const sessions = await db.sessions.filter((session) => !session.deletedAt).toArray();
      const sequence = new Map<string, number>();
      const seenActivities = new Map<string, Set<string>>();
      for (const session of sessions) {
        const type = activityType.get(session.activityId);
        if (!type) continue;
        const key = `${session.subjectId}|${session.groupId}|${type}`;
        const set = seenActivities.get(key) ?? new Set<string>();
        set.add(session.activityId);
        seenActivities.set(key, set);
      }
      for (const [key, set] of seenActivities) sequence.set(key, set.size);

      const byLesson = new Map<string, ScheduleEntry[]>();
      for (const entry of plan.entries) {
        const key = `${entry.subject.toLowerCase()}|${entry.group.toLowerCase()}|${entry.type}`;
        const list = byLesson.get(key) ?? [];
        list.push(entry);
        byLesson.set(key, list);
      }

      const getSubject = async (name: string) => {
        const key = name.toLowerCase();
        const cached = subjectIds.get(key);
        if (cached) return cached;
        const existing = await db.subjects
          .filter((candidate) => !candidate.deletedAt && candidate.name.toLowerCase() === key)
          .first();
        if (existing) {
          const entry = { id: existing.id, name: existing.name };
          subjectIds.set(key, entry);
          return entry;
        }
        const created = await createSubject({ name });
        result.subjectsCreated += 1;
        const entry = { id: created.id, name: created.name };
        subjectIds.set(key, entry);
        return entry;
      };

      const getGroup = async (name: string) => {
        const key = name.toLowerCase();
        const cached = groupCache.get(key);
        if (cached) return cached;
        const existing = await db.groups
          .filter((candidate) => !candidate.deletedAt && candidate.name.toLowerCase() === key)
          .first();
        if (existing) {
          groupCache.set(key, existing.id);
          return existing.id;
        }
        const created = await findOrCreateGroup(name);
        result.groupsCreated += 1;
        groupCache.set(key, created.id);
        return created.id;
      };

      const hasClash = async (subjectId: string, groupId: string, date: string, type: ActivityType) => {
        const sameDaySessions = await db.sessions
          .filter(
            (session) =>
              !session.deletedAt &&
              session.subjectId === subjectId &&
              session.groupId === groupId &&
              session.date === date,
          )
          .toArray();
        const sameDayActivities = await Promise.all(
          sameDaySessions.map((session) => db.activities.get(session.activityId)),
        );
        return sameDayActivities.some((activity) => activity?.type === type);
      };

      for (const entries of byLesson.values()) {
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        const first = entries[0];
        const subject = await getSubject(first.subject);
        const groupId = await getGroup(first.group);
        const sequenceKey = `${subject.id}|${groupId}|${first.type}`;
        const pairKey = `${subject.id}|${groupId}`;

        if (first.type === 'lab') {
          let ids = subgroupCache.get(pairKey);
          if (!ids) {
            const subgroups = await ensureSubgroups(subject.id, groupId, 2);
            ids = subgroups.map((subgroup) => subgroup.id);
            subgroupCache.set(pairKey, ids);
          }
          const perLab = Math.max(1, ids.length);

          // Одна лабораторная = один блок дат: подгруппа 1 и 2 ходят в разные дни.
          for (let start = 0; start < entries.length; start += perLab) {
            const chunk = entries.slice(start, start + perLab);
            let clash = false;
            for (const entry of chunk) {
              if (await hasClash(subject.id, groupId, entry.date, 'lab')) {
                clash = true;
                break;
              }
            }
            if (clash) {
              result.skipped += chunk.length;
              continue;
            }

            const index = (sequence.get(sequenceKey) ?? 0) + 1;
            sequence.set(sequenceKey, index);
            const activity = await createActivity({
              subjectId: subject.id,
              type: 'lab',
              title: `${ACTIVITY_TYPE_LABEL.lab} ${index}`,
              maxScore: 0,
              weight: null,
              deadline: null,
            });

            for (let position = 0; position < chunk.length; position++) {
              await createSession({
                subjectId: subject.id,
                activityId: activity.id,
                groupId,
                subgroupId: ids[position % perLab] ?? null,
                date: chunk[position].date,
              });
              result.sessions += 1;
            }
            result.activities += 1;
          }
          continue;
        }

        for (const entry of entries) {
          if (await hasClash(subject.id, groupId, entry.date, entry.type)) {
            result.skipped += 1;
            continue;
          }
          const index = (sequence.get(sequenceKey) ?? 0) + 1;
          sequence.set(sequenceKey, index);
          const activity = await createActivity({
            subjectId: subject.id,
            type: entry.type,
            title: `${ACTIVITY_TYPE_LABEL[entry.type]} ${index}`,
            maxScore: 0,
            weight: null,
            deadline: null,
          });
          await createSession({
            subjectId: subject.id,
            activityId: activity.id,
            groupId,
            subgroupId: null,
            date: entry.date,
          });
          result.activities += 1;
          result.sessions += 1;
        }
      }
    },
  );

  return result;
}
