import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  Fab,
  Field,
  FullPageLoader,
  IconButton,
  Input,
  Progress,
  Segmented,
  Sheet,
  Switch,
  useToast,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useSnapshot } from '../db/hooks';
import { createSubject } from '../db/repo';
import { seedDemoData } from '../db/seed';
import { subjectOverview } from '../domain/grading';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABEL, type ActivityType, type ScaleKind } from '../db/types';
import { formatPercent } from '../domain/grading';
import { updateSettings, useSettings } from '../lib/settings';
import { countLabel, subjectInitials } from '../lib/text';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';

export function SubjectsScreen() {
  const snapshot = useSnapshot();
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const subjects = useMemo(
    () =>
      (snapshot?.subjects ?? [])
        .filter((subject) => !subject.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [snapshot],
  );

  const cards = useMemo(() => {
    if (!snapshot) return [];
    return subjects.map((subject) => {
      const overview = subjectOverview(snapshot, subject.id);
      const groupNames = [
        ...new Set(
          snapshot.subgroups
            .filter((s) => s.subjectId === subject.id && !s.deletedAt)
            .map((s) => snapshot.groups.find((g) => g.id === s.groupId)?.name ?? ''),
        ),
      ].filter(Boolean);
      return { subject, overview, groupNames };
    });
  }, [snapshot, subjects]);

  const filtered = cards.filter(({ subject, groupNames }) => {
    if (Boolean(subject.archivedAt) !== showArchived) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      subject.name.toLowerCase().includes(needle) ||
      subjectInitials(subject.name).toLowerCase().includes(needle) ||
      groupNames.some((name) => name.toLowerCase().includes(needle))
    );
  });

  if (!snapshot) {
    return (
      <Page title="Предметы">
        <FullPageLoader />
      </Page>
    );
  }

  const hasAnySubject = cards.length > 0;
  const isDark = settings.theme === 'dark';
  const activeCount = cards.filter((c) => !c.subject.archivedAt).length;
  const archivedCount = cards.length - activeCount;
  const showSearch = cards.length > 3;

  return (
    <Page
      title="Предметы"
      subtitle={
        hasAnySubject
          ? `${countLabel(activeCount, 'активный предмет', 'активных предмета', 'активных предметов')}`
          : undefined
      }
      actions={
        <>
          <IconButton
            icon={isDark ? 'sun' : 'moon'}
            label="Переключить тему"
            onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
          />
          <IconButton icon="settings" label="Настройки" onClick={() => navigate('/settings')} />
        </>
      }
    >
      {hasAnySubject ? (
        <>
          {showSearch ? (
            <div className="relative">
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти предмет или группу"
                className="h-11 pl-10"
                aria-label="Поиск"
              />
            </div>
          ) : null}

          {archivedCount > 0 ? (
            <div className="mt-4">
              <Segmented
                value={showArchived ? 'archive' : 'active'}
                onChange={(value) => setShowArchived(value === 'archive')}
                options={[
                  { value: 'active', label: 'Активные' },
                  { value: 'archive', label: 'Архив' },
                ]}
              />
            </div>
          ) : null}

          {filtered.length ? (
            <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
              {filtered.map(({ subject, overview, groupNames }, index) => {
                const band = gradeBand(overview.averagePercent);
                const tone = band ? GRADE_CLASSES[band.tone] : null;
                return (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => navigate(`/subject/${subject.id}`)}
                    className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors duration-150 hover:bg-elevated/50 focus-ring ${
                      index > 0 ? 'border-t border-line' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          title={subject.name}
                          className={`display truncate text-ink ${
                            settings.shortSubjectNames ? 'text-[26px] leading-none tracking-wide' : 'text-[19px] leading-snug'
                          }`}
                        >
                          {settings.shortSubjectNames ? subjectInitials(subject.name) : subject.name}
                        </span>
                        {subject.archivedAt ? <Badge tone="warn">архив</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-faint">
                        {groupNames.length ? groupNames.join(', ') : 'группы не добавлены'}
                        {overview.students > 0
                          ? ` · ${countLabel(overview.students, 'студент', 'студента', 'студентов')}`
                          : ''}
                      </p>
                      <div className="mt-3 flex items-center gap-2.5">
                        <Progress value={overview.averagePercent ?? 0} thin />
                        <span className="tnum w-9 shrink-0 text-right text-[11.5px] text-dim">
                          {formatPercent(overview.averagePercent)}
                        </span>
                        {band ? (
                          <span
                            className={`tnum shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone?.soft} ${tone?.text}`}
                          >
                            {band.grade}
                          </span>
                        ) : null}
                      </div>
                      {overview.overdueDeadlines > 0 ? (
                        <p className="mt-1.5 text-[11.5px] text-clay">
                          {countLabel(overview.overdueDeadlines, 'сессия', 'сессии', 'сессий')} с пропусками
                        </p>
                      ) : null}
                    </div>
                    <Icon name="forward" size={17} className="mt-1 shrink-0 text-faint" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-8 text-center text-[13px] text-faint">
              {showArchived ? 'В архиве пусто' : 'Ничего не найдено'}
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-col items-center pt-10 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-line text-clay">
            <Icon name="book" size={26} />
          </div>
          <p className="display text-[27px] leading-tight text-ink">Журнал пуст</p>
          <p className="mt-2 max-w-[32ch] text-[13.5px] leading-relaxed text-dim">
            Создайте предмет, добавьте группу и студентов — дальше останутся занятия и баллы.
          </p>
          <div className="mt-6 flex w-full max-w-[280px] flex-col gap-2">
            <Button size="lg" icon="plus" onClick={() => setCreating(true)}>
              Новый предмет
            </Button>
            <Button
              variant="ghost"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                await seedDemoData();
                setSeeding(false);
                toast('Демо-данные загружены');
              }}
            >
              {seeding ? 'Готовим демо…' : 'Посмотреть на демо-данных'}
            </Button>
          </div>
        </div>
      )}

      {hasAnySubject ? <Fab label="Новый предмет" onClick={() => setCreating(true)} /> : null}

      <CreateSubjectSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          toast('Предмет создан');
          navigate(`/subject/${id}`);
        }}
      />
    </Page>
  );
}

function CreateSubjectSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [scaleKind, setScaleKind] = useState<ScaleKind>('points');
  const [scaleMax, setScaleMax] = useState('100');
  const [passThreshold, setPassThreshold] = useState('51');
  const [enabled, setEnabled] = useState<Record<ActivityType, boolean>>({
    lecture: true,
    practice: true,
    lab: true,
  });
  const [weights, setWeights] = useState<Record<ActivityType, string>>({
    lecture: '0',
    practice: '1',
    lab: '2',
  });
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName('');
    setScaleKind('points');
    setScaleMax('100');
    setPassThreshold('51');
    setEnabled({ lecture: true, practice: true, lab: true });
    setWeights({ lecture: '0', practice: '1', lab: '2' });
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const subject = await createSubject({
      name,
      scaleMax: Math.max(1, Number(scaleMax) || 100),
      passThreshold: Math.min(100, Math.max(0, Number(passThreshold) || 51)),
      scaleKind,
      enabledTypes: ACTIVITY_TYPES.filter((type) => enabled[type]),
      typeWeights: {
        lecture: 0,
        practice: Math.max(0, Number(weights.practice) || 0),
        lab: Math.max(0, Number(weights.lab) || 0),
      },
    });
    setBusy(false);
    reset();
    onCreated(subject.id);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Новый предмет"
      description="Шкалу и веса можно изменить позже в настройках предмета."
      footer={
        <Button full size="lg" disabled={!name.trim() || busy} onClick={() => void submit()}>
          {busy ? 'Создаём…' : 'Создать предмет'}
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Название" htmlFor="subject-name">
          <Input
            id="subject-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Веб-разработка"
            autoFocus
          />
        </Field>

        <Field label="Тип шкалы">
          <Segmented
            value={scaleKind}
            onChange={(value) => {
              setScaleKind(value);
              if (value === 'pass-fail') setScaleMax('1');
              if (value === 'points' && scaleMax === '1') setScaleMax('100');
            }}
            options={[
              { value: 'points', label: 'Баллы' },
              { value: 'pass-fail', label: 'Сдал / не сдал' },
            ]}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Максимум шкалы" htmlFor="subject-scale">
            <Input
              id="subject-scale"
              type="number"
              inputMode="decimal"
              min={1}
              value={scaleMax}
              onChange={(event) => setScaleMax(event.target.value)}
            />
          </Field>
          <Field label="Порог «сдал», %" htmlFor="subject-threshold">
            <Input
              id="subject-threshold"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={passThreshold}
              onChange={(event) => setPassThreshold(event.target.value)}
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-dim">Виды занятий и веса</p>
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
                  <div className="w-16 shrink-0">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.5"
                      value={weights[type]}
                      onChange={(event) => setWeights((current) => ({ ...current, [type]: event.target.value }))}
                      aria-label={`Вес: ${ACTIVITY_TYPE_LABEL[type]}`}
                      className="h-10 px-2 text-center"
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-snug text-faint">
            Лабораторные весят 2, практики — 1. Лекции в балл не входят: только явка.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
