import { db } from './db';
import {
  DEFAULT_SUBJECT,
  DEFAULT_TYPE_WEIGHTS,
  type Activity,
  type ActivitySession,
  type ActivityType,
  type Attendance,
  type Enrollment,
  type Grade,
  type Group,
  type ID,
  type Student,
  type Subject,
  type Subgroup,
} from './types';
import { newId, nowIso } from '../lib/date';

const meta = () => ({ createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null });

function touch(): { updatedAt: string } {
  return { updatedAt: nowIso() };
}

/* ------------------------------- Предметы ------------------------------- */

export async function createSubject(input: {
  name: string;
  scaleMax?: number;
  passThreshold?: number;
  scaleKind?: Subject['scaleKind'];
  enabledTypes?: ActivityType[];
  typeWeights?: Record<ActivityType, number>;
}): Promise<Subject> {
  const subject: Subject = {
    ...DEFAULT_SUBJECT,
    ...meta(),
    id: newId(),
    name: input.name.trim() || 'Новый предмет',
    scaleMax: input.scaleMax ?? DEFAULT_SUBJECT.scaleMax,
    passThreshold: input.passThreshold ?? DEFAULT_SUBJECT.passThreshold,
    scaleKind: input.scaleKind ?? DEFAULT_SUBJECT.scaleKind,
    enabledTypes: input.enabledTypes ?? DEFAULT_SUBJECT.enabledTypes,
    typeWeights: input.typeWeights ?? { ...DEFAULT_TYPE_WEIGHTS },
  };
  await db.subjects.add(subject);
  return subject;
}

export async function updateSubject(id: ID, patch: Partial<Omit<Subject, 'id' | 'createdAt'>>): Promise<void> {
  await db.subjects.update(id, { ...patch, ...touch() });
}

export async function setSubjectArchived(id: ID, archived: boolean): Promise<void> {
  await db.subjects.update(id, {
    archivedAt: archived ? nowIso() : null,
    ...touch(),
  });
}

/** Soft-delete предмета вместе со всеми дочерними сущностями. */
export async function deleteSubject(id: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction(
    'rw',
    [db.subjects, db.activities, db.sessions, db.grades, db.attendance, db.enrollments, db.subgroups],
    async () => {
      const patch = { deletedAt: stamp, updatedAt: stamp };
      await db.subjects.update(id, patch);
      await db.activities.where('subjectId').equals(id).modify(patch);
      await db.sessions.where('subjectId').equals(id).modify(patch);
      await db.grades.where('subjectId').equals(id).modify(patch);
      await db.attendance.where('subjectId').equals(id).modify(patch);
      await db.enrollments.where('subjectId').equals(id).modify(patch);
      await db.subgroups.where('subjectId').equals(id).modify(patch);
    },
  );
}

/* -------------------------------- Группы -------------------------------- */

export async function createGroup(name: string): Promise<Group> {
  const group: Group = { ...meta(), id: newId(), name: name.trim() || 'Новая группа' };
  await db.groups.add(group);
  return group;
}

export async function findOrCreateGroup(name: string): Promise<Group> {
  const trimmed = name.trim();
  const existing = await db.groups.filter((g) => !g.deletedAt && g.name.toLowerCase() === trimmed.toLowerCase()).first();
  if (existing) return existing;
  return createGroup(trimmed);
}

export async function updateGroup(id: ID, name: string): Promise<void> {
  await db.groups.update(id, { name: name.trim(), ...touch() });
}

export async function ensureSubgroups(
  subjectId: ID,
  groupId: ID,
  count: number,
): Promise<Subgroup[]> {
  const existing = await db.subgroups
    .where('[subjectId+groupId]')
    .equals([subjectId, groupId])
    .toArray();
  const alive = existing.filter((s) => !s.deletedAt).sort((a, b) => a.index - b.index);
  const result = [...alive];
  for (let index = 1; index <= count; index++) {
    if (result.some((s) => s.index === index)) continue;
    const subgroup: Subgroup = {
      ...meta(),
      id: newId(),
      subjectId,
      groupId,
      index,
      name: `Подгруппа ${index}`,
    };
    await db.subgroups.add(subgroup);
    result.push(subgroup);
  }
  return result.sort((a, b) => a.index - b.index);
}

export async function renameSubgroup(id: ID, name: string): Promise<void> {
  await db.subgroups.update(id, { name: name.trim(), ...touch() });
}

/* ------------------------------- Студенты ------------------------------- */

export async function createStudent(name: string, comment = ''): Promise<Student> {
  const student: Student = { ...meta(), id: newId(), name: name.trim() || 'Без имени', comment };
  await db.students.add(student);
  return student;
}

