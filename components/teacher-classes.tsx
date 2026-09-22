"use client";
import { useRef, useState } from "react";
import { uprightPage } from "@/lib/image-prep";
import { analyzeRequest } from "@/lib/analyze-client";
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  School,
  Sparkles,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeFailure, deleteUploads } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import { Action, Modal, PageTitle, Pick, Pill, downloadText } from "./teacher-shared";
import { frameworkLabel, frameworkOptions, stateFor } from "@/lib/states";
import {
  assignShortNames,
  classSummary,
  namesFromText,
  shortenName,
} from "@/lib/teacher-classes";
import {
  SAMPLE_CSV,
  buildReviewRows,
  extractNames,
  namesFromPaste,
  overLimitMessage,
  parseDelimited,
  pasteLooksLikeTable,
  planImport,
  rowLabel,
  type ImportPlan,
  type ImportedName,
} from "@/lib/roster-import";
import { ROSTER_FILE_ACCEPT, RosterFileError, rowsFromFile } from "@/lib/roster-file";
import { extractPdfText } from "@/lib/pdf-text";
import type { Classroom, Standard } from "@/lib/teacher-types";

const gradeOptions = Array.from({ length: 13 }, (_, i) => ({
  value: String(i),
  label: i === 0 ? "Kindergarten" : "Grade " + i,
}));

