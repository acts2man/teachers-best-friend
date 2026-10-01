/**
 * Pure helpers for the in-app camera (components/scan-camera.tsx).
 *
 * The canvas/getUserMedia work lives in the component; everything here is
 * plain logic so it can be unit-tested without a browser: the stream
 * constraints, turning a getUserMedia failure into a sentence a teacher can
 * act on, and grouping captured shots into per-student piles.
 */

export type FacingMode = "environment" | "user";

/**
 * Ask the browser for the rear camera at the highest resolution it will give.
 * `ideal` (not `exact`) so a device that can't hit the numbers still starts;
 * the browser clamps to what the camera actually supports. lib/image-prep's
 * uprightPage caps the long edge afterward, so a large stream costs nothing
 * downstream — we just want the sharpest frame the camera can produce.
 */
export function videoConstraints(
  facingMode: FacingMode = "environment",
  portrait = false,
): MediaStreamConstraints {
  // When the phone is upright, ask for a portrait frame (taller than wide) so a
  // page held in portrait fills it, instead of a landscape sensor frame that
  // leaves the page small and letterboxed. `ideal` only -- a camera that can't
  // deliver a portrait frame still starts, and the preview is `object-fit:
  // contain` so it stays what-you-see-is-what-you-get either way. continuous
  // autofocus is requested here and, because many browsers only honour focus
  // through applyConstraints, again on the live track once the stream starts.
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
    width: { ideal: portrait ? 2160 : 4096 },
    height: { ideal: portrait ? 3840 : 4096 },
    aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 },
    // focusMode is not in the TS DOM lib yet, but it is honoured by
    // Chromium-family browsers; cast through unknown so the hint still ships.
    advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
  };
  return { audio: false, video };
}

/** Whether this browser/context can open a camera at all (needs HTTPS). */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

/**
 * The teacher-facing message for a getUserMedia failure, by DOMException name.
 * Every branch points back to Upload, which always works, so a camera problem
 * never dead-ends the scan.
 */
export function describeCameraError(err: unknown): string {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "Camera access is blocked. Allow the camera for this site in your browser settings, or use Upload instead.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device. Use Upload instead.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "The camera is being used by another app. Close it and try again, or use Upload instead.";
    default:
      return "The camera couldn’t be started on this device. Use Upload instead.";
  }
}

/**
 * Split shots into per-student groups by their recorded `group` index,
 * preserving capture order and dropping any student with no pages. This is
 * what carries the in-camera "Next student" boundaries out to the existing
 * declared per-student grouping in Scan the class.
 */
export function partitionByGroup<T extends { group: number }>(
  items: T[],
  groupCount: number,
): T[][] {
  const groups: T[][] = Array.from({ length: Math.max(0, groupCount) }, () => []);
  for (const item of items)
    if (item.group >= 0 && item.group < groups.length) groups[item.group].push(item);
  return groups.filter((g) => g.length > 0);
}
