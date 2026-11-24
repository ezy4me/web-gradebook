import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Activity, ActivitySession, Student, Subject } from '../db/types';
import { setAttendance, setGrade } from '../db/repo';
import {
  activityMaxScore,
  attendanceOf,
  formatPercent,
  gradeOf,
  groupRanking,
  isGradedType,
  sessionRoster,
  type Snapshot,
  type StudentProgress,
} from '../domain/grading';
import { formatDateShort } from '../lib/date';
import { GRADE_CLASSES, gradeBand, scoreBand } from '../lib/grades';
import { subgroupTone } from '../lib/subgroup';
import { Icon } from '../components/icons';
import { EmptyState } from '../components/ui';

interface Column {
  session: ActivitySession;
  activity: Activity;
  subgroupName: string | null;
  subgroupIndex: number | null;
  attendanceOnly: boolean;
  max: number;
  rosterIds: Set<string>;
}

interface StudentRow {
  student: Student;
  progress: StudentProgress;
  subgroupName: string | null;
  subgroupIndex: number | null;
}

const TYPE_SHORT: Record<Activity['type'], string> = {
  lecture: 'Лек',
  practice: 'Пр',
  lab: 'ЛР',
};

function shortTitle(activity: Activity): string {
  const number = /(\d+)/.exec(activity.title)?.[1];
  return `${TYPE_SHORT[activity.type]}${number ? ` ${number}` : ''}`;
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
          subgroupName: subgroup?.name ?? null,
          subgroupIndex: subgroup?.index ?? null,
        };
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name, 'ru'));
  }, [snapshot, subject.id, groupId]);

  const columns = useMemo<Column[]>(() => {
    if (!groupId) return [];
    return snapshot.sessions
      .filter((session) => !session.deletedAt && session.subjectId === subject.id && session.groupId === groupId)
      .map((session): Column | null => {
        const activity = snapshot.activities.find((a) => a.id === session.activityId && !a.deletedAt);
        if (!activity) return null;
        const subgroup = snapshot.subgroups.find((s) => s.id === session.subgroupId);
        return {
          session,
          activity,
          subgroupName: subgroup?.name ?? null,
          subgroupIndex: subgroup?.index ?? null,
          attendanceOnly: !isGradedType(activity.type),
          max: activityMaxScore(subject, activity),
          rosterIds: new Set(sessionRoster(snapshot, session).map((student) => student.id)),
        };
      })
      .filter((column): column is Column => Boolean(column))
      .sort((a, b) => a.session.date.localeCompare(b.session.date));
  }, [snapshot, subject.id, groupId]);

  if (!groupId) {
    return (
      <EmptyState
        icon="users"
        title="Сначала выберите группу"
        description="Добавьте группу в предмет, чтобы увидеть таблицу журнала."
      />
    );
  }

  if (!students.length || !columns.length) {
    return (
      <EmptyState
        icon="grid"
        title="Таблица пока пуста"
        description="Нужны студенты группы и хотя бы одно занятие. Добавьте занятие — колонки появятся здесь."
      />
    );
  }

  const subgroups = [...new Map(
    students
      .filter((row) => row.subgroupIndex != null)
      .map((row) => [row.subgroupIndex, { name: row.subgroupName, index: row.subgroupIndex }]),
  ).values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-faint">
        {subgroups.map((subgroup) => {
          const tone = subgroupTone(subgroup.index);
          return (
            <span key={subgroup.index} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              {subgroup.name}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5">
          <Icon name="check" size={12} className="text-moss" />
          явка
        </span>
        <span className="hidden sm:inline">Балл вводится прямо в клетке, явка — кружком рядом.</span>
        <span className="sm:hidden">Прокрутите таблицу вбок →</span>
      </div>

      <div className="max-h-[calc(100dvh-300px)] overflow-auto rounded-card border border-line bg-surface lg:max-h-[calc(100dvh-280px)]">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 min-w-[150px] border-b border-r border-line bg-elevated px-3 py-2 text-left font-medium text-dim lg:min-w-[200px]"
              >
                Студент
              </th>
              {columns.map((column) => {
                const tone = subgroupTone(column.subgroupIndex);
                return (
                  <th
                    key={column.session.id}
                    title={`${column.activity.title} · ${column.subgroupName ?? 'вся группа'}`}
                    className={`sticky top-0 z-20 min-w-[64px] border-b border-r border-line px-1.5 py-1.5 text-center align-bottom font-normal ${
                      column.subgroupName ? tone.badge : 'bg-elevated text-dim'
                    }`}
                  >
                    <span className="block truncate text-[10.5px] uppercase tracking-wide opacity-80">
                      {shortTitle(column.activity)}
                    </span>
                    <span className="tnum mt-0.5 block text-[11.5px] font-medium text-ink">
                      {formatDateShort(column.session.date)}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] opacity-75">
                      {column.attendanceOnly ? 'явка' : `макс ${column.max}`}
                    </span>
                  </th>
                );
              })}
              <th className="sticky top-0 z-20 min-w-[56px] border-b border-line bg-elevated px-2 py-2 text-center font-medium text-dim">
                Итог
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((row, index) => {
              const tone = subgroupTone(row.subgroupIndex);
              const progress = row.progress;
              const band = gradeBand(progress.finalPercent);
              const bandTone = band ? GRADE_CLASSES[band.tone] : null;
              return (
                <tr key={row.student.id} className="group">
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-2 text-left font-normal ${
                      row.subgroupIndex ? `border-l-2 ${tone.border}` : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="tnum w-5 shrink-0 text-center text-[10.5px] text-faint">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                        className="min-w-0 flex-1 truncate text-left text-[13px] text-ink focus-ring"
                      >
                        {row.student.name}
                      </button>
                    </span>
                    <span className="mt-0.5 block pl-7 text-[10px] text-faint">
                      {row.subgroupName ?? 'вся группа'}
                    </span>
                  </th>

                  {columns.map((column) => {
                    const applies = column.rosterIds.has(row.student.id);
                    return (
                      <td
                        key={column.session.id}
                        className={`border-b border-r border-line p-0.5 text-center ${
                          applies ? '' : 'bg-elevated/40'
                        }`}
                      >
                        {applies ? (
                          <Cell
                            snapshot={snapshot}
                            subject={subject}
                            column={column}
                            student={row.student}
                          />
                        ) : (
                          <span className="block py-2 text-[11px] text-faint/60">·</span>
                        )}
                      </td>
                    );
                  })}

                  <td className="border-b border-line px-1 py-2 text-center">
                    <span className={`tnum text-[12.5px] font-semibold ${bandTone ? bandTone.text : 'text-faint'}`}>
                      {formatPercent(progress.finalPercent)}
                    </span>
                    {band ? (
                      <span className={`tnum mt-0.5 block text-[10px] ${bandTone?.text}`}>
                        {band.grade}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky bottom-0 left-0 z-30 border-r border-t border-line bg-elevated px-3 py-2 text-left text-[11px] font-medium text-dim">
                Итого по колонке
              </th>
              {columns.map((column) => {
                const total = column.rosterIds.size;
                const present = students.filter(
                  (row) =>
                    column.rosterIds.has(row.student.id) &&
                    attendanceOf(snapshot, column.session.id, row.student.id)?.present === true,
                ).length;
                const scores = students
                  .filter((row) => column.rosterIds.has(row.student.id))
                  .map((row) => gradeOf(snapshot, column.session.id, row.student.id)?.score)
                  .filter((score): score is number => score != null);
                const average = scores.length
                  ? (scores.reduce((sum, score) => sum + score, 0) / scores.length / column.max) * 100
                  : null;
                return (
                  <td key={column.session.id} className="sticky bottom-0 z-10 border-r border-t border-line bg-elevated/95 px-1 py-1.5 text-center">
                    <span className="tnum block text-[10.5px] text-moss">
                      {present}/{total}
                    </span>
                    {column.attendanceOnly ? null : (
                      <span className="tnum block text-[10px] text-faint">
                        {average == null ? '—' : `${Math.round(average)}%`}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="sticky bottom-0 z-10 border-t border-line bg-elevated/95 px-1 py-1.5 text-center">
                <span className="text-[10px] text-faint">
                  {students.length} студ.
                </span>
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
  column: Column;
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
        activityId: column.activity.id,
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
      activityId: column.activity.id,
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

  if (column.attendanceOnly) {
    return (
      <button
        type="button"
        onClick={() => void toggleAttendance()}
        aria-label={`Явка: ${student.name}, ${column.activity.title}`}
        className={`flex h-9 w-full items-center justify-center rounded-md transition-colors focus-ring ${
          attendance?.present === true
            ? 'bg-moss-soft text-moss'
            : attendance?.present === false
              ? 'bg-clay-soft text-clay'
              : 'text-faint hover:bg-elevated'
        }`}
      >
        <Icon
          name={attendance?.present === true ? 'check' : attendance?.present === false ? 'close' : 'clock'}
          size={14}
        />
      </button>
    );
  }

  const band = scoreBand(value.trim() === '' ? null : Number(value.replace(',', '.')), column.max);
  const tone = band ? GRADE_CLASSES[band.tone] : null;

  return (
    <div className="flex h-9 items-center justify-center gap-0.5">
      <button
        type="button"
        onClick={() => void toggleAttendance()}
        aria-label={`Посещаемость: ${student.name}, ${column.activity.title}`}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors focus-ring ${
          attendance?.present === true
            ? 'border-moss bg-moss-soft text-moss'
            : attendance?.present === false
              ? 'border-clay/40 bg-clay-soft text-clay'
              : 'border-line-strong text-faint'
        }`}
      >
        <Icon
          name={attendance?.present === true ? 'check' : attendance?.present === false ? 'close' : 'clock'}
          size={9}
        />
      </button>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        placeholder="—"
        aria-label={`Балл: ${student.name}, ${column.activity.title}`}
        className={`tnum h-7 w-7 rounded border-0 bg-transparent p-0 text-center text-[12px] placeholder:text-faint focus:bg-elevated focus:outline-none ${
          tone ? tone.text : 'text-ink'
        }`}
      />
      <span className={`tnum w-2.5 shrink-0 text-[9px] font-semibold ${tone?.text ?? 'text-transparent'}`}>
        {band?.grade ?? ''}
      </span>
    </div>
  );
}
