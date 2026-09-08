"use client";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTeacher } from "./teacher-context";
import { Action, EmptyState, Pill, SectionTitle } from "./teacher-shared";
import {
  activeQuestions,
  applyAnswerKey,
  parseAnswerKey,
  preparationGaps,
} from "@/lib/teacher-workflow";
import { extractUploadedPdfText } from "@/lib/pdf-text";
import type { Assessment } from "@/lib/teacher-types";

type Uploaded = { id: string; mime: string };

export function AnswerKeyReview({
  assessment: a,
  onSave,
}: {
  assessment: Assessment;
  onSave: (a: Assessment, message: string) => Promise<boolean>;
}) {
  const { busy, aiReady } = useTeacher();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false),
    [reading, setReading] = useState(false),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setAnswers(Object.fromEntries(a.questions.map((q) => [q.id, q.answer])));
  }, [a.id, a.questions]);
  const questions = activeQuestions(a),
    complete = questions.length > 0 && questions.every((q) => answers[q.id]?.trim());
  const changed = questions.some(
    (q) => (answers[q.id] || "").trim() !== q.answer.trim(),
  );

  async function upload(files: FileList | null) {
    if (!files?.length || uploading) return;
    if ((a.answerKeyUploadIds?.length || 0) + files.length > 6) {
      toast.error("Use up to six files for the answer key.");
      return;
    }
    setUploading(true);
    setNotice("");
    const uploaded: Uploaded[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/uploads", { method: "POST", body: form }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        uploaded.push({ id: d.id, mime: d.mime });
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "The answer key couldn’t be uploaded.",
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
    if (!uploaded.length) return;
    const ids = [...(a.answerKeyUploadIds || []), ...uploaded.map((u) => u.id)];
    const saved = await onSave(
      { ...a, answerKeyUploadIds: ids, uploadIds: [...a.uploadIds, ...uploaded.map((u) => u.id)] },
      "Answer-key files saved",
    );
    if (!saved) return;
    // Read the key automatically so the teacher never retypes it.
    if (aiReady) await readKey(ids);
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

  async function readKey(uploadIds = a.answerKeyUploadIds || []) {
    setReading(true);
    setNotice("");
    try {
      const r = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "answer_key",
            assessmentId: a.id,
            uploadIds,
            text: paste,
            grade: a.grade,
            subject: a.subject,
            framework: a.framework,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
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
        e instanceof Error
          ? e.message
          : "The key couldn’t be read. You can enter it manually.",
      );
    } finally {
      setReading(false);
    }
  }

  async function confirm() {
    const next = applyAnswerKey(a, answers);
    if (
      await onSave(
        { ...next, answerKeyVerified: true },
        changed && a.responses.length
          ? "Answer key saved. Recheck responses affected by the changes."
          : "Answer key confirmed",
      )
    )
      setNotice(
        "Answer key confirmed. Add student work on the next tab once the question standards are reviewed.",
      );
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
      <div className="key-source-actions">
        <Action disabled={working} onClick={() => input.current?.click()}>
          {uploading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Upload size={17} />
          )}
          Upload answer key
        </Action>
        <Action
          variant="secondary"
          disabled={working}
          onClick={() => camera.current?.click()}
        >
          <Camera size={17} />
          Photograph key
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
        <input
          ref={camera}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          aria-label="Photograph the teacher answer key"
          onChange={(e) => upload(e.target.files)}
        />
        {aiReady && (a.answerKeyUploadIds?.length || paste.trim()) ? (
          <Action variant="secondary" disabled={working} onClick={() => readKey()}>
            {reading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ClipboardCheck size={17} />
            )}
            Read again
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
      <div className="answer-key-list">
        {questions.map((q) => (
          <label key={q.id}>
            <span className="question-number">Q{q.number}</span>
            <div>
              <strong>{q.text}</strong>
              <span>{q.standard || "Standard not yet assigned"}</span>
              <textarea
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
            </div>
          </label>
        ))}
      </div>
      <div className="key-confirm">
        <p>
          {changed && a.responses.length
            ? "Changing the key sends affected student answers back for review."
            : "Confirm the answers and acceptable reasoning before comparing student work."}
        </p>
        <Action onClick={confirm} disabled={working || !complete}>
          <Check size={17} />
          Confirm answer key
        </Action>
      </div>
    </section>
  );
}
