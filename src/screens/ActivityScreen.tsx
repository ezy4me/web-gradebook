import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  Fab,
  Field,
  FullPageLoader,
  IconButton,
  Input,
  Progress,
  SectionTitle,
  Select,
  Sheet,
  useToast,
} from '../components/ui';
import { useSnapshot } from '../db/hooks';
import { createSessionsBulk, deleteActivity, deleteSession, updateActivity } from '../db/repo';
import {
  activityMaxScore,
  activitySessions,
  activityWeight,
  attendanceOf,
  collectSubjectGroups,
  formatPercent,
  gradeOf,
  isGradedType,
  sessionRoster,
  summarizeActivity,
  type Snapshot,
} from '../domain/grading';
import { activityDeadline, planSessions } from '../domain/schedule';
import { deadlineState, formatDateLong, formatDateShort, relativeDeadline, todayIso } from '../lib/date';
import { countLabel } from '../lib/text';
import { subgroupTone } from '../lib/subgroup';
import { ACTIVITY_TYPE_LABEL, type Activity, type ActivitySession, type Subject } from '../db/types';

export function ActivityScreen() {
  const { activityId } = useParams();
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const toast = useToast();
  const [addingSessions, setAddingSessions] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmActivity, setConfirmActivity] = useState(false);
  const [confirmSession, setConfirmSession] = useState<ActivitySession | null>(null);

  const activity = snapshot?.activities.find((a) => a.id === activityId && !a.deletedAt);
  const subject = snapshot?.subjects.find((s) => s.id === activity?.subjectId);

  if (!snapshot) {
    return (
      <Page title="Занятие" back>
        <FullPageLoader />
      </Page>
    );
  }

  if (!activity || !subject) {
    return (
      <Page title="Занятие" back backTo="/">
        <EmptyState icon="alert" title="Занятие не найдено" />
      </Page>
    );
  }

  const sessions = activitySessions(snapshot, activity.id);
  const summary = summarizeActivity(snapshot, activity);
  const subjectSessions = snapshot.sessions.filter((s) => s.subjectId === subject.id && !s.deletedAt);
  const deadline = activityDeadline(activity, subjectSessions);
  const state = deadlineState(deadline, todayIso());
  const max = activityMaxScore(subject, activity);
  const weight = activityWeight(subject, activity);
  const attendanceOnly = !isGradedType(activity.type);
  const allMarked = attendanceOnly
    ? summary.totalCells > 0 && summary.attendanceMarked >= summary.totalCells
    : summary.totalCells > 0 && summary.graded >= summary.totalCells;

  const grouped = new Map<string, ActivitySession[]>();
  for (const session of sessions) {
    const list = grouped.get(session.date) ?? [];
    list.push(session);
    grouped.set(session.date, list);
  }
  const dateGroups = [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  return (
    <Page
      title={activity.title}
      subtitle={`${ACTIVITY_TYPE_LABEL[activity.type]} · ${subject.name}`}
      back
      backTo={`/subject/${subject.id}`}
      actions={<IconButton icon="settings" label="Настройки занятия" onClick={() => setSettingsOpen(true)} />}
      padded={false}
    >
      <div className="mx-auto w-full max-w-app px-5 pt-4">
        <div className="flex items-end justify-between border-b border-line pb-3">
          <div>
            <p className="text-[12px] text-faint">
              {attendanceOnly ? 'Были на лекции' : 'Средний по занятию'}
            </p>
            <p className="display mt-0.5 text-[30px] leading-none text-ink">
              {attendanceOnly
                ? `${summary.attended}/${summary.totalCells}`
                : formatPercent(summary.averagePercent)}
            </p>
          </div>
          <div className="text-right text-[12px] text-dim">
            <p>{countLabel(summary.sessions, 'сессия', 'сессии', 'сессий')}</p>
            <p className="mt-0.5 text-faint">
              {attendanceOnly ? 'только посещаемость' : `макс ${max} · вес ${weight}`}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-[12.5px] text-dim">Дедлайн</p>
            <p className="mt-0.5 text-[12px] text-faint">
              {deadline
                ? allMarked && state === 'overdue'
                  ? 'прошёл, всё отмечено'
                  : relativeDeadline(deadline)
                : 'не задан — нет следующей сессии'}
            </p>
          </div>
          {deadline ? (
            <Badge tone={allMarked ? 'success' : state === 'overdue' ? 'danger' : 'neutral'}>
              {formatDateShort(deadline)}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5 pb-1">
          <Progress value={summary.completion} thin tone={summary.completion >= 100 ? 'success' : 'clay'} />
          <span className="tnum shrink-0 text-[11.5px] text-dim">
            {attendanceOnly
              ? `${summary.attended} из ${summary.totalCells} были`
              : `${summary.graded}/${summary.totalCells} оценок`}
          </span>
        </div>

        <SectionTitle
          action={
            <button
              type="button"
              onClick={() => setAddingSessions(true)}
              className="text-[12.5px] font-medium text-clay focus-ring"
            >
              Добавить даты
            </button>
          }
        >
          Сессии
        </SectionTitle>

        {sessions.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="Сессий пока нет"
            description="Добавьте даты: для лабораторных подгруппы чередуются автоматически."
            action={
              <Button icon="plus" onClick={() => setAddingSessions(true)}>
                Добавить сессии
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {dateGroups.map(([date, items]) => (
              <div key={date}>
                <p className="mb-1.5 text-[12px] text-faint">{formatDateLong(date)}</p>
                <div className="overflow-hidden rounded-card border border-line bg-surface">
                  {items.map((session, index) => {
                    const roster = sessionRoster(snapshot, session);
                    const subgroup = session.subgroupId
                      ? snapshot.subgroups.find((s) => s.id === session.subgroupId)
                      : undefined;
                    const tone = subgroupTone(subgroup?.index);
                    const graded = roster.filter(
                      (student) => gradeOf(snapshot, session.id, student.id)?.score != null,
                    ).length;
                    const attended = roster.filter(
                      (student) => attendanceOf(snapshot, session.id, student.id)?.present === true,
                    ).length;
                    const marked = roster.filter((student) =>
                      attendanceOf(snapshot, session.id, student.id),
                    ).length;
                    const done = attendanceOnly ? marked : graded;
                    const complete = roster.length > 0 && done === roster.length;
                    const partial = done > 0 && !complete;
                    const isPast = session.date < todayIso();
                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-1 pl-3.5 ${index > 0 ? 'border-t border-line' : ''}`}
                      >
                        <span className={`h-7 w-[3px] shrink-0 rounded-full ${tone.dot}`} />
                        <button
                          type="button"
                          onClick={() => navigate(`/session/${session.id}`)}
                          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2.5 pr-1 text-left focus-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14.5px] text-ink">
                              {subgroup ? subgroup.name : 'Вся группа'}
                            </span>
                            <span className="tnum mt-0.5 block text-[11.5px] text-faint">
                              {attendanceOnly
                                ? `было ${attended} из ${roster.length}`
                                : `${graded} из ${roster.length} оценено`}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 text-[11.5px] ${
                              complete
                                ? 'text-moss'
                                : partial
                                  ? 'text-warn'
                                  : isPast
                                    ? 'text-clay'
                                    : 'text-faint'
                            }`}
                          >
                            {complete ? 'заполнено' : partial ? 'частично' : isPast ? 'не заполнено' : 'предстоит'}
                          </span>
                        </button>
                        <IconButton
                          icon="trash"
                          label="Удалить сессию"
                          onClick={() => setConfirmSession(session)}
                          size={16}
                          className="mr-0.5"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Fab label="Новая сессия" onClick={() => setAddingSessions(true)} />

      <AddSessionsSheet
        open={addingSessions}
        onClose={() => setAddingSessions(false)}
        activity={activity}
        subject={subject}
        snapshot={snapshot}
        defaultGroupId={sessions[0]?.groupId}
      />

      <ActivitySettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activity={activity}
        subject={subject}
        onDelete={() => setConfirmActivity(true)}
      />

      <ConfirmSheet
        open={confirmActivity}
        title="Удалить занятие?"
        description={`«${activity.title}» и все его сессии, оценки и посещаемость будут скрыты.`}
        confirmLabel="Удалить занятие"
        onCancel={() => setConfirmActivity(false)}
        onConfirm={async () => {
          await deleteActivity(activity.id);
          toast('Занятие удалено');
          navigate(`/subject/${subject.id}`);
        }}
      />

      <ConfirmSheet
        open={Boolean(confirmSession)}
        title="Удалить сессию?"
        description={
          confirmSession
            ? `Сессия от ${formatDateShort(confirmSession.date)} и связанные оценки будут скрыты.`
            : undefined
        }
        confirmLabel="Удалить сессию"
        onCancel={() => setConfirmSession(null)}
        onConfirm={async () => {
          if (!confirmSession) return;
          await deleteSession(confirmSession.id);
          setConfirmSession(null);
          toast('Сессия удалена');
        }}
      />
    </Page>
  );
}

function AddSessionsSheet({
  open,
  onClose,
  activity,
  subject,
  snapshot,
  defaultGroupId,
}: {
  open: boolean;
  onClose: () => void;
  activity: Activity;
  subject: Subject;
  snapshot: Snapshot;
  defaultGroupId?: string;
}) {
  const toast = useToast();
  const groups = useMemo(() => {
    return collectSubjectGroups(snapshot, subject.id);
  }, [snapshot, subject.id]);

  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [startDate, setStartDate] = useState(todayIso());
  const [count, setCount] = useState('2');
  const [interval, setIntervalDays] = useState('7');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!groupId && groups.length > 0) setGroupId(defaultGroupId ?? groups[0].id);
  }, [groupId, groups, defaultGroupId]);

  const subgroups = snapshot.subgroups
    .filter((s) => s.subjectId === subject.id && s.groupId === groupId && !s.deletedAt)
    .sort((a, b) => a.index - b.index);

  const plan = planSessions({
    type: activity.type,
    groupId,
    startDate,
    count: Number(count) || 0,
    intervalDays: Number(interval) || 7,
    subgroups,
  });

  const submit = async () => {
    if (!plan.length) return;
    setBusy(true);
    try {
      await createSessionsBulk(
        plan.map((item) => ({
          subjectId: subject.id,
          activityId: activity.id,
          groupId: item.groupId,
          subgroupId: item.subgroupId,
          date: item.date,
          deadline: null,
          note: '',
        })),
      );
      toast(`Добавлено сессий: ${plan.length}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Даты занятия"
      description="Даты и подгруппы можно поправить в каждой сессии."
      footer={
        <Button full size="lg" disabled={busy || plan.length === 0} onClick={() => void submit()}>
          {busy ? 'Добавляем…' : `Создать ${plan.length || ''} сессий`}
        </Button>
      }
    >
      <div className="space-y-4">
        {groups.length > 1 ? (
          <Field label="Группа">
            <Select aria-label="Группа" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Дата первой сессии">
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Количество">
            <Input
              type="number"
              min={1}
              max={40}
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className="text-center"
            />
          </Field>
          <Field label="Шаг, дней">
            <Input
              type="number"
              min={1}
              max={60}
              inputMode="numeric"
              value={interval}
              onChange={(event) => setIntervalDays(event.target.value)}
              className="text-center"
            />
          </Field>
        </div>

        {activity.type === 'lab' && subgroups.length === 0 ? (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[12px] leading-snug text-warn">
            В группе нет подгрупп — лабораторные сессии создать нельзя. Добавьте подгруппы на экране студентов.
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-[12.5px] text-dim">Предпросмотр</p>
          <div className="divide-y divide-line rounded-xl border border-line">
            {plan.map((item, index) => (
              <div key={`${item.date}-${index}`} className="flex justify-between px-3.5 py-2 text-[12px]">
                <span className="text-dim">
                  {item.subgroupId
                    ? subgroups.find((s) => s.id === item.subgroupId)?.name ?? 'Подгруппа'
                    : 'Вся группа'}
                </span>
                <span className="tnum text-ink">{formatDateShort(item.date)}</span>
              </div>
            ))}
            {plan.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-faint">Сессии не будут созданы</p>
            ) : null}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function ActivitySettingsSheet({
  open,
  onClose,
  activity,
  subject,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  activity: Activity;
  subject: Subject;
  onDelete: () => void;
}) {
  const toast = useToast();
  const attendanceOnly = !isGradedType(activity.type);
  const [title, setTitle] = useState(activity.title);
  const [maxScore, setMaxScore] = useState(activity.maxScore > 0 ? String(activity.maxScore) : '');
  const [weight, setWeight] = useState(activity.weight == null ? 'inherit' : String(activity.weight));
  const [deadline, setDeadline] = useState(activity.deadline ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    await updateActivity(activity.id, {
      title: title.trim() || activity.title,
      maxScore: Number(maxScore) > 0 ? Number(maxScore) : 0,
      weight: weight === 'inherit' ? null : Number(weight),
      deadline: deadline || null,
    });
    setBusy(false);
    toast('Занятие сохранено');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Занятие"
      footer={
        <Button full size="lg" disabled={busy} onClick={() => void save()}>
          Сохранить
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Название">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        {attendanceOnly ? (
          <p className="rounded-xl bg-elevated px-3.5 py-2.5 text-[12px] leading-snug text-dim">
            Лекция не входит в итоговый балл: для неё отмечается только явка.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Максимум (${subject.scaleMax} по умолч.)`}>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={maxScore}
                onChange={(event) => setMaxScore(event.target.value)}
                placeholder={String(subject.scaleMax)}
              />
            </Field>
            <Field label="Вес">
              <Select aria-label="Вес занятия" value={weight} onChange={(event) => setWeight(event.target.value)}>
                <option value="inherit">Как у вида ({subject.typeWeights[activity.type]})</option>
                {[0, 0.5, 1, 2, 3, 4].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Дедлайн занятия" hint="Пусто — дедлайн считается по следующей сессии группы.">
          <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>
        <button
          type="button"
          className="w-full py-2 text-[13px] text-danger hover:underline focus-ring"
          onClick={onDelete}
        >
          Удалить занятие
        </button>
      </div>
    </Sheet>
  );
}
