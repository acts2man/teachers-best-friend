"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { gradingModeName, score4Text } from "@/lib/grading-mode";
import { MASTERY_LEVELS, SCORE4_RANGES } from "@/lib/mastery-levels";
import { schoolYearLabel } from "@/lib/school-year";
import { classSuperGrid, type Score, type SuperGridCell, type SuperGridRow } from "@/lib/super-grid";
import { DOK_LEVELS } from "@/lib/teacher-class-analysis";
import type { Classroom, Workspace } from "@/lib/teacher-types";
import { shortAdvice } from "./dok-grid";

/**
 * The class super grid (docs/design/super-grids.md, build step 1): the open
 * class's confirmed answers this school year, across every test, by standard
 * cluster and DOK, in the class's grading mode (lib/super-grid.ts). The first
 * thing on Lesson Planning (Ricky's menu, 23 Oct 2026: "the engine that powers
 * the lesson plan"). It reuses the test DOK grid's layout and colours: a grid
 * on a computer, a card per cluster on a phone, nothing scrolling sideways.
 *
 * A cell opens its panel: the score, how many questions were asked (in the
 * last 30 days and before, by each test's date given), the weakest standards
 * in it and the common errors. No AI call -- the pre-teach button is a later
 * step.
 */
export function ClassSuperGrid({ w, classroom }: { w: Workspace; classroom: Classroom }) {
  const grid = classSuperGrid(w, classroom);
  const [opened, setOpened] = useState<{ row: SuperGridRow; cell: SuperGridCell } | null>(null);
  const sbg = grid.mode === "sbg";
  return (
    <section className="panel dok-grid-panel class-super-grid" aria-label="Class super grid">
      <div className="super-grid-head">
        <h2>Class super grid</h2>
        <p className="cell-meta">
          {classroom.name} · {schoolYearLabel(grid.schoolYear)} school year · every confirmed answer from{" "}
          {grid.tests} test{grid.tests === 1 ? "" : "s"}, by standard cluster and depth of knowledge ·{" "}
          {gradingModeName(grid.mode)}
        </p>
        <p className="cell-meta">Counts students now on this class&rsquo;s roster.</p>
      </div>
      {!grid.rows.length ? (
        <p className="cell-meta super-grid-empty">
          {grid.tests
            ? "No graded questions with a standard and a DOK level yet this school year."
            : "No tests given to this class in the " + schoolYearLabel(grid.schoolYear) + " school year yet."}{" "}
          The grid fills in as tests are graded.
        </p>
      ) : (
        <div className="dok-grid">
          <div className="dok-grid-head" aria-hidden="true">
            <span>Cluster</span>
            {DOK_LEVELS.map((d) => (
              <span key={d.dok}>
                <strong>DOK {d.dok}</strong>
                {d.name}
              </span>
            ))}
          </div>
          {grid.rows.map((row) => (
            <div className="dok-grid-row" key={row.cluster.key} role="group" aria-label={row.label}>
              <div className="dok-grid-standard">
                <strong>{row.cluster.code ?? row.cluster.name ?? "Other standards"}</strong>
                {row.cluster.code && row.cluster.name && <span>{row.cluster.name}</span>}
              </div>
              {row.cells.map((cell) => (
                <Cell key={cell.dok} label={row.label} cell={cell} onOpen={() => setOpened({ row, cell })} />
              ))}
            </div>
          ))}
        </div>
      )}
      {grid.rows.length > 0 && (
        <div className="dok-grid-legend heatmap-legend">
          {MASTERY_LEVELS.map((l) => (
            <span key={l.level} className={"level-" + l.tone}>
              {l.level} {sbg ? SCORE4_RANGES[l.level] : l.range}
            </span>
          ))}
          <span className="level-none">Not Tested</span>
        </div>
      )}
      {grid.noDok > 0 && (
        <p className="cell-meta dok-grid-note">
          {grid.noDok} question{grid.noDok === 1 ? " has" : "s have"} no DOK level and{" "}
          {grid.noDok === 1 ? "is" : "are"} not in the grid — set it in each test&rsquo;s Assessment review.
        </p>
      )}
      {opened && (
        <SuperGridCellPanel row={opened.row} cell={opened.cell} sbg={sbg} onClose={() => setOpened(null)} />
      )}
    </section>
  );
}

const shown = (s: Score) => (s.score4 !== null ? score4Text(s.score4) : s.percent + "%");

