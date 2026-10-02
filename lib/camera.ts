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
): MediaStreamConstraints {
  // Rear camera and a resolution hint only -- no aspectRatio and no
  // portrait/landscape forcing. #96 asked iOS Safari for a portrait frame
  // (width<height, aspectRatio 3:4); Safari ignored it and delivered a
  // landscape frame anyway, which `object-fit: contain` then letterboxed into a
  // thin strip. We no longer care which orientation the camera returns: the
  // preview fills the screen with `object-fit: cover` and each capture is
  // cropped to exactly the visible region (coverCrop), so a landscape or
  // portrait frame both come out right. A square `ideal` keeps the request from
  // biasing the orientation while still asking for plenty of pixels; the camera
  // clamps to its own best mode. continuous autofocus is requested here and
  // again on the live track (many browsers only honour focus through
  // applyConstraints).
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
    width: { ideal: 2560 },
    height: { ideal: 2560 },
    // focusMode is not in the TS DOM lib yet, but it is honoured by
    // Chromium-family browsers; cast through unknown so the hint still ships.
    advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
  };
  return { audio: false, video };
}

/**
 * The region of a camera frame that a full-screen `object-fit: cover` preview
 * actually shows, in frame (video) pixels -- so a capture can crop to exactly
 * what the teacher sees. The frame is scaled to cover the viewport and the
 * overflow is trimmed equally on the longer axis, so the visible region has the
 * viewport's aspect ratio, centered.
 *
 * Aspect-based, so `vw`/`vh` may be CSS pixels while `fw`/`fh` are video pixels;
 * only the ratios matter. Works for a landscape frame on a portrait screen
 * (iOS) and a portrait frame on a portrait screen (Android) alike.
 */
export function coverCrop(
  fw: number,
  fh: number,
  vw: number,
  vh: number,
): { x: number; y: number; w: number; h: number } {
  if (fw <= 0 || fh <= 0 || vw <= 0 || vh <= 0)
    return { x: 0, y: 0, w: Math.max(0, fw), h: Math.max(0, fh) };
  const frameAspect = fw / fh;
  const viewAspect = vw / vh;
  let w: number, h: number;
  if (viewAspect > frameAspect) {
    // Viewport is relatively wider: the full width shows, top and bottom trim.
    w = fw;
    h = fw / viewAspect;
  } else {
    // Viewport is relatively taller: the full height shows, sides trim.
    h = fh;
    w = fh * viewAspect;
  }
  return { x: (fw - w) / 2, y: (fh - h) / 2, w, h };
}

/**
 * Where a point in frame (video) pixels lands on a full-screen `object-fit:
 * cover` preview, in viewport pixels. Used to draw the detected-page outline in
 * the same place the page appears on screen. The inverse pairing of coverCrop:
 * the crop's top-left maps to (0,0) and its bottom-right to (vw,vh).
 */
export function coverMapPoint(
  px: number,
  py: number,
  fw: number,
  fh: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  if (fw <= 0 || fh <= 0) return { x: px, y: py };
  const scale = Math.max(vw / fw, vh / fh);
  const offX = (vw - fw * scale) / 2;
  const offY = (vh - fh * scale) / 2;
  return { x: px * scale + offX, y: py * scale + offY };
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
