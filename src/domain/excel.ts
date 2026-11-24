/**
 * Книга Excel для журнала: сводка по предметам и группам + лист на каждую пару
 * «предмет × группа». Структура листа повторяет таблицу приложения:
 *
 *   ЛР1            ПЗ2           Лекция 3
 *   12.09 / 15.09  19.09         26.09
 *   Явка | Балл    Явка | Балл   Явка
 *
 * Студент, подгруппа, клетки явки и балла, итог, оценка и посещаемость.
 */

import type {
  Activity,
  ActivitySession,
  Enrollment,
  Group,
  Subject,
} from '../db/types';
import {
  activityMaxScore,
  attendanceOf,
  collectSubjectGroups,
  gradeOf,
  groupRanking,
  isGradedType,
  subjectActivities,
  type Snapshot,
} from './grading';
import { formatDate } from '../lib/date';
import { gradeBand, scoreBand, type GradeTone } from '../lib/grades';
import { downloadXlsx, type XlsxCell, type XlsxRow, type XlsxSheet, type XlsxStyle } from '../lib/xlsx';

const INK = '#2F2A24';
const WARM = '#EFE8DA';
const WARM_STRONG = '#E4DCCB';
const MUTED = '#7A6F61';

const TYPE_FILL: Record<Activity['type'], string> = {
  lab: '#3F5B4E',
  practice: '#8A5A3B',
  lecture: '#4A5568',
};

const FILLS: Record<GradeTone, { fill: string; color: string }> = {
  grade2: { fill: '#F5DDD8', color: '#8C3B32' },
  grade3: { fill: '#F6E3CC', color: '#8A5A2B' },
  grade4: { fill: '#F3ECCB', color: '#6F6220' },
  grade5: { fill: '#DDEBDD', color: '#3F5B4E' },
};

const S = {
  title: { bold: true, size: 16, color: INK },
  subtitle: { size: 9.5, color: MUTED },
  note: { italic: true, size: 9, color: MUTED },
  metaHead: {
    bold: true,
    size: 10,
    color: '#FFFFFF',
    fill: INK,
    border: 'thin',
    align: 'center',
    wrap: true,
  } as XlsxStyle,
  dateHead: {
    size: 9.5,
    color: MUTED,
    fill: WARM,
    border: 'thin',
    align: 'center',
    wrap: true,
  } as XlsxStyle,
  subHead: {
    bold: true,
    size: 9.5,
    color: '#5E5448',
    fill: WARM_STRONG,
    border: 'thin',
    align: 'center',
    wrap: true,
  } as XlsxStyle,
  num: { size: 10, color: MUTED, border: 'thin', align: 'center' } as XlsxStyle,
  name: { size: 10.5, color: INK, border: 'thin', align: 'left' } as XlsxStyle,
  subgroup: { size: 9.5, color: MUTED, border: 'thin', align: 'center' } as XlsxStyle,
  present: {
    size: 10,
    color: '#3F5B4E',
    fill: '#DDEBDD',
    border: 'thin',
    align: 'center',
  } as XlsxStyle,
  absent: {
    size: 10,
    color: '#8C3B32',
    fill: '#F5DDD8',
    border: 'thin',
    align: 'center',
  } as XlsxStyle,
  blank: {
    size: 10,
    color: '#A79C8C',
    fill: '#F4F0E7',
    border: 'thin',
    align: 'center',
  } as XlsxStyle,
  percent: {
    size: 10,
    color: INK,
    border: 'thin',
    align: 'center',
    numFmt: '0"%"',
  } as XlsxStyle,
  percentMuted: {
    size: 10,
    color: MUTED,
    border: 'thin',
    align: 'center',
    numFmt: '0"%"',
  } as XlsxStyle,
  grade: { bold: true, size: 11, border: 'thin', align: 'center' } as XlsxStyle,
  averageLabel: {
    bold: true,
    size: 10,
    color: INK,
    fill: WARM,
    border: 'thin',
    align: 'right',
  } as XlsxStyle,
  averageValue: {
    bold: true,
    size: 10,
    color: INK,
    fill: WARM,
    border: 'thin',
    align: 'center',
    numFmt: '0"%"',
  } as XlsxStyle,
  summaryHead: {
    bold: true,
    size: 10,
    color: '#FFFFFF',
    fill: INK,
    border: 'thin',
    align: 'center',
    wrap: true,
  } as XlsxStyle,
  summaryText: { size: 10, color: INK, border: 'thin', align: 'left' } as XlsxStyle,
  summaryNum: { size: 10, color: INK, border: 'thin', align: 'center' } as XlsxStyle,
  summaryPercent: {
    size: 10,
    color: INK,
    border: 'thin',
    align: 'center',
    numFmt: '0"%"',
  } as XlsxStyle,
} satisfies Record<string, XlsxStyle>;

