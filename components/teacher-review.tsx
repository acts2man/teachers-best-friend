"use client";
import { useEffect, useRef, useState } from "react";
import { uprightPage } from "@/lib/image-prep";
import { uploadFile } from "@/lib/upload-client";
import { useSearchParams } from "next/navigation";
import { analyzeRequest } from "@/lib/analyze-client";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CheckCheck,
  Download,
  FileText,
  Flag,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Upload,
  Users,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { describeFailure, deleteUploads } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import {
  Action,
  Avatar,
  EmptyState,
  Pick,
  Pill,
  Score,
  SectionTitle,
  downloadText,
  printContent,
} from "./teacher-shared";
import {
  activeQuestions,
  applyGroupScore,
  autoGradedToConfirm,
  confirmResponses,
  creditLabel,
  CREDIT_LEVELS,
  setGroupErrorType,
  assignmentNextStep,
  forgetUploads,
  groupAnswers,
  parseAnswerKey,
  preparationGaps,
  releasedStudentUploads,
  responseFlag,
  gradebookCsv,
  reteachGroup,
  studentReport,
  studentReview,
  pointsForScore,
  withReteachGroup,
  type AnswerGroup,
} from "@/lib/teacher-workflow";
import { compareByLastName } from "@/lib/teacher-classes";
import { errorTypesFor } from "@/lib/error-types";
import { safePdfText } from "@/lib/pdf-text";
import type { Assessment, Student, StudentResponse } from "@/lib/teacher-types";
import { responseMatch } from "@/lib/teacher-metrics";
import { ClassScanPanel } from "./teacher-class-scan";
import { ScanCamera } from "./scan-camera";

/**
 * One student's actual work for this question, shown inside an answer group.
 *
 * The answer text alone -- "60" -- is not enough to decide partial credit; the
 * teacher needs to see how the student got there. Everyone in a group wrote the
 * same answer, so showing ONE student's page stands in for the rest (the
 * teacher assumes the others reached it the same way), and a tap cycles to a
 * different student when the first sample is unclear.
 *
 * The image is the name-removed body crop from studentUploadIds -- the same
 * page already reachable from "Original student work", never the name strip --
 * and it is shown with no student name, so the group stays about the work, not
 * whose it is. The grading pass returns no reliable per-question location, so
 * the whole page is shown rather than a wrong crop (cropping to the question is
 * a later decision): showing the right work matters more than a tight frame.
 *
 * It is shown large by default -- as wide as the answer group allows, on phone
 * and desktop -- so the handwriting is legible at a glance without tapping. Tap
 * still opens a full-resolution, pannable view for close reading.
 */
