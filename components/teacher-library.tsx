"use client";
import { useState } from "react";
import { ArrowRight, LibraryBig, Plus } from "lucide-react";
import { useTeacher } from "./teacher-context";
import { Action, EmptyState, Modal, PageTitle } from "./teacher-shared";
import {
  courseOf,
  libraryClassesFor,
  libraryCourses,
  libraryLandingUrl,
  questionsToReview,
  pickFromLibrary,
} from "@/lib/assessment-library";
import { gradingModeLabel, gradingModeOf } from "@/lib/grading-mode";
import { assessmentFitsClass, assessmentInClass, classesFor } from "@/lib/teacher-classes";
import { activeQuestions } from "@/lib/teacher-workflow";
import type { Assessment } from "@/lib/teacher-types";

/**
 * The Assessment Library (Ricky, 23 and 27 Oct 2026): every test with a
 * confirmed answer key, from every class, by course and alphabetical. Picking
 * one for a class skips straight to uploading that class's student work.
 * lib/assessment-library.ts has the rules.
 */
export function LibraryView() {
  const { w, classroom, save, busy, go } = useTeacher();
  const [picking, setPicking] = useState<Assessment | null>(null);
  const courses = libraryCourses(w);
  const total = courses.reduce((n, c) => n + c.tests.length, 0);

  async function pickFor(a: Assessment, classId: string) {
    const next = pickFromLibrary(w, a.id, classId);
    const c = w.classes.find((x) => x.id === classId);
    if (!next || !c) return;
    const already = assessmentInClass(a, classId);
    const saved = await save(next, already ? a.title + " · " + c.name : a.title + " added to " + c.name);
    if (!saved) return;
    setPicking(null);
    go(libraryLandingUrl(a));
  }

  // The class on screen first: the usual pick is "the class I'm in now".
  const choices = picking
    ? [...libraryClassesFor(w, picking)].sort((x, y) => Number(y.id === classroom.id) - Number(x.id === classroom.id))
    : [];
  const otherMode = picking ? w.classes.length - choices.length : 0;
  return (
    <>
      <PageTitle
        eyebrow="EVERY CLASS, ONE SHELF"
        title="Assessment library"
        description="Every test with a confirmed answer key, by course. Use one with any class graded the same way and go straight to uploading student work."
      >
        <Action variant="secondary" onClick={() => go("/assessments")}>
          All assessments
          <ArrowRight size={16} />
        </Action>
        <Action onClick={() => go("/scan")}>
          <Plus size={17} />
          New assessment
        </Action>
      </PageTitle>
      {!total ? (
        <EmptyState
          title="No tests in the library yet"
          description="A test joins the library on its own once you confirm its answer key."
        >
          <Action onClick={() => go("/assessments")}>
            Go to assessments
            <ArrowRight size={16} />
          </Action>
        </EmptyState>
      ) : (
        courses.map(({ course, tests }) => (
          <section className="panel library-course" key={course} aria-label={course}>
            <h2>
              {course} <span className="cell-meta">{tests.length === 1 ? "1 test" : tests.length + " tests"}</span>
            </h2>
            <ul className="library-tests">
              {tests.map((a) => {
                const n = activeQuestions(a).length;
                const left = questionsToReview(a);
                return (
                  <li key={a.id} className="library-test">
                    <div className="library-test-main">
                      <strong>{a.title}</strong>
                      <span className="cell-meta">
                        {n === 1 ? "1 question" : n + " questions"} · {gradingModeLabel(a)} · in{" "}
                        {classesFor(w, a).map((c) => c.name).join(", ") || "no class"}
                      </span>
                      {left > 0 && (
                        <span className="cell-meta library-setup-left">
                          {left === 1 ? "1 question" : left + " questions"} to review before scanning
                        </span>
                      )}
                    </div>
                    <Action variant="secondary small" disabled={busy} onClick={() => setPicking(a)}>
                      <LibraryBig size={15} />
                      Use with a class
                    </Action>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <Modal
        open={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? "Use “" + picking.title + "”" : "Use a test"}
        description={
          picking && questionsToReview(picking)
            ? "Pick the class. The test opens where its questions still need a review; scanning opens once they're done."
            : "Pick the class. The test opens on Student work for that class; each class keeps its own students' work."
        }
      >
        {picking && (
          <div className="form-stack">
            <div className="library-classes">
              {choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="library-class"
                  disabled={busy}
                  onClick={() => pickFor(picking, c.id)}
                >
                  <span>{c.name}</span>
                  <span className="cell-meta">
                    {assessmentInClass(picking, c.id) ? "already uses it" : "add it"}
                    {!assessmentFitsClass(picking, c)
                      ? " · " + (c.grade === 0 ? "Kindergarten" : "Grade " + c.grade) + " — standards won’t match"
                      : ""}
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
            {otherMode > 0 && (
              <p className="field-help library-other-mode">
                {otherMode === 1 ? "1 class is" : otherMode + " classes are"} graded{" "}
                {gradingModeOf(picking) === "sbg" ? "as a Percentage" : "Standards-Based"}. To use it in a{" "}
                {gradingModeOf(picking) === "sbg" ? "Percentage" : "Standards-Based"} class, upload it again as a new test.
              </p>
            )}
            <p className="field-help">Course: {courseOf(picking)}. Classes graded {gradingModeLabel(picking)} can use it.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