interface ActivityColumn {
  activity: Activity;
  sessions: ActivitySession[];
  max: number;
  attendanceOnly: boolean;
  width: number;
}

interface GroupExport {
  subject: Subject;
  group: Group;
  sheet: XlsxSheet;
  students: number;
  activities: number;
  average: number | null;
  success: number | null;
  attendance: number | null;
}

function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

function activityWidth(activity: Activity): number {
  if (!isGradedType(activity.type)) return 9;
  return 17;
}

/** Сессия занятия для студента: общая для группы или его подгруппы. */
function sessionFor(sessions: ActivitySession[], enrollment: Enrollment | undefined): ActivitySession | null {
  const whole = sessions.find((session) => session.subgroupId == null);
  if (whole) return whole;
  if (!enrollment?.subgroupId) return null;
  return sessions.find((session) => session.subgroupId === enrollment.subgroupId) ?? null;
}

function buildGroupSheet(
  snapshot: Snapshot,
  subject: Subject,
  group: Group,
): GroupExport | null {
  const rankings = groupRanking(snapshot, subject.id, group.id);
  if (!rankings.length) return null;

  const sessions = snapshot.sessions.filter(
    (session) =>
      !session.deletedAt && session.subjectId === subject.id && session.groupId === group.id,
  );

  const columns: ActivityColumn[] = subjectActivities(snapshot, subject.id)
    .map((activity) => {
      const activitySessions = sessions
        .filter((session) => session.activityId === activity.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!activitySessions.length) return null;
      return {
        activity,
        sessions: activitySessions,
        max: activityMaxScore(subject, activity),
        attendanceOnly: !isGradedType(activity.type),
        width: activityWidth(activity),
      };
    })
    .filter((column): column is ActivityColumn => Boolean(column));

  if (!columns.length) return null;

  const colCount = 3 + columns.reduce((sum, column) => sum + (column.attendanceOnly ? 1 : 2), 0) + 3;
  const lastCol = colCount - 1;

  const rows: XlsxRow[] = [];
  rows.push({
    height: 26,
    cells: [
      { value: `${subject.name} · ${group.name}`, style: S.title },
      ...Array.from({ length: colCount - 1 }, () => null),
    ],
  });

  const period = columns
    .flatMap((column) => column.sessions.map((session) => session.date))
    .sort();
  const subtitle = [
    `${rankings.length} студентов`,
    `${columns.length} занятий`,
    period.length ? `${shortDate(period[0])} — ${shortDate(period[period.length - 1])}` : null,
    `шкала ${subject.scaleMax}`,
    `порог ${subject.passThreshold}%`,
  ]
    .filter(Boolean)
    .join(' · ');
  rows.push({
    height: 18,
    cells: [
      { value: subtitle, style: S.subtitle },
      ...Array.from({ length: colCount - 1 }, () => null),
    ],
  });
  rows.push({ height: 8, cells: [] });

  // Шапка: занятие → даты → явка/балл.
  const headActivity: (XlsxCell | null)[] = [
    { value: '№', style: S.metaHead },
    { value: 'Студент', style: S.metaHead },
    { value: 'Подгруппа', style: S.metaHead },
  ];
  const headDates: (XlsxCell | null)[] = [null, null, null];
  const headSub: (XlsxCell | null)[] = [null, null, null];

  for (const column of columns) {
    const dates = [...new Set(column.sessions.map((session) => shortDate(session.date)))].join(' / ');
    headActivity.push({
      value: column.activity.title,
      style: { ...S.metaHead, fill: TYPE_FILL[column.activity.type] },
    });
    headDates.push({ value: dates, style: S.dateHead });
    headSub.push({ value: 'Явка', style: S.subHead });
    if (!column.attendanceOnly) {
      headActivity.push(null);
      headDates.push(null);
      headSub.push({ value: 'Балл', style: S.subHead });
    }
  }

  headActivity.push(
    { value: 'Итог', style: S.metaHead },
    { value: 'Оценка', style: S.metaHead },
    { value: 'Посещ.', style: S.metaHead },
  );
  headDates.push(null, null, null);
  headSub.push(null, null, null);

  const merges: string[] = [
    `A1:${colName(lastCol)}1`,
    `A2:${colName(lastCol)}2`,
    'A4:A6',
    'B4:B6',
    'C4:C6',
  ];
  let col = 3;
  for (const column of columns) {
    const span = column.attendanceOnly ? 1 : 2;
    if (span === 2) {
      const from = colName(col);
      const to = colName(col + 1);
      merges.push(`${from}4:${to}4`, `${from}5:${to}5`);
    }
    col += span;
  }
  merges.push(
    `${colName(col)}4:${colName(col)}6`,
    `${colName(col + 1)}4:${colName(col + 1)}6`,
    `${colName(col + 2)}4:${colName(col + 2)}6`,
  );

  rows.push({ height: 30, cells: headActivity });
  rows.push({ height: 20, cells: headDates });
  rows.push({ height: 20, cells: headSub });

  let attendanceSum = 0;
  let attendanceCount = 0;
  let gradeSum = 0;
  let gradeCount = 0;
  let passed = 0;

  rankings.forEach((ranking, index) => {
    const enrollment = snapshot.enrollments.find(
      (e) =>
        !e.deletedAt &&
        e.subjectId === subject.id &&
        e.studentId === ranking.student.id &&
        e.groupId === group.id,
    );
    const subgroup = snapshot.subgroups.find((s) => s.id === enrollment?.subgroupId);
    const progress = ranking.progress;
    const cells: (XlsxCell | null)[] = [
      { value: index + 1, style: S.num },
      { value: ranking.student.name, style: S.name },
      { value: subgroup?.name ?? '—', style: S.subgroup },
    ];

    for (const column of columns) {
      const session = sessionFor(column.sessions, enrollment);
      const attendance = session ? attendanceOf(snapshot, session.id, ranking.student.id) : undefined;
      const value = attendance ? (attendance.present ? 'был' : 'нет') : '—';
      cells.push({
        value,
        style: attendance ? (attendance.present ? S.present : S.absent) : S.blank,
      });
      if (!column.attendanceOnly) {
        const grade = session ? gradeOf(snapshot, session.id, ranking.student.id) : undefined;
        const score = grade?.score ?? null;
        const band = scoreBand(score, column.max);
        const style = score != null
          ? {
              size: 10,
              color: band ? FILLS[band.tone].color : INK,
              fill: band ? FILLS[band.tone].fill : undefined,
              border: 'thin',
              align: 'center',
            }
          : S.blank;
        cells.push({
          value: score == null ? '—' : Number.isInteger(score) ? score : Math.round(score * 10) / 10,
          style: style as XlsxStyle,
        });
      }
    }

    const band = gradeBand(progress.finalPercent);
    cells.push(
      {
        value: progress.finalPercent == null ? '—' : Math.round(progress.finalPercent),
        style: progress.finalPercent == null ? S.percentMuted : S.percent,
      },
      {
        value: band ? String(band.grade) : '—',
        style: band
          ? ({ ...S.grade, fill: FILLS[band.tone].fill, color: FILLS[band.tone].color } as XlsxStyle)
          : S.blank,
      },
      {
        value:
          progress.attendanceSessions > 0
            ? Math.round((progress.present / progress.attendanceSessions) * 100)
            : '—',
        style: progress.attendanceSessions > 0 ? S.percent : S.percentMuted,
      },
    );

    rows.push({ height: 21, cells });

    if (progress.finalPercent != null) {
      gradeSum += progress.finalPercent;
      gradeCount += 1;
      if (progress.passed) passed += 1;
    }
    attendanceSum += progress.present;
    attendanceCount += progress.attendanceSessions;
  });

  const average = gradeCount ? gradeSum / gradeCount : null;
  const success = gradeCount ? (passed / gradeCount) * 100 : null;
  const attendance = attendanceCount ? (attendanceSum / attendanceCount) * 100 : null;

  const averageRow: (XlsxCell | null)[] = [
    null,
    { value: 'Средний по группе', style: S.averageLabel },
    null,
    ...Array.from({ length: colCount - 6 }, () => null),
    {
      value: average == null ? '—' : Math.round(average),
      style: S.averageValue,
    },
    {
      value: gradeBand(average)?.grade ?? '—',
      style: S.averageValue,
    },
    {
      value: attendance == null ? '—' : Math.round(attendance),
      style: S.averageValue,
    },
  ];
  rows.push({ height: 22, cells: averageRow });

  rows.push({
    height: 30,
    cells: [
      {
        value: 'Явка: был / нет / —. Балл окрашен по шкале 2–5: 0–50 — 2, 51–70 — 3, 71–85 — 4, 86–100 — 5. Пропуски входят в итог как 0.',
        style: S.note,
      },
      ...Array.from({ length: colCount - 1 }, () => null),
    ],
  });

  const name = `${subject.name} ${group.name}`;
  return {
    subject,
    group,
    sheet: {
      name,
      columns: [4, 30, 12, ...columns.flatMap((column) => (column.attendanceOnly ? [column.width] : [8.5, 9])), 8, 8.5, 9],
      rows,
      merges,
      freeze: { rows: 6, cols: 3 },
      showGridLines: false,
    },
    students: rankings.length,
    activities: columns.length,
    average,
    success,
    attendance,
  };
}