export function ClassesView() {
  const { w, classroom, save, busy, go } = useTeacher();
  const [add, setAdd] = useState(false),
    [name, setName] = useState(""),
    [grade, setGrade] = useState(String(classroom.grade)),
    [framework, setFramework] = useState(classroom.framework),
    [edit, setEdit] = useState<Classroom | null>(null),
    [removeId, setRemoveId] = useState<string | null>(null);
  const options = frameworkOptions(w.customStandards.map((s) => s.framework));

  async function open(c: Classroom) {
    if (c.id !== classroom.id && !(await save({ ...w, activeClassId: c.id })))
      return;
    go("/students");
  }
  async function addClass() {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    if (
      await save(
        {
          ...w,
          classes: [
            ...w.classes,
            { id, name: name.trim(), grade: Number(grade), framework, demo: false },
          ],
          activeClassId: id,
        },
        name.trim() + " is ready. Add its roster next.",
      )
    ) {
      setAdd(false);
      setName("");
      go("/students");
    }
  }
  async function saveEdit() {
    if (!edit || !edit.name.trim()) return;
    if (
      await save(
        {
          ...w,
          classes: w.classes.map((c) =>
            c.id === edit.id ? { ...edit, name: edit.name.trim() } : c,
          ),
        },
        "Class updated",
      )
    )
      setEdit(null);
  }
  async function remove() {
    if (!removeId || w.classes.length < 2) return;
    const id = removeId;
    const remaining = w.classes.filter((c) => c.id !== id);
    const uploads = new Set([
      ...w.assessments
        .filter((a) => a.classId === id)
        .flatMap((a) => a.uploadIds),
      ...w.resources
        .filter((r) => r.classId === id)
        .map((r) => r.uploadId)
        .filter((x): x is string => !!x),
    ]);
    if (
      await save(
        {
          ...w,
          classes: remaining,
          activeClassId:
            w.activeClassId === id ? remaining[0].id : w.activeClassId,
          students: w.students.filter((s) => s.classId !== id),
          // Shared assessments stay with the classes that still use them.
          assessments: w.assessments
            .filter((a) => a.classId !== id || (a.classIds || []).some((c) => c !== id))
            .map((a) =>
              a.classId === id
                ? { ...a, classId: (a.classIds || []).find((c) => c !== id)!, classIds: (a.classIds || []).filter((c) => c !== id) }
                : { ...a, classIds: (a.classIds || []).filter((c) => c !== id) },
            ),
          lessons: w.lessons.filter((l) => l.classId !== id),
          groups: w.groups.filter((g) => g.classId !== id),
          resources: w.resources.filter((r) => r.classId !== id),
        },
        "Class removed",
      )
    ) {
      setRemoveId(null);
      const kept = await deleteUploads([...uploads]);
      if (kept)
        toast.error(
          kept +
            (kept === 1 ? " page" : " pages") +
            " from that class couldn't be deleted just now. They'll be removed automatically.",
        );
    }
  }

  const classForm = (
    value: { name: string; grade: string; framework: string },
    set: (patch: Partial<{ name: string; grade: string; framework: string }>) => void,
  ) => (
    <>
      <label>
        Class name
        <input
          required
          maxLength={70}
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Period 3 · Math 7"
        />
      </label>
      <div className="form-grid">
        <label>
          Grade
          <Pick label="Grade" value={value.grade} onChange={(v) => set({ grade: v })} options={gradeOptions} />
        </label>
        <label>
          Standards
          <Pick label="Standards framework" value={value.framework} onChange={(v) => set({ framework: v })} options={options} />
        </label>
      </div>
      <p className="field-help">
        Choose your state. California Kindergarten through Grade 8 is built in;
        other states and grades are retrieved with AI the first time you need
        them.
      </p>
    </>
  );

  return (
    <>
      <PageTitle
        eyebrow=""
        title="Classes"
        description="One class per period or group. Open a class to see its roster, assessments, and evidence."
      >
        <Action onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add class
        </Action>
      </PageTitle>
      <div className="class-grid">
        {w.classes.map((c) => {
          const n = classSummary(w, c);
          const active = c.id === classroom.id;
          return (
            <section
              className={"panel class-card " + (active ? "active" : "")}
              key={c.id}
            >
              <header>
                <span className="soft-icon">
                  <School size={20} />
                </span>
                {active ? (
                  <Pill tone="green">Open now</Pill>
                ) : c.demo ? (
                  <Pill>Sample</Pill>
                ) : null}
              </header>
              <h2>{c.name}</h2>
              <p>
                {c.grade === 0 ? "Kindergarten" : "Grade " + c.grade} ·{" "}
                {frameworkLabel(c.framework)}
              </p>
              <div className="class-stats">
                <span>
                  <strong>{n.students}</strong>students
                </span>
                <span>
                  <strong>{n.assessments}</strong>assessments
                </span>
                <span>
                  <strong>{n.lessons}</strong>lesson plans
                </span>
              </div>
              <footer>
                <Action
                  variant={active ? "secondary small" : "small"}
                  disabled={busy}
                  onClick={() => open(c)}
                >
                  {active ? "View roster" : "Open class"}
                  <ArrowRight size={14} />
                </Action>
                <div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={"Edit " + c.name}
                    onClick={() => setEdit({ ...c })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={"Remove " + c.name}
                    disabled={w.classes.length < 2 || busy}
                    onClick={() => setRemoveId(c.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </footer>
            </section>
          );
        })}
      </div>
      <p className="method-note">
        When you create an assessment you can use it in several classes at
        once. Each class keeps its own student work, evidence, and lesson
        plans.
      </p>
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Add a class"
        description="Name it the way you think about it, such as Period 1 · Algebra 1."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            addClass();
          }}
        >
          {classForm({ name, grade, framework }, (patch) => {
            if (patch.name !== undefined) setName(patch.name);
            if (patch.grade !== undefined) setGrade(patch.grade);
            if (patch.framework !== undefined) setFramework(patch.framework);
          })}
          <Action type="submit" disabled={busy || !name.trim()}>
            Create class
            <ArrowRight size={16} />
          </Action>
        </form>
      </Modal>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit class"
        description="Rename the class or change its grade and standards."
      >
        {edit && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            {classForm(
              { name: edit.name, grade: String(edit.grade), framework: edit.framework },
              (patch) =>
                setEdit({
                  ...edit,
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.grade !== undefined ? { grade: Number(patch.grade) } : {}),
                  ...(patch.framework !== undefined ? { framework: patch.framework } : {}),
                }),
            )}
            <Action type="submit" disabled={busy || !edit.name.trim()}>
              <Check size={16} />
              Save class
            </Action>
          </form>
        )}
      </Modal>
      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this class?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its students, evidence, groups, and lesson plans.
              Assessments shared with another class stay with that class.
              Export a copy from Settings first if you need one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep class</AlertDialogCancel>
            <AlertDialogAction className="action danger" disabled={busy} onClick={remove}>
              Remove class
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Photograph or upload a printed roster and turn it into a reviewed list.
export function RosterScanner({
  onAdd,
  existingNames,
}: {
  onAdd: (names: string[]) => void;
  existingNames: string[];
}) {
  const { aiReady } = useTeacher();
  const [working, setWorking] = useState(false),
    // Keyed by the row's own key rather than by index or by name: the review
    // list is rebuilt whenever the switch moves, so an index means a different
    // student before and after the toggle -- and a class can hold two children
    // called Maria Garcia, who must tick and edit independently.
    [found, setFound] = useState<ImportedName[]>([]),
    [skip, setSkip] = useState<Record<string, boolean>>({}),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [short, setShort] = useState(true),
    [notice, setNotice] = useState(""),
    [paste, setPaste] = useState(""),
    [plan, setPlan] = useState<ImportPlan | null>(null),
    [column, setColumn] = useState(""),
    [period, setPeriod] = useState("");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    sheet = useRef<HTMLInputElement>(null);

  function clearReview() {
    setFound([]);
    setSkip({});
    setEdits({});
    setPlan(null);
    setColumn("");
    setPeriod("");
  }

  /** Re-read the table whenever the teacher answers one of the questions. */
  function applyPlan(p: ImportPlan, col: string, per: string) {
    if (p.mode === "choose" && col === "") {
      setFound([]);
      return;
    }
    const { names } = extractNames(p, {
      nameColumn: col === "" ? undefined : Number(col),
      period: per || undefined,
    });
    setFound(names);
    setSkip({});
    setEdits({});
    setNotice(names.length ? "" : "There are no names in that column.");
  }

  async function readSpreadsheet(list: FileList | null) {
    const file = list?.[0];
    if (!file || working) return;
    setWorking(true);
    setNotice("");
    clearReview();
    try {
      const rows = await rowsFromFile(file);
      const p = planImport(rows);
      setPlan(p);
      // One column and no header still asks -- but with the only answer
      // already selected, so it is a confirmation rather than a puzzle.
      const col = p.mode === "choose" && p.candidates.length === 1 ? "0" : "";
      setColumn(col);
      applyPlan(p, col, "");
    } catch (e) {
      setNotice(
        e instanceof RosterFileError
          ? e.message
          : describeFailure(e, "That file couldn’t be read."),
      );
    } finally {
      setWorking(false);
      if (sheet.current) sheet.current.value = "";
    }
  }

  /** Typed or pasted names. Reviewed like everything else, never saved here. */
  function reviewPaste() {
    if (!paste.trim()) return;
    setNotice("");
    clearReview();
    // Rows pasted out of a spreadsheet are a table, not a list of names.
    // Splitting those on tabs would turn two columns into twice as many
    // students.
    if (pasteLooksLikeTable(paste)) {
      const p = planImport(parseDelimited(paste));
      setPlan(p);
      const col = p.mode === "choose" && p.candidates.length === 1 ? "0" : "";
      setColumn(col);
      applyPlan(p, col, "");
      return;
    }
    const names = namesFromPaste(paste);
    setFound(names.map((name) => ({ name })));
    if (!names.length) setNotice("No names were found in that text.");
  }

  async function scan(list: FileList | null) {
    if (!list?.length || working) return;
    setWorking(true);
    setNotice("");
    clearReview();
    const ids: string[] = [];
    let text = "";
    try {
      for (const file of Array.from(list).slice(0, 4)) {
        if (!aiReady && file.type === "application/pdf") {
          text += (await extractPdfText(await file.arrayBuffer())) + "\n";
          continue;
        }
        const form = new FormData();
        form.append("file", await uprightPage(file));
        const r = await fetch("/api/uploads", { method: "POST", body: form }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        ids.push(d.id);
      }
      let names: string[] = [];
      if (ids.length && aiReady) {
        const d = await analyzeRequest({
          mode: "roster",
          uploadIds: ids,
          text: "",
        });
        names = d.result.students as string[];
      } else if (text.trim()) names = namesFromText(text);
      else if (ids.length && !aiReady)
        setNotice(
          "Reading a photographed roster needs the AI connection. A typed PDF roster still works, or paste the names below.",
        );
      setFound(names.map((name) => ({ name })));
      if (!names.length && !notice && (text.trim() || (ids.length && aiReady)))
        setNotice("No names were recognized. Try a clearer photo, or paste the names below.");
    } catch (e) {
      toast.error(describeFailure(e, "The roster couldn’t be read."));
    } finally {
      // The roster itself is not kept once the names are read. "Deleted
      // immediately after names are read" is a published commitment, so a
      // failure here is said out loud rather than swallowed -- it is the one
      // photograph in the app that carries a whole class list.
      const kept = await deleteUploads(ids);
      if (kept)
        toast.error(
          "The roster photo couldn't be deleted just now. It will be removed automatically — tell us if you need it gone sooner.",
        );
      setWorking(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }

  const rows = buildReviewRows(found, existingNames);
  // Anyone already in the class starts unticked; the teacher can still tick
  // them if they really do want a second child of the same name.
  const included = (r: (typeof rows)[number]) => !(skip[r.key] ?? r.existing);
  const ticked = rows.filter(included);
  // Short names are worked out across everyone being saved at once, against
  // the class as it stands, so Maria Garcia and Maria Gonzalez arrive as
  // "Maria Ga." and "Maria Go." instead of both becoming "Maria G." and one of
  // them overwriting the other in every list that follows. Unticked rows are
  // left out of the calculation -- a name nobody is adding should not push a
  // letter onto a name somebody is.
  const auto = short
    ? assignShortNames(
        ticked.map((r) => ({ name: r.name, first: r.first, last: r.last })),
        existingNames,
      )
    : ticked.map((r) => r.name);
  const assigned = new Map(ticked.map((r, i) => [r.key, auto[i]]));
  const display = (r: (typeof rows)[number]) =>
    edits[r.key] ?? assigned.get(r.key) ?? (short ? shortenName(r.name) : r.name);
  const chosen = ticked.map((r) => display(r).trim()).filter(Boolean);
  const tooMany = overLimitMessage(rows.length, chosen.length, (plan?.periods.length ?? 0) > 1);

  return (
    <div className="roster-scan">
      <div>
        <Action variant="secondary small" disabled={working} onClick={() => sheet.current?.click()}>
          {working ? <LoaderCircle className="spin" size={15} /> : <Table2 size={15} />}
          Import a list
        </Action>
        <Action variant="secondary small" disabled={working} onClick={() => input.current?.click()}>
          <Upload size={15} />
          Upload a roster
        </Action>
        <Action variant="secondary small" disabled={working} onClick={() => camera.current?.click()}>
          <Camera size={15} />
          Photograph a roster
        </Action>
        <input ref={sheet} type="file" className="sr-only" accept={ROSTER_FILE_ACCEPT} aria-label="Import a class list from a spreadsheet" onChange={(e) => readSpreadsheet(e.target.files)} />
        <input ref={input} type="file" className="sr-only" multiple accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Upload a class roster" onChange={(e) => scan(e.target.files)} />
        <input ref={camera} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Photograph a class roster" onChange={(e) => scan(e.target.files)} />
      </div>
      <p>
        {rows.length
          ? "Check the names, untick anyone who shouldn’t be added, then add them."
          : "Import a CSV or Excel file from your school system, photograph a printed roster, or paste the names below."}
      </p>
      <p className="field-help">
        Spreadsheets are read on this device. Your file stays on your computer.
        Only the names you add are saved.{" "}
        <TextButton onClick={() => downloadText("roster-sample.csv", SAMPLE_CSV, "text/csv")}>
          Download a sample file
        </TextButton>
      </p>
      {notice && <p className="key-notice" role="status">{notice}</p>}
      {plan && plan.mode === "choose" && (
        <div className="roster-question">
          <Pick
            label="Which column has the names?"
            value={column}
            onChange={(v) => {
              setColumn(v);
              applyPlan(plan, v, period);
            }}
            options={[
              { value: "", label: "Choose a column…" },
              ...plan.candidates.map((c) => ({
                value: String(c.index),
                label:
                  (c.header || `Column ${c.index + 1}`) +
                  " — " +
                  (c.samples.filter(Boolean).join(", ") || "empty"),
              })),
            ]}
          />
        </div>
      )}
      {plan && plan.periods.length > 1 && (
        <div className="roster-question">
          <Pick
            label="Which period belongs in this class?"
            value={period}
            onChange={(v) => {
              setPeriod(v);
              applyPlan(plan, column, v);
            }}
            options={[
              { value: "", label: "All periods in the file" },
              ...plan.periods.map((p) => ({ value: p, label: "Period " + p })),
            ]}
          />
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="roster-preview">
            {rows.map((r) => (
              <label key={r.key}>
                <Checkbox
                  checked={included(r)}
                  onCheckedChange={(v) => setSkip({ ...skip, [r.key]: !v })}
                  aria-label={"Include " + rowLabel(r)}
                />
                <input
                  type="text"
                  value={display(r)}
                  onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })}
                  aria-label={"Name for " + rowLabel(r)}
                />
                {r.existing && <Pill tone="amber">Already in this class</Pill>}
                {r.preferred && <Pill tone="green">Preferred name</Pill>}
                {r.possibleMatch && (
                  // Said, not decided. "Maria G." in the class could be this
                  // Maria or her classmate, and only the teacher knows which.
                  <span className="field-help">
                    Possible match: {r.possibleMatch} is already in this class
                  </span>
                )}
              </label>
            ))}
          </div>
          {tooMany && (
            <p className="key-notice" role="status">
              {tooMany}
            </p>
          )}
          <div className="roster-actions">
            <label className="switch-label">
              <Switch
                checked={short}
                onCheckedChange={(v) => {
                  setShort(v);
                  setEdits({});
                }}
              />
              First name and last initial
            </label>
            <Action disabled={!chosen.length || Boolean(tooMany)} onClick={() => onAdd(chosen)}>
              <Plus size={15} />
              Add {chosen.length} {chosen.length === 1 ? "student" : "students"}
            </Action>
          </div>
        </>
      )}
      <label>
        Or type or paste student names
        <textarea
          value={paste}
          className="question-paste"
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"Amelia R.\nBenjamin L.\nChloe M."}
        />
      </label>
      <Action variant="secondary small" disabled={!paste.trim()} onClick={reviewPaste}>
        <ArrowRight size={15} />
        Review these names
      </Action>
    </div>
  );
}

