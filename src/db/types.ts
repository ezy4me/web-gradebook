/**
 * Доменные типы web-gradebook.
 *
 * Все сущности — «локально-первичные»: источник истины для UI — IndexedDB (Dexie).
 * Каждая запись содержит метаданные синхронизации (`createdAt`, `updatedAt`, `deletedAt`),
 * удаление — только soft-delete. Те же поля один-в-один маппятся на таблицы Supabase
 * (см. docs/ARCHITECTURE.md, supabase/schema.sql) и на drivestash-сторы.
 */

export type ID = string;

/** Виды занятий. Подгруппы применяются только к лабораторным. */
export type ActivityType = 'lecture' | 'practice' | 'lab';

export const ACTIVITY_TYPES: ActivityType[] = ['lecture', 'practice', 'lab'];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  lecture: 'Лекция',
  practice: 'Практика',
  lab: 'Лабораторная',
};

export const ACTIVITY_TYPE_LABEL_PLURAL: Record<ActivityType, string> = {
  lecture: 'Лекции',
  practice: 'Практики',
  lab: 'Лабораторные',
};

/** Тип шкалы предмета. */
export type ScaleKind = 'points' | 'pass-fail';

export interface SyncMeta {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Предмет (курс). */
export interface Subject extends SyncMeta {
  id: ID;
  name: string;
  /** Максимальный балл шкалы предмета по умолчанию (0–100, 0–10 и т.п.). */
  scaleMax: number;
  /** Порог «сдал» в процентах от максимума занятия. */
  passThreshold: number;
  scaleKind: ScaleKind;
  /** Какие виды занятий используются в предмете. */
  enabledTypes: ActivityType[];
  /** Веса видов занятий по умолчанию (лабораторные значимее). */
  typeWeights: Record<ActivityType, number>;
  /** Архив: предмет скрыт из активного списка, данные сохраняются. */
  archivedAt: string | null;
  comment: string;
}

/** Учебная группа, например «ПИ-21». Сущность глобальная: одна группа может вестись в разных предметах. */
export interface Group extends SyncMeta {
  id: ID;
  name: string;
}

/** Состав группы, не зависящий от предмета. */
export interface GroupMember extends SyncMeta {
  id: ID;
  groupId: ID;
  studentId: ID;
}

/** Подгруппа внутри группы в рамках конкретного предмета (только для лабораторных). */
export interface Subgroup extends SyncMeta {
  id: ID;
  subjectId: ID;
  groupId: ID;
  /** Номер подгруппы: 1, 2, … — задаёт порядок чередования по датам. */
  index: number;
  name: string;
}

/** Студент — глобальная сущность; баллы всегда раздельные по предметам. */
export interface Student extends SyncMeta {
  id: ID;
  name: string;
  comment: string;
}

/** Зачисление: связь «студент × предмет × группа × подгруппа». */
export interface Enrollment extends SyncMeta {
  id: ID;
  subjectId: ID;
  studentId: ID;
  groupId: ID;
  /** null — без подгруппы (лекции/практики подгрупп не имеют). */
  subgroupId: ID | null;
}

/** Занятие внутри предмета: «Лаба 1», «Практика 3». */
export interface Activity extends SyncMeta {
  id: ID;
  subjectId: ID;
  type: ActivityType;
  title: string;
  /** Порядок сортировки внутри предмета. */
  order: number;
  /** Максимальный балл занятия. 0 — наследовать шкалу предмета. */
  maxScore: number;
  /** Вес занятия. null — наследовать вес вида занятия из предмета. */
  weight: number | null;
  /** Ручной дедлайн (YYYY-MM-DD). null — вычисляется по следующей сессии. */
  deadline: string | null;
  /** Применять чередование подгрупп при генерации сессий (только lab). */
  autoRotate: boolean;
}

/** Проведение занятия в конкретную дату. Для лабораторных обязательна подгруппа. */
export interface ActivitySession extends SyncMeta {
  id: ID;
  subjectId: ID;
  activityId: ID;
  /** Группа, для которой проводится сессия. Для лабораторных выводится из подгруппы. */
  groupId: ID;
  /** null — вся группа (лекции/практики). */
  subgroupId: ID | null;
  /** Дата сессии, YYYY-MM-DD. */
  date: string;
  /** Ручное переопределение дедлайна сессии. */
  deadline: string | null;
  note: string;
}

/** Оценка студента за конкретную сессию. */
export interface Grade extends SyncMeta {
  id: ID;
  subjectId: ID;
  activityId: ID;
  sessionId: ID;
  studentId: ID;
  /** null — оценка ещё не выставлена (запись может нести только комментарий). */
  score: number | null;
  comment: string;
}

/** Посещаемость студента на конкретной сессии. */
export interface Attendance extends SyncMeta {
  id: ID;
  subjectId: ID;
  sessionId: ID;
  studentId: ID;
  present: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'system';

/** Настройки приложения. Одна запись с id = 'app'. Не экспортируется в бэкап. */
export interface AppSettings {
  id: 'app';
  theme: ThemeMode;
  /** SHA-256 от salt + PIN. null — PIN не задан. */
  pinHash: string | null;
  pinSalt: string | null;
  /** Автоблокировка после простоя, минуты. */
  autoLockMinutes: number;
  /** Показывать названия предметов инициалами: «Веб-разработка» → «ВР». */
  shortSubjectNames: boolean;
  lastSubjectId: ID | null;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  theme: 'system',
  pinHash: null,
  pinSalt: null,
  autoLockMinutes: 5,
  shortSubjectNames: false,
  lastSubjectId: null,
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_TYPE_WEIGHTS: Record<ActivityType, number> = {
  lecture: 0,
  practice: 1,
  lab: 2,
};

export const DEFAULT_SUBJECT: Omit<Subject, 'id' | 'name' | 'createdAt' | 'updatedAt'> = {
  scaleMax: 100,
  passThreshold: 51,
  scaleKind: 'points',
  enabledTypes: ['lecture', 'practice', 'lab'],
  typeWeights: { ...DEFAULT_TYPE_WEIGHTS },
  archivedAt: null,
  deletedAt: null,
  comment: '',
};

export interface BackupFile {
  format: 'web-gradebook-backup';
  version: 1 | 2;
  exportedAt: string;
  data: {
    subjects: Subject[];
    groups: Group[];
    groupMembers?: GroupMember[];
    subgroups: Subgroup[];
    students: Student[];
    enrollments: Enrollment[];
    activities: Activity[];
    sessions: ActivitySession[];
    grades: Grade[];
    attendance: Attendance[];
  };
}
