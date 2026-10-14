"use client";
/**
 * The replay page: run the test cases, copy an allow-listed set's photos, make
 * cases from it, and check that old assessments still open. It drives the
 * server one step at a time (see lib/regression/runner.ts) and shows anonymised
 * case codes and numbers -- plus, for answers the scorer cannot settle (prose
 * for a human check) or that are missing parts, the read and the expected
 * text side by side. For reading cases that text is a student's answer: this
 * page is admin-only (regression_admins), and the text comes from the private
 * regression_run_cases.metrics. See docs/student-data-flow.md section 8.
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

/** One retry-on-hiccup wrapper for the step loop: a 502 from the platform or a
 * dropped connection mid-run is retried a few times instead of stopping a run
 * whose AI jobs are still going. A refusal (4xx) is not retried. */
async function callWithRetry(payload: Record<string, unknown>, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await call(payload);
    } catch (e) {
      if (i >= tries || /\(4\d\d\)|refused|not found/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

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
  if (m.names) return `${m.names.correct}/${Number(m.names.piles) - Number(m.names.noStrip ?? 0)} names right, ${m.names.wrongConfident} filled in wrongly, ${m.names.unassigned} left to choose` + (Number(m.names.noStrip) ? `, ${m.names.noStrip} with no name photo` : "");
  if (m.answers) {
    const a = m.answers;
    const checks = listOf(a.needsHumanCheck).length;
    const short = listOf(a.partsMissing).length;
    return `grouped ${pct(a.groupAccuracy)}, ${a.readRight}/${a.answers} read faithfully` +
      (short ? ` (${short} multi-part ${short === 1 ? "answer" : "answers"} missing a part)` : "") +
      (checks ? `, ${checks} ${checks === 1 ? "needs" : "need"} a human check` : "") +
      `, wrongly correct ${a.wronglyCorrect}, wrongly blank ${a.wronglyBlank}, full credit not pre-marked ${a.missedCorrect}, unsure ${a.unsure}` +
      (Number(a.partsExpected) ? `, multi-part ${a.partsReturned}/${a.partsExpected} parts returned` : "") +
      (Number(a.creditSplits) ? `, ${a.creditSplits} given different credit by the teacher for the same answer (not counted against grouping)` : "");
  }
  if (m.answer_key) {
    const k = m.answer_key;
    const checks = listOf(k.needsHumanCheck).length;
    const short = listOf(k.partsMissing).length;
    const wrong = Array.isArray(k.wrong) ? (k.wrong as number[]) : [];
    const notWrong = Number(k.items) - wrong.length - Number(k.missing ?? 0);
    return `${notWrong}/${k.items} not wrong (${k.right} confirmed` +
      (short ? `, ${short} missing ${short === 1 ? "a part" : "parts"}` : "") +
      (checks ? `, ${checks} ${checks === 1 ? "needs" : "need"} a human check` : "") +
      `)` +
      (wrong.length ? `; wrong: ${wrong.map((n) => "Q" + n).join(", ")}` : "") +
      (Number(k.missing) ? `; ${k.missing} not read` : "");
  }
  const k = m.standards;
  return k ? `${k.right}/${k.items} right (${pct(k.accuracy)})` : "";
}

type Side = { read: string; expected: string; number?: number; questionId?: string };
const listOf = (v: unknown): Side[] => (Array.isArray(v) ? (v as Side[]) : []);

/** The answers a person should look at, read and expected side by side. */
function SideBySide({ metrics }: { metrics: Record<string, Record<string, unknown>> | null }) {
  const m = metrics?.answers ?? metrics?.answer_key;
  if (!m) return null;
  const groups = [
    { title: "Needs a human check (not counted as a miss)", items: listOf(m.needsHumanCheck) },
    { title: "Read faithfully, but missing parts", items: listOf(m.partsMissing) },
  ].filter((g) => g.items.length);
  if (!groups.length) return null;
  const cell: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid #d8e2dc", verticalAlign: "top", overflowWrap: "anywhere" };
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} style={{ margin: "6px 0 10px" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{g.title}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...cell, width: "3.5em", textAlign: "left" }}>Q</th>
                <th style={{ ...cell, textAlign: "left" }}>Replay read</th>
                <th style={{ ...cell, textAlign: "left" }}>Expected</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((it, i) => (
                <tr key={i}>
                  <td style={cell}>{it.number ? "Q" + it.number : "–"}</td>
                  <td style={cell}>{it.read}</td>
                  <td style={cell}>{it.expected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

export function RegressionConsole() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [last, setLast] = useState<RunSummary | null>(null);
  const [assessmentId, setAssessmentId] = useState("");
  const [declared, setDeclared] = useState(true);
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
    let runId = "";
    try {
      const started = await call({ action: "start-run" });
      runId = started.runId;
      const cases = started.cases;
      say(`Run started with ${cases.length} case(s).`);
      for (const code of cases as string[]) {
        let status = "running";
        let guard = 0;
        while (status === "running" && guard++ < 400) {
          const d = await callWithRetry({ action: "step", runId, caseCode: code });
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
      if (runId) await call({ action: "abandon-run", runId }).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Delete this set's copied photos and its test cases? This cannot be undone.")) return;
    setBusy(true);
    try {
      const d = await call({ action: "revoke", assessmentId: assessmentId.trim() });
      say(`Revoked: ${d.removed} copied photo(s) deleted, cases removed.`);
      await refresh();
    } catch (e) {
      say("Revoke refused: " + (e as Error).message);
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
        pilesDeclared: declared,
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
        Real, teacher-confirmed cases replayed through the live AI settings. Case codes, not names. Answers appear only where the scorer needs a person to look (a human check, or a read missing parts), shown side by side.
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
                <SideBySide metrics={c.metrics} />
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
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, margin: "0 0 8px", fontWeight: 400 }}>
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} style={{ width: "auto" }} />
          The teacher tapped “Next student” between students when scanning this set
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button onClick={copy} disabled={busy || !assessmentId.trim()} style={btn(false)}>
            Copy photos
          </button>
          <button onClick={makeCases} disabled={busy || !assessmentId.trim()} style={btn(false)}>
            Make cases
          </button>
          <button onClick={revoke} disabled={busy || !assessmentId.trim()} style={btn(false)}>
            Revoke set
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