export async function updateStudent(id: ID, patch: Partial<Pick<Student, 'name' | 'comment'>>): Promise<void> {
  await db.students.update(id, { ...patch, ...touch() });
}

export async function deleteStudent(id: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction(
    'rw',
    [db.students, db.groupMembers, db.enrollments, db.grades, db.attendance],
    async () => {
      await db.students.update(id, { deletedAt: stamp, updatedAt: stamp });
      await db.groupMembers.where('studentId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
      await db.enrollments.where('studentId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
      await db.grades.where('studentId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
      await db.attendance.where('studentId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
    },
  );
}

/* ------------------------------ Состав групп --------------------------- */

/** Служебная запись состава без автоматического зачисления. */
async function upsertGroupMember(groupId: ID, studentId: ID): Promise<void> {
  const existing = await db.groupMembers
    .where('[groupId+studentId]')
    .equals([groupId, studentId])
    .first();
  if (existing) {
    if (existing.deletedAt) {
      await db.groupMembers.update(existing.id, { deletedAt: null, ...touch() });
    }
    return;
  }
  await db.groupMembers.add({
    ...meta(),
    id: newId(),
    groupId,
    studentId,
  });
}

/** Добавить студента в группу и автоматически зачислить во все её предметы. */
export async function addStudentToGroup(groupId: ID, studentId: ID): Promise<number> {
  await upsertGroupMember(groupId, studentId);

  const subjectIds = new Set<string>();
  const subgroups = await db.subgroups
    .where('groupId')
    .equals(groupId)
    .filter((subgroup) => !subgroup.deletedAt)
    .toArray();
  for (const subgroup of subgroups) subjectIds.add(subgroup.subjectId);
  const enrollments = await db.enrollments
    .where('groupId')
    .equals(groupId)
    .filter((enrollment) => !enrollment.deletedAt)
    .toArray();
  for (const enrollment of enrollments) subjectIds.add(enrollment.subjectId);
  const sessions = await db.sessions
    .where('groupId')
    .equals(groupId)
    .filter((session) => !session.deletedAt)
    .toArray();
  for (const session of sessions) subjectIds.add(session.subjectId);

  let enrolled = 0;
  for (const subjectId of subjectIds) {
    const subject = await db.subjects.get(subjectId);
    if (!subject || subject.deletedAt) continue;
    const existing = await db.enrollments
      .where('[subjectId+studentId]')
      .equals([subjectId, studentId])
      .first();
    if (existing && !existing.deletedAt && existing.groupId === groupId) continue;
    const groupSubgroups = await ensureSubgroups(subjectId, groupId, 2);
    const count = await db.enrollments
      .where('[subjectId+groupId]')
      .equals([subjectId, groupId])
      .filter((enrollment) => !enrollment.deletedAt)
      .count();
    const subgroup = groupSubgroups[count % groupSubgroups.length] ?? null;
    await enrollStudent({ subjectId, groupId, studentId, subgroupId: subgroup?.id ?? null });
    enrolled += 1;
  }
  return enrolled;
}

/** Убрать студента из группы и из предметов этой группы. */
export async function removeGroupMember(groupId: ID, studentId: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', [db.groupMembers, db.enrollments], async () => {
    await db.groupMembers
      .where('[groupId+studentId]')
      .equals([groupId, studentId])
      .modify({ deletedAt: stamp, updatedAt: stamp });
    await db.enrollments
      .where('groupId')
      .equals(groupId)
      .filter((enrollment) => enrollment.studentId === studentId)
      .modify({ deletedAt: stamp, updatedAt: stamp });
  });
}

/** Зачислить всех участников группы в предмет; вернуть количество зачисленных. */
export async function enrollGroupToSubject(subjectId: ID, groupId: ID): Promise<number> {
  const group = await db.groups.get(groupId);
  if (!group || group.deletedAt) return 0;
  const subgroups = await ensureSubgroups(subjectId, groupId, 2);
  const members = await db.groupMembers
    .where('groupId')
    .equals(groupId)
    .filter((member) => !member.deletedAt)
    .toArray();
  const existing = await db.enrollments
    .where('[subjectId+groupId]')
    .equals([subjectId, groupId])
    .filter((enrollment) => !enrollment.deletedAt)
    .toArray();
  const enrolledIds = new Set(existing.map((enrollment) => enrollment.studentId));

  let added = 0;
  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    if (enrolledIds.has(member.studentId)) continue;
    const subgroup = subgroups[(existing.length + index) % subgroups.length] ?? null;
    await enrollStudent({
      subjectId,
      groupId,
      studentId: member.studentId,
      subgroupId: subgroup?.id ?? null,
    });
    added += 1;
  }
  return added;
}

/** Предметы, в которые зачислена группа (по подгруппам, зачислениям или сессиям). */
export async function groupSubjectIds(groupId: ID): Promise<ID[]> {
  const ids = new Set<ID>();
  const subgroups = await db.subgroups
    .where('groupId')
    .equals(groupId)
    .filter((subgroup) => !subgroup.deletedAt)
    .toArray();
  for (const subgroup of subgroups) ids.add(subgroup.subjectId);
  const enrollments = await db.enrollments
    .where('groupId')
    .equals(groupId)
    .filter((enrollment) => !enrollment.deletedAt)
    .toArray();
  for (const enrollment of enrollments) ids.add(enrollment.subjectId);
  const sessions = await db.sessions
    .where('groupId')
    .equals(groupId)
    .filter((session) => !session.deletedAt)
    .toArray();
  for (const session of sessions) ids.add(session.subjectId);
  return [...ids];
}

/* ----------------------------- Зачисления ------------------------------ */

export async function enrollStudent(input: {
  subjectId: ID;
  groupId: ID;
  studentId: ID;
  subgroupId: ID | null;
}): Promise<Enrollment> {
  await upsertGroupMember(input.groupId, input.studentId);
  const existing = await db.enrollments
    .where('[subjectId+studentId]')
    .equals([input.subjectId, input.studentId])
    .first();
  if (existing) {
    await db.enrollments.update(existing.id, {
      groupId: input.groupId,
      subgroupId: input.subgroupId,
      deletedAt: null,
      ...touch(),
    });
    return { ...existing, ...input, deletedAt: null };
  }
  const enrollment: Enrollment = { ...meta(), id: newId(), ...input };
  await db.enrollments.add(enrollment);
  return enrollment;
}

export async function updateEnrollment(
  id: ID,
  patch: Partial<Pick<Enrollment, 'groupId' | 'subgroupId'>>,
): Promise<void> {
  await db.enrollments.update(id, { ...patch, ...touch() });
}

export async function removeEnrollment(id: ID): Promise<void> {
  await db.enrollments.update(id, { deletedAt: nowIso(), ...touch() });
}

/* ------------------------------- Занятия ------------------------------- */

export async function createActivity(input: {
  subjectId: ID;
  type: ActivityType;
  title: string;
  maxScore?: number;
  weight?: number | null;
  deadline?: string | null;
  autoRotate?: boolean;
}): Promise<Activity> {
  const siblings = await db.activities.where('subjectId').equals(input.subjectId).toArray();
  const order = siblings.filter((a) => !a.deletedAt).length;
  const activity: Activity = {
    ...meta(),
    id: newId(),
    subjectId: input.subjectId,
    type: input.type,
    title: input.title.trim() || 'Новое занятие',
    order,
    maxScore: input.maxScore ?? 0,
    weight: input.weight ?? null,
    deadline: input.deadline ?? null,
    autoRotate: input.autoRotate ?? true,
  };
  await db.activities.add(activity);
  return activity;
}

export async function updateActivity(
  id: ID,
  patch: Partial<Omit<Activity, 'id' | 'subjectId' | 'createdAt'>>,
): Promise<void> {
  await db.activities.update(id, { ...patch, ...touch() });
}

export async function reorderActivities(orderedIds: ID[]): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', db.activities, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.activities.update(orderedIds[i], { order: i, updatedAt: stamp });
    }
  });
}

