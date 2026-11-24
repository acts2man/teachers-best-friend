"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Avatar, Action } from "./teacher-shared";
import { writingTraitGrid, type WritingTraitCell, type WritingTraitRow } from "@/lib/teacher-class-analysis";
import type { Assessment, Student } from "@/lib/teacher-types";

/**
 * The writing trait grid (Michael, 11 Nov 2026, "option A"): rubric traits down
 * the side, score levels 1..max across. Each box shows how many students scored
 * that level on that trait, coloured by the level on the same 0–4 cuts as the
 * DOK grid. Tapping a box lists those students and offers "Reteach this trait",
 * which opens the lesson planner carrying ONLY the trait name, the level and the
 * level counts -- never a student's name (docs/student-data-flow.md section 4).
 *
 * Scores are read from the responses already on the assessment (one per student
 * per trait, keyed by the trait id) -- no AI call, no new stored field.
 */
export function WritingTraitGrid({
  assessment: a,
  students,
  go,
}: {
  assessment: Assessment;
  students: Student[];
  go: (url: string) => void;
}) {
  const rows = writingTraitGrid(a, students);
  const [opened, setOpened] = useState<{ row: WritingTraitRow; cell: WritingTraitCell } | null>(null);
  if (!rows.length) return null;
  const max = rows[0].max;
  const levels = Array.from({ length: max }, (_, i) => i + 1);
  const anyScored = rows.some((r) => r.scored > 0);
  return (
    <div className="panel dok-grid-panel writing-trait-grid-panel">
      <span className="cell-meta">How many students reached each level on each writing trait</span>
      {!anyScored && (
        <p className="cell-meta">No confirmed writing scores yet — confirm scores on Student writing and they appear here.</p>
      )}
      <div className="dok-grid writing-trait-grid" style={{ "--levels": max } as React.CSSProperties}>
        <div className="dok-grid-head" aria-hidden="true">
          <span>Trait</span>
          {levels.map((l) => (
            <span key={l}>
              <strong>Level {l}</strong>
              {l === max ? "of " + max : ""}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div className="dok-grid-row" key={row.dimension.id} role="group" aria-label={row.dimension.name}>
            <div className="dok-grid-standard">
              <strong>{row.dimension.name}</strong>
              <span>{row.scored} scored</span>
            </div>
            {row.cells.map((cell) => (
              <Cell key={cell.level} trait={row.dimension.name} max={max} cell={cell} onOpen={() => setOpened({ row, cell })} />
            ))}
          </div>
        ))}
      </div>
      {opened && (
        <TraitCellPanel
          assessment={a}
          row={opened.row}
          cell={opened.cell}
          onClose={() => setOpened(null)}
          go={go}
        />
      )}
    </div>
  );
}

function Cell({ trait, max, cell, onOpen }: { trait: string; max: number; cell: WritingTraitCell; onOpen: () => void }) {
  if (cell.count === 0)
    return (
      <div className="dok-cell level-none" aria-label={`${trait}, level ${cell.level} of ${max}: no students`}>
        <span className="dok-cell-dok">Level {cell.level}</span>
        <span className="dok-cell-empty">0</span>
      </div>
    );
  return (
    <div
      className={"dok-cell level-" + cell.levelInfo.tone}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      aria-label={`${trait}, level ${cell.level} of ${max}: ${cell.count} student${cell.count === 1 ? "" : "s"} (${cell.levelInfo.level}) — tap for who, and to reteach`}
    >
      <span className="dok-cell-dok">Level {cell.level}</span>
      <strong>{cell.count}</strong>
      <span className="dok-cell-advice">{cell.count === 1 ? "student" : "students"}</span>
    </div>
  );
}

/**
 * A trait box tapped: the students at that level, and "Reteach this trait" into
 * lesson planning. The lesson request carries only the trait name, the level and
 * the per-level counts (built below) — no student name leaves this screen.
 */
function TraitCellPanel({
  assessment: a,
  row,
  cell,
  onClose,
  go,
}: {
  assessment: Assessment;
  row: WritingTraitRow;
  cell: WritingTraitCell;
  onClose: () => void;
  go: (url: string) => void;
}) {
  const phone = useIsMobile();
  const counts = row.cells.map((c) => c.count); // level 1..max, in order
  const reteach = () =>
    go(
      "/lessons?assessment=" +
        a.id +
        "&intent=reteach" +
        "&standard=" +
        encodeURIComponent(row.dimension.standard) +
        // Trait name, the level the teacher tapped, its max, and the whole-class
        // level counts: this -- and nothing about any student -- is what the
        // lesson request sends to the AI (docs/student-data-flow.md section 4).
        "&trait=" +
        encodeURIComponent(row.dimension.name) +
        "&traitLevel=" +
        cell.level +
        "&traitMax=" +
        row.max +
        "&traitCounts=" +
        counts.join(","),
    );
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={phone ? "bottom" : "right"} data-side={phone ? "bottom" : "right"} className="dok-cell-panel">
        <SheetHeader>
          <SheetTitle>
            {row.dimension.name} · Level {cell.level} of {row.max}
          </SheetTitle>
          <SheetDescription>
            {cell.count} student{cell.count === 1 ? "" : "s"} scored level {cell.level} ({cell.levelInfo.level})
          </SheetDescription>
        </SheetHeader>
        <div className="dok-cell-panel-body">
          <section>
            <h3>Students at this level</h3>
            <ul className="trait-cell-students">
              {cell.students.map((s) => (
                <li key={s.id}>
                  <Avatar student={s} size="small" />
                  <span>{s.name}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Next step</h3>
            <Action onClick={reteach}>
              <BookOpen size={16} />
              Reteach this trait
            </Action>
            <p className="cell-meta">
              Builds a lesson for <strong>{row.dimension.name}</strong>. Only the trait name, the
              level and how many students reached each level are sent to the AI — never a
              student&rsquo;s name or writing.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
