import { addDays, todayIso } from '../lib/date';
import { db } from './db';
import {
  createActivity,
  createGroup,
  createSession,
  createStudent,
  createSubject,
  enrollStudent,
  ensureSubgroups,
  setAttendance,
  setGrade,
} from './repo';
import type { ID } from './types';

/** Детерминированный генератор — демо-данные одинаковы при каждом запуске. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  'Абрамова Ирина',
  'Андреев Пётр',
  'Белых Мария',
  'Богданов Артём',
  'Васильев Никита',
  'Волкова Дарья',
  'Гаврилов Сергей',
  'Гончарова Юлия',
  'Дементьев Олег',
  'Егорова Полина',
  'Ермаков Владислав',
  'Жукова Анастасия',
  'Захаров Максим',
  'Зимина Ксения',
  'Иванов Алексей',
  'Киселёва Вера',
  'Ковалёв Дмитрий',
  'Козлова Елена',
  'Королёв Тимур',
  'Кузнецова Ольга',
  'Лебедев Роман',
  'Логинова Софья',
  'Максимов Илья',
  'Мельникова Анна',
  'Миронов Глеб',
  'Морозова Татьяна',
  'Новиков Андрей',
  'Орлова Валерия',
  'Павлов Кирилл',
  'Петрова Марина',
  'Попов Егор',
  'Романова Дина',
  'Савельев Игорь',
  'Семёнова Алиса',
  'Смирнов Данил',
  'Соколова Наталья',
  'Тарасов Юрий',
  'Тихонова Варвара',
  'Фёдоров Степан',
  'Царёва Людмила',
  'Чернов Виктор',
  'Шилова Екатерина',
];

interface SeedGroupOptions {
  subjectId: ID;
  groupId: ID;
  studentIds: ID[];
  subgroups: ID[];
}

async function enrollAll(options: SeedGroupOptions) {
  for (let i = 0; i < options.studentIds.length; i++) {
    const subgroupId = options.subgroups.length
      ? options.subgroups[i % options.subgroups.length]
      : null;
    await enrollStudent({
      subjectId: options.subjectId,
      groupId: options.groupId,
      studentId: options.studentIds[i],
      subgroupId,
    });
  }
}

async function gradeSession(input: {
  subjectId: ID;
  activityId: ID;
  sessionId: ID;
  studentIds: ID[];
  random: () => number;
  maxScore: number;
  skipRate: number;
}) {
  for (const studentId of input.studentIds) {
    if (input.random() < input.skipRate) continue;
    const present = input.random() > 0.08;
    await setAttendance({ subjectId: input.subjectId, sessionId: input.sessionId, studentId, present });
    if (!present) continue;
    const factor = 0.45 + input.random() * 0.55;
    const score = Math.round(input.maxScore * factor);
    await setGrade({
      subjectId: input.subjectId,
      activityId: input.activityId,
      sessionId: input.sessionId,
      studentId,
      score,
    });
  }
}

/**
 * Демонстрационный набор: два предмета, две группы, подгруппы, сессии в прошлом
 * (с оценками и посещаемостью) и в будущем (без оценок), просроченные дедлайны.
 * Все записи создаются в одной транзакции — UI обновляется один раз.
 */
export async function seedDemoData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.students,
      db.groups,
      db.groupMembers,
      db.subjects,
      db.subgroups,
      db.enrollments,
      db.activities,
      db.sessions,
      db.grades,
      db.attendance,
    ],
    async () => {
      await buildDemoData();
    },
  );
}

