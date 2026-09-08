"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CheckCheck,
  FileText,
  Flag,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTeacher } from "./teacher-context";
import {
  Action,
  Avatar,
  EmptyState,
  Pick,
  Pill,
  SectionTitle,
  printContent,
} from "./teacher-shared";
import {
  activeQuestions,
  assignmentNextStep,
  parseAnswerKey,
  preparationGaps,
  responseFlag,
  studentReport,
  studentReview,
} from "@/lib/teacher-workflow";
import { extractPdfText } from "@/lib/pdf-text";
import type { Assessment, StudentResponse } from "@/lib/teacher-types";
import { responseMatch } from "@/lib/teacher-metrics";

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
    [notice, setNotice] = useState("");
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
    await onSave(
      {
        ...a,
        responses: a.responses.map((r) =>
          ids.has(r.id) ? { ...r, verified: true } : r,
        ),
      },
      summary.clear.length + " clear answers confirmed",
    );
  }

  async function uploadPages(list: FileList | null) {
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
      for (const file of incoming) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/uploads", { method: "POST", body: form }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        ids.push(d.id);
        if (!aiReady && file.type === "application/pdf")
          pdfText += (await extractPdfText(await file.arrayBuffer())) + "\n";
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The pages couldn’t be uploaded.");
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
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "responses",
              text: "",
              uploadIds: ids,
              grade: a.grade,
              subject: a.subject,
              framework: a.framework,
              assessmentId: a.id,
              studentId: selected,
            }),
          }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
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
          (e instanceof Error ? e.message : "The pages couldn’t be read.") +
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
      <EmptyState
        title="Add your students"
        description="A name or classroom alias is enough to connect each student’s work."
      >
        <Action onClick={() => go("/students")}>
          Add students
          <ArrowRight size={16} />
        </Action>
      </EmptyState>
    );
  return (
    <div className="student-review-space">
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
              onClick={() => camera.current?.click()}
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
