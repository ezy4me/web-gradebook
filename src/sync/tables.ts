/**
 * Маппинг локальных сторов Dexie на таблицы Supabase.
 * camelCase ↔ snake_case, `order` → `order_index`, `index` → `idx`,
 * `sessions` → `activity_sessions`, `groupMembers` → `group_members`.
 */

import type {
  Activity,
  ActivitySession,
  Attendance,
  Enrollment,
  Grade,
  Group,
  GroupMember,
  Student,
  Subject,
  Subgroup,
} from '../db/types';
import type { StoreName } from './dirty';

export type RemoteRow = Record<string, unknown>;

export interface TableSpec<T> {
  store: StoreName;
  /** Имя таблицы в Postgres. */
  table: string;
  toRemote: (row: T, userId: string) => RemoteRow;
  fromRemote: (row: RemoteRow) => T;
}

function iso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function text(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function number(value: unknown, fallback = 0): number {
  return numberOrNull(value) ?? fallback;
}

const baseToRemote = (row: { id: string; createdAt: string; updatedAt: string; deletedAt: string | null }, userId: string) => ({
  id: row.id,
  user_id: userId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
  deleted_at: row.deletedAt,
});

const baseFromRemote = (row: RemoteRow) => ({
  id: text(row.id),
  createdAt: iso(row.created_at) ?? '',
  updatedAt: iso(row.updated_at) ?? '',
  deletedAt: iso(row.deleted_at),
});

export const TABLES: TableSpec<unknown>[] = [
  {
    store: 'subjects',
    table: 'subjects',
    toRemote: (value, userId) => {
      const row = value as Subject;
      return {
        ...baseToRemote(row, userId),
        name: row.name,
        scale_max: row.scaleMax,
        pass_threshold: row.passThreshold,
        scale_kind: row.scaleKind,
        enabled_types: row.enabledTypes,
        type_weights: row.typeWeights,
        archived_at: row.archivedAt,
        comment: row.comment ?? '',
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        name: text(row.name),
        scaleMax: number(row.scale_max, 100),
        passThreshold: number(row.pass_threshold, 51),
        scaleKind: row.scale_kind === 'pass-fail' ? 'pass-fail' : 'points',
        enabledTypes: Array.isArray(row.enabled_types)
          ? (row.enabled_types as Subject['enabledTypes'])
          : ['lecture', 'practice', 'lab'],
        typeWeights: (row.type_weights as Subject['typeWeights']) ?? {
          lecture: 0,
          practice: 1,
          lab: 2,
        },
        archivedAt: iso(row.archived_at),
        comment: text(row.comment),
      }) as Subject,
  },
  {
    store: 'groups',
    table: 'groups',
    toRemote: (value, userId) => {
      const row = value as Group;
      return { ...baseToRemote(row, userId), name: row.name };
    },
    fromRemote: (row) => ({ ...baseFromRemote(row), name: text(row.name) }) as Group,
  },
  {
    store: 'groupMembers',
    table: 'group_members',
    toRemote: (value, userId) => {
      const row = value as GroupMember;
      return { ...baseToRemote(row, userId), group_id: row.groupId, student_id: row.studentId };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        groupId: text(row.group_id),
        studentId: text(row.student_id),
      }) as GroupMember,
  },
  {
    store: 'subgroups',
    table: 'subgroups',
    toRemote: (value, userId) => {
      const row = value as Subgroup;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        group_id: row.groupId,
        idx: row.index,
        name: row.name,
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        groupId: text(row.group_id),
        index: number(row.idx, 1),
        name: text(row.name),
      }) as Subgroup,
  },
  {
    store: 'students',
    table: 'students',
    toRemote: (value, userId) => {
      const row = value as Student;
      return { ...baseToRemote(row, userId), name: row.name, comment: row.comment ?? '' };
    },
    fromRemote: (row) =>
      ({ ...baseFromRemote(row), name: text(row.name), comment: text(row.comment) }) as Student,
  },
  {
    store: 'enrollments',
    table: 'enrollments',
    toRemote: (value, userId) => {
      const row = value as Enrollment;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        student_id: row.studentId,
        group_id: row.groupId,
        subgroup_id: row.subgroupId,
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        studentId: text(row.student_id),
        groupId: text(row.group_id),
        subgroupId: row.subgroup_id == null ? null : text(row.subgroup_id),
      }) as Enrollment,
  },
  {
    store: 'activities',
    table: 'activities',
    toRemote: (value, userId) => {
      const row = value as Activity;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        type: row.type,
        title: row.title,
        order_index: row.order,
        max_score: row.maxScore,
        weight: row.weight,
        deadline: row.deadline,
        auto_rotate: row.autoRotate,
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        type: row.type === 'lecture' || row.type === 'practice' ? row.type : 'lab',
        title: text(row.title),
        order: number(row.order_index),
        maxScore: number(row.max_score),
        weight: numberOrNull(row.weight),
        deadline: row.deadline == null ? null : String(row.deadline),
        autoRotate: Boolean(row.auto_rotate),
      }) as Activity,
  },
  {
    store: 'sessions',
    table: 'activity_sessions',
    toRemote: (value, userId) => {
      const row = value as ActivitySession;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        activity_id: row.activityId,
        group_id: row.groupId,
        subgroup_id: row.subgroupId,
        date: row.date,
        deadline: row.deadline,
        note: row.note ?? '',
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        activityId: text(row.activity_id),
        groupId: text(row.group_id),
        subgroupId: row.subgroup_id == null ? null : text(row.subgroup_id),
        date: String(row.date ?? '').slice(0, 10),
        deadline: row.deadline == null ? null : String(row.deadline).slice(0, 10),
        note: text(row.note),
      }) as ActivitySession,
  },
  {
    store: 'grades',
    table: 'grades',
    toRemote: (value, userId) => {
      const row = value as Grade;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        activity_id: row.activityId,
        session_id: row.sessionId,
        student_id: row.studentId,
        score: row.score,
        comment: row.comment ?? '',
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        activityId: text(row.activity_id),
        sessionId: text(row.session_id),
        studentId: text(row.student_id),
        score: numberOrNull(row.score),
        comment: text(row.comment),
      }) as Grade,
  },
  {
    store: 'attendance',
    table: 'attendance',
    toRemote: (value, userId) => {
      const row = value as Attendance;
      return {
        ...baseToRemote(row, userId),
        subject_id: row.subjectId,
        session_id: row.sessionId,
        student_id: row.studentId,
        present: row.present,
      };
    },
    fromRemote: (row) =>
      ({
        ...baseFromRemote(row),
        subjectId: text(row.subject_id),
        sessionId: text(row.session_id),
        studentId: text(row.student_id),
        present: Boolean(row.present),
      }) as Attendance,
  },
];

export function specFor(store: StoreName): TableSpec<unknown> {
  const found = TABLES.find((spec) => spec.store === store);
  if (!found) throw new Error(`Неизвестный стор: ${store}`);
  return found;
}