function buildSummarySheet(entries: GroupExport[], exportedAt: Date): XlsxSheet {
  const rows: XlsxRow[] = [
    {
      height: 28,
      cells: [
        { value: 'Журнал преподавателя', style: S.title },
        ...Array.from({ length: 6 }, () => null),
      ],
    },
    {
      height: 18,
      cells: [
        {
          value: `Выгружено ${formatDate(toLocalIso(exportedAt))} · web-gradebook`,
          style: S.subtitle,
        },
        ...Array.from({ length: 6 }, () => null),
      ],
    },
    { height: 8, cells: [] },
    {
      height: 32,
      cells: ['Предмет', 'Группа', 'Студентов', 'Занятий', 'Средний', 'Успеваемость', 'Посещаемость'].map(
        (value) => ({ value, style: S.summaryHead }),
      ),
    },
  ];

  entries.forEach((entry) => {
    rows.push({
      height: 21,
      cells: [
        { value: entry.subject.name, style: S.summaryText },
        { value: entry.group.name, style: S.summaryText },
        { value: entry.students, style: S.summaryNum },
        { value: entry.activities, style: S.summaryNum },
        {
          value: entry.average == null ? '—' : Math.round(entry.average),
          style: entry.average == null ? S.summaryNum : S.summaryPercent,
        },
        {
          value: entry.success == null ? '—' : Math.round(entry.success),
          style: entry.success == null ? S.summaryNum : S.summaryPercent,
        },
        {
          value: entry.attendance == null ? '—' : Math.round(entry.attendance),
          style: entry.attendance == null ? S.summaryNum : S.summaryPercent,
        },
      ],
    });
  });

  rows.push({ height: 8, cells: [] });
  rows.push({
    height: 30,
    cells: [
      {
        value:
          'Средний — итоговый взвешенный процент без лекций. Успеваемость — доля студентов не ниже порога предмета. Посещаемость — по всем отмеченным сессиям.',
        style: S.note,
      },
      ...Array.from({ length: 6 }, () => null),
    ],
  });

  return {
    name: 'Сводка',
    columns: [38, 16, 11, 11, 12, 14, 14],
    rows,
    merges: ['A1:G1', 'A2:G2', `A${rows.length}:G${rows.length}`],
    freeze: { rows: 4, cols: 0 },
    showGridLines: false,
  };
}

