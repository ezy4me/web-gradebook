import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  FullPageLoader,
  IconButton,
  Input,
  Select,
  Sheet,
  Textarea,
  useToast,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useSnapshot } from '../db/hooks';
import {
  deleteSession,
  markAllPresent,
  markAllScores,
  setAttendance,
  setGrade,
  updateSession,
  updateStudent,
} from '../db/repo';
import {
  activityMaxScore,
  attendanceOf,
  gradeOf,
  sessionRoster,
  type Snapshot,
} from '../domain/grading';
import { formatDateLong, formatDateShort } from '../lib/date';
import { GRADE_CLASSES, gradeScaleHint, scoreBand } from '../lib/grades';
import { subgroupTone, type SubgroupTone } from '../lib/subgroup';
import type { Activity, ActivitySession, Student, Subject, Subgroup } from '../db/types';

interface GroupRow {
  student: Student;
  subgroup: Subgroup | undefined;
  isActive: boolean;
  tone: SubgroupTone;
  otherScore: number | null;
  otherPresent: boolean | null;
  otherSession: ActivitySession | null;
}

interface GroupSection {
  key: string;
  subgroup: Subgroup | undefined;
  isActive: boolean;
  tone: SubgroupTone;
  rows: GroupRow[];
}

export function SessionScreen() {
  const { sessionId } = useParams();
  const snapshot = useSnapshot();
  const session = snapshot?.sessions.find((s) => s.id === sessionId && !s.deletedAt);
  const activity = snapshot?.activities.find((a) => a.id === session?.activityId && !a.deletedAt);
  const subject = snapshot?.subjects.find((s) => s.id === session?.subjectId && !s.deletedAt);

  if (!snapshot) {
    return (
      <Page title="Сессия" back>
        <FullPageLoader />
      </Page>
    );
  }
  if (!session || !activity || !subject) {
    return (
      <Page title="Сессия" back backTo="/">
        <EmptyState icon="alert" title="Сессия не найдена" />
      </Page>
    );
  }

  return (
    <GradingScreen
      key={session.id}
      session={session}
      activity={activity}
      subject={subject}
      snapshot={snapshot}
    />
  );
}

