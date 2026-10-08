"use client";
import { useEffect, useRef, useState } from "react";
import { uprightPage } from "@/lib/image-prep";
import { uploadFile } from "@/lib/upload-client";
import { analyzeRequest } from "@/lib/analyze-client";
import {
  Camera,
  Check,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { describeFailure } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import { Action, EmptyState, Pill, SectionTitle } from "./teacher-shared";
import { ScanCamera } from "./scan-camera";
import {
  activeQuestions,
  applyAnswerKey,
  parseAnswerKey,
  preparationGaps,
} from "@/lib/teacher-workflow";
import {
  applyKeyCheck,
  keyIsGenerated,
  questionsToCheck,
  settleDisagreements,
} from "@/lib/key-check";
import { extractUploadedPdfText } from "@/lib/pdf-text";
import type { Assessment } from "@/lib/teacher-types";

type Uploaded = { id: string; mime: string };

/**
 * Symbols that are painful to type on a phone keyboard, inserted at the cursor
 * of whichever answer box was last focused. Ricky: correcting an Algebra 2 key
 * by hand meant hunting for minus signs, exponents and fractions.
 */
const MATH_KEYS: { label: string; insert: string; title: string }[] = [
  { label: "−", insert: "−", title: "minus / negative" },
  { label: "a/b", insert: "/", title: "fraction bar" },
  { label: "( )", insert: "()", title: "parentheses" },
  { label: "x", insert: "x", title: "x" },
  { label: "x²", insert: "²", title: "squared" },
  { label: "x³", insert: "³", title: "cubed" },
  { label: "xⁿ", insert: "^", title: "exponent" },
  { label: "√", insert: "√(", title: "square root" },
  { label: "π", insert: "π", title: "pi" },
  { label: "≠", insert: "≠", title: "not equal" },
  { label: "≤", insert: "≤", title: "less than or equal" },
  { label: "≥", insert: "≥", title: "greater than or equal" },
  { label: "±", insert: "±", title: "plus or minus" },
];

export function AnswerKeyReview({
  assessment: a,
  onSave,
  onConfirmed,
}: {
  assessment: Assessment;
  onSave: (a: Assessment, message: string) => Promise<boolean>;
  // Called once the key is confirmed, so the flow can move straight on to
  // student work instead of leaving the teacher on a finished step.
  onConfirmed?: () => void;
}) {
  const { busy, aiReady } = useTeacher();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false),
    [reading, setReading] = useState(false),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Whether the key has been read at least once, so the button reads "Read
  // again" rather than "Read the key".
  const [hasReadKey, setHasReadKey] = useState(false);
  // The second, independent solve of a key the app worked out (lib/key-check).
  const [checking, setChecking] = useState(false);
  const checkStarted = useRef<string | null>(null);
  // Disagreements the teacher has settled on this screen ("Use" / "Keep" or
  // by editing the answer), not yet saved.
  const [settled, setSettled] = useState<Set<string>>(new Set());
  // The answer box the math keys type into.
  const boxes = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    setAnswers(Object.fromEntries(a.questions.map((q) => [q.id, q.answer])));
  }, [a.id, a.questions]);
  const questions = activeQuestions(a),
    complete = questions.length > 0 && questions.every((q) => answers[q.id]?.trim());
  const changed = questions.some(
    (q) => (answers[q.id] || "").trim() !== q.answer.trim(),
  );
  const generated = keyIsGenerated(a);
  const unsettled = generated
    ? questions.filter(
        (q) =>
          q.keyCheck?.status === "differs" &&
          !settled.has(q.id) &&
          (answers[q.id] || "").trim() === q.answer.trim(),
      )
    : [];

  /** Solve the generated key a second time and flag where the two differ. */
  async function checkKey(fresh = false) {
    if (checking) return;
    setChecking(true);
    try {
      const d = await analyzeRequest({
        mode: "key_check",
        assessmentId: a.id,
        // The blank worksheet only, so figures and tables can be seen. Never
        // a.uploadIds, which also gathers scanned student pages.
        uploadIds: a.assignmentUploadIds ?? [],
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        freshRead: fresh,
      });
      const checked = (d.result.answers ?? []) as { questionId: string; answer: string }[];
      const next = applyKeyCheck(a, checked);
      const flagged = next.questions.filter(
        (q) => q.keyCheck?.status === "differs" && !a.questions.find((x) => x.id === q.id)?.keyCheck,
      ).length;
      await onSave(
        next,
        flagged
          ? flagged +
              (flagged === 1 ? " answer needs" : " answers need") +
              " your check before the key is confirmed"
          : "Every answer checked a second time and agreed",
      );
    } catch (e) {
      toast.error(
        describeFailure(
          e,
          "The answers couldn’t be double-checked just now. Check them yourself, or try again.",
        ),
      );
    } finally {
      setChecking(false);
    }
  }

  // A key the app worked out is checked once, as soon as it is on screen, so
  // the teacher never confirms a key nobody second-guessed.
  useEffect(() => {
    if (!aiReady || checking || busy) return;
    if (checkStarted.current === a.id) return;
    if (!questionsToCheck(a).length) return;
    const t = setTimeout(() => {
      checkStarted.current = a.id;
      void checkKey();
    }, 0);
    return () => clearTimeout(t);
    // checkKey reads the current assessment; re-running on every change would
    // check the same answers again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, aiReady, busy]);

  function settle(questionId: string, answer?: string) {
    if (answer !== undefined) setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    setSettled((prev) => new Set(prev).add(questionId));
  }

  /** Types a math symbol into the last-focused answer box, at the cursor. */
  function insertSymbol(text: string) {
    const id = focused ?? questions[0]?.id;
    if (!id) return;
    const box = boxes.current[id];
    const current = answers[id] || "";
    const start = box?.selectionStart ?? current.length;
    const end = box?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + text + current.slice(end);
    setAnswers((prev) => ({ ...prev, [id]: next }));
    // Put the cursor after what was typed (inside the brackets for "()").
    const caret = start + (text === "()" ? 1 : text.length);
    requestAnimationFrame(() => {
      const el = boxes.current[id];
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  async function upload(files: FileList | File[] | null) {
    if (!files?.length || uploading) return;
    if ((a.answerKeyUploadIds?.length || 0) + files.length > 6) {
      toast.error("Use up to six files for the answer key.");
      return;
    }
    setUploading(true);
    setNotice("");
    const uploaded: Uploaded[] = [];
    try {
      for (const raw of Array.from(files)) {
        const file = await uprightPage(raw);
        const d = await uploadFile(file);
        uploaded.push({ id: d.id, mime: d.mime });
      }
    } catch (e) {
      toast.error(
        describeFailure(e, "The answer key couldn’t be uploaded."),
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
    if (!uploaded.length) return;
    const ids = [...(a.answerKeyUploadIds || []), ...uploaded.map((u) => u.id)];
    const saved = await onSave(
      { ...a, answerKeyUploadIds: ids, uploadIds: [...a.uploadIds, ...uploaded.map((u) => u.id)] },
      "Answer-key files saved",
    );
    if (!saved) return;
    // Collect all the key's pages, then read once -- the same as the blank test
    // and student work. A multi-page key photographed a page at a time used to
    // fire a full AI read on every page; now the pages are saved and the teacher
    // taps "Read the key" once to read them all together. The no-AI path still
    // parses a typed PDF locally on upload, since that is instant and costs
    // nothing.
    if (aiReady)
      setNotice(
        uploaded.length + (uploaded.length === 1 ? " page" : " pages") +
          " added. Add more if your key runs longer, then tap Read the key.",
      );
    else await readPdfFallback(uploaded);
  }

  async function readPdfFallback(uploaded: Uploaded[]) {
    const pdfs = uploaded.filter((u) => u.mime === "application/pdf");
    if (!pdfs.length) {
      setNotice(
        "Your key is saved. Type the answers below, or connect AI in Settings to read photographs automatically.",
      );
      return;
    }
    setReading(true);
    try {
      let text = "";
      for (const pdf of pdfs) text += (await extractUploadedPdfText(pdf.id)) + "\n";
      const parsed = parseAnswerKey(text, questions);
      const count = Object.keys(parsed).length;
      if (count) {
        setAnswers((previous) => ({ ...previous, ...parsed }));
        setNotice(
          count +
            " answers read from the PDF. Check them below, then confirm the key.",
        );
      } else
        setNotice(
          "The PDF was saved, but its answers weren’t numbered in a way that could be matched. Type them below.",
        );
    } catch {
      setNotice("Your key is saved. Type the answers below.");
    } finally {
      setReading(false);
    }
  }

  async function readKey(uploadIds = a.answerKeyUploadIds || [], fresh = false) {
    setReading(true);
    setNotice("");
    try {
      const d = await analyzeRequest({
        mode: "answer_key",
        assessmentId: a.id,
        uploadIds,
        text: paste,
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        freshRead: fresh,
      });
      const found = d.result.answers as {
        questionId: string;
        answer: string;
        confidence: number;
      }[];
      const next = { ...answers };
      for (const entry of found)
        if (entry.answer.trim() && questions.some((q) => q.id === entry.questionId))
          next[entry.questionId] = entry.answer;
      setAnswers(next);
      setHasReadKey(true);
      const uncertain = found.filter(
        (k) => !k.answer.trim() || k.confidence < 90,
      ).length;
      setNotice(
        found.length +
          " answers read. " +
          (uncertain ? uncertain + " need a closer check. " : "") +
          "Review the key below, then confirm it.",
      );
    } catch (e) {
      toast.error(
        describeFailure(e, "The key couldn’t be read. You can enter it manually."),
      );
    } finally {
      setReading(false);
    }
  }

  async function confirm() {
    if (unsettled.length) return;
    // Every disagreement on screen has been settled by now (the button waits
    // for it), so they are recorded as settled along with the key.
    const next = settleDisagreements(applyAnswerKey(a, answers));
    if (
      await onSave(
        { ...next, answerKeyVerified: true },
        changed && a.responses.length
          ? "Answer key saved. Recheck responses affected by the changes."
          : "Answer key confirmed",
      )
    ) {
      setNotice(
        "Answer key confirmed. Add student work on the next tab once the question standards are reviewed.",
      );
      onConfirmed?.();
    }
  }

  if (!questions.length)
    return (
      <EmptyState
        title="Add the assessment’s questions first"
        description="Each answer needs a question number to match against."
      />
    );
  const working = uploading || reading || busy;
  return (
    <section className="panel answer-key-panel">
      <SectionTitle
        title="Confirm your answer key"
        description="Upload or photograph your key and the answers fill in automatically. Check them, then confirm."
      >
        <Pill
          tone={preparationGaps(a).keyConfirmed && !changed ? "green" : "amber"}
        >
          {preparationGaps(a).keyConfirmed && !changed
            ? "Confirmed"
            : "Needs confirmation"}
        </Pill>
      </SectionTitle>
      {generated && (
        <div className="key-generated" role="status">
          <strong>The app worked out these answers from the worksheet.</strong>
          <p>
            They are not from your key. Each one is solved a second time to catch mistakes, and
            any the two solves disagree on is marked below for you to settle. If you have your own
            key, use it instead — upload or photograph it here.
          </p>
          {checking && (
            <p className="key-generated-status">
              <LoaderCircle className="spin" size={15} /> Double-checking the answers…
            </p>
          )}
          {!checking && aiReady && questionsToCheck(a).length > 0 && (
            <Action variant="secondary small" disabled={working} onClick={() => checkKey(true)}>
              <ClipboardCheck size={15} /> Double-check the answers
            </Action>
          )}
        </div>
      )}
      <div className="key-source-actions">
        <Action disabled={working} onClick={() => input.current?.click()}>
          {uploading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Upload size={17} />
          )}
          {generated ? "Upload my own key" : "Upload answer key"}
        </Action>
        <Action
          variant="secondary"
          disabled={working}
          onClick={() => setCameraOpen(true)}
        >
          <Camera size={17} />
          {generated ? "Photograph my key" : "Photograph key"}
        </Action>
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          aria-label="Upload the teacher answer key"
          onChange={(e) => upload(e.target.files)}
        />
        {cameraOpen && (
          <ScanCamera
            mode="single"
            title="Answer key"
            assessmentId={a.id}
            onComplete={(groups) => {
              setCameraOpen(false);
              const captured = groups.flat();
              if (captured.length) upload(captured);
            }}
            onCancel={() => setCameraOpen(false)}
            onFallback={() => {
              setCameraOpen(false);
              input.current?.click();
            }}
          />
        )}
        {aiReady && (a.answerKeyUploadIds?.length || paste.trim()) ? (
          <Action
            variant={hasReadKey ? "secondary" : ""}
            disabled={working}
            onClick={() => readKey(undefined, true)}
          >
            {reading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ClipboardCheck size={17} />
            )}
            {hasReadKey ? "Read again" : "Read the key"}
          </Action>
        ) : null}
      </div>
      {!!a.answerKeyUploadIds?.length && (
        <div className="source-documents">
          <span>Teacher key</span>
          {a.answerKeyUploadIds.map((id, i) => (
            <a key={id} href={"/api/uploads/" + id} target="_blank" rel="noreferrer">
              <FileText size={14} />
              Key file {i + 1}
            </a>
          ))}
        </div>
      )}
      {reading && (
        <div className="read-document-status" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>Reading the answer key…</p>
        </div>
      )}
      <details className="paste-key">
        <summary>Paste a numbered answer key instead</summary>
        <label className="block-label">
          One answer per question number
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"1. 238\n2. 42,306 < 42,360\n3. 15"}
          />
        </label>
        <Action
          variant="secondary small"
          disabled={!paste.trim()}
          onClick={() => {
            const parsed = parseAnswerKey(paste, questions);
            if (!Object.keys(parsed).length) {
              toast.error(
                "Start each answer with its question number, for example 1. 238",
              );
              return;
            }
            setAnswers((previous) => ({ ...previous, ...parsed }));
            setNotice(
              Object.keys(parsed).length +
                " answers filled. Check them below before confirming.",
            );
          }}
        >
          Fill answers
        </Action>
      </details>
      {notice && (
        <p className="key-notice" role="status">
          {notice}
        </p>
      )}
      <div className="math-keys" role="toolbar" aria-label="Math symbols">
        <span className="cell-meta">Insert:</span>
        {MATH_KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            className="math-key"
            title={k.title}
            aria-label={"Insert " + k.title}
            // Keep the answer box focused so the symbol lands at the cursor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertSymbol(k.insert)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="answer-key-list">
        {questions.map((q) => {
          const open = unsettled.some((u) => u.id === q.id);
          const other = q.keyCheck?.answer ?? "";
          return (
          <label key={q.id} className={open ? "key-disagrees" : undefined}>
            <span className="question-number">Q{q.number}</span>
            <div>
              <strong>{q.text}</strong>
              <span>{q.standard || "Standard not yet assigned"}</span>
              <textarea
                ref={(el) => {
                  boxes.current[q.id] = el;
                }}
                onFocus={() => setFocused(q.id)}
                aria-label={"Expected answer for question " + q.number}
                value={answers[q.id] || ""}
                onChange={(e) =>
                  setAnswers((previous) => ({
                    ...previous,
                    [q.id]: e.target.value,
                  }))
                }
                placeholder="Correct answer, acceptable reasoning, or scoring guidance"
                rows={2}
              />
              {generated && q.keyCheck?.status === "agrees" && (
                <span className="key-check-ok">
                  <Check size={13} /> Checked twice — both solves agree
                </span>
              )}
              {open && (
                <div className="key-check-differs" role="status">
                  <p>
                    Solved a second time, the app got <strong>{other}</strong> instead. Which is
                    right?
                  </p>
                  <div className="review-heading-actions">
                    <Action variant="secondary small" onClick={() => settle(q.id, other)}>
                      Use {other}
                    </Action>
                    <Action variant="secondary small" onClick={() => settle(q.id)}>
                      Keep {q.answer}
                    </Action>
                  </div>
                </div>
              )}
            </div>
          </label>
          );
        })}
      </div>
      <div className="key-confirm">
        <p>
          {unsettled.length
            ? unsettled.length +
              (unsettled.length === 1 ? " answer was" : " answers were") +
              " solved two different ways. Settle " +
              (unsettled.length === 1 ? "it" : "them") +
              " above before confirming."
            : changed && a.responses.length
              ? "Changing the key sends affected student answers back for review."
              : "Confirm the answers and acceptable reasoning before comparing student work."}
        </p>
        <Action onClick={confirm} disabled={working || checking || !complete || unsettled.length > 0}>
          <Check size={17} />
          Confirm answer key
        </Action>
      </div>
    </section>
  );
}
