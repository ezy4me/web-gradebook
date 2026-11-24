import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Activity, ActivitySession, ActivityType, Student, Subject } from '../db/types';
import { setAttendance, setGrade } from '../db/repo';
import {
  activityMaxScore,
  attendanceOf,
  formatPercent,
  gradeOf,
  groupRanking,
  isGradedType,
  subjectActivities,
  type Snapshot,
  type StudentProgress,
} from '../domain/grading';
import { formatDateShort } from '../lib/date';
import { GRADE_CLASSES, gradeBand, scoreBand } from '../lib/grades';
import { subgroupTone } from '../lib/subgroup';
import { countLabel } from '../lib/text';
import { Icon } from '../components/icons';
import { EmptyState } from '../components/ui';

const TYPE_LABEL: Record<ActivityType, { one: string; many: string }> = {
  lecture: { one: 'Лекция', many: 'Лекции' },
  practice: { one: 'Практика', many: 'Практики' },
  lab: { one: 'Лабораторная', many: 'Лабораторные' },
};

interface SessionColumn {
  session: ActivitySession;
  subgroupName: string | null;
  subgroupIndex: number | null;
  max: number;
  attendanceOnly: boolean;
}

interface ActivityColumn {
  activity: Activity;
  sessions: SessionColumn[];
}

interface TypeTable {
  type: ActivityType;
  activities: ActivityColumn[];
}

interface StudentRow {
  student: Student;
  progress: StudentProgress;
  subgroupId: string | null;
  subgroupName: string | null;
  subgroupIndex: number | null;
}

