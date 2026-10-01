"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { analyzeRequest } from "@/lib/analyze-client";
import { uploadFile } from "@/lib/upload-client";
import { uprightPage } from "@/lib/image-prep";
import { describeFailure, deleteUploads } from "@/lib/connection";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  LoaderCircle,
  ScanLine,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTeacher } from "./teacher-context";
import { Action, PageTitle, Pick, Pill, SectionTitle } from "./teacher-shared";
import { catalogFor } from "@/lib/teacher-catalog";
import { gradeForSubject, gradeLabel, gradeOptions } from "@/lib/grade-labels";
import { makeManualQuestions, reconcileEvidence } from "@/lib/teacher-data";
import { safePdfText } from "@/lib/pdf-text";
import { frameworkOptions } from "@/lib/states";
import { StandardsLoader } from "./teacher-classes";
import { ScanCamera } from "./scan-camera";
import {
  activeQuestions,
  mergeStudentResponses,
  parseAnswerKey,
  preparationGaps,
} from "@/lib/teacher-workflow";
import type { Assessment, ElaArea, Question, Subject } from "@/lib/teacher-types";
import { elaAreaLabel, offeredElaAreas } from "@/lib/ela";
import {
  defaultRubric,
  WRITING_GENRES,
  type WritingGenre,
} from "@/lib/writing-rubrics";

