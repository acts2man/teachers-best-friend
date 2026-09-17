"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeRequest } from "@/lib/analyze-client";
import { stateFrameworks } from "@/lib/states";

const GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Loads a state's standards for one grade into the shared library, where every
 * teacher can use them. Runs the same lookup a teacher's "load standards"
 * button runs, through the same background job, but as an admin it is not
 * billed and can refresh an entry that already exists.
 */
export function UnlockStandards() {
  const router = useRouter();
  const [framework, setFramework] = useState("Common Core");
  const [grade, setGrade] = useState(7);
  const [subject, setSubject] = useState<"Math" | "ELA" | "Both">("Both");
  const [refresh, setRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function run() {
    setBusy(true);
    setLog([]);
    const subjects = subject === "Both" ? ["Math", "ELA"] : [subject];
    for (const s of subjects) {
      const label = `${framework} · grade ${grade === 0 ? "K" : grade} · ${s}`;
      setLog((l) => [...l, `${label}: looking up…`]);
      try {
        const d = await analyzeRequest({ mode: "catalog", grade, framework, subject: s, text: "", refresh });
        const n = Array.isArray(d?.result?.standards) ? d.result.standards.length : 0;
        const source = d?.model === "shared-library" ? "already in the shared library" : "loaded and shared with every teacher";
        setLog((l) => [...l.slice(0, -1), `${label}: ${n} standards ${source}.`]);
      } catch (e) {
        setLog((l) => [...l.slice(0, -1), `${label}: ${e instanceof Error ? e.message : "failed"}`]);
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <select value={framework} onChange={(e) => setFramework(e.target.value)} aria-label="Standards framework" disabled={busy}>
          <option value="Common Core">Common Core</option>
          {stateFrameworks.map((s) => <option key={s.abbr} value={s.state}>{s.state}</option>)}
        </select>
        <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} aria-label="Grade" disabled={busy}>
          {GRADES.map((g) => <option key={g} value={g}>{g === 0 ? "Kindergarten" : `Grade ${g}`}</option>)}
        </select>
        <select value={subject} onChange={(e) => setSubject(e.target.value as "Math" | "ELA" | "Both")} aria-label="Subject" disabled={busy}>
          <option value="Both">Math and ELA</option>
          <option value="Math">Math</option>
          <option value="ELA">ELA</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: ".85rem" }}>
          <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} disabled={busy} />
          Refresh even if already shared
        </label>
        <button type="button" className="btn btn-mark btn-sm" onClick={run} disabled={busy}>{busy ? "Loading…" : "Unlock for everyone"}</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".8rem", maxWidth: "70ch" }}>
        Runs the official-standards lookup once and saves the result to the shared library, so every teacher gets it instantly and free from then on. Use “Refresh” to bring an older entry up to the full field set (skills, depth of knowledge, misconception, example). A lookup takes a minute or two.
      </p>
      {log.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: ".875rem", display: "grid", gap: "4px" }}>
          {log.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}