export async function deleteActivity(id: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', [db.activities, db.sessions, db.grades, db.attendance], async () => {
    const patch = { deletedAt: stamp, updatedAt: stamp };
    await db.activities.update(id, patch);
    const sessions = await db.sessions.where('activityId').equals(id).toArray();
    const sessionIds = new Set(sessions.map((s) => s.id));
    await db.sessions.where('activityId').equals(id).modify(patch);
    await db.grades.where('activityId').equals(id).modify(patch);
    if (sessionIds.size) {
      const attendance = await db.attendance.toArray();
      const affected = attendance.filter((a) => sessionIds.has(a.sessionId) && !a.deletedAt);
      for (const record of affected) {
        await db.attendance.update(record.id, patch);
      }
    }
  });
}

/* -------------------------------- Сессии -------------------------------- */

export async function createSession(input: {
  subjectId: ID;
  activityId: ID;
  groupId: ID;
  subgroupId: ID | null;
  date: string;
  deadline?: string | null;
  note?: string;
}): Promise<ActivitySession> {
  const session: ActivitySession = {
    ...meta(),
    id: newId(),
    subjectId: input.subjectId,
    activityId: input.activityId,
    groupId: input.groupId,
    subgroupId: input.subgroupId,
    date: input.date,
    deadline: input.deadline ?? null,
    note: input.note ?? '',
  };
  await db.sessions.add(session);
  return session;
}