function Cell({ label, cell, onOpen }: { label: string; cell: SuperGridCell; onOpen: () => void }) {
  const qs = cell.questions + " question" + (cell.questions === 1 ? "" : "s");
  const tap = {
    role: "button",
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen()),
  } as const;
  if (!cell.questions)
    return (
      <div className="dok-cell level-none" {...tap} aria-label={`${label}, DOK ${cell.dok}: not tested`}>
        <span className="dok-cell-dok">DOK {cell.dok}</span>
        <span className="dok-cell-empty">Not Tested</span>
      </div>
    );
  if (!cell.level)
    return (
      <div className="dok-cell level-none" {...tap} aria-label={`${label}, DOK ${cell.dok}: not graded yet, ${qs}`}>
        <span className="dok-cell-dok">DOK {cell.dok}</span>
        <span className="dok-cell-empty">Not graded yet</span>
        <small>{qs}</small>
      </div>
    );
  return (
    <div
      className={"dok-cell level-" + cell.level.tone}
      {...tap}
      aria-label={`${label}, DOK ${cell.dok}: ${cell.score4 !== null ? score4Text(cell.score4) + " out of 4" : cell.percent + "%"}, ${cell.level.level}, ${cell.level.advice}, ${qs}`}
    >
      <span className="dok-cell-dok">DOK {cell.dok}</span>
      <strong>{shown(cell)}</strong>
      <span className="dok-cell-advice" title={cell.level.advice}>
        <span className="advice-full">{cell.level.advice}</span>
        <span className="advice-short">{shortAdvice(cell.level.advice)}</span>
      </span>
      <small>{qs}</small>
    </div>
  );
}

function SuperGridCellPanel({
  row,
  cell,
  sbg,
  onClose,
}: {
  row: SuperGridRow;
  cell: SuperGridCell;
  sbg: boolean;
  onClose: () => void;
}) {
  const phone = useIsMobile();
  const name = DOK_LEVELS.find((d) => d.dok === cell.dok)?.name;
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={phone ? "bottom" : "right"} data-side={phone ? "bottom" : "right"} className="dok-cell-panel super-grid-panel">
        <SheetHeader>
          <SheetTitle>
            {row.cluster.code ?? row.cluster.name ?? "Other standards"} · DOK {cell.dok}
            {!cell.questions && " · Not Tested"}
          </SheetTitle>
          <SheetDescription>{row.cluster.name ?? "Standards with no cluster in their catalog"}</SheetDescription>
        </SheetHeader>
        <div className="dok-cell-panel-body">
          {!cell.questions ? (
            <p className="not-tested-why">
              No question this school year was at DOK {cell.dok}
              {name ? " (" + name.toLowerCase() + ")" : ""} on this cluster, so there is no score for this box.
            </p>
          ) : (
            <>
              {cell.level ? (
                <div className={"dok-cell-panel-score level-" + cell.level.tone}>
                  <strong>{cell.score4 !== null ? score4Text(cell.score4) + " out of 4" : cell.percent + "%"}</strong>
                  <span>
                    {cell.level.level} · {cell.level.advice}
                  </span>
                  <small>
                    {cell.answers} confirmed answer{cell.answers === 1 ? "" : "s"} across {cell.tests} test
                    {cell.tests === 1 ? "" : "s"}
                    {cell.answers < 5 && " — only a few so far, a rough picture"}
                  </small>
                </div>
              ) : (
                <p className="cell-meta">None of these questions is graded yet.</p>
              )}

              <section>
                <h3>Questions asked this school year</h3>
                <dl className="super-grid-counts">
                  <div>
                    <dt>In total</dt>
                    <dd>{cell.questions}</dd>
                  </div>
                  <div>
                    <dt>Last 30 days</dt>
                    <dd>{cell.recent}</dd>
                  </div>
                  <div>
                    <dt>More than 30 days ago</dt>
                    <dd>{cell.older}</dd>
                  </div>
                </dl>
                <p className="cell-meta">By the date each test was given.</p>
              </section>

              <section>
                <h3>Weakest standards</h3>
                <ul className="dok-cell-errors super-grid-standards">
                  {cell.standards.map((s) => (
                    <li key={s.code} className={s.level ? "level-" + s.level.tone : "level-none"}>
                      <strong>
                        {s.code} — {s.level ? shown(s) : "not graded yet"}
                      </strong>
                      <span>
                        {s.title ? s.title + " · " : ""}
                        {s.questions} question{s.questions === 1 ? "" : "s"}
                        {s.answers > 0 && ", " + s.answers + " answer" + (s.answers === 1 ? "" : "s")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3>Common errors</h3>
                {cell.errorTypes.length ? (
                  <ul className="dok-cell-errors">
                    {cell.errorTypes.map((t) => (
                      <li key={t.name}>
                        <strong>{t.name}</strong>
                        <span>
                          {t.count} answer{t.count === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="cell-meta">No error types tagged on these answers yet.</p>
                )}
              </section>
              {sbg && <p className="cell-meta">This class is graded Standards-Based, so the grid reads 0–4.</p>}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
