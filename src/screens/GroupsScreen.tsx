import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Button,
  EmptyState,
  Fab,
  Field,
  FullPageLoader,
  Input,
  Progress,
  Sheet,
  useToast,
} from '../components/ui';
import { useSnapshot } from '../db/hooks';
import { createGroup } from '../db/repo';
import {
  computeGroupStats,
  formatPercent,
  groupStudents,
  groupSubjects,
} from '../domain/grading';
import { countLabel } from '../lib/text';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';

export function GroupsScreen() {
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.groups
      .filter((group) => !group.deletedAt)
      .map((group) => {
        const students = groupStudents(snapshot, group.id);
        const subjects = groupSubjects(snapshot, group.id);
        const averages = subjects
          .map((subject) => computeGroupStats(snapshot, subject.id, group.id).averagePercent)
          .filter((value): value is number => value != null);
        const average = averages.length
          ? averages.reduce((sum, value) => sum + value, 0) / averages.length
          : null;
        return { group, students: students.length, subjects: subjects.length, average };
      })
      .sort((a, b) => a.group.name.localeCompare(b.group.name, 'ru'));
  }, [snapshot]);

  if (!snapshot) {
    return (
      <Page title="Группы">
        <FullPageLoader />
      </Page>
    );
  }

  return (
    <Page
      title="Группы"
      subtitle={
        rows.length
          ? `${countLabel(rows.length, 'группа', 'группы', 'групп')} · студенты общие для предметов`
          : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon="users"
          title="Групп пока нет"
          description="Создайте группу, добавьте студентов один раз — и зачисляйте её в любое количество предметов."
          action={
            <Button icon="plus" onClick={() => setCreating(true)}>
              Новая группа
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {rows.map(({ group, students, subjects, average }, index) => {
            const band = gradeBand(average);
            const tone = band ? GRADE_CLASSES[band.tone] : null;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => navigate(`/groups/${group.id}`)}
                className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-elevated/50 focus-ring ${
                  index > 0 ? 'border-t border-line' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="display block truncate text-[20px] leading-snug text-ink">
                    {group.name}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-faint">
                    {countLabel(students, 'студент', 'студента', 'студентов')} ·{' '}
                    {countLabel(subjects, 'предмет', 'предмета', 'предметов')}
                  </span>
                  <span className="mt-3 flex items-center gap-2.5">
                    <Progress value={average ?? 0} thin />
                    <span className="tnum w-9 shrink-0 text-right text-[11.5px] text-dim">
                      {formatPercent(average)}
                    </span>
                    {band ? (
                      <span
                        className={`tnum shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone?.soft} ${tone?.text}`}
                      >
                        {band.grade}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="mt-1 shrink-0 text-faint">›</span>
              </button>
            );
          })}
        </div>
      )}

      {rows.length ? <Fab label="Новая группа" onClick={() => setCreating(true)} /> : null}

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="Новая группа"
        description="Студенты добавляются один раз и учатся в любых предметах этой группы."
        footer={
          <Button
            full
            size="lg"
            disabled={!name.trim()}
            onClick={async () => {
              const group = await createGroup(name);
              setName('');
              setCreating(false);
              toast('Группа создана');
              navigate(`/groups/${group.id}`);
            }}
          >
            Создать группу
          </Button>
        }
      >
        <Field label="Название группы" htmlFor="new-group-name">
          <Input
            id="new-group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="4232"
            autoFocus
            autoComplete="off"
          />
        </Field>
      </Sheet>
    </Page>
  );
}