function GradingScreen({
  session,
  activity,
  subject,
  snapshot,
}: {
  session: ActivitySession;
  activity: Activity;
  subject: Subject;
  snapshot: Snapshot;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const isLecture = activity.type === 'lecture';
  const max = activityMaxScore(subject, activity);
  const roster = useMemo(() => sessionRoster(snapshot, session), [snapshot, session]);
  const [scores, setScores] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const student of roster) {
      const grade = gradeOf(snapshot, session.id, student.id);
      initial[student.id] = grade?.score != null ? String(grade.score) : '';
    }
    return initial;
  });
  const [commentStudent, setCommentStudent] = useState<Student | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bulk, setBulk] = useState<'present' | 'max' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
    };
  }, []);

  const persistScore = async (studentId: string, raw: string) => {
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') {
      await setGrade({
        subjectId: subject.id,
        activityId: activity.id,
        sessionId: session.id,
        studentId,
        score: null,
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    let value = parsed;
    if (value > max) {
      value = max;
      setScores((current) => ({ ...current, [studentId]: String(max) }));
      toast(`Больше ${max} поставить нельзя — исправили на ${max}`, 'danger');
    }
    if (value < 0) value = 0;
    await setGrade({
      subjectId: subject.id,
      activityId: activity.id,
      sessionId: session.id,
      studentId,
      score: value,
    });
  };

  const queueSave = (studentId: string, value: string) => {
    setScores((current) => ({ ...current, [studentId]: value }));
    const existing = timers.current.get(studentId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      timers.current.delete(studentId);
      void persistScore(studentId, value);
    }, 600);
    timers.current.set(studentId, timer);
  };

  const flushScore = (studentId: string) => {
    const timer = timers.current.get(studentId);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(studentId);
    }
    void persistScore(studentId, scores[studentId] ?? '');
  };

  const cycleAttendance = async (studentId: string) => {
    const current = attendanceOf(snapshot, session.id, studentId)?.present;
    const next = current === undefined ? true : current === true ? false : null;
    await setAttendance({ subjectId: subject.id, sessionId: session.id, studentId, present: next });
  };

  const markAll = async () => {
    const previous = roster.map((student) => ({
      studentId: student.id,
      present: attendanceOf(snapshot, session.id, student.id)?.present ?? null,
    }));
    await markAllPresent(
      subject.id,
      session.id,
      roster.map((student) => student.id),
    );
    toast(
      isLecture ? `Все отмечены: ${roster.length}` : `Присутствуют все: ${roster.length}`,
      'success',
      {
        label: 'Отменить',
        onClick: async () => {
          for (const item of previous) {
            await setAttendance({
              subjectId: subject.id,
              sessionId: session.id,
              studentId: item.studentId,
              present: item.present,
            });
          }
        },
      },
    );
  };

  // Вся группа с разметкой по подгруппам: активная подгруппа редактируется,
  // остальные показываются для контекста и не меняются в этой сессии.
  const groupSections = useMemo<GroupSection[]>(() => {
    const isLab = activity.type === 'lab';
    const groupHasSubgroups = snapshot.subgroups.some(
      (subgroup) =>
        !subgroup.deletedAt &&
        subgroup.subjectId === subject.id &&
        subgroup.groupId === session.groupId,
    );
    const sessionSubgroup = snapshot.subgroups.find((s) => s.id === session.subgroupId);
    const enrollments = snapshot.enrollments
      .filter((e) => !e.deletedAt && e.subjectId === subject.id && e.groupId === session.groupId)
      .map((enrollment): GroupRow | null => {
        const student = snapshot.students.find((s) => s.id === enrollment.studentId && !s.deletedAt);
        const subgroup = snapshot.subgroups.find((s) => s.id === enrollment.subgroupId && !s.deletedAt);
        if (!student) return null;
        const otherSession = subgroup
          ? snapshot.sessions.find(
              (s) =>
                !s.deletedAt &&
                s.activityId === activity.id &&
                s.groupId === session.groupId &&
                s.subgroupId === subgroup.id &&
                s.id !== session.id,
            )
          : undefined;
        const otherGrade = otherSession
          ? snapshot.grades.find(
              (g) => g.sessionId === otherSession.id && g.studentId === student.id && !g.deletedAt,
            )
          : undefined;
        const otherAttendance = otherSession
          ? snapshot.attendance.find(
              (a) => a.sessionId === otherSession.id && a.studentId === student.id && !a.deletedAt,
            )
          : undefined;
        const active = isLab && groupHasSubgroups
          ? subgroup == null || (subgroup.id === (session.subgroupId ?? null))
          : true;
        const displaySubgroup = isLab ? (subgroup ?? sessionSubgroup) : undefined;
        return {
          student,
          subgroup: displaySubgroup,
          isActive: active,
          tone: isLab ? subgroupTone(displaySubgroup?.index) : subgroupTone(1),
          otherScore: otherGrade?.score ?? null,
          otherPresent: otherAttendance ? otherAttendance.present : null,
          otherSession: otherSession ?? null,
        };
      })
      .filter((row): row is GroupRow => Boolean(row));

    const sections = new Map<string, GroupSection>();
    for (const row of enrollments) {
      const key = isLab ? (row.subgroup?.id ?? 'all') : 'all';
      const section: GroupSection =
        sections.get(key) ??
        ({
          key,
          subgroup: row.subgroup,
          isActive: row.isActive,
          tone: row.tone,
          rows: [],
        } satisfies GroupSection);
      section.rows.push(row);
      sections.set(key, section);
    }
    return [...sections.values()]
      .sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (b.isActive && !a.isActive) return 1;
        return (a.subgroup?.index ?? 0) - (b.subgroup?.index ?? 0);
      })
      .map((section) => ({
        ...section,
        rows: [...section.rows].sort((a, b) => a.student.name.localeCompare(b.student.name, 'ru')),
      }));
  }, [snapshot, subject.id, session, activity.id, activity.type]);

  const graded = roster.filter((student) => {
    const grade = gradeOf(snapshot, session.id, student.id);
    return grade?.score != null;
  }).length;
  const present = roster.filter(
    (student) => attendanceOf(snapshot, session.id, student.id)?.present === true,
  ).length;

  const activeSubgroup = snapshot.subgroups.find((s) => s.id === session.subgroupId);
  const groupName = snapshot.groups.find((g) => g.id === session.groupId)?.name ?? '';
  const activeTone = subgroupTone(activeSubgroup?.index);

  return (
    <Page
      title={activity.title}
      subtitle={`${formatDateLong(session.date)}${groupName ? ` · ${groupName}` : ''}`}
      back
      backTo={`/activity/${activity.id}`}
      actions={
        <>
          {!isLecture ? (
            <IconButton icon="more" label="Действия" onClick={() => setMenuOpen(true)} />
          ) : null}
          <IconButton icon="settings" label="Настройки сессии" onClick={() => setSettingsOpen(true)} />
        </>
      }
    >
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${session.subgroupId ? activeTone.dot : 'bg-steel'}`} />
          <span className="text-[13px] font-medium text-ink">
            {activeSubgroup ? activeSubgroup.name : 'Вся группа'}
          </span>
          {session.subgroupId && snapshot.subgroups.length > 1 && activeSubgroup ? (
            <span className="tnum text-[11.5px] text-faint">
              {activeSubgroup.index} из{' '}
              {snapshot.subgroups.filter((s) => s.groupId === session.groupId && !s.deletedAt).length}
            </span>
          ) : null}
        </div>
        <span className="tnum text-[12px] text-dim">
          {isLecture ? 'только явка' : `максимум ${max}`}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 py-2 text-[12px] text-dim">
        <span className="tnum">
          было {present} из {roster.length}
          {isLecture ? '' : ` · оценено ${graded}`}
        </span>
        <button
          type="button"
          onClick={() => void markAll()}
          className="shrink-0 text-[12.5px] font-medium text-clay underline-offset-2 hover:underline focus-ring"
        >
          Отметить всех
        </button>
      </div>

      {roster.length === 0 ? (
        <EmptyState
          icon="users"
          title="В сессии нет студентов"
          description="Проверьте подгруппу сессии или зачислите студентов в группу."
          action={<Button onClick={() => navigate(`/subject/${subject.id}`)}>Открыть предмет</Button>}
        />
      ) : (
        <div className="mt-2 space-y-6">
          {groupSections.map((section) => {
            const active = section.isActive;
            return (
              <section key={section.key}>
                {active ? null : (
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${section.tone.dot}`} />
                      <h2 className="text-[13px] font-medium text-ink">
                        {section.subgroup ? section.subgroup.name : 'Вся группа'}
                      </h2>
                      <span className="tnum text-[11.5px] text-faint">{section.rows.length}</span>
                    </div>
                    {section.rows[0]?.otherSession ? (
                      <span className="text-[11px] text-faint">
                        другая подгруппа · {formatDateShort(section.rows[0].otherSession.date)}
                      </span>
                    ) : null}
                  </div>
                )}

                <div
                  className={`overflow-hidden rounded-card border bg-surface ${
                    active ? 'border-line' : 'border-line/70'
                  }`}
                >
                  {section.rows.map((row, index) => {
                    const attendance = active
                      ? attendanceOf(snapshot, session.id, row.student.id)?.present
                      : null;
                    const grade = active ? gradeOf(snapshot, session.id, row.student.id) : null;
                    const hasComment = Boolean(grade?.comment?.trim()) || Boolean(row.student.comment.trim());
                    const rawScore = active ? (scores[row.student.id] ?? '') : '';
                    const invalid = active && rawScore !== '' && Number(rawScore.replace(',', '.')) > max;
                    const numericScore =
                      rawScore.trim() === '' ? null : Number(rawScore.replace(',', '.'));
                    const band = scoreBand(
                      numericScore != null && Number.isFinite(numericScore) ? numericScore : null,
                      max,
                    );
                    const passes =
                      numericScore != null &&
                      Number.isFinite(numericScore) &&
                      (numericScore / max) * 100 >= subject.passThreshold;
                    const toneClasses = band ? GRADE_CLASSES[band.tone] : null;
                    const passFailTone =
                      subject.scaleKind === 'pass-fail'
                        ? passes
                          ? GRADE_CLASSES.grade5
                          : GRADE_CLASSES.grade2
                        : null;
                    const scoreTone = passFailTone ?? toneClasses;
                    const otherBand = !active ? scoreBand(row.otherScore, max) : null;
                    const otherTone = otherBand ? GRADE_CLASSES[otherBand.tone] : null;
                    const otherPasses =
                      row.otherScore != null && (row.otherScore / max) * 100 >= subject.passThreshold;

                    return (
                      <div
                        key={row.student.id}
                        className={`flex items-center gap-2 px-2.5 py-2 ${
                          index > 0 ? 'border-t border-line/70' : ''
                        } ${active ? '' : 'opacity-70'}`}
                      >
                        <span className="tnum w-5 shrink-0 text-right text-[11.5px] text-faint">
                          {index + 1}
                        </span>
                        {active ? (
                          <button
                            type="button"
                            onClick={() => void cycleAttendance(row.student.id)}
                            aria-label={`Посещаемость: ${row.student.name}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-ring"
                          >
                            <span
                              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                                attendance === true
                                  ? 'border-moss bg-moss-soft text-moss'
                                  : attendance === false
                                    ? 'border-clay/40 bg-clay-soft text-clay'
                                    : 'border-line-strong text-faint'
                              }`}
                            >
                              <Icon
                                name={attendance === true ? 'check' : attendance === false ? 'close' : 'clock'}
                                size={13}
                              />
                            </span>
                          </button>
                        ) : (
                          <span
                            aria-label={
                              row.otherPresent === true
                                ? `${row.student.name}: был`
                                : row.otherPresent === false
                                  ? `${row.student.name}: не был`
                                  : `${row.student.name}: не отмечен`
                            }
                            className={`flex h-11 w-11 shrink-0 items-center justify-center ${
                              row.otherPresent === true
                                ? 'text-moss'
                                : row.otherPresent === false
                                  ? 'text-clay'
                                  : 'text-faint'
                            }`}
                          >
                            <Icon
                              name={
                                row.otherPresent === true
                                  ? 'check'
                                  : row.otherPresent === false
                                    ? 'close'
                                    : 'clock'
                              }
                              size={14}
                            />
                          </span>
                        )}

                        <button
                          type="button"
                          disabled={!active}
                          onClick={() => active && setCommentStudent(row.student)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-ring disabled:cursor-default"
                        >
                          <span className="min-w-0 truncate text-[14.5px] text-ink">{row.student.name}</span>
                          {hasComment ? <Icon name="message" size={13} className="shrink-0 text-clay" /> : null}
                        </button>

                        {isLecture ? null : active ? (
                          <>
                            <input
                              value={rawScore}
                              onChange={(event) => queueSave(row.student.id, event.target.value)}
                              onBlur={() => flushScore(row.student.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                              }}
                              type="text"
                              inputMode="decimal"
                              placeholder="—"
                              aria-label={`Балл: ${row.student.name}`}
                              className={`tnum h-11 w-12 shrink-0 border-0 border-b bg-transparent px-1 text-right text-[17px] placeholder:text-faint focus:bg-transparent focus:outline-none ${
                                invalid
                                  ? 'border-danger text-danger'
                                  : scoreTone
                                    ? `border-current ${scoreTone.text}`
                                    : 'border-line-strong text-ink focus:border-ink'
                              }`}
                            />
                            <span className="flex w-4 shrink-0 justify-center">
                              {numericScore == null || !Number.isFinite(numericScore) ? null : subject.scaleKind ===
                                'pass-fail' ? (
                                <Icon
                                  name={passes ? 'check' : 'close'}
                                  size={14}
                                  className={passes ? 'text-grade5' : 'text-grade2'}
                                />
                              ) : band ? (
                                <span className={`tnum text-[12px] font-semibold ${toneClasses?.text}`}>
                                  {band.grade}
                                </span>
                              ) : null}
                            </span>
                          </>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={`tnum text-[14px] ${
                                subject.scaleKind === 'pass-fail'
                                  ? row.otherScore == null
                                    ? 'text-faint'
                                    : otherPasses
                                      ? 'text-grade5'
                                      : 'text-grade2'
                                  : otherTone
                                    ? otherTone.text
                                    : 'text-faint'
                              }`}
                            >
                              {row.otherScore ?? '—'}
                            </span>
                            {row.otherScore != null && subject.scaleKind !== 'pass-fail' && otherBand ? (
                              <span className={`tnum w-4 text-[12px] font-semibold ${otherTone?.text}`}>
                                {otherBand.grade}
                              </span>
                            ) : row.otherScore != null ? (
                              <Icon
                                name={otherPasses ? 'check' : 'close'}
                                size={13}
                                className={otherPasses ? 'text-grade5' : 'text-grade2'}
                              />
                            ) : null}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[11.5px] leading-relaxed text-faint">
        Отметки сохраняются сами. Нажмите на имя, чтобы {isLecture ? 'оставить заметку о студенте.' : 'добавить комментарий к оценке и заметку о студенте.'}
        {isLecture
          ? ''
          : subject.scaleKind === 'pass-fail'
            ? ` Зачёт от ${subject.passThreshold}%.`
            : ` Оценки: ${gradeScaleHint()}.`}
      </p>

      <SessionSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        session={session}
        snapshot={snapshot}
        onDelete={() => {
          setSettingsOpen(false);
          setConfirmDelete(true);
        }}
      />

      <ConfirmSheet
        open={confirmDelete}
        title="Удалить сессию?"
        description="Оценки и посещаемость этой сессии будут скрыты."
        confirmLabel="Удалить сессию"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSession(session.id);
          toast('Сессия удалена');
          navigate(`/activity/${activity.id}`);
        }}
      />

      <BulkSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPick={(action) => {
          setMenuOpen(false);
          setBulk(action);
        }}
      />

      <ConfirmSheet
        open={bulk !== null}
        title={bulk === 'present' ? 'Отметить всю подгруппу?' : 'Поставить максимум?'}
        description={
          bulk === 'present'
            ? `Все ${roster.length} студентов этой подгруппы будут отмечены присутствующими.`
            : `Всем ${roster.length} студентам будет выставлен балл ${max}.`
        }
        confirmLabel={bulk === 'present' ? 'Отметить всех' : `Поставить ${max}`}
        danger={bulk === 'max'}
        onCancel={() => setBulk(null)}
        onConfirm={async () => {
          if (bulk === 'present') {
            await markAllPresent(subject.id, session.id, roster.map((student) => student.id));
            toast('Отмечены все присутствующие');
          } else if (bulk === 'max') {
            setScores((current) => {
              const next = { ...current };
              for (const student of roster) next[student.id] = String(max);
              return next;
            });
            await markAllScores({
              subjectId: subject.id,
              activityId: activity.id,
              sessionId: session.id,
              studentIds: roster.map((student) => student.id),
              score: max,
            });
            toast(`Проставлен максимум: ${max}`);
          }
          setBulk(null);
        }}
      />

      {commentStudent ? (
        <CommentSheet
          open
          onClose={() => setCommentStudent(null)}
          subject={subject}
          activity={activity}
          session={session}
          student={commentStudent}
          snapshot={snapshot}
          attendanceOnly={isLecture}
          onSaved={() => setCommentStudent(null)}
        />
      ) : null}
    </Page>
  );
}

function BulkSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (action: 'present' | 'max') => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Вся подгруппа"
      description="Эти действия меняют отметки у всех сразу. Понадобится подтверждение."
    >
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        <button
          type="button"
          onClick={() => onPick('present')}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-elevated/50 focus-ring"
        >
          <Icon name="check" size={18} className="text-moss" />
          <span className="flex-1 text-[14.5px] text-ink">Отметить всех присутствующими</span>
        </button>
        <button
          type="button"
          onClick={() => onPick('max')}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-elevated/50 focus-ring"
        >
          <Icon name="alert" size={18} className="text-clay" />
          <span className="flex-1 text-[14.5px] text-ink">Поставить максимальный балл</span>
        </button>
      </div>
    </Sheet>
  );
}

function CommentSheet({
  open,
  onClose,
  subject,
  activity,
  session,
  student,
  snapshot,
  attendanceOnly,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  activity: Activity;
  session: ActivitySession;
  student: Student;
  snapshot: Snapshot;
  attendanceOnly: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const grade = gradeOf(snapshot, session.id, student.id);
  const [gradeComment, setGradeComment] = useState(grade?.comment ?? '');
  const [studentComment, setStudentComment] = useState(student.comment);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={student.name}
      description={`${activity.title} · ${formatDateLong(session.date)}`}
      footer={
        <Button
          full
          size="lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (!attendanceOnly) {
              await setGrade({
                subjectId: subject.id,
                activityId: activity.id,
                sessionId: session.id,
                studentId: student.id,
                score: grade?.score ?? null,
                comment: gradeComment,
              });
            }
            if (studentComment !== student.comment) {
              await updateStudent(student.id, { comment: studentComment });
            }
            setBusy(false);
            toast('Сохранено');
            onSaved();
          }}
        >
          Сохранить
        </Button>
      }
    >
      <div className="space-y-5">
        {!attendanceOnly ? (
          <Field label="Комментарий к оценке" hint="Видно в карточке студента рядом с баллом.">
            <Textarea
              value={gradeComment}
              onChange={(event) => setGradeComment(event.target.value)}
              rows={3}
              placeholder="Например: защитил с доработками"
            />
          </Field>
        ) : null}
        <Field label="Заметка о студенте" hint="Общая заметка по всем предметам.">
          <Textarea
            value={studentComment}
            onChange={(event) => setStudentComment(event.target.value)}
            rows={3}
            placeholder="Например: староста группы"
          />
        </Field>
        {!attendanceOnly && grade?.score != null ? (
          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-[13px] text-dim">Текущий балл</span>
            <span className="tnum text-[15px] font-medium text-ink">
              {grade.score} / {activityMaxScore(subject, activity)}
            </span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function SessionSettingsSheet({
  open,
  onClose,
  session,
  snapshot,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  session: ActivitySession;
  snapshot: Snapshot;
  onDelete: () => void;
}) {
  const toast = useToast();
  const activity = snapshot.activities.find((a) => a.id === session.activityId);
  const isLab = activity?.type === 'lab';
  const subgroups = snapshot.subgroups
    .filter((s) => s.subjectId === session.subjectId && s.groupId === session.groupId && !s.deletedAt)
    .sort((a, b) => a.index - b.index);
  const [date, setDate] = useState(session.date);
  const [subgroupId, setSubgroupId] = useState(session.subgroupId ?? '');
  const [deadline, setDeadline] = useState(session.deadline ?? '');
  const [note, setNote] = useState(session.note);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Сессия"
      description="Дата, подгруппа и дедлайн занятия"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" full onClick={onDelete}>
            Удалить
          </Button>
          <Button
            full
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await updateSession(session.id, {
                date,
                subgroupId: isLab ? subgroupId || null : null,
                deadline: deadline || null,
                note,
              });
              setBusy(false);
              toast('Сессия обновлена');
              onClose();
            }}
          >
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Дата">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {isLab ? (
          <Field label="Подгруппа" hint="Для лабораторных подгруппа обязательна.">
            <Select aria-label="Подгруппа" value={subgroupId} onChange={(event) => setSubgroupId(event.target.value)}>
              {subgroups.map((subgroup) => (
                <option key={subgroup.id} value={subgroup.id}>
                  {subgroup.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Дедлайн сессии" hint="Пусто — дедлайн считается по следующей сессии группы.">
          <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>
        <Field label="Заметка">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Необязательно"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
          <Badge>оценок: {snapshot.grades.filter((g) => g.sessionId === session.id && !g.deletedAt).length}</Badge>
          <Badge>явка: {snapshot.attendance.filter((a) => a.sessionId === session.id && !a.deletedAt).length}</Badge>
        </div>
      </div>
    </Sheet>
  );
}