function colName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Собрать листы журнала. Фильтры нужны для экспорта одного предмета/группы. */
export function buildJournalSheets(
  snapshot: Snapshot,
  filter?: { subjectId?: string; groupId?: string },
): { sheets: XlsxSheet[]; entries: GroupExport[] } {
  const subjects = snapshot.subjects
    .filter((subject) => !subject.deletedAt && (!filter?.subjectId || subject.id === filter.subjectId))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const entries: GroupExport[] = [];
  for (const subject of subjects) {
    const groups = collectSubjectGroups(snapshot, subject.id)
      .filter((group) => !filter?.groupId || group.id === filter.groupId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    for (const group of groups) {
      const entry = buildGroupSheet(snapshot, subject, group);
      if (entry) entries.push(entry);
    }
  }

  const sheets: XlsxSheet[] = [buildSummarySheet(entries, new Date())];
  sheets.push(...entries.map((entry) => entry.sheet));
  return { sheets, entries };
}

/** Полный журнал: все предметы и группы. */
export function downloadJournalXlsx(snapshot: Snapshot): { groups: number; students: number } {
  const { sheets, entries } = buildJournalSheets(snapshot);
  if (!entries.length) throw new Error('Нет данных для экспорта');
  downloadXlsx(sheets, `web-gradebook-${fileStamp()}.xlsx`);
  return {
    groups: entries.length,
    students: entries.reduce((sum, entry) => sum + entry.students, 0),
  };
}

/** Журнал одного предмета; `groupId` — только выбранная группа. */
export function downloadSubjectXlsx(
  snapshot: Snapshot,
  subjectId: string,
  groupId?: string,
): { groups: number; students: number } {
  const { sheets, entries } = buildJournalSheets(snapshot, { subjectId, groupId });
  if (!entries.length) throw new Error('Нет данных для экспорта');
  const subject = entries[0].subject;
  downloadXlsx(sheets, `web-gradebook-${slug(subject.name) || 'predmet'}-${fileStamp()}.xlsx`);
  return {
    groups: entries.length,
    students: entries.reduce((sum, entry) => sum + entry.students, 0),
  };
}

/** Короткая подпись для кнопок и тостов. */
export function excelSummaryLabel(result: { groups: number; students: number }): string {
  const groups = result.groups === 1 ? 'группа' : result.groups < 5 ? 'группы' : 'групп';
  return `Excel: ${result.groups} ${groups}, ${result.students} студентов`;
}

export type { GroupExport };