function GroupWorkSample({
  assessment: a,
  group,
}: {
  assessment: Assessment;
  group: AnswerGroup;
}) {
  // Students in this group whose body pages are still on hand. Manually entered
  // answers, or work already released after confirmation, have nothing to show.
  const withWork = group.studentIds.filter(
    (id) => (a.studentUploadIds?.[id]?.length ?? 0) > 0,
  );
  const [sample, setSample] = useState(0);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [full, setFull] = useState(false);
  if (!withWork.length) return null;
  const studentId = withWork[sample % withWork.length];
  const pages = a.studentUploadIds?.[studentId] ?? [];
  const uploadId = pages[page % pages.length];
  if (!uploadId) return null;
  const src = "/api/uploads/" + uploadId;
  return (
    <div className="work-sample">
      <button
        type="button"
        className="work-sample-thumb"
        onClick={() => {
          setFull(false);
          setZoom(true);
        }}
        aria-label="Enlarge a sample of student work for this question"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="A student's work for this question" />
        <span className="work-sample-hint">
          <ZoomIn size={13} /> Tap for full size
        </span>
      </button>
      <div className="work-sample-controls">
        {pages.length > 1 &&
          pages.map((_, i) => (
            <button
              key={i}
              type="button"
              className={
                "work-sample-page" + (i === page % pages.length ? " is-current" : "")
              }
              onClick={() => setPage(i)}
              aria-label={"Show page " + (i + 1) + " of this student's work"}
            >
              {i + 1}
            </button>
          ))}
        {withWork.length > 1 && (
          <button
            type="button"
            className="work-sample-another"
            onClick={() => {
              setSample((s) => (s + 1) % withWork.length);
              setPage(0);
            }}
          >
            Show another student’s work
          </button>
        )}
      </div>
      {zoom && (
        <div
          className="work-sample-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Student work, enlarged"
          onClick={() => setZoom(false)}
        >
          <button
            type="button"
            className="work-sample-close"
            aria-label="Close enlarged work"
            onClick={() => setZoom(false)}
          >
            <X size={20} />
          </button>
          {/* Tapping the image toggles full resolution (and pans via the
              scrolling overlay) instead of closing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={full ? "is-full" : ""}
            src={src}
            alt="A student's work for this question, enlarged"
            onClick={(e) => {
              e.stopPropagation();
              setFull((f) => !f);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Grading a class set one question at a time instead of one student at a time.
 *
 * Thirty-six papers hold far fewer than thirty-six different answers. Every
 * student who wrote the same thing is settled with one decision, and the
 * grouping itself carries information a per-student pass hides: nine children
 * making the identical mistake is one thing to reteach, not nine notes to
 * write. Costs nothing extra -- the answers were all read during grading, so
 * this only sorts what is already there.
 */
function GradeByQuestion({
  assessment: a,
  students,
  onSave,
  busy,
}: {
  assessment: Assessment;
  students: Student[];
  onSave: (next: Assessment, message: string) => Promise<boolean | void>;
  busy: boolean;
}) {
  const { w, classroom, save } = useTeacher();
  const questions = activeQuestions(a);
  const [questionId, setQuestionId] = useState(questions[0]?.id || "");
  const question = questions.find((q) => q.id === questionId) || questions[0];
  const [custom, setCustom] = useState<Record<string, string>>({});
  // Which group's "Percent" entry is open. Only one at a time; tapping a preset
  // or applying a percent closes it.
  const [percentFor, setPercentFor] = useState<string | null>(null);
  // Decided groups the teacher tapped "Change" on, so the buttons show again.
  const [reopened, setReopened] = useState<Set<string>>(new Set());

  const questionHasWork = (assessment: Assessment, id: string) =>
    groupAnswers(assessment, id).some((g) => g.needsDecision);

  if (!question) return null;
  const groups = groupAnswers(a, question.id);
  const outstanding = groups.filter((g) => g.needsDecision);
  const anyPending = questions.some((q) => questionHasWork(a, q.id));
  const autoConfirmIds = autoGradedToConfirm(a);
  const nameFor = (id: string) => students.find((s) => s.id === id)?.name || "—";

  /** The grouping is already on screen; this only writes down what it means.
   * Nine children with the same wrong answer are one thing to reteach, and
   * "plan a lesson" from the group card already knows where to go. */
  async function makeReteachGroup(group: AnswerGroup) {
    const made = reteachGroup(classroom.id, question, group);
    await save(
      { ...w, groups: withReteachGroup(w.groups, made) },
      made.studentIds.length +
        (made.studentIds.length === 1 ? " student" : " students") +
        " grouped for reteaching — find it under Groups",
    );
  }

  async function score(group: AnswerGroup, match: number) {
    setPercentFor(null);
    setReopened((prev) => {
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
    const updated = applyGroupScore(a, group.responseIds, match);
    const ok = await onSave(
      updated,
      group.responseIds.length +
        (group.responseIds.length === 1 ? " answer" : " answers") +
        " set to " +
        match +
        "%",
    );
    // Once this question has nothing left to decide, jump to the next one that
    // does — decided against the just-saved state so it's never a beat behind.
    if (ok !== false && !questionHasWork(updated, question.id)) {
      const next = questions.find(
        (q) => q.id !== question.id && questionHasWork(updated, q.id),
      );
      if (next) setQuestionId(next.id);
    }
  }

  /** Tag (or clear) the error type on a decided group. Optional and changeable:
   * it never touches the score, only the diagnosis the teacher chose. */
  async function tagError(group: AnswerGroup, errorType: string) {
    const count = group.responseIds.length;
    await onSave(
      setGroupErrorType(a, group.responseIds, errorType),
      errorType
        ? count + (count === 1 ? " answer" : " answers") + " tagged as " + errorType
        : "Error type cleared",
    );
  }

  /** Apply the typed percent (0–100), if it is a real number. */
  async function applyPercent(group: AnswerGroup) {
    const value = Number(custom[group.key]);
    if (!Number.isFinite(value) || custom[group.key] === undefined) return;
    await score(group, Math.max(0, Math.min(100, value)));
  }

  /** Confirm the answers that need no judgement (blank or a clean match), so
   * Grade by question finishes on its own instead of sending the teacher to the
   * "Confirm clear answers" button in the per-student review below. */
  async function confirmMatching() {
    if (!autoConfirmIds.length) return;
    await onSave(
      confirmResponses(a, autoConfirmIds),
      autoConfirmIds.length +
        (autoConfirmIds.length === 1 ? " answer" : " answers") +
        " confirmed",
    );
  }

  return (
    <div className="panel">
      <SectionTitle
        title="Grade by question"
        description="Every student who wrote the same answer is grouped together. Decide once and it applies to all of them."
      />
      <div className="review-student-toolbar">
        <label>
          Question
          <Pick
            label="Question to grade"
            value={question.id}
            onChange={setQuestionId}
            options={questions.map((q) => {
              const left = groupAnswers(a, q.id).filter((g) => g.needsDecision).length;
              return {
                value: q.id,
                label: "Q" + q.number + " · " + (left ? left + " to decide" : "graded ✓"),
              };
            })}
          />
        </label>
        <Pill>Your key: {question.answer || "not set"}</Pill>
      </div>
      {!groups.length && (
        <p className="cell-meta">No answers read for this question yet.</p>
      )}
      {groups.length > 0 && !anyPending && (
        <div className="grade-done" role="status">
          <Check size={22} />
          <div>
            <strong>All questions graded</strong>
            {autoConfirmIds.length > 0 ? (
              <p>
                {autoConfirmIds.length} matching or blank answer
                {autoConfirmIds.length === 1 ? "" : "s"} still need confirming to count
                toward scores.
              </p>
            ) : (
              <p>Every answer is decided and confirmed. Results are ready below.</p>
            )}
          </div>
          {autoConfirmIds.length > 0 && (
            <Action disabled={busy} onClick={confirmMatching}>
              <Check size={16} /> Confirm {autoConfirmIds.length} answer
              {autoConfirmIds.length === 1 ? "" : "s"}
            </Action>
          )}
        </div>
      )}
      {groups.length > 0 && anyPending && !outstanding.length && (
        <p className="cell-meta">This question is graded ✓ — pick another above, or it moves on for you.</p>
      )}
      {groups.map((g) => {
        const showButtons = g.needsDecision || reopened.has(g.key);
        return (
        <div className="class-scan-row" key={g.key}>
          <div className="class-scan-row-main">
            <strong>{g.answer.trim() ? g.answer : "(blank)"}</strong>
            <span className="cell-meta">
              {g.studentIds.length}
              {g.studentIds.length === 1 ? " student" : " students"} ·{" "}
              {g.studentIds.map(nameFor).join(", ")}
            </span>
            {!showButtons && g.verified && (
              <span className="grade-decided">
                <Check size={14} /> Graded · {creditLabel(Math.round(g.match))}
                <button
                  type="button"
                  className="grade-change"
                  disabled={busy}
                  onClick={() => setReopened((p) => new Set(p).add(g.key))}
                >
                  Change
                </button>
              </span>
            )}
            {!showButtons && !g.verified && (
              <Pill>
                {g.answer.trim() ? "Matches your key" : "Blank — scored zero"}
              </Pill>
            )}
            {/* Once a group is decided below full credit, the teacher can
                optionally tag what kind of error it was. One tag per group,
                changeable any time; full-credit and blank groups show none.
                The list is per-subject (lib/error-types.ts), so a subject with
                no list — ELA, for now — shows no picker. */}
            {!showButtons &&
              g.verified &&
              Math.round(g.match) < 100 &&
              errorTypesFor(a.subject).length > 0 && (
                <label className="grade-error-type">
                  <span className="cell-meta">Error type</span>
                  <Pick
                    label="Error type (optional)"
                    value={g.errorType}
                    onChange={(v) => tagError(g, v)}
                    options={[
                      { value: "", label: "No error type" },
                      ...errorTypesFor(a.subject),
                    ]}
                  />
                </label>
              )}
            <GroupWorkSample assessment={a} group={g} />
            {showButtons && (
              <div className="review-heading-actions">
                {CREDIT_LEVELS.map((level) => (
                  <Action
                    key={level.value}
                    variant="secondary small"
                    disabled={busy}
                    onClick={() => score(g, level.value)}
                  >
                    {level.label}
                  </Action>
                ))}
                {/* "Percent" opens a small box for any whole number rather than
                    adding a whole row of preset buttons. It pre-fills with the
                    group's current score, so a partial already graded at 25/75/
                    90 shows that number and can be nudged rather than retyped. */}
                {percentFor === g.key ? (
                  <form
                    className="percent-entry"
                    onSubmit={(e) => {
                      e.preventDefault();
                      applyPercent(g);
                    }}
                  >
                    <input
                      className="class-scan-name-input"
                      aria-label={"Percent credit for the answer " + g.answer}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      autoFocus
                      placeholder="0–100"
                      value={custom[g.key] ?? ""}
                      onChange={(e) =>
                        setCustom((c) => ({
                          ...c,
                          [g.key]: e.target.value.replace(/[^0-9]/g, "").slice(0, 3),
                        }))
                      }
                    />
                    <Action type="submit" variant="secondary small" disabled={busy}>
                      Set %
                    </Action>
                  </form>
                ) : (
                  <Action
                    variant="secondary small"
                    disabled={busy}
                    onClick={() => {
                      setCustom((c) => ({
                        ...c,
                        [g.key]: c[g.key] ?? String(Math.round(g.match)),
                      }));
                      setPercentFor(g.key);
                    }}
                  >
                    Percent
                  </Action>
                )}
                {g.studentIds.length > 1 && (
                  <Action
                    variant="secondary small"
                    disabled={busy}
                    onClick={() => makeReteachGroup(g)}
                  >
                    <Users size={15} />
                    Reteach these {g.studentIds.length}
                  </Action>
                )}
              </div>
            )}
          </div>
          <Score value={Math.round(g.match)} />
        </div>
        );
      })}
    </div>
  );
}

export function StudentResponseReview({
  assessment: a,
  onEdit,
  onSave,
}: {
  assessment: Assessment;
  onEdit: (r: StudentResponse) => void;
  onSave: (next: Assessment, message: string) => Promise<boolean>;
}) {
  const { students, busy, aiReady, go } = useTeacher();
  const params = useSearchParams();
  const [selected, setSelected] = useState(params.get("student") || "");
  const [filter, setFilter] = useState("flagged");
  const [limit, setLimit] = useState(12);
  const [uploading, setUploading] = useState(false),
    [status, setStatus] = useState(""),
    [notice, setNotice] = useState(""),
    [cameraOpen, setCameraOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const desired = params.get("student");
    if (desired && students.some((s) => s.id === desired)) setSelected(desired);
    else if (!students.some((s) => s.id === selected))
      setSelected(
        a.responses.find((r) => !r.verified)?.studentId ||
          a.responses[0]?.studentId ||
          students[0]?.id ||
          "",
      );
  }, [params, students, a.id]);
  const student = students.find((s) => s.id === selected);
  const summary = studentReview(a, selected);
  const prep = preparationGaps(a);
  const visible = (
    filter === "flagged"
      ? summary.flagged
      : filter === "pending"
        ? summary.pending
        : summary.responses
  ).sort((x, y) => {
    const xq = a.questions.find((q) => q.id === x.questionId),
      yq = a.questions.find((q) => q.id === y.questionId);
    return (
      Number(x.verified) - Number(y.verified) ||
      (xq?.number || 0) - (yq?.number || 0)
    );
  });
  const support = [
    ...new Set(
      summary.reviewed
        .filter((r) => !r.correct)
        .map((r) => a.questions.find((q) => q.id === r.questionId)?.standard)
        .filter((x): x is string => !!x),
    ),
  ];
  const files = a.studentUploadIds?.[selected] || [];
  function addAnswer(questionId: string) {
    onEdit({
      id: crypto.randomUUID(),
      studentId: selected,
      questionId,
      answer: "",
      correct: false,
      misconception: "",
      confidence: 100,
      verified: false,
    });
  }
  async function approveClear() {
    if (!prep.ready) return;
    const ids = new Set(summary.clear.map((r) => r.id));
    const confirmed = {
      ...a,
      responses: a.responses.map((r) =>
        ids.has(r.id) ? { ...r, verified: true } : r,
      ),
    };
    // Both pilot teachers asked for student work photos to go once the class
    // analysis is in. Confirming the last question of a student's work is that
    // moment for that student: the grades no longer need the photograph.
    const released = releasedStudentUploads(confirmed);
    const saved = await onSave(
      forgetUploads(confirmed, released),
      summary.clear.length +
        " clear answers confirmed" +
        (released.length
          ? " · " +
            released.length +
            " scanned page" +
            (released.length === 1 ? "" : "s") +
            " deleted"
          : ""),
    );
    // Unlinked first, deleted second: a failed delete leaves a file the nightly
    // purge still collects, where the reverse would leave a live thumbnail
    // pointing at nothing.
    if (saved !== false) {
      const kept = await deleteUploads(released);
      if (kept)
        toast.error(
          kept +
            (kept === 1 ? " scanned page" : " scanned pages") +
            " couldn't be deleted just now. They'll be removed automatically — tell us if you need them gone sooner.",
        );
    }
  }

  async function uploadPages(list: FileList | File[] | null) {
    if (!list?.length || !selected || uploading) return;
    if (!prep.ready) {
      toast.error("Confirm the standards and answer key before adding student work.");
      return;
    }
    const incoming = Array.from(list);
    if (incoming.length > 6) {
      toast.error("Add up to six pages for one student at a time.");
      return;
    }
    setUploading(true);
    setNotice("");
    setStatus("Uploading pages…");
    const ids: string[] = [];
    let pdfText = "";
    try {
      for (const raw of incoming) {
        const file = await uprightPage(raw);
        const d = await uploadFile(file);
        ids.push(d.id);
        // A browser PDF read is best-effort: safePdfText swallows a decode
        // failure so it can never abort the upload of this or the remaining
        // pages. The page is saved either way; when AI is connected the server
        // reads it below, and a message only follows if that also finds nothing.
        if (!aiReady && file.type === "application/pdf")
          pdfText += (await safePdfText(await file.arrayBuffer())) + "\n";
      }
    } catch (e) {
      toast.error(describeFailure(e, "The pages couldn’t be uploaded."));
    } finally {
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
    if (!ids.length) {
      setUploading(false);
      setStatus("");
      return;
    }
    const withFiles: Assessment = {
      ...a,
      uploadIds: [...new Set([...a.uploadIds, ...ids])],
      studentUploadIds: {
        ...a.studentUploadIds,
        [selected]: [...new Set([...(a.studentUploadIds?.[selected] || []), ...ids])],
      },
    };
    if (aiReady) {
      setStatus("Reading the student’s answers against your key…");
      try {
        const d = await analyzeRequest({
          mode: "responses",
          text: "",
          uploadIds: ids,
          grade: a.grade,
          subject: a.subject,
          framework: a.framework,
          assessmentId: a.id,
          studentId: selected,
        });
        await onSave(
          {
            ...withFiles,
            responses: [
              ...a.responses.filter((r) => r.studentId !== selected),
              ...(d.result.responses as StudentResponse[]),
            ],
          },
          "Student work is ready to review",
        );
        setFilter("flagged");
        setLimit(12);
      } catch (e) {
        await onSave(withFiles, "Pages saved");
        setNotice(
          (describeFailure(e, "The pages couldn’t be read.")) +
            " The pages are saved. Enter the answers below.",
        );
      }
    } else {
      const parsed = parseAnswerKey(pdfText, activeQuestions(a));
      const captured = Object.entries(parsed).map(([questionId, answer]) => ({
        id: crypto.randomUUID(),
        questionId,
        studentId: selected,
        answer,
        correct: false,
        match: 0,
        confidence: 100,
        verified: false,
        misconception: "Compare this answer with the teacher key before confirming.",
      }));
      await onSave(
        captured.length
          ? {
              ...withFiles,
              responses: [
                ...a.responses.filter(
                  (r) => r.studentId !== selected || parsed[r.questionId] === undefined,
                ),
                ...captured,
              ],
            }
          : withFiles,
        captured.length
          ? captured.length + " answers read from the PDF"
          : "Pages saved",
      );
      setNotice(
        captured.length
          ? "Answers were read from the typed PDF. Check each one against your key before confirming."
          : "Pages are saved. Automatic reading of photographs needs an AI connection, so enter each answer with Enter answer below.",
      );
    }
    setUploading(false);
    setStatus("");
  }

  if (!students.length)
    return (
      <div className="student-review-space">
        <ClassScanPanel assessment={a} />
        <EmptyState
          title="Or add students one at a time"
          description="A name or classroom alias is enough to connect each student’s work — or just scan a stack above and let AI build the roster as it goes."
        >
          <Action onClick={() => go("/students")}>
            Add students
            <ArrowRight size={16} />
          </Action>
        </EmptyState>
      </div>
    );
  return (
    <div className="student-review-space">
      <ClassScanPanel assessment={a} />
      <GradeByQuestion assessment={a} students={students} onSave={onSave} busy={busy} />
      <div className="panel">
        <SectionTitle
          title="Grades for your gradebook"
          description="One row per student, one column per question, ready to paste into whatever your district uses. Only answers you've confirmed are counted."
        >
          <Action
            variant="secondary small"
            disabled={!students.length}
            onClick={() =>
              downloadText(
                a.title.replace(/[^\w\d]+/g, "-").replace(/^-|-$/g, "") + "-grades.csv",
                gradebookCsv(
                  a,
                  [...students].sort((x, y) => compareByLastName(x.name, y.name)),
                ),
                "text/csv",
              )
            }
          >
            <Download size={15} />
            Download grades
          </Action>
        </SectionTitle>
      </div>
      <div className="review-student-toolbar">
        <label>
          Student
          <Pick
            label="Student whose work to review"
            value={selected}
            onChange={(value) => {
              setSelected(value);
              setFilter("flagged");
              setLimit(12);
              setNotice("");
            }}
            options={students.map((s) => ({
              value: s.id,
              label:
                s.name +
                (a.responses.some((r) => r.studentId === s.id && !r.verified)
                  ? " · needs review"
                  : ""),
            }))}
          />
        </label>
        <div>
          <Action
            variant="secondary"
            disabled={!student || !summary.responses.length}
            onClick={() =>
              student &&
              printContent(
                student.name + " · Assessment report",
                studentReport(a, student),
              )
            }
          >
            <Printer size={16} />
            Student report
          </Action>
        </div>
      </div>
      {!prep.ready && (
        <div className="review-notice">
          <FileText size={19} />
          <p>
            Confirm the assessment’s standards and answer key before grading.
          </p>
          <button
            className="text-link"
            onClick={() => go(assignmentNextStep(a).href)}
          >
            Finish setup
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {student && (
        <div className="student-upload-panel">
          <div>
            <h3>Add {student.name}’s pages</h3>
            <p>
              Upload a PDF or photograph this student’s completed work. Keep
              one student’s pages together.{" "}
              {aiReady
                ? "Each answer is compared with your confirmed key automatically."
                : "Typed PDFs are read automatically; photographs need manual entry until AI is connected."}
            </p>
          </div>
          <div>
            <Action
              disabled={uploading || busy || !prep.ready}
              onClick={() => input.current?.click()}
            >
              {uploading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              Upload pages
            </Action>
            <Action
              variant="secondary"
              disabled={uploading || busy || !prep.ready}
              onClick={() => setCameraOpen(true)}
            >
              <Camera size={16} />
              Take a photo
            </Action>
            <input
              ref={input}
              type="file"
              className="sr-only"
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              aria-label={"Upload pages for " + student.name}
              onChange={(e) => uploadPages(e.target.files)}
            />
            <input
              ref={camera}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              aria-label={"Photograph pages for " + student.name}
              onChange={(e) => uploadPages(e.target.files)}
            />
            {cameraOpen && (
              <ScanCamera
                mode="single"
                title={student.name}
                assessmentId={a.id}
                onComplete={(groups) => {
                  setCameraOpen(false);
                  const files = groups.flat();
                  if (files.length) uploadPages(files);
                }}
                onCancel={() => setCameraOpen(false)}
                onFallback={() => {
                  setCameraOpen(false);
                  camera.current?.click();
                }}
              />
            )}
          </div>
        </div>
      )}
      {status && (
        <div className="read-document-status" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>{status}</p>
        </div>
      )}
      {notice && (
        <p className="key-notice" role="status">
          {notice}
        </p>
      )}
      {student && (
        <div className="student-review-summary">
          <div className="review-student-identity">
            <Avatar student={student} />
            <div>
              <h2>{student.name}</h2>
              <p>
                {summary.reviewed.length} of {summary.questions.length} answers
                confirmed
              </p>
            </div>
          </div>
          <div className="review-score">
            <strong>
              {summary.score === null ? "—" : summary.score + "%"}
            </strong>
            {summary.score !== null && a.pointsPossible ? (
              <span className="review-score-points">
                {pointsForScore(summary.score, a.pointsPossible)} / {a.pointsPossible} points
              </span>
            ) : null}
            <span>
              {summary.complete
                ? "Confirmed assessment score"
                : "Provisional · reviewed answers only"}
            </span>
          </div>
          <div className="review-attention">
            <Flag size={19} />
            <strong>{summary.flagged.length}</strong>
            <span>need a closer look</span>
          </div>
        </div>
      )}
      {files.length > 0 && (
        <div className="source-documents">
          <span>Original student work</span>
          {files.map((id, i) => (
            <a
              key={id}
              href={"/api/uploads/" + id}
              target="_blank"
              rel="noreferrer"
            >
              <FileText size={14} />
              Page {i + 1}
            </a>
          ))}
        </div>
      )}
      <div className="review-controls">
        <div
          className="review-filter"
          role="group"
          aria-label="Answers to show"
        >
          {[
            ["flagged", "Needs a check", summary.flagged.length],
            ["pending", "Unconfirmed", summary.pending.length],
            ["all", "All answers", summary.responses.length],
          ].map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(String(value));
                setLimit(12);
              }}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        {summary.clear.length > 0 && (
          <Action
            variant="secondary"
            disabled={busy || !prep.ready}
            onClick={approveClear}
          >
            <CheckCheck size={17} />
            Confirm {summary.clear.length} clear answers
          </Action>
        )}
      </div>
      {summary.clear.length > 0 && (
        <p className="review-guidance">
          Clear answers match the confirmed key with at least 90% reading
          confidence. You can inspect them under All answers before confirming
          them together.
        </p>
      )}
      <div className="response-review-list">
        {visible.slice(0, limit).map((r) => {
          const q = a.questions.find((q) => q.id === r.questionId)!;
          const flag = responseFlag(r, q);
          return (
            <article
              key={r.id}
              className={
                "response-review-card panel " + (r.verified ? "confirmed" : "")
              }
            >
              <header>
                <span className="question-number">Q{q.number}</span>
                <div>
                  <Pill>{q.standard || "Standard not assigned"}</Pill>
                  <h3>{q.text}</h3>
                </div>
                <Pill tone={r.verified ? "green" : "amber"}>
                  {r.verified ? "Confirmed" : flag || "Ready to confirm"}
                </Pill>
              </header>
              {q.passage && (
                <details className="response-passage">
                  <summary>Read associated passage</summary>
                  <p>{q.passage}</p>
                </details>
              )}
              <div className="response-comparison">
                <div>
                  <span>Student answer</span>
                  <p>{r.answer || "No readable answer"}</p>
                </div>
                <div>
                  <span>Expected answer</span>
                  <p>{q.answer || "Answer key needed"}</p>
                </div>
              </div>
              {(!r.correct || r.confidence < 90) && (
                <details className="why-answer">
                  <summary>Why did they miss it?</summary>
                  <p>
                    {r.misconception ||
                      "Compare the student’s written steps with the expected answer. There isn’t enough evidence to name a specific misconception yet."}
                  </p>
                  <span>
                    Check the written work before deciding which skill needs
                    support.
                  </span>
                </details>
              )}
              <footer>
                <span>
                  {responseMatch(r)}% answer match · {r.confidence}% reading
                  confidence
                </span>
                <Action
                  variant={r.verified ? "secondary small" : "small"}
                  disabled={busy}
                  onClick={() => onEdit({ ...r })}
                >
                  <Pencil size={15} />
                  {r.verified ? "Review decision" : "Check & confirm"}
                </Action>
              </footer>
            </article>
          );
        })}
      </div>
      {visible.length > limit && (
        <div className="review-more">
          <Action variant="secondary" onClick={() => setLimit((n) => n + 12)}>
            Show more answers ({visible.length - limit} remaining)
          </Action>
        </div>
      )}
      {!visible.length && summary.responses.length > 0 && (
        <div className="review-clear panel">
          <Check size={26} />
          <h3>
            {summary.complete
              ? "This student’s review is complete"
              : summary.clear.length
                ? "No uncertain or incorrect answers left to check"
                : "No answers in this view"}
          </h3>
          <p>
            {summary.complete
              ? "Use the confirmed results below to choose the next teaching step."
              : summary.clear.length
                ? "Confirm the clear answers when you’re ready."
                : "Choose All answers to inspect the student’s work."}
          </p>
        </div>
      )}
      {summary.missing.length > 0 && (
        <section className="panel missing-work">
          <SectionTitle
            title={
              summary.responses.length
                ? "Answers not yet added"
                : "No answers recorded yet"
            }
            description="Upload or photograph the pages above, or enter an answer manually."
          />
          {summary.missing.slice(0, 12).map((q) => (
            <div key={q.id}>
              <span>Q{q.number}</span>
              <p>{q.text}</p>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => addAnswer(q.id)}
              >
                Enter answer
                <Plus size={14} />
              </button>
            </div>
          ))}
          {summary.missing.length > 12 && (
            <Pick
              label="Choose another question to enter"
              value=""
              onChange={(id) => id && addAnswer(id)}
              options={[
                { value: "", label: "More unanswered questions…" },
                ...summary.missing.slice(12).map((q) => ({
                  value: q.id,
                  label: "Q" + q.number + " · " + q.text.slice(0, 65),
                })),
              ]}
            />
          )}
        </section>
      )}
      {summary.reviewed.length > 0 && (
        <section className="panel student-standards-report">
          <SectionTitle
            title="What this assessment tells you"
            description="These results describe this student’s confirmed answers, not long-term mastery."
          />
          {[
            ...new Set(
              activeQuestions(a)
                .map((q) => q.standard)
                .filter(Boolean),
            ),
          ].map((code) => {
            const qs = activeQuestions(a).filter((q) => q.standard === code),
              rs = summary.reviewed.filter((r) =>
                qs.some((q) => q.id === r.questionId),
              );
            const correct = rs.filter((r) => r.correct).length;
            const averageMatch = rs.length
              ? Math.round(
                  rs.reduce(
                    (sum, response) => sum + responseMatch(response),
                    0,
                  ) / rs.length,
                )
              : null;
            return (
              <div className="student-standard-result" key={code}>
                <div>
                  <strong>{code}</strong>
                  <span>
                    {averageMatch === null
                      ? "No reviewed match yet"
                      : averageMatch + "% average answer match"}{" "}
                    · {correct} of {rs.length} fully correct · {qs.length}{" "}
                    assigned
                  </span>
                </div>
                <Pill
                  tone={
                    rs.length < qs.length
                      ? "neutral"
                      : correct < rs.length
                        ? "amber"
                        : "green"
                  }
                >
                  {rs.length < qs.length
                    ? "Review in progress"
                    : correct < rs.length
                      ? "Reteach opportunity"
                      : "Understood on this assessment"}
                </Pill>
                {support.includes(code) && (
                  <button
                    className="text-link"
                    onClick={() =>
                      go(
                        "/lessons?standard=" +
                          encodeURIComponent(code) +
                          "&student=" +
                          selected +
                          "&assessment=" +
                          a.id,
                      )
                    }
                  >
                    <BookOpen size={16} />
                    Plan a reteach lesson
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
