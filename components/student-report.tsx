"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { allStandards } from "@/lib/teacher-catalog";
import { MAX_NOTE_CHARS, MAX_TRACKER_STANDARDS, studentReportHtml, type ReportSections } from "@/lib/student-report";
import type { Classroom, Student, Workspace } from "@/lib/teacher-types";
import { Action, Modal } from "./teacher-shared";

/**
 * The printable student report (lib/student-report.ts) for parent conferences
 * and IEP meetings: the teacher picks the Standard Tracker standards, may type a
 * note for this one report, sees the page as it will print, and prints it or
 * saves it as a PDF. Built in the browser; nothing is sent anywhere. The report
 * carries no other student's data and no stored free text (privacy review of
 * #209) -- the note box is the only free text, and the teacher fills it here.
 */
export function StudentReportDialog({
  w,
  classroom,
  student,
  open,
  onClose,
  sections,
  title = "Student report",
}: {
  w: Workspace;
  classroom: Classroom;
  student: Student;
  open: boolean;
  onClose: () => void;
  sections?: Partial<ReportSections>;
  title?: string;
}) {
  const tracked = trackedStandards(student);
  const [picked, setPicked] = useState<{ for: string; codes: string[] } | null>(null);
  const [note, setNote] = useState<{ for: string; text: string }>({ for: student.id, text: "" });
  // Derived per student: the latest standards with evidence, until the teacher picks.
  const codes = picked && picked.for === student.id ? picked.codes : tracked.slice(0, MAX_TRACKER_STANDARDS);
  const noteText = note.for === student.id ? note.text : "";
  const showTracker = sections?.tracker !== false;
  const report = studentReportHtml(w, classroom, student, { standards: codes, note: noteText, sections });
  const titles = new Map(allStandards(w).map((s) => [s.code, s.title]));
  const toggle = (code: string, on: boolean) =>
    setPicked({ for: student.id, codes: on ? [...codes, code].slice(0, MAX_TRACKER_STANDARDS) : codes.filter((c) => c !== code) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={title + " · " + student.name}
      description="Only this student's own results. A class average shows only where enough other students answered. Print it, or choose Save as PDF in the print window."
    >
      <div className="student-report-options">
        {showTracker && (
          <fieldset>
            <legend>Standard Tracker: standards to include (up to {MAX_TRACKER_STANDARDS})</legend>
            {tracked.length ? (
              <div className="student-report-standards">
                {tracked.map((code) => (
                  <label key={code} className="checkbox-label">
                    <Checkbox
                      checked={codes.includes(code)}
                      disabled={!codes.includes(code) && codes.length >= MAX_TRACKER_STANDARDS}
                      onCheckedChange={(v) => toggle(code, v === true)}
                    />
                    <span>
                      <strong>{code}</strong> {titles.get(code) ?? ""}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="cell-meta">No evidence recorded for {student.name} yet.</p>
            )}
          </fieldset>
        )}
        <label className="student-report-note">
          <span>
            Notes for this report (optional) — shown only on this printout
            <span className="student-report-note-count">
              {noteText.length}/{MAX_NOTE_CHARS}
            </span>
          </span>
          <textarea
            rows={3}
            value={noteText}
            maxLength={MAX_NOTE_CHARS}
            placeholder="Type a note for this conference. Nothing you&rsquo;ve saved elsewhere is included."
            onChange={(e) => setNote({ for: student.id, text: e.target.value.slice(0, MAX_NOTE_CHARS) })}
          />
        </label>
      </div>
      <iframe className="student-report-preview" title="Report preview" srcDoc={report.html} sandbox="" />
      <div className="modal-actions">
        <Action variant="secondary" onClick={onClose}>
          Close
        </Action>
        <Action onClick={() => printReport(report.html)}>
          <Printer size={16} />
          Print or save as PDF
        </Action>
      </div>
    </Modal>
  );
}

/** The standards this student has evidence on, latest first. */
export function trackedStandards(student: Pick<Student, "evidence">): string[] {
  const latest = new Map<string, string>();
  for (const e of student.evidence) if ((latest.get(e.standard) ?? "") < e.date) latest.set(e.standard, e.date);
  return [...latest].sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0])).map(([code]) => code);
}

/** Prints a whole report document from a hidden frame. */
export function printReport(html: string) {
  const frame = document.createElement("iframe");
  frame.className = "student-report-print";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow?.focus();
  setTimeout(() => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 200);
}