export type SessionInput = Omit<ActivitySession, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function createSessionsBulk(items: SessionInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const stamp = nowIso();
  const records: ActivitySession[] = items.map((item) => ({
    ...item,
    id: newId(),
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }));
  await db.sessions.bulkAdd(records);
  return records.length;
}

export async function updateSession(
  id: ID,
  patch: Partial<Omit<ActivitySession, 'id' | 'subjectId' | 'activityId' | 'createdAt'>>,
): Promise<void> {
  await db.sessions.update(id, { ...patch, ...touch() });
}

export async function deleteSession(id: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', [db.sessions, db.grades, db.attendance], async () => {
    await db.sessions.update(id, { deletedAt: stamp, updatedAt: stamp });
    await db.grades.where('sessionId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
    await db.attendance.where('sessionId').equals(id).modify({ deletedAt: stamp, updatedAt: stamp });
  });
}

/* --------------------------- Оценки и явка ------------------------------ */

export async function setGrade(input: {
  subjectId: ID;
  activityId: ID;
  sessionId: ID;
  studentId: ID;
  score: number | null;
  comment?: string;
}): Promise<void> {
  const existing = await db.grades
    .where('[sessionId+studentId]')
    .equals([input.sessionId, input.studentId])
    .first();
  const comment = input.comment ?? existing?.comment ?? '';
  const empty = input.score == null && comment.trim() === '';
  if (existing) {
    if (empty) {
      if (!existing.deletedAt) {
        await db.grades.update(existing.id, { deletedAt: nowIso(), updatedAt: nowIso() });
      }
      return;
    }
    await db.grades.update(existing.id, {
      score: input.score,
      comment,
      deletedAt: null,
      ...touch(),
    });
    return;
  }
  if (empty) return;
  const grade: Grade = {
    ...meta(),
    id: newId(),
    subjectId: input.subjectId,
    activityId: input.activityId,
    sessionId: input.sessionId,
    studentId: input.studentId,
    score: input.score,
    comment,
  };
  await db.grades.add(grade);
}

export async function setGradeComment(
  input: Omit<Parameters<typeof setGrade>[0], 'score'>,
): Promise<void> {
  await setGrade({ ...input, score: null });
}

export async function setAttendance(input: {
  subjectId: ID;
  sessionId: ID;
  studentId: ID;
  present: boolean | null;
}): Promise<void> {
  const existing = await db.attendance
    .where('[sessionId+studentId]')
    .equals([input.sessionId, input.studentId])
    .first();
  if (input.present == null) {
    if (existing && !existing.deletedAt) {
      await db.attendance.update(existing.id, { deletedAt: nowIso(), updatedAt: nowIso() });
    }
    return;
  }
  if (existing) {
    await db.attendance.update(existing.id, {
      present: input.present,
      deletedAt: null,
      ...touch(),
    });
    return;
  }
  const record: Attendance = {
    ...meta(),
    id: newId(),
    subjectId: input.subjectId,
    sessionId: input.sessionId,
    studentId: input.studentId,
    present: input.present,
  };
  await db.attendance.add(record);
}

export async function markAllPresent(subjectId: ID, sessionId: ID, studentIds: ID[]): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', db.attendance, async () => {
    for (const studentId of studentIds) {
      const existing = await db.attendance
        .where('[sessionId+studentId]')
        .equals([sessionId, studentId])
        .first();
      if (existing) {
        await db.attendance.update(existing.id, { present: true, deletedAt: null, updatedAt: stamp });
      } else {
        await db.attendance.add({
          createdAt: stamp,
          updatedAt: stamp,
          deletedAt: null,
          id: newId(),
          subjectId,
          sessionId,
          studentId,
          present: true,
        });
      }
    }
  });
}

export async function markAllScores(input: {
  subjectId: ID;
  activityId: ID;
  sessionId: ID;
  studentIds: ID[];
  score: number;
}): Promise<void> {
  for (const studentId of input.studentIds) {
    await setGrade({
      subjectId: input.subjectId,
      activityId: input.activityId,
      sessionId: input.sessionId,
      studentId,
      score: input.score,
    });
  }
}

export async function clearSessionMarks(sessionId: ID): Promise<void> {
  const stamp = nowIso();
  await db.transaction('rw', [db.grades, db.attendance], async () => {
    await db.grades.where('sessionId').equals(sessionId).modify({ deletedAt: stamp, updatedAt: stamp });
    await db.attendance.where('sessionId').equals(sessionId).modify({ deletedAt: stamp, updatedAt: stamp });
  });
}
