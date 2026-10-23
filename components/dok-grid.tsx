"use client";

import { MASTERY_LEVELS } from "@/lib/mastery-levels";
import { DOK_LEVELS, type DokCell, type DokGridRow } from "@/lib/teacher-class-analysis";

/**
 * The class DOK grid (docs/design/grading-modes-and-dok-grid.md 2.1-2.3, 2.7):
 * standards down the side, DOK 1-4 across, each cell the class's score
 * coloured by its level with the level's recommendation. A cell with no
 * questions is grey. On a computer it is a grid with one header row; on a
 * phone each standard is a small card with its four DOK cells in one row, so
 * nothing scrolls sideways.
 */
export function DokGrid({ rows, noDok }: { rows: DokGridRow[]; noDok: number }) {
  if (!rows.length) return null;
  return (
    <div className="panel dok-grid-panel">
      <span className="cell-meta">Class score by standard and depth of knowledge</span>
      <div className="dok-grid">
        <div className="dok-grid-head" aria-hidden="true">
          <span>Standard</span>
          {DOK_LEVELS.map((d) => (
            <span key={d.dok}>
              <strong>DOK {d.dok}</strong>
              {d.name}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div className="dok-grid-row" key={row.standard.code} role="group" aria-label={row.standard.code}>
            <div className="dok-grid-standard">
              <strong>{row.standard.code}</strong>
              <span>{row.standard.title}</span>
            </div>
            {row.cells.map((cell) => (
              <Cell key={cell.dok} code={row.standard.code} cell={cell} />
            ))}
          </div>
        ))}
      </div>
      <div className="dok-grid-legend heatmap-legend">
        {MASTERY_LEVELS.map((l) => (
          <span key={l.level} className={"level-" + l.tone}>
            {l.level} {l.range}
          </span>
        ))}
        <span className="level-none">No questions</span>
      </div>
      {noDok > 0 && (
        <p className="cell-meta dok-grid-note">
          {noDok} question{noDok === 1 ? " has" : "s have"} no DOK level and{" "}
          {noDok === 1 ? "is" : "are"} not in the grid — set it in Assessment
          review.
        </p>
      )}
    </div>
  );
}

function Cell({ code, cell }: { code: string; cell: DokCell }) {
  const qs = cell.questions + " question" + (cell.questions === 1 ? "" : "s");
  if (!cell.questions)
    return (
      <div className="dok-cell level-none" aria-label={`${code}, DOK ${cell.dok}: no questions`}>
        <span className="dok-cell-dok">DOK {cell.dok}</span>
        <span className="dok-cell-empty">No questions</span>
      </div>
    );
  if (cell.percent === null || !cell.level)
    return (
      <div className="dok-cell level-none" aria-label={`${code}, DOK ${cell.dok}: not graded yet, ${qs}`}>
        <span className="dok-cell-dok">DOK {cell.dok}</span>
        <span className="dok-cell-empty">Not graded yet</span>
        <small>{qs}</small>
      </div>
    );
  return (
    <div
      className={"dok-cell level-" + cell.level.tone}
      aria-label={`${code}, DOK ${cell.dok}: ${cell.percent}%, ${cell.level.level}, ${cell.level.advice}, ${qs}`}
    >
      <span className="dok-cell-dok">DOK {cell.dok}</span>
      <strong>{cell.percent}%</strong>
      {/* A phone's cell is about 60px wide inside at 360px: "Recommended" is
          one word longer than that, so phones show the short form ("Reteach",
          "Extension"); the full recommendation is the cell's label. */}
      <span className="dok-cell-advice" title={cell.level.advice}>
        <span className="advice-full">{cell.level.advice}</span>
        <span className="advice-short">{shortAdvice(cell.level.advice)}</span>
      </span>
      <small>{qs}</small>
    </div>
  );
}

/** The recommendation without "Recommended", for a phone's narrow cell:
 * "Reteach Recommended" is "Reteach", "Extension Recommended" "Extension";
 * "Monitor" and "Ready to Move On" wrap on whole words and stay as they are. */
export function shortAdvice(advice: string): string {
  return advice.replace(/\s+Recommended$/, "");
}
