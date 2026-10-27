"use client";

import { GRADING_MODES, type GradingMode } from "@/lib/grading-mode";

/**
 * Percentage or Standards-Based (0–4), as two buttons. Used when a class is
 * created (ClassGradingModeField): every new test in the class takes it
 * (lib/grading-mode.ts).
 */
export function GradingModeChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: GradingMode;
  onChange: (mode: GradingMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grading-mode-choice" role="group" aria-label="Grading mode">
      {GRADING_MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          aria-pressed={value === m.mode}
          className={value === m.mode ? "selected" : ""}
          disabled={disabled}
          title={m.description}
          onClick={() => value !== m.mode && onChange(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** A new class's grading mode (Ricky, 27 Oct 2026): chosen once, when the
 * class is created; every new test in the class is graded this way. */
export function ClassGradingModeField({
  value,
  onChange,
}: {
  value: GradingMode;
  onChange: (mode: GradingMode) => void;
}) {
  return (
    <div className="grading-mode-setup">
      <strong>Grading</strong>
      <GradingModeChoice value={value} onChange={onChange} />
      <p className="field-help">
        Every test you create in this class is graded this way
        {value === "sbg" ? ", with every question out of 4 points" : ""}. Choose now: it can&apos;t be
        changed once the class is created.
      </p>
    </div>
  );
}
