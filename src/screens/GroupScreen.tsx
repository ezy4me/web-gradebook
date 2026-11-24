import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  FullPageLoader,
  IconButton,
  Input,
  Progress,
  SectionTitle,
  Segmented,
  Sheet,
  Textarea,
  useToast,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useSnapshot } from '../db/hooks';
import {
  addStudentToGroup,
  createStudent,
  deleteGroup,
  enrollGroupToSubject,
  removeGroupMember,
  updateGroup,
} from '../db/repo';
import {
  computeGroupStats,
  formatPercent,
  groupStudents,
  groupSubjects,
} from '../domain/grading';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';
import { countLabel, subjectInitials } from '../lib/text';
import { useSettings } from '../lib/settings';
import type { Snapshot } from '../domain/grading';
import type { Group, Student } from '../db/types';

export function GroupScreen() {
  const { groupId } = useParams();
  const snapshot = useSnapshot();
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [addingStudents, setAddingStudents] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const group = snapshot?.groups.find((item) => item.id === groupId && !item.deletedAt);
  useEffect(() => {
    if (settingsOpen && group) setGroupName(group.name);
  }, [settingsOpen, group?.id]);
  const members = useMemo(
    () => (snapshot && groupId ? groupStudents(snapshot, groupId) : []),
    [snapshot, groupId],
  );
  const subjects = useMemo(
    () => (snapshot && groupId ? groupSubjects(snapshot, groupId) : []),
    [snapshot, groupId],
  );
  const subjectStats = useMemo(() => {
    if (!snapshot || !groupId) return [];
    return subjects.map((subject) => ({
      subject,
      stats: computeGroupStats(snapshot, subject.id, groupId),
      band: gradeBand(computeGroupStats(snapshot, subject.id, groupId).averagePercent),
    }));
  }, [snapshot, groupId, subjects]);

  const averages = subjectStats
    .map((item) => item.stats.averagePercent)
    .filter((value): value is number => value != null);
  const average = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
  const averageBand = gradeBand(average);
  const averageTone = averageBand ? GRADE_CLASSES[averageBand.tone] : null;

  if (!snapshot) {
    return (
      <Page title="Группа" back>
        <FullPageLoader />
      </Page>
    );
  }

  if (!group) {
    return (
      <Page title="Группа" back backTo="/groups">
        <EmptyState icon="alert" title="Группа не найдена" />
      </Page>
    );
  }

  return (
    <Page
      title={group.name}
      subtitle={`${countLabel(members.length, 'студент', 'студента', 'студентов')} · ${countLabel(
        subjects.length,
        'предмет',
        'предмета',
        'предметов',
      )}${average != null ? ` · средний ${formatPercent(average)}` : ''}`}
      back
      backTo="/groups"
      actions={
        <IconButton
          icon="settings"
          label="Настройки группы"
          onClick={() => setSettingsOpen(true)}
        />
      }
    >
      <div className="flex items-end justify-between border-b border-line pb-4">
        <div>
          <p className="text-[12px] text-faint">Средний по группе</p>
          <p className={`display mt-1 text-[40px] leading-none ${averageTone ? averageTone.text : 'text-ink'}`}>
            {formatPercent(average)}
          </p>
        </div>
        {averageBand ? (
          <span
            className={`tnum rounded-lg px-2.5 py-1 text-[18px] font-semibold ${averageTone?.soft} ${averageTone?.text}`}
          >
            {averageBand.grade}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button icon="users" variant="secondary" aria-label="Добавить студентов" onClick={() => setAddingStudents(true)}>
          Добавить
        </Button>
        <Button icon="book" variant="secondary" aria-label="Зачислить на предмет" onClick={() => setAddingSubject(true)}>
          Зачислить
        </Button>
      </div>

      <SectionTitle
        action={
          subjects.length ? (
            <span className="text-[11.5px] text-faint">{countLabel(subjects.length, 'предмет', 'предмета', 'предметов')}</span>
          ) : null
        }
      >
        Предметы
      </SectionTitle>

      {subjectStats.length ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {subjectStats.map(({ subject, stats, band }, index) => {
            const tone = band ? GRADE_CLASSES[band.tone] : null;
            return (
              <button
                key={subject.id}
                type="button"
                onClick={() => navigate(`/subject/${subject.id}?group=${group.id}`)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-ring ${
                  index > 0 ? 'border-t border-line' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    title={subject.name}
                    className="block truncate text-[15px] font-medium text-ink"
                  >
                    {settings.shortSubjectNames ? subjectInitials(subject.name) : subject.name}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-faint">
                    {stats.students} студентов · заполнено {formatPercent(stats.completion)}
                  </span>
                  <span className="mt-2 block">
                    <Progress value={stats.averagePercent ?? 0} thin />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`tnum block text-[15px] font-semibold ${tone ? tone.text : 'text-ink'}`}>
                    {formatPercent(stats.averagePercent)}
                  </span>
                  {band ? (
                    <span className={`tnum block text-[11px] ${tone?.text}`}>оценка {band.grade}</span>
                  ) : null}
                </span>
                <Icon name="forward" size={16} className="shrink-0 text-faint" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="book"
          title="Группа пока без предметов"
          description="Зачислите группу в предмет — все её студенты попадут в журнал автоматически."
          action={
            <Button icon="book" onClick={() => setAddingSubject(true)}>
              Зачислить на предмет
            </Button>
          }
        />
      )}

      <SectionTitle
        action={<span className="tnum text-[11.5px] text-faint">{members.length}</span>}
      >
        Студенты
      </SectionTitle>

      {members.length ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {members.map((student, index) => {
            const subjectCount = snapshot.enrollments.filter(
              (enrollment) =>
                !enrollment.deletedAt && enrollment.groupId === group.id && enrollment.studentId === student.id,
            ).length;
            return (
              <div
                key={student.id}
                className={`flex items-center gap-2 pl-2.5 pr-1.5 ${
                  index > 0 ? 'border-t border-line' : ''
                }`}
              >
                <span className="tnum flex w-7 shrink-0 justify-center text-[11.5px] text-faint">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => navigate(`/students/${student.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left focus-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-ink">{student.name}</span>
                    <span className="mt-0.5 block text-[11.5px] text-faint">
                      {subjectCount
                        ? `${countLabel(subjectCount, 'предмет', 'предмета', 'предметов')}`
                        : 'ещё не зачислен'}
                    </span>
                  </span>
                </button>
                <IconButton
                  icon="edit"
                  label={`Изменить ${student.name}`}
                  size={17}
                  onClick={() => setEditingStudent(student)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="users"
          title="В группе нет студентов"
          description="Добавьте список целиком — студенты сразу разойдутся по предметам группы."
          action={
            <Button icon="plus" onClick={() => setAddingStudents(true)}>
              Добавить студентов
            </Button>
          }
        />
      )}

      <AddMembersSheet
        open={addingStudents}
        onClose={() => setAddingStudents(false)}
        snapshot={snapshot}
        groupId={group.id}
        existing={members}
        subjectCount={subjects.length}
      />

      <AddSubjectSheet
        open={addingSubject}
        onClose={() => setAddingSubject(false)}
        snapshot={snapshot}
        group={group}
        currentSubjectIds={subjects.map((subject) => subject.id)}
      />

      {editingStudent ? (
        <Sheet
          open
          onClose={() => setEditingStudent(null)}
          title={editingStudent.name}
          description="Убрать студента можно сразу из группы и всех её предметов."
          footer={
            <Button full variant="secondary" className="text-danger" onClick={() => setConfirmRemove(true)}>
              Убрать из группы
            </Button>
          }
        >
          <p className="text-[13px] leading-relaxed text-dim">
            Студент остаётся в общей базе и в других группах. Оценки в удалённых предметах сохранятся в
            бэкапе, но перестанут отображаться в журнале.
          </p>
        </Sheet>
      ) : null}

      <ConfirmSheet
        open={confirmRemove}
        title="Убрать из группы?"
        description="Студент будет снят с предметов этой группы."
        confirmLabel="Убрать из группы"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={async () => {
          if (!editingStudent) return;
          await removeGroupMember(group.id, editingStudent.id);
          setConfirmRemove(false);
          setEditingStudent(null);
          toast('Студент убран из группы');
        }}
      />

      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Настройки группы"
        description="Название видно во всех предметах этой группы."
        footer={
          <Button
            full
            size="lg"
            disabled={busy || !groupName.trim()}
            onClick={async () => {
              if (busy) return;
              const next = groupName.trim();
              if (!next || next === group.name) {
                setSettingsOpen(false);
                return;
              }
              setBusy(true);
              await updateGroup(group.id, next);
              setBusy(false);
              setSettingsOpen(false);
              toast('Название группы обновлено');
            }}
          >
            Сохранить
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Название" htmlFor="group-settings-name">
            <Input
              id="group-settings-name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
            <p className="text-[13px] font-medium text-ink">Удаление группы</p>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              Группа, её состав, зачисления и сессии исчезнут из журналов. Студенты и предметы
              останутся в базе.
            </p>
            <button
              type="button"
              className="mt-3 text-[12.5px] font-medium text-danger underline-offset-2 hover:underline focus-ring"
              onClick={() => setConfirmDelete(true)}
            >
              Удалить группу
            </button>
          </div>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Удалить группу?"
        description={`«${group.name}» и все её сессии, оценки и посещаемость будут скрыты. Студенты останутся в общей базе.`}
        confirmLabel={busy ? 'Удаляем…' : 'Удалить группу'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (busy) return;
          setBusy(true);
          await deleteGroup(group.id);
          setBusy(false);
          setConfirmDelete(false);
          setSettingsOpen(false);
          toast('Группа удалена');
          navigate('/groups');
        }}
      />
    </Page>
  );
}

/* --------------------------- Добавление студентов ----------------------- */

function AddMembersSheet({
  open,
  onClose,
  snapshot,
  groupId,
  existing,
  subjectCount,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  groupId: string;
  existing: Student[];
  subjectCount: number;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'existing' | 'bulk'>('existing');
  const [query, setQuery] = useState('');
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);

  const existingIds = new Set(existing.map((student) => student.id));
  const suggestions = snapshot.students
    .filter((student) => !student.deletedAt && !existingIds.has(student.id))
    .filter((student) => (query.trim() ? student.name.toLowerCase().includes(query.trim().toLowerCase()) : true))
    .slice(0, 30);

  const add = async (studentId: string) => {
    const enrolled = await addStudentToGroup(groupId, studentId);
    return enrolled;
  };

  const addBulk = async () => {
    const names = bulk
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!names.length) return;
    setBusy(true);
    const byName = new Map(
      snapshot.students
        .filter((student) => !student.deletedAt)
        .map((student) => [student.name.toLowerCase(), student]),
    );
    for (const name of names) {
      let student = byName.get(name.toLowerCase());
      if (!student) {
        student = await createStudent(name);
        byName.set(name.toLowerCase(), student);
      }
      await add(student.id);
    }
    setBusy(false);
    setBulk('');
    toast(`Добавлено студентов: ${names.length}`);
    onClose();
  };

  const exactMatch = query.trim()
    ? snapshot.students.find(
        (student) => !student.deletedAt && student.name.toLowerCase() === query.trim().toLowerCase(),
      )
    : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Студенты группы"
      description={
        subjectCount
          ? `Новые студенты сразу зачисляются в ${countLabel(subjectCount, 'предмет', 'предмета', 'предметов')}.`
          : 'Студенты добавляются в состав группы; предметы можно добавить позже.'
      }
      footer={
        mode === 'bulk' ? (
          <Button full size="lg" disabled={busy || !bulk.trim()} onClick={() => void addBulk()}>
            {busy ? 'Добавляем…' : 'Добавить списком'}
          </Button>
        ) : (
          <Button
            full
            size="lg"
            disabled={!query.trim() || busy}
            onClick={async () => {
              setBusy(true);
              const name = query.trim();
              let student = exactMatch;
              if (!student && name) student = await createStudent(name);
              const enrolled = student ? await add(student.id) : 0;
              setBusy(false);
              setQuery('');
              toast(
                enrolled
                  ? `Студент добавлен и зачислен в ${enrolled} ${countLabel(enrolled, 'предмет', 'предмета', 'предметов')}`
                  : 'Студент добавлен в группу',
              );
              onClose();
            }}
          >
            {query.trim()
              ? exactMatch
                ? `Добавить «${exactMatch.name}»`
                : `Создать «${query.trim()}»`
              : 'Введите имя'}
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
                        const enrolled = await add(student.id);
                        toast(
                          enrolled
                            ? `Добавлен, зачислен в ${enrolled} ${countLabel(enrolled, 'предмет', 'предмета', 'предметов')}`
                            : 'Студент добавлен в группу',
                        );
                      }}
                    >
                      Добавить
                    </Button>
                  </div>
                ))}
                {suggestions.length === 0 ? (
                  <p className="px-4 py-4 text-[12.5px] text-faint">
                    {query ? 'Совпадений нет — создайте нового' : 'Все студенты уже в группе'}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <Field label="Список студентов" hint="По одному в строке.">
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

/* ---------------------------- Зачисление на предмет -------------------- */

function AddSubjectSheet({
  open,
  onClose,
  snapshot,
  group,
  currentSubjectIds,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  group: Group;
  currentSubjectIds: string[];
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const current = new Set(currentSubjectIds);
  const available = snapshot.subjects
    .filter((subject) => !subject.deletedAt && !subject.archivedAt && !current.has(subject.id))
    .filter((subject) => (query.trim() ? subject.name.toLowerCase().includes(query.trim().toLowerCase()) : true))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Зачислить на предмет"
      description="Все студенты группы попадут в журнал; подгруппы распределятся по кругу."
    >
      <div className="space-y-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти предмет…"
          aria-label="Поиск предмета"
          autoComplete="off"
        />
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {available.map((subject) => (
            <div key={subject.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 truncate text-[14px] text-ink">{subject.name}</span>
              <Button
                size="sm"
                variant="soft"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const enrolled = await enrollGroupToSubject(subject.id, group.id);
                  setBusy(false);
                  toast(
                    enrolled
                      ? `Зачислено студентов: ${enrolled}`
                      : 'Группа добавлена, но в ней пока нет студентов',
                  );
                  onClose();
                }}
              >
                Зачислить
              </Button>
            </div>
          ))}
          {available.length === 0 ? (
            <p className="px-4 py-5 text-[12.5px] text-faint">
              {query ? 'Ничего не нашли' : 'Все предметы уже добавлены'}
            </p>
          ) : null}
        </div>
        <p className="text-[11.5px] leading-relaxed text-faint">
          Предметы создаются на вкладке «Предметы». Здесь можно зачислить группу сразу в несколько.
        </p>
      </div>
    </Sheet>
  );
}
