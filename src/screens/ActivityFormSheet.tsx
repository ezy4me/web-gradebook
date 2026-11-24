import { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABEL,
  type ActivityType,
  type Subject,
} from '../db/types';
import type { Snapshot } from '../domain/grading';
import { createActivity, createSessionsBulk, ensureSubgroups } from '../db/repo';
import { planSessions } from '../domain/schedule';
import { formatDateShort, todayIso } from '../lib/date';
import { Button, Field, Input, Select, Sheet, useToast } from '../components/ui';

export function ActivityFormSheet({
  open,
  onClose,
  subject,
  snapshot,
  groups,
  initialGroupId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  snapshot: Snapshot;
  groups: { id: string; name: string }[];
  initialGroupId?: string;
  onCreated: (activityId: string) => void;
}) {
  const toast = useToast();
  const enabledTypes = ACTIVITY_TYPES.filter((type) => subject.enabledTypes.includes(type));
  const [type, setType] = useState<ActivityType>(
    enabledTypes.includes('lab') ? 'lab' : (enabledTypes[0] ?? 'practice'),
  );
  const [title, setTitle] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [weight, setWeight] = useState<'inherit' | string>('inherit');
  const [deadline, setDeadline] = useState('');
  const [groupId, setGroupId] = useState(initialGroupId ?? groups[0]?.id ?? '');
  const [startDate, setStartDate] = useState(todayIso());
  const [count, setCount] = useState('1');
  const [interval, setIntervalDays] = useState('7');
  const [busy, setBusy] = useState(false);

  const subgroups = useMemo(
    () =>
      snapshot.subgroups
        .filter((s) => s.subjectId === subject.id && s.groupId === groupId && !s.deletedAt)
        .sort((a, b) => a.index - b.index),
    [snapshot.subgroups, subject.id, groupId],
  );

  const existingOfType = useMemo(
    () => snapshot.activities.filter((a) => a.subjectId === subject.id && a.type === type && !a.deletedAt).length,
    [snapshot.activities, subject.id, type],
  );

  useEffect(() => {
    setTitle(`${ACTIVITY_TYPE_LABEL[type]} ${existingOfType + 1}`);
  }, [type, existingOfType]);

  // Группы могут появиться после первого монтирования шита — подхватываем их.
  useEffect(() => {
    if (!groupId && groups.length > 0) setGroupId(initialGroupId ?? groups[0].id);
  }, [groupId, groups, initialGroupId]);

  useEffect(() => {
    setCount(type === 'lab' ? String(Math.max(1, subgroups.length)) : '1');
  }, [type, subgroups.length, groupId]);

  const plan = useMemo(() => {
    if (!groupId) return [];
    return planSessions({
      type,
      groupId,
      startDate,
      count: Number(count) || 0,
      intervalDays: Number(interval) || 7,
      subgroups,
    });
  }, [type, groupId, startDate, count, interval, subgroups]);

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) {
      toast('Укажите название занятия', 'danger');
      return;
    }
    if (!groupId) {
      toast('Сначала добавьте группу в предмет', 'danger');
      return;
    }
    if (type === 'lab' && plan.length > 0 && subgroups.length === 0) {
      toast('Для лабораторных нужны подгруппы', 'danger');
      return;
    }
    setBusy(true);
    try {
      const activity = await createActivity({
        subjectId: subject.id,
        type,
        title,
        maxScore: Number(maxScore) > 0 ? Number(maxScore) : 0,
        weight: weight === 'inherit' ? null : Number(weight),
        deadline: deadline || null,
      });
      if (plan.length > 0) {
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
      }
      toast(`Занятие создано, сессий: ${plan.length}`, 'success');
      onCreated(activity.id);
    } finally {
      setBusy(false);
    }
  };

  const subgroupLabel = (subgroupId: string | null): string => {
    if (!subgroupId) return 'вся группа';
    const subgroup = subgroups.find((s) => s.id === subgroupId);
    return subgroup ? subgroup.name.toLowerCase() : 'подгруппа';
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Новое занятие"
      description="Даты сессий можно изменить позже в карточке занятия."
      footer={
        <Button full size="lg" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Создаём…' : 'Создать занятие'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Вид занятия">
          <div className="grid grid-cols-3 gap-2">
            {enabledTypes.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={`h-11 rounded-xl border text-[13px] font-medium transition-colors focus-ring ${
                  type === option
                    ? 'border-accent bg-ink text-surface'
                    : 'border-line bg-surface text-dim'
                }`}
              >
                {ACTIVITY_TYPE_LABEL[option]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Название" htmlFor="activity-title">
          <Input id="activity-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>

        {groups.length > 0 ? (
          <Field label="Группа" htmlFor="activity-group">
            <Select id="activity-group" aria-label="Группа" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {type === 'lecture' ? (
          <p className="rounded-xl bg-elevated px-3.5 py-2.5 text-[12px] leading-snug text-dim">
            Лекция не входит в итоговый балл: на экране сессии отмечается только явка.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Максимум (${subject.scaleMax} по умолч.)`} htmlFor="activity-max">
              <Input
                id="activity-max"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder={String(subject.scaleMax)}
                value={maxScore}
                onChange={(event) => setMaxScore(event.target.value)}
              />
            </Field>
            <Field label="Вес" htmlFor="activity-weight">
              <Select id="activity-weight" aria-label="Вес занятия" value={weight} onChange={(event) => setWeight(event.target.value)}>
                <option value="inherit">Как у вида ({subject.typeWeights[type]})</option>
                {[0, 0.5, 1, 2, 3, 4].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label="Дедлайн занятия (необязательно)" hint="По умолчанию — дата следующей сессии группы.">
          <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>

        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="text-[13px] font-medium text-ink">Сессии по умолчанию</p>
          <p className="mt-0.5 text-[12px] leading-snug text-faint">
            {type === 'lab'
              ? 'Подгруппы чередуются 1 → 2 → 1 → 2 по датам. Любую дату можно переопределить.'
              : 'Лекции и практики — одна сессия на всю группу.'}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Старт" htmlFor="activity-start">
              <Input
                id="activity-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="px-2 text-[13px]"
              />
            </Field>
            <Field label="Сессий" htmlFor="activity-count">
              <Input
                id="activity-count"
                type="number"
                inputMode="numeric"
                min={0}
                max={40}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                className="px-2 text-center"
              />
            </Field>
            <Field label="Шаг, дней" htmlFor="activity-interval">
              <Input
                id="activity-interval"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={interval}
                onChange={(event) => setIntervalDays(event.target.value)}
                className="px-2 text-center"
              />
            </Field>
          </div>

          {type === 'lab' && subgroups.length === 0 ? (
            <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2">
              <p className="text-[12px] leading-snug text-warn">
                В группе нет подгрупп. Для лабораторных нужны подгруппы — создайте их сейчас.
              </p>
              <Button
                size="sm"
                variant="soft"
                className="mt-2"
                onClick={async () => {
                  await ensureSubgroups(subject.id, groupId, 2);
                  toast('Созданы 2 подгруппы', 'success');
                }}
              >
                Создать 2 подгруппы
              </Button>
            </div>
          ) : null}

          {plan.length > 0 ? (
            <div className="mt-3 space-y-1 border-t border-line pt-2.5">
              {plan.slice(0, 6).map((item, index) => (
                <div key={`${item.date}-${index}`} className="flex items-center justify-between text-[12px]">
                  <span className="text-dim">Сессия {index + 1}</span>
                  <span className="tabular-nums text-ink">
                    {formatDateShort(item.date)}
                    {type === 'lab' ? ` · ${subgroupLabel(item.subgroupId)}` : ''}
                  </span>
                </div>
              ))}
              {plan.length > 6 ? (
                <p className="text-[12px] text-faint">и ещё {plan.length - 6}…</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-faint">Сессии не будут созданы — добавьте их вручную.</p>
          )}
        </div>

        {type === 'lab' ? (
          <p className="text-[12px] leading-snug text-faint">
            Студенты распределяются по подгруппам на вкладке «Студенты».
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