type Uploaded = { id: string; name: string; size: number; mime: string };
export function ScanView() {
  const { w, classroom, assessments, students, save, busy, aiReady, quota, go } =
    useTeacher();
  const params = useSearchParams();
  const mode = params.get("mode") === "responses" ? "responses" : "assignment";
  // The server refuses a scan past the plan's limit with a 402, which used to
  // arrive only after the teacher had uploaded and waited. Say so up front and
  // leave the manual path open. A host with no plans reports no quota at all,
  // and must never be blocked by this.
  const outOfScans = Boolean(quota && !quota.canScan);
  // Whether uploading a blank assessment reads it straight away. False only
  // where reading is unavailable, and there the manual save stays.
  const autoReads = mode === "assignment" && aiReady && !outOfScans;
  const [phase, setPhase] = useState(1),
    [source, setSource] = useState("upload");
  const [title, setTitle] = useState(""),
    [subject, setSubject] = useState<Subject>("Math"),
    // Which ELA area, when the subject is ELA. Ignored for Math.
    [elaArea, setElaArea] = useState<ElaArea>("reading"),
    // The writing genre, when the ELA area is Writing. Picks the default rubric.
    [genre, setGenre] = useState<WritingGenre>("informational");
  const [grade, setGrade] = useState(String(classroom.grade)),
    [framework, setFramework] = useState(
      classroom.demo ? "California" : classroom.framework,
    );
  const [targets, setTargets] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [linked, setLinked] = useState<string[]>([]);
  const [text, setText] = useState(""),
    [files, setFiles] = useState<Uploaded[]>([]);
  // Reading comprehension: the transcribed story/passage the questions are
  // about, captured before the questions and attached to the read so each
  // question is classified against the text it refers to.
  const [passage, setPassage] = useState(""),
    [passageOpen, setPassageOpen] = useState(false),
    [passageReading, setPassageReading] = useState(false);
  // What the whole assessment is worth (optional). Kept as a string for the
  // input; parsed to a number in makeAssessment.
  const [points, setPoints] = useState("");
  const [uploading, setUploading] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [error, setError] = useState(""),
    [readNotice, setReadNotice] = useState(""),
    [drag, setDrag] = useState(false);
  const [assessmentId, setAssessmentId] = useState(
      params.get("assessment") || "",
    ),
    [studentId, setStudentId] = useState(params.get("student") || "");
  // The assessment this scan session has created. Once set, adding more pages
  // re-reads the whole set into THIS assessment rather than spawning a second
  // one -- so a multi-page test comes out as one test. See analyze().
  const [createdId, setCreatedId] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const passageInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const chosen = assessments.find((a) => a.id === assessmentId);
  // Edit the assessment named in the URL, or the one this session just created
  // (createdId). The latter is what lets a second page re-read into the same
  // test instead of making a new one.
  const editId =
    (mode === "assignment" && (params.get("assessment") || createdId)) || "";
  const editing = editId ? assessments.find((a) => a.id === editId) : undefined;
  const catalog = catalogFor(w, Number(grade), framework, subject).filter(
    (s) => !/not applicable/i.test(s.summary),
  );
  const matching = catalog.filter((s) =>
    (s.code + " " + (s.officialCode || "") + " " + s.title + " " + s.summary)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = targets.filter((code) =>
    catalog.some((s) => s.code === code),
  );
  // What gets sent for reading. `selected` drops any code the catalog cannot
  // currently vouch for, which is right for the picker but wrong here: if the
  // catalog for this grade and subject is momentarily short a code the teacher
  // already chose, their choice is not thereby undone, and dropping it silently
  // left the read with nothing to match against.
  const standardsForReading = selected.length ? selected : targets;
  // Writing skips the standards picker and the document read: the rubric is the
  // whole setup, so phase 1 offers a genre and creates the assessment directly.
  const isWriting = subject === "ELA" && elaArea === "writing";
  // Reading comprehension: the questions are about a shared story, so the story
  // is asked for before the questions and travels with the read.
  const isReading = mode === "assignment" && subject === "ELA" && elaArea === "reading";
  const prepared = chosen && preparationGaps(chosen).ready;
  useEffect(() => {
    const id = params.get("assessment"),
      student = params.get("student");
    if (id && assessments.some((a) => a.id === id)) setAssessmentId(id);
    else if (!assessments.some((a) => a.id === assessmentId))
      setAssessmentId(
        assessments.find((a) => preparationGaps(a).ready)?.id ||
          assessments[0]?.id ||
          "",
      );
    if (student && students.some((s) => s.id === student))
      setStudentId(student);
    else if (!students.some((s) => s.id === studentId))
      setStudentId(students[0]?.id || "");
  }, [params, assessments.length, students.length]);
  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setSubject(editing.subject);
    setElaArea(editing.elaArea || "reading");
    setGenre(editing.genre || "informational");
    setGrade(String(editing.grade));
    setFramework(editing.framework);
    setTargets(editing.targetStandards);
    setPoints(editing.pointsPossible ? String(editing.pointsPossible) : "");
  }, [editing?.id]);
  function scopeChange(field: string, value: string) {
    setTargets([]);
    setSearch("");
    if (field === "grade") setGrade(value);
    if (field === "subject") {
      setSubject(value as Subject);
      // Calculus (grade 13) exists only for Math. Leaving another subject on
      // it would show an empty picker, so drop it back to grade 12.
      setGrade((g) => String(gradeForSubject(Number(g), value)));
    }
    if (field === "framework") setFramework(value);
  }
  async function upload(list: FileList | File[] | null) {
    if (!list) return;
    // Dropping the files on the floor because a read is already running looks
    // identical to the upload silently failing. Say so.
    if (uploading || analyzing) {
      setError(
        analyzing
          ? "Still reading the last page — try again once it finishes."
          : "Still uploading — try again in a moment.",
      );
      return;
    }
    const incoming = Array.from(list);
    if (files.length + incoming.length > 6) {
      setError("Choose up to six pages or files for one analysis.");
      return;
    }
    if (
      files.reduce((n, f) => n + f.size, 0) +
        incoming.reduce((n, f) => n + f.size, 0) >
      12 * 1024 * 1024
    ) {
      setError("Keep each analysis under 12 MB in total.");
      return;
    }
    setError("");
    setUploading(true);
    const uploadedIds: string[] = [];
    let failed = false;
    try {
      // A phone records its rotation in EXIF instead of rotating the pixels,
      // so a page shot in portrait arrives sideways. Straighten each page once
      // here, before upload, so the stored file and everything downstream
      // agree. Straightening is CPU work on the device and gains nothing from
      // running in parallel, so it stays sequential to keep memory low on a
      // phone.
      const prepped: File[] = [];
      for (const raw of incoming) prepped.push(await uprightPage(raw));
      // Uploading, though, is network-bound: on a classroom connection the wait
      // is almost all round-trip latency, so sending every page at once instead
      // of one after another is where a multi-page read gets noticeably faster.
      // Order is preserved -- Promise.all resolves in input order -- so page N
      // stays page N.
      const uploaded = await Promise.all(prepped.map((f) => uploadFile(f)));
      setFiles((previous) => [...previous, ...uploaded]);
      uploadedIds.push(...uploaded.map((d) => d.id));
      if (!title && mode === "assignment" && prepped[0])
        setTitle(prepped[0].name.replace(/\.[^.]+$/, ""));
      // Without an AI connection, a typed PDF can still fill the questions
      // or answers automatically. This read is best-effort -- safePdfText
      // swallows a decode failure so a PDF the browser cannot read still
      // uploads and is saved, rather than failing the whole upload.
      if (!aiReady) {
        for (const f of prepped) {
          if (f.type !== "application/pdf") continue;
          const extracted = await safePdfText(await f.arrayBuffer());
          if (extracted) {
            setText((previous) =>
              (previous.trim() ? previous.trimEnd() + "\n\n" : "") + extracted,
            );
            setReadNotice(
              mode === "responses"
                ? "Answers were read from the PDF. Save to review them against your key."
                : "Questions were read from the PDF. Save the assessment to review them.",
            );
          }
        }
      }
    } catch (e) {
      failed = true;
      setError(describeFailure(e, "Upload failed. Please try again."));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
    // Uploading no longer reads. A blank test used to read after every upload
    // batch, so a teacher who photographed pages one at a time -- open camera,
    // one page, Done; open camera, one page, Done -- paid for a full read on
    // each page, and each read re-read the pages before it. Student work never
    // did this: it collects every page, then reads once when the teacher taps
    // "Check student work". The blank test now works the same way -- take all
    // the pages (any number of camera sessions or file picks), then one tap on
    // "Read the assessment" reads the whole set together.
  }
  // Reading comprehension: transcribe the story from photos/PDF into the passage
  // text, so it can be attached to the question read and kept on the assessment.
  async function readPassage(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (!incoming.length || passageReading) return;
    setPassageReading(true);
    setError("");
    try {
      const ids: string[] = [];
      for (const raw of incoming) {
        const page = await uprightPage(raw);
        const d = await uploadFile(page);
        ids.push(d.id);
      }
      const d = await analyzeRequest({
        mode: "passage",
        uploadIds: ids,
        grade: Number(grade),
        subject,
        framework,
      });
      const read = String(d.result.text || "").trim();
      if (!read) {
        setError("No text could be read from those pages. Try a clearer photo, or paste the passage.");
        return;
      }
      setPassage((prev) => (prev.trim() ? prev.trimEnd() + "\n\n" : "") + read);
      // The text is out of the photos now; they have nothing left to give.
      await deleteUploads(ids).catch(() => {});
    } catch (e) {
      setError(describeFailure(e, "The passage couldn’t be read."));
    } finally {
      setPassageReading(false);
    }
  }
  function makeAssessment(
    questions: Question[],
    origin: "manual" | "ai",
    storeIds: string[],
    suggestedTitle?: string,
  ): Assessment {
    return {
      id: editing?.id || crypto.randomUUID(),
      classId: classroom.id,
      // Trim to the database's 1-200 char limit so a long typed or AI title can
      // never fail the save with assessments_title_check.
      title: (title.trim() || suggestedTitle || "Untitled assessment").slice(
        0,
        200,
      ),
      subject,
      // Only ELA carries an area; Math leaves it unset.
      elaArea: subject === "ELA" ? elaArea : undefined,
      // Reading comprehension keeps the transcribed story on the assessment, so
      // it travels with every student's grading (passageForGrading) just as the
      // question read used it. Other areas keep whatever was already there.
      passage: isReading && passage.trim() ? passage.trim() : editing?.passage,
      grade: Number(grade),
      framework,
      createdAt: editing?.createdAt || new Date().toISOString(),
      status: questions.length ? "Needs review" : "Draft",
      questions,
      responses: [],
      // storeIds are the pages this read actually covered. Using them (rather
      // than the `files` state, which lags a render behind the upload that
      // triggered the read) keeps every page that was read recorded on the
      // assessment, so a re-read over the whole set does not drop page 2.
      uploadIds: editing
        ? [...new Set([...editing.uploadIds, ...storeIds])]
        : storeIds,
      assignmentUploadIds: storeIds.length
        ? [...new Set([...(editing?.assignmentUploadIds || []), ...storeIds])]
        : editing?.assignmentUploadIds || [],
      source: origin,
      targetStandards: standardsForReading,
      answerKeyVerified: false,
      // Optional whole-test total. A blank, zero or non-number clears it, so a
      // score shows as a percentage only. Editing keeps whatever was set unless
      // the field was changed.
      pointsPossible:
        points.trim() && Number(points) > 0
          ? Math.round(Number(points))
          : undefined,
      ...(editing
        ? { classIds: editing.classIds }
        : linked.length
          ? { classIds: [...new Set([classroom.id, ...linked])] }
          : {}),
    };
  }
  async function saveManual() {
    if (!selected.length) {
      setPhase(1);
      setError("Choose at least one intended standard.");
      return;
    }
    const a = makeAssessment(
      makeManualQuestions(text),
      "manual",
      files.map((f) => f.id),
    );
    if (
      await save(
        {
          ...w,
          assessments: editing
            ? w.assessments.map((item) => (item.id === a.id ? a : item))
            : [a, ...w.assessments],
          students: editing ? reconcileEvidence(w.students, a) : w.students,
        },
        editing ? "Revised assessment saved for review" : "Assessment saved",
      )
    )
      go("/assessments?id=" + a.id);
  }
  // Writing needs no document read and no answer key: the assessment is the
  // rubric. Build it from the genre and grade, save, and go to its detail page
  // where the teacher confirms the rubric and adds each student's essay.
  async function createWriting() {
    const base = makeAssessment([], "manual", []);
    const a: Assessment = {
      ...base,
      elaArea: "writing",
      genre,
      rubric: defaultRubric(genre, Number(grade)),
      status: "Ready",
    };
    if (
      await save(
        {
          ...w,
          assessments: editing
            ? w.assessments.map((item) => (item.id === a.id ? a : item))
            : [a, ...w.assessments],
        },
        editing ? "Writing assessment updated" : "Writing assessment created",
      )
    )
      go("/assessments?id=" + a.id);
  }
  async function saveStudentManually() {
    if (!chosen || !studentId || !prepared) return;
    const answers = parseAnswerKey(text, activeQuestions(chosen));
    if (text.trim() && !Object.keys(answers).length) {
      setError(
        "Start each answer with its question number, for example 1. 238.",
      );
      return;
    }
    if (files.length || Object.keys(answers).length) {
      const captured = Object.entries(answers).map(([questionId, answer]) => ({
        id: crypto.randomUUID(),
        questionId,
        studentId,
        answer,
        correct: false,
        confidence: 100,
        verified: false,
        misconception:
          "Compare this entered answer with the teacher key before confirming.",
      }));
      const a = {
        ...chosen,
        responses: [
          ...chosen.responses.filter(
            (r) =>
              r.studentId !== studentId || answers[r.questionId] === undefined,
          ),
          ...captured,
        ],
        uploadIds: [
          ...new Set([...chosen.uploadIds, ...files.map((f) => f.id)]),
        ],
        studentUploadIds: {
          ...chosen.studentUploadIds,
          [studentId]: [
            ...new Set([
              ...(chosen.studentUploadIds?.[studentId] || []),
              ...files.map((f) => f.id),
            ]),
          ],
        },
      };
      if (
        !(await save(
          {
            ...w,
            assessments: w.assessments.map((x) => (x.id === a.id ? a : x)),
            students: reconcileEvidence(w.students, a),
          },
          "Student work saved for review",
        ))
      )
        return;
    }
    go(
      "/assessments?id=" + assessmentId + "&tab=responses&student=" + studentId,
    );
  }
  /**
   * `ids` lets the caller name the uploads to read. The auto-read fires from
   * inside upload(), where the files it just stored are not in React state
   * yet, so reading `files` there would analyse the previous batch.
   */
  async function analyze(ids?: string[], navigate = false, fresh = false) {
    // These used to be bare returns. When one of them fired -- on upload, or on
    // the teacher pressing "Read it again" -- the reading simply did not happen
    // and nothing on screen changed: no spinner, no error, no explanation. A
    // pilot teacher reported it for days as "it still does not autoread", and
    // it was invisible from this side because nothing was ever recorded. Say
    // what is missing instead, so the next report comes with a reason attached.
    if (mode === "assignment" && !standardsForReading.length) {
      setPhase(1);
      setError("Choose at least one intended standard, then the test will be read.");
      return;
    }
    if (mode === "responses" && !chosen) {
      setError("Choose which assessment this work belongs to.");
      return;
    }
    if (mode === "responses" && !studentId) {
      setError("Choose which student this work belongs to.");
      return;
    }
    if (mode === "responses" && !prepared) {
      setError("Confirm this assessment's standards and answer key before grading work against it.");
      return;
    }
    const uploadIds = ids ?? files.map((f) => f.id);
    if (!uploadIds.length && !text.trim()) {
      setError("Add a page or some text first.");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const d = await analyzeRequest({
        mode,
        text,
        uploadIds,
        grade: mode === "responses" ? chosen!.grade : Number(grade),
        subject: mode === "responses" ? chosen!.subject : subject,
        framework: mode === "responses" ? chosen!.framework : framework,
        targetStandards: standardsForReading,
        assessmentId,
        studentId,
        freshRead: fresh,
        // Reading comprehension: connect the questions to the story they're about.
        passage: isReading && passage.trim() ? passage : undefined,
      });
      if (mode === "assignment") {
        // A read that found nothing is not an assessment. Saving an empty one
        // buries the upload behind a "Draft" with zero questions and tells the
        // teacher nothing about why. Keep the pages on screen so they can remove
        // this one or add the right page, and say what to check.
        if (!d.result.questions.length) {
          setError(
            "We didn’t find any questions on this page. Make sure it’s the worksheet or test, and that the photo is clear.",
          );
          return;
        }
        const a = makeAssessment(d.result.questions, "ai", uploadIds, d.result.title);
        const pages = a.assignmentUploadIds?.length || uploadIds.length;
        if (
          await save(
            {
              ...w,
              assessments: editing
                ? w.assessments.map((item) => (item.id === a.id ? a : item))
                : [a, ...w.assessments],
              students: editing ? reconcileEvidence(w.students, a) : w.students,
            },
            `${a.questions.length} question${a.questions.length === 1 ? "" : "s"} read from ${pages} page${pages === 1 ? "" : "s"} — add more pages, or continue to review`,
          )
        ) {
          // Stay on the scan view and remember this assessment. Adding another
          // page re-reads the whole set INTO this same assessment (editing is
          // now this id), so the questions come out as one test spanning every
          // page, not one test per page. The teacher leaves with "Continue to
          // review". Only an explicit navigate (unused today) would leave here.
          setCreatedId(a.id);
          if (navigate) go("/assessments?id=" + a.id);
        }
      } else {
        // A second scan for the same student is another page of the same
        // test, not a replacement for the first. Layer it over what is already
        // there so questions this pass could not see keep the answers an
        // earlier page supplied, instead of coming back blank.
        const a = {
          ...chosen!,
          responses: [
            ...chosen!.responses.filter((r) => r.studentId !== studentId),
            ...mergeStudentResponses(
              chosen!.responses.filter((r) => r.studentId === studentId),
              d.result.responses,
            ),
          ],
          uploadIds: [...chosen!.uploadIds, ...uploadIds],
          studentUploadIds: {
            ...chosen!.studentUploadIds,
            [studentId]: [
              ...new Set([
                ...(chosen!.studentUploadIds?.[studentId] || []),
                ...uploadIds,
              ]),
            ],
          },
        };
        if (
          await save(
            {
              ...w,
              assessments: w.assessments.map((x) => (x.id === a.id ? a : x)),
              students: reconcileEvidence(w.students, a),
            },
            "Student work is ready to review",
          )
        )
          go("/assessments?id=" + a.id + "&tab=responses&student=" + studentId);
      }
    } catch (e) {
      setError(
        describeFailure(
          e,
          "The analysis couldn’t be completed. Your files are still saved.",
        ),
      );
    } finally {
      setAnalyzing(false);
    }
  }
  const contentReady = !!files.length || !!text.trim();
  // Whether this assessment has already been read once, so the button reads
  // "Read it again" rather than "Read the assessment".
  const hasRead = !!createdId || (editing?.questions?.length ?? 0) > 0;
  return (
    <>
      <button
        className="back-link"
        onClick={() =>
          go(
            mode === "responses" && chosen
              ? "/assessments?id=" + chosen.id + "&tab=responses"
              : "/assessments",
          )
        }
      >
        <ArrowLeft size={16} />
        {mode === "responses" ? "Back to student work" : "All assessments"}
      </button>
      <PageTitle
        eyebrow=""
        title={
          mode === "responses"
            ? "Scan student work"
            : editing
              ? "Upload a revised assessment"
              : "New assessment"
        }
        description={
          mode === "responses"
            ? "Add one student’s pages. We’ll compare their answers with your confirmed key."
            : editing
              ? "Keep the same intended standards, then check how the revised questions align."
              : "Start with the standards you want the assessment to measure."
        }
      />
      <div className="focused-scan">
        {mode === "assignment" && (
          <div className="scan-progress" aria-label="Assessment setup">
            <button
              onClick={() => setPhase(1)}
              aria-current={phase === 1 ? "step" : undefined}
            >
              <span>{phase > 1 ? <Check size={15} /> : 1}</span>Choose standards
            </button>
            <span className="scan-progress-line" />
            <button
              onClick={() => selected.length && setPhase(2)}
              disabled={!selected.length}
              aria-current={phase === 2 ? "step" : undefined}
            >
              <span>2</span>Upload assessment
            </button>
          </div>
        )}
        {mode === "assignment" && phase === 1 ? (
          <section className="panel setup-panel">
            <div className="scan-scope-layout">
              <div className="scope-controls">
                <h2>Assessment details</h2>
                <p>Choose the grade and subject first.</p>
                <div className="form-grid">
                  <label>
                    {subject === "Math" ? "Grade or course" : "Grade"}
                    <Pick
                      label="Assessment grade"
                      value={grade}
                      onChange={(v) => scopeChange("grade", v)}
                      options={gradeOptions(subject)}
                    />
                  </label>
                  <label>
                    Subject
                    <Pick
                      label="Assessment subject"
                      value={subject}
                      onChange={(v) => scopeChange("subject", v)}
                      options={["Math", "ELA"]}
                    />
                  </label>
                  {subject === "ELA" && (
                    <label className="full">
                      ELA area
                      <Pick
                        label="ELA area"
                        value={elaArea}
                        onChange={(v) => setElaArea(v as ElaArea)}
                        options={offeredElaAreas().map((a) => ({
                          value: a.value,
                          label: a.label,
                        }))}
                      />
                    </label>
                  )}
                  <label className="full">
                    Standards
                    <Pick
                      label="Standards framework"
                      value={framework}
                      onChange={(v) => scopeChange("framework", v)}
                      options={frameworkOptions(
                        w.customStandards.map((s) => s.framework),
                      )}
                    />
                  </label>
                </div>
                {!editing && w.classes.length > 1 && (
                  <div className="link-classes">
                    <strong>Use this assessment in</strong>
                    <p>
                      Questions and the answer key are shared. Each class keeps
                      its own student work.
                    </p>
                    <label className="locked">
                      <Checkbox checked disabled aria-label={classroom.name} />
                      {classroom.name} (this class)
                    </label>
                    {w.classes
                      .filter((c) => c.id !== classroom.id)
                      .map((c) => (
                        <label key={c.id}>
                          <Checkbox
                            checked={linked.includes(c.id)}
                            onCheckedChange={(v) =>
                              setLinked((previous) =>
                                v
                                  ? [...previous, c.id]
                                  : previous.filter((x) => x !== c.id),
                              )
                            }
                          />
                          {c.name}
                          <span className="cell-meta">
                            {c.grade === 0 ? "K" : "Grade " + c.grade}
                          </span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
              {isWriting ? (
                <div className="standards-menu">
                  <div className="target-picker-heading">
                    <div>
                      <h2>What kind of writing?</h2>
                      <p>
                        Pick the genre. We&apos;ll start you on California&apos;s
                        rubric for this grade — you can view and edit it next.
                      </p>
                    </div>
                  </div>
                  <div className="target-standard-list">
                    {WRITING_GENRES.map((option) => (
                      <label
                        key={option.value}
                        className={
                          "target-standard-option genre-option " +
                          (genre === option.value ? "selected" : "")
                        }
                      >
                        <input
                          type="radio"
                          name="writing-genre"
                          checked={genre === option.value}
                          onChange={() => setGenre(option.value)}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <p>{option.hint}</p>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
              <div className="standards-menu">
                <div className="target-picker-heading">
                  <div>
                    <h2>What should this assessment measure?</h2>
                    <p>Select the standards you’re teaching.</p>
                  </div>
                  <Pill tone={selected.length ? "green" : "neutral"}>
                    {selected.length} selected
                  </Pill>
                </div>
                {catalog.length > 0 ? (
                  <>
                    <label className="search-box standard-search">
                      <Search size={17} />
                      <input
                        aria-label="Find an intended standard"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by skill or standard code…"
                      />
                    </label>
                    <div className="target-standard-list">
                      {matching.map((s) => (
                        <label
                          key={s.code}
                          className={
                            "target-standard-option " +
                            (selected.includes(s.code) ? "selected" : "")
                          }
                        >
                          <Checkbox
                            checked={selected.includes(s.code)}
                            onCheckedChange={(v) =>
                              setTargets((previous) =>
                                v
                                  ? [...previous, s.code]
                                  : previous.filter((x) => x !== s.code),
                              )
                            }
                          />
                          <span>
                            <strong>{s.title}</strong>
                            <span>{s.officialCode || s.code}</span>
                            <p>{s.summary}</p>
                          </span>
                        </label>
                      ))}
                      {!matching.length && (
                        <p className="quiet-empty">
                          No matching standards. Try another code or skill.
                        </p>
                      )}
                    </div>
                    {selected.length > 0 && (
                      <div className="selected-targets">
                        {selected.map((code) => (
                          <button
                            key={code}
                            onClick={() =>
                              setTargets((previous) =>
                                previous.filter((x) => x !== code),
                              )
                            }
                            aria-label={"Remove " + code}
                          >
                            {code}
                            <X size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <StandardsLoader
                    grade={Number(grade)}
                    framework={framework}
                    subject={subject}
                  />
                )}
              </div>
              )}
            </div>
            <div className="setup-footer">
              <span>
                {isWriting
                  ? "You'll confirm the rubric and add each student's writing next."
                  : "Your selections guide alignment and coverage."}
              </span>
              {isWriting ? (
                <Action disabled={busy} onClick={createWriting}>
                  {editing ? "Save writing assessment" : "Create writing assessment"}
                  <ArrowRight size={17} />
                </Action>
              ) : (
                <Action disabled={!selected.length} onClick={() => setPhase(2)}>
                  Continue to upload
                  <ArrowRight size={17} />
                </Action>
              )}
            </div>
          </section>
        ) : (
          <>
            {mode === "responses" ? (
              <section className="panel setup-panel scan-student-context">
                <div className="form-grid">
                  <label>
                    Assessment
                    <Pick
                      label="Assessment to grade"
                      value={assessmentId}
                      onChange={setAssessmentId}
                      options={assessments.map((a) => ({
                        value: a.id,
                        label: a.title,
                      }))}
                    />
                  </label>
                  <label>
                    Student
                    <Pick
                      label="Student whose pages you are adding"
                      value={studentId}
                      onChange={setStudentId}
                      options={students.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                    />
                  </label>
                </div>
                {chosen && (
                  <p className="field-help">
                    {chosen.subject} · {gradeLabel(chosen.grade, chosen.subject)} ·{" "}
                    {chosen.framework}{" "}
                    · {chosen.questions.filter((q) => !q.excluded).length}{" "}
                    questions
                  </p>
                )}
                {!prepared && (
                  <div className="review-notice">
                    <p>
                      Confirm this assessment’s standards and answer key before
                      scanning student work.
                    </p>
                    <button
                      className="text-link"
                      onClick={() =>
                        go(chosen ? "/assessments?id=" + chosen.id : "/scan")
                      }
                    >
                      Review assessment
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                {!students.length && (
                  <Action variant="secondary" onClick={() => go("/students")}>
                    Add students first
                    <ArrowRight size={16} />
                  </Action>
                )}
              </section>
            ) : (
              <div className="scan-scope-summary">
                <div>
                  <Pill>{gradeLabel(Number(grade), subject)}</Pill>
                  <Pill>{subject}</Pill>
                  {subject === "ELA" && elaAreaLabel(elaArea) && (
                    <Pill>{elaAreaLabel(elaArea)}</Pill>
                  )}
                  <span>
                    {framework} · {selected.length} intended standards
                  </span>
                </div>
                <button className="text-link" onClick={() => setPhase(1)}>
                  Edit standards
                </button>
              </div>
            )}
            {isReading && (
              <section className="panel setup-panel">
                <SectionTitle
                  title="1. The reading passage"
                  description="Add the story or passage first. The questions are read against it, so the AI knows what each one is really asking."
                >
                  {passage.trim() ? (
                    <Pill tone="green">
                      {passage.trim().split(/\s+/).length} words
                    </Pill>
                  ) : null}
                </SectionTitle>
                <div className="key-source-actions">
                  <Action
                    variant="secondary"
                    disabled={passageReading || !aiReady}
                    onClick={() => setPassageOpen(true)}
                  >
                    {passageReading ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Camera size={17} />
                    )}
                    Photograph the story
                  </Action>
                  <Action
                    variant="secondary"
                    disabled={passageReading || !aiReady}
                    onClick={() => passageInput.current?.click()}
                  >
                    <Upload size={17} />
                    Upload pages
                  </Action>
                  <input
                    ref={passageInput}
                    type="file"
                    className="sr-only"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    aria-label="Upload pages of the reading passage"
                    onChange={(e) => {
                      readPassage(e.target.files);
                      if (passageInput.current) passageInput.current.value = "";
                    }}
                  />
                </div>
                {passageReading && (
                  <div className="read-document-status" role="status">
                    <LoaderCircle className="spin" size={18} />
                    <p>Reading the passage…</p>
                  </div>
                )}
                <label className="block-label">
                  Or paste the passage
                  <textarea
                    value={passage}
                    onChange={(e) => setPassage(e.target.value)}
                    placeholder="Paste the story or article the questions are about."
                    rows={5}
                  />
                </label>
                {passageOpen && (
                  <ScanCamera
                    mode="single"
                    title="Reading passage"
                    assessmentId={createdId || editing?.id || "passage-draft"}
                    onComplete={(groups) => {
                      setPassageOpen(false);
                      const captured = groups.flat();
                      if (captured.length) readPassage(captured);
                    }}
                    onCancel={() => setPassageOpen(false)}
                    onFallback={() => {
                      setPassageOpen(false);
                      passageInput.current?.click();
                    }}
                  />
                )}
              </section>
            )}
            <section className="panel setup-panel upload-work-panel">
              {isReading && (
                <p className="field-help key-step-note">
                  2. Now add the questions. They’ll be read against the passage
                  above.
                </p>
              )}
              {mode === "assignment" && (
                <label className="block-label assignment-title-input">
                  Assessment name
                  <input
                    value={title}
                    maxLength={150}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Multiplication · Week 3"
                  />
                </label>
              )}
              {mode === "assignment" && (
                <label className="block-label">
                  Points possible (optional)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    placeholder="e.g. 20"
                  />
                  <span className="field-help">
                    Set the total and a score shows both ways — 90% and 18/20.
                  </span>
                </label>
              )}
              <div className="upload-privacy" role="note">
                <ShieldCheck size={17} aria-hidden="true" />
                <div>
                  <strong>Upload only what the analysis needs.</strong>
                  <p>
                    {mode === "responses"
                      ? "Student first names, initials, or a label like “Student 4” are enough. Leave off last names, student ID numbers, addresses, birth dates, medical information, and IEP or 504 records."
                      : "Blank assessments only. If a copy has student names or ID numbers on it, cover or crop them before uploading."}
                  </p>
                  <a href="/legal/student-data-privacy" target="_blank" rel="noreferrer">
                    How we protect student work
                  </a>
                </div>
              </div>
              <Tabs value={source} onValueChange={setSource}>
                <TabsList className="text-tabs">
                  <TabsTrigger value="upload">Upload or photograph</TabsTrigger>
                  <TabsTrigger value="paste">
                    {mode === "responses"
                      ? "Paste student answers"
                      : "Paste questions"}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="upload">
                  <div
                    className={
                      "dropzone calm-dropzone " + (drag ? "dragging" : "")
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      upload(e.dataTransfer.files);
                    }}
                  >
                    <ScanLine size={38} strokeWidth={1.4} />
                    <h2>
                      {uploading
                        ? "Uploading…"
                        : mode === "responses"
                          ? "Add this student’s pages"
                          : "Add the blank assessment"}
                    </h2>
                    <p>
                      {mode === "responses"
                        ? "Keep one student’s pages together."
                        : "Drop a worksheet, assessment, or quiz here."}
                    </p>
                    <div className="drop-actions">
                      <Action
                        onClick={() => input.current?.click()}
                        disabled={uploading || analyzing}
                      >
                        <Upload size={16} />
                        Choose files
                      </Action>
                      <Action
                        variant="secondary"
                        onClick={() => setCameraOpen(true)}
                        disabled={uploading || analyzing}
                      >
                        <Camera size={16} />
                        Take a photo
                      </Action>
                    </div>
                    <span className="file-limits">
                      PDF, JPG, PNG or WebP · 8 MB per file · 6 files / 12 MB
                      total
                    </span>
                    <input
                      ref={input}
                      type="file"
                      className="sr-only"
                      multiple
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      aria-label="Choose work to upload"
                      onChange={(e) => upload(e.target.files)}
                    />
                    {cameraOpen && (
                      <ScanCamera
                        mode="single"
                        title={mode === "responses" ? "Student pages" : "Blank assessment"}
                        assessmentId={createdId || editing?.id || "scan-draft"}
                        onComplete={(groups) => {
                          setCameraOpen(false);
                          const captured = groups.flat();
                          if (captured.length) upload(captured);
                        }}
                        onCancel={() => setCameraOpen(false)}
                        onFallback={() => {
                          setCameraOpen(false);
                          input.current?.click();
                        }}
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="paste">
                  <label className="block-label">
                    {mode === "responses"
                      ? "Student’s written answers"
                      : "Questions and reading passages"}
                    <textarea
                      className="question-paste"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={
                        mode === "responses"
                          ? "1. 238\n2. 42,306 < 42,360"
                          : "1. Solve 34 × 7. Show your work.\n\n2. Compare 42,306 and 42,360."
                      }
                    />
                  </label>
                  <p className="field-help">
                    {mode === "responses"
                      ? "Keep the question numbers with the student’s answers."
                      : "Separate questions with a blank line. Keep reading passages with their questions."}
                  </p>
                </TabsContent>
              </Tabs>
              {files.length > 0 && (
                <div className="uploaded-list">
                  {files.map((f) => (
                    <div key={f.id}>
                      <FileText size={19} />
                      <div>
                        <strong>{f.name}</strong>
                        <span>{Math.ceil(f.size / 1024)} KB · Uploaded</span>
                      </div>
                      <a
                        href={"/api/uploads/" + f.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                      <button
                        aria-label={"Remove " + f.name + " from this upload"}
                        disabled={uploading || analyzing}
                        onClick={async () => {
                          const r = await fetch("/api/uploads/" + f.id, {
                            method: "DELETE",
                          });
                          if (r.ok)
                            setFiles((previous) =>
                              previous.filter((x) => x.id !== f.id),
                            );
                          else
                            toast.error("This document couldn’t be removed.");
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mode === "assignment" && (
                <p className="field-help key-step-note">
                  Next, the questions are read into the assessment for your
                  review. Then you’ll add or confirm your answer key.
                </p>
              )}
            </section>
            {(uploading || analyzing) && (
              <div className="review-notice" role="status" aria-live="polite">
                <LoaderCircle size={19} className="spin" />
                <p>
                  {uploading
                    ? "Uploading your pages…"
                    : mode === "responses"
                      ? "Reading the student work — this can take a little longer for a full class set."
                      : "Reading the assessment — longer tests take a little longer to read."}
                </p>
              </div>
            )}
            {readNotice && (
              <div className="review-notice" role="status">
                <FileText size={19} />
                <p>{readNotice}</p>
              </div>
            )}
            {!aiReady && !readNotice && (
              <div className="review-notice">
                <FileText size={19} />
                <p>
                  Typed PDFs are read automatically. Reading photographs needs
                  an AI connection; you can save the upload and enter questions
                  and answers manually.
                </p>
              </div>
            )}
            {outOfScans && (
              <div className="review-notice" data-tone="warn">
                <FileText size={19} />
                <p>
                  This period’s credits are used up ({quota!.used} of{" "}
                  {quota!.quota}). You can still save the assessment and enter
                  questions and answers by hand — reading it automatically
                  needs more credits.
                </p>
              </div>
            )}
            <div className="setup-footer scan-submit">
              <span>
                Review every suggestion before it becomes student evidence.
              </span>
              <div>
                {mode === "assignment" && !autoReads && (
                  <Action
                    disabled={busy || uploading || analyzing || !contentReady}
                    onClick={saveManual}
                  >
                    Save assessment
                    <ArrowRight size={17} />
                  </Action>
                )}
                {aiReady && (
                  <Action
                    disabled={
                      busy ||
                      uploading ||
                      analyzing ||
                      outOfScans ||
                      !contentReady ||
                      (mode === "responses" && (!prepared || !studentId))
                    }
                    onClick={() => analyze(undefined, false, true)}
                  >
                    {analyzing ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <ScanLine size={17} />
                    )}{" "}
                    {analyzing
                      ? "Reading the work…"
                      : mode === "responses"
                        ? "Check student work"
                        : hasRead
                          ? "Read it again"
                          : "Read the assessment"}
                  </Action>
                )}
                {mode === "assignment" && editId && (
                  <Action
                    disabled={busy || uploading || analyzing}
                    onClick={() => go("/assessments?id=" + editId)}
                  >
                    Continue to review
                    <ArrowRight size={17} />
                  </Action>
                )}
                {!aiReady && mode === "responses" && (
                  <Action
                    disabled={
                      !chosen || !studentId || !prepared || busy || uploading
                    }
                    onClick={saveStudentManually}
                  >
                    Review manually
                    <ArrowRight size={17} />
                  </Action>
                )}
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
