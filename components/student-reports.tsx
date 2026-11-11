"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, LineChart } from "lucide-react";
import { compareByLastName } from "@/lib/teacher-classes";
import { StudentSuperGrid } from "./class-super-grid";
import { StudentReportDialog } from "./student-report";
import { useTeacher } from "./teacher-context";
import { Action, EmptyState, PageTitle, Pick } from "./teacher-shared";

/**
 * Student Reports (Ricky's menu, 23 Oct 2026): pick a student, see their
 * super grid, and print one of two reports for a parent conference or an IEP
 * meeting -- the Student super grid report (the grid with the class average
 * per cluster, and the common error types) or the Standard Tracker report
 * (progress on the standards the teacher picks). Both are built in the
 * browser (lib/student-report.ts) and hold only that student's data.
 */
export function StudentReportsView() {
  const { w, classroom, students, go } = useTeacher();
  const params = useSearchParams();
  const id = params.get("id") || "";
  const student = students.find((s) => s.id === id);
  const [report, setReport] = useState<"grid" | "tracker" | null>(null);
  const roster = [...students].sort((a, b) => compareByLastName(a.name, b.name));
  return (
    <>
      <PageTitle
        eyebrow="FOR CONFERENCES AND IEP MEETINGS"
        title="Student reports"
        description="Pick a student to see their super grid, then print a report. Each report holds only that student's results."
      />
      {!roster.length ? (
        <EmptyState title="No students in this class yet" description="Add the class roster first, then come back for reports.">
          <Action onClick={() => go("/students")}>Go to the roster</Action>
        </EmptyState>
      ) : (
        <section className="panel student-report-picker">
          <label>
            Student
            <Pick
              label="Choose a student"
              value={student ? student.id : ""}
              onChange={(v) => go("/reports" + (v ? "?id=" + encodeURIComponent(v) : ""))}
              options={[{ value: "", label: "Choose a student" }, ...roster.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </label>
          {student && (
            <div className="student-report-choices">
              <Action onClick={() => setReport("grid")}>
                <FileText size={16} />
                Student super grid report
              </Action>
              <Action variant="secondary" onClick={() => setReport("tracker")}>
                <LineChart size={16} />
                Standard Tracker report
              </Action>
            </div>
          )}
        </section>
      )}
      {student && <StudentSuperGrid w={w} classroom={classroom} student={student} />}
      {student && report && (
        <StudentReportDialog
          w={w}
          classroom={classroom}
          student={student}
          open
          onClose={() => setReport(null)}
          title={report === "grid" ? "Student super grid report" : "Standard Tracker report"}
          sections={report === "grid" ? { tracker: false } : { superGrid: false }}
        />
      )}
    </>
  );
}