/** A link-looking button, for an action that is not navigation. */
function TextButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="text-link" onClick={onClick}>
      {children}
    </button>
  );
}

// Retrieve a state's standards for a grade and subject with the AI service
// and save them to the teacher's library for reuse.
export function StandardsLoader({
  grade,
  framework,
  subject,
}: {
  grade: number;
  framework: string;
  subject?: string;
}) {
  const { w, save, aiReady, busy } = useTeacher();
  const [loading, setLoading] = useState(false);
  const state = stateFor(framework);
  const subjects = subject && subject !== "Mixed" ? [subject] : ["Math", "ELA"];
  const gradeLabel = grade === 0 ? "Kindergarten" : "Grade " + grade;
  async function load() {
    setLoading(true);
    try {
      let added: Standard[] = [];
      for (const s of subjects) {
        const d = await analyzeRequest({
          mode: "catalog",
          grade,
          framework,
          subject: s,
          text: "",
        });
        const existing = new Set(
          [...w.customStandards, ...added]
            .filter((x) => x.framework === framework && x.grade === grade && x.subject === s)
            .map((x) => x.code),
        );
        added = [...added, ...(d.result.standards as Standard[]).filter((x) => !existing.has(x.code))];
      }
      if (!added.length) {
        toast.info("No new standards were found for this grade and subject.");
        return;
      }
      await save(
        { ...w, customStandards: [...w.customStandards, ...added] },
        added.length + " " + frameworkLabel(framework) + " standards added to your library",
      );
    } catch (e) {
      toast.error(describeFailure(e, "The standards couldn’t be retrieved."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="state-loader">
      <span className="soft-icon">
        <Sparkles size={20} />
      </span>
      <h3>
        No {frameworkLabel(framework)} {gradeLabel} {subjects.join(" and ")} standards in your library yet
      </h3>
      <p>
        {state && framework !== "Common Core"
          ? "The official " + state.framework + " standards for this grade can be retrieved with AI, with codes and wording, and saved for every " + state.state + " class you teach. Verify the wording against the official document before relying on it."
          : "The Common Core standards for this grade can be retrieved with AI and saved to your library."}
      </p>
      <div>
        <Action disabled={!aiReady || loading || busy} onClick={load}>
          {loading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
          {loading ? "Retrieving standards…" : "Retrieve " + gradeLabel + " standards with AI"}
        </Action>
        {state && (
          <a className="action secondary" href={state.site} target="_blank" rel="noreferrer">
            Official source
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      {!aiReady && (
        <p className="field-help">
          Connect AI under Settings to retrieve standards automatically, or add
          them one at a time in the Standards library.
        </p>
      )}
    </div>
  );
}
