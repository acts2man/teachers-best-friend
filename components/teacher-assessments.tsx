"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { uprightPage } from "@/lib/image-prep";
import { uploadFile } from "@/lib/upload-client";
import { analyzeRequest } from "@/lib/analyze-client";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Upload,
  Camera,
  FileText,
  Check,
  CheckCheck,
  ScanLine,
  Lightbulb,
  LoaderCircle,
  X,
  Search,
  Download,
  Eye,
  AlertCircle,
  Target,
  Users,
  Pencil,
  Trash2,
  Printer,
  Mail,
  BookOpen,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { describeFailure, deleteUploads } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import {
  Action,
  PageTitle,
  SectionTitle,
  Pick,
  Pill,
  Score,
  Meter,
  Ring,
  EmptyState,
  Modal,
  Insight,
  downloadText,
  printContent,
  emailContent,
  TextLink,
  Avatar,
} from "./teacher-shared";
import {
  classAnalysis,
  classAnalysisReport,
  assessmentErrorTypes,
  type ErrorTypeTally,
} from "@/lib/teacher-class-analysis";
import { catalogFor } from "@/lib/teacher-catalog";
import { gradeLabel } from "@/lib/grade-labels";
import { elaAreaLabel, usesPassage } from "@/lib/ela";
import {
  alignmentSuggestions,
  costaBreakdown,
  costaFor,
  costasLevels,
  dokBreakdown,
  responseMatch,
  type CognitiveRow,
} from "@/lib/teacher-metrics";
import {
  activeQuestions,
  assignmentNextStep,
  preparationGaps,
  applyAnswerKey,
  questionsMissingStandard,
  assignStandardToUntagged,
  writingRows,
  writingScored,
  writingConfirmed,
  replaceWritingResponses,
  setWritingScore,
  confirmWritingScores,
} from "@/lib/teacher-workflow";
import { StudentResponseReview } from "./teacher-review";
import { AnswerKeyReview } from "./teacher-answer-key";
import { ScanCamera } from "./scan-camera";
import { isWritingAssessment } from "@/lib/ela";
import { genreLabel, isSimplifiedBand } from "@/lib/writing-rubrics";
import {
  writingClassAnalysis,
  type WritingDimensionSummary,
} from "@/lib/teacher-class-analysis";
import { splitNameBand } from "@/lib/image-prep";
import type { RubricDimension } from "@/lib/teacher-types";
import {
  alignment,
  makeManualQuestions,
  reconcileEvidence,
} from "@/lib/teacher-data";
import { extractUploadedPdfText } from "@/lib/pdf-text";
import { frameworkLabel } from "@/lib/states";
import {
  assessmentFitsClass,
  classesFor,
  shareAssessmentWith,
  deleteAssessment,
} from "@/lib/teacher-classes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  Assessment,
  Question,
  StudentResponse,
  Subject,
} from "@/lib/teacher-types";

