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
import { announceScanComplete, isOutOfScans, SEE_PLANS } from "@/lib/quota-client";
import { gradeButtonLabel, stackCost } from "@/lib/scan-cost";
import { useTeacher } from "./teacher-context";
import { Action, Pick, Pill, SectionTitle, Score } from "./teacher-shared";
import { activeQuestions, preparationGaps } from "@/lib/teacher-workflow";
import { reconcileEvidence } from "@/lib/teacher-data";
import {
  applyScannedGroups,
  groupPagesByCapture,
  groupPagesByName,
  gradeInBatches,
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
type Draft = { piles: Page[][]; progress?: Progress | null; savedAt?: number };

/**
 * How long an abandoned scan is worth offering back.
 *
 * The pages a draft points at are deleted on the retention schedule whether or
 * not anyone came back for them, so a draft outlives its own uploads. Offering
 * a teacher a month-old half-scan whose photographs no longer exist wastes
 * their time and fails confusingly. Comfortably longer than anyone's grading
 * session and comfortably shorter than the retention window.
 */
const DRAFT_LIFETIME = 7 * 24 * 60 * 60 * 1000;

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
    const savedAt = Array.isArray(stored) ? null : stored?.savedAt;
    if (!Array.isArray(parsed)) return null;
    // Older than the pages it refers to, so there is nothing useful left in it.
    if (typeof savedAt === "number" && Date.now() - savedAt > DRAFT_LIFETIME)
      return null;
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
        )
        // Drafts saved before pages were counted carry no count. A photograph
        // is one page, which is what all of them were.
        .map((page: Page) => ({ ...page, pages: page.pages ?? 1 })),
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
type Page = {
  key: string;
  label: string;
  bodyId: string;
  stripId: string | null;
  /** Pages in the body upload, counted server-side. A photograph is 1. */
  pages: number;
};

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
  // What the run in progress has managed so far, so a failure part-way can
  // still put it on screen rather than stranding work already paid for.
  const partial = useRef<{
    pageGroups: number[][];
    names: PageName[];
    ids: string[];
    graded: GradedGroup[];
  } | null>(null);
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
        localStorage.setItem(
          draftKey(a.id),
          JSON.stringify({ piles, progress, savedAt: Date.now() }),
        );
      else localStorage.removeItem(draftKey(a.id));
    } catch {
      // A browser refusing storage is not a reason to stop a teacher scanning.
    }
  }, [a.id, piles, progress]);

  const captured = piles.flat();
  const busyScanning = scanning || adding;
  // Body uploads this teacher has already paid for in this session. Pages
  // added after a reservation are priced as new, which is what they are.
  const [paidIds, setPaidIds] = useState<Set<string>>(() => new Set());
  // Counted from what the server said each upload was, so a five-page PDF
  // costs five and says so. paidPages is what this stack has already been
  // charged for, which is everything once a run has been reserved.
  const paidPages = useMemo(
    () =>
      captured.reduce(
        (sum, page) => sum + (paidIds.has(page.bodyId) ? (page.pages ?? 1) : 0),
        0,
      ),
    [captured, paidIds],
  );
  const cost = useMemo(
    () => stackCost(captured.map((page) => page.pages ?? 1), paidPages),
    [captured, paidPages],
  );

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/uploads", { method: "POST", body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return { id: d.id as string, pages: Number(d.pages) || 1 };
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
      const whole = await upload(page);
      return { bodyId: whole.id, stripId: null, pages: whole.pages };
    }
    const body = await upload(split.body);
    // The strip is uploaded too, but it is never reserved and never charged:
    // it is the top of a page the teacher is already paying for. Charging per
    // upload rather than per page would bill this class set twice.
    const strip = await upload(split.strip);
    return { bodyId: body.id, stripId: strip.id, pages: body.pages };
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
    // Give back anything reserved but never graded. Confirmed pages stay
    // charged, so this cannot be used to undo work already delivered.
    void releaseStack(pageUploadIds);
    setPaidIds(new Set());
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
    // Mirrors what has been banked, so the in-flight job id can be recorded
    // against the right point without waiting for a re-render.
    let banked: GradedGroup[] = resume?.graded ?? [];
    const ids = pages.map((p) => p.bodyId);
    setPageUploadIds(ids);

    // Pay for the whole stack before any of it is sent, and before the privacy
    // pass -- which is free, but still a model call, and a teacher who cannot
    // afford the class set should not have us reading names off it first. The
    // BODY ids only: a strip is the top of a page already in this list, and
    // reserving it too would charge every page twice.
    setStatus("Checking your scans…");
    const reserved = await reserveStack(ids);
    // Say what it actually cost. A re-grade charges nothing, and a teacher
    // watching their meter deserves to be told that rather than left to infer
    // it from a number that did not move.
    if (reserved.charged === 0 && reserved.alreadyPaid > 0)
      toast.success("These pages are already paid for — this re-grade uses no scans.");
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
    partial.current = { pageGroups, names, ids, graded: resume?.graded ?? [] };
    const batches = planScanBatches(pageGroups, ids, activeQuestions(a).length);
    // Resume where an interrupted run stopped rather than grading, and paying,
    // from the top again.
    const resuming = resume && resume.nextBatch <= batches.length ? resume : null;
    let inFlight = resuming?.scanId ?? null;
    const graded = await gradeInBatches(
      batches,
      async (batch, index) => {
        setStatus(
          batches.length > 1
            ? "Grading students " +
                (batch.groupIndexes[0] + 1) +
                "\u2013" +
                (batch.groupIndexes[batch.groupIndexes.length - 1] + 1) +
                " of " +
                pageGroups.length +
                "\u2026"
            : "Grading " +
                pageGroups.length +
                " student" +
                (pageGroups.length === 1 ? "" : "s") +
                "\u2026",
        );
        // A batch already sent and still running is waited on, not repeated.
        if (inFlight) {
          const id = inFlight;
          inFlight = null;
          try {
            return (await resumeScan(id)).result;
          } catch {
            // Gone or never finished; fall through and send it again.
          }
        }
        const d = await analyzeRequest(
          {
            mode: "class_scan",
            uploadIds: batch.uploadIds,
            pageGroups: batch.groups,
            // One teacher action, however many requests it takes.
            batchIndex: index,
            grade: a.grade,
            subject: a.subject,
            framework: a.framework,
            assessmentId: a.id,
          },
          // Record the job before waiting on it, so a phone that sleeps
          // mid-grade picks this exact one up instead of paying for another.
          { onScanId: (id) => setProgress({ graded: banked, nextBatch: index, scanId: id }) },
        );
        return d.result;
      },
      // Banked after each batch, so an interruption never re-grades one.
      (soFar, nextBatch) => {
        banked = soFar;
        // Kept on the ref as well as in state: a failure is handled in the
        // same tick, where the state from this run has not landed yet.
        if (partial.current) partial.current.graded = soFar;
        setProgress({ graded: soFar, nextBatch, scanId: null });
      },
      resuming?.nextBatch ?? 0,
      resuming?.graded ?? [],
    );
    setProgress(null);
    showGraded(pageGroups, names, graded, ids);
  }

  /** Puts whatever has been graded on screen. Called on the way out of a
   * successful run and on the way out of a failed one, because a class set that
   * stopped at student 18 has eighteen students' grades sitting in it that the
   * teacher has already paid for. Leaving those unreachable and telling them to
   * start again charges twice for the same work. */
  function showGraded(
    pageGroups: number[][],
    names: PageName[],
    graded: GradedGroup[],
    ids: string[],
  ) {
    const done = new Set(graded.map((g) => g.group));
    const resolved = resolveScannedGroups(pageGroups, names, graded, ids, students).filter(
      (_, i) => done.has(i),
    );
    setPageUploadIds(ids);
    if (!resolved.length)
      toast.error(
        "No student work could be identified on these pages. The pages are saved — try re-scanning them more clearly.",
      );
    setGroups(resolved);
    return resolved.length;
  }

  /**
   * Reserves the stack, or stops the whole thing.
   *
   * A 402 here means nothing has been charged and nothing has run: the teacher
   * is told the size of the stack and what they have left, and no page reaches
   * the model. That is the point of doing it first -- the alternative is
   * grading eighteen students, stopping, and leaving them to work out what
   * they were billed for.
   */
  async function reserveStack(ids: string[]) {
    const r = await fetch("/api/scans/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadIds: ids, mode: "class_scan" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't check your remaining scans.");
    // The meter moves the moment the pages are reserved, not when grading
    // finishes, so what it shows matches what has actually been committed.
    announceScanComplete();
    setPaidIds((prev) => new Set([...prev, ...ids]));
    return d as { charged: number; alreadyPaid: number; remaining: number };
  }

  /** Hand a reserved stack back when the teacher abandons it. */
  async function releaseStack(ids: string[]) {
    if (!ids.length) return;
    try {
      await fetch("/api/scans/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadIds: ids }),
      });
      setPaidIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      announceScanComplete();
    } catch {
      // An unconfirmed reservation stops counting after two hours by itself,
      // so a failure here costs the teacher nothing and is not worth a toast.
    }
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
      // Show whatever got through before saying what went wrong. A class set
      // that stopped at student 18 has eighteen students already graded and
      // already billed; those go on screen to be confirmed and saved, and the
      // rest can be picked up by pressing Done again.
      const shown = partial.current?.graded.length
        ? showGraded(
            partial.current.pageGroups,
            partial.current.names,
            partial.current.graded,
            partial.current.ids,
          )
        : 0;
      const message =
        describeFailure(e, "The pages couldn't be read.") +
        (shown
          ? " " +
            shown +
            (shown === 1 ? " student was" : " students were") +
            " graded before it stopped — confirm those, then press Done for the rest."
          : " The pages are uploaded — you can try grading again.");
      // Out of scans is the one failure a teacher can actually do something
      // about, so it comes with somewhere to go rather than just bad news.
      if (isOutOfScans(message))
        toast.error(describeFailure(e, "The pages couldn't be read."), {
          action: {
            label: SEE_PLANS.label,
            onClick: () => window.location.assign(SEE_PLANS.href),
          },
        });
      else toast.error(message);
    } finally {
      partial.current = null;
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
    // The button is disabled for this, but the check lives here too: a saved
    // ambiguity is a child's grades on another child, and that is not
    // something to leave resting on one piece of UI state.
    const open = kept.filter((g) => g.candidateIds.length > 0);
    if (open.length) {
      toast.error(
        open.length === 1
          ? "One paper could belong to more than one student. Choose whose it is, or discard it."
          : open.length +
              " papers could belong to more than one student. Choose whose they are, or discard them.",
      );
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

  const live = (groups ?? []).filter((g) => !discarded.has(g.key));
  // Papers the roster could not narrow to one student. The teacher answers
  // these; nothing is chosen for them, and nothing is saved until they have.
  const undecided = live.filter((g) => g.candidateIds.length > 0);
  // Two papers on one student. Not blocked -- a child really can hand in two
  // sheets -- but it is the shape a misread name makes, so it is said plainly
  // on both rows rather than left for the teacher to spot in the results.
  const perStudent = new Map<string, number>();
  for (const g of live)
    if (g.studentId) perStudent.set(g.studentId, (perStudent.get(g.studentId) ?? 0) + 1);
  const sharedWith = (g: ResolvedGroup) =>
    g.studentId ? (perStudent.get(g.studentId) ?? 0) : 0;
  const nameOfStudent = (id: string) => students.find((s) => s.id === id)?.name ?? "this student";
  const firstNameRead = (g: ResolvedGroup) =>
    g.detectedName.trim().split(/\s+/)[0] || "";

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
                {/* What this will cost, before they commit to it. A stack
                    already paid for -- a re-grade -- reads "uses 0 scans",
                    which is the question a teacher actually has at that
                    moment. */}
                {gradeButtonLabel(cost)}
              </Action>
              <Pill>
                {finishedPiles} student{finishedPiles === 1 ? "" : "s"}
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
                  label={
                    g.candidateIds.length
                      ? "Which " + (firstNameRead(g) || "student") + "?"
                      : "Match to a student"
                  }
                  // Nothing preselected while the question is open. An empty
                  // value cannot be saved, so a teacher who scrolls past this
                  // row is stopped rather than silently agreeing to a guess.
                  value={
                    g.candidateIds.length
                      ? ""
                      : g.studentId
                        ? "existing:" + g.studentId
                        : "new"
                  }
                  onChange={(v) => {
                    if (!v) return;
                    updateGroup(g.key, {
                      studentId: v === "new" ? null : v.replace("existing:", ""),
                      name:
                        v === "new"
                          ? g.detectedName || g.name
                          : students.find((s) => s.id === v.replace("existing:", ""))?.name ||
                            g.name,
                      // Answered. The row stops being a question, including
                      // when the answer is "add as a new student".
                      candidateIds: [],
                    });
                  }}
                  options={[
                    ...(g.candidateIds.length
                      ? [
                          { value: "", label: "Choose a student…" },
                          ...g.candidateIds.map((id) => ({
                            value: "existing:" + id,
                            label: nameOfStudent(id),
                          })),
                        ]
                      : []),
                    { value: "new", label: "Add as a new student" },
                    ...students
                      .filter((s) => !g.candidateIds.includes(s.id))
                      .map((s) => ({ value: "existing:" + s.id, label: s.name })),
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
                {g.candidateIds.length > 0 && (
                  <p className="key-notice" role="status">
                    “{g.detectedName}” fits {g.candidateIds.length} students in this
                    class. Choose whose paper this is before saving.
                  </p>
                )}
                {sharedWith(g) > 1 && (
                  <p className="key-notice" role="status">
                    {sharedWith(g) === 2 ? "Two" : sharedWith(g)} papers matched to{" "}
                    {nameOfStudent(g.studentId as string)}. Check which is whose.
                  </p>
                )}
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
          {undecided.length > 0 && (
            <p className="key-notice" role="status">
              {undecided.length} paper{undecided.length === 1 ? "" : "s"} could belong to
              more than one student. Choose whose {undecided.length === 1 ? "it is" : "they are"},
              or discard {undecided.length === 1 ? "it" : "them"}, and then save.
            </p>
          )}
          <div className="review-heading-actions">
            <Action disabled={saving || busy || undecided.length > 0} onClick={saveAll}>
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
