import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  Fab,
  Field,
  FullPageLoader,
  IconButton,
  Input,
  SectionTitle,
  Segmented,
  Sheet,
  Switch,
  Textarea,
  useToast,
} from '../components/ui';
import { Icon } from '../components/icons';
import { JournalTable } from '../components/JournalTable';
import { useSnapshot } from '../db/hooks';
import {
  createStudent,
  deleteSubject,
  enrollGroupToSubject,
  enrollStudent,
  ensureSubgroups,
  findOrCreateGroup,
  removeEnrollment,
  setSubjectArchived,
  updateEnrollment,
  updateSubject,
} from '../db/repo';
import {
  activityWeight,
  attendanceOf,
  collectSubjectGroups,
  computeGroupStats,
  formatPercent,
  gradeOf,
  groupRanking,
  groupStudents,
  isGradedType,
  sessionRoster,
  subjectActivities,
  subjectOverview,
  type Snapshot,
} from '../domain/grading';
import { activityDeadline } from '../domain/schedule';
import { deadlineState, formatDateCompact, formatDateShort, relativeDeadline, todayIso } from '../lib/date';
import { countLabel } from '../lib/text';
import { subgroupTone } from '../lib/subgroup';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABEL,
  type Activity,
  type ActivitySession,
  type ActivityType,
  type Subject,
} from '../db/types';
import { ActivityFormSheet } from './ActivityFormSheet';

type Tab = 'journal' | 'table' | 'students' | 'overview';

const TYPE_TONE: Record<ActivityType, string> = {
  lecture: 'bg-steel',
  practice: 'bg-clay',
  lab: 'bg-moss',
};

export function SubjectScreen() {
  const { subjectId } = useParams();
  const [searchParams] = useSearchParams();
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('journal');
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupId, setGroupId] = useState(searchParams.get('group') ?? '');
  const [groupSheet, setGroupSheet] = useState(false);

  const subject = snapshot?.subjects.find((s) => s.id === subjectId && !s.deletedAt);

  const groups = useMemo(() => {
    if (!snapshot || !subject) return [] as { id: string; name: string; students: number }[];
    return collectSubjectGroups(snapshot, subject.id).map((group) => ({
      id: group.id,
      name: group.name,
      students: snapshot.enrollments.filter(
        (e) => !e.deletedAt && e.subjectId === subject.id && e.groupId === group.id,
      ).length,
    }));
  }, [snapshot, subject]);

  useEffect(() => {
    if (!groups.length) {
      setGroupId('');
      return;
    }
    if (!groups.some((group) => group.id === groupId)) setGroupId(groups[0].id);
  }, [groups, groupId]);

  if (!snapshot) {
    return (
      <Page title="Предмет" back>
        <FullPageLoader />
      </Page>
    );
  }

  if (!subject) {
    return (
      <Page title="Предмет" back backTo="/">
        <EmptyState
          icon="alert"
          title="Предмет не найден"
          description="Возможно, он был удалён."
          action={<Button onClick={() => navigate('/')}>К списку предметов</Button>}
        />
      </Page>
    );
  }

  const activeGroup = groups.find((group) => group.id === groupId) ?? groups[0];
  const totalStudents = groups.reduce((sum, group) => sum + group.students, 0);
  const subtitle =
    groups.length === 0
      ? 'группы не добавлены'
      : groups.length === 1
        ? countLabel(totalStudents, 'студент', 'студента', 'студентов')
        : groups.map((group) => group.name).join(', ');

  return (
    <Page
      title={subject.name}
      subtitle={subtitle}
      back
      backTo="/"
      actions={<IconButton icon="settings" label="Настройки предмета" onClick={() => setSettingsOpen(true)} />}
      padded={false}
    >
      <div className="mx-auto w-full max-w-app px-5 pt-3 lg:px-8">
        <div className="scroll-x -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {groups.map((group) => {
            const active = group.id === (activeGroup?.id ?? '');
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setGroupId(group.id)}
                className={`h-10 shrink-0 rounded-full border px-3.5 text-[13px] transition-colors focus-ring ${
                  active
                    ? 'border-ink bg-ink font-medium text-surface'
                    : 'border-line bg-surface text-dim hover:border-line-strong'
                }`}
              >
                {group.name}
                {group.students > 0 ? (
                  <span className={`tnum ml-1.5 text-[11px] ${active ? 'text-surface/60' : 'text-faint'}`}>
                    {group.students}
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setGroupSheet(true)}
            aria-label="Добавить группу"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-faint transition-colors hover:text-ink focus-ring"
          >
            <Icon name="plus" size={17} />
          </button>
        </div>

        <div className="mt-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'journal', label: 'Журнал' },
              { value: 'table', label: 'Таблица' },
              { value: 'students', label: 'Студенты' },
              { value: 'overview', label: 'Сводка' },
            ]}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-app px-5 pb-6 pt-5 lg:px-8">
        {tab === 'journal' ? (
          <JournalTab
            subject={subject}
            snapshot={snapshot}
            groupId={activeGroup?.id ?? ''}
            onAdd={() => setCreatingActivity(true)}
            onAddGroup={() => setGroupSheet(true)}
          />
        ) : null}
        {tab === 'table' ? (
          <JournalTable subject={subject} snapshot={snapshot} groupId={activeGroup?.id ?? ''} />
        ) : null}
        {tab === 'students' ? (
          <StudentsTab
            subject={subject}
            snapshot={snapshot}
            groupId={activeGroup?.id ?? ''}
            onAddGroup={() => setGroupSheet(true)}
          />
        ) : null}
        {tab === 'overview' ? (
          <OverviewTab subject={subject} snapshot={snapshot} groupId={activeGroup?.id ?? ''} />
        ) : null}
      </div>

      {tab === 'journal' && activeGroup ? (
        <Fab label="Новое занятие" onClick={() => setCreatingActivity(true)} />
      ) : null}

      <ActivityFormSheet
        open={creatingActivity}
        onClose={() => setCreatingActivity(false)}
        subject={subject}
        snapshot={snapshot}
        groups={groups}
        initialGroupId={activeGroup?.id}
        onCreated={(activityId) => {
          setCreatingActivity(false);
          navigate(`/activity/${activityId}`);
        }}
      />

      <GroupSheet
        open={groupSheet}
        onClose={() => setGroupSheet(false)}
        subject={subject}
        snapshot={snapshot}
        currentGroupIds={groups.map((group) => group.id)}
        onCreated={(id) => {
          setGroupId(id);
          setGroupSheet(false);
          toast('Группа добавлена');
        }}
      />

      <SubjectSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        subject={subject}
        onDeleted={() => navigate('/')}
      />
    </Page>
  );
}

