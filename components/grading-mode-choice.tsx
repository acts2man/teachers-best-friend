"use client";

import { GRADING_MODES, type GradingMode } from "@/lib/grading-mode";

/**
 * Percentage or Standards-Based (0–4), as two buttons. Used when a test is set
 * up and on the test itself, where it can be switched at any time
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
