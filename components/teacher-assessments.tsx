"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readJson } from "@/lib/utils";
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
  TextLink,
} from "./teacher-shared";
import { catalogFor } from "@/lib/teacher-catalog";
import {
  alignmentSuggestions,
  costaFor,
  costasLevels,
  responseMatch,
} from "@/lib/teacher-metrics";
import {
  assignmentNextStep,
  preparationGaps,
  applyAnswerKey,
} from "@/lib/teacher-workflow";
import { StudentResponseReview } from "./teacher-review";
import { AnswerKeyReview } from "./teacher-answer-key";
import {
  alignment,
  makeManualQuestions,
  reconcileEvidence,
} from "@/lib/teacher-data";
import { extractUploadedPdfText } from "@/lib/pdf-text";
import { classesFor } from "@/lib/teacher-classes";
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
    [linking, setLinking] = useState<string[] | null>(null);
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
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "assignment",
              text: "",
              uploadIds: documents,
              grade: target.grade,
              subject: target.subject,
              framework: target.framework,
              targetStandards: target.targetStandards,
            }),
          }),
          d = await readJson(r);
        if (!r.ok) throw new Error(d.error);
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
        e instanceof Error ? e.message : "The document couldn’t be read.",
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
                      {item.subject} · Grade {item.grade} ·{" "}
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
              " · GRADE " +
              a.grade +
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
          </PageTitle>
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
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="page-tabs">
              <TabsTrigger value="questions">1. Assessment review</TabsTrigger>
              <TabsTrigger value="key">2. Answer key</TabsTrigger>
              <TabsTrigger value="responses">3. Student work</TabsTrigger>
              <TabsTrigger value="coverage">Standards report</TabsTrigger>
            </TabsList>
            <TabsContent value="questions">
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
                        onClick={() => {
                          const ids = new Set(clearQuestions.map((q) => q.id));
                          const questions = a.questions.map((q) =>
                            ids.has(q.id) ? { ...q, verified: true } : q,
                          );
                          saveAssessment(
                            {
                              ...a,
                              questions,
                              status: questions.every(
                                (q) => q.verified || q.excluded,
                              )
                                ? "Ready"
                                : "Needs review",
                            },
                            clearQuestions.length +
                              " aligned questions confirmed",
                          );
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
              <AnswerKeyReview assessment={a} onSave={saveAssessment} />
            </TabsContent>
            <TabsContent value="responses">
              <StudentResponseReview
                assessment={a}
                onEdit={setResponseEdit}
                onSave={saveAssessment}
              />
            </TabsContent>
          </Tabs>
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
                </label>
              ))}
            </div>
            <Action
              disabled={busy}
              onClick={async () => {
                const classIds = [...new Set([a.classId, ...linking])];
                if (
                  await saveAssessment(
                    { ...a, classIds },
                    "Assessment shared with " + classIds.length + (classIds.length === 1 ? " class" : " classes"),
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
