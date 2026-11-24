import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { Badge, Button, EmptyState, FullPageLoader, Select } from '../components/ui';
import { useSnapshot } from '../db/hooks';
import { computeGroupStats, collectSubjectGroups, formatPercent, subjectOverview } from '../domain/grading';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';
import { countLabel } from '../lib/text';
import { subgroupTone } from '../lib/subgroup';

export function StatsScreen() {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('subject') ?? '';

  const subjects = useMemo(
    () =>
      (snapshot?.subjects ?? [])
        .filter((subject) => !subject.deletedAt && !subject.archivedAt)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [snapshot],
  );

  const [subjectId, setSubjectId] = useState(requested || subjects[0]?.id || '');

  useEffect(() => {
    if (!subjects.length) return;
    if (!subjects.some((subject) => subject.id === subjectId)) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  useEffect(() => {
    if (subjectId && subjectId !== requested) setSearchParams({ subject: subjectId }, { replace: true });
  }, [subjectId, requested, setSearchParams]);

  const groups = useMemo(() => {
    if (!snapshot || !subjectId) return [];
    return collectSubjectGroups(snapshot, subjectId);
  }, [snapshot, subjectId]);

  const [groupId, setGroupId] = useState('');

  useEffect(() => {
    if (!groups.length) {
      setGroupId('');
      return;
    }
    if (!groups.some((group) => group.id === groupId)) setGroupId(groups[0].id);
  }, [groups, groupId]);

  if (!snapshot) {
    return (
      <Page title="Статистика">
        <FullPageLoader />
      </Page>
    );
  }

  if (subjects.length === 0) {
    return (
      <Page title="Статистика">
        <EmptyState
          icon="chart"
          title="Считать пока нечего"
          description="Создайте предмет и добавьте студентов — здесь появятся средние баллы, распределение и рейтинг."
          action={<Button onClick={() => navigate('/')}>К предметам</Button>}
        />
      </Page>
    );
  }

  const subject = subjects.find((item) => item.id === subjectId) ?? subjects[0];
  const overview = subjectOverview(snapshot, subject.id);
  const stats = groupId ? computeGroupStats(snapshot, subject.id, groupId) : null;
  const averageBand = gradeBand(stats?.averagePercent ?? overview.averagePercent);
  const averageTone = averageBand ? GRADE_CLASSES[averageBand.tone] : null;

  return (
    <Page title="Статистика" subtitle={subject.name}>
      <div className="space-y-2">
        <Select
          value={subject.id}
          onChange={(event) => setSubjectId(event.target.value)}
          aria-label="Предмет"
          className="h-11"
        >
          {subjects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        {groups.length > 1 ? (
          <div className="scroll-x -mx-1 flex gap-2 overflow-x-auto px-1">
            {groups.map((group) => {
              const active = group.id === groupId;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setGroupId(group.id)}
                  className={`h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] transition-colors focus-ring ${
                    active
                      ? 'border-ink bg-ink font-medium text-surface'
                      : 'border-line bg-surface text-dim hover:border-line-strong'
                  }`}
                >
                  {group.name}
                </button>
              );
            })}
          </div>
        ) : groups[0] ? (
          <p className="text-[12px] text-faint">Группа {groups[0].name}</p>
        ) : null}
      </div>

      <div className="mt-5 flex items-end justify-between border-b border-line pb-4">
        <div>
          <p className="text-[12px] text-faint">Средний балл</p>
          <p className={`display mt-1 text-[42px] leading-none ${averageTone ? averageTone.text : 'text-ink'}`}>
            {formatPercent(stats?.averagePercent ?? overview.averagePercent)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-faint">Журнал заполнен</p>
          <p className="display mt-1 text-[24px] leading-none text-ink">{formatPercent(overview.completion)}</p>
          {averageBand ? (
            <p className={`tnum mt-1 text-[13px] font-semibold ${averageTone?.text}`}>
              оценка {averageBand.grade}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line">
        <div className="pr-3">
          <p className="tnum text-[19px] font-medium text-ink">{stats?.students ?? overview.students}</p>
          <p className="mt-0.5 text-[11.5px] text-faint">студентов</p>
        </div>
        <div className="px-3">
          <p className="tnum text-[19px] font-medium text-ink">{overview.activities}</p>
          <p className="mt-0.5 text-[11.5px] text-faint">занятий</p>
        </div>
        <div className="pl-3">
          <p className={`tnum text-[19px] font-medium ${overview.overdueDeadlines ? 'text-clay' : 'text-ink'}`}>
            {overview.overdueDeadlines}
          </p>
          <p className="mt-0.5 text-[11.5px] text-faint">с пропусками</p>
        </div>
      </div>

      {stats ? (
        <>
          <h2 className="mt-7 text-[13px] font-medium text-dim">Распределение</h2>
          <div className="mt-3 space-y-2.5">
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

          <div className="mt-7 flex items-end justify-between">
            <h2 className="text-[13px] font-medium text-dim">Рейтинг группы</h2>
            {stats.lagging.length ? (
              <Badge tone="accent">{countLabel(stats.lagging.length, 'отстаёт', 'отстают', 'отстают')}</Badge>
            ) : (
              <Badge tone="moss">все выше порога</Badge>
            )}
          </div>
          <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
            {stats.ranking.map((row, index) => {
              const band = gradeBand(row.progress.finalPercent);
              const tone = band ? GRADE_CLASSES[band.tone] : null;
              return (
                <button
                  key={row.student.id}
                  type="button"
                  onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/50 focus-ring ${
                    index > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="tnum w-4 shrink-0 text-[12px] text-faint">{row.rank || '—'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">{row.student.name}</span>
                    <span className="mt-0.5 block text-[11px] text-faint">
                      {Math.round(row.progress.completion)}% журнала
                    </span>
                  </span>
                  <span className={`tnum shrink-0 text-[13.5px] font-medium ${tone ? tone.text : 'text-ink'}`}>
                    {formatPercent(row.progress.finalPercent)}
                  </span>
                  {band ? (
                    <span
                      className={`tnum shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone?.soft} ${tone?.text}`}
                    >
                      {band.grade}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {stats.ranking.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-faint">В группе нет студентов</p>
            ) : null}
          </div>

          {stats.lagging.length ? (
            <>
              <h2 className="mt-7 text-[13px] font-medium text-dim">Нужно подтянуть</h2>
              <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
                {stats.lagging.map((row, index) => (
                  <button
                    key={row.student.id}
                    type="button"
                    onClick={() => navigate(`/subject/${subject.id}/student/${row.student.id}`)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-elevated/50 focus-ring ${
                      index > 0 ? 'border-t border-line' : ''
                    }`}
                  >
                    <span className="min-w-0 truncate text-[14px] text-ink">{row.student.name}</span>
                    <span className="tnum shrink-0 text-[13px] text-clay">
                      {formatPercent(row.progress.finalPercent)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <p className="mt-6 text-[11.5px] leading-relaxed text-faint">
            Итог — взвешенная сумма по практикам и лабораторным: лабораторные ×{subject.typeWeights.lab},
            практики ×{subject.typeWeights.practice}. Пропуски считаются нулём, лекции в балл не входят.
            Порог — {subject.passThreshold}%.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>сессий: {overview.sessions}</Badge>
            <Badge>
              оценок: {overview.graded}/{overview.totalCells}
            </Badge>
            {groups.length > 1
              ? groups.map((group) => (
                  <span key={group.id} className="inline-flex items-center gap-1 text-[11px] text-faint">
                    <span className={`h-1.5 w-1.5 rounded-full ${subgroupTone(1).dot}`} />
                    {group.name}
                  </span>
                ))
              : null}
          </div>
        </>
      ) : (
        <EmptyState
          icon="users"
          title="Группы не добавлены"
          description="Зачислите студентов в предмет, чтобы увидеть рейтинг и распределение."
          action={<Button onClick={() => navigate(`/subject/${subject.id}`)}>Открыть предмет</Button>}
        />
      )}
    </Page>
  );
}