export function AssessmentView() {
  const { w, assessments, students, save, busy, aiReady, go } = useTeacher();
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [subject, setSubject] = useState("All subjects"),
    [tab, setTab] = useState("questions"),
    [edit, setEdit] = useState<Question | null>(null),
    [responseEdit, setResponseEdit] = useState<StudentResponse | null>(null),
    [studentFilter, setStudentFilter] = useState("all"),
    [newText, setNewText] = useState(""),
    [adding, setAdding] = useState(false),
    [reading, setReading] = useState(false),
    [readNotice, setReadNotice] = useState(""),
    [linking, setLinking] = useState<string[] | null>(null),
    // The "Edit assessment" modal (rename + points possible), and the delete
    // confirmation. editMeta holds the draft while the modal is open.
    [editMeta, setEditMeta] = useState<{ title: string; points: string } | null>(
      null,
    ),
    [deleting, setDeleting] = useState(false);
  const autoRead = useRef<string | null>(null);
  useEffect(() => {
    setSelected(params.get("id"));
    setTab(params.get("tab") || "questions");
  }, [params]);
  const a = assessments.find((x) => x.id === selected);
  const catalog = a ? catalogFor(w, a.grade, a.framework) : [];
  const documents = a
    ? a.assignmentUploadIds?.length
      ? a.assignmentUploadIds
      : a.uploadIds
    : [];
  const suggestions = a ? alignmentSuggestions(a, catalog) : [];
  const clearQuestions =
    a?.questions.filter(
      (q) =>
        !q.verified &&
        !q.excluded &&
        q.standard &&
        q.skill &&
        q.confidence >= 90 &&
        q.alignment >= 80 &&
        q.level === "On grade" &&
        a.targetStandards.includes(q.standard),
    ) || [];
  async function saveAssessment(next: Assessment, message: string) {
    return save(
      {
        ...w,
        assessments: w.assessments.map((x) => (x.id === next.id ? next : x)),
        students: reconcileEvidence(w.students, next),
      },
      message,
    );
  }
  async function readDocument(target = a) {
    if (!target || reading || !documents.length) return;
    setReadNotice("");
    if (!target.targetStandards.length) {
      setReadNotice(
        "Choose the intended standards on the Standards report tab, then read the document.",
      );
      return;
    }
    setReading(true);
    try {
      if (aiReady) {
        const d = await analyzeRequest({
          mode: "assignment",
          text: "",
          uploadIds: documents,
          grade: target.grade,
          subject: target.subject,
          framework: target.framework,
          targetStandards: target.targetStandards,
        });
        const questions = d.result.questions as Question[];
        if (!questions.length)
          throw new Error(
            "No questions were recognized. Try a clearer scan, or add the questions manually.",
          );
        await saveAssessment(
          {
            ...target,
            questions,
            responses: [],
            source: "ai",
            status: "Needs review",
            answerKeyVerified: false,
            title:
              target.title === "Untitled assessment" && d.result.title
                ? d.result.title
                : target.title,
          },
          questions.length + " questions read from your document",
        );
        // A longer or multi-page read sometimes comes back with no standard on
        // any question. Say so plainly and point at the one-tap fix below,
        // rather than leaving a silent 0% and a locked next step.
        const untagged = questions.filter((q) => !q.standard && !q.excluded);
        if (untagged.length === questions.length && questions.length > 0)
          setReadNotice(
            "The read didn't tag these questions with a standard. Assign your intended standard to all of them below, or open a question to set it, then confirm.",
          );
      } else {
        let text = "";
        for (const id of documents) text += (await extractUploadedPdfText(id)) + "\n\n";
        const questions = makeManualQuestions(text);
        if (!questions.length)
          throw new Error(
            "No typed text was found in the document. Photographs need an AI connection to read, or you can add the questions manually.",
          );
        await saveAssessment(
          { ...target, questions, responses: [], status: "Needs review" },
          questions.length + " questions read from the PDF",
        );
      }
    } catch (e) {
      setReadNotice(
        describeFailure(e, "The document couldn’t be read."),
      );
    } finally {
      setReading(false);
    }
  }
  // A freshly uploaded assessment reads its own questions automatically so
  // the teacher never enters them a second time.
  useEffect(() => {
    if (
      a &&
      !a.questions.length &&
      documents.length > 0 &&
      a.source !== "sample" &&
      a.targetStandards.length > 0 &&
      autoRead.current !== a.id
    ) {
      autoRead.current = a.id;
      readDocument(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.questions.length, documents.length, aiReady]);
  function exportAssessment() {
    if (!a) return;
    downloadText(
      a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".csv",
      "Question,Text,Standard,Skill,DOK,Costa's level,Alignment,Improvement,Confidence,Grade level,Verified\n" +
        a.questions
          .map((q) =>
            [
              q.number,
              q.text,
              q.standard,
              q.skill,
              q.dok,
              costaFor(q),
              q.alignment,
              q.improvement || "",
              q.confidence,
              q.level,
              q.verified,
            ]
              .map((x) => '"' + String(x).replace(/"/g, '""') + '"')
              .join(","),
          )
          .join("\n"),
      "text/csv",
    );
  }
  async function verifyQuestion() {
    if (!a || !edit) return;
    if (!edit.excluded && (!edit.standard || !edit.skill.trim())) {
      toast.error("Choose a standard and name the skill before accepting.");
      return;
    }
    const questions = a.questions.map((q) =>
      q.id === edit.id ? { ...edit, verified: true } : q,
    );
    const previous = a.questions.find((q) => q.id === edit.id)!;
    const contentChanged =
      previous.answer !== edit.answer ||
      previous.text !== edit.text ||
      previous.passage !== edit.passage;
    const next = {
      ...a,
      questions,
      ...(contentChanged
        ? {
            answerKeyVerified: false,
            responses: a.responses.map((r) =>
              r.questionId === edit.id
                ? { ...r, verified: false, confidence: 0 }
                : r,
            ),
          }
        : {}),
      status: questions.every((q) => q.verified || q.excluded)
        ? ("Ready" as const)
        : ("Needs review" as const),
    };
    if (await saveAssessment(next, "Your standards decision is saved"))
      setEdit(null);
  }
  async function saveResponse() {
    if (!a || !responseEdit) return;
    if (responseEdit.correct && !responseEdit.answer.trim()) {
      toast.error("Enter the student’s answer before marking it correct.");
      return;
    }
    if (!preparationGaps(a).ready) {
      toast.error("Confirm the assessment standards and answer key first.");
      return;
    }
    const r = {
      ...responseEdit,
      match: responseMatch(responseEdit),
      verified: true,
      confidence: 100,
    };
    const responses = [
      ...a.responses.filter(
        (x) =>
          !(x.studentId === r.studentId && x.questionId === r.questionId) &&
          x.id !== r.id,
      ),
      r,
    ];
    const next = { ...a, responses };
    if (
      await save(
        {
          ...w,
          assessments: w.assessments.map((x) => (x.id === a.id ? next : x)),
          students: reconcileEvidence(w.students, next),
        },
        "Response confirmed",
      )
    )
      setResponseEdit(null);
  }
  // Rename the assessment and set what it is worth. Points possible is optional:
  // a blank clears it (back to percentage-only). A non-empty title is required.
  async function saveMeta() {
    if (!a || !editMeta) return;
    // Trim to the database's 1-200 char limit so a long name can never fail the
    // save with assessments_title_check.
    const title = editMeta.title.trim().slice(0, 200);
    if (!title) {
      toast.error("Give the assessment a name.");
      return;
    }
    const raw = editMeta.points.trim();
    const points = raw ? Math.round(Number(raw)) : undefined;
    if (raw && (!Number.isFinite(points!) || points! <= 0)) {
      toast.error("Points possible must be a whole number above zero, or blank.");
      return;
    }
    const next: Assessment = { ...a, title, pointsPossible: points };
    if (
      await save(
        { ...w, assessments: w.assessments.map((x) => (x.id === a.id ? next : x)) },
        "Assessment updated",
      )
    )
      setEditMeta(null);
  }
  // Delete the assessment and everything derived from it, then remove its
  // uploaded pages from storage. See deleteAssessment for exactly what goes.
  async function removeAssessment() {
    if (!a) return;
    const { workspace, uploadIds } = deleteAssessment(w, a.id);
    if (await save(workspace, "“" + a.title + "” was deleted")) {
      setDeleting(false);
      setSelected(null);
      go("/assessments");
      const kept = await deleteUploads(uploadIds);
      if (kept)
        toast.error(
          kept +
            (kept === 1 ? " scanned page" : " scanned pages") +
            " couldn't be deleted just now. They'll be removed automatically.",
        );
    }
  }
  const filtered = assessments.filter(
    (x) =>
      (subject === "All subjects" || x.subject === subject) &&
      x.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      {!a ? (
        <>
          <PageTitle
            eyebrow="EVERY QUESTION TELLS A STORY"
            title="Assessments"
            description="Keep each assessment, its answer key, and student work together."
          >
            <Action onClick={() => go("/scan")}>
              <Plus size={17} />
              New assessment
            </Action>
          </PageTitle>
          <div className="filter-bar">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search assessments"
                placeholder="Find an assessment…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Pick
              label="Filter subject"
              value={subject}
              onChange={setSubject}
              options={["All subjects", "Math", "ELA", "Mixed"]}
            />
            <span className="result-count">{filtered.length} assessments</span>
          </div>
          <div className="panel assignment-directory">
            {filtered.map((item) => {
              const prep = preparationGaps(item),
                next = assignmentNextStep(item);
              return (
                <button
                  className="assignment-list-row"
                  key={item.id}
                  onClick={() => go(next.href)}
                >
                  <span className="document-icon">
                    <FileText size={22} />
                  </span>
                  <div className="assignment-row-copy">
                    <h2>{item.title}</h2>
                    <p>
                      {item.subject}
                      {elaAreaLabel(item.elaArea)
                        ? " · " + elaAreaLabel(item.elaArea)
                        : ""}{" "}
                      · {gradeLabel(item.grade, item.subject)} ·{" "}
                      {item.questions.length} questions · {item.framework}
                    </p>
                    <span className="assignment-row-detail">
                      {item.questions.length ? alignment(item) + "% alignment" : "Awaiting questions"} ·{" "}
                      {preparationGaps(item).keyConfirmed ? "Key confirmed" : "Key needed"} ·{" "}
                      {new Set(item.responses.map((response) => response.studentId)).size} students
                    </span>
                  </div>
                  <div className="assignment-row-next">
                    <Pill tone={prep.ready ? "green" : "amber"}>
                      {prep.ready ? "Ready for student work" : "Needs setup"}
                    </Pill>
                    <span>
                      {next.label}
                      <ArrowRight size={16} />
                    </span>
                  </div>
                </button>
              );
            })}
            {!filtered.length && (
              <EmptyState
                title={
                  query
                    ? "No matching assessments"
                    : "Add your first assessment"
                }
                description="Upload an assessment or paste questions to begin."
              >
                <Action onClick={() => go("/scan")}>
                  New assessment
                  <ArrowRight size={16} />
                </Action>
              </EmptyState>
            )}
          </div>
        </>
      ) : (
        <>
          <button className="back-link" onClick={() => go("/assessments")}>
            <ArrowLeft size={16} />
            All assessments
          </button>
          <PageTitle
            eyebrow={
              a.subject.toUpperCase() +
              (elaAreaLabel(a.elaArea)
                ? " · " + elaAreaLabel(a.elaArea).toUpperCase()
                : "") +
              " · " +
              gradeLabel(a.grade, a.subject).toUpperCase() +
              " · " +
              a.framework.toUpperCase()
            }
            title={a.title}
            description={
              a.source === "sample"
                ? "An illustrative assessment with fictional student responses."
                : a.source === "ai"
                  ? "AI suggestions are ready for your professional review."
                  : "Review the questions, then connect them to your standards."
            }
          >
            <Action
              variant="secondary"
              onClick={() =>
                setEditMeta({
                  title: a.title,
                  points: a.pointsPossible ? String(a.pointsPossible) : "",
                })
              }
            >
              <Pencil size={16} />
              Edit
            </Action>
            <Action
              variant="secondary"
              onClick={() => go("/scan?assessment=" + a.id)}
            >
              <Upload size={16} />
              Upload revision
            </Action>
            <Action variant="secondary" onClick={exportAssessment}>
              <Download size={16} />
              Export report
            </Action>
            <Action
              onClick={() => setTab("responses")}
              disabled={!preparationGaps(a).ready}
            >
              <Plus size={16} />
              Add student work
            </Action>
            <Action variant="secondary" onClick={() => setDeleting(true)}>
              <Trash2 size={16} />
              Delete
            </Action>
          </PageTitle>
          <Modal
            open={!!editMeta}
            onClose={() => setEditMeta(null)}
            title="Edit assessment"
            description="Rename it, and set what the whole test is worth."
          >
            {editMeta && (
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveMeta();
                }}
              >
                <label className="block-label">
                  Assessment name
                  <input
                    value={editMeta.title}
                    autoFocus
                    onChange={(e) =>
                      setEditMeta({ ...editMeta, title: e.target.value })
                    }
                  />
                </label>
                <label className="block-label">
                  Points possible (optional)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    placeholder="e.g. 20"
                    value={editMeta.points}
                    onChange={(e) =>
                      setEditMeta({ ...editMeta, points: e.target.value })
                    }
                  />
                </label>
                <p className="field-help">
                  With a total set, a score shows both ways — 90% and 18/20.
                  Leave it blank to show the percentage only.
                </p>
                <Action type="submit" disabled={busy || !editMeta.title.trim()}>
                  <Check size={16} />
                  Save assessment
                </Action>
              </form>
            )}
          </Modal>
          <AlertDialog
            open={deleting}
            onOpenChange={(v) => !v && setDeleting(false)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{a.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the assessment, its questions, every
                  student’s answers and the evidence those answers produced, and
                  all of its scanned pages. Your students and your other
                  assessments stay. This can’t be undone — export a copy from
                  “Export report” or Settings first if you need one.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>
                  Keep assessment
                </AlertDialogCancel>
                <AlertDialogAction
                  className="action danger"
                  disabled={busy}
                  onClick={removeAssessment}
                >
                  Delete assessment
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="assignment-status-bar">
            <div>
              <span>Standards alignment</span>
              <strong>{a.questions.length ? alignment(a) + "%" : "—"}</strong>
            </div>
            <div>
              <span>Questions to review</span>
              <strong>
                {a.questions.filter((q) => !q.verified && !q.excluded).length}
              </strong>
            </div>
            <div>
              <span>Answer key</span>
              <strong>
                {preparationGaps(a).keyConfirmed ? "Confirmed" : "Check key"}
              </strong>
            </div>
            <div>
              <span>Student work</span>
              <strong>
                {new Set(a.responses.map((r) => r.studentId)).size} added
              </strong>
            </div>
          </div>
          {w.classes.length > 1 && (
            <div className="linked-classes">
              <Users size={14} />
              <span>Used in</span>
              {classesFor(w, a).map((c) => (
                <Pill key={c.id} tone={c.id === a.classId ? "green" : "neutral"}>
                  {c.name}
                </Pill>
              ))}
              <button
                className="text-link"
                onClick={() =>
                  setLinking(classesFor(w, a).map((c) => c.id))
                }
              >
                Change
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {(a.assignmentUploadIds || a.uploadIds).length > 0 && (
            <div className="source-documents">
              <span>Source documents</span>
              {(a.assignmentUploadIds || a.uploadIds).map((id, i) => (
                <a
                  key={id}
                  href={"/api/uploads/" + id}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={14} />
                  Document {i + 1}
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          )}
          {isWritingAssessment(a) ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="page-tabs">
                <TabsTrigger value="questions">1. Rubric</TabsTrigger>
                <TabsTrigger value="responses">2. Student writing</TabsTrigger>
                <TabsTrigger value="analysis">Class analysis</TabsTrigger>
              </TabsList>
              <TabsContent value="questions">
                <WritingRubricPanel assessment={a} onSave={saveAssessment} />
              </TabsContent>
              <TabsContent value="responses">
                <WritingReview
                  assessment={a}
                  students={students}
                  onSave={saveAssessment}
                />
              </TabsContent>
              <TabsContent value="analysis">
                <WritingClassPanel assessment={a} students={students} go={go} />
              </TabsContent>
            </Tabs>
          ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="page-tabs">
              <TabsTrigger value="questions">1. Assessment review</TabsTrigger>
              <TabsTrigger value="key">2. Answer key</TabsTrigger>
              <TabsTrigger value="responses">3. Student work</TabsTrigger>
              <TabsTrigger value="coverage">Standards report</TabsTrigger>
              <TabsTrigger value="analysis">Class analysis</TabsTrigger>
            </TabsList>
            <TabsContent value="questions">
              {usesPassage(a) && (
                <PassagePanel assessment={a} onSave={saveAssessment} />
              )}
              {!a.targetStandards.length && (
                <div className="review-notice">
                  <Target size={18} />
                  <p>
                    Choose the intended standards to measure this assessment’s
                    alignment.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => setTab("coverage")}
                  >
                    Choose standards
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {reading && (
                <div className="read-document-status" role="status">
                  <LoaderCircle className="spin" size={18} />
                  <p>
                    Reading the questions from your document. This takes a
                    moment for a multi-page assessment.
                  </p>
                </div>
              )}
              {readNotice && (
                <div className="review-notice" role="alert">
                  <AlertCircle size={18} />
                  <p>{readNotice}</p>
                  {!a.targetStandards.length && (
                    <button
                      className="text-link"
                      onClick={() => setTab("coverage")}
                    >
                      Choose standards
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
              {a.targetStandards.length > 0 &&
                questionsMissingStandard(a).length > 0 && (
                  <div className="review-notice" role="alert">
                    <Target size={18} />
                    <p>
                      {questionsMissingStandard(a).length} question
                      {questionsMissingStandard(a).length === 1 ? "" : "s"} came
                      back without a standard, so the student-work step is
                      waiting. Assign one of your intended standards to all of
                      them, or open a question to set its own.
                    </p>
                    <div className="review-heading-actions">
                      {a.targetStandards.map((code) => (
                        <Action
                          key={code}
                          variant="secondary small"
                          disabled={busy}
                          onClick={() =>
                            saveAssessment(
                              assignStandardToUntagged(a, code),
                              "Assigned " +
                                code +
                                " to " +
                                questionsMissingStandard(a).length +
                                " untagged question" +
                                (questionsMissingStandard(a).length === 1 ? "" : "s"),
                            )
                          }
                        >
                          Assign {code} to untagged
                        </Action>
                      ))}
                    </div>
                  </div>
                )}
              <div className="panel report-table">
                <SectionTitle
                  title="Check what each question measures"
                  description="Confirm the suggestions that fit. Open a question to adjust its standard or reasoning."
                >
                  <div className="review-heading-actions">
                    {clearQuestions.length > 0 && (
                      <Action
                        variant="secondary small"
                        disabled={busy}
                        onClick={async () => {
                          const ids = new Set(clearQuestions.map((q) => q.id));
                          const questions = a.questions.map((q) =>
                            ids.has(q.id) ? { ...q, verified: true } : q,
                          );
                          const allReviewed = questions.every(
                            (q) => q.verified || q.excluded,
                          );
                          const saved = await saveAssessment(
                            {
                              ...a,
                              questions,
                              status: allReviewed ? "Ready" : "Needs review",
                            },
                            clearQuestions.length +
                              " aligned questions confirmed",
                          );
                          // Ricky asked not to be left on a finished step hunting
                          // for the next tab. Once every question is reviewed, the
                          // answer key is the next thing to do, so go straight
                          // there.
                          if (saved && allReviewed) setTab("key");
                        }}
                      >
                        <CheckCheck size={16} />
                        Confirm {clearQuestions.length} clear matches
                      </Action>
                    )}
                    {documents.length > 0 && (
                      <Action
                        variant="secondary small"
                        disabled={reading || busy}
                        onClick={() => readDocument()}
                      >
                        {reading ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <ScanLine size={15} />
                        )}
                        {a.questions.length
                          ? "Read document again"
                          : "Read questions from document"}
                      </Action>
                    )}
                    <Action
                      variant="secondary small"
                      onClick={() => setAdding(true)}
                    >
                      <Plus size={15} />
                      Add questions
                    </Action>
                  </div>
                </SectionTitle>
                {a.questions.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Skill & standard</TableHead>
                        <TableHead>Depth</TableHead>
                        <TableHead>Alignment</TableHead>
                        <TableHead>Review</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.questions.map((q) => (
                        <TableRow
                          className={q.excluded ? "excluded" : ""}
                          key={q.id}
                        >
                          <TableCell>
                            <button
                              className="question-cell"
                              onClick={() => setEdit({ ...q })}
                            >
                              <span className="question-number">
                                {String(q.number).padStart(2, "0")}
                              </span>
                              <span>{q.text}</span>
                            </button>
                          </TableCell>
                          <TableCell>
                            <strong className="cell-title">
                              {q.skill || "Choose a skill"}
                            </strong>
                            <span className="cell-meta">
                              {q.standard || "Not assigned"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Pill>DOK {q.dok}</Pill>
                            <span className="cell-meta">
                              Costa {costaFor(q)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Score value={q.alignment} />
                            <span className="cell-meta">{q.level}</span>
                          </TableCell>
                          <TableCell>
                            {q.excluded ? (
                              <Pill>Excluded</Pill>
                            ) : q.verified ? (
                              <Pill tone="green">
                                <Check size={12} />
                                Reviewed
                              </Pill>
                            ) : (
                              <Pill tone="amber">Needs review</Pill>
                            )}
                          </TableCell>
                          <TableCell>
                            <button
                              className="icon-button"
                              aria-label={"Review question " + q.number}
                              onClick={() => setEdit({ ...q })}
                            >
                              <ArrowUpRight size={18} />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title={
                      reading
                        ? "Reading your document…"
                        : documents.length
                          ? "The questions haven’t been read yet"
                          : "Add questions to start reviewing"
                    }
                    description={
                      documents.length
                        ? "Your document is saved. Read the questions from it, or paste them manually."
                        : "Paste the questions, or upload a revised assessment."
                    }
                  >
                    {documents.length > 0 && (
                      <Action
                        disabled={reading || busy}
                        onClick={() => readDocument()}
                      >
                        <ScanLine size={16} />
                        Read questions from document
                      </Action>
                    )}
                    <Action
                      variant={documents.length ? "secondary" : ""}
                      onClick={() => setAdding(true)}
                    >
                      Add questions manually
                    </Action>
                  </EmptyState>
                )}
              </div>
              {(() => {
                // Every question reviewed and tagged, standards chosen: the
                // questions step is finished and the answer key is next. Offer
                // the move explicitly for a teacher who verified questions one
                // at a time rather than with "Confirm clear matches".
                const active = activeQuestions(a);
                const questionsReviewed =
                  active.length > 0 &&
                  a.targetStandards.length > 0 &&
                  active.every((q) => q.verified && q.standard);
                if (!questionsReviewed || preparationGaps(a).keyConfirmed)
                  return null;
                return (
                  <div className="setup-footer">
                    <span>Questions reviewed. Next, confirm your answer key.</span>
                    <Action onClick={() => setTab("key")}>
                      Continue to answer key
                      <ArrowRight size={17} />
                    </Action>
                  </div>
                );
              })()}
            </TabsContent>
            <TabsContent value="coverage">
              <div className="coverage-layout">
                <section className="panel">
                  <SectionTitle
                    title="The full standards picture"
                    description="Coverage is compared with this assessment’s intended standards."
                  />
                  {catalog.map((s) => {
                    const count = a.questions.filter(
                      (q) =>
                        !q.excluded &&
                        (q.standard === s.code || q.secondary === s.code),
                    ).length;
                    const target = a.targetStandards.includes(s.code);
                    return (
                      <div className="coverage-row" key={s.code}>
                        <Checkbox
                          aria-label={
                            "Include " + s.code + " as intended standard"
                          }
                          checked={target}
                          onCheckedChange={(v) =>
                            saveAssessment(
                              {
                                ...a,
                                targetStandards: v
                                  ? [...a.targetStandards, s.code]
                                  : a.targetStandards.filter(
                                      (c) => c !== s.code,
                                    ),
                              },
                              "Intended standards updated",
                            )
                          }
                        />
                        <div>
                          <strong>{s.title}</strong>
                          <span>{s.code}</span>
                        </div>
                        <Meter
                          value={Math.min(
                            100,
                            (count / Math.max(1, a.questions.length)) * 100,
                          )}
                          tone={count ? "green" : "orange"}
                        />
                        <span>{count} questions</span>
                        <Pill
                          tone={
                            !count && target
                              ? "amber"
                              : count >= 3
                                ? "green"
                                : "neutral"
                          }
                        >
                          {!target
                            ? "Optional"
                            : !count
                              ? "Missing"
                              : count === 1
                                ? "Limited"
                                : count >= 5
                                  ? "Heavy"
                                  : "Covered"}
                        </Pill>
                      </div>
                    );
                  })}
                  {!catalog.length && (
                    <EmptyState
                      title="Add your standards"
                      description="Create standards for this grade and framework to compare coverage."
                    >
                      <Action onClick={() => go("/standards")}>
                        Open standards library
                      </Action>
                    </EmptyState>
                  )}
                  {!!suggestions.length && (
                    <div className="alignment-guidance">
                      <div>
                        <Lightbulb size={19} />
                        <div>
                          <strong>Ways to improve alignment</strong>
                          <span>
                            Start with the questions that have the largest
                            effect.
                          </span>
                        </div>
                      </div>
                      {suggestions.slice(0, 6).map((suggestion) => (
                        <button
                          key={suggestion.key}
                          onClick={() => {
                            const question = a.questions.find(
                              (item) => item.id === suggestion.questionId,
                            );
                            if (question) setEdit({ ...question });
                            else setAdding(true);
                          }}
                        >
                          <span>{suggestion.title}</span>
                          <p>{suggestion.detail}</p>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                      <Action
                        variant="secondary small"
                        onClick={() => go("/scan?assessment=" + a.id)}
                      >
                        <Upload size={15} />
                        Check a revised assessment
                      </Action>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <SectionTitle
                    title="Cognitive demand"
                    description="Content coverage and depth are different questions."
                  />
                  {[1, 2, 3, 4].map((d, i) => {
                    const count = a.questions.filter(
                      (q) => !q.excluded && q.dok === d,
                    ).length;
                    return (
                      <div className="dok-row" key={d}>
                        <div>
                          <strong>DOK {d}</strong>
                          <span>
                            {
                              [
                                "Recall",
                                "Skill & concept",
                                "Strategic thinking",
                                "Extended reasoning",
                              ][i]
                            }
                          </span>
                        </div>
                        <Meter
                          value={
                            (count /
                              Math.max(
                                1,
                                a.questions.filter((q) => !q.excluded).length,
                              )) *
                            100
                          }
                          tone={i === 0 ? "orange" : "green"}
                        />
                        <span>{count}</span>
                      </div>
                    );
                  })}
                  <div className="demand-divider" />
                  <h3 className="demand-subtitle">
                    Costa’s Levels of Questioning
                  </h3>
                  {costasLevels.map((level, i) => {
                    const count = a.questions.filter(
                      (question) =>
                        !question.excluded &&
                        costaFor(question) === level.level,
                    ).length;
                    return (
                      <div className="dok-row" key={level.level}>
                        <div>
                          <strong>
                            Level {level.level} · {level.name}
                          </strong>
                          <span>{level.description}</span>
                        </div>
                        <Meter
                          value={
                            (count /
                              Math.max(
                                1,
                                a.questions.filter((q) => !q.excluded).length,
                              )) *
                            100
                          }
                          tone={i === 0 ? "orange" : "green"}
                        />
                        <span>{count}</span>
                      </div>
                    );
                  })}
                  <Insight>
                    Use a model-and-explain task or an error-analysis question
                    when a standard calls for reasoning.
                  </Insight>
                </section>
              </div>
            </TabsContent>
            <TabsContent value="key">
              <AnswerKeyReview
                assessment={a}
                onSave={saveAssessment}
                onConfirmed={() => setTab("responses")}
              />
            </TabsContent>
            <TabsContent value="responses">
              <StudentResponseReview
                assessment={a}
                onEdit={setResponseEdit}
                onSave={saveAssessment}
              />
            </TabsContent>
            <TabsContent value="analysis">
              <ClassAnalysisPanel assessment={a} students={students} catalog={catalog} go={go} />
            </TabsContent>
          </Tabs>
          )}
        </>
      )}
      <Sheet open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <SheetContent className="review-sheet">
          <SheetHeader>
            <SheetTitle>Question {edit?.number} · Review alignment</SheetTitle>
            <SheetDescription>
              Check the question, its expected answer, and the standard it
              measures.
            </SheetDescription>
          </SheetHeader>
          {edit && (
            <div className="sheet-scroll form-stack">
              {edit.passage && (
                <div className="passage">
                  <span>ASSOCIATED PASSAGE</span>
                  <p>{edit.passage}</p>
                </div>
              )}
              <label>
                Question
                <textarea
                  value={edit.text}
                  onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                />
              </label>
              <details className="review-advanced">
                <summary>Reading passage & further detail</summary>
                <label>
                  Associated passage (optional)
                  <textarea
                    value={edit.passage}
                    onChange={(e) =>
                      setEdit({ ...edit, passage: e.target.value })
                    }
                    placeholder="Keep the passage connected to this question."
                  />
                </label>
              </details>
              <label>
                Answer key
                <textarea
                  value={edit.answer}
                  onChange={(e) => setEdit({ ...edit, answer: e.target.value })}
                />
              </label>
              <div className="suggestion-reason">
                <span>
                  <Lightbulb size={16} />
                  {a?.source === "ai"
                    ? "AI suggestion"
                    : a?.source === "sample"
                      ? "Illustrative analysis"
                      : "Teacher analysis"}{" "}
                  · {edit.confidence}% confidence
                </span>
                <p>{edit.reasoning}</p>
              </div>
              {edit.alignment < 80 && (
                <div className="alignment-improvement">
                  <Lightbulb size={17} />
                  <div>
                    <strong>How to bring this closer</strong>
                    <p>
                      {edit.improvement ||
                        (a
                          ? alignmentSuggestions(a, catalog).find(
                              (item) => item.questionId === edit.id,
                            )?.detail
                          : "")}
                    </p>
                  </div>
                </div>
              )}
              <label>
                Primary standard
                <Pick
                  label="Primary standard"
                  value={edit.standard}
                  onChange={(standard) => setEdit({ ...edit, standard })}
                  options={[
                    { value: "", label: "Choose a standard" },
                    ...catalog.map((s) => ({
                      value: s.code,
                      label: s.code + " · " + s.title,
                    })),
                  ]}
                />
              </label>
              <label>
                Skill being assessed
                <input
                  value={edit.skill}
                  onChange={(e) => setEdit({ ...edit, skill: e.target.value })}
                  placeholder="e.g. Multiply using partial products"
                />
              </label>
              <details className="review-advanced">
                <summary>Secondary standard, depth & alignment</summary>
                <label>
                  Secondary standard
                  <Pick
                    label="Secondary standard"
                    value={edit.secondary}
                    onChange={(secondary) => setEdit({ ...edit, secondary })}
                    options={[
                      { value: "", label: "None" },
                      ...catalog.map((s) => ({
                        value: s.code,
                        label: s.code + " · " + s.title,
                      })),
                    ]}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Cognitive demand
                    <Pick
                      label="DOK"
                      value={String(edit.dok)}
                      onChange={(dok) => setEdit({ ...edit, dok: Number(dok) })}
                      options={["1", "2", "3", "4"]}
                    />
                  </label>
                  <label>
                    Costa’s level
                    <Pick
                      label="Costa's level"
                      value={String(costaFor(edit))}
                      onChange={(costas) =>
                        setEdit({
                          ...edit,
                          costas: Number(costas) as 1 | 2 | 3,
                        })
                      }
                      options={costasLevels.map((level) => ({
                        value: String(level.level),
                        label: `Level ${level.level} · ${level.name}`,
                      }))}
                    />
                  </label>
                  <label>
                    Instructional level
                    <Pick
                      label="Instructional level"
                      value={edit.level}
                      onChange={(level) =>
                        setEdit({ ...edit, level: level as Question["level"] })
                      }
                      options={[
                        "On grade",
                        "Below grade",
                        "Above grade",
                        "Unrelated",
                      ]}
                    />
                  </label>
                </div>
                <label>
                  Alignment · {edit.alignment}%
                  <Slider
                    aria-label="Alignment score"
                    min={0}
                    max={100}
                    step={1}
                    value={[edit.alignment]}
                    onValueChange={(v) => setEdit({ ...edit, alignment: v[0] })}
                  />
                </label>
                <label>
                  Reason for your decision
                  <textarea
                    value={edit.reasoning}
                    onChange={(e) =>
                      setEdit({ ...edit, reasoning: e.target.value })
                    }
                  />
                </label>
              </details>
              <label className="checkbox-label">
                <Checkbox
                  checked={edit.excluded}
                  onCheckedChange={(v) => setEdit({ ...edit, excluded: !!v })}
                />
                Mark not applicable / exclude from report
              </label>
              <Action disabled={busy} onClick={verifyQuestion}>
                <Check size={16} />
                Accept & save decision
              </Action>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Modal
        open={!!linking}
        onClose={() => setLinking(null)}
        title="Use this assessment in"
        description="Questions and the answer key are shared. Each class keeps its own student work and evidence."
      >
        {linking && a && (
          <div className="form-stack">
            <div className="link-classes">
              {w.classes.map((c) => (
                <label key={c.id} className={c.id === a.classId ? "locked" : ""}>
                  <Checkbox
                    checked={c.id === a.classId || linking.includes(c.id)}
                    disabled={c.id === a.classId}
                    onCheckedChange={(v) =>
                      setLinking((previous) =>
                        v
                          ? [...(previous || []), c.id]
                          : (previous || []).filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                  {c.id === a.classId && (
                    <span className="cell-meta">created here</span>
                  )}
                  {c.id !== a.classId && !assessmentFitsClass(a, c) && (
                    // Not a refusal. A teacher giving a seventh-grade test to a
                    // fourth-grade group for intervention is doing something
                    // sensible; they just need to know the standards will not
                    // line up, because the class analysis will look empty
                    // rather than broken.
                    <span className="cell-meta">
                      {c.grade === 0 ? "Kindergarten" : "Grade " + c.grade}
                      {c.framework !== a.framework ? " · " + frameworkLabel(c.framework) : ""}
                      {" — standards won’t match"}
                    </span>
                  )}
                </label>
              ))}
            </div>
            <Action
              disabled={busy}
              onClick={async () => {
                const shared = shareAssessmentWith({ ...a, classIds: [] }, linking);
                const count = new Set([a.classId, ...(shared.classIds || [])]).size;
                if (
                  await saveAssessment(
                    shared,
                    "Assessment shared with " + count + (count === 1 ? " class" : " classes"),
                  )
                )
                  setLinking(null);
              }}
            >
              <Check size={16} />
              Save classes
            </Action>
          </div>
        )}
      </Modal>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add questions"
        description="Separate each question with a blank line."
      >
        <div className="form-stack">
          <label>
            Questions
            <textarea
              className="question-paste"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
          </label>
          <Action
            disabled={!newText.trim() || busy}
            onClick={async () => {
              if (!a) return;
              const qs = makeManualQuestions(newText).map((q, i) => ({
                ...q,
                number: a.questions.length + i + 1,
              }));
              if (
                await saveAssessment(
                  {
                    ...a,
                    questions: [...a.questions, ...qs],
                    status: "Needs review",
                  },
                  "Questions added",
                )
              ) {
                setAdding(false);
                setNewText("");
              }
            }}
          >
            Add for review
            <ArrowRight size={16} />
          </Action>
        </div>
      </Modal>
      <Modal
        open={!!responseEdit}
        onClose={() => setResponseEdit(null)}
        title="Check & confirm this answer"
        description="Compare the student’s work with the answer key, then confirm your decision."
      >
        <div className="form-stack">
          {responseEdit && a && (
            <>
              <label>
                Student
                <Pick
                  label="Student"
                  value={responseEdit.studentId}
                  onChange={(studentId) => {
                    const existing = a.responses.find(
                      (r) =>
                        r.studentId === studentId &&
                        r.questionId === responseEdit.questionId,
                    );
                    setResponseEdit(
                      existing
                        ? { ...existing }
                        : {
                            ...responseEdit,
                            studentId,
                            id: crypto.randomUUID(),
                            answer: "",
                            correct: false,
                            misconception: "",
                            verified: false,
                          },
                    );
                  }}
                  options={students.map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                />
              </label>
              <label>
                Question
                <Pick
                  label="Question"
                  value={responseEdit.questionId}
                  onChange={(questionId) => {
                    const existing = a.responses.find(
                      (r) =>
                        r.studentId === responseEdit.studentId &&
                        r.questionId === questionId,
                    );
                    setResponseEdit(
                      existing
                        ? { ...existing }
                        : {
                            ...responseEdit,
                            questionId,
                            id: crypto.randomUUID(),
                            answer: "",
                            correct: false,
                            misconception: "",
                            verified: false,
                          },
                    );
                  }}
                  options={a.questions
                    .filter((q) => !q.excluded)
                    .map((q) => ({
                      value: q.id,
                      label: "Q" + q.number + " · " + q.text.slice(0, 55),
                    }))}
                />
              </label>
              <div className="passage">
                <p>
                  {
                    a.questions.find((q) => q.id === responseEdit.questionId)
                      ?.text
                  }
                </p>
                <strong>
                  Answer key:{" "}
                  {a.questions.find((q) => q.id === responseEdit.questionId)
                    ?.answer || "Not recorded"}
                </strong>
              </div>
              <label>
                Student’s response
                <textarea
                  value={responseEdit.answer}
                  onChange={(e) =>
                    setResponseEdit({ ...responseEdit, answer: e.target.value })
                  }
                />
              </label>
              <label>
                Answer and standard match · {responseMatch(responseEdit)}%
                <Slider
                  aria-label="Answer and standard match percentage"
                  min={0}
                  max={100}
                  step={5}
                  value={[responseMatch(responseEdit)]}
                  onValueChange={(value) =>
                    setResponseEdit({
                      ...responseEdit,
                      match: value[0],
                      correct: value[0] === 100,
                    })
                  }
                />
              </label>
              <label className="checkbox-label">
                <Checkbox
                  checked={responseEdit.correct}
                  onCheckedChange={(v) =>
                    setResponseEdit({
                      ...responseEdit,
                      correct: !!v,
                      match: v
                        ? 100
                        : responseMatch(responseEdit) === 100
                          ? 0
                          : responseMatch(responseEdit),
                    })
                  }
                />
                Response is correct
              </label>
              <label>
                Likely misconception or observation
                <textarea
                  value={responseEdit.misconception}
                  onChange={(e) =>
                    setResponseEdit({
                      ...responseEdit,
                      misconception: e.target.value,
                    })
                  }
                  placeholder="Record what you observed. Avoid diagnosing from one answer."
                />
              </label>
              <Action disabled={busy} onClick={saveResponse}>
                <Check size={16} />
                Confirm this answer
              </Action>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * The shared reading passage: photograph the story once, keep the text.
 *
 * A comprehension question cannot be marked honestly without the text it is
 * about -- asked "why did the character change his mind", a model holding only
 * the question and the teacher's key is guessing. The obvious fix, attaching
 * the photographed pages to every student's grading, would pay to read the same
 * story once per child. Reading it once here and carrying the text instead
 * costs a fraction of that and gives every student the whole story.
 */
// The writing rubric, viewed and edited on the assessment. Starts from the
// California default for the genre and grade; the teacher can rewrite any
// trait's descriptor or change its max here.
function WritingRubricPanel({
  assessment: a,
  onSave,
}: {
  assessment: Assessment;
  onSave: (next: Assessment, message: string) => Promise<boolean | void>;
}) {
  const { busy, aiReady } = useTeacher();
  const [draft, setDraft] = useState<RubricDimension[]>(a.rubric ?? []);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (id: string, patch: Partial<RubricDimension>) =>
    setDraft((rows) => rows.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(a.rubric ?? []);

  // Read the teacher's own rubric (photo or PDF) into editable traits. The AI
  // suggests a matching standard per trait; nothing is scored against it until
  // the teacher reviews and saves it, so this only fills the draft below.
  async function readRubric(list: FileList | null) {
    if (!list?.length || reading) return;
    const incoming = Array.from(list).slice(0, 4);
    setReading(true);
    setNotice("");
    try {
      const ids: string[] = [];
      for (const raw of incoming) {
        const file = await uprightPage(raw);
        const d = await uploadFile(file);
        ids.push(d.id);
      }
      const d = await analyzeRequest({
        mode: "rubric",
        uploadIds: ids,
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
      });
      const traits = (d.result.traits ?? []) as {
        name: string;
        max: number;
        descriptor: string;
        standard: string;
      }[];
      if (!traits.length) {
        setNotice(
          "No rubric traits could be read from that file. Try a clearer photo, or edit the traits below by hand.",
        );
        return;
      }
      setDraft(
        traits.map((t) => ({
          id: crypto.randomUUID(),
          name: t.name,
          max: t.max,
          descriptor: t.descriptor,
          standard: t.standard,
        })),
      );
      setNotice(
        traits.length +
          " traits read from your rubric. Check each one and its standard, then Save rubric.",
      );
    } catch (e) {
      setNotice(describeFailure(e, "Your rubric couldn’t be read."));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="panel">
      <SectionTitle
        title="Writing rubric"
        description={
          "The AI scores each trait against this rubric and you confirm every score. " +
          (genreLabel(a.genre) ? genreLabel(a.genre) + " writing." : "")
        }
      />
      {aiReady && (
        <div className="key-source-actions">
          <Action
            variant="secondary"
            disabled={busy || reading}
            onClick={() => fileRef.current?.click()}
          >
            {reading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Upload size={17} />
            )}
            Upload or photograph your rubric
          </Action>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Upload your own writing rubric"
            onChange={(e) => readRubric(e.target.files)}
          />
          <span className="field-help">
            Reads your own rubric into the traits below. The state rubric is the
            default until you do. Uses one credit, like reading a test.
          </span>
        </div>
      )}
      {reading && (
        <div className="read-document-status" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>Reading your rubric…</p>
        </div>
      )}
      {notice && (
        <p className="key-notice" role="status">
          {notice}
        </p>
      )}
      {isSimplifiedBand(a.grade) && (
        <div className="review-notice">
          <Target size={18} />
          <p>
            Smarter Balanced doesn’t publish a K–2 writing rubric, so this is a
            simple, age-appropriate version we wrote. Edit any trait to match how
            you score.
          </p>
        </div>
      )}
      {draft.map((d) => (
        <div className="class-scan-row" key={d.id}>
          <div className="class-scan-row-main">
            <label className="full">
              Trait
              <input
                className="class-scan-name-input"
                value={d.name}
                aria-label={"Trait name"}
                onChange={(e) => set(d.id, { name: e.target.value })}
              />
            </label>
            <label className="full">
              What each level means
              <textarea
                rows={3}
                value={d.descriptor}
                aria-label={d.name + " descriptor"}
                onChange={(e) => set(d.id, { descriptor: e.target.value })}
              />
            </label>
            <label>
              Top score
              <input
                className="class-scan-name-input"
                type="number"
                min={1}
                max={6}
                value={d.max}
                aria-label={d.name + " top score"}
                onChange={(e) =>
                  set(d.id, {
                    max: Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))),
                  })
                }
              />
            </label>
            <label>
              Standard
              <input
                className="class-scan-name-input"
                value={d.standard}
                placeholder="e.g. W.5.2"
                aria-label={d.name + " standard"}
                onChange={(e) => set(d.id, { standard: e.target.value.trim() })}
              />
            </label>
          </div>
        </div>
      ))}
      <div className="review-heading-actions">
        <Action
          disabled={busy || !dirty}
          onClick={() => onSave({ ...a, rubric: draft }, "Rubric saved")}
        >
          <Check size={16} /> Save rubric
        </Action>
        {dirty && (
          <Action variant="secondary" onClick={() => setDraft(a.rubric ?? [])}>
            Undo changes
          </Action>
        )}
      </div>
    </div>
  );
}

// Grading writing: per student, upload the essay (one piece, however many
// pages), let the AI suggest a level and reason per rubric trait, and confirm or
// change each. Replaces the answer-group flow, which does not fit an essay.
function WritingReview({
  assessment: a,
  students,
  onSave,
}: {
  assessment: Assessment;
  students: import("@/lib/teacher-types").Student[];
  onSave: (next: Assessment, message: string) => Promise<boolean | void>;
}) {
  const { aiReady, busy } = useTeacher();
  const [selected, setSelected] = useState(students[0]?.id || "");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const student = students.find((s) => s.id === selected);
  const rows = selected ? writingRows(a, selected) : [];
  const hasScores = selected ? writingScored(a, selected) : false;

  async function gradeEssay(list: FileList | null) {
    if (!list || !selected) return;
    const incoming = Array.from(list);
    if (incoming.length > 12) {
      toast.error("Add up to twelve pages for one essay at a time.");
      return;
    }
    setUploading(true);
    setStatus("Uploading the writing…");
    const ids: string[] = [];
    try {
      for (let i = 0; i < incoming.length; i++) {
        // The name sits at the top of the first page; cut that band off before
        // upload so the essay the AI scores carries no name. Later pages go up
        // whole. A browser that cannot cut falls back to the whole first page
        // (the honest limit recorded in docs/student-data-flow.md §4).
        let file: File;
        if (i === 0) {
          const split = await splitNameBand(incoming[i]);
          file = split ? split.body : await uprightPage(incoming[i]);
        } else {
          file = await uprightPage(incoming[i]);
        }
        const d = await uploadFile(file);
        ids.push(d.id);
      }
    } catch (e) {
      toast.error(describeFailure(e, "The writing couldn’t be uploaded."));
      setUploading(false);
      setStatus("");
      if (input.current) input.current.value = "";
      return;
    }
    if (input.current) input.current.value = "";
    const withFiles: Assessment = {
      ...a,
      uploadIds: [...new Set([...a.uploadIds, ...ids])],
      studentUploadIds: {
        ...a.studentUploadIds,
        [selected]: [...new Set([...(a.studentUploadIds?.[selected] || []), ...ids])],
      },
    };
    if (!aiReady) {
      await onSave(withFiles, "Writing saved — scoring needs the AI connection");
      setUploading(false);
      setStatus("");
      return;
    }
    setStatus("Scoring the writing against your rubric…");
    try {
      const d = await analyzeRequest({
        mode: "writing",
        text: "",
        uploadIds: ids,
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        assessmentId: a.id,
        studentId: selected,
      });
      const scored = replaceWritingResponses(
        withFiles,
        selected,
        d.result.responses as import("@/lib/teacher-types").StudentResponse[],
      );
      await onSave(scored, "Suggested scores ready — confirm or change each one");
    } catch (e) {
      await onSave(withFiles, "Writing saved");
      toast.error(
        describeFailure(e, "The writing couldn’t be scored.") +
          " The pages are saved; you can score by hand below.",
      );
    } finally {
      setUploading(false);
      setStatus("");
    }
  }

  if (!students.length)
    return (
      <EmptyState
        title="No students yet"
        description="Add students to this class, then their writing can be scored here."
      />
    );

  return (
    <div className="panel">
      <SectionTitle
        title="Student writing"
        description="One student at a time. Upload the whole piece; the AI suggests a level and a reason for each trait, and you decide."
      />
      <div className="review-student-toolbar">
        <label>
          Student
          <Pick
            label="Student to score"
            value={selected}
            onChange={setSelected}
            options={students.map((s) => ({
              value: s.id,
              label: s.name + (writingConfirmed(a, s.id) ? " ✓" : ""),
            }))}
          />
        </label>
        {student && (
          <div className="review-heading-actions">
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => gradeEssay(e.target.files)}
            />
            <Action disabled={uploading || busy} onClick={() => input.current?.click()}>
              {uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
              {hasScores ? "Replace writing" : "Add writing"}
            </Action>
            {hasScores && !writingConfirmed(a, selected) && (
              <Action
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  onSave(confirmWritingScores(a, selected), "Scores confirmed")
                }
              >
                <CheckCheck size={16} /> Confirm all suggested
              </Action>
            )}
          </div>
        )}
      </div>
      {status && <p className="cell-meta">{status}</p>}
      {!hasScores && !uploading && (
        <p className="cell-meta">
          No writing scored for {student?.name || "this student"} yet. Add the
          pages above.
        </p>
      )}
      {rows.map(({ dimension, response }) => (
        <div className="class-scan-row" key={dimension.id}>
          <div className="class-scan-row-main">
            <strong>{dimension.name}</strong>
            {response?.rubricReason && (
              <span className="cell-meta">{response.rubricReason}</span>
            )}
            <div className="review-heading-actions">
              {Array.from({ length: dimension.max + 1 }, (_, level) => (
                <Action
                  key={level}
                  variant={
                    response?.rubricScore === level && response?.verified
                      ? "small"
                      : "secondary small"
                  }
                  disabled={busy}
                  onClick={() =>
                    onSave(
                      setWritingScore(a, selected, dimension.id, level),
                      dimension.name + " set to " + level + " of " + dimension.max,
                    )
                  }
                >
                  {level}
                </Action>
              ))}
              <span className="cell-meta">of {dimension.max}</span>
              {response?.verified ? (
                <Pill tone="green">
                  <Check size={13} /> Confirmed
                </Pill>
              ) : response?.rubricScore !== undefined ? (
                <Pill tone="amber">Suggested {response.rubricScore}</Pill>
              ) : (
                <Pill>Score this</Pill>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// The class picture for a writing assessment: each rubric trait with the class
// average, and the students who are strong, still developing, or not yet scored.
function WritingClassPanel({
  assessment: a,
  students,
  go,
}: {
  assessment: Assessment;
  students: import("@/lib/teacher-types").Student[];
  go: (url: string) => void;
}) {
  const scoredAny = a.responses.some(
    (r) => r.verified && r.rubricScore !== undefined,
  );
  if (!scoredAny)
    return (
      <EmptyState
        title="No confirmed writing yet"
        description="Score and confirm at least one student's writing on the Student writing tab. The class picture appears here instantly."
      />
    );
  const rows: WritingDimensionSummary[] = writingClassAnalysis(a, students);
  return (
    <div className="panel">
      <SectionTitle
        title="Class analysis"
        description="Each rubric trait across the class, from your confirmed scores — no extra AI step."
      />
      <div className="student-groups-grid skill-gap-groups">
        {rows.map((row) => (
          <section className="panel student-group-card skill" key={row.dimension.id}>
            <header>
              <span className="group-icon">
                <Target size={21} />
              </span>
              <Pill tone={row.averagePercent === null ? "neutral" : row.averagePercent >= 80 ? "green" : row.averagePercent >= 65 ? "neutral" : "amber"}>
                Avg {row.averageLabel}
              </Pill>
            </header>
            <h2>{row.dimension.name}</h2>
            {row.averagePercent !== null && (
              <Meter
                value={row.averagePercent}
                tone={row.averagePercent >= 80 ? "green" : row.averagePercent >= 65 ? "" : "orange"}
              />
            )}
            {row.weak.length > 0 && (
              <>
                <span className="cell-meta">Still developing ({row.weak.length})</span>
                <div className="group-members">
                  {row.weak.map((member) => (
                    <button key={member.id} onClick={() => go("/students?id=" + member.id)}>
                      <Avatar student={member} size="small" />
                      <span>{member.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {row.strong.length > 0 && (
              <>
                <span className="cell-meta">Strong ({row.strong.length})</span>
                <div className="group-members">
                  {row.strong.map((member) => (
                    <button key={member.id} onClick={() => go("/students?id=" + member.id)}>
                      <Avatar student={member} size="small" />
                      <span>{member.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {row.notScored.length > 0 && (
              <span className="cell-meta">
                {row.notScored.length} student{row.notScored.length === 1 ? "" : "s"} not
                yet scored on this trait
              </span>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function PassagePanel({
  assessment: a,
  onSave,
}: {
  assessment: Assessment;
  onSave: (next: Assessment, message: string) => Promise<boolean | void>;
}) {
  const { aiReady, busy } = useTeacher();
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(a.passage || "");
  const input = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const words = (a.passage || "").trim()
    ? (a.passage || "").trim().split(/\\s+/).length
    : 0;

  async function read(list: FileList | File[] | null) {
    if (!list?.length || reading) return;
    const files = Array.from(list);
    if (files.length > 12) {
      toast.error("Up to twelve pages of a passage at a time.");
      return;
    }
    setReading(true);
    try {
      setStatus("Uploading " + files.length + (files.length === 1 ? " page…" : " pages…"));
      const ids: string[] = [];
      for (const raw of files) {
        const page = await uprightPage(raw);
        const d = await uploadFile(page);
        ids.push(d.id);
      }
      setStatus("Reading the passage…");
      const result = await analyzeRequest({
        mode: "passage",
        uploadIds: ids,
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        assessmentId: a.id,
      });
      const text = String(result.result.text || "").trim();
      if (!text) throw new Error("No text could be read from those pages.");
      await onSave(
        { ...a, passage: text },
        "Passage read — it now goes with every student's grading",
      );
      setDraft(text);
      // The photographs have given up everything they had; the text is what
      // travels from here on.
      // The text is out of them; the photographs have nothing left to give.
      await deleteUploads(ids);
    } catch (e) {
      toast.error(describeFailure(e, "The passage couldn't be read."));
    } finally {
      setReading(false);
      setStatus("");
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="panel">
      <SectionTitle
        title="Reading passage"
        description="For comprehension questions. Photograph the story once — the text is kept and goes with every student's grading, so the AI marks answers against what they actually read."
      >
        <div className="review-heading-actions">
          <input
            ref={input}
            type="file"
            className="sr-only"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Upload pages of the passage"
            onChange={(e) => read(e.target.files)}
          />
          {cameraOpen && (
            <ScanCamera
              mode="single"
              title="Reading passage"
              assessmentId={a.id}
              onComplete={(groups) => {
                setCameraOpen(false);
                const captured = groups.flat();
                if (captured.length) read(captured);
              }}
              onCancel={() => setCameraOpen(false)}
              onFallback={() => {
                setCameraOpen(false);
                input.current?.click();
              }}
            />
          )}
          <Action
            variant="secondary small"
            disabled={reading || busy || !aiReady}
            onClick={() => setCameraOpen(true)}
          >
            {reading ? <LoaderCircle className="spin" size={15} /> : <Camera size={15} />}
            Photograph the story
          </Action>
          <Action
            variant="secondary small"
            disabled={reading || busy || !aiReady}
            onClick={() => input.current?.click()}
          >
            <Upload size={15} />
            Upload pages
          </Action>
        </div>
      </SectionTitle>
      {status && (
        <div className="read-document-status" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>{status}</p>
        </div>
      )}
      {!a.passage && !status && (
        <p className="cell-meta">
          No passage yet. Without one, a comprehension answer is judged against your
          answer key alone.
        </p>
      )}
      {a.passage && (
        <>
          <p className="cell-meta">
            {words.toLocaleString()} words — sent with every student&rsquo;s grading.
          </p>
          <details className="review-advanced" open={open}>
            <summary onClick={() => setOpen((v) => !v)}>Read or edit the passage</summary>
            <textarea
              aria-label="The reading passage"
              value={draft}
              rows={12}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="review-heading-actions">
              <Action
                variant="secondary small"
                disabled={busy || draft === (a.passage || "")}
                onClick={() => onSave({ ...a, passage: draft.trim() }, "Passage updated")}
              >
                <Check size={15} />
                Save changes
              </Action>
              <Action
                variant="secondary small"
                disabled={busy}
                onClick={() => {
                  setDraft("");
                  onSave({ ...a, passage: "" }, "Passage removed");
                }}
              >
                <X size={15} />
                Remove passage
              </Action>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

/** Renders one list of error types, each with the students who made it. Shared
 * by the assessment-wide summary and the per-standard cards. */
function ErrorTypeList({
  tallies,
  go,
}: {
  tallies: ErrorTypeTally[];
  go: (url: string) => void;
}) {
  if (!tallies.length) return null;
  return (
    <div className="error-type-list">
      {tallies.map((t) => (
        <div className="error-type-row" key={t.errorType}>
          <span className="cell-meta">
            {t.errorType} ({t.count})
          </span>
          <div className="group-members">
            {t.students.map((member) => (
              <button key={member.id} onClick={() => go("/students?id=" + member.id)}>
                <Avatar student={member} size="small" />
                <span>{member.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * DOK (1-4) and Costa (1-3) breakdown: % correct at each level present on the
 * assessment, with question counts. Renders nothing until something is graded at
 * a level. Shared by the class view (all responses) and the student view (one
 * student's).
 */
function CognitiveBreakdown({
  questions,
  responses,
  heading,
}: {
  questions: Question[];
  responses: import("@/lib/teacher-types").StudentResponse[];
  heading: string;
}) {
  const dok = dokBreakdown(questions, responses);
  const costa = costaBreakdown(questions, responses);
  if (!dok.length && !costa.length) return null;
  const group = (title: string, rows: CognitiveRow[]) =>
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
                  r.percentCorrect >= 80 ? "green" : r.percentCorrect >= 65 ? "" : "orange"
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
      <span className="cell-meta">{heading}</span>
      {group("Webb DOK", dok)}
      {group("Costa's levels", costa)}
    </div>
  );
}

function ClassAnalysisPanel({
  assessment: a,
  students,
  catalog,
  go,
}: {
  assessment: Assessment;
  students: import("@/lib/teacher-types").Student[];
  catalog: import("@/lib/teacher-types").Standard[];
  go: (url: string) => void;
}) {
  const graded = a.responses.some((r) => r.verified);
  if (!graded)
    return (
      <EmptyState
        title="No graded responses yet"
        description="Review at least one student's work on the Student work tab. Class analysis appears here instantly, computed from that grading — no extra AI step."
      />
    );
  const analysis = classAnalysis(a, students, catalog);
  if (!analysis.length)
    return (
      <EmptyState
        title="No standards to analyze yet"
        description="Assign standards to this assessment's questions, then class analysis appears here."
      />
    );
  const report = classAnalysisReport(a, analysis);
  const errorTypes = assessmentErrorTypes(a, students);
  const fileName =
    a.title.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) ||
    "assessment";
  return (
    <div className="panel">
      <SectionTitle
        title="Class analysis"
        description="Computed instantly from this assessment's graded responses — grouped by standard so you know who needs what."
      >
        <div className="review-heading-actions">
          <Action
            variant="secondary small"
            onClick={() => printContent(a.title + " · Class analysis", report)}
          >
            <Printer size={15} />
            Print
          </Action>
          <Action
            variant="secondary small"
            onClick={() => downloadText(fileName + "-class-analysis.txt", report)}
          >
            <Download size={15} />
            Download report
          </Action>
          <Action
            variant="secondary small"
            onClick={() => emailContent(a.title + " · Class analysis", report)}
          >
            <Mail size={15} />
            Email to me
          </Action>
        </div>
      </SectionTitle>
      {errorTypes.length > 0 && (
        <div className="panel error-type-summary">
          <span className="cell-meta">
            Most common error types across this assessment
          </span>
          <ErrorTypeList tallies={errorTypes} go={go} />
        </div>
      )}
      <CognitiveBreakdown
        questions={a.questions}
        responses={a.responses}
        heading="Depth of knowledge across this assessment"
      />
      <div className="student-groups-grid skill-gap-groups">
        {analysis.map((row) => (
          <section className="panel student-group-card skill" key={row.standard.code}>
            <header>
              <span className="group-icon">
                <Target size={21} />
              </span>
              <Pill
                tone={
                  row.instruction === "Whole class"
                    ? "amber"
                    : row.instruction === "Small group"
                      ? "neutral"
                      : "green"
                }
              >
                {row.instruction === "On track" ? "On track" : row.instruction}
              </Pill>
            </header>
            <h2>{row.standard.title}</h2>
            <p>
              {row.standard.code} ·{" "}
              {row.percentMastered === null
                ? "Not yet graded"
                : row.percentMastered + "% of graded students mastered this"}
            </p>
            {row.percentMastered !== null && (
              <Meter
                value={row.percentMastered}
                tone={
                  row.percentMastered >= 80
                    ? "green"
                    : row.percentMastered >= 65
                      ? ""
                      : "orange"
                }
              />
            )}
            {row.strong.length > 0 && (
              <>
                <span className="cell-meta">Strong ({row.strong.length})</span>
                <div className="group-members">
                  {row.strong.map((member) => (
                    <button
                      key={member.id}
                      onClick={() =>
                        go(
                          "/students?id=" +
                            member.id +
                            "&standard=" +
                            row.standard.code,
                        )
                      }
                    >
                      <Avatar student={member} size="small" />
                      <span>{member.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {row.weak.length > 0 && (
              <>
                <span className="cell-meta">Needs reteaching ({row.weak.length})</span>
                <div className="group-members">
                  {row.weak.map((member) => (
                    <button
                      key={member.id}
                      onClick={() =>
                        go(
                          "/students?id=" +
                            member.id +
                            "&standard=" +
                            row.standard.code,
                        )
                      }
                    >
                      <Avatar student={member} size="small" />
                      <span>{member.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {row.notGraded.length > 0 && (
              <span className="cell-meta">
                {row.notGraded.length} student{row.notGraded.length === 1 ? "" : "s"} not
                yet graded on this standard
              </span>
            )}
            {row.errorTypes.length > 0 && (
              <>
                <span className="cell-meta">Error types</span>
                <ErrorTypeList tallies={row.errorTypes} go={go} />
              </>
            )}
            {row.weak.length > 0 && (
              <div className="review-heading-actions">
                <Action
                  variant="secondary small"
                  onClick={() =>
                    go(
                      "/lessons?standard=" +
                        encodeURIComponent(row.standard.code) +
                        "&assessment=" +
                        a.id +
                        "&students=" +
                        row.weak.map((member) => member.id).join(","),
                    )
                  }
                >
                  <BookOpen size={15} />
                  Reteach {row.weak.length === 1 ? "this student" : "this group"}
                </Action>
                <Action
                  variant="secondary small"
                  onClick={() =>
                    go(
                      "/lessons?standard=" +
                        encodeURIComponent(row.standard.code) +
                        "&assessment=" +
                        a.id,
                    )
                  }
                >
                  Reteach whole class
                </Action>
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="method-note group-method-note">
        Mastery is 70% or higher average match on this assessment&apos;s
        reviewed questions for that standard. Only teacher-confirmed responses
        count.
      </p>
    </div>
  );
}
