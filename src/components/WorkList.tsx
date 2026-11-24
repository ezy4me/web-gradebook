import type { ActivityType, Subject } from '../db/types';
import { EmptyState } from './ui';
import { Icon } from './icons';
import { activityMaxScore, activityWeight } from '../domain/grading';
import { isPassed, worksByType, type WorkRow } from '../domain/studentWorks';
import { formatDateShort } from '../lib/date';
import { GRADE_CLASSES, scoreBand } from '../lib/grades';

export interface WorkListItem extends WorkRow {
  subject: Subject;
}

const TYPE_LABELS: Record<ActivityType, string> = {
  lecture: 'Лекции',
  practice: 'Практики',
  lab: 'Лабораторные',
};

export function WorkList({
  items,
  onOpen,
}: {
  items: WorkListItem[];
  onOpen: (sessionId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon="list"
        title="Работ пока нет"
        description="Когда появятся занятия и оценки, они соберутся здесь по видам."
      />
    );
  }

  const groups = worksByType(items);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.type}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-medium text-dim">{TYPE_LABELS[group.type]}</h2>
            <span className="tnum text-[11.5px] text-faint">{group.rows.length}</span>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {group.rows.map((row, index) => (
              <WorkItemRow
                key={`${row.subject.id}:${row.activity.id}`}
                item={row}
                first={index === 0}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkItemRow({
  item,
  first,
  onOpen,
}: {
  item: WorkListItem;
  first: boolean;
  onOpen: (sessionId: string) => void;
}) {
  const { subject, activity, session, score, present, comment } = item;
  const max = activityMaxScore(subject, activity);
  const weight = activityWeight(subject, activity);
  const lecture = activity.type === 'lecture';
  const band = scoreBand(score, max);
  const tone = band ? GRADE_CLASSES[band.tone] : null;
  const passed = isPassed(subject, item, max);
  const passFail = subject.scaleKind === 'pass-fail';
  const passTone = passed == null ? null : passed ? GRADE_CLASSES.grade5 : GRADE_CLASSES.grade2;

  return (
    <div className={first ? '' : 'border-t border-line'}>
      <button
        type="button"
        disabled={!session}
        onClick={() => session && onOpen(session.id)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus-ring disabled:cursor-default"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-ink">{activity.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">
            {subject.name}
            {session ? ` · ${formatDateShort(session.date)}` : ''}
            {lecture ? ' · посещаемость' : ` · вес ${weight}`}
          </p>
          {comment ? <p className="mt-1 text-[12px] leading-snug text-dim">{comment}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          {lecture ? (
            <p
              className={`text-[12px] ${
                present === true ? 'text-moss' : present === false ? 'text-clay' : 'text-faint'
              }`}
            >
              {present === true ? 'был' : present === false ? 'не был' : 'не отмечено'}
            </p>
          ) : passFail ? (
            <>
              <p
                className={`flex items-center justify-end gap-1 text-[12px] font-medium ${
                  passTone ? passTone.text : 'text-faint'
                }`}
              >
                {passed == null ? null : (
                  <Icon name={passed ? 'check' : 'close'} size={13} />
                )}
                {passed == null ? '—' : passed ? 'сдал' : 'не сдал'}
              </p>
              {score != null ? (
                <p className="tnum mt-0.5 text-[11px] text-faint">
                  {score} / {max}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className={`tnum text-[15px] font-medium ${tone ? tone.text : 'text-ink'}`}>
                {score ?? '—'}
                <span className="text-[11px] font-normal text-faint"> / {max}</span>
              </p>
              {band ? (
                <p className={`tnum mt-0.5 text-[11px] font-semibold ${tone?.text}`}>
                  оценка {band.grade}
                </p>
              ) : null}
            </>
          )}
          {!lecture && present === false ? <p className="mt-0.5 text-[11px] text-clay">не был</p> : null}
        </div>
      </button>
    </div>
  );
}
