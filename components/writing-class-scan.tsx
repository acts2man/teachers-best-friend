"use client";

import { useRef, useState } from "react";
import { Camera, Check, LoaderCircle, Upload, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { useTeacher } from "./teacher-context";
import { Action, Pick, SectionTitle } from "./teacher-shared";
import { ScanCamera } from "./scan-camera";
import { splitForClassScan, uprightPage } from "@/lib/image-prep";
import { uploadFile } from "@/lib/upload-client";
import { analyzeRequest, isRetryableAnalyzeError } from "@/lib/analyze-client";
import { describeFailure } from "@/lib/connection";
import {
  NAME_CONCURRENCY,
  groupPagesByCapture,
  mapLimit,
  mergeNameReads,
  planNameBatches,
  resolveScannedGroups,
  withRetry,
  type PageName,
  type ResolvedGroup,
} from "@/lib/teacher-class-scan";
import { replaceWritingResponses } from "@/lib/teacher-workflow";
import { classroomColors, reconcileEvidence } from "@/lib/teacher-data";
import { logAppEvent } from "@/lib/app-events-client";
import { compareByLastName } from "@/lib/teacher-classes";
import { ImageViewer } from "./image-viewer";
import type { Assessment, Student, StudentResponse } from "@/lib/teacher-types";

/**
 * Scoring a class set of WRITING the same way as a math or reading class set
 * (Michael Zotzman, grade 4 ELA, Android — asked 5 and 16 Nov 2026): the
 * teacher photographs the whole class with the class-set camera, tapping "Next
 * student" between students (writing usually runs several pages each), the app
 * reads the name off each page and matches the pages to students, and the
 * teacher checks each match (reassign, discard). Then each student's pages go to
 * the SAME per-student writing/rubric grading path the one-student panel uses
 * (mode "writing"), so a trait score lands exactly where it already persists.
 *
 * This reuses the class-set camera component (ScanCamera mode="class") and the
 * name-pass + matching library the math/reading class set uses
 * (planNameBatches, mergeNameReads, resolveScannedGroups) — it does not touch
 * that grading/billing path. Grading is deferred to after matching, because a
 * writing match is made from the name and the page, not from answers, so there
 * is nothing to grade before the teacher has said whose paper is whose.
 */
export function WritingClassScan({
  assessment: a,
  students,
  onUseSingle,
}: {
  assessment: Assessment;
  students: Student[];
  /** Switch to the one-student-at-a-time panel (kept as the secondary option). */
  onUseSingle: () => void;
}) {
  const { w, classroom, save, busy, aiReady } = useTeacher();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);
  const newStudents = useRef<Student[]>([]);

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? "Student";

  /** Upload one captured page: the whole page for grading, plus a reduced copy
   * of its top for the name pass — exactly as the class-set path does, so no
   * writing is cut off (docs/student-data-flow.md section 4). */
  async function preparePage(raw: File): Promise<{ bodyId: string; stripId: string | null }> {
    const page = await uprightPage(raw);
    const split = await splitForClassScan(page);
    if (!split) {
      const whole = await uploadFile(page);
      return { bodyId: whole.id, stripId: null };
    }
    const body = await uploadFile(split.page);
    const strip = await uploadFile(split.nameArea);
    return { bodyId: body.id, stripId: strip.id };
  }

  async function onCaptured(studentGroups: File[][]) {
    setCameraOpen(false);
    const pages = studentGroups.filter((g) => g.length);
    if (!pages.length) return;
    setWorking(true);
    newStudents.current = [];
    try {
      setStatus("Uploading the pages…");
      const ids: string[] = [];
      const nameIds: (string | null)[] = [];
      const sizes: number[] = [];
      for (const group of pages) {
        sizes.push(group.length);
        for (const file of group) {
          const { bodyId, stripId } = await preparePage(file);
          ids.push(bodyId);
          nameIds.push(stripId);
        }
      }
      const pageGroups = groupPagesByCapture(sizes);

      setStatus("Reading the name on each page…");
      const names = await readNames(ids, nameIds, pageGroups);
      // Matched the same way as a math/reading class set: resolveScannedGroups
      // turns the read names + the teacher's "Next student" grouping into one
      // row per student. No answers are graded yet, so `graded` is empty — the
      // match comes from the names and the roster, not from answers.
      const resolved = resolveScannedGroups(pageGroups, names, [], ids, students, nameIds);
      setGroups(resolved);
      setDiscarded(new Set());
    } catch (e) {
      toast.error(describeFailure(e, "The pages couldn’t be read. They are saved — try again."));
    } finally {
      setWorking(false);
      setStatus("");
    }
  }

  async function readNames(ids: string[], nameIds: (string | null)[], pageGroups: number[][]): Promise<PageName[]> {
    const slices = planNameBatches(nameIds, pageGroups);
    const reads = await mapLimit<(typeof slices)[number], { pages?: PageName[]; failed?: boolean }>(
      slices,
      NAME_CONCURRENCY,
      async (slice) => {
        const read = await withRetry(
          () =>
            analyzeRequest({
              mode: "name_strip",
              uploadIds: slice.map((s) => s.id),
              grade: a.grade,
              subject: a.subject,
              framework: a.framework,
              assessmentId: a.id,
            }),
          {
            retryable: isRetryableAnalyzeError,
            onRetry: (error) =>
              logAppEvent("ai_failure", {
                message: "writing name read failed; retrying: " + ((error as Error)?.message ?? ""),
                assessmentId: a.id,
                detail: { mode: "name_strip", kind: "error", retried: true },
              }),
          },
        );
        return read.result as { pages?: PageName[] };
      },
      (error) => {
        logAppEvent("ai_failure", {
          message: "writing name read failed: " + ((error as Error)?.message ?? ""),
          assessmentId: a.id,
          detail: { mode: "name_strip", kind: "error" },
        });
        return { failed: true };
      },
    );
    return mergeNameReads(ids.length, slices, reads);
  }

  function patch(key: string, next: Partial<ResolvedGroup>) {
    setGroups((gs) => gs && gs.map((g) => (g.key === key ? { ...g, ...next } : g)));
  }
  function chooseStudent(g: ResolvedGroup, value: string) {
    if (value === "new") {
      patch(g.key, { studentId: null, candidateIds: [], unassigned: false, name: g.name || "" });
      return;
    }
    const id = value.replace(/^existing:/, "");
    patch(g.key, { studentId: id, name: nameOf(id), candidateIds: [], unassigned: false, suggestedId: id });
  }
  function toggleDiscard(key: string) {
    setDiscarded((d) => {
      const next = new Set(d);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const matchedIds = new Set(
    (groups ?? []).filter((g) => !discarded.has(g.key) && g.studentId).map((g) => g.studentId as string),
  );
  const kept = (groups ?? []).filter((g) => !discarded.has(g.key));
  const open = kept.filter((g) => g.candidateIds.length > 0 || g.unassigned || (!g.studentId && !g.name.trim()));
  const canSave = !!groups && kept.length > 0 && open.length === 0;

  async function gradeAndSave() {
    if (!groups || working || !canSave) return;
    if (!aiReady) {
      toast.error("Scoring needs the AI connection. Try again once you are back online.");
      return;
    }
    setWorking(true);
    try {
      // Give every kept row a real student id: an existing match, or a student
      // created here for a "new" row.
      newStudents.current = [];
      const rows = kept.map((g) => {
        let studentId = g.studentId;
        if (!studentId) {
          const created: Student = {
            id: crypto.randomUUID(),
            classId: classroom.id,
            name: g.name.trim() || "Unnamed student",
            color: classroomColors[(students.length + newStudents.current.length) % classroomColors.length],
            evidence: [],
            notes: "",
          };
          newStudents.current.push(created);
          studentId = created.id;
        }
        return { studentId, pageUploadIds: g.pageUploadIds };
      });

      // Each student's essay is one writing grading call holding that student's
      // pages (~2–3 for a typical essay) — the same request the one-student
      // panel sends, so the cost per student matches a math class set's batch.
      setStatus("Scoring each student’s writing against your rubric…");
      let done = 0;
      const scored = await mapLimit<(typeof rows)[number], { studentId: string; responses: StudentResponse[] }>(
        rows,
        3,
        async (row) => {
          const d = await analyzeRequest({
            mode: "writing",
            text: "",
            uploadIds: row.pageUploadIds,
            grade: a.grade,
            subject: a.subject,
            framework: a.framework,
            assessmentId: a.id,
            studentId: row.studentId,
          });
          setStatus("Scored " + ++done + " of " + rows.length + "…");
          return { studentId: row.studentId, responses: d.result.responses as StudentResponse[] };
        },
        (error, row) => {
          logAppEvent("ai_failure", {
            message: "writing scoring failed: " + ((error as Error)?.message ?? ""),
            assessmentId: a.id,
            detail: { mode: "writing", kind: "error" },
          });
          return { studentId: row.studentId, responses: [] as StudentResponse[] };
        },
      );

      // Fold the pages and the scores into the assessment: pages per student,
      // then the suggested trait scores through the existing rubric path (keyed
      // by trait id, never student_responses).
      let next: Assessment = { ...a };
      for (const row of rows) {
        next = {
          ...next,
          uploadIds: [...new Set([...next.uploadIds, ...row.pageUploadIds])],
          studentUploadIds: {
            ...next.studentUploadIds,
            [row.studentId]: [...new Set([...(next.studentUploadIds?.[row.studentId] || []), ...row.pageUploadIds])],
          },
        };
      }
      for (const s of scored) {
        if (s.responses.length) next = replaceWritingResponses(next, s.studentId, s.responses, false);
      }

      const roster = [...w.students, ...newStudents.current];
      const graded = scored.filter((s) => s.responses.length).length;
      const ok = await save(
        {
          ...w,
          students: reconcileEvidence(roster, next),
          assessments: w.assessments.map((x) => (x.id === a.id ? next : x)),
        },
        graded +
          " student" +
          (graded === 1 ? "" : "s") +
          " scored from the scanned class set" +
          (newStudents.current.length ? " (" + newStudents.current.length + " new)" : "") +
          " — confirm or change each trait",
      );
      if (ok) {
        setGroups(null);
        setDiscarded(new Set());
        if (graded < rows.length)
          toast.warning(
            rows.length - graded +
              " student" +
              (rows.length - graded === 1 ? "'s writing" : "s' writing") +
              " couldn’t be scored. The pages are saved — score those by hand on the one-student view.",
          );
      }
    } catch (e) {
      toast.error(describeFailure(e, "The class set couldn’t be scored. The pages are saved."));
    } finally {
      setWorking(false);
      setStatus("");
    }
  }

  if (!students.length)
    return (
      <div className="panel">
        <SectionTitle title="Student writing" description="Add students to this class, then their writing can be scored here." />
      </div>
    );

  return (
    <div className="panel">
      <SectionTitle
        title="Student writing"
        description="Photograph the whole class, tapping “Next student” between students. The app reads each name and matches the pages; you check the matches, then each essay is scored against your rubric."
      />
      {!groups && (
        <div className="review-heading-actions">
          <Action disabled={working || busy} onClick={() => setCameraOpen(true)}>
            {working ? <LoaderCircle className="spin" size={16} /> : <Camera size={16} />}
            {working ? status || "Working…" : "Add student work"}
          </Action>
          <Action variant="secondary" disabled={working || busy} onClick={onUseSingle}>
            <Upload size={16} />
            One student at a time
          </Action>
        </div>
      )}
      {working && status && <p className="cell-meta" role="status">{status}</p>}

      {cameraOpen && (
        <ScanCamera
          mode="class"
          title={a.title}
          assessmentId={a.id}
          onComplete={onCaptured}
          onCancel={() => setCameraOpen(false)}
          onFallback={() => {
            setCameraOpen(false);
            onUseSingle();
          }}
        />
      )}

      {groups && groups.length > 0 && (
        <div className="class-scan-groups">
          <p className="cell-meta">
            Students are listed in the order you scanned them. Check each name against the paper — tap a
            picture to see it full size. Then score the class.
          </p>
          {groups.map((g) => {
            const firstPage = g.pageUploadIds[0];
            const chosen = g.studentId ?? "";
            return (
              <div className={"class-scan-row name-match-row" + (discarded.has(g.key) ? " discarded" : "")} key={g.key}>
                <div className="name-match-work">
                  {firstPage && (
                    <button
                      type="button"
                      className="name-match-thumb"
                      onClick={() => setViewing({ src: "/api/uploads/" + firstPage, alt: "First page of this student's writing" })}
                      aria-label="Enlarge the first page of this student's writing"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={"/api/uploads/" + firstPage} alt="First page of this student's writing" />
                      <span className="work-sample-hint"><ZoomIn size={12} /> Enlarge</span>
                    </button>
                  )}
                </div>
                <div className="class-scan-row-main name-match-main">
                  <span className="cell-meta">
                    {g.pageUploadIds.length} page{g.pageUploadIds.length === 1 ? "" : "s"}
                    {g.detectedName ? " · read as “" + g.detectedName + "”" : " · no name read"}
                  </span>
                  <Pick
                    label={g.candidateIds.length ? "Which student?" : g.unassigned ? "Whose paper is this?" : "Match to a student"}
                    value={g.candidateIds.length || g.unassigned ? "" : g.studentId ? "existing:" + g.studentId : g.name.trim() ? "new" : ""}
                    onChange={(v) => v && chooseStudent(g, v)}
                    options={[
                      ...(g.candidateIds.length || g.unassigned || (!g.studentId && !g.name.trim())
                        ? [{ value: "", label: "Choose a student…" }]
                        : []),
                      ...g.candidateIds.map((id) => ({
                        value: "existing:" + id,
                        label: nameOf(id) + (id === g.suggestedId ? " (best guess)" : ""),
                      })),
                      { value: "new", label: "Add as a new student" },
                      ...[...students]
                        .filter((s) => !g.candidateIds.includes(s.id))
                        .sort((x, y) => compareByLastName(x.name, y.name))
                        .map((s) => ({
                          value: "existing:" + s.id,
                          label: s.name + (s.id !== chosen && matchedIds.has(s.id) ? " · already matched" : ""),
                        })),
                    ]}
                  />
                  {!g.studentId && !g.candidateIds.length && !g.unassigned && (
                    <input
                      className="class-scan-name-input"
                      aria-label="New student name"
                      value={g.name}
                      onChange={(e) => patch(g.key, { name: e.target.value })}
                      placeholder="Student name"
                    />
                  )}
                  {g.candidateIds.length > 0 && (
                    <p className="key-notice" role="status">
                      “{g.detectedName}” fits {g.candidateIds.length} students in this class. Choose whose paper this is before scoring.
                    </p>
                  )}
                  {g.unassigned && (
                    <p className="key-notice" role="status">Choose whose paper this is before scoring.</p>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={discarded.has(g.key) ? "Keep this paper" : "Leave this paper out"}
                  onClick={() => toggleDiscard(g.key)}
                >
                  {discarded.has(g.key) ? <Check size={16} /> : <X size={16} />}
                </button>
              </div>
            );
          })}
          <div className="review-heading-actions">
            <Action disabled={working || busy || !canSave} onClick={gradeAndSave}>
              {working ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {working ? status || "Scoring…" : "Score " + kept.length + " student" + (kept.length === 1 ? "" : "s")}
            </Action>
            <Action variant="secondary" disabled={working || busy} onClick={() => { setGroups(null); setDiscarded(new Set()); }}>
              Start over
            </Action>
          </div>
          {open.length > 0 && (
            <p className="cell-meta" role="status">
              {open.length} paper{open.length === 1 ? "" : "s"} still need{open.length === 1 ? "s" : ""} a student before you can score.
            </p>
          )}
        </div>
      )}

      {viewing && <ImageViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </div>
  );
}
