"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { analyzeRequest } from "@/lib/analyze-client";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  LoaderCircle,
  ScanLine,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTeacher } from "./teacher-context";
import { Action, EmptyState, PageTitle, Pick, Pill } from "./teacher-shared";
import { catalogFor } from "@/lib/teacher-catalog";
import { makeManualQuestions, reconcileEvidence } from "@/lib/teacher-data";
import { extractPdfText } from "@/lib/pdf-text";
import { frameworkOptions } from "@/lib/states";
import { StandardsLoader } from "./teacher-classes";
import {
  activeQuestions,
  parseAnswerKey,
  preparationGaps,
} from "@/lib/teacher-workflow";
import type { Assessment, Question, Subject } from "@/lib/teacher-types";

type Uploaded = { id: string; name: string; size: number; mime: string };
export function ScanView() {
  const { w, classroom, assessments, students, save, busy, aiReady, go } =
    useTeacher();
  const params = useSearchParams();
  const mode = params.get("mode") === "responses" ? "responses" : "assignment";
  const [phase, setPhase] = useState(1),
    [source, setSource] = useState("upload");
  const [title, setTitle] = useState(""),
    [subject, setSubject] = useState<Subject>("Math");
  const [grade, setGrade] = useState(String(classroom.grade)),
    [framework, setFramework] = useState(
      classroom.demo ? "California" : classroom.framework,
    );
  const [targets, setTargets] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [linked, setLinked] = useState<string[]>([]);
  const [text, setText] = useState(""),
    [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [error, setError] = useState(""),
    [readNotice, setReadNotice] = useState(""),
    [drag, setDrag] = useState(false);
  const [assessmentId, setAssessmentId] = useState(
      params.get("assessment") || "",
    ),
    [studentId, setStudentId] = useState(params.get("student") || "");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const chosen = assessments.find((a) => a.id === assessmentId);
  const editing =
    mode === "assignment" && params.get("assessment")
      ? assessments.find((a) => a.id === params.get("assessment"))
      : undefined;
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
    setGrade(String(editing.grade));
    setFramework(editing.framework);
    setTargets(editing.targetStandards);
  }, [editing?.id]);
  function scopeChange(field: string, value: string) {
    setTargets([]);
    setSearch("");
    if (field === "grade") setGrade(value);
    if (field === "subject") setSubject(value as Subject);
    if (field === "framework") setFramework(value);
  }
  async function upload(list: FileList | null) {
    if (!list || uploading || analyzing) return;
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
    try {
      for (const f of incoming) {
        const form = new FormData();
        form.append("file", f);
        const r = await fetch("/api/uploads", { method: "POST", body: form }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setFiles((previous) => [...previous, d]);
        if (!title && mode === "assignment")
          setTitle(f.name.replace(/\.[^.]+$/, ""));
        // Without an AI connection, a typed PDF can still fill the questions
        // or answers automatically.
        if (!aiReady && f.type === "application/pdf") {
          const extracted = await extractPdfText(await f.arrayBuffer());
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
      setError(
        e instanceof Error ? e.message : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }
  function makeAssessment(
    questions: Question[],
    origin: "manual" | "ai",
    suggestedTitle?: string,
  ): Assessment {
    return {
      id: editing?.id || crypto.randomUUID(),
      classId: classroom.id,
      title: title.trim() || suggestedTitle || "Untitled assessment",
      subject,
      grade: Number(grade),
      framework,
      createdAt: editing?.createdAt || new Date().toISOString(),
      status: questions.length ? "Needs review" : "Draft",
      questions,
      responses: [],
      uploadIds: editing
        ? [...new Set([...editing.uploadIds, ...files.map((f) => f.id)])]
        : files.map((f) => f.id),
      assignmentUploadIds: files.length
        ? files.map((f) => f.id)
        : editing?.assignmentUploadIds || [],
      source: origin,
      targetStandards: selected,
      answerKeyVerified: false,
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
    const a = makeAssessment(makeManualQuestions(text), "manual");
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
  async function analyze() {
    if (mode === "assignment" && !selected.length) return;
    if (mode === "responses" && (!chosen || !studentId || !prepared)) return;
    setAnalyzing(true);
    setError("");
    try {
      const d = await analyzeRequest({
        mode,
        text,
        uploadIds: files.map((f) => f.id),
        grade: mode === "responses" ? chosen!.grade : Number(grade),
        subject: mode === "responses" ? chosen!.subject : subject,
        framework: mode === "responses" ? chosen!.framework : framework,
        targetStandards: selected,
        assessmentId,
        studentId,
      });
      if (mode === "assignment") {
        const a = makeAssessment(d.result.questions, "ai", d.result.title);
        if (
          await save(
            {
              ...w,
              assessments: editing
                ? w.assessments.map((item) => (item.id === a.id ? a : item))
                : [a, ...w.assessments],
              students: editing ? reconcileEvidence(w.students, a) : w.students,
            },
            editing
              ? "Revised assessment ready for review"
              : "Assessment ready for review",
          )
        )
          go("/assessments?id=" + a.id);
      } else {
        const a = {
          ...chosen!,
          responses: [
            ...chosen!.responses.filter((r) => r.studentId !== studentId),
            ...d.result.responses,
          ],
          uploadIds: [...chosen!.uploadIds, ...files.map((f) => f.id)],
          studentUploadIds: {
            ...chosen!.studentUploadIds,
            [studentId]: files.map((f) => f.id),
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
        e instanceof Error
          ? e.message
          : "The analysis couldn’t be completed. Your files are still saved.",
      );
    } finally {
      setAnalyzing(false);
    }
  }
  const contentReady = !!files.length || !!text.trim();
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
                    Grade
                    <Pick
                      label="Assessment grade"
                      value={grade}
                      onChange={(v) => scopeChange("grade", v)}
                      options={Array.from({ length: 13 }, (_, i) => ({
                        value: String(i),
                        label: i === 0 ? "Kindergarten" : "Grade " + i,
                      }))}
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
            </div>
            <div className="setup-footer">
              <span>Your selections guide alignment and coverage.</span>
              <Action disabled={!selected.length} onClick={() => setPhase(2)}>
                Continue to upload
                <ArrowRight size={17} />
              </Action>
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
                    {chosen.subject} · Grade {chosen.grade} · {chosen.framework}{" "}
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
                  <Pill>Grade {grade}</Pill>
                  <Pill>{subject}</Pill>
                  <span>
                    {framework} · {selected.length} intended standards
                  </span>
                </div>
                <button className="text-link" onClick={() => setPhase(1)}>
                  Edit standards
                </button>
              </div>
            )}
            <section className="panel setup-panel upload-work-panel">
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
                        onClick={() => camera.current?.click()}
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
                    <input
                      ref={camera}
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      aria-label="Photograph work"
                      onChange={(e) => upload(e.target.files)}
                    />
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
            <div className="setup-footer scan-submit">
              <span>
                Review every suggestion before it becomes student evidence.
              </span>
              <div>
                {mode === "assignment" && (
                  <Action
                    variant={aiReady ? "secondary" : ""}
                    disabled={busy || uploading || analyzing || !contentReady}
                    onClick={saveManual}
                  >
                    {aiReady ? "Save without reading" : "Save assessment"}
                    <ArrowRight size={17} />
                  </Action>
                )}
                {aiReady && (
                  <Action
                    disabled={
                      busy ||
                      uploading ||
                      analyzing ||
                      !contentReady ||
                      (mode === "responses" && (!prepared || !studentId))
                    }
                    onClick={analyze}
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
                        : "Read the assessment"}
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