async function buildDemoData(): Promise<void> {
  const random = mulberry32(20260301);
  const today = todayIso();

  const students: ID[] = [];
  for (const name of NAMES) {
    const student = await createStudent(name);
    students.push(student.id);
  }

  const groupA = await createGroup('ПИ-21');
  const groupB = await createGroup('ПИ-22');
  const groupAStudents = students.slice(0, 22);
  const groupBStudents = students.slice(22, 42);

  // ----------------------------- Веб-разработка -----------------------------
  const web = await createSubject({
    name: 'Веб-разработка',
    scaleMax: 100,
    passThreshold: 51,
    enabledTypes: ['lecture', 'practice', 'lab'],
  });
  const webSubgroups = await ensureSubgroups(web.id, groupA.id, 2);
  await enrollAll({
    subjectId: web.id,
    groupId: groupA.id,
    studentIds: groupAStudents,
    subgroups: webSubgroups.map((s) => s.id),
  });

  const lab1 = await createActivity({ subjectId: web.id, type: 'lab', title: 'Лабораторная 1', weight: 2 });
  const lab2 = await createActivity({ subjectId: web.id, type: 'lab', title: 'Лабораторная 2', weight: 2 });
  const practice1 = await createActivity({ subjectId: web.id, type: 'practice', title: 'Практика 1' });
  const practice2 = await createActivity({ subjectId: web.id, type: 'practice', title: 'Практика 2' });
  const practice3 = await createActivity({ subjectId: web.id, type: 'practice', title: 'Практика 3' });
  const lecture1 = await createActivity({ subjectId: web.id, type: 'lecture', title: 'Лекция 1' });
  const lecture2 = await createActivity({ subjectId: web.id, type: 'lecture', title: 'Лекция 2' });

  const [sg1, sg2] = webSubgroups;
  const sg1Students = groupAStudents.filter((_, i) => i % 2 === 0);
  const sg2Students = groupAStudents.filter((_, i) => i % 2 === 1);

  const makeLabSessions = async (activityId: ID, firstDate: string, secondDate: string) => {
    const first = await createSession({
      subjectId: web.id,
      activityId,
      groupId: groupA.id,
      subgroupId: sg1.id,
      date: firstDate,
    });
    const second = await createSession({
      subjectId: web.id,
      activityId,
      groupId: groupA.id,
      subgroupId: sg2.id,
      date: secondDate,
    });
    return { first, second };
  };

  const lab1Sessions = await makeLabSessions(lab1.id, addDays(today, -32), addDays(today, -30));
  const lab2Sessions = await makeLabSessions(lab2.id, addDays(today, -16), addDays(today, -14));

  await gradeSession({
    subjectId: web.id,
    activityId: lab1.id,
    sessionId: lab1Sessions.first.id,
    studentIds: sg1Students,
    random,
    maxScore: 100,
    skipRate: 0.05,
  });
  await gradeSession({
    subjectId: web.id,
    activityId: lab1.id,
    sessionId: lab1Sessions.second.id,
    studentIds: sg2Students,
    random,
    maxScore: 100,
    skipRate: 0.1,
  });
  await gradeSession({
    subjectId: web.id,
    activityId: lab2.id,
    sessionId: lab2Sessions.first.id,
    studentIds: sg1Students,
    random,
    maxScore: 100,
    skipRate: 0.15,
  });
  await gradeSession({
    subjectId: web.id,
    activityId: lab2.id,
    sessionId: lab2Sessions.second.id,
    studentIds: sg2Students,
    random,
    maxScore: 100,
    skipRate: 0,
  });

  const practiceDates: [ID, string, number][] = [
    [practice1.id, addDays(today, -24), 0.1],
    [practice2.id, addDays(today, -10), 0.2],
    [practice3.id, addDays(today, 7), 0.6],
  ];
  for (const [activityId, date, skipRate] of practiceDates) {
    const session = await createSession({
      subjectId: web.id,
      activityId,
      groupId: groupA.id,
      subgroupId: null,
      date,
    });
    if (date <= today) {
      await gradeSession({
        subjectId: web.id,
        activityId,
        sessionId: session.id,
        studentIds: groupAStudents,
        random,
        maxScore: 100,
        skipRate,
      });
    }
  }

  const lectureSessions: [ID, string, boolean][] = [
    [lecture1.id, addDays(today, -34), true],
    [lecture2.id, addDays(today, -3), true],
    [lecture2.id, addDays(today, 11), false],
  ];
  for (const [activityId, date, graded] of lectureSessions) {
    const session = await createSession({
      subjectId: web.id,
      activityId,
      groupId: groupA.id,
      subgroupId: null,
      date,
    });
    if (graded) {
      await gradeSession({
        subjectId: web.id,
        activityId,
        sessionId: session.id,
        studentIds: groupAStudents,
        random,
        maxScore: 100,
        skipRate: 0.15,
      });
    }
  }

  // ------------------------------- Базы данных -------------------------------
  const dbSubject = await createSubject({
    name: 'Базы данных',
    scaleMax: 100,
    passThreshold: 51,
    enabledTypes: ['lecture', 'practice', 'lab'],
  });
  const dbSubgroups = await ensureSubgroups(dbSubject.id, groupB.id, 2);
  await enrollAll({
    subjectId: dbSubject.id,
    groupId: groupB.id,
    studentIds: groupBStudents,
    subgroups: dbSubgroups.map((s) => s.id),
  });

  const sqlLab = await createActivity({ subjectId: dbSubject.id, type: 'lab', title: 'Лабораторная 1', weight: 2 });
  const sqlPractice = await createActivity({ subjectId: dbSubject.id, type: 'practice', title: 'Практика 1' });
  const sqlLecture = await createActivity({ subjectId: dbSubject.id, type: 'lecture', title: 'Лекция 1' });

  const dbSg1Students = groupBStudents.filter((_, i) => i % 2 === 0);
  const dbSg2Students = groupBStudents.filter((_, i) => i % 2 === 1);

  const sqlLabSession1 = await createSession({
    subjectId: dbSubject.id,
    activityId: sqlLab.id,
    groupId: groupB.id,
    subgroupId: dbSubgroups[0].id,
    date: addDays(today, -9),
  });
  const sqlLabSession2 = await createSession({
    subjectId: dbSubject.id,
    activityId: sqlLab.id,
    groupId: groupB.id,
    subgroupId: dbSubgroups[1].id,
    date: addDays(today, -7),
  });
  await gradeSession({
    subjectId: dbSubject.id,
    activityId: sqlLab.id,
    sessionId: sqlLabSession1.id,
    studentIds: dbSg1Students,
    random,
    maxScore: 100,
    skipRate: 0.1,
  });
  await gradeSession({
    subjectId: dbSubject.id,
    activityId: sqlLab.id,
    sessionId: sqlLabSession2.id,
    studentIds: dbSg2Students,
    random,
    maxScore: 100,
    skipRate: 0.2,
  });

  const sqlPracticeSession = await createSession({
    subjectId: dbSubject.id,
    activityId: sqlPractice.id,
    groupId: groupB.id,
    subgroupId: null,
    date: addDays(today, -6),
  });
  await gradeSession({
    subjectId: dbSubject.id,
    activityId: sqlPractice.id,
    sessionId: sqlPracticeSession.id,
    studentIds: groupBStudents,
    random,
    maxScore: 100,
    skipRate: 0.3,
  });

  await createSession({
    subjectId: dbSubject.id,
    activityId: sqlLecture.id,
    groupId: groupB.id,
    subgroupId: null,
    date: addDays(today, 5),
  });
}
