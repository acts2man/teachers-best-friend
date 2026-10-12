"use client";
/**
 * The replay page: run the test cases, copy an allow-listed set's photos, make
 * cases from it, and check that old assessments still open. It drives the
 * server one step at a time (see lib/regression/runner.ts) and shows anonymised
 * case codes and numbers only.
 */
import { useEffect, useState } from "react";

type Summary = {
  cases: { code: string; kind: string; active: boolean }[];
  runs: { id: string; started_at: string; finished_at: string | null; build_commit: string | null; status: string; summary: RunSummary | null }[];
};
type RunSummary = {
  cases: number;
  passed: number;
  failed: number;
  errors: number;
  costUsd: number;
  perCase: { code: string; kind: string; status: string; metrics: Record<string, Record<string, unknown>> | null; costUsd: number }[];
};

async function call(payload: Record<string, unknown>) {
  const r = await fetch("/api/admin/regression", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

const pct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) + "%" : "–");

/** The few numbers that matter for a case, in plain words. */
function headline(m: Record<string, Record<string, unknown>> | null): string {
  if (!m) return "";
  if (m.names) return `${m.names.correct}/${m.names.piles} names right, ${m.names.wrongConfident} filled in wrongly, ${m.names.unassigned} left to choose`;
  if (m.answers) {
    const a = m.answers;
    return `read ${pct(a.readAccuracy)}, grouped ${pct(a.groupAccuracy)}, wrongly correct ${a.wronglyCorrect}, wrongly blank ${a.wronglyBlank}, unsure ${a.unsure}` +
      (Number(a.partsExpected) ? `, multi-part ${a.partsRead}/${a.partsExpected} parts` : "");
  }
  const k = m.answer_key ?? m.standards;
  return k ? `${k.right}/${k.items} right (${pct(k.accuracy)})` : "";
}

export function RegressionConsole() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [last, setLast] = useState<RunSummary | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const say = (line: string) => setLog((l) => [...l.slice(-60), line]);

  const refresh = () => call({ action: "summary" }).then(setSummary).catch((e) => say(String(e.message)));
  useEffect(() => {
    call({ action: "summary" })
      .then(setSummary)
      .catch((e) => setLog([String(e.message)]));
  }, []);

  async function runAll() {
    setBusy(true);
    setLast(null);
    try {
      const { runId, cases } = await call({ action: "start-run" });
      say(`Run started with ${cases.length} case(s).`);
      for (const code of cases as string[]) {
        let status = "running";
        let guard = 0;
        while (status === "running" && guard++ < 400) {
          const d = await call({ action: "step", runId, caseCode: code });
          status = d.status;
          if (status === "running") {
            say(`${code}: ${d.progress}`);
            await new Promise((r) => setTimeout(r, 2500));
          } else say(`${code}: ${status}${d.metrics ? " — " + headline(d.metrics) : d.progress ? " — " + d.progress : ""}`);
        }
      }
      const { summary: s } = await call({ action: "finish-run", runId });
      setLast(s);
      say(`Run finished: ${s.passed} passed, ${s.failed} failed, ${s.errors} errors, $${s.costUsd.toFixed(4)}.`);
      await refresh();
    } catch (e) {
      say("Stopped: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      let remaining = 1;
      while (remaining > 0) {
        const d = await call({ action: "copy-fixtures", assessmentId: assessmentId.trim() });
        remaining = d.remaining;
        say(`Copied ${d.copied}; ${d.remaining} left${d.purged ? `; ${d.purged} already removed by retention` : ""}.`);
        if (!d.copied && remaining > 0) break;
      }
    } catch (e) {
      say("Copy refused: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeCases() {
    setBusy(true);
    try {
      const d = await call({
        action: "create-cases",
        assessmentId: assessmentId.trim(),
        kinds: ["names", "answer_reading", "grouping", "answer_key", "standards"],
      });
      say(`Made ${d.made.length} case(s): ${d.made.join(", ") || "none"}.`);
      for (const s of d.skipped) say(`Skipped ${s.kind}: ${s.reason}`);
      await refresh();
    } catch (e) {
      say("Refused: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function oldData() {
    setBusy(true);
    let total = 0;
    let threw = 0;
    let lost = 0;
    try {
      for (let index = 0; ; index++) {
        const d = await call({ action: "old-data-check", index });
        if (d.done) break;
        if (d.loadError) say(`${d.teacher}: workspace did not load (${d.loadError})`);
        for (const a of d.assessments) {
          total++;
          if (a.threw) {
            threw++;
            say(`${a.ref}: throws on open — ${a.threw}`);
          }
          if (a.pagesLost) {
            lost++;
            say(`${a.ref}: ${a.pagesLost} of ${a.pagesStored} pages lost on load`);
          }
        }
      }
      say(`Old-data check: ${total} assessments, ${threw} throw, ${lost} lose pages.`);
    } catch (e) {
      say("Old-data check stopped: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#1c2b24" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Test cases</h1>
      <p style={{ margin: "0 0 20px", color: "#4b5d55" }}>
        Real, teacher-confirmed cases replayed through the live AI settings. Case codes only — no names or answers are shown here.
      </p>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button onClick={runAll} disabled={busy || !summary?.cases.length} style={btn(true)}>
          Run test cases
        </button>
        <button onClick={oldData} disabled={busy} style={btn(false)}>
          Check old assessments
        </button>
      </section>

      <p style={{ margin: "0 0 16px" }}>
        {summary ? `${summary.cases.filter((c) => c.active).length} active case(s)` : "Loading…"}
        {summary?.cases.length ? ": " + summary.cases.map((c) => `${c.code} (${c.kind})`).join(", ") : ""}
      </p>

      {last && (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18 }}>
            Last run: {last.passed}/{last.cases} passed · ${last.costUsd.toFixed(4)}
          </h2>
          <ul style={{ paddingLeft: 18 }}>
            {last.perCase.map((c) => (
              <li key={c.code} style={{ marginBottom: 4, overflowWrap: "anywhere" }}>
                <strong>{c.code}</strong> {c.kind}: {c.status} — {headline(c.metrics)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ borderTop: "1px solid #d8e2dc", paddingTop: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Add an allow-listed set</h2>
        <p style={{ margin: "0 0 8px", color: "#4b5d55" }}>
          Only works for an assessment already on the allow-list (its teacher has agreed). Copy its photos first, then make cases from what the teacher confirmed.
        </p>
        <input
          value={assessmentId}
          onChange={(e) => setAssessmentId(e.target.value)}
          placeholder="Assessment id"
          aria-label="Assessment id"
          style={{ width: "100%", maxWidth: 420, padding: 8, marginBottom: 8, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button onClick={copy} disabled={busy || !assessmentId.trim()} style={btn(false)}>
            Copy photos
          </button>
          <button onClick={makeCases} disabled={busy || !assessmentId.trim()} style={btn(false)}>
            Make cases
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Progress</h2>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f4f7f5", padding: 12, minHeight: 80, fontSize: 13 }}>
          {log.join("\n") || "Nothing yet."}
        </pre>
      </section>
    </main>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 8,
    border: primary ? "none" : "1px solid #2f5d4a",
    background: primary ? "#2f5d4a" : "#fff",
    color: primary ? "#fff" : "#2f5d4a",
    fontWeight: 600,
    cursor: "pointer",
  };
}
