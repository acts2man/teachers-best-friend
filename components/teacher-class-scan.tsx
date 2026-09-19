"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  ScanLine,
  LoaderCircle,
  Check,
  X,
  Users,
  Camera,
  UserPlus,
  Undo2,
} from "lucide-react";
import { analyzeRequest, resumeScan } from "@/lib/analyze-client";
import { splitNameBand, uprightPage } from "@/lib/image-prep";
import { describeFailure, useOnline } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import { Action, Pick, Pill, SectionTitle, Score } from "./teacher-shared";
import { activeQuestions, preparationGaps } from "@/lib/teacher-workflow";
import { reconcileEvidence } from "@/lib/teacher-data";
import {
  applyScannedGroups,
  groupPagesByCapture,
  groupPagesByName,
  planScanBatches,
  resolveScannedGroups,
  type GradedGroup,
  type PageName,
  type ResolvedGroup,
} from "@/lib/teacher-class-scan";
import type { Assessment } from "@/lib/teacher-types";

// A class set, front and back, with room to spare. The old limit of 24 existed
// because one request carried every page; grading is batched now, so the cap no
// longer protects anything it used to -- it just stopped a teacher scanning the
// class they came to scan.
const MAX_PAGES = 80;

/** Strips per name-reading request. The name pass returns a few tokens per
 * page, but it still has a ceiling, and it had the same shape of bug the
 * grading pass just had: every page in one request, however many there were. */
const NAME_BATCH = 24;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Where an in-progress scan is kept so a phone can survive itself.
 *
 * Scanning a class set takes a while, and a phone will happily sleep, reload
 * the tab or be swapped away from halfway through. The photographs themselves
 * are safe the moment they upload -- it is the grouping that only ever lived in
 * this component, and losing that is worse than losing the photos: the pages
 * are still on the server with nobody able to say whose they are. Keyed per
 * assessment so two assessments scanned in the same sitting do not collide.
 */
const draftKey = (assessmentId: string) => "tbf.scan-draft." + assessmentId;

/** A scan in progress: the pages grouped so far, and the grading job started
 * from them, if it got that far. */
type Progress = {
  /** Batches already graded, in whole-scan numbering. */
  graded: GradedGroup[];
  /** The next batch to send. */
  nextBatch: number;
  /** A batch already sent and still running, to pick up rather than repeat. */
  scanId: string | null;
};
type Draft = { piles: Page[][]; progress?: Progress | null };

/** localStorage is an external store, so it is read as one: a server snapshot
 * of null, a client snapshot of the raw string, and a subscription so a scan
 * continued in another tab is noticed rather than silently overwritten. Reading
 * it this way keeps the draft derived instead of copied into state through an
 * effect, which is what docs/url-derived-state.md asks for. */
