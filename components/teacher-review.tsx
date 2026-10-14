"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { uprightPage } from "@/lib/image-prep";
import { uploadFile } from "@/lib/upload-client";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { REQUIRE_CONFIRM_MATCHES } from "@/lib/grading-settings";
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
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Upload,
  Users,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { describeFailure, deleteUploads } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import {
  Action,
  Avatar,
  EmptyState,
  Meter,
  Pick,
  Pill,
  SectionTitle,
  downloadText,
  printContent,
} from "./teacher-shared";
import {
  activeQuestions,
  applyGroupScore,
  autoGradedToConfirm,
  matchesToConfirm,
  confirmResponses,
  setGradedAlone,
  countsAsGraded,
  CREDIT_LEVELS,
  creditForPoints,
  questionPoints,
  questionSummary,
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
  pointsText,
  withReteachGroup,
  confirmedGradesAtRisk,
  mergeStudentResponses,
  type AnswerGroup,
} from "@/lib/teacher-workflow";
import { ConfirmRescan } from "./confirm-reread";
import { compareByLastName } from "@/lib/teacher-classes";
import { errorTypesFor } from "@/lib/error-types";
import { safePdfText } from "@/lib/pdf-text";
import type { Assessment, Question, Student, StudentResponse } from "@/lib/teacher-types";
import {
  costaBreakdown,
  dokBreakdown,
  responseMatch,
} from "@/lib/teacher-metrics";
import { ClassScanPanel } from "./teacher-class-scan";
import { ImageViewer } from "./image-viewer";
import { CroppedPhoto } from "./cropped-photo";
import { inScanOrder } from "@/lib/teacher-class-scan";
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
 * The image is the graded page from studentUploadIds -- the same page already
 * reachable from "Original student work", never the name-area copy -- and it is
 * shown with no student name beside it, so the group stays about the work, not
 * whose it is. (Since 7 Oct a class-scan page is graded whole, so a name the
 * student wrote may be visible on it.) The grading pass returns no reliable per-question location, so
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
  const closeZoom = useCallback(() => setZoom(false), []);
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
        onClick={() => setZoom(true)}
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
        <ImageViewer
          pages={pages}
          initialIndex={page % pages.length}
          alt="A student's work for this question, enlarged"
          onClose={closeZoom}
        />
      )}
    </div>
  );
}

/**
 * One student's scanned pages, shown one at a time with page tabs, tap to open
 * the full-size viewer (which also has page tabs). Used wherever an answer has
 * no answerRegion -- work graded before #108 never recorded which page an
 * answer sits on, so the teacher pages through the whole thing rather than
 * being shown page 1 and nothing else (Michael, on a two-page test).
 */
function StudentWorkPhoto({ pages, alt }: { pages: string[]; alt: string }) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const closeZoom = useCallback(() => setZoom(false), []);
  if (!pages.length) return null;
  const idx = page % pages.length;
  const src = "/api/uploads/" + pages[idx];
  return (
    <div className="work-sample">
      <button type="button" className="work-sample-thumb" onClick={() => setZoom(true)} aria-label={"Enlarge: " + alt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        <span className="work-sample-hint">
          <ZoomIn size={13} /> Tap for full size
        </span>
      </button>
      {pages.length > 1 && (
        <div className="work-sample-controls">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              className={"work-sample-page" + (i === idx ? " is-current" : "")}
              onClick={() => setPage(i)}
              aria-label={"Show page " + (i + 1) + " of this student's work"}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <ImageViewer
          pages={pages.map((p) => "/api/uploads/" + p)}
          initialIndex={idx}
          alt={alt}
          onClose={closeZoom}
        />
      )}
    </div>
  );
}

/**
 * Grading a class set one question at a time instead of one student at a time
 * -- Ricky's flow, which he calls the heart of the product.
 *
 * First a summary of every question: how many are right, how many are blank or
 * got no credit, how many still need the teacher. "Review" opens that
 * question's answer groups. Students who reached the same final answer are one
 * group however they wrote it, because the grading pass returns a normalized
 * final answer and grouping uses that. Each group shows how many students, two
 * or three cropped photos of the answer itself, and the error type the AI
 * suggests; the teacher gives credit in points and approves or changes the
 * error type, and that applies to every student in the group. Then the next
 * group, and after the last group the next question.
 *
 * The AI sorts answers that look the same. It never decides credit: the
 * teacher is the one held responsible for a partial-credit call, so the
 * teacher makes each one -- once per group, not 35 times.
 */
/** Everything on the page a teacher can tap or type into. A tab panel and a
 * tab list are focusable (tabindex=0) but are containers, not controls -- the
 * tabs inside a list are buttons and counted on their own. */
const TAPPABLE =
  "a[href], button, input:not([type=hidden]), select, textarea, summary, label[for], " +
  "[role=button], [role=link], [role=combobox], [role=checkbox], [role=radio], [role=tab], " +
  "[tabindex]:not([tabindex='-1']):not([role=tabpanel]):not([role=tablist])";
const OPEN_QUESTION_EVENT = "tbf:open-question";
// A request to open a question, for a panel that is about to mount. It only
// lives long enough for that mount: a request nobody took (the panel never
// mounted -- another tab won, the teacher left the page) must not open a
// question the next time the panel appears, minutes later (#126 round 3).
const OPEN_REQUEST_MS = 2000;
let questionToOpen: { id: string; at: number } | null = null;
function takeQuestionToOpen() {
  const request = questionToOpen;
  questionToOpen = null;
  return request && Date.now() - request.at <= OPEN_REQUEST_MS ? request.id : null;
}
/** Opens one question in Grade by question -- whether the panel is already on
 * screen or is about to be (a tab switch mounts it fresh). */
