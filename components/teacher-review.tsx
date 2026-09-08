"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileText,
  Flag,
  Pencil,
  Plus,
  Printer,
  Search,
} from "lucide-react";
import { useTeacher } from "./teacher-context";
import {
  Action,
  Avatar,
  EmptyState,
  PageTitle,
  Pick,
  Pill,
  SectionTitle,
  printContent,
} from "./teacher-shared";
import {
  activeQuestions,
  assignmentNextStep,
  preparationGaps,
  responseFlag,
  studentReport,
  studentReview,
} from "@/lib/teacher-workflow";
import type { Assessment, StudentResponse } from "@/lib/teacher-types";
import { responseMatch } from "@/lib/teacher-metrics";

export function ReviewWorkView() {
  const { assessments, students, go } = useTeacher();
  const [query, setQuery] = useState("");
  const filtered = assessments.filter((a) =>
    a.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow=""
        title="Student work"
        description="Choose an assignment, then review one student at a time."
      />
      <div className="filter-bar">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="Find an assignment to review"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an assignment…"
          />
        </label>
      </div>
      <section className="panel work-queue">
        <SectionTitle title="Assignments to review" />
        {filtered.map((a) => {
          const ids = [...new Set(a.responses.map((r) => r.studentId))];
          const pending = a.responses.filter((r) => !r.verified).length;
          const ready = preparationGaps(a).ready;
          return (
            <button
              key={a.id}
              className="assignment-list-row"
              onClick={() =>
                go(
                  ready || a.responses.length
                    ? "/assessments?id=" + a.id + "&tab=responses"
                    : assignmentNextStep(a).href,
                )
              }
            >
              <span className="document-icon">
                <ClipboardCheck size={22} />
              </span>
              <div className="assignment-row-copy">
                <h3>{a.title}</h3>
                <p>
                  {a.subject} · {ids.length} of {students.length} students added
                </p>
              </div>
              <div className="assignment-row-next">
                <Pill tone={pending ? "amber" : "neutral"}>
                  {pending
                    ? pending + " answers to confirm"
                    : ids.length
                      ? "Reviewed work available"
                      : ready
                        ? "Ready to scan"
                        : "Finish assignment setup"}
                </Pill>
                <span>
                  {pending
                    ? "Continue review"
                    : ids.length
                      ? "Open student work"
                      : ready
                        ? "Add student work"
                        : "Review assignment"}
                  <ArrowRight size={16} />
                </span>
              </div>
            </button>
          );
        })}
        {!filtered.length && (
          <EmptyState
            title={query ? "No assignments found" : "Add the assignment first"}
            description="Choose the standards and confirm the answer key before checking student work."
          >
            <Action onClick={() => go("/scan")}>
              New assignment
              <Plus size={16} />
            </Action>
          </EmptyState>
        )}
      </section>
    </>
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
  const { students, busy, go } = useTeacher();
  const params = useSearchParams();
  const [selected, setSelected] = useState(params.get("student") || "");
  const [filter, setFilter] = useState("flagged");
  const [limit, setLimit] = useState(12);
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
                student.name + " · Assignment report",
                studentReport(a, student),
              )
            }
          >
            <Printer size={16} />
            Student report
          </Action>
          <Action
            onClick={() =>
              go(
                "/scan?mode=responses&assessment=" +
                  a.id +
                  "&student=" +
                  selected,
              )
            }
            disabled={!prep.ready}
          >
            <Plus size={16} />
            Scan student work
          </Action>
        </div>
      </div>
      {!prep.ready && (
        <div className="review-notice">
          <FileText size={19} />
          <p>
            Confirm the assignment’s standards and answer key before grading.
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
                ? "Confirmed assignment score"
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
                : "Add this student’s work"
            }
            description="Scan their pages, or enter an answer manually."
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
            title="What this assignment tells you"
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
                      : "Understood on this assignment"}
                </Pill>
                {support.includes(code) && (
                  <button
                    className="text-link"
                    onClick={() =>
                      go(
                        "/reteach?standard=" +
                          encodeURIComponent(code) +
                          "&student=" +
                          selected +
                          "&assessment=" +
                          a.id,
                      )
                    }
                  >
                    <BookOpen size={16} />
                    Choose an approach
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