function subscribeToDraft(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function parseDraft(raw: string | null): Draft | null {
  try {
    if (!raw) return null;
    const stored = JSON.parse(raw);
    // Drafts written before grading jobs were remembered are a bare array.
    const parsed = Array.isArray(stored) ? stored : stored?.piles;
    const progress = Array.isArray(stored) ? null : (stored?.progress ?? null);
    if (!Array.isArray(parsed)) return null;
    // Trust nothing that comes back: a half-written or hand-edited draft should
    // be dropped, not crash the panel a teacher is standing in front of.
    const piles = parsed
      .filter(Array.isArray)
      .map((pile) =>
        pile.filter(
          (page: unknown): page is Page =>
            !!page &&
            typeof (page as Page).bodyId === "string" &&
            typeof (page as Page).key === "string",
        ),
      );
    if (!piles.some((pile) => pile.length)) return null;
    const usable =
      progress &&
      Array.isArray(progress.graded) &&
      Number.isInteger(progress.nextBatch) &&
      progress.nextBatch >= 0
        ? {
            graded: progress.graded as GradedGroup[],
            nextBatch: progress.nextBatch as number,
            scanId: typeof progress.scanId === "string" ? progress.scanId : null,
          }
        : null;
    return { piles, progress: usable };
  } catch {
    return null;
  }
}

const EMPTY: Page[][] = [[]];

/** One uploaded page, already straightened and split into work and name band. */
type Page = { key: string; label: string; bodyId: string; stripId: string | null };

/**
 * Scanning a whole class's work for one assessment.
 *
 * Pages are collected into one pile per student, and the teacher decides where
 * a pile ends by tapping "next student". That boundary matters more than it
 * looks: a student's pages have to be graded together, in one request, or each
 * page is marked against the whole answer key on its own and every question
 * that lives on another page comes back blank. That is exactly what happened to
 * a pilot teacher -- a ten-question test across two pages, photographed a page
 * at a time, came back "5 of 10 blank" for every student, with both pages read
 * perfectly.
 *
 * Grouping by the name the AI reads off each page is kept for a stack that
 * arrives all at once (a desktop scanner's output), but a boundary the teacher
 * drew is a fact and a boundary read off a name line is a guess, so the
 * student-by-student flow is the one offered first.
 */
export function ClassScanPanel({ assessment: a }: { assessment: Assessment }) {
  const { w, classroom, students, save, busy, aiReady } = useTeacher();
  const online = useOnline();
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  // piles[i] is student i's pages, in the order they were scanned. There is
  // always an open pile at the end for the student being scanned right now.
  // The saved draft, derived from storage rather than copied into state, plus
  // whatever this sitting has changed on top of it. `edited === null` means
  // nothing has been touched yet, so what is on screen is purely the draft.
  const savedRaw = useSyncExternalStore(
    subscribeToDraft,
    () => localStorage.getItem(draftKey(a.id)),
    () => null,
  );
  const saved = useMemo(() => parseDraft(savedRaw), [savedRaw]);
  const [edited, setEdited] = useState<Page[][] | null>(null);
  const [progressOverride, setProgressOverride] = useState<{ value: Progress | null } | null>(null);
  const piles = edited ?? saved?.piles ?? EMPTY;
  const restored = !!saved && edited === null;
  // How far grading got, and any batch still running. Kept in the draft so an
  // interrupted class set resumes where it stopped instead of being paid for
  // twice.
  const progress = progressOverride ? progressOverride.value : (saved?.progress ?? null);
  const setProgress = (value: Progress | null) => setProgressOverride({ value });
  function setPiles(update: Page[][] | ((prev: Page[][]) => Page[][])) {
    setEdited((prev) => {
      const current = prev ?? saved?.piles ?? EMPTY;
      return typeof update === "function" ? update(current) : update;
    });
  }
  const [pageUploadIds, setPageUploadIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const stack = useRef<HTMLInputElement>(null);
  const prep = preparationGaps(a);

  // Grading that was already under way when the teacher left. Picked up from
  // where it stopped: batches already graded are not sent again, and a batch
  // still running on the provider's side is waited on rather than repeated,
  // because that one has already been billed.
  const resumeRef = useRef(false);
  useEffect(() => {
    if (!progress || scanning || groups || resumeRef.current) return;
    resumeRef.current = true;
    void gradeCaptured();
  }, [progress, scanning, groups]);


  // Keep the draft in step with the piles, including emptying it once the
  // scan has been graded and saved.
  useEffect(() => {
    try {
      if (piles.some((pile) => pile.length))
        localStorage.setItem(draftKey(a.id), JSON.stringify({ piles, progress }));
      else localStorage.removeItem(draftKey(a.id));
    } catch {
      // A browser refusing storage is not a reason to stop a teacher scanning.
    }
  }, [a.id, piles, progress]);

  const captured = piles.flat();
  const busyScanning = scanning || adding;

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/uploads", { method: "POST", body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d.id as string;
  }

  /**
   * Straighten, cut the name band off the top, and upload both halves. Two
   * uploads per page so that no single request ever holds a student's name
   * beside that student's answers -- see docs/student-data-flow.md section 4.
   */
  async function preparePage(raw: File): Promise<Omit<Page, "key" | "label">> {
    // A phone records its rotation in EXIF instead of rotating the pixels, so a
    // page shot in portrait arrives sideways. Straighten first: the band is cut
    // off the top of an upright page, which is only the top once rotated.
    const page = await uprightPage(raw);
    const split = await splitNameBand(page);
    if (!split) {
      // A PDF, or a browser that could not do the cut. Grade the whole page and
      // read no name from it; the teacher names that pile.
      return { bodyId: await upload(page), stripId: null };
    }
    return { bodyId: await upload(split.body), stripId: await upload(split.strip) };
  }

  function canAccept(count: number) {
    if (captured.length + count <= MAX_PAGES) return true;
    toast.error("Scan up to " + MAX_PAGES + " pages at a time, then grade and start another batch.");
    return false;
  }

  function ready() {
    if (!prep.ready) {
      toast.error("Confirm the standards and answer key before scanning student work.");
      return false;
    }
    if (!aiReady) {
      toast.error("Scanning a whole class needs the AI connection.");
      return false;
    }
    return true;
  }

  /** Add pages to the student currently being scanned. */
  async function addPages(list: FileList | null) {
    if (!list?.length || busyScanning) return;
    const files = Array.from(list);
    if (!ready() || !canAccept(files.length)) return;
    setGroups(null);
    setAdding(true);
    try {
      for (const raw of files) {
        setStatus("Adding page " + (captured.length + 1) + "…");
        const prepared = await preparePage(raw);
        setPiles((p) => {
          const next = p.map((pile) => [...pile]);
          next[next.length - 1].push({
            key: crypto.randomUUID(),
            label: raw.name || "Page",
            ...prepared,
          });
          return next;
        });
      }
    } catch (e) {
      toast.error(describeFailure(e, "That page couldn't be uploaded."));
    } finally {
      setAdding(false);
      setStatus("");
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }

  function nextStudent() {
    if (!piles[piles.length - 1].length) {
      toast.error("Add at least one page for this student first.");
      return;
    }
    setPiles((p) => [...p, []]);
  }

  /** Undo the last page, or close an empty pile that was opened by mistake. */
  function undoLast() {
    setPiles((p) => {
      const next = p.map((pile) => [...pile]);
      if (!next[next.length - 1].length && next.length > 1) next.pop();
      else next[next.length - 1].pop();
      return next;
    });
    setGroups(null);
  }

  function reset() {
    setProgress(null);
    setEdited(EMPTY);
    setPageUploadIds([]);
    setGroups(null);
    setDiscarded(new Set());
  }

  /**
   * Read the names, then grade. `explicit` carries the teacher's own pile
   * boundaries; without it the stack is split by whichever pages carried a
   * legible name.
   */
  async function gradePages(
    pages: Page[],
    explicit: number[] | null,
    resume?: Progress | null,
  ) {
    const ids = pages.map((p) => p.bodyId);
    setPageUploadIds(ids);
    // Pass one: the name bands alone. No questions, no answer key, no work.
    setStatus("Reading the name on each page…");
    const readable = pages
      .map((p, page) => ({ id: p.stripId, page }))
      .filter((s): s is { id: string; page: number } => !!s.id);
    let names: PageName[] = ids.map((_, page) => ({ page, name: "", confidence: 0 }));
    // Batched for the same reason grading is: one request holding every strip
    // in a class set is a request whose size nobody chose.
    const found = new Map<number, { name: string; confidence: number }>();
    for (const slice of chunk(readable, NAME_BATCH)) {
      const read = await analyzeRequest({
        mode: "name_strip",
        uploadIds: slice.map((s) => s.id),
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        assessmentId: a.id,
      });
      // Each request numbers its answers within the strips it was shown; map
      // them back to the page each strip was cut from.
      for (const r of (read.result.pages ?? []) as PageName[]) {
        const source = slice[r.page];
        if (source) found.set(source.page, { name: r.name, confidence: r.confidence });
      }
    }
    names = names.map((n) => {
      const hit = found.get(n.page);
      return hit ? { page: n.page, name: hit.name, confidence: hit.confidence } : n;
    });

    // Pass two: the work, with the name bands gone, grouped either by what the
    // teacher declared or by what pass one found. Shown no name at all.
    const pageGroups = explicit ? groupPagesByCapture(explicit) : groupPagesByName(names);

    // One request per handful of students rather than one for the whole class.
    // A class set asked for more output than the model would return in a single
    // answer and came back incomplete, which cost the teacher the scan and told
    // them only to try fewer pages. The photographs are the expensive part and
    // there are exactly as many of them either way.
    const batches = planScanBatches(pageGroups, ids, activeQuestions(a).length);
    // Resume where an interrupted run stopped rather than grading, and paying,
    // from the top again.
    const resuming = resume && resume.nextBatch <= batches.length ? resume : null;
    const graded: GradedGroup[] = resuming ? [...resuming.graded] : [];
    let inFlight = resuming?.scanId ?? null;
    for (const [index, batch] of batches.entries()) {
      if (resuming && index < resuming.nextBatch) continue;
      setStatus(
        batches.length > 1
          ? "Grading students " +
              (batch.groupIndexes[0] + 1) +
              "–" +
              (batch.groupIndexes[batch.groupIndexes.length - 1] + 1) +
              " of " +
              pageGroups.length +
              "…"
          : "Grading " +
              pageGroups.length +
              " student" +
              (pageGroups.length === 1 ? "" : "s") +
              "…",
      );
      // A batch already sent and still running is waited on, not repeated.
      let d;
      if (inFlight) {
        try {
          d = await resumeScan(inFlight);
        } catch {
          d = null;
        }
        inFlight = null;
      }
      if (!d)
        d = await analyzeRequest(
          {
            mode: "class_scan",
            uploadIds: batch.uploadIds,
            pageGroups: batch.groups,
            grade: a.grade,
            subject: a.subject,
            framework: a.framework,
            assessmentId: a.id,
          },
          // Record the job before waiting on it, so a phone that sleeps
          // mid-grade picks this exact one up instead of paying for another.
          { onScanId: (id) => setProgress({ graded, nextBatch: index, scanId: id }) },
        );
      // The model numbers its answers within the batch it was shown; put them
      // back into the numbering of the whole scan.
      for (const g of (d.result.groups ?? []) as GradedGroup[]) {
        const at = batch.groupIndexes[g.group];
        if (at !== undefined) graded.push({ ...g, group: at });
      }
      // Banked, so an interruption after this batch never re-grades it.
      setProgress({ graded, nextBatch: index + 1, scanId: null });
    }
    setProgress(null);
    const resolved = resolveScannedGroups(pageGroups, names, graded, ids, students);
    if (!resolved.length)
      toast.error(
        "No student work could be identified on these pages. The pages are saved — try re-scanning them more clearly.",
      );
    setGroups(resolved);
  }

  /** Grade everything scanned so far, one request per student's whole pile. */
  async function gradeCaptured() {
    if (busyScanning || !captured.length) return;
    if (!ready()) return;
    setScanning(true);
    try {
      await gradePages(
        captured,
        piles.map((pile) => pile.length),
        progress,
      );
    } catch (e) {
      toast.error(
        describeFailure(e, "The pages couldn't be read.") +
          " The pages are uploaded — you can try grading again.",
      );
    } finally {
      setScanning(false);
      setStatus("");
    }
  }

  /** The desktop path: a whole stack at once, split by the name on each page. */
  async function startStackScan(list: FileList | null) {
    if (!list?.length || busyScanning) return;
    const files = Array.from(list);
    if (!ready()) return;
    if (files.length > MAX_PAGES) {
      toast.error("Scan up to " + MAX_PAGES + " pages at a time.");
      return;
    }
    setScanning(true);
    setGroups(null);
    setDiscarded(new Set());
    setStatus("Uploading " + files.length + " page" + (files.length === 1 ? "" : "s") + "…");
    try {
      const pages: Page[] = [];
      for (const raw of files) {
        pages.push({
          key: crypto.randomUUID(),
          label: raw.name || "Page",
          ...(await preparePage(raw)),
        });
      }
      setPiles([pages]);
      await gradePages(pages, null);
    } catch (e) {
      toast.error(
        describeFailure(e, "The pages couldn't be read.") +
          " The pages are uploaded — you can try scanning again.",
      );
    } finally {
      setScanning(false);
      setStatus("");
      if (stack.current) stack.current.value = "";
    }
  }

  function updateGroup(key: string, patch: Partial<ResolvedGroup>) {
    setGroups((g) => g && g.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function toggleDiscard(key: string) {
    setDiscarded((d) => {
      const next = new Set(d);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function saveAll() {
    if (!groups || saving) return;
    const kept = groups.filter((g) => !discarded.has(g.key) && g.name.trim());
    if (!kept.length) {
      toast.error("Nothing to save — every group was discarded.");
      return;
    }
    setSaving(true);
    const result = applyScannedGroups(
      a,
      students,
      classroom.id,
      kept.map((g) => ({
        studentId: g.studentId,
        name: g.name,
        pageUploadIds: g.pageUploadIds,
        responses: g.responses,
      })),
    );
    const ok = await save(
      {
        ...w,
        students: reconcileEvidence(result.students, result.assessment),
        assessments: w.assessments.map((x) => (x.id === a.id ? result.assessment : x)),
      },
      result.studentCount +
        " student" +
        (result.studentCount === 1 ? "" : "s") +
        " graded from the scanned stack" +
        (result.newStudents.length ? " (" + result.newStudents.length + " new)" : ""),
    );
    setSaving(false);
    if (ok) reset();
  }

  const openPile = piles[piles.length - 1];
  const finishedPiles = piles.filter((pile) => pile.length).length;

  return (
    <div className="panel class-scan-panel">
      <SectionTitle
        title="Scan the class"
        description="Scan one student's pages, tap “Next student”, and repeat. Every page you put under one student is graded together, so a test that runs onto a second page still comes back whole."
      >
        <div className="review-heading-actions">
          <input
            ref={stack}
            type="file"
            className="sr-only"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Upload a whole stack of scanned student pages at once"
            onChange={(e) => startStackScan(e.target.files)}
          />
          <Action
            variant="secondary small"
            disabled={busyScanning || busy || !prep.ready || captured.length > 0}
            onClick={() => stack.current?.click()}
          >
            <ScanLine size={15} />
            Upload a whole stack instead
          </Action>
        </div>
      </SectionTitle>
      {!prep.ready && (
        <p className="cell-meta">
          Confirm the intended standards and the answer key first, then scanning is enabled.
        </p>
      )}
      {prep.ready && (
        <div className="class-scan-capture">
          <input
            ref={camera}
            type="file"
            className="sr-only"
            accept="image/*"
            capture="environment"
            aria-label="Photograph a page of this student's work"
            onChange={(e) => addPages(e.target.files)}
          />
          <input
            ref={input}
            type="file"
            className="sr-only"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Choose pages of this student's work"
            onChange={(e) => addPages(e.target.files)}
          />
          {restored && captured.length > 0 && (
            <p className="cell-meta">
              Picked up where you left off — {captured.length} page
              {captured.length === 1 ? "" : "s"} across {piles.filter((p) => p.length).length}{" "}
              student{piles.filter((p) => p.length).length === 1 ? "" : "s"} were still
              waiting. Carry on, or start over.
            </p>
          )}
          <p className="cell-meta">
            {captured.length === 0
              ? "Student 1 — add the first page."
              : "Student " +
                piles.length +
                " — " +
                openPile.length +
                " page" +
                (openPile.length === 1 ? "" : "s") +
                " so far · " +
                captured.length +
                " of " +
                MAX_PAGES +
                " scanned"}
          </p>
          <div className="review-heading-actions">
            <Action
              variant="secondary small"
              disabled={busyScanning || busy}
              onClick={() => camera.current?.click()}
            >
              {adding ? <LoaderCircle className="spin" size={15} /> : <Camera size={15} />}
              Scan a page
            </Action>
            <Action
              variant="secondary small"
              disabled={busyScanning || busy}
              onClick={() => input.current?.click()}
            >
              <ScanLine size={15} />
              Choose files
            </Action>
            <Action
              variant="secondary small"
              disabled={busyScanning || busy || !openPile.length}
              onClick={nextStudent}
            >
              <UserPlus size={15} />
              Next student
            </Action>
            {captured.length > 0 && (
              <Action
                variant="secondary small"
                disabled={busyScanning || busy}
                onClick={undoLast}
              >
                <Undo2 size={15} />
                Undo last
              </Action>
            )}
            {restored && captured.length > 0 && (
              <Action
                variant="secondary small"
                disabled={busyScanning || busy}
                onClick={reset}
              >
                <X size={15} />
                Start over
              </Action>
            )}
          </div>
          {captured.length > 0 && (
            <div className="review-heading-actions">
              <Action disabled={busyScanning || busy} onClick={gradeCaptured}>
                {scanning ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                Done — grade {finishedPiles} student{finishedPiles === 1 ? "" : "s"}
              </Action>
              <Pill>
                {captured.length} page{captured.length === 1 ? "" : "s"} scanned
              </Pill>
            </div>
          )}
        </div>
      )}
      {!online && (
        <p className="cell-meta" role="status">
          You&rsquo;re offline. Pages you have already scanned are safe — adding more
          needs the connection back.
        </p>
      )}
      {status && (
        <div className="read-document-status" role="status">
          <LoaderCircle className="spin" size={18} />
          <p>{status}</p>
        </div>
      )}
      {groups && groups.length > 0 && (
        <div className="class-scan-groups">
          {groups.map((g) => (
            <div className={"class-scan-row" + (discarded.has(g.key) ? " discarded" : "")} key={g.key}>
              <div className="class-scan-row-main">
                <span className="cell-meta">
                  {g.pageUploadIds.length} page{g.pageUploadIds.length === 1 ? "" : "s"}
                  {g.detectedName ? " · read as “" + g.detectedName + "”" : " · no name read"}
                </span>
                <Pick
                  label="Match to a student"
                  value={g.studentId ? "existing:" + g.studentId : "new"}
                  onChange={(v) =>
                    updateGroup(g.key, {
                      studentId: v === "new" ? null : v.replace("existing:", ""),
                      name:
                        v === "new"
                          ? g.detectedName || g.name
                          : students.find((s) => s.id === v.replace("existing:", ""))?.name ||
                            g.name,
                    })
                  }
                  options={[
                    { value: "new", label: "Add as a new student" },
                    ...students.map((s) => ({ value: "existing:" + s.id, label: s.name })),
                  ]}
                />
                {!g.studentId && (
                  <input
                    className="class-scan-name-input"
                    aria-label="New student name"
                    value={g.name}
                    onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                    placeholder="Student name"
                  />
                )}
                <Score value={Math.round(g.confidence)} />
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={discarded.has(g.key) ? "Keep this group" : "Discard this group"}
                onClick={() => toggleDiscard(g.key)}
              >
                {discarded.has(g.key) ? <Check size={16} /> : <X size={16} />}
              </button>
            </div>
          ))}
          <div className="review-heading-actions">
            <Action disabled={saving || busy} onClick={saveAll}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Users size={16} />}
              Confirm &amp; save {groups.length - discarded.size} student
              {groups.length - discarded.size === 1 ? "" : "s"}
            </Action>
            <Pill>{pageUploadIds.length} pages scanned</Pill>
          </div>
        </div>
      )}
    </div>
  );
}
