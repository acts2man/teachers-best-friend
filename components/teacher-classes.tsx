"use client";
import { useRef, useState } from "react";
import { readJson } from "@/lib/utils";
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
import { useTeacher } from "./teacher-context";
import { Action, Modal, PageTitle, Pick, Pill } from "./teacher-shared";
import { frameworkLabel, frameworkOptions, stateFor } from "@/lib/states";
import {
  classSummary,
  namesFromText,
  shortenName,
} from "@/lib/teacher-classes";
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
      for (const uploadId of uploads)
        fetch("/api/uploads/" + uploadId, { method: "DELETE" }).catch(() => {});
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
        Choose your state. California Grade 4 is built in; other states and
        grades are retrieved with AI the first time you need them.
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
export function RosterScanner({ onAdd }: { onAdd: (names: string[]) => void }) {
  const { aiReady } = useTeacher();
  const [working, setWorking] = useState(false),
    [found, setFound] = useState<string[]>([]),
    [skip, setSkip] = useState<Record<number, boolean>>({}),
    [edits, setEdits] = useState<Record<number, string>>({}),
    [short, setShort] = useState(true),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);

  async function scan(list: FileList | null) {
    if (!list?.length || working) return;
    setWorking(true);
    setNotice("");
    const ids: string[] = [];
    let text = "";
    try {
      for (const file of Array.from(list).slice(0, 4)) {
        if (!aiReady && file.type === "application/pdf") {
          text += (await extractPdfText(await file.arrayBuffer())) + "\n";
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/uploads", { method: "POST", body: form }),
          d = await r.json();
        if (!r.ok) throw new Error(d.error);
        ids.push(d.id);
      }
      let names: string[] = [];
      if (ids.length && aiReady) {
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "roster", uploadIds: ids, text: "" }),
          }),
          d = await readJson(r);
        if (!r.ok) throw new Error(d.error);
        names = d.result.students as string[];
      } else if (text.trim()) names = namesFromText(text);
      else if (ids.length && !aiReady)
        setNotice(
          "Reading a photographed roster needs the AI connection. A typed PDF roster still works, or paste the names below.",
        );
      setFound(names);
      setSkip({});
      setEdits({});
      if (!names.length && !notice && (text.trim() || (ids.length && aiReady)))
        setNotice("No names were recognized. Try a clearer photo, or paste the names below.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The roster couldn’t be read.");
    } finally {
      // The roster itself is not kept once the names are read.
      for (const id of ids)
        fetch("/api/uploads/" + id, { method: "DELETE" }).catch(() => {});
      setWorking(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }
  const display = (i: number) =>
    edits[i] ?? (short ? shortenName(found[i]) : found[i]);
  const chosen = found
    .map((_, i) => (skip[i] ? "" : display(i).trim()))
    .filter(Boolean);
  return (
    <div className="roster-scan">
      <div>
        <Action variant="secondary small" disabled={working} onClick={() => input.current?.click()}>
          {working ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
          Upload a roster
        </Action>
        <Action variant="secondary small" disabled={working} onClick={() => camera.current?.click()}>
          <Camera size={15} />
          Photograph a roster
        </Action>
        <input ref={input} type="file" className="sr-only" multiple accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Upload a class roster" onChange={(e) => scan(e.target.files)} />
        <input ref={camera} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Photograph a class roster" onChange={(e) => scan(e.target.files)} />
      </div>
      <p>
        {found.length
          ? "Check the names, untick anyone who shouldn’t be added, then add them."
          : "Take a photo of a printed roster or upload a PDF. Names are read, shown here for your review, and the roster image is not kept."}
      </p>
      {notice && <p className="key-notice" role="status">{notice}</p>}
      {found.length > 0 && (
        <>
          <div className="roster-preview">
            {found.map((original, i) => (
              <label key={i}>
                <Checkbox checked={!skip[i]} onCheckedChange={(v) => setSkip({ ...skip, [i]: !v })} aria-label={"Include " + original} />
                <input type="text" value={display(i)} onChange={(e) => setEdits({ ...edits, [i]: e.target.value })} aria-label={"Name for " + original} />
              </label>
            ))}
          </div>
          <div className="roster-actions">
            <label className="switch-label">
              <Switch checked={short} onCheckedChange={(v) => { setShort(v); setEdits({}); }} />
              First name and last initial
            </label>
            <Action disabled={!chosen.length} onClick={() => onAdd(chosen)}>
              <Plus size={15} />
              Add {chosen.length} {chosen.length === 1 ? "student" : "students"}
            </Action>
          </div>
        </>
      )}
    </div>
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
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "catalog", grade, framework, subject: s, text: "" }),
          }),
          d = await readJson(r);
        if (!r.ok) throw new Error(d.error);
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
      toast.error(e instanceof Error ? e.message : "The standards couldn’t be retrieved.");
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
