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
import { confirmedGradesAtRisk, gradesClearedByReread, rereadWarning, rescanWarning } from "@/lib/teacher-workflow";
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

/**
 * Re-scanning student work that the teacher already graded (G5): the new read
 * would replace their confirmed grades. Three ways out, none of them silent:
 * keep the confirmed grades (the new scan fills only the rest), replace them,
 * or do nothing yet.
 */
export function ConfirmRescan({
  risk,
  open,
  onCancel,
  onKeep,
  onReplace,
}: {
  risk: ReturnType<typeof confirmedGradesAtRisk>;
  open: boolean;
  onCancel: () => void;
  onKeep: () => void;
  onReplace: () => void;
}) {
  const text = rescanWarning(risk);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{text.cancel}</AlertDialogCancel>
          <AlertDialogAction className="action" onClick={onKeep}>
            {text.keep}
          </AlertDialogAction>
          <AlertDialogAction className="action danger" onClick={onReplace}>
            {text.replace}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
