import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FullPageLoader,
  IconButton,
  SectionTitle,
  Sheet,
  Textarea,
  useToast,
} from '../components/ui';
import { useSnapshot } from '../db/hooks';
import { removeEnrollment, updateEnrollment, updateStudent } from '../db/repo';
import {
  computeStudentProgress,
  formatPercent,
  groupRanking,
  type Snapshot,
} from '../domain/grading';
import { studentActivityRows } from '../domain/studentWorks';
import { WorkList } from '../components/WorkList';
import { formatDateShort } from '../lib/date';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';
import { subgroupTone } from '../lib/subgroup';
import { ACTIVITY_TYPE_LABEL, type Student, type Subject } from '../db/types';

export function StudentScreen() {
  const { subjectId, studentId } = useParams();
  const snapshot = useSnapshot();
  const navigate = useNavigate();
  const toast = useToast();
  const [manageOpen, setManageOpen] = useState(false);

  const subject = snapshot?.subjects.find((s) => s.id === subjectId && !s.deletedAt);
  const student = snapshot?.students.find((s) => s.id === studentId && !s.deletedAt);
  const enrollment = snapshot?.enrollments.find(
    (e) => e.subjectId === subjectId && e.studentId === studentId && !e.deletedAt,
  );

  if (!snapshot) {
    return (
      <Page title="Студент" back>
        <FullPageLoader />
      </Page>
    );
  }

  if (!subject || !student || !enrollment) {
    return (
      <Page title="Студент" back backTo={subjectId ? `/subject/${subjectId}` : '/'}>
        <EmptyState icon="alert" title="Студент не найден в этом предмете" />
      </Page>
    );
  }

  const progress = computeStudentProgress(snapshot, subject.id, student.id);
  const ranking = groupRanking(snapshot, subject.id, enrollment.groupId);
  const rank = ranking.find((row) => row.student.id === student.id)?.rank ?? 0;
  const group = snapshot.groups.find((g) => g.id === enrollment.groupId);
  const subgroup = snapshot.subgroups.find((s) => s.id === enrollment.subgroupId);
  const tone = subgroupTone(subgroup?.index);
  const rows = studentActivityRows(
    snapshot,
    subject,
    student.id,
    enrollment.groupId,
    enrollment.subgroupId,
  ).map((row) => ({ ...row, subject }));

  const attendancePercent = progress.attendanceSessions
    ? (progress.present / progress.attendanceSessions) * 100
    : null;
  const band = gradeBand(progress.finalPercent);
  const bandClasses = band ? GRADE_CLASSES[band.tone] : null;
  const passTone =
    subject.scaleKind === 'pass-fail'
      ? (progress.finalPercent ?? 0) >= subject.passThreshold
        ? GRADE_CLASSES.grade5
        : GRADE_CLASSES.grade2
      : bandClasses;

  return (
    <Page
      title={student.name}
      subtitle={[group?.name, subgroup?.name].filter(Boolean).join(' · ') || 'без группы'}
      back
      backTo={`/subject/${subject.id}`}
      actions={<IconButton icon="edit" label="Изменить" onClick={() => setManageOpen(true)} />}
    >
      <div className="flex items-start justify-between border-b border-line pb-4">
        <div>
          <p className="text-[12px] text-faint">Итоговый балл</p>
          <p className={`display mt-1 text-[46px] leading-none ${passTone ? passTone.text : 'text-ink'}`}>
            {formatPercent(progress.finalPercent)}
          </p>
          <p className="mt-2 text-[12px] text-faint">порог предмета {subject.passThreshold}%</p>
        </div>
        <div className="mt-1 flex flex-col items-end gap-2">
          {band && subject.scaleKind !== 'pass-fail' ? (
            <span
              className={`tnum rounded-md px-2 py-0.5 text-[15px] font-semibold ${bandClasses?.soft} ${bandClasses?.text}`}
            >
              {band.grade}
            </span>
          ) : null}
          {rank > 0 ? <Badge tone="accent">{rank} место</Badge> : null}
          <Badge tone={progress.passed ? 'success' : progress.finalPercent == null ? 'neutral' : 'danger'}>
            {progress.passed ? 'сдал' : progress.finalPercent == null ? 'нет оценок' : 'не сдал'}
          </Badge>
          {subgroup ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-dim">
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {subgroup.name}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <Metric label="Средний по оценкам" value={formatPercent(progress.averagePercent)} />
        <Metric label="Заполнено" value={formatPercent(progress.completion)} />
        <Metric label="Посещаемость" value={formatPercent(attendancePercent)} />
        <Metric label="Оценок" value={`${progress.graded} / ${progress.total}`} />
        {progress.lectureSessions > 0 ? (
          <Metric label="Лекции" value={`${progress.lecturePresent} / ${progress.lectureSessions}`} />
        ) : null}
      </div>

      <SectionTitle>По видам занятий</SectionTitle>
      <div className="space-y-3">
        {(['lab', 'practice', 'lecture'] as const)
          .filter((type) => progress.byType[type].total > 0)
          .map((type) => {
            const lecture = type === 'lecture';
            const total = progress.byType[type].total;
            const percent = lecture
              ? total
                ? (progress.lecturePresent / total) * 100
                : 0
              : (progress.byType[type].finalPercent ?? 0);
            return (
              <div key={type}>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-dim">{ACTIVITY_TYPE_LABEL[type]}</span>
                  <span className="tnum text-ink">
                    {lecture ? `было ${progress.lecturePresent} из ${total}` : formatPercent(progress.byType[type].finalPercent)}
                    {!lecture ? (
                      <span className="ml-1.5 text-[11px] text-faint">
                        {progress.byType[type].graded}/{total}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div
                      className={`h-full rounded-full ${lecture ? 'bg-steel' : type === 'lab' ? 'bg-moss' : 'bg-clay'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        {progress.byType.lab.total === 0 &&
        progress.byType.practice.total === 0 &&
        progress.byType.lecture.total === 0 ? (
          <p className="text-[13px] text-faint">В предмете нет сессий для этого студента</p>
        ) : null}
      </div>

      {progress.series.length > 1 ? (
        <>
          <SectionTitle>Динамика</SectionTitle>
          <Sparkline points={progress.series} threshold={subject.passThreshold} />
        </>
      ) : null}

      <SectionTitle>Работы</SectionTitle>
      <WorkList items={rows} onOpen={(id) => navigate(`/session/${id}`)} />

      {student.comment.trim() ? (
        <p className="mt-4 border-l-2 border-line pl-3 text-[13px] leading-relaxed text-dim">{student.comment}</p>
      ) : null}

      <ManageStudentSheet
        key={student.id}
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        subject={subject}
        student={student}
        snapshot={snapshot}
        onRemoved={() => {
          toast('Студент снят с предмета');
          navigate(`/subject/${subject.id}`);
        }}
        onSaved={() => toast('Сохранено')}
      />
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-faint">{label}</p>
      <p className="tnum mt-0.5 text-[19px] font-medium text-ink">{value}</p>
    </div>
  );
}

function Sparkline({ points, threshold }: { points: { date: string; percent: number }[]; threshold: number }) {
  const width = 300;
  const height = 68;
  const pad = 4;
  const values = points.map((point) => point.percent);
  const min = Math.min(...values, threshold);
  const max = Math.max(...values, threshold);
  const span = Math.max(1, max - min);
  const coords = points.map((point, index) => {
    const x = pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.percent - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const path = coords.map((c, index) => `${index === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const thresholdY = height - pad - ((threshold - min) / span) * (height - pad * 2);

  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[68px] w-full text-clay" role="img" aria-label="Динамика балла">
        <line
          x1={pad}
          x2={width - pad}
          y1={thresholdY}
          y2={thresholdY}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.3}
        />
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, index) => (
          <circle key={index} cx={c.x} cy={c.y} r={2} fill="currentColor" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{formatDateShort(points[0].date)}</span>
        <span className="tnum text-dim">{formatPercent(points[points.length - 1].percent)}</span>
        <span>{formatDateShort(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

function ManageStudentSheet({
  open,
  onClose,
  subject,
  student,
  snapshot,
  onRemoved,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  subject: Subject;
  student: Student;
  snapshot: Snapshot;
  onRemoved: () => void;
  onSaved: () => void;
}) {
  const enrollment = snapshot.enrollments.find(
    (e) => e.subjectId === subject.id && e.studentId === student.id && !e.deletedAt,
  );
  const subgroups = snapshot.subgroups
    .filter((s) => s.subjectId === subject.id && s.groupId === enrollment?.groupId && !s.deletedAt)
    .sort((a, b) => a.index - b.index);
  const [name, setName] = useState(student.name);
  const [comment, setComment] = useState(student.comment);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Карточка студента"
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            full
            onClick={async () => {
              if (!enrollment) return;
              await removeEnrollment(enrollment.id);
              onRemoved();
            }}
          >
            Убрать из предмета
          </Button>
          <Button
            full
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              await updateStudent(student.id, { name: name.trim(), comment });
              setBusy(false);
              onSaved();
              onClose();
            }}
          >
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Имя">
          <Textarea value={name} onChange={(event) => setName(event.target.value)} rows={1} className="min-h-12" />
        </Field>
        <Field label="Заметка">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Общая заметка о студенте"
          />
        </Field>
        {subgroups.length > 1 && enrollment ? (
          <Field label="Подгруппа">
            <div className="flex gap-2">
              {subgroups.map((subgroup) => {
                const tone = subgroupTone(subgroup.index);
                const active = enrollment.subgroupId === subgroup.id;
                return (
                  <button
                    key={subgroup.id}
                    type="button"
                    onClick={async () => {
                      await updateEnrollment(enrollment.id, { subgroupId: subgroup.id });
                      onSaved();
                    }}
                    className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-[13px] focus-ring ${
                      active ? `border-transparent ${tone.badge} font-medium` : 'border-line text-dim'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    {subgroup.name}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}
        <p className="text-[12px] leading-relaxed text-faint">
          Удаление из предмета не удаляет студента из общей базы: оценки в других предметах сохраняются.
        </p>
      </div>
    </Sheet>
  );
}
