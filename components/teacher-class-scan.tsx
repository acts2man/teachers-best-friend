"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ScanLine, LoaderCircle, Check, X, Users } from "lucide-react";
import { analyzeRequest } from "@/lib/analyze-client";
import { uprightPage } from "@/lib/image-prep";
import { useTeacher } from "./teacher-context";
import { Action, Pick, Pill, SectionTitle, Score } from "./teacher-shared";
import { preparationGaps } from "@/lib/teacher-workflow";
import { reconcileEvidence } from "@/lib/teacher-data";
import {
  applyScannedGroups,
  resolveScannedGroups,
  type ResolvedGroup,
} from "@/lib/teacher-class-scan";
import type { Assessment } from "@/lib/teacher-types";

const MAX_PAGES = 24;

/**
 * Upload a whole stack of scanned student pages for one assessment at once —
 * no roster entry has to exist first. AI splits the pages by the name
 * written on each one, matches it to the roster when it can, and grades
 * every student's pages. The teacher only confirms names before saving.
 */
export function ClassScanPanel({ assessment: a }: { assessment: Assessment }) {
  const { w, classroom, students, save, busy, aiReady } = useTeacher();
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("");
  const [pageUploadIds, setPageUploadIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const prep = preparationGaps(a);

  async function startScan(list: FileList | null) {
    if (!list?.length || scanning) return;
    if (!prep.ready) {
      toast.error("Confirm the standards and answer key before scanning student work.");
      return;
    }
    if (!aiReady) {
      toast.error("Scanning a whole class needs the AI connection.");
      return;
    }
    const files = Array.from(list);
    if (files.length > MAX_PAGES) {
      toast.error("Scan up to " + MAX_PAGES + " pages at a time.");
      return;
    }
    setScanning(true);
    setGroups(null);
    setDiscarded(new Set());
    setStatus("Uploading " + files.length + " page" + (files.length === 1 ? "" : "s") + "…");
    const ids: string[] = [];
    try {
      for (const raw of files) {
        // Straighten before upload: a sideways page is hard for the model to
        // read and harder for the teacher to check.
        const file = await uprightPage(raw);
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/uploads", { method: "POST", body: form });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        ids.push(d.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The pages couldn't be uploaded.");
      setScanning(false);
      setStatus("");
      if (input.current) input.current.value = "";
      return;
    }
    setPageUploadIds(ids);
    setStatus("Splitting pages by student and grading each one…");
    try {
      const d = await analyzeRequest({
        mode: "class_scan",
        uploadIds: ids,
        grade: a.grade,
        subject: a.subject,
        framework: a.framework,
        assessmentId: a.id,
      });
      const resolved = resolveScannedGroups(d.result.groups, ids, students);
      if (!resolved.length)
        toast.error("No student work could be identified on these pages. The pages are saved — try re-scanning them more clearly.");
      setGroups(resolved);
    } catch (e) {
      toast.error(
        (e instanceof Error ? e.message : "The pages couldn't be read.") +
          " The pages are uploaded — you can try scanning again.",
      );
    } finally {
      setScanning(false);
      setStatus("");
      if (input.current) input.current.value = "";
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
    if (ok) {
      setGroups(null);
      setPageUploadIds([]);
      setDiscarded(new Set());
    }
  }

  return (
    <div className="panel class-scan-panel">
      <SectionTitle
        title="Scan a stack for the whole class"
        description="Upload every student's pages at once — no roster required first. AI splits them by the name on each page and grades them; you just confirm."
      >
        <div className="review-heading-actions">
          <input
            ref={input}
            type="file"
            className="sr-only"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            aria-label="Upload a stack of scanned student pages"
            onChange={(e) => startScan(e.target.files)}
          />
          <Action
            variant="secondary small"
            disabled={scanning || busy || !prep.ready}
            onClick={() => input.current?.click()}
          >
            {scanning ? <LoaderCircle className="spin" size={15} /> : <ScanLine size={15} />}
            Upload &amp; scan pages
          </Action>
        </div>
      </SectionTitle>
      {!prep.ready && (
        <p className="cell-meta">
          Confirm the intended standards and the answer key first, then scanning is enabled.
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
