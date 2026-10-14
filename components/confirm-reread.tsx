"use client";
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
import { gradesClearedByReread, rereadWarning } from "@/lib/teacher-workflow";
import type { Assessment } from "@/lib/teacher-types";

/**
 * The step between "read it again" (or saving a revision) and doing it, shown
 * only when the test already has graded answers. Nothing is read, charged or
 * saved until the teacher chooses to clear them; cancelling leaves everything
 * as it was.
 */
export function ConfirmReread({
  assessment,
  action = "read",
  open,
  onCancel,
  onConfirm,
}: {
  assessment: Assessment | undefined;
  action?: "read" | "save";
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const text = rereadWarning(gradesClearedByReread(assessment), action);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{text.keep}</AlertDialogCancel>
          <AlertDialogAction className="action danger" onClick={onConfirm}>
            {text.go}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
