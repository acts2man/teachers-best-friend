"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { Action } from "./teacher-shared";
import {
  DOK_LEVELS,
  dokCellDetail,
  nextStepDok,
  type DokCell,
} from "@/lib/teacher-class-analysis";
import type { Assessment, Standard, Student } from "@/lib/teacher-types";

/**
 * The DOK grid's cell panel (docs/design/grading-modes-and-dok-grid.md 2.4,
 * D2). Tapping a scored cell opens it: the score, level, recommendation and
 * question count; the common errors in that cell (the error types the teacher
 * tagged, from the subject's fixed list) or, where there are none, the most
 * common wrong answers; and the level's next step at that DOK, which opens the
 * lesson generator for the standard -- with boxes to add the standard's other
 * DOK levels to the same lesson.
 *
 * Ricky's answers (20 Oct 2026): the recommendation comes from the score
 * alone; an extension always aims one DOK level up (DOK 4 stays at 4).
 *
 * A bottom sheet on a phone, a side sheet on a computer.
 */
export function DokCellPanel({
  assessment: a,
  students,
  standard,
  cell,
  onClose,
  go,
}: {
  assessment: Assessment;
  students: Student[];
  standard: Standard;
  cell: DokCell;
  onClose: () => void;
  go: (url: string) => void;
}) {
  const phone = useIsMobile();
  const level = cell.level!;
  const target = nextStepDok(level, cell.dok);
  const [extra, setExtra] = useState<number[]>([]);
  const detail = dokCellDetail(a, students, cell.questionIds);
  const questions = a.questions.filter((q) => cell.questionIds.includes(q.id));
  const doks = [...new Set([target, ...extra])].sort();
  const open = () =>
    go(
      "/lessons?standard=" +
        encodeURIComponent(standard.code) +
        "&assessment=" +
        a.id +
        "&intent=" +
        level.nextStep.intent +
        "&dok=" +
        doks.join(",") +
        // The errors the lesson aims at are this cell's -- what the panel
        // shows -- whatever level the lesson is pitched at.
        "&errorsFrom=" +
        cell.dok,
    );
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={phone ? "bottom" : "right"} data-side={phone ? "bottom" : "right"} className="dok-cell-panel">
        <SheetHeader>
          <SheetTitle>
            {standard.code} · DOK {cell.dok}
          </SheetTitle>
          <SheetDescription>{standard.title}</SheetDescription>
        </SheetHeader>
        <div className="dok-cell-panel-body">
          <div className={"dok-cell-panel-score level-" + level.tone}>
            <strong>{cell.percent}%</strong>
            <span>
              {level.level} · {level.advice}
            </span>
            <small>
              {cell.questions} question{cell.questions === 1 ? "" : "s"} (
              {questions.map((q) => "Q" + q.number).join(", ")}) · {cell.studentsGraded} student
              {cell.studentsGraded === 1 ? "" : "s"} graded
            </small>
          </div>

          <section>
            <h3>Common errors</h3>
            {detail.errorTypes.length > 0 ? (
              <ul className="dok-cell-errors">
                {detail.errorTypes.map((t) => (
                  <li key={t.errorType}>
                    <strong>{t.errorType}</strong>
                    <span>
                      {t.count} answer{t.count === 1 ? "" : "s"}
                      {t.students.length > 0 && " · " + t.students.map((s) => s.name).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="cell-meta">
                  No error types tagged on these answers yet
                  {detail.wrongAnswers.length ? " — the most common wrong answers:" : "."}
                </p>
                {detail.wrongAnswers.length > 0 && (
                  <ul className="dok-cell-errors">
                    {detail.wrongAnswers.map((w) => (
                      <li key={w.answer}>
                        <strong>&ldquo;{w.answer.length > 80 ? w.answer.slice(0, 80) + "…" : w.answer}&rdquo;</strong>
                        <span>
                          {w.count} answer{w.count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section>
            <h3>Next step</h3>
            <fieldset className="dok-cell-levels">
              <legend className="cell-meta">DOK levels in the lesson</legend>
              {DOK_LEVELS.map((d) => (
                <label key={d.dok}>
                  <Checkbox
                    checked={d.dok === target || extra.includes(d.dok)}
                    disabled={d.dok === target}
                    onCheckedChange={(v) =>
                      setExtra((x) => (v ? [...x, d.dok] : x.filter((n) => n !== d.dok)))
                    }
                    aria-label={"DOK " + d.dok}
                  />
                  DOK {d.dok} · {d.name}
                </label>
              ))}
            </fieldset>
            <Action onClick={open}>
              <BookOpen size={16} />
              {level.nextStep.label} DOK {target}
              {doks.length > 1 && " + " + doks.filter((d) => d !== target).map((d) => "DOK " + d).join(", ")}
            </Action>
            <p className="cell-meta">
              Builds a lesson with practice and an exit ticket at{" "}
              {doks.length === 1 ? "DOK " + target : "DOK " + doks.join(", ")}
              {detail.errorTypes.length > 0 && ", aimed at the common errors above"}. Only the
              error-type names and counts are sent to the AI — never a student&rsquo;s name or answer.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A "Not Tested" box, tapped (Ricky, 26 Oct 2026): no question on this test
 * was at that DOK level for that standard, so there is nothing to score.
 */
export function NotTestedPanel({
  standard,
  cell,
  onClose,
}: {
  standard: Standard;
  cell: DokCell;
  onClose: () => void;
}) {
  const phone = useIsMobile();
  const name = DOK_LEVELS.find((d) => d.dok === cell.dok)?.name;
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={phone ? "bottom" : "right"} data-side={phone ? "bottom" : "right"} className="dok-cell-panel">
        <SheetHeader>
          <SheetTitle>
            {standard.code} · DOK {cell.dok} · Not Tested
          </SheetTitle>
          <SheetDescription>{standard.title}</SheetDescription>
        </SheetHeader>
        <div className="dok-cell-panel-body">
          <p className="not-tested-why">
            No questions on this test were at DOK {cell.dok}
            {name ? " (" + name.toLowerCase() + ")" : ""} for {standard.code}, so there is no
            score for this box. To see how the class does at this level, include a DOK {cell.dok}{" "}
            question on this standard in a future test.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