export function JournalTable({
  snapshot,
  subject,
  groupId,
}: {
  snapshot: Snapshot;
  subject: Subject;
  groupId: string;
}) {
  const navigate = useNavigate();
  const [type, setType] = useState<ActivityType>('lab');

  const students = useMemo<StudentRow[]>(() => {
    if (!groupId) return [];
    return groupRanking(snapshot, subject.id, groupId)
      .map((row) => {
        const enrollment = snapshot.enrollments.find(
          (e) =>
            !e.deletedAt &&
            e.subjectId === subject.id &&
            e.studentId === row.student.id &&
            e.groupId === groupId,
        );
        const subgroup = snapshot.subgroups.find((s) => s.id === enrollment?.subgroupId);
        return {
          student: row.student,
          progress: row.progress,
          subgroupId: subgroup?.id ?? null,
          subgroupName: subgroup?.name ?? null,
          subgroupIndex: subgroup?.index ?? null,
        };
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name, 'ru'));
  }, [snapshot, subject.id, groupId]);

  const tables = useMemo<TypeTable[]>(() => {
    if (!groupId) return [];
    const activities = subjectActivities(snapshot, subject.id);
    const sessions = snapshot.sessions.filter(
      (session) => !session.deletedAt && session.subjectId === subject.id && session.groupId === groupId,
    );
    const order: ActivityType[] = ['lab', 'practice', 'lecture'];
    return order
      .map((activityType) => {
        const columns: ActivityColumn[] = activities
          .filter((activity) => activity.type === activityType)
          .map((activity) => {
            const activitySessions = sessions
              .filter((session) => session.activityId === activity.id)
              .map((session): SessionColumn => {
                const subgroup = snapshot.subgroups.find((s) => s.id === session.subgroupId);
                return {
                  session,
                  subgroupName: subgroup?.name ?? null,
                  subgroupIndex: subgroup?.index ?? null,
                  max: activityMaxScore(subject, activity),
                  attendanceOnly: !isGradedType(activity.type),
                };
              })
              .sort((a, b) => {
                const left = a.subgroupIndex ?? 0;
                const right = b.subgroupIndex ?? 0;
                if (left !== right) return left - right;
                return a.session.date.localeCompare(b.session.date);
              });
            return activitySessions.length ? { activity, sessions: activitySessions } : null;
          })
          .filter((column): column is ActivityColumn => Boolean(column))
          .sort((a, b) => a.activity.order - b.activity.order);
        return columns.length ? { type: activityType, activities: columns } : null;
      })
      .filter((table): table is TypeTable => Boolean(table));
  }, [snapshot, subject.id, groupId]);

  useEffect(() => {
    if (tables.length && !tables.some((table) => table.type === type)) {
      setType(tables[0].type);
    }
  }, [tables, type]);

  if (!groupId) {
    return (
      <EmptyState
        icon="users"
        title="Сначала выберите группу"
        description="Добавьте группу в предмет, чтобы увидеть таблицу журнала."
      />
    );
  }

  if (!students.length || !tables.length) {
    return (
      <EmptyState
        icon="grid"
        title="Таблица пока пуста"
        description="Нужны студенты группы и хотя бы одно занятие. Добавьте занятие — таблицы по видам появятся здесь."
      />
    );
  }

  const current = tables.find((table) => table.type === type) ?? tables[0];
  const subgroups = [...new Map(
    students
      .filter((row) => row.subgroupIndex != null)
      .map((row) => [row.subgroupIndex, { name: row.subgroupName, index: row.subgroupIndex }]),
  ).values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const typeFinal = (row: StudentRow): number | null => {
    if (current.type === 'lecture') {
      return row.progress.lectureSessions
        ? (row.progress.lecturePresent / row.progress.lectureSessions) * 100
        : null;
    }
    return row.progress.byType[current.type].finalPercent;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-faint">
        {subgroups.map((subgroup) => {
          const tone = subgroupTone(subgroup.index);
          return (
            <span key={subgroup.index} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
              {subgroup.name}
            </span>
          );
        })}
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Icon name="check" size={12} className="text-moss" />
          явка
        </span>
      </div>

      <div role="tablist" aria-label="Вид занятий" className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
        {tables.map((table) => {
          const active = table.type === current.type;
          return (
            <button
              key={table.type}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setType(table.type)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors focus-ring ${
                active
                  ? 'border-ink bg-ink text-surface'
                  : 'border-line bg-surface text-dim hover:border-line-strong'
              }`}
            >
              {TYPE_LABEL[table.type].many}
              <span className={`tnum ml-1.5 text-[10px] ${active ? 'text-surface/70' : 'text-faint'}`}>
                {table.activities.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] text-faint">
        <span className="hidden sm:inline">Явка — сверху, балл — снизу</span>
        <span className="sm:hidden">Прокрутите вбок →</span>
        <span>
          {countLabel(
            current.activities.reduce((sum, activity) => sum + activity.sessions.length, 0),
            'сессия',
            'сессии',
            'сессий',
          )}
        </span>
      </div>

      <div className="mt-1.5 max-h-[calc(100dvh-370px)] overflow-auto rounded-card border border-line bg-surface lg:max-h-[calc(100dvh-350px)]">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 top-0 z-30 min-w-[146px] border-b border-r border-line bg-elevated px-3 py-2 text-center font-medium text-dim lg:min-w-[190px]"
              >
                Студент
              </th>
              {current.activities.map((activity, activityIndex) => (
                <th
                  key={activity.activity.id}
                  colSpan={activity.sessions.length}
                  title={activity.activity.title}
                  className={`sticky top-0 z-20 h-9 border-b border-line bg-elevated px-2 py-1 text-center text-[11px] font-medium text-ink ${
                    activityIndex === current.activities.length - 1 ? 'border-r' : ''
                  }`}
                >
                  <span className="block truncate">{activity.activity.title}</span>
                </th>
              ))}
              <th
                rowSpan={2}
                className="sticky top-0 z-20 min-w-[64px] border-b border-line bg-elevated px-2 py-2 text-center font-medium text-dim"
              >
                Итог
              </th>
            </tr>
            <tr>
              {current.activities.flatMap((activity) =>
                activity.sessions.map((column, sessionIndex) => {
                  const tone = subgroupTone(column.subgroupIndex);
                  const lastInActivity = sessionIndex === activity.sessions.length - 1;
                  return (
                    <th
                      key={column.session.id}
                      title={`${TYPE_LABEL[current.type].one} · ${column.subgroupName ?? 'вся группа'}`}
                      className={`sticky top-9 z-20 min-w-[64px] border-b border-line px-1 py-1.5 text-center align-middle font-normal ${
                        column.subgroupName ? tone.cell : 'bg-elevated'
                      } ${lastInActivity ? 'border-r' : ''}`}
                    >
                      <span className="tnum block text-[11.5px] font-medium text-ink">
                        {formatDateShort(column.session.date)}
                      </span>
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>
          <tbody>
            {students.map((row, index) => {
              const tone = subgroupTone(row.subgroupIndex);
              const percent = typeFinal(row);
              const band = gradeBand(percent);
              const bandTone = band ? GRADE_CLASSES[band.tone] : null;
              return (
                <tr key={row.student.id}>
                  <th
                    scope="row"
                    title={row.subgroupName ?? 'вся группа'}
                    className={`sticky left-0 z-10 h-14 border-b border-r border-line px-2 text-left font-normal ${
                      row.subgroupIndex ? tone.cell : 'bg-surface'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="tnum w-4 shrink-0 text-center text-[10px] text-faint">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                        className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink focus-ring"
                      >
                        {row.student.name}
                      </button>
                    </span>
                  </th>

                  {current.activities.flatMap((activity) =>
                    activity.sessions.map((column, sessionIndex) => {
                      const applies =
                        column.session.subgroupId == null ||
                        (row.subgroupId != null && row.subgroupId === column.session.subgroupId);
                      const lastInActivity = sessionIndex === activity.sessions.length - 1;
                      return (
                        <td
                          key={column.session.id}
                          className={`h-14 border-b border-line p-0 ${
                            applies
                              ? row.subgroupIndex
                                ? tone.cell
                                : 'bg-surface'
                              : 'bg-elevated/30'
                          } ${lastInActivity ? 'border-r' : ''}`}
                        >
                          {applies ? (
                            <Cell
                              snapshot={snapshot}
                              subject={subject}
                              column={column}
                              student={row.student}
                            />
                          ) : (
                            <span className="block h-14" />
                          )}
                        </td>
                      );
                    }),
                  )}

                  <td className="h-10 border-b border-line px-1 py-0 text-center">
                    <span className="inline-flex items-baseline justify-center gap-1">
                      <span
                        className={`tnum text-[12px] font-semibold ${
                          bandTone ? bandTone.text : 'text-faint'
                        }`}
                      >
                        {current.type === 'lecture'
                          ? row.progress.lectureSessions
                            ? `${row.progress.lecturePresent}/${row.progress.lectureSessions}`
                            : '—'
                          : formatPercent(percent)}
                      </span>
                      {band && current.type !== 'lecture' ? (
                        <span className={`tnum text-[9px] font-semibold ${bandTone?.text}`}>
                          {band.grade}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky bottom-0 left-0 z-30 border-r border-t border-line bg-elevated px-3 py-2 text-left text-[11px] font-medium text-dim">
                Итого
              </th>
              {current.activities.flatMap((activity) =>
                activity.sessions.map((column, sessionIndex) => {
                  const lastInActivity = sessionIndex === activity.sessions.length - 1;
                  const total = students.filter(
                    (row) =>
                      column.session.subgroupId == null ||
                      (row.subgroupId != null && row.subgroupId === column.session.subgroupId),
                  ).length;
                  const present = students.filter(
                    (row) =>
                      (column.session.subgroupId == null ||
                        (row.subgroupId != null && row.subgroupId === column.session.subgroupId)) &&
                      attendanceOf(snapshot, column.session.id, row.student.id)?.present === true,
                  ).length;
                  const scores = students
                    .filter(
                      (row) =>
                        column.session.subgroupId == null ||
                        (row.subgroupId != null && row.subgroupId === column.session.subgroupId),
                    )
                    .map((row) => gradeOf(snapshot, column.session.id, row.student.id)?.score)
                    .filter((score): score is number => score != null);
                  const average = scores.length
                    ? (scores.reduce((sum, score) => sum + score, 0) / scores.length / column.max) * 100
                    : null;
                  return (
                    <td
                      key={column.session.id}
                      className={`sticky bottom-0 z-10 border-t border-line bg-elevated px-1 py-1.5 text-center ${
                        lastInActivity ? 'border-r' : ''
                      }`}
                    >
                      <span className="tnum block text-[10px] text-moss">
                        {present}/{total}
                      </span>
                      {column.attendanceOnly ? null : (
                        <span className="tnum block text-[9.5px] text-faint">
                          {average == null ? '—' : `${Math.round(average)}%`}
                        </span>
                      )}
                    </td>
                  );
                }),
              )}
              <td className="sticky bottom-0 z-10 border-t border-line bg-elevated px-1 py-1.5 text-center">
                <span className="text-[9.5px] text-faint">{students.length} студ.</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Cell({
  snapshot,
  subject,
  column,
  student,
}: {
  snapshot: Snapshot;
  subject: Subject;
  column: SessionColumn;
  student: Student;
}) {
  const grade = gradeOf(snapshot, column.session.id, student.id);
  const attendance = attendanceOf(snapshot, column.session.id, student.id);
  const [value, setValue] = useState(grade?.score != null ? String(grade.score) : '');

  useEffect(() => {
    setValue(grade?.score != null ? String(grade.score) : '');
  }, [grade?.score]);

  const save = async () => {
    if (column.attendanceOnly) return;
    const trimmed = value.trim().replace(',', '.');
    if (trimmed === '') {
      await setGrade({
        subjectId: subject.id,
        activityId: column.session.activityId,
        sessionId: column.session.id,
        studentId: student.id,
        score: null,
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const score = Math.max(0, Math.min(column.max, parsed));
    if (score !== parsed) setValue(String(score));
    await setGrade({
      subjectId: subject.id,
      activityId: column.session.activityId,
      sessionId: column.session.id,
      studentId: student.id,
      score,
    });
  };

  const toggleAttendance = async () => {
    const current = attendance?.present;
    const next = current === undefined ? true : current === true ? false : null;
    await setAttendance({
      subjectId: subject.id,
      sessionId: column.session.id,
      studentId: student.id,
      present: next,
    });
  };

  const present = attendance?.present;

  if (column.attendanceOnly) {
    return (
      <button
        type="button"
        onClick={() => void toggleAttendance()}
        aria-label={`Явка: ${student.name}, ${column.session.date}`}
        className="flex h-14 w-full flex-col items-center justify-center gap-1 transition-colors hover:bg-elevated/30 focus-ring"
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full ${
            present === true
              ? 'bg-moss text-surface'
              : present === false
                ? 'bg-danger text-surface'
                : 'border border-dashed border-line-strong text-faint'
          }`}
        >
          <Icon
            name={present === true ? 'check' : present === false ? 'close' : 'clock'}
            size={11}
          />
        </span>
        <span
          className={`text-[9px] font-medium ${
            present === true ? 'text-moss' : present === false ? 'text-danger' : 'text-faint'
          }`}
        >
          {present === true ? 'был' : present === false ? 'не был' : '—'}
        </span>
      </button>
    );
  }

  const band = scoreBand(value.trim() === '' ? null : Number(value.replace(',', '.')), column.max);
  const bandTone = band ? GRADE_CLASSES[band.tone] : null;

  return (
    <div className="flex h-14 w-full flex-col">
      <button
        type="button"
        onClick={() => void toggleAttendance()}
        aria-label={`Посещаемость: ${student.name}, ${column.session.date}`}
        className="flex h-7 w-full items-center justify-center gap-1 transition-colors hover:bg-elevated/30 focus-ring"
      >
        <span
          className={`flex h-4 w-4 items-center justify-center rounded-full ${
            present === true
              ? 'bg-moss text-surface'
              : present === false
                ? 'bg-danger text-surface'
                : 'border border-dashed border-line-strong text-faint'
          }`}
        >
          <Icon
            name={present === true ? 'check' : present === false ? 'close' : 'clock'}
            size={9}
          />
        </span>
        {present === true || present === false ? (
          <span
            className={`text-[8.5px] font-medium ${
              present === true ? 'text-moss' : 'text-danger'
            }`}
          >
            {present === true ? 'был' : 'нет'}
          </span>
        ) : null}
      </button>
      <div className="flex flex-1 items-center justify-center border-t border-line/50">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          placeholder="—"
          aria-label={`Балл: ${student.name}, ${column.session.date}`}
          className={`tnum h-7 w-8 border-0 bg-transparent p-0 text-center text-[12.5px] placeholder:text-faint focus:bg-elevated/70 focus:outline-none ${
            bandTone ? bandTone.text : 'text-ink'
          }`}
        />
        <span
          className={`tnum w-3 shrink-0 text-[9px] font-semibold ${
            bandTone?.text ?? 'text-transparent'
          }`}
        >
          {band?.grade ?? ''}
        </span>
      </div>
    </div>
  );
}