/* ------------------------------- Журнал --------------------------------- */

function JournalTab({
  subject,
  snapshot,
  groupId,
  onAdd,
  onAddGroup,
}: {
  subject: Subject;
  snapshot: Snapshot;
  groupId: string;
  onAdd: () => void;
  onAddGroup: () => void;
}) {
  const enabledTypes = ACTIVITY_TYPES.filter((type) => subject.enabledTypes.includes(type));
  const [type, setType] = useState<ActivityType>(
    enabledTypes.includes('lab') ? 'lab' : (enabledTypes[0] ?? 'practice'),
  );

  useEffect(() => {
    if (!enabledTypes.includes(type)) setType(enabledTypes[0] ?? 'practice');
  }, [enabledTypes, type]);

  const activities = subjectActivities(snapshot, subject.id);
  const visible = useMemo(() => {
    if (!groupId) return [];
    return activities.filter((activity) => {
      if (activity.type !== type) return false;
      const sessions = snapshot.sessions.filter(
        (session) => session.activityId === activity.id && session.groupId === groupId && !session.deletedAt,
      );
      if (sessions.length) return true;
      // занятие без сессий показываем, чтобы можно было добавить даты
      return !snapshot.sessions.some((session) => session.activityId === activity.id);
    });
  }, [activities, snapshot.sessions, type, groupId]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of ACTIVITY_TYPES) {
      map[t] = activities.filter(
        (activity) =>
          activity.type === t &&
          snapshot.sessions.some(
            (session) =>
              session.activityId === activity.id && session.groupId === groupId && !session.deletedAt,
          ),
      ).length;
    }
    return map;
  }, [activities, snapshot.sessions, groupId]);

  if (!groupId) {
    return (
      <EmptyState
        icon="users"
        title="Сначала группа"
        description="Добавьте группу — по ней будут занятия, студенты и баллы."
        action={
          <Button icon="plus" onClick={onAddGroup}>
            Добавить группу
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <Segmented
        value={type}
        onChange={setType}
        options={enabledTypes.map((t) => ({
          value: t,
          label: ACTIVITY_TYPE_LABEL[t],
          badge: counts[t] ? String(counts[t]) : undefined,
        }))}
      />

      {visible.length ? (
        <div className="mt-4 space-y-3">
          {visible.map((activity) => (
            <ActivityBlock
              key={activity.id}
              activity={activity}
              subject={subject}
              snapshot={snapshot}
              groupId={groupId}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={type === 'lab' ? 'message' : 'list'}
          title={activities.length === 0 ? 'Журнал начинается с занятия' : 'Здесь пока пусто'}
          description={
            type === 'lab'
              ? 'Создайте лабораторную — приложение предложит даты и подгруппы.'
              : 'Создайте занятие: укажите название, максимум и даты сессий.'
          }
          action={
            <Button icon="plus" onClick={onAdd}>
              Добавить занятие
            </Button>
          }
        />
      )}
    </div>
  );
}

function ActivityBlock({
  activity,
  subject,
  snapshot,
  groupId,
}: {
  activity: Activity;
  subject: Subject;
  snapshot: Snapshot;
  groupId: string;
}) {
  const navigate = useNavigate();
  const attendanceOnly = !isGradedType(activity.type);
  const sessions = snapshot.sessions
    .filter((session) => session.activityId === activity.id && session.groupId === groupId && !session.deletedAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const subjectSessions = snapshot.sessions.filter((s) => s.subjectId === subject.id && !s.deletedAt);
  const deadline = activityDeadline(activity, subjectSessions);
  const state = deadlineState(deadline, todayIso());
  const weight = activityWeight(subject, activity);

  let total = 0;
  let graded = 0;
  let attended = 0;
  let marked = 0;
  for (const session of sessions) {
    const roster = sessionRoster(snapshot, session);
    total += roster.length;
    for (const student of roster) {
      if (!attendanceOnly) {
        if (gradeOf(snapshot, session.id, student.id)?.score != null) graded += 1;
      }
      const attendance = attendanceOf(snapshot, session.id, student.id);
      if (attendance) {
        marked += 1;
        if (attendance.present) attended += 1;
      }
    }
  }
  const done = attendanceOnly ? marked : graded;
  const completion = total ? (done / total) * 100 : null;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => navigate(`/activity/${activity.id}`)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus-ring"
      >
        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${TYPE_TONE[activity.type]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{activity.title}</span>
          <span className="mt-0.5 block text-[12px] text-faint">
            {countLabel(sessions.length, 'сессия', 'сессии', 'сессий')}
            {attendanceOnly ? ' · только посещаемость' : ` · вес ${weight}`}
          </span>
          {deadline ? (
            <span
              className={`mt-1 block text-[11.5px] ${
                completion !== null && completion >= 100
                  ? 'text-faint'
                  : state === 'overdue'
                    ? 'text-clay'
                    : 'text-faint'
              }`}
            >
              {completion !== null && completion >= 100
                ? 'всё отмечено'
                : relativeDeadline(deadline)}{' '}
              · {formatDateShort(deadline)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="tnum block text-[13px] font-medium text-ink">
            {attendanceOnly
              ? `${attended}/${total}`
              : completion === null
                ? '—'
                : `${Math.round(completion)}%`}
          </span>
          {!attendanceOnly ? (
            <span className="tnum mt-0.5 block text-[11px] text-faint">
              {graded}/{total}
            </span>
          ) : (
            <span className="mt-0.5 block text-[11px] text-faint">было</span>
          )}
        </span>
      </button>

      {sessions.length ? (
        <div className="border-t border-line">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              snapshot={snapshot}
              attendanceOnly={attendanceOnly}
              onClick={() => navigate(`/session/${session.id}`)}
            />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => navigate(`/activity/${activity.id}`)}
          className="w-full border-t border-line px-4 py-2.5 text-left text-[12px] text-clay focus-ring"
        >
          Добавить даты занятия
        </button>
      )}
    </div>
  );
}

function SessionRow({
  session,
  snapshot,
  attendanceOnly,
  onClick,
}: {
  session: ActivitySession;
  snapshot: Snapshot;
  attendanceOnly: boolean;
  onClick: () => void;
}) {
  const roster = sessionRoster(snapshot, session);
  const subgroup = session.subgroupId
    ? snapshot.subgroups.find((s) => s.id === session.subgroupId)
    : undefined;
  const tone = subgroupTone(subgroup?.index);
  let done = 0;
  let attended = 0;
  for (const student of roster) {
    if (!attendanceOnly && gradeOf(snapshot, session.id, student.id)?.score != null) done += 1;
    const attendance = attendanceOf(snapshot, session.id, student.id);
    if (attendance?.present) attended += 1;
  }

  return (
    <div className="flex items-center border-t border-line/70 first:border-t-0">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 pr-3 text-left focus-ring"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${subgroup ? tone.dot : 'bg-steel'}`} />
        <span className="tnum shrink-0 text-[12.5px] text-ink">{formatDateCompact(session.date)}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-faint">
          {subgroup ? subgroup.name : 'вся группа'}
        </span>
        <span className="tnum shrink-0 text-[11.5px] text-dim">
          {attendanceOnly ? `было ${attended}/${roster.length}` : `${done}/${roster.length}`}
        </span>
        <Icon name="forward" size={15} className="shrink-0 text-faint" />
      </button>
    </div>
  );
}

/* ------------------------------ Студенты -------------------------------- */

function StudentsTab({
  subject,
  snapshot,
  groupId,
  onAddGroup,
}: {
  subject: Subject;
  snapshot: Snapshot;
  groupId: string;
  onAddGroup: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingStudent, setEditingStudent] = useState<string | null>(null);

  const subgroups = useMemo(
    () =>
      snapshot.subgroups
        .filter((s) => s.subjectId === subject.id && s.groupId === groupId && !s.deletedAt)
        .sort((a, b) => a.index - b.index),
    [snapshot.subgroups, subject.id, groupId],
  );

  const ranking = useMemo(
    () => (groupId ? groupRanking(snapshot, subject.id, groupId) : []),
    [snapshot, subject.id, groupId],
  );

  const rows = ranking
    .filter((row) =>
      query.trim() ? row.student.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
    )
    .sort((a, b) => a.student.name.localeCompare(b.student.name, 'ru'));

  if (!groupId) {
    return (
      <EmptyState
        icon="users"
        title="Сначала группа"
        description="Добавьте группу и зачислите в неё студентов."
        action={
          <Button icon="plus" onClick={onAddGroup}>
            Добавить группу
          </Button>
        }
      />
    );
  }

  const withGrades = ranking.filter((r) => r.progress.finalPercent != null);
  const average = withGrades.length
    ? withGrades.reduce((acc, r) => acc + (r.progress.finalPercent ?? 0), 0) / withGrades.length
    : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-faint">
          {countLabel(ranking.length, 'студент', 'студента', 'студентов')} · средний {formatPercent(average)}
        </p>
        <Button size="sm" icon="plus" variant="secondary" onClick={() => setAdding(true)}>
          Добавить
        </Button>
      </div>

      {subgroups.length ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {subgroups.map((subgroup) => {
            const tone = subgroupTone(subgroup.index);
            const count = ranking.filter((row) =>
              snapshot.enrollments.some(
                (e) =>
                  !e.deletedAt &&
                  e.subjectId === subject.id &&
                  e.studentId === row.student.id &&
                  e.subgroupId === subgroup.id,
              ),
            ).length;
            return (
              <span key={subgroup.id} className="inline-flex items-center gap-1.5 text-[11.5px] text-dim">
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {subgroup.name}
                <span className="tnum text-faint">{count}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {ranking.length > 8 ? (
        <div className="relative mt-3">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти студента…"
            className="h-11 pl-10"
            aria-label="Поиск студента"
            autoComplete="off"
          />
        </div>
      ) : null}

      {ranking.length ? (
        <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
          {rows.map((row, index) => {
            const enrollment = snapshot.enrollments.find(
              (e) => e.subjectId === subject.id && e.studentId === row.student.id && !e.deletedAt,
            );
            const subgroup = subgroups.find((s) => s.id === enrollment?.subgroupId);
            const tone = subgroupTone(subgroup?.index);
            return (
              <div
                key={row.student.id}
                className={`flex items-center gap-2 pl-2.5 pr-1.5 ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="tnum w-5 shrink-0 text-right text-[11.5px] text-faint">{index + 1}</span>
                <span className={`h-8 w-[3px] shrink-0 rounded-full ${subgroup ? tone.dot : 'bg-transparent'}`} />
                <button
                  type="button"
                  onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left focus-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-ink">{row.student.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                      {subgroup ? subgroup.name : 'без подгруппы'}
                      <span aria-hidden="true">·</span>
                      {row.progress.graded}/{row.progress.total} оценок
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-[14px] font-medium text-ink">
                      {formatPercent(row.progress.finalPercent)}
                    </span>
                    {row.rank > 0 ? (
                      <span className="block text-[11px] text-faint">{row.rank} место</span>
                    ) : null}
                  </span>
                </button>
                <IconButton
                  icon="edit"
                  label={`Изменить ${row.student.name}`}
                  onClick={() => setEditingStudent(row.student.id)}
                  size={17}
                />
              </div>
            );
          })}
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-faint">Никого не нашли</p>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon="users"
          title="В группе нет студентов"
          description="Добавьте студентов по одному или вставьте список — подгруппы распределятся по кругу."
          action={
            <Button icon="plus" onClick={() => setAdding(true)}>
              Добавить студентов
            </Button>
          }
        />
      )}

      <AddStudentsSheet
        open={adding}
        onClose={() => setAdding(false)}
        subject={subject}
        snapshot={snapshot}
        groupId={groupId}
        subgroups={subgroups}
      />

      {editingStudent ? (
        <EnrollmentSheet
          key={editingStudent}
          open
          onClose={() => setEditingStudent(null)}
          subject={subject}
          snapshot={snapshot}
          studentId={editingStudent}
          subgroups={subgroups}
          onRemoved={() => {
            setEditingStudent(null);
            toast('Студент снят с предмета');
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------- Сводка -------------------------------- */

function OverviewTab({ subject, snapshot, groupId }: { subject: Subject; snapshot: Snapshot; groupId: string }) {
  const navigate = useNavigate();
  const overview = subjectOverview(snapshot, subject.id);
  const stats = groupId ? computeGroupStats(snapshot, subject.id, groupId) : null;
  const activities = subjectActivities(snapshot, subject.id);

  return (
    <div>
      <div className="flex items-end justify-between border-b border-line pb-4">
        <div>
          <p className="text-[12.5px] text-faint">Средний по группе</p>
          <p className="display mt-1 text-[38px] leading-none text-ink">
            {formatPercent(stats?.averagePercent ?? overview.averagePercent)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12.5px] text-faint">Заполнено</p>
          <p className="display mt-1 text-[24px] leading-none text-ink">{formatPercent(overview.completion)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line">
        <div className="pr-3">
          <p className="tnum text-[19px] font-medium text-ink">{stats?.students ?? overview.students}</p>
          <p className="mt-0.5 text-[11.5px] text-faint">студентов</p>
        </div>
        <div className="px-3">
          <p className="tnum text-[19px] font-medium text-ink">{activities.length}</p>
          <p className="mt-0.5 text-[11.5px] text-faint">занятий</p>
        </div>
        <div className="pl-3">
          <p className={`tnum text-[19px] font-medium ${overview.overdueDeadlines ? 'text-clay' : 'text-ink'}`}>
            {overview.overdueDeadlines}
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">с пропусками</p>
        </div>
      </div>

      {overview.lectureSessions > 0 ? (
        <p className="mt-4 text-[12.5px] text-dim">
          Лекции: было {overview.lecturePresent} из {overview.lectureMarked} отмеченных. В итоговый балл не входят.
        </p>
      ) : null}

      {stats ? (
        <>
          <SectionTitle>Распределение</SectionTitle>
          <div className="space-y-2.5">
            {stats.distribution.map((item) => (
              <div key={item.bucket} className="flex items-center gap-3">
                <span className="tnum w-16 shrink-0 text-[11.5px] text-faint">{item.bucket}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-clay"
                    style={{ width: `${stats.students ? (item.count / stats.students) * 100 : 0}%` }}
                  />
                </div>
                <span className="tnum w-4 shrink-0 text-right text-[11.5px] text-dim">{item.count}</span>
              </div>
            ))}
          </div>

          <SectionTitle
            action={
              stats.lagging.length ? (
                <span className="text-[11.5px] text-clay">
                  {countLabel(stats.lagging.length, 'отстаёт', 'отстают', 'отстают')}
                </span>
              ) : (
                <span className="text-[11.5px] text-moss">все выше порога</span>
              )
            }
          >
            Рейтинг
          </SectionTitle>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {stats.ranking.slice(0, 5).map((row, index) => (
              <button
                key={row.student.id}
                type="button"
                onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/50 focus-ring ${
                  index > 0 ? 'border-t border-line' : ''
                }`}
              >
                <span className="tnum w-4 text-[12px] text-faint">{row.rank || '—'}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{row.student.name}</span>
                <span className="tnum text-[13px] font-medium text-ink">
                  {formatPercent(row.progress.finalPercent)}
                </span>
              </button>
            ))}
          </div>

          <Button variant="secondary" full className="mt-3" onClick={() => navigate(`/stats?subject=${subject.id}`)}>
            Вся статистика
          </Button>
        </>
      ) : null}

      <SectionTitle>Шкала предмета</SectionTitle>
      <div className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-dim">Максимум</span>
          <span className="tnum text-ink">{subject.scaleMax}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">Порог «сдал»</span>
          <span className="tnum text-ink">{subject.passThreshold}%</span>
        </div>
        {ACTIVITY_TYPES.filter(
          (type) => subject.enabledTypes.includes(type) && type !== 'lecture',
        ).map((type) => (
          <div key={type} className="flex justify-between">
            <span className="text-dim">Вес: {ACTIVITY_TYPE_LABEL[type].toLowerCase()}</span>
            <span className="tnum text-ink">{subject.typeWeights[type]}</span>
          </div>
        ))}
        <p className="pt-1 text-[11.5px] text-faint">Лекции — только посещаемость, в балл не входят.</p>
      </div>
    </div>
  );
}

/* ------------------------------- Группы --------------------------------- */

function GroupSheet({
  open,
  onClose,
  subject,
  snapshot,
  currentGroupIds,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  snapshot: Snapshot;
  currentGroupIds: string[];
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const current = new Set(currentGroupIds);
  const available = snapshot.groups
    .filter((group) => !group.deletedAt && !current.has(group.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const addExisting = async (groupId: string) => {
    if (busy) return;
    setBusy(true);
    const enrolled = await enrollGroupToSubject(subject.id, groupId);
    setBusy(false);
    toast(
      enrolled
        ? `Зачислено студентов: ${enrolled}`
        : 'Группа добавлена, но в ней пока нет студентов',
    );
    onCreated(groupId);
  };

  const addGroup = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const group = await findOrCreateGroup(name);
    await ensureSubgroups(subject.id, group.id, 2);
    await enrollGroupToSubject(subject.id, group.id);
    setBusy(false);
    setName('');
    onCreated(group.id);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Группа в предмете"
      description="Выберите существующую группу — студенты зачислятся автоматически. Или создайте новую."
      footer={
        <Button full size="lg" disabled={!name.trim() || busy} onClick={() => void addGroup()}>
          Создать и зачислить
        </Button>
      }
    >
      <div className="space-y-4">
        {available.length ? (
          <div>
            <p className="mb-2 text-[12.5px] text-dim">Существующие группы</p>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {available.map((group) => {
                const members = groupStudents(snapshot, group.id).length;
                return (
                  <div key={group.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] text-ink">{group.name}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">
                        {countLabel(members, 'студент', 'студента', 'студентов')}
                      </p>
                    </div>
                    <Button size="sm" variant="soft" disabled={busy} onClick={() => void addExisting(group.id)}>
                      Зачислить
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <Field label="Новая группа" htmlFor="group-name">
          <Input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="4232"
            autoComplete="off"
          />
        </Field>
        <p className="text-[11.5px] leading-relaxed text-faint">
          Для лабораторных создаются две подгруппы; студентов можно добавить на вкладке «Группы».
        </p>
      </div>
    </Sheet>
  );
}

/* ------------------------------- Студент -------------------------------- */

function AddStudentsSheet({
  open,
  onClose,
  subject,
  snapshot,
  groupId,
  subgroups,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  snapshot: Snapshot;
  groupId: string;
  subgroups: { id: string; name: string; index: number }[];
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'existing' | 'bulk'>('existing');
  const [bulk, setBulk] = useState('');
  const [subgroupId, setSubgroupId] = useState<string>(subgroups[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!subgroups.some((s) => s.id === subgroupId)) setSubgroupId(subgroups[0]?.id ?? '');
  }, [subgroups, subgroupId]);

  const enrolled = new Set(
    snapshot.enrollments
      .filter((e) => e.subjectId === subject.id && e.groupId === groupId && !e.deletedAt)
      .map((e) => e.studentId),
  );

  const suggestions = snapshot.students
    .filter((student) => !student.deletedAt && !enrolled.has(student.id))
    .filter((student) => (query.trim() ? student.name.toLowerCase().includes(query.trim().toLowerCase()) : true))
    .slice(0, 30);

  const addStudent = async (name: string, options?: { useSelection?: boolean; index?: number }) => {
    const student = await createStudent(name);
    let subgroup: { id: string } | null = null;
    if (subgroups.length) {
      subgroup = options?.useSelection
        ? subgroups.find((s) => s.id === subgroupId) ?? subgroups[0]
        : subgroups[(options?.index ?? 0) % subgroups.length];
    }
    await enrollStudent({
      subjectId: subject.id,
      groupId,
      studentId: student.id,
      subgroupId: subgroup?.id ?? null,
    });
    return student;
  };

  const submitBulk = async () => {
    const names = bulk
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!names.length) return;
    setBusy(true);
    let index = 0;
    for (const name of names) {
      await addStudent(name, { index: index++ });
    }
    setBusy(false);
    setBulk('');
    toast(`Добавлено студентов: ${names.length}`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Добавить студентов"
      description={subgroups.length ? 'Подгруппы назначаются по кругу — потом можно изменить.' : undefined}
      footer={
        mode === 'bulk' ? (
          <Button full size="lg" disabled={busy || !bulk.trim()} onClick={() => void submitBulk()}>
            {busy ? 'Добавляем…' : 'Добавить списком'}
          </Button>
        ) : (
          <Button
            full
            size="lg"
            disabled={!query.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await addStudent(query.trim(), { useSelection: true });
              setBusy(false);
              setQuery('');
              toast('Студент добавлен');
            }}
          >
            {query.trim() ? `Добавить ${query.trim()}` : 'Введите имя'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'existing', label: 'Найти или создать' },
            { value: 'bulk', label: 'Списком' },
          ]}
        />

        {mode === 'existing' ? (
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Имя студента…"
              aria-label="Имя студента"
              autoFocus
              autoComplete="off"
            />
            {subgroups.length > 1 ? (
              <Field label="Подгруппа для нового студента">
                <div className="flex gap-2">
                  {subgroups.map((subgroup) => {
                    const tone = subgroupTone(subgroup.index);
                    return (
                      <button
                        key={subgroup.id}
                        type="button"
                        onClick={() => setSubgroupId(subgroup.id)}
                        className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-[13px] focus-ring ${
                          subgroupId === subgroup.id
                            ? `border-transparent ${tone.badge} font-medium`
                            : 'border-line text-dim'
                        }`}
                      >
                        {subgroup.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}
            <div>
              <p className="mb-2 text-[12.5px] text-dim">Уже в базе</p>
              <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {suggestions.map((student) => (
                  <div key={student.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0 truncate text-[14px] text-ink">{student.name}</span>
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={async () => {
                        await enrollStudent({
                          subjectId: subject.id,
                          groupId,
                          studentId: student.id,
                          subgroupId: subgroups.length ? subgroupId || subgroups[0].id : null,
                        });
                        toast('Студент зачислен');
                      }}
                    >
                      Зачислить
                    </Button>
                  </div>
                ))}
                {suggestions.length === 0 ? (
                  <p className="px-4 py-4 text-[12.5px] text-faint">
                    {query ? 'Совпадений нет — создайте нового' : 'Все студенты из базы уже зачислены'}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <Field label="Список студентов" hint="По одному в строке. Подгруппы распределятся по кругу.">
            <Textarea
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
              rows={8}
              placeholder={'Иванов Иван\nПетрова Мария\n…'}
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function EnrollmentSheet({
  open,
  onClose,
  subject,
  snapshot,
  studentId,
  subgroups,
  onRemoved,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  snapshot: Snapshot;
  studentId: string;
  subgroups: { id: string; name: string; index: number }[];
  onRemoved: () => void;
}) {
  const toast = useToast();
  const student = snapshot.students.find((s) => s.id === studentId);
  const enrollment = snapshot.enrollments.find(
    (e) => e.subjectId === subject.id && e.studentId === studentId && !e.deletedAt,
  );
  const [busy, setBusy] = useState(false);

  if (!student || !enrollment) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={student.name}
      description="Подгруппа в этом предмете"
      footer={
        <Button
          full
          variant="secondary"
          className="text-danger"
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            await removeEnrollment(enrollment.id);
            setBusy(false);
            onRemoved();
          }}
        >
          Убрать из предмета
        </Button>
      }
    >
      {subgroups.length > 1 ? (
        <div>
          <p className="mb-2 text-[12.5px] text-dim">Подгруппа</p>
          <div className="grid grid-cols-2 gap-2">
            {subgroups.map((subgroup) => {
              const tone = subgroupTone(subgroup.index);
              const active = enrollment.subgroupId === subgroup.id;
              return (
                <button
                  key={subgroup.id}
                  type="button"
                  onClick={async () => {
                    await updateEnrollment(enrollment.id, { subgroupId: subgroup.id });
                    toast('Подгруппа обновлена');
                  }}
                  className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-[13.5px] focus-ring ${
                    active ? `border-transparent ${tone.badge} font-medium` : 'border-line text-dim'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  {subgroup.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-dim">
          В этой группе нет подгрупп. Они нужны только для лабораторных.
        </p>
      )}
      <p className="mt-5 text-[12px] leading-relaxed text-faint">
        Студент остаётся в общей базе: баллы в других предметах не затрагиваются.
      </p>
    </Sheet>
  );
}

/* ---------------------------- Настройки предмета ------------------------ */

function SubjectSettingsSheet({
  open,
  onClose,
  subject,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(subject.name);
  const [scaleMax, setScaleMax] = useState(String(subject.scaleMax));
  const [passThreshold, setPassThreshold] = useState(String(subject.passThreshold));
  const [weights, setWeights] = useState({
    lecture: String(subject.typeWeights.lecture),
    practice: String(subject.typeWeights.practice),
    lab: String(subject.typeWeights.lab),
  });
  const [enabled, setEnabled] = useState<Record<ActivityType, boolean>>({
    lecture: subject.enabledTypes.includes('lecture'),
    practice: subject.enabledTypes.includes('practice'),
    lab: subject.enabledTypes.includes('lab'),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(subject.name);
    setScaleMax(String(subject.scaleMax));
    setPassThreshold(String(subject.passThreshold));
    setWeights({
      lecture: String(subject.typeWeights.lecture),
      practice: String(subject.typeWeights.practice),
      lab: String(subject.typeWeights.lab),
    });
    setEnabled({
      lecture: subject.enabledTypes.includes('lecture'),
      practice: subject.enabledTypes.includes('practice'),
      lab: subject.enabledTypes.includes('lab'),
    });
  }, [subject, open]);

  const save = async () => {
    await updateSubject(subject.id, {
      name: name.trim() || subject.name,
      scaleMax: Math.max(1, Number(scaleMax) || subject.scaleMax),
      passThreshold: Math.min(100, Math.max(0, Number(passThreshold) || 0)),
      typeWeights: {
        lecture: 0,
        practice: Math.max(0, Number(weights.practice) || 0),
        lab: Math.max(0, Number(weights.lab) || 0),
      },
      enabledTypes: ACTIVITY_TYPES.filter((type) => enabled[type]),
    });
    toast('Настройки сохранены');
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Настройки предмета"
        footer={
          <Button full size="lg" onClick={() => void save()}>
            Сохранить
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Название" htmlFor="settings-name">
            <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Максимум шкалы" htmlFor="settings-scale">
              <Input
                id="settings-scale"
                type="number"
                min={1}
                value={scaleMax}
                onChange={(event) => setScaleMax(event.target.value)}
              />
            </Field>
            <Field
              label="Порог «сдал», %"
              hint="Шкала: 0–50 — 2, 51–70 — 3, 71–85 — 4, 86–100 — 5"
              htmlFor="settings-pass"
            >
              <Input
                id="settings-pass"
                type="number"
                min={0}
                max={100}
                value={passThreshold}
                onChange={(event) => setPassThreshold(event.target.value)}
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-dim">Виды занятий</p>
            <div className="divide-y divide-line rounded-xl border border-line bg-surface">
              {ACTIVITY_TYPES.map((type) => (
                <div key={type} className="flex items-center gap-3 px-3.5 py-1">
                  <div className="flex-1">
                    <Switch
                      label={ACTIVITY_TYPE_LABEL[type]}
                      description={type === 'lecture' ? 'только посещаемость' : undefined}
                      checked={enabled[type]}
                      onChange={(checked) => setEnabled((current) => ({ ...current, [type]: checked }))}
                    />
                  </div>
                  {type !== 'lecture' ? (
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={weights[type]}
                      onChange={(event) =>
                        setWeights((current) => ({ ...current, [type]: event.target.value }))
                      }
                      aria-label={`Вес: ${ACTIVITY_TYPE_LABEL[type]}`}
                      className="h-10 w-16 px-2 text-center"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-faint">
              Лекции не входят в итоговый балл: для них отмечается только явка.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-surface px-3.5">
            <Switch
              label="В архиве"
              description="Скрывает предмет из активного списка. Данные сохраняются."
              checked={Boolean(subject.archivedAt)}
              onChange={async (checked) => {
                await setSubjectArchived(subject.id, checked);
                toast(checked ? 'Предмет в архиве' : 'Предмет возвращён');
              }}
            />
          </div>

          <button
            type="button"
            className="w-full py-2 text-[13px] text-danger underline-offset-2 hover:underline focus-ring"
            onClick={() => setConfirmDelete(true)}
          >
            Удалить предмет
          </button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Удалить предмет?"
        description={`«${subject.name}» и все его занятия, сессии и оценки будут скрыты.`}
        confirmLabel="Удалить предмет"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSubject(subject.id);
          setConfirmDelete(false);
          onClose();
          toast('Предмет удалён');
          onDeleted();
        }}
      />
    </>
  );
}