export function openQuestionForGrading(questionId: string) {
  questionToOpen = { id: questionId, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_QUESTION_EVENT, { detail: questionId }));
}

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
  const { w, classroom, save, go } = useTeacher();
  const questions = activeQuestions(a);
  // null: the summary of every question. Otherwise the question under review.
  // "Grade it now" on the class-analysis step asks for a question to be open.
  const [openId, setOpenId] = useState<string | null>(() => takeQuestionToOpen());
  useEffect(() => {
    // A panel already on screen takes the request, so it is not left behind.
    const onOpen = (e: Event) => {
      takeQuestionToOpen();
      setOpenId((e as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_QUESTION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUESTION_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!openId) return;
    requestAnimationFrame(() =>
      document.getElementById("grade-by-question")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [openId]);
  // Decided groups the teacher tapped "Change" on, so the controls show again.
  const [reopened, setReopened] = useState<Set<string>>(new Set());
  const question = questions.find((q) => q.id === openId) || null;
  const autoConfirmIds = autoGradedToConfirm(a);
  const nameFor = (id: string) => students.find((s) => s.id === id)?.name || "—";
  const hasWork = (assessment: Assessment, id: string) =>
    groupAnswers(assessment, id).some((g) => g.needsDecision);
  const anyAnswers = questions.some((q) => groupAnswers(a, q.id).length > 0);
  const anyPending = questions.some((q) => hasWork(a, q.id));
  // While the green bar is pinned, the page keeps a bar-high strip at the
  // bottom out of reach of anything it scrolls into view (scroll-padding), so
  // a "Give" button the app brings up never lands under the bar.
  const barUp =
    !!question &&
    REQUIRE_CONFIRM_MATCHES &&
    matchesToConfirm(a, question.id).length > 0 &&
    (a.responses.some((r) => r.questionId === question.id && r.verified) || !hasWork(a, question.id));
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("confirm-bar-on", barUp);
    return () => root.classList.remove("confirm-bar-on");
  }, [barUp]);
  // The bar gets out of the way: whenever ANY control a teacher could tap --
  // a credit box, "Grade on their own", "Change", an error-type picker, "All
  // questions", a link -- would sit under its button, it slides out of sight
  // and comes back when the spot is clear. So a tap aimed at a control can
  // never land on "Confirm N answers" (#126 review, 360x640; round 3: the
  // first fix watched only the credit form).
  const [barTucked, setBarTucked] = useState(false);
  useEffect(() => {
    if (!barUp) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const wrap = document.querySelector<HTMLElement>(".confirm-matches-bar");
      const bar = wrap?.querySelector<HTMLElement>(".confirm-matches");
      if (!wrap || !bar) return;
      // Where the button sits when shown, whether or not it is now (tucked, it
      // is slid down by a transform the layout box does not include).
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      const bottom = window.innerHeight - (parseFloat(getComputedStyle(wrap).bottom) || 0);
      const left = (window.innerWidth - w) / 2;
      // A finger is wider than a pixel: a control within 8px of the button
      // counts as under it.
      const zone = { top: bottom - h - 8, bottom: bottom + 8, left: left - 8, right: left + w + 8 };
      const under = [...document.querySelectorAll<HTMLElement>(TAPPABLE)].some((el) => {
        if (wrap.contains(el) || el.closest("[inert]")) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > zone.top && r.top < zone.bottom && r.right > zone.left && r.left < zone.right;
      });
      // Straight onto the element, in this frame: waiting for React to
      // re-render left the bar over a control for up to three frames after a
      // scroll (measured). The state below keeps React's render in agreement.
      // (aria-hidden is left to React: setting it here could undo a dialog's.)
      wrap.classList.toggle("is-tucked", under);
      wrap.inert = under;
      setBarTucked(under);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    // A scroll event comes at most once a frame: measure right away rather
    // than a frame later.
    const onScroll = () => {
      if (frame) cancelAnimationFrame(frame);
      measure();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    // The layout also moves without a scroll -- a photo finishing loading, a
    // group growing -- so watch the page's size and image loads as well
    // (#126 review: the bar could stay tucked over a clear strip).
    const sized = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    const panel = document.getElementById("grade-by-question");
    // The whole page, not just the panel: a control can appear anywhere (a
    // toast's button, a menu) and must not end up under the bar either.
    observer.observe(document.body, { childList: true, subtree: true });
    // And the page's size and every image load, not only the panel's: a photo
    // loading elsewhere moves controls below the panel too (measured: "More
    // options" under the bar at 360x640, 1 sweep in 3).
    sized?.observe(document.body);
    if (panel) sized?.observe(panel);
    document.addEventListener("load", schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      sized?.disconnect();
      document.removeEventListener("load", schedule, true);
    };
  }, [barUp]);

  /** Confirm the answers that need no judgement (a clean match to the key; a blank always needs a look). */
  async function confirmMatching() {
    if (!autoConfirmIds.length) return;
    const ok = await onSave(
      confirmResponses(a, autoConfirmIds),
      autoConfirmIds.length + (autoConfirmIds.length === 1 ? " answer" : " answers") + " confirmed",
    );
    // The summary promises "finish and open class analysis": keep it.
    if (ok !== false && REQUIRE_CONFIRM_MATCHES && !anyPending)
      go("/assessments?id=" + a.id + "&tab=analysis");
  }

  async function makeReteachGroup(q: Question, group: AnswerGroup) {
    const made = reteachGroup(classroom.id, q, group);
    await save(
      { ...w, groups: withReteachGroup(w.groups, made) },
      made.studentIds.length +
        (made.studentIds.length === 1 ? " student" : " students") +
        " grouped for reteaching — find it under Groups",
    );
  }

  /** Credit in points for the whole group, plus the error type the teacher
   * approved. Then on to the next group, or the next question. */
  async function grade(
    q: Question,
    group: AnswerGroup,
    points: number,
    errorType: string,
    ids: string[] = group.responseIds,
  ) {
    const credit = creditForPoints(a, q, points);
    setReopened((prev) => {
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
    const updated = applyGroupScore(a, ids, credit, errorType);
    const n = ids.length;
    const ok = await onSave(
      updated,
      n + (n === 1 ? " student" : " students") + " given " + pointsText(points) + " of " +
        pointsText(questionPoints(a, q)) + " on Q" + q.number,
    );
    if (ok === false) return;
    moveOnIfDone(updated, q);
    revealNextCredit();
  }

  /** One student, pulled out of their group, graded on their own. */
  async function gradeOne(q: Question, responseId: string, points: number, errorType: string) {
    const updated = applyGroupScore(a, [responseId], creditForPoints(a, q, points), errorType);
    const ok = await onSave(
      updated,
      "1 student given " + pointsText(points) + " of " + pointsText(questionPoints(a, q)) + " on Q" + q.number,
    );
    if (ok === false) return;
    moveOnIfDone(updated, q);
  }

  /** Pull one student out of their group to grade on their own, or put them
   * back. Saved at once: the separation is part of the answer, so the bar, the
   * group's buttons and a reload all see it (#126 round 3). A grade they
   * already had is kept, shown with "Change". */
  async function separate(responseId: string, alone: boolean) {
    const ok = await onSave(setGradedAlone(a, responseId, alone), alone ? "Pulled out to grade on their own" : "Back into the group");
    // Bring that student's own credit form into view, wherever its card sorts.
    if (ok !== false && alone)
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document
            .querySelector(`#grade-by-question [data-alone="${CSS.escape(responseId)}"] .gbq-credit`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        ),
      );
  }

  /** Confirm this question's matching answers (the green step), then on to
   * the next question as if its last group had just been decided. */
  async function confirmQuestionMatches(q: Question) {
    const ids = matchesToConfirm(a, q.id);
    if (!ids.length) return;
    const updated = confirmResponses(a, ids);
    const ok = await onSave(updated, ids.length + (ids.length === 1 ? " answer" : " answers") + " that match the key confirmed on Q" + q.number);
    if (ok === false) return;
    moveOnIfDone(updated, q);
  }

  /**
   * After a group is decided, the next group opens where the last one was and
   * can land with its "Points" box and "Give" button under the pinned green
   * bar (#126 review, 360x640). Scroll just enough to show them; the page's
   * scroll-padding (set while the bar is up) keeps them clear of it.
   */
  function revealNextCredit() {
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector("#grade-by-question .gbq-group.is-current .gbq-credit")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      ),
    );
  }

  /** After a question's last group: the next question, from the top. */
  function moveOnIfDone(updated: Assessment, q: Question) {
    if (hasWork(updated, q.id)) return;
    // Stay while this question still has matches to confirm: the green button
    // is the next thing to do, and it is on screen.
    if (REQUIRE_CONFIRM_MATCHES && matchesToConfirm(updated, q.id).length) return;
    const next = questions.find((x) => x.id !== q.id && (hasWork(updated, x.id) || (REQUIRE_CONFIRM_MATCHES && matchesToConfirm(updated, x.id).length > 0)));
    if (!next) {
      // The whole class set is graded -- move straight on to class analysis
      // (Ricky/Michael: don't make me hunt for the next step) rather than
      // leaving the teacher on the finished grading screen.
      toast.success("Every question is graded.");
      go("/assessments?id=" + a.id + "&tab=analysis");
      return;
    }
    setOpenId(next.id);
    requestAnimationFrame(() =>
      document.getElementById("grade-by-question")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function tagError(group: AnswerGroup, errorType: string) {
    const count = group.responseIds.length;
    await onSave(
      setGroupErrorType(a, group.responseIds, errorType),
      errorType
        ? count + (count === 1 ? " answer" : " answers") + " tagged as " + errorType
        : "Error type cleared",
    );
  }

  if (!questions.length) return null;

  // ---- The summary: every question at a glance ----------------------------
  if (!question)
    return (
      <div className="panel" id="grade-by-question">
        <SectionTitle
          title="Grade by question"
          description="Students who reached the same answer are grouped together, however they wrote it. Review a question, decide each group once, and it applies to everyone in it."
        />
        {!anyAnswers && <p className="cell-meta">No answers read yet. Scan the class above.</p>}
        {anyAnswers && !anyPending && (
          <div className="grade-done" role="status">
            <Check size={22} />
            <div>
              <strong>All questions graded</strong>
              {autoConfirmIds.length > 0 && REQUIRE_CONFIRM_MATCHES ? (
                <p>
                  {autoConfirmIds.length} answer
                  {autoConfirmIds.length === 1 ? "" : "s"} match your key and are marked correct.
                  Confirm them to finish and open class analysis.
                </p>
              ) : autoConfirmIds.length > 0 ? (
                <p>
                  {autoConfirmIds.length} answer
                  {autoConfirmIds.length === 1 ? "" : "s"} match your key and are already counted —
                  no need to confirm them. Confirm only to lock them in and free up the photos.
                </p>
              ) : (
                <p>Every answer is decided and confirmed. Results are ready below.</p>
              )}
            </div>
            {autoConfirmIds.length > 0 && (
              <Action
                variant={REQUIRE_CONFIRM_MATCHES ? "" : "secondary"}
                className={REQUIRE_CONFIRM_MATCHES ? "confirm-matches" : undefined}
                disabled={busy}
                onClick={confirmMatching}
              >
                <Check size={16} />{" "}
                {REQUIRE_CONFIRM_MATCHES
                  ? "Confirm " + autoConfirmIds.length + (autoConfirmIds.length === 1 ? " answer" : " answers") + " that match the key"
                  : "Lock in " + autoConfirmIds.length + " match" + (autoConfirmIds.length === 1 ? "" : "es")}
              </Action>
            )}
          </div>
        )}
        {anyAnswers && (
          <div className="gbq-summary">
            {questions.map((q) => {
              const sum = questionSummary(a, q.id);
              const total = sum.correct + sum.noCredit + sum.partial + sum.needReview;
              if (!total) return null;
              return (
                <div className="gbq-question" key={q.id}>
                  <div className="gbq-question-text">
                    <strong>
                      Q{q.number} · {pointsText(questionPoints(a, q))} pt
                      {questionPoints(a, q) === 1 ? "" : "s"}
                    </strong>
                    <span className="cell-meta">{q.text}</span>
                  </div>
                  <div className="gbq-counts">
                    <span className="gbq-count correct">{sum.correct} correct</span>
                    <span className="gbq-count">{sum.noCredit} blank or no credit</span>
                    {sum.partial > 0 && <span className="gbq-count">{sum.partial} part credit</span>}
                    <span className={"gbq-count" + (sum.needReview ? " review" : "")}>
                      {sum.needReview} need review
                      {sum.unsure ? " (" + sum.unsure + " unsure)" : ""}
                    </span>
                  </div>
                  <Action
                    variant={sum.needReview ? "" : "secondary small"}
                    onClick={() => {
                      setOpenId(q.id);
                      requestAnimationFrame(() =>
                        document
                          .getElementById("grade-by-question")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      );
                    }}
                  >
                    {sum.needReview ? "Review" : "Look again"}
                    <ArrowRight size={15} />
                  </Action>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );

  // ---- One question: its answer groups ------------------------------------
  const groups = groupAnswers(a, question.id).sort(
    (x, y) => Number(y.needsDecision) - Number(x.needsDecision) || y.responseIds.length - x.responseIds.length,
  );
  const current = groups.find((g) => g.needsDecision);
  const sum = questionSummary(a, question.id);
  const worth = questionPoints(a, question);
  // Ricky (11 Oct): once credit has been given on this question, the answers
  // that already match the key are confirmed in one tap. The bar sticks to the
  // bottom of the screen until it is done -- but since round 3 it tucks itself
  // away whenever any control would sit under it, which on a phone is most of
  // the time; the same button at the top of the question is always there.
  // That trade is Ricky's call and is put to him (#126 round 3).
  const pendingMatches = REQUIRE_CONFIRM_MATCHES ? matchesToConfirm(a, question.id) : [];
  // Shown once credit has been given here, or straight away when nothing on
  // this question is left to decide (every student matched the key), so a
  // question with only matches is never a dead end without the button.
  const creditGiven = a.responses.some((r) => r.questionId === question.id && r.verified);
  const showBar = pendingMatches.length > 0 && (creditGiven || !current);
  return (
    <div className="panel" id="grade-by-question">
      <SectionTitle
        title={"Q" + question.number + " · " + question.text}
        description={
          sum.groupsToReview
            ? sum.groupsToReview +
              (sum.groupsToReview === 1 ? " group" : " groups") +
              " to decide. Give credit in points; it applies to every student in the group."
            : "Every group on this question is decided."
        }
      >
        <Action variant="secondary small" onClick={() => setOpenId(null)}>
          All questions
        </Action>
      </SectionTitle>
      <div className="review-student-toolbar">
        <Pill>Your key: {question.answer || "not set"}</Pill>
        <Pill>
          Worth {pointsText(worth)} point{worth === 1 ? "" : "s"}
        </Pill>
        {/* The same step, in the page: the pinned bar tucks itself away
            whenever a control would sit under it (round 3), so it is not
            always on screen -- this one always is, at the top. */}
        {showBar && (
          <Action className="confirm-matches confirm-matches-inline" disabled={busy} onClick={() => confirmQuestionMatches(question)}>
            <Check size={16} /> Confirm {pendingMatches.length} answer{pendingMatches.length === 1 ? "" : "s"} that match the key
          </Action>
        )}
      </div>
      <div className="class-scan-groups">
        {groups.map((g) => (
          <AnswerGroupCard
            key={g.key + ":" + g.responseIds.length + ":" + g.match + ":" + g.verified}
            assessment={a}
            question={question}
            group={g}
            current={g === current}
            open={g.needsDecision || reopened.has(g.key)}
            busy={busy}
            nameFor={nameFor}
            onGrade={(points, errorType, ids) => grade(question, g, points, errorType, ids)}
            onGradeOne={(id, points, errorType) => gradeOne(question, id, points, errorType)}
            onSeparate={(id, alone) => separate(id, alone)}
            onReopen={() => setReopened((p) => new Set(p).add(g.key))}
            onTag={(errorType) => tagError(g, errorType)}
            onReteach={() => makeReteachGroup(question, g)}
          />
        ))}
      </div>
      {showBar && typeof document !== "undefined" &&
        // Into <body>: an animated ancestor here has a transform, which makes
        // position:fixed fixed to IT rather than to the screen (measured: the
        // button sat 1,400-1,900px down the page).
        createPortal(
          <div
            className={"confirm-matches-bar" + (barUp && barTucked ? " is-tucked" : "")}
            role="status"
            aria-hidden={(barUp && barTucked) || undefined}
            // Tucked away it can be neither tapped nor reached by keyboard.
            inert={barUp && barTucked ? true : undefined}
          >
            <Action className="confirm-matches" disabled={busy} onClick={() => confirmQuestionMatches(question)}>
              <Check size={18} /> Confirm {pendingMatches.length} answer{pendingMatches.length === 1 ? "" : "s"} that
              match the key
            </Action>
          </div>,
          document.body,
        )}
      {/* Room under the last group whenever the bar is up -- it used to need
          creditGiven while the bar also showed on a question with nothing
          left to decide, so the last group's buttons ended under it. */}
      {showBar && <div className="confirm-matches-spacer" aria-hidden="true" />}
    </div>
  );
}

/**
 * One answer group: the answer, the correct answer under it in green, how
 * many students wrote it, a few photos of the answer itself, the AI's
 * suggested error type, and the credit control.
 *
 * Every grade here can be changed, including a group the AI marked as
 * matching the key (Michael could not change one that was wrong). Any student
 * can be pulled out and graded on their own -- a right answer with extra work
 * is not the same as the rest of the group. The Unsure group is graded
 * student by student, since what each wrote can differ.
 */
function AnswerGroupCard({
  assessment: a,
  question: q,
  group: g,
  current,
  open,
  busy,
  nameFor,
  onGrade,
  onGradeOne,
  onSeparate,
  onReopen,
  onTag,
  onReteach,
}: {
  assessment: Assessment;
  question: Question;
  group: AnswerGroup;
  current: boolean;
  open: boolean;
  busy: boolean;
  nameFor: (studentId: string) => string;
  onGrade: (points: number, errorType: string, responseIds: string[]) => void;
  onGradeOne: (responseId: string, points: number, errorType: string) => void;
  onSeparate: (responseId: string, alone: boolean) => void;
  onReopen: () => void;
  onTag: (errorType: string) => void;
  onReteach: () => void;
}) {
  const worth = questionPoints(a, q);
  const types = errorTypesFor(a.subject);
  const [errorType, setErrorType] = useState(g.errorType || g.suggestedErrorType);
  const [viewing, setViewing] = useState<string | null>(null);
  const closeViewing = useCallback(() => setViewing(null), [setViewing]);
  const blank = !g.unsure && !g.answer.trim();
  const responses = g.responseIds
    .map((id) => a.responses.find((r) => r.id === id))
    .filter((r): r is StudentResponse => !!r);
  // A photo of each answer: cropped to where the grading pass said the answer
  // area is (also for a blank or unsure answer), or the whole first page for
  // answers graded before it said so.
  // A cropped photo only when the grading pass recorded WHERE the answer is
  // (answerRegion). Without a region -- every answer graded before #108 -- a
  // crop of page 1 would be wrong on a multi-page test (it showed page 1 for a
  // page-2 question), so we fall through to the full, page-able view below
  // instead of guessing a page.
  const photoOf = (r: StudentResponse) => {
    const uploadId = r.answerRegion?.uploadId;
    return uploadId ? { id: r.id, region: r.answerRegion, uploadId } : null;
  };
  const photos = responses
    .map(photoOf)
    .filter((p): p is NonNullable<ReturnType<typeof photoOf>> => !!p)
    .slice(0, 3);
  const decidedLabel =
    pointsText((Math.round(g.match) / 100) * worth) + " of " + pointsText(worth) + " points";
  const fullCredit = g.verified && Math.round(g.match) >= 100;
  const together = g.unsure ? [] : responses;

  return (
    <div
      className={"gbq-group" + (current ? " is-current" : "") + (g.unsure ? " is-unsure" : "")}
      data-alone={g.alone ? g.responseIds[0] : undefined}
    >
      <div className="gbq-group-head">
        <span className="gbq-answer">
          {g.unsure
            ? "Unsure — check each one"
            : blank && g.alone
              ? "Read as blank — check the photo"
              : blank
                ? "(blank)"
                : g.answer}
        </span>
        <span className="cell-meta">
          {g.alone
            ? nameFor(g.studentIds[0]) + " · graded on their own"
            : g.studentIds.length + (g.studentIds.length === 1 ? " student" : " students")}
        </span>
      </div>
      {/* The key right under the answer, so nobody scrolls up to compare. */}
      <div className="gbq-key">
        <Check size={14} /> Correct answer: <strong>{q.answer || "not set"}</strong>
      </div>
      {g.unsure && (
        <p className="cell-meta">
          The AI couldn&rsquo;t read these or wasn&rsquo;t sure whether they match, so it
          didn&rsquo;t grade them. Look at each photo and give credit.
        </p>
      )}
      {g.lowConfidence && !g.verified && (
        <p className="cell-meta">
          Read as matching your key, but the AI wasn&rsquo;t fully sure it read these
          right. Check the photos before giving credit.
        </p>
      )}
      {blank && !g.verified && !g.alone && (
        <p className="cell-meta">
          Read as blank. Check the photos — if there is any work, pull that student out and
          grade them on their own.
        </p>
      )}
      {g.alone && blank && !g.verified && (
        <p className="cell-meta">
          The AI read this answer as blank. Look at the photo and give the credit the work
          deserves.
        </p>
      )}
      {!g.unsure && g.written.length > 0 && !(g.written.length === 1 && g.written[0] === g.answer) && (
        <span className="cell-meta">Written as: {g.written.map((x) => "“" + x + "”").join(", ")}</span>
      )}
      {!g.unsure && photos.length > 0 && (
        <div className="gbq-photos">
          {photos.map((p) => (
            <CroppedPhoto
              key={p.id}
              src={"/api/uploads/" + p.uploadId}
              box={p.region}
              pad={0.06}
              alt={"A student's answer to question " + q.number}
              onOpen={() => setViewing(p.uploadId)}
            />
          ))}
        </div>
      )}
      {!g.unsure && !photos.length && <GroupWorkSample assessment={a} group={g} />}
      {!open && g.verified && (
        <span className="grade-decided">
          <Check size={14} /> Graded · {decidedLabel}
          {g.errorType ? " · " + g.errorType : ""}
          <button type="button" className="grade-change" disabled={busy} onClick={onReopen}>
            Change
          </button>
        </span>
      )}
      {!open && !g.verified && (
        // The AI matched these to the key, so they are already counted -- no
        // confirmation needed (Michael). Still the teacher's call: one tap
        // changes it.
        <span className="grade-decided">
          <Pill tone="green">Matches your key — counted</Pill>
          <button type="button" className="grade-change" disabled={busy} onClick={onReopen}>
            Change
          </button>
        </span>
      )}
      {!open && g.verified && !fullCredit && types.length > 0 && (
        <label className="grade-error-type">
          <span className="cell-meta">Common error</span>
          <Pick
            label="Common error"
            value={g.errorType}
            onChange={onTag}
            options={[{ value: "", label: "No error type" }, ...types]}
          />
        </label>
      )}
      {open && types.length > 0 && (
        <label className="grade-error-type">
          <span className="cell-meta">
            {g.suggestedErrorType && errorType === g.suggestedErrorType
              ? "Common error — suggested by the AI, change it if it's wrong"
              : "Common error"}
          </span>
          <Pick
            label="Common error"
            value={errorType}
            onChange={setErrorType}
            options={[{ value: "", label: "No error type" }, ...types]}
          />
        </label>
      )}
      {open && !g.unsure && together.length > 0 && (
        <CreditForm
          worth={worth}
          busy={busy}
          label={g.answer || (g.alone ? "read as blank" : "blank")}
          initial={g.verified ? (Math.round(g.match) / 100) * worth : null}
          who={together.length === 1 ? "this student" : "all " + together.length}
          onGive={(points) => onGrade(points, errorType, together.map((r) => r.id))}
        >
          {g.studentIds.length > 1 && (
            <Action variant="secondary small" disabled={busy} onClick={onReteach}>
              <Users size={15} /> Reteach these {g.studentIds.length}
            </Action>
          )}
          {g.alone && !g.verified && (
            <Action variant="secondary small" disabled={busy} onClick={() => onSeparate(g.responseIds[0], false)}>
              Back into the group
            </Action>
          )}
        </CreditForm>
      )}
      {/* Every student in the group, in scan order. Any one can be pulled out
          and graded on their own; in the Unsure group every one is. */}
      <ul className="gbq-students">
        {!g.alone && responses.map((r) => {
          const alone = g.unsure;
          const photo = photoOf(r);
          return (
            <li key={r.id} className={alone ? "is-apart" : ""}>
              <div className="gbq-student-head">
                <span>{nameFor(r.studentId)}</span>
                {alone && r.answer.trim() && <span className="cell-meta">wrote “{r.answer}”</span>}
                {!g.unsure && g.studentIds.length > 1 && (
                  <button type="button" className="grade-change" disabled={busy} onClick={() => onSeparate(r.id, true)}>
                    Grade on their own
                  </button>
                )}
              </div>
              {alone && open && (
                <>
                  {/* The student's own work while grading them alone: the
                      cropped answer when we know where it is, otherwise every
                      page so a page-2 answer is reachable. */}
                  {g.unsure &&
                    (photo ? (
                      <CroppedPhoto
                        src={"/api/uploads/" + photo.uploadId}
                        box={photo.region}
                        pad={0.06}
                        alt={"This student's answer to question " + q.number}
                        onOpen={() => setViewing(photo.uploadId)}
                      />
                    ) : (
                      <StudentWorkPhoto
                        pages={a.studentUploadIds?.[r.studentId] ?? []}
                        alt={"This student's work for question " + q.number}
                      />
                    ))}
                  <CreditForm
                    worth={worth}
                    busy={busy}
                    label={r.answer || "blank"}
                    initial={r.verified ? (responseMatch(r) / 100) * worth : null}
                    who="this student"
                    onGive={(points) => onGradeOne(r.id, points, errorType)}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {viewing && (
        <ImageViewer
          src={"/api/uploads/" + viewing}
          alt={"A student's work for question " + q.number}
          onClose={closeViewing}
        />
      )}
    </div>
  );
}

/**
 * "__ of 4 points" with No credit / Full credit. The box starts empty, never
 * "0" -- a teacher typing 25 into a box holding 0 got "025" -- and selects its
 * contents on focus so typing replaces them.
 */
function CreditForm({
  worth,
  busy,
  label,
  initial,
  who,
  onGive,
  children,
}: {
  worth: number;
  busy: boolean;
  label: string;
  initial: number | null;
  who: string;
  onGive: (points: number) => void;
  children?: React.ReactNode;
}) {
  const [points, setPoints] = useState(initial && initial > 0 ? pointsText(initial) : "");
  const typed = Number(points);
  const valid = points.trim() !== "" && Number.isFinite(typed) && typed >= 0 && typed <= worth;
  return (
    <form
      className="gbq-credit"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onGive(typed);
      }}
    >
      <input
        className="class-scan-name-input"
        type="number"
        inputMode="decimal"
        min={0}
        max={worth}
        step="any"
        aria-label={"Points for the answer " + label}
        placeholder=""
        value={points}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setPoints(e.target.value.replace(/^0+(?=\d)/, ""))}
      />
      <span className="cell-meta">
        of {pointsText(worth)} point{worth === 1 ? "" : "s"}
      </span>
      <Action type="submit" disabled={busy || !valid}>
        <Check size={15} /> Give {valid ? pointsText(typed) : "…"} to {who}
      </Action>
      <Action variant="secondary small" disabled={busy} onClick={() => onGive(0)}>
        No credit
      </Action>
      <Action variant="secondary small" disabled={busy} onClick={() => onGive(worth)}>
        Full credit
      </Action>
      {children}
    </form>
  );
}

/**
 * One student's depth-of-knowledge picture: % correct at each DOK and Costa
 * level present on the assessment, and the error types tagged on their answers.
 * Computed live from this student's reviewed answers -- no AI step.
 */
function StudentDepthBreakdown({
  assessment: a,
  reviewed,
}: {
  assessment: Assessment;
  reviewed: StudentResponse[];
}) {
  const dok = dokBreakdown(a.questions, reviewed);
  const costa = costaBreakdown(a.questions, reviewed);
  const errors = new Map<string, number>();
  for (const r of reviewed) {
    const t = (r.errorType || "").trim();
    if (t) errors.set(t, (errors.get(t) || 0) + 1);
  }
  const errorRows = [...errors.entries()].sort(
    (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
  );
  if (!dok.length && !costa.length && !errorRows.length) return null;
  const group = (title: string, rows: ReturnType<typeof dokBreakdown>) =>
    rows.length ? (
      <div className="cognitive-group">
        <span className="cell-meta">{title}</span>
        {rows.map((r) => (
          <div className="cognitive-row" key={r.name}>
            <span className="cognitive-level">{r.name}</span>
            {r.percentCorrect !== null && (
              <Meter
                value={r.percentCorrect}
                tone={
                  r.percentCorrect >= 80
                    ? "green"
                    : r.percentCorrect >= 65
                      ? ""
                      : "orange"
                }
              />
            )}
            <span className="cell-meta">
              {r.percentCorrect === null
                ? "Not yet graded"
                : r.percentCorrect + "% correct"}{" "}
              · {r.questions} question{r.questions === 1 ? "" : "s"} · {r.assessed}{" "}
              graded
            </span>
          </div>
        ))}
      </div>
    ) : null;
  return (
    <div className="panel cognitive-breakdown">
      <span className="cell-meta">Depth of knowledge</span>
      {group("Webb DOK", dok)}
      {group("Costa's levels", costa)}
      {errorRows.length > 0 && (
        <div className="cognitive-group">
          <span className="cell-meta">Most common error types</span>
          {errorRows.map(([errorType, count]) => (
            <div className="cognitive-row" key={errorType}>
              <span className="cognitive-level">{errorType}</span>
              <span className="cell-meta">
                {count} answer{count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      )}
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
  const [perStudentOpen, setPerStudentOpen] = useState(!!params.get("student"));
  const [filter, setFilter] = useState("flagged");
  const [limit, setLimit] = useState(12);
  // Pages waiting while the teacher is asked about their confirmed grades (G5).
  const [askRescan, setAskRescan] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false),
    [status, setStatus] = useState(""),
    [notice, setNotice] = useState(""),
    [cameraOpen, setCameraOpen] = useState(false),
    // The page of original work open in the full-screen viewer, if any.
    [viewing, setViewing] = useState<string | null>(null),
    // "See their work": the student's pages open in the page-able viewer. The
    // photo is never shown on the card automatically -- it is one tap away.
    [showWork, setShowWork] = useState(false);
  const closeViewing = useCallback(() => setViewing(null), []);
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
  /** Give one answer credit right here -- No credit / Half / Full -- without a
   * detour into the detail sheet (Michael). It verifies the answer at that
   * credit; the detail sheet (Edit) is still there for exact points or fixing a
   * misread answer. */
  async function giveCredit(r: StudentResponse, match: number) {
    if (!prep.ready) {
      toast.error("Confirm the standards and answer key before grading.");
      return;
    }
    await onSave(
      applyGroupScore(a, [r.id], match, r.errorType || ""),
      "Q" +
        (a.questions.find((q) => q.id === r.questionId)?.number ?? "") +
        " · " +
        (CREDIT_LEVELS.find((l) => l.value === match)?.label ?? match + "%"),
    );
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

  /** `replaceConfirmed`: the teacher's answer when this student already has
   * confirmed grades (G5); undefined until asked. Asked before anything is
   * uploaded or read, so cancelling costs nothing. */
  async function uploadPages(list: FileList | File[] | null, replaceConfirmed?: boolean) {
    if (!list?.length || !selected || uploading) return;
    if (!prep.ready) {
      toast.error("Confirm the standards and answer key before adding student work.");
      return;
    }
    const incoming = Array.from(list);
    if (replaceConfirmed === undefined && confirmedGradesAtRisk(a, [selected]).answers > 0) {
      setAskRescan(incoming);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
      return;
    }
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
            // Layered over what the student already had, like the scan
            // screens: confirmed grades stay unless the teacher chose to
            // replace them (G5), and a page that cannot see a question keeps
            // the answer an earlier page gave.
            responses: [
              ...a.responses.filter((r) => r.studentId !== selected),
              ...mergeStudentResponses(
                a.responses.filter((r) => r.studentId === selected),
                d.result.responses as StudentResponse[],
                replaceConfirmed === true,
              ),
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
      // A confirmed grade is not overwritten by a typed-PDF read unless the
      // teacher chose to replace (G5).
      if (replaceConfirmed !== true)
        for (const r of a.responses)
          if (r.studentId === selected && r.verified) delete parsed[r.questionId];
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
      {/* Grading one student at a time, uploading one student's pages, the
          student report and the per-student breakdown: all still here, behind
          More options, so the page leads with the guided path (Michael worked
          student by student when that was the first thing he saw). A link
          that names a student opens it. */}
      <details
        className="more-options per-student"
        open={perStudentOpen}
        onToggle={(e) => setPerStudentOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>More options: one student at a time, or upload one student&rsquo;s pages</summary>
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
            options={inScanOrder(students, a).map((s) => ({
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
            <ConfirmRescan
              risk={confirmedGradesAtRisk(a, selected ? [selected] : [])}
              open={!!askRescan}
              onCancel={() => setAskRescan(null)}
              onKeep={() => {
                const files = askRescan;
                setAskRescan(null);
                void uploadPages(files, false);
              }}
              onReplace={() => {
                const files = askRescan;
                setAskRescan(null);
                void uploadPages(files, true);
              }}
            />
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
            {summary.score !== null ? (
              <span className="review-score-points">
                {pointsText(summary.pointsEarned)} / {pointsText(summary.pointsPossible)} points
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
          {summary.needsGrading > 0 && (
            <div className="review-attention" data-tone="warn">
              <Flag size={19} />
              <strong>{summary.needsGrading}</strong>
              <span>
                {summary.needsGrading === 1
                  ? "answer still needs grading"
                  : "answers still need grading"}
              </span>
            </div>
          )}
        </div>
      )}
      {student && summary.reviewed.length > 0 && (
        <StudentDepthBreakdown assessment={a} reviewed={summary.reviewed} />
      )}
      {files.length > 0 && (
        <div className="source-documents">
          <span>Original student work</span>
          {/* Opened in the same full-screen viewer as everywhere else rather
              than a new tab, which on a phone leaves the app. A page that is
              a PDF, not a photo, offers a new tab from inside the viewer. */}
          {files.map((id, i) => (
            <button
              key={id}
              type="button"
              className="source-document-button"
              onClick={() => setViewing(id)}
            >
              <FileText size={14} />
              Page {i + 1}
            </button>
          ))}
        </div>
      )}
      {viewing && (
        <ImageViewer
          src={"/api/uploads/" + viewing}
          alt={(student?.name || "Student") + "'s original work"}
          onClose={closeViewing}
        />
      )}
      {showWork && files.length > 0 && (
        <ImageViewer
          pages={files.map((id) => "/api/uploads/" + id)}
          alt={(student?.name || "Student") + "'s work"}
          onClose={() => setShowWork(false)}
        />
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
          // A clean AI match counts without a second tap, so it reads "Matches
          // your key" (not a "Ready to confirm" nag); the teacher can still
          // change it with the credit buttons or Edit below.
          const graded = countsAsGraded(a, r);
          const cleanMatch = graded && !r.verified;
          const givenMatch = r.verified ? Math.round(responseMatch(r)) : null;
          // When the grading pass located the answer (answerRegion), show a
          // cropped photo of just that area inline -- Ricky grades 30+ a sitting
          // and clicking into each page was tedious. "Whole page" opens the full
          // page. Older work has no region: no inline photo, "See their work"
          // one tap away (below).
          const region = r.answerRegion;
          return (
            <article
              key={r.id}
              className={
                "response-review-card panel " + (graded ? "confirmed" : "")
              }
            >
              <header>
                <span className="question-number">Q{q.number}</span>
                <div>
                  <Pill>{q.standard || "Standard not assigned"}</Pill>
                  <h3>{q.text}</h3>
                </div>
                <Pill tone={graded ? "green" : "amber"}>
                  {r.verified
                    ? "Confirmed"
                    : cleanMatch
                      ? "Matches your key"
                      : flag || "Ready to confirm"}
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
              {region && (
                <div className="response-work">
                  <CroppedPhoto
                    src={"/api/uploads/" + region.uploadId}
                    box={region}
                    pad={0.06}
                    alt={"Q" + q.number + " — this student's answer"}
                    onOpen={() => setViewing(region.uploadId)}
                  />
                </div>
              )}
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
                {/* Credit right here -- no detour into a detail view before
                    confirming (Michael). Tapping a level verifies the answer at
                    that credit. */}
                <div className="review-credit" role="group" aria-label="Give credit">
                  {CREDIT_LEVELS.map((l) => (
                    <button
                      type="button"
                      key={l.value}
                      className={"review-credit-btn" + (givenMatch === l.value ? " is-current" : "")}
                      aria-pressed={givenMatch === l.value}
                      disabled={busy}
                      onClick={() => giveCredit(r, l.value)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="review-card-actions">
                  {/* Only when there is no inline crop (older work): the pages
                      are one tap away, never shown automatically. */}
                  {!region && files.length > 0 && (
                    <button type="button" className="review-see-work" disabled={busy} onClick={() => setShowWork(true)}>
                      <ImageIcon size={15} /> See their work
                    </button>
                  )}
                  {/* Edit opens the detail sheet to fix a misread answer, the
                      standard, or set exact points -- "open them to change". */}
                  <Action variant="secondary small" disabled={busy} onClick={() => onEdit({ ...r })}>
                    <Pencil size={15} /> Edit
                  </Action>
                </div>
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
      </details>
    </div>
  );
}
