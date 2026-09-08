"use client";
import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Compass,
  FileText,
  ScanLine,
  X,
} from "lucide-react";
import { useTeacher } from "./teacher-context";
import {
  Action,
  EmptyState,
  PageTitle,
  Pill,
  SectionTitle,
  TextLink,
} from "./teacher-shared";
import { assignmentNextStep, preparationGaps } from "@/lib/teacher-workflow";

const GUIDE_KEY = "tbf-guide-dismissed";

export default function HomeView() {
  const { w, classroom, assessments, go } = useTeacher();
  // This view only mounts after the workspace loads on the client, so the
  // stored preference can be read during the first render.
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const pending = assessments.reduce(
    (n, a) => n + a.responses.filter((r) => !r.verified).length,
    0,
  );
  const reviewable = assessments.find((a) =>
    a.responses.some((r) => !r.verified),
  );
  const plans = w.lessons.filter(
    (l) => l.classId === classroom.id && !l.completed,
  );
  return (
    <>
      <PageTitle
        eyebrow=""
        title="Your workspace"
        description="Check the work. Find the gap. Choose what helps."
      />
      {showGuide && (
        <div className="getting-started" role="note">
          <span className="soft-icon">
            <Compass size={20} />
          </span>
          <div>
            <strong>New here? Follow the six-step guide.</strong>
            <span>
              Standards → assessment → answer key → student work → class
              picture → lesson plan. Each step says exactly where to click.
            </span>
          </div>
          <Action onClick={() => go("/guide")}>
            How to use this app
            <ArrowRight size={15} />
          </Action>
          <button
            className="dismiss"
            type="button"
            aria-label="Hide the getting-started reminder"
            onClick={() => {
              try {
                localStorage.setItem(GUIDE_KEY, "1");
              } catch {}
              setShowGuide(false);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <section className="start-work-card">
        <div className="start-work-icon">
          <BookOpen size={28} strokeWidth={1.6} />
        </div>
        <div>
          <h2>What are you working on?</h2>
          <p>
            Start with an assessment, or pick up student work that’s ready to
            review.
          </p>
        </div>
        <div className="start-work-actions">
          <Action onClick={() => go("/scan")}>
            <ScanLine size={18} />
            New assessment
          </Action>
          <Action
            variant="secondary"
            onClick={() =>
              go(
                reviewable
                  ? "/assessments?id=" + reviewable.id + "&tab=responses"
                  : "/assessments",
              )
            }
          >
            <ClipboardCheck size={18} />
            Review student work
            {pending > 0 && <span className="action-count">{pending}</span>}
          </Action>
        </div>
      </section>
      <div className="home-flow" aria-label="The teaching workflow">
        {[
          "Choose your standards",
          "Check the assessment & key",
          "Review student answers",
          "Plan the reteach lesson",
        ].map((label, i) => (
          <div key={label}>
            <span>{i + 1}</span>
            <p>{label}</p>
            {i < 3 && <ArrowRight size={15} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="calm-home-grid">
        <section className="panel assignments-panel">
          <SectionTitle title="Continue an assessment">
            <TextLink onClick={() => go("/assessments")}>View all</TextLink>
          </SectionTitle>
          {assessments.slice(0, 4).map((a) => {
            const next = assignmentNextStep(a),
              prep = preparationGaps(a);
            return (
              <button
                className="assignment-list-row"
                key={a.id}
                onClick={() => go(next.href)}
              >
                <span
                  className={
                    "document-icon " + (a.subject === "ELA" ? "purple" : "")
                  }
                >
                  <FileText size={22} />
                </span>
                <div className="assignment-row-copy">
                  <h3>{a.title}</h3>
                  <p>
                    {a.subject} · Grade {a.grade} · {a.questions.length}{" "}
                    questions
                  </p>
                </div>
                <div className="assignment-row-next">
                  <Pill tone={prep.ready ? "green" : "amber"}>
                    {prep.ready ? "Ready for student work" : "Set up assessment"}
                  </Pill>
                  <span>
                    {next.label}
                    <ArrowRight size={15} />
                  </span>
                </div>
              </button>
            );
          })}
          {!assessments.length && (
            <EmptyState
              title="Your first assessment starts here"
              description="Choose the standards you’re teaching, then upload a worksheet, test, or photograph."
            >
              <Action onClick={() => go("/scan")}>
                Add an assessment
                <ArrowRight size={16} />
              </Action>
            </EmptyState>
          )}
        </section>
        <aside className="panel saved-support-panel">
          <SectionTitle title="Saved lesson plans" />
          {plans.length ? (
            plans.slice(0, 3).map((p) => (
              <button
                className="saved-support-row"
                key={p.id}
                onClick={() => go("/lessons?lesson=" + p.id)}
              >
                <BookOpen size={19} />
                <div>
                  <strong>{p.title}</strong>
                  <span>
                    {p.duration} min ·{" "}
                    {p.modality === "Kinesthetic" ? "Hands-on" : p.modality}
                  </span>
                </div>
                <ArrowRight size={15} />
              </button>
            ))
          ) : (
            <div className="quiet-empty">
              <BookOpen size={28} strokeWidth={1.5} />
              <p>
                Generate a lesson plan after reviewing a student’s work. It’ll
                be here when you’re ready to teach.
              </p>
            </div>
          )}
          <TextLink onClick={() => go("/lessons?tab=plan")}>
            Open saved lesson plans
          </TextLink>
        </aside>
      </div>
    </>
  );
}
