"use client";
import {
  ArrowRight,
  BookOpen,
  Camera,
  ClipboardCheck,
  Files,
  House,
  Library,
  Lightbulb,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useTeacher } from "./teacher-context";
import { Action, PageTitle, Pill } from "./teacher-shared";

const steps = [
  {
    title: "Set up your classroom",
    where: "Classroom switcher at the top · Students · Settings",
    lead: "Every classroom keeps its own students, assessments, and lesson plans, so the record builds from one assessment to the next.",
    points: [
      "Use the classroom switcher in the top bar to open a classroom or add a new one. Name each one the way you think about it, such as Period 3 · Math.",
      "Open Students and paste a roster. First names with an initial, or aliases, are enough.",
      "Rename, add, or remove classrooms anytime under Settings → Classrooms.",
    ],
    tip: "The Explorers sample classroom is fictional. Use it to explore, then create your own classroom when you’re ready.",
    actions: [
      { label: "Add students", href: "/students" },
      { label: "Manage classrooms", href: "/settings" },
    ],
  },
  {
    title: "Create an assessment",
    where: "Assessments → New assessment",
    lead: "Start with what you intend to measure, then let the app read the assessment for you.",
    points: [
      "Choose the grade, subject, and framework, then check the standards this assessment should assess.",
      "Upload the blank assessment as a PDF or photo, or paste the questions. The questions are read into the assessment automatically. You never retype them.",
      "On 1. Assessment review, check each question’s standard, skill, DOK, and Costa’s level. Confirm clear matches together, or open a question to adjust it.",
      "The Standards report tab shows coverage of your intended standards and suggests how to strengthen weak questions.",
    ],
    tip: "If the questions look incomplete after upload, use Read questions from document on the first tab to run the reader again.",
    actions: [{ label: "New assessment", href: "/scan" }],
  },
  {
    title: "Confirm the answer key",
    where: "Assessment → 2. Answer key",
    lead: "Grading only begins after you confirm the key, so the comparison is always against your answers.",
    points: [
      "Use Upload answer key or Photograph key. The answers are read into the numbered list automatically.",
      "Prefer typing? Paste a numbered key, or edit any answer in place.",
      "Press Confirm answer key. If you change an answer later, affected student answers reopen for review.",
    ],
    actions: [{ label: "Open assessments", href: "/assessments" }],
  },
  {
    title: "Add one student’s work",
    where: "Assessment → 3. Student work",
    lead: "Work one student at a time so every answer gets a real look.",
    points: [
      "Choose the student, then use Upload pages or Take a photo right on the tab. Their answers are compared with your confirmed key.",
      "Clear answers are those that match the key with high reading confidence. Confirm them together in one click.",
      "Answers that are missing, uncertain, or different from the key are flagged. Open each one, read the work, and confirm your decision.",
      "Print the individual report when the review is complete.",
    ],
    tip: "A flagged answer is a prompt to look, not a verdict. Your confirmation is what becomes evidence.",
    actions: [{ label: "Open assessments", href: "/assessments" }],
  },
  {
    title: "See the whole class",
    where: "Students",
    lead: "Confirmed answers become dated evidence for each standard, and that evidence carries from assessment to assessment.",
    points: [
      "Open a student to see mastery by standard, progress over time, and your notes.",
      "Switch to High / Mid / Low for flexible performance bands, or Shared skill gaps to see who needs the same standard.",
      "Mastery uses the three latest observations. A single score never marks a standard as mastered.",
    ],
    actions: [{ label: "Open students", href: "/students" }],
  },
  {
    title: "Plan the reteach lesson",
    where: "Lesson plans",
    lead: "Choose a different way to teach the skill, generate a full plan, and keep it where you can find it.",
    points: [
      "Start from a missed problem, a shared skill gap, or a student’s standards report. The student, standard, and observations carry over.",
      "Pick Visual, Hands-on, or Auditory. Read the Teaching approach tab first to see how the three differ.",
      "Press Generate an AI lesson plan to build a complete plan around the approach you chose: objective, materials, timed phases, five practice tasks, and an exit ticket.",
      "Edit anything in the plan, then Save to lesson plans. Saved plans live on the Saved lesson plans tab.",
      "After teaching, record the exit ticket results. Mastery updates for every student in the group.",
    ],
    tip: "Seven Grade 4 standards include a prepared lesson that works without AI. Every other standard uses the AI plan builder or your own resources.",
    actions: [
      { label: "Open lesson plans", href: "/lessons" },
      { label: "Teaching resources", href: "/resources" },
    ],
  },
];

