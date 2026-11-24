import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { EmptyState, FullPageLoader, Progress, SectionTitle } from '../components/ui';
import { Icon } from '../components/icons';
import { WorkList, type WorkListItem } from '../components/WorkList';
import { useSnapshot } from '../db/hooks';
import { computeStudentProgress, formatPercent } from '../domain/grading';
import { studentActivityRows } from '../domain/studentWorks';
import { GRADE_CLASSES, gradeBand } from '../lib/grades';
import { countLabel } from '../lib/text';

export function StudentProfileScreen() {
  const { studentId } = useParams();
  const snapshot = useSnapshot();
  const navigate = useNavigate();

  const enrollmentRows = useMemo(() => {
    if (!snapshot || !studentId) return [];
    return snapshot.enrollments
      .filter((enrollment) => !enrollment.deletedAt && enrollment.studentId === studentId)
      .map((enrollment) => {
        const subject = snapshot.subjects.find(
          (candidate) => candidate.id === enrollment.subjectId && !candidate.deletedAt,
        );
        if (!subject) return null;
        const group = snapshot.groups.find((candidate) => candidate.id === enrollment.groupId);
        const progress = computeStudentProgress(snapshot, subject.id, studentId);
        return { enrollment, subject, group, progress };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => a.subject.name.localeCompare(b.subject.name, 'ru'));
  }, [snapshot, studentId]);

  const items = useMemo<WorkListItem[]>(() => {
    if (!snapshot) return [];
    const list: WorkListItem[] = [];
    for (const { enrollment, subject } of enrollmentRows) {
      const rows = studentActivityRows(
        snapshot,
        subject,
        enrollment.studentId,
        enrollment.groupId,
        enrollment.subgroupId,
      );
      for (const row of rows) list.push({ ...row, subject });
    }
    return list.sort((a, b) => {
      const left = a.session?.date ?? '';
      const right = b.session?.date ?? '';
      return right.localeCompare(left);
    });
  }, [snapshot, enrollmentRows]);

  if (!snapshot) {
    return (
      <Page title="Студент" back backTo="/groups">
        <FullPageLoader />
      </Page>
    );
  }

  const student = snapshot.students.find((item) => item.id === studentId && !item.deletedAt);
  if (!student) {
    return (
      <Page title="Студент" back backTo="/groups">
        <EmptyState icon="alert" title="Студент не найден" />
      </Page>
    );
  }

  const groupNames = [...new Set(enrollmentRows.map((row) => row.group?.name).filter(Boolean))];
  const averages = enrollmentRows
    .map((row) => row.progress.finalPercent)
    .filter((value): value is number => value != null);
  const average = averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
  const band = gradeBand(average);
  const tone = band ? GRADE_CLASSES[band.tone] : null;
  const totalSessions = enrollmentRows.reduce((sum, row) => sum + row.progress.attendanceSessions, 0);
  const totalPresent = enrollmentRows.reduce((sum, row) => sum + row.progress.present, 0);
  const attendance = totalSessions ? (totalPresent / totalSessions) * 100 : null;

  return (
    <Page
      title={student.name}
      subtitle={`${countLabel(enrollmentRows.length, 'предмет', 'предмета', 'предметов')}${
        groupNames.length ? ` · ${groupNames.join(', ')}` : ''
      }`}
      back
      backTo="/groups"
    >
      <div className="flex items-end justify-between border-b border-line pb-4">
        <div>
          <p className="text-[12px] text-faint">Средний по предметам</p>
          <p className={`display mt-1 text-[42px] leading-none ${tone ? tone.text : 'text-ink'}`}>
            {formatPercent(average)}
          </p>
          <p className="mt-1.5 text-[12px] text-faint">
            посещаемость {formatPercent(attendance)}
          </p>
        </div>
        {band ? (
          <span
            className={`tnum rounded-lg px-2.5 py-1 text-[18px] font-semibold ${tone?.soft} ${tone?.text}`}
          >
            {band.grade}
          </span>
        ) : null}
      </div>

      <SectionTitle>Предметы</SectionTitle>
      {enrollmentRows.length ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {enrollmentRows.map(({ subject, group, progress }, index) => {
            const subjectBand = gradeBand(progress.finalPercent);
            const subjectTone = subjectBand ? GRADE_CLASSES[subjectBand.tone] : null;
            return (
              <button
                key={subject.id}
                type="button"
                onClick={() => navigate(`/subject/${subject.id}/student/${student.id}`)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-ring ${
                  index > 0 ? 'border-t border-line' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{subject.name}</span>
                  <span className="mt-0.5 block text-[11.5px] text-faint">
                    {group?.name ?? 'группа'}
                    {progress.attendanceSessions
                      ? ` · был ${progress.present} из ${progress.attendanceSessions}`
                      : ''}
                  </span>
                  <span className="mt-2 block">
                    <Progress value={progress.finalPercent ?? 0} thin />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`tnum block text-[15px] font-semibold ${subjectTone ? subjectTone.text : 'text-ink'}`}>
                    {formatPercent(progress.finalPercent)}
                  </span>
                  {subjectBand && subject.scaleKind !== 'pass-fail' ? (
                    <span className={`tnum block text-[11px] ${subjectTone?.text}`}>
                      оценка {subjectBand.grade}
                    </span>
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
          title="Нет предметов"
          description="Студент пока не зачислен ни в один предмет."
          action={
            <button
              type="button"
              onClick={() => navigate('/groups')}
              className="rounded-xl bg-ink px-4 py-2.5 text-[13px] font-medium text-surface focus-ring"
            >
              К группам
            </button>
          }
        />
      )}

      <SectionTitle>Работы</SectionTitle>
      <WorkList items={items} onOpen={(id) => navigate(`/session/${id}`)} />
    </Page>
  );
}
