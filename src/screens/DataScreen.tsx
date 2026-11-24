import { useMemo, useRef, useState } from 'react';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  ConfirmSheet,
  Field,
  FullPageLoader,
  Input,
  Row,
  SectionTitle,
  Segmented,
  Sheet,
  Textarea,
  useToast,
} from '../components/ui';
import { useSnapshot } from '../db/hooks';
import {
  downloadJson,
  exportBackup,
  importBackup,
  parseBackup,
  summarizeBackup,
  type BackupSummary,
  type ImportMode,
} from '../db/backup';
import { wipeDatabase } from '../db/db';
import { seedDemoData } from '../db/seed';
import { downloadJournalXlsx, excelSummaryLabel } from '../domain/excel';
import { SyncSheet } from '../components/SyncSheet';
import { DriveSheet } from '../components/DriveSheet';
import { phaseLabel, useSyncState } from '../sync/state';
import { driveStatusLabel, useDriveState } from '../drive/state';
import {
  defaultStartYear,
  importSchedule,
  parseScheduleJson,
  type SchedulePlan,
} from '../db/scheduleImport';
import {
  importStudents,
  parseStudentsJson,
  type StudentsPlan,
} from '../db/studentsImport';
import type { BackupFile } from '../db/types';
import { formatDate } from '../lib/date';
import { countLabel } from '../lib/text';