const legend = [
  {
    icon: House,
    name: "Overview",
    text: "Your next useful action, assessments in progress, and saved lesson plans.",
  },
  {
    icon: Files,
    name: "Assessments",
    text: "Every assessment with its answer key, student work, and standards report in one place.",
  },
  {
    icon: BookOpen,
    name: "Lesson plans",
    text: "Build a reteach lesson for a student or group, then keep it on your saved plans.",
  },
  {
    icon: Users,
    name: "Students",
    text: "Rosters, mastery by standard, performance bands, and shared skill gaps.",
  },
  {
    icon: Library,
    name: "Standards",
    text: "Official California Grade 4 Math and ELA wording, plus your district standards.",
  },
  {
    icon: Settings,
    name: "Settings",
    text: "Classrooms, your name, motion preferences, AI connection, export, and deletion.",
  },
];

export default function GuideView() {
  const { go, aiReady } = useTeacher();
  return (
    <>
      <PageTitle
        eyebrow="START HERE"
        title="How to use A Teacher’s Best Friend"
        description="Follow one assessment from your standards to the next lesson. Six steps, in the order you’ll do them."
      >
        <Action onClick={() => go("/scan")}>
          <Files size={16} />
          Start an assessment
        </Action>
      </PageTitle>
      <div className="guide-intro">
        <section className="panel">
          <h2>The whole workflow at a glance</h2>
          <p>
            Choose the standards you’re teaching, upload the assessment, confirm
            your answer key, add one student’s work at a time, review the
            answers together, and choose a reteach lesson for the gap you
            found. Every confirmed answer becomes evidence that follows the
            student from assessment to assessment.
          </p>
          <div className="guide-path">
            {steps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                onClick={() =>
                  document
                    .getElementById("guide-step-" + (index + 1))
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span className="num">{index + 1}</span>
                {step.title}
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Good to know</h2>
          <div className="guide-step">
            <ol>
              <li>
                You stay in control. Every suggestion, from the standard a
                question measures to whether an answer is correct, waits for
                your confirmation.
              </li>
              <li>
                {aiReady
                  ? "AI reading is connected. Uploaded documents, answer keys, and student pages are read automatically for your review."
                  : "AI reading is not connected yet. Typed PDFs are still read automatically; photographs need manual entry until the app owner adds the AI key under Settings."}
              </li>
              <li>
                Use aliases for students where you can. Your classrooms and
                documents are private to your account.
              </li>
              <li>
                Export a copy of your workspace or delete everything from
                Settings whenever you need to.
              </li>
            </ol>
          </div>
        </section>
      </div>
      <div className="guide-steps">
        {steps.map((step, index) => (
          <section
            className="panel guide-step"
            id={"guide-step-" + (index + 1)}
            key={step.title}
          >
            <span className="guide-step-number">{index + 1}</span>
            <div>
              <h2>{step.title}</h2>
              <span className="guide-where">
                <ArrowRight size={13} />
                {step.where}
              </span>
              <p className="lead">{step.lead}</p>
              <ol>
                {step.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ol>
              {step.tip && (
                <div className="guide-tip">
                  <Lightbulb size={16} />
                  <span>{step.tip}</span>
                </div>
              )}
              <div className="guide-actions">
                {step.actions.map((action) => (
                  <Action
                    key={action.href}
                    variant="secondary small"
                    onClick={() => go(action.href)}
                  >
                    {action.label}
                    <ArrowRight size={14} />
                  </Action>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="guide-section">
        <h2>Where things live</h2>
        <p>The navigation on the left, in the order you’ll use it.</p>
        <div className="guide-legend">
          {legend.map((entry) => (
            <div key={entry.name}>
              <span className="soft-icon">
                <entry.icon size={19} />
              </span>
              <div>
                <strong>{entry.name}</strong>
                <span>{entry.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="guide-section">
        <h2>Three shortcuts worth knowing</h2>
        <div className="guide-legend">
          <div>
            <span className="soft-icon">
              <Camera size={19} />
            </span>
            <div>
              <strong>Photograph from your phone</strong>
              <span>
                Every upload button has a Take a photo option, so you can
                capture an answer key or a student’s page without a scanner.
              </span>
            </div>
          </div>
          <div>
            <span className="soft-icon">
              <ClipboardCheck size={19} />
            </span>
            <div>
              <strong>Confirm the clear ones together</strong>
              <span>
                Both the question review and the student review offer a
                one-click confirmation for suggestions that match with high
                confidence.
              </span>
            </div>
          </div>
          <div>
            <span className="soft-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <strong>Provisional until complete</strong>
              <span>
                A student’s score stays labeled <Pill>Provisional</Pill> until
                every answer is confirmed, so partial reviews never look final.
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