export function DataScreen() {
  const snapshot = useSnapshot();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; name: string; summary: BackupSummary } | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const sync = useSyncState();
  const drive = useDriveState();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [schedule, setSchedule] = useState<{ text: string; name: string } | null>(null);
  const [scheduleYear, setScheduleYear] = useState(String(defaultStartYear()));
  const [schedulePlan, setSchedulePlan] = useState<SchedulePlan | null>(null);
  const [importingSchedule, setImportingSchedule] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const scheduleRef = useRef<HTMLInputElement>(null);

  const [studentsPlan, setStudentsPlan] = useState<StudentsPlan | null>(null);
  const [studentsFileName, setStudentsFileName] = useState('');
  const [studentsPasteOpen, setStudentsPasteOpen] = useState(false);
  const [studentsPaste, setStudentsPaste] = useState('');
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [importingStudents, setImportingStudents] = useState(false);
  const studentsRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    if (!snapshot) return null;
    const active = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((row) => !row.deletedAt).length;
    return {
      subjects: active(snapshot.subjects),
      students: active(snapshot.students),
      activities: active(snapshot.activities),
      sessions: active(snapshot.sessions),
      grades: active(snapshot.grades),
      attendance: active(snapshot.attendance),
    };
  }, [snapshot]);

  if (!snapshot) {
    return (
      <Page title="Данные">
        <FullPageLoader />
      </Page>
    );
  }

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      setPending({ backup, name: file.name, summary: summarizeBackup(backup) });
      setMode('merge');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось прочитать файл', 'danger');
    }
  };

  const onScheduleFile = async (file: File) => {
    try {
      const text = await file.text();
      const plan = parseScheduleJson(text, Number(scheduleYear) || defaultStartYear());
      if (!plan.entries.length) throw new Error('В файле не нашлось пар с датами');
      setSchedule({ text, name: file.name });
      setSchedulePlan(plan);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось прочитать расписание', 'danger');
    }
  };

  const downloadScheduleExample = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/schedule.json`);
      const data = await response.json();
      downloadJson(data, 'web-gradebook-schedule-example.json');
    } catch {
      toast('Не удалось скачать пример', 'danger');
    }
  };

  const parsePasted = () => {
    try {
      const plan = parseScheduleJson(pasteText, Number(scheduleYear) || defaultStartYear());
      if (!plan.entries.length) throw new Error('В JSON не нашлось пар с датами');
      setSchedule({ text: pasteText, name: 'вставленный JSON' });
      setSchedulePlan(plan);
      setPasteOpen(false);
      setPasteError(null);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : 'Не удалось прочитать JSON');
    }
  };

  const applyStudentsPlan = (text: string, fileName: string) => {
    const plan = parseStudentsJson(text);
    if (!plan.entries.length) throw new Error('В JSON не нашлось студентов');
    setStudentsPlan(plan);
    setStudentsFileName(fileName);
  };

  const onStudentsFile = async (file: File) => {
    try {
      applyStudentsPlan(await file.text(), file.name);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось прочитать студентов', 'danger');
    }
  };

  const parseStudentsPaste = () => {
    try {
      applyStudentsPlan(studentsPaste, 'вставленный JSON');
      setStudentsPasteOpen(false);
      setStudentsError(null);
    } catch (error) {
      setStudentsError(error instanceof Error ? error.message : 'Не удалось прочитать JSON');
    }
  };

  const downloadStudentsExample = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/students.json`);
      const data = await response.json();
      downloadJson(data, 'web-gradebook-students-example.json');
    } catch {
      toast('Не удалось скачать пример', 'danger');
    }
  };

  return (
    <Page title="Данные" subtitle="локальная база и резервные копии">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <div>
          <p className="text-[12px] text-faint">Хранится на устройстве</p>
          <p className="display mt-1 text-[28px] leading-none text-ink">
            {countLabel(counts?.subjects ?? 0, 'предмет', 'предмета', 'предметов')}
          </p>
        </div>
        <span className="tnum text-[12px] text-dim">{counts?.grades ?? 0} оценок</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
        <Count label="студенты" value={counts?.students ?? 0} />
        <Count label="занятия" value={counts?.activities ?? 0} />
        <Count label="сессии" value={counts?.sessions ?? 0} />
        <Count label="оценки" value={counts?.grades ?? 0} />
        <Count label="явки" value={counts?.attendance ?? 0} />
      </div>

      <SectionTitle>Перенос данных</SectionTitle>
      <div className="space-y-2">
        <Button
          icon="download"
          full
          size="lg"
          onClick={async () => {
            await exportBackup();
            toast('Бэкап скачан');
          }}
        >
          Скачать бэкап JSON
        </Button>
        <Button icon="upload" variant="secondary" full size="lg" onClick={() => fileRef.current?.click()}>
          Импортировать бэкап
        </Button>
        <Button
          icon="grid"
          variant="soft"
          full
          size="lg"
          disabled={exportingXlsx || (counts?.subjects ?? 0) === 0}
          onClick={() => {
            setExportingXlsx(true);
            try {
              const result = downloadJournalXlsx(snapshot);
              toast(`${excelSummaryLabel(result)} — скачано`);
            } catch (error) {
              toast(error instanceof Error ? error.message : 'Не удалось собрать Excel', 'danger');
            } finally {
              setExportingXlsx(false);
            }
          }}
        >
          {exportingXlsx ? 'Собираем книгу…' : 'Скачать журнал Excel'}
        </Button>
        <Button
          icon="download"
          variant="soft"
          full
          onClick={async () => {
            try {
              const response = await fetch(`${import.meta.env.BASE_URL}examples/backup.json`);
              if (!response.ok) throw new Error('not found');
              const data = await response.json();
              downloadJson(data, 'web-gradebook-example-backup.json');
              toast('Пример бэкапа скачан');
            } catch {
              toast('Не удалось скачать пример', 'danger');
            }
          }}
        >
          Скачать пример бэкапа
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onFile(file);
          }}
        />
        <p className="pt-1 text-[12px] leading-relaxed text-faint">
          Уже есть бэкап этого приложения с другого устройства? Импортируйте его — предметы, занятия,
          оценки и посещаемость восстановятся. В бэкап входят все данные, кроме PIN и темы. Пример
          бэкапа можно скачать, заполнить своими данными и загрузить обратно. Excel-книга — для
          печати и отчёта: сводка по группам и отдельный лист на каждый предмет.
        </p>
      </div>

      <SectionTitle>Расписание</SectionTitle>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            icon="calendar"
            variant="secondary"
            full
            onClick={() => scheduleRef.current?.click()}
          >
            Из файла
          </Button>
          <Button icon="edit" variant="secondary" full onClick={() => setPasteOpen(true)}>
            Вставить JSON
          </Button>
        </div>
        <input
          ref={scheduleRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onScheduleFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => void downloadScheduleExample()}
          className="text-[12.5px] text-clay underline-offset-2 hover:underline focus-ring"
        >
          Скачать пример JSON
        </button>
        <p className="pt-1 text-[12px] leading-relaxed text-faint">
          Формат web-schedule: пары с датами, группами и видами занятий. Каждая дата станет занятием с
          сессией, все группы создадутся сразу, лабораторные получат две подгруппы.
        </p>
      </div>

      <SectionTitle>Студенты</SectionTitle>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            icon="users"
            variant="secondary"
            full
            onClick={() => studentsRef.current?.click()}
          >
            Из файла
          </Button>
          <Button icon="edit" variant="secondary" full onClick={() => setStudentsPasteOpen(true)}>
            Вставить JSON
          </Button>
        </div>
        <input
          ref={studentsRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onStudentsFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => void downloadStudentsExample()}
          className="text-[12.5px] text-clay underline-offset-2 hover:underline focus-ring"
        >
          Скачать пример JSON
        </button>
        <p className="pt-1 text-[12px] leading-relaxed text-faint">
          Группы и студенты одним файлом. Группа — самостоятельная сущность: можно указать несколько
          предметов в JSON, и все студенты зачислятся сразу; без предметов они просто попадут в группу.
        </p>
      </div>

      <SectionTitle>Синхронизация</SectionTitle>
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <Row
          label="Supabase"
          hint={
            sync.configured
              ? sync.signedIn
                ? `Яндекс ID · ${sync.email ?? 'аккаунт'}`
                : 'Вход через Яндекс ID'
              : 'Не настроено: нужны ключи сборки'
          }
          onClick={() => setSyncOpen(true)}
          right={
            <Badge
              tone={
                !sync.configured
                  ? 'neutral'
                  : sync.phase === 'error'
                    ? 'danger'
                    : sync.phase === 'offline'
                      ? 'warn'
                      : sync.signedIn
                        ? 'success'
                        : 'accent'
              }
            >
              {sync.configured ? (sync.signedIn ? phaseLabel(sync.phase) : 'войти') : 'не настроено'}
            </Badge>
          }
        />
        <Row
          label="Google Drive"
          hint={
            drive.configured
              ? drive.lastBackupAt
                ? 'Резервная копия в appDataFolder'
                : 'Резервная копия журнала'
              : 'Не настроено: нужен VITE_GOOGLE_CLIENT_ID'
          }
          onClick={() => setDriveOpen(true)}
          right={
            <Badge
              tone={
                !drive.configured
                  ? 'neutral'
                  : drive.status === 'error'
                    ? 'danger'
                    : drive.status === 'expired'
                      ? 'warn'
                      : drive.status === 'connected' || drive.status === 'syncing'
                        ? 'success'
                        : 'accent'
              }
            >
              {drive.configured ? driveStatusLabel(drive.status) : 'не настроено'}
            </Badge>
          }
        />
      </div>

      <SectionTitle>Опасная зона</SectionTitle>
      <div className="space-y-2">
        <Button
          variant="secondary"
          full
          disabled={seeding || (counts?.subjects ?? 0) > 0}
          onClick={async () => {
            setSeeding(true);
            await seedDemoData();
            setSeeding(false);
            toast('Демо-данные загружены');
          }}
        >
          {seeding ? 'Готовим демо…' : 'Загрузить демо-данные'}
        </Button>
        <button
          type="button"
          className="w-full py-2 text-[13px] text-danger hover:underline focus-ring"
          onClick={() => setConfirmWipe(true)}
        >
          Очистить локальную базу
        </button>
      </div>

      <SyncSheet open={syncOpen} onClose={() => setSyncOpen(false)} />
      <DriveSheet open={driveOpen} onClose={() => setDriveOpen(false)} />

      <ConfirmSheet
        open={confirmWipe}
        title="Очистить всю базу?"
        description="Предметы, студенты, занятия, сессии, оценки и посещаемость будут удалены с этого устройства."
        confirmLabel="Очистить базу"
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => {
          await wipeDatabase();
          setConfirmWipe(false);
          toast('Локальная база очищена');
        }}
      />

      <Sheet
        open={pasteOpen}
        onClose={() => {
          setPasteOpen(false);
          setPasteError(null);
        }}
        title="Вставить расписание"
        description="Плоский JSON: массив пар с dates, group, type и subject."
        footer={
          <Button full size="lg" disabled={!pasteText.trim()} onClick={parsePasted}>
            Проверить и продолжить
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Начало учебного года">
            <Input
              type="number"
              inputMode="numeric"
              value={scheduleYear}
              onChange={(event) => setScheduleYear(event.target.value)}
            />
          </Field>
          <Field label="JSON расписания" hint="Можно вставить целиком файл из web-schedule.">
            <Textarea
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                setPasteError(null);
              }}
              rows={10}
              spellCheck={false}
              placeholder={'[\n  {\n    "dates": ["07.09"],\n    "group": "ИС-21",\n    "type": "лек",\n    "subject": "…"\n  }\n]'}
              className="font-mono text-[12px]"
            />
          </Field>
          {pasteError ? <p className="text-[12px] text-danger">{pasteError}</p> : null}
          <button
            type="button"
            onClick={() => void downloadScheduleExample()}
            className="text-[12.5px] text-clay underline-offset-2 hover:underline focus-ring"
          >
            Скачать пример JSON
          </button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(schedulePlan)}
        onClose={() => {
          setSchedulePlan(null);
          setSchedule(null);
        }}
        title="Импорт расписания"
        description={schedule?.name}
        footer={
          <Button
            full
            size="lg"
            disabled={importingSchedule || !schedulePlan?.entries.length}
            onClick={async () => {
              if (!schedulePlan) return;
              setImportingSchedule(true);
              try {
                const result = await importSchedule(schedulePlan);
                toast(
                  `Расписание: предметов ${result.subjectsCreated}, групп ${result.groupsCreated}, занятий ${result.activities}, пропущено ${result.skipped}`,
                );
                setSchedulePlan(null);
                setSchedule(null);
              } catch {
                toast('Не удалось импортировать расписание', 'danger');
              } finally {
                setImportingSchedule(false);
              }
            }}
          >
            {importingSchedule ? 'Создаём занятия…' : 'Импортировать'}
          </Button>
        }
      >
        {schedulePlan ? (
          <div className="space-y-5">
            <Field label="Начало учебного года" hint="Даты ДД.ММ из августа–декабря получат этот год, из января–июля — следующий.">
              <Input
                type="number"
                inputMode="numeric"
                value={scheduleYear}
                onChange={(event) => {
                  const value = event.target.value;
                  setScheduleYear(value);
                  if (!schedule) return;
                  try {
                    setSchedulePlan(parseScheduleJson(schedule.text, Number(value) || defaultStartYear()));
                  } catch {
                    setSchedulePlan(null);
                  }
                }}
              />
            </Field>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Count label="предметы" value={schedulePlan.subjects.length} />
              <Count label="группы" value={schedulePlan.groups.length} />
              <Count label="занятия" value={schedulePlan.entries.length} />
            </div>
            {schedulePlan.range ? (
              <p className="text-[12.5px] text-dim">
                {formatDate(schedulePlan.range.from)} — {formatDate(schedulePlan.range.to)}
              </p>
            ) : null}
            <div className="space-y-1.5 text-[12px] leading-relaxed text-faint">
              <p>Предметы: {schedulePlan.subjects.join(', ') || '—'}</p>
              <p>Группы: {schedulePlan.groups.join(', ') || '—'}</p>
              <p>
                Лабораторные получат по две подгруппы и чередование 1 → 2; студентов нужно добавить отдельно.
              </p>
              {schedulePlan.skipped ? <p>Пропущено строк: {schedulePlan.skipped}</p> : null}
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={studentsPasteOpen}
        onClose={() => {
          setStudentsPasteOpen(false);
          setStudentsError(null);
        }}
        title="Вставить студентов"
        description="JSON с группами и подгруппами: groups[].students или плоский список."
        footer={
          <Button full size="lg" disabled={!studentsPaste.trim()} onClick={parseStudentsPaste}>
            Проверить и продолжить
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="JSON студентов" hint="Можно вставить файл целиком.">
            <Textarea
              value={studentsPaste}
              onChange={(event) => {
                setStudentsPaste(event.target.value);
                setStudentsError(null);
              }}
              rows={10}
              spellCheck={false}
              placeholder={'{\n  "groups": [\n    {\n      "name": "ПИ-21",\n      "students": [\n        { "name": "Иванов Иван", "subgroup": 1 }\n      ]\n    }\n  ]\n}'}
              className="font-mono text-[12px]"
            />
          </Field>
          {studentsError ? <p className="text-[12px] text-danger">{studentsError}</p> : null}
          <button
            type="button"
            onClick={() => void downloadStudentsExample()}
            className="text-[12.5px] text-clay underline-offset-2 hover:underline focus-ring"
          >
            Скачать пример JSON
          </button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(studentsPlan)}
        onClose={() => {
          setStudentsPlan(null);
          setStudentsFileName('');
        }}
        title="Импорт студентов"
        description={studentsFileName}
        footer={
          <Button
            full
            size="lg"
            disabled={importingStudents || !studentsPlan?.entries.length}
            onClick={async () => {
              if (!studentsPlan) return;
              setImportingStudents(true);
              try {
                const result = await importStudents(studentsPlan);
                toast(
                  `Группы: ${result.memberships} студентов, новых ${result.studentsCreated}; зачислено ${result.enrolled}`,
                );
                setStudentsPlan(null);
                setStudentsFileName('');
              } catch {
                toast('Не удалось импортировать студентов', 'danger');
              } finally {
                setImportingStudents(false);
              }
            }}
          >
            {importingStudents ? 'Импортируем…' : 'Импортировать студентов'}
          </Button>
        }
      >
        {studentsPlan ? (
          <div className="space-y-5">
            {studentsPlan.subjects.length ? (
              <div>
                <p className="text-[12px] text-faint">Предметы из JSON</p>
                <div className="mt-1.5 space-y-1.5">
                  {studentsPlan.subjects.map((name) => {
                    const exists = snapshot.subjects.some(
                      (subject) => !subject.deletedAt && subject.name.toLowerCase() === name.toLowerCase(),
                    );
                    return (
                      <div key={name} className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-[14px] text-ink">{name}</p>
                        <Badge tone={exists ? 'success' : 'neutral'}>
                          {exists ? 'найден' : 'будет создан'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-elevated px-3.5 py-2.5 text-[12px] leading-snug text-dim">
                Предметы не указаны: студенты попадут только в состав групп. Зачислить группу в предметы
                можно на её экране.
              </p>
            )}

            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Count label="группы" value={studentsPlan.groups.length} />
              <Count label="студенты" value={studentsPlan.entries.length} />
              <Count label="предметы" value={studentsPlan.subjects.length} />
            </div>

            <div className="space-y-2">
              {studentsPlan.groups.map((group) => {
                const rows = studentsPlan.entries.filter((entry) => entry.group === group);
                const indexes = [...new Set(rows.map((row) => row.subgroup).filter((value) => value != null))];
                return (
                  <div key={group} className="rounded-xl border border-line px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13.5px] font-medium text-ink">{group}</p>
                      <p className="tnum text-[12px] text-dim">{rows.length}</p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-faint">
                      {indexes.length ? `подгруппы: ${indexes.sort().join(', ')}` : 'без подгрупп'}
                    </p>
                  </div>
                );
              })}
            </div>

            {studentsPlan.skipped ? (
              <p className="text-[12px] text-warn">Пропущено строк: {studentsPlan.skipped}</p>
            ) : null}
            <p className="text-[12px] leading-relaxed text-faint">
              Студенты добавляются в состав групп; если указаны предметы — сразу зачисляются в них.
              Существующие находятся по имени, оценки и посещаемость не меняются.
            </p>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="Импорт бэкапа"
        description={pending ? `${pending.name} · ${formatDate(pending.backup.exportedAt.slice(0, 10))}` : undefined}
        footer={
          <Button
            full
            size="lg"
            disabled={importing}
            onClick={async () => {
              if (!pending) return;
              setImporting(true);
              try {
                const result = await importBackup(pending.backup, mode);
                toast(
                  `Импорт: добавлено ${result.added}, обновлено ${result.updated}, пропущено ${result.skipped}`,
                );
                setPending(null);
              } catch {
                toast('Не удалось импортировать бэкап', 'danger');
              } finally {
                setImporting(false);
              }
            }}
          >
            {importing ? 'Импортируем…' : mode === 'replace' ? 'Заменить все данные' : 'Объединить данные'}
          </Button>
        }
      >
        {pending ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Count label="предметы" value={pending.summary.subjects} />
              <Count label="студенты" value={pending.summary.students} />
              <Count label="занятия" value={pending.summary.activities} />
              <Count label="сессии" value={pending.summary.sessions} />
              <Count label="оценки" value={pending.summary.grades} />
              <Count label="явки" value={pending.summary.attendance} />
            </div>
            <Field label="Режим импорта">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'merge', label: 'Объединить' },
                  { value: 'replace', label: 'Заменить' },
                ]}
              />
            </Field>
            <p className="text-[12px] leading-relaxed text-dim">
              {mode === 'merge'
                ? 'Совпадающие по id записи обновятся, только если в файле более новый updatedAt. Остальные данные останутся.'
                : 'Текущие данные будут полностью удалены и заменены содержимым файла. Действие необратимо.'}
            </p>
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="tnum text-[20px] font-medium leading-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-faint">{label}</p>
    </div>
  );
}
