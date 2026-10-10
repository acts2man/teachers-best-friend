"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, Info, LoaderCircle, RotateCcw, Upload, UserPlus, X, Zap, ZapOff } from "lucide-react";
import {
  burstFrames,
  cameraSupported,
  coverCrop,
  coverMapPoint,
  describeCameraError,
  laplacianVariance,
  partitionByGroup,
  rgbaToGray,
  videoConstraints,
} from "@/lib/camera";
import { clearShots, deleteShot, loadShots, saveShot } from "@/lib/scan-store";

/**
 * One captured page. `blob` is the full-size JPEG that is uploaded; `url` is an
 * object URL for a SMALL thumbnail of it, never the full page.
 *
 * Michael's Android slowed down around student 15 of 26. Every thumbnail in the
 * strip used to point at the full ~2000px photo, and a phone decodes an <img>
 * at its source size however small it is drawn: about 12 MB of memory per page,
 * held for every page in the set. By page 60 that is several hundred MB for a
 * strip of 46px squares. A thumbnail blob is a few KB and decodes to almost
 * nothing, so page 60 costs what page 1 did.
 */
type Shot = { id: string; url: string; blob: Blob; group: number; seq: number };

/** Width of the thumbnail kept for the strip at the bottom of the camera. */
export const THUMB_W = 96;

/** Frees a canvas's pixel buffer now rather than whenever the garbage
 * collector gets round to it -- on a phone that can be a long time, and a
 * 2000px canvas is 12 MB. */
function release(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** A small JPEG thumbnail of something drawable. */
function thumbBlob(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const tw = THUMB_W;
  const th = Math.max(1, Math.round((h * tw) / Math.max(1, w)));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, tw, th);
  return new Promise((resolve) =>
    c.toBlob(
      (b) => {
        release(c);
        resolve(b);
      },
      "image/jpeg",
      0.7,
    ),
  );
}

/** A thumbnail URL for a stored page, decoded at thumbnail size where the
 * browser supports it rather than at full resolution. */
async function thumbUrlFor(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob, { resizeWidth: THUMB_W, resizeQuality: "low" });
    const small = await thumbBlob(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    if (small) return URL.createObjectURL(small);
  } catch {
    // Fall through: an old browser without resize options still gets a picture.
  }
  return URL.createObjectURL(blob);
}
type EdgeLib = typeof import("@/lib/edge-detect");
type SnapLib = typeof import("@/lib/auto-snap");
type DetectedQuad = { quad: import("@/lib/edge-detect").Quad; w: number; h: number; confident: boolean };

const AUTO_KEY = "tbf.scan.autoSnap";
const DETECT_W = 320; // downscaled working width for live detection
const CAPTURE_CAP = 2000; // long-edge cap; matches uprightPage's downstream cap
const DETECT_EVERY_MS = 120; // ~8 detections/sec keeps a mid-range phone smooth
const SETTLE_MS = 700; // let the stream focus/settle before the first capture
// On a borderline capture, grab a short burst and keep the sharpest frame -- the
// first frame after a tap (or an auto-snap) can be mid-refocus. When the live
// frame is already sharp, burstFrames() takes a single frame and skips the wait,
// so a good shot is instant (Ricky's speed ask). The fallback burst is 3 frames.
const BURST_FRAMES = 3;
const BURST_GAP_MS = 60; // ~120ms total across 3 frames, only when borderline
const SCORE_W = 320; // downscale width for the sharpness score (matches DETECT_W)
// Below this Laplacian-variance score a frame is treated as too blurry to add.
// Absolute value depends on the downscale, so it is deliberately conservative
// (lean toward keeping) and NEEDS tuning on a real phone -- the "i" panel shows
// the live and last-capture scores so we can calibrate from Ricky's numbers.
const BLUR_THRESHOLD = 55;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ask the live camera track for continuous autofocus. Best-effort: focusMode
 * isn't in the TS DOM lib and many cameras (or iOS Safari) don't support it, so
 * every failure is swallowed -- a fixed-focus camera just stays as it is.
 */
async function applyContinuousFocus(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
    });
  } catch {
    /* unsupported — continuous focus is a nice-to-have, not required */
  }
}

/**
 * Tap-to-focus where the camera supports it: point the lens at the spot the
 * teacher tapped. Normalised 0..1 point of interest, single-shot focus. Support
 * is thin (mostly Chromium on Android), so this is wrapped and silent — a tap on
 * a camera that can't do it simply does nothing.
 */
async function focusAt(stream: MediaStream | null, xNorm: number, yNorm: number) {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({
      advanced: [
        {
          focusMode: "single-shot",
          pointsOfInterest: [{ x: xNorm, y: yNorm }],
        } as unknown as MediaTrackConstraintSet,
      ],
    });
  } catch {
    /* unsupported — tap-to-focus is best-effort */
  }
}

function readAuto(): boolean {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    return v === null ? true : v === "1"; // default Auto (Ricky); remembered after
  } catch {
    return true;
  }
}
function writeAuto(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
}

/**
 * A full-screen, rapid-fire camera for scanning student work.
 *
 * Instant shutter, no review step; "Next student" records a boundary and Done
 * returns the shots grouped per student. Two safety nets: closing with pages in
 * hand asks first, and every page is saved to IndexedDB as it's taken so an
 * interruption can be restored (lib/scan-store) — storage never blocks capture.
 *
 * Page edges are detected live and outlined, to guide framing and to decide
 * when to auto-snap. The capture itself is NOT cropped to the detected page: it
 * is exactly the region the full-screen preview shows (coverCrop), so whatever
 * the teacher sees on screen is what is saved. Auto-snap fires
 * only on a confident page; low confidence shows "Hold steady or tap the
 * shutter." Detection code is dependency-free and loaded only when the camera
 * opens. If the camera can't start, the teacher is sent to Upload.
 */
export function ScanCamera({
  mode,
  title,
  assessmentId,
  onComplete,
  onCancel,
  onFallback,
}: {
  mode: "single" | "class";
  title?: string;
  assessmentId: string;
  onComplete: (groups: File[][]) => void;
  onCancel: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  const seqRef = useRef(0);
  const groupRef = useRef(0);
  const autoRef = useRef(false);
  const edgeRef = useRef<EdgeLib | null>(null);
  const snapRef = useRef<SnapLib | null>(null);
  const quadRef = useRef<DetectedQuad | null>(null);
  const snapStateRef = useRef<import("@/lib/auto-snap").AutoSnapState | null>(null);
  const lastDetectRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const shootRef = useRef<() => void>(() => {});
  // The stream's first frames on iOS are often blurry while it focuses and
  // settles, so capture waits for this.
  const settledRef = useRef(false);
  // The size of the most recent capture, for the diagnostic panel.
  const lastCaptureRef = useRef<{ w: number; h: number } | null>(null);
  // A burst takes a few frames over ~300ms; this guards against a second tap (or
  // an auto-snap) starting a second burst while one is already running.
  const capturingRef = useRef(false);
  // Sharpness scores for the diagnostic panel: the live preview frame, and the
  // sharpest frame of the last capture burst.
  const liveScoreRef = useRef(0);
  const lastScoreRef = useRef<number | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [shots, setShots] = useState<Shot[]>([]);
  const [group, setGroup] = useState(0);
  const [auto, setAuto] = useState(() => readAuto());
  const [lowConfidence, setLowConfidence] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [settled, setSettled] = useState(false);
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restorable, setRestorable] = useState<Shot[] | null>(null);
  // A manual capture that came back too blurry: held so the teacher can keep it
  // anyway or try again. (Auto-snap just skips a blurry frame silently.)
  const [blurryShot, setBlurryShot] = useState<{ canvas: HTMLCanvasElement; score: number } | null>(
    null,
  );
  const [tooBlurry, setTooBlurry] = useState(false);
  // Hidden diagnostic panel (tap the "i"), and a tick that refreshes its live
  // numbers while it is open.
  const [diag, setDiag] = useState(false);
  const [diagText, setDiagText] = useState("");
  useEffect(() => {
    settledRef.current = settled;
  }, [settled]);

  // Lock page scroll while the camera is open (undone on close), so the page
  // behind the full-screen camera can't be scrolled by a stray drag.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => {
    groupRef.current = group;
  }, [group]);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Offer to restore pages left behind by an interruption for this assessment.
  useEffect(() => {
    let live = true;
    loadShots(assessmentId)
      .then((stored) => {
        if (!live || !stored.length) return;
        return Promise.all(
          stored.map(async (s) => ({
            id: s.id,
            url: await thumbUrlFor(s.blob),
            blob: s.blob,
            group: s.group,
            seq: s.seq,
          })),
        ).then((shots) => {
          if (live) setRestorable(shots);
          else shots.forEach((x) => URL.revokeObjectURL(x.url));
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assessmentId]);

  // Take a short burst of frames, cropped to exactly what the cover preview
  // shows, and keep the sharpest one -- the first frame after a tap/auto-snap is
  // often mid-refocus and blurriest. Returns the best canvas and its sharpness
  // score, or null if the video isn't ready.
  async function captureBurst(): Promise<{ canvas: HTMLCanvasElement; score: number } | null> {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const fw = video.videoWidth;
    const fh = video.videoHeight;
    // What the teacher actually sees: the preview fills the screen with
    // object-fit: cover, so crop the capture to exactly that visible region,
    // mapped back to frame pixels. Read the live video dimensions (iOS reports
    // them rotated only after playback starts) and the current on-screen size,
    // so a rotated phone or a landscape frame both come out matching the screen.
    const vw = video.clientWidth || window.innerWidth;
    const vh = video.clientHeight || window.innerHeight;
    const crop = coverCrop(fw, fh, vw, vh);
    const scale = Math.min(1, CAPTURE_CAP / Math.max(crop.w, crop.h));
    const outW = Math.max(1, Math.round(crop.w * scale));
    const outH = Math.max(1, Math.round(crop.h * scale));
    // A small grayscale copy to score each frame's sharpness on.
    const sw = Math.max(3, Math.min(SCORE_W, outW));
    const sh = Math.max(3, Math.round((outH * sw) / outW));
    const scorer = document.createElement("canvas");
    scorer.width = sw;
    scorer.height = sh;
    const sctx = scorer.getContext("2d", { willReadFrequently: true });

    // Two full-size canvases for the whole burst, swapped as a sharper frame
    // turns up, instead of a new 12 MB canvas per frame left for the garbage
    // collector -- five of those per page added up over a class set.
    let best: HTMLCanvasElement | null = null;
    let spare: HTMLCanvasElement | null = null;
    let bestScore = -Infinity;
    // Already-sharp live frame -> a single frame, no burst wait; borderline -> a
    // short burst and keep the sharpest.
    const frames = burstFrames(liveScoreRef.current, BLUR_THRESHOLD, BURST_FRAMES);
    for (let i = 0; i < frames; i++) {
      const cap: HTMLCanvasElement = spare ?? document.createElement("canvas");
      spare = null;
      cap.width = outW;
      cap.height = outH;
      const cctx = cap.getContext("2d");
      if (!cctx) break;
      cctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
      let score = 0;
      if (sctx) {
        sctx.drawImage(cap, 0, 0, sw, sh);
        score = laplacianVariance(rgbaToGray(sctx.getImageData(0, 0, sw, sh).data), sw, sh);
      }
      if (score > bestScore) {
        bestScore = score;
        spare = best;
        best = cap;
      } else {
        spare = cap;
      }
      if (i < frames - 1) await sleep(BURST_GAP_MS);
    }
    release(spare);
    release(scorer);
    return best ? { canvas: best, score: bestScore } : null;
  }

  // Buffer a captured canvas as a page (JPEG blob -> state + IndexedDB).
  function addShot(canvas: HTMLCanvasElement) {
    lastCaptureRef.current = { w: canvas.width, h: canvas.height };
    const captureGroup = groupRef.current;
    const seq = seqRef.current++;
    // The thumbnail is cut from the canvas before it is encoded and released,
    // so the strip never has to decode the full page again.
    const thumb = thumbBlob(canvas, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        release(canvas);
        if (!blob) return;
        const id = crypto.randomUUID();
        void thumb.then((small) => {
          const url = URL.createObjectURL(small ?? blob);
          setShots((s) => [...s, { id, url, blob, group: captureGroup, seq }]);
        });
        void saveShot({ id, assessmentId, group: captureGroup, seq, blob }).catch(() => {});
      },
      "image/jpeg",
      0.92,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }

  function flashBlurryHint() {
    setTooBlurry(true);
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => setTooBlurry(false), 2200);
  }

  // Capture flow: wait for the stream to settle, take a sharpest-of-burst frame,
  // and only add it if it clears the blur threshold. A blurry manual shot is
  // offered as keep-anyway / try-again; a blurry auto-snap is skipped with a hint
  // (auto-snap keeps trying). `shoot` is a sync wrapper so the shutter onClick and
  // the auto-snap caller stay plain calls.
  async function captureNow() {
    if (!settledRef.current) return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      const res = await captureBurst();
      if (!res) return;
      lastScoreRef.current = res.score;
      if (res.score < BLUR_THRESHOLD) {
        lastCaptureRef.current = { w: res.canvas.width, h: res.canvas.height };
        if (autoRef.current) flashBlurryHint();
        else setBlurryShot(res);
        return;
      }
      addShot(res.canvas);
    } finally {
      capturingRef.current = false;
    }
  }
  function shoot() {
    void captureNow();
  }
  function keepBlurryShot() {
    if (blurryShot) addShot(blurryShot.canvas);
    setBlurryShot(null);
  }
  function discardBlurryShot() {
    release(blurryShot?.canvas);
    setBlurryShot(null);
  }
  useEffect(() => {
    shootRef.current = shoot;
  });

  // Load the (dependency-free) detection code only once the camera is open.
  useEffect(() => {
    let live = true;
    Promise.all([import("@/lib/edge-detect"), import("@/lib/auto-snap")]).then(([edge, snap]) => {
      if (!live) return;
      edgeRef.current = edge;
      snapRef.current = snap;
      snapStateRef.current = snap.initialAutoSnapState;
    });
    return () => {
      live = false;
    };
  }, []);

  // Live detection + auto-snap loop.
  useEffect(() => {
    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame);
      const video = videoRef.current;
      const edge = edgeRef.current;
      const dc = detectCanvasRef.current;
      const oc = overlayCanvasRef.current;
      if (!video || !video.videoWidth || !edge || !dc || !oc) return;
      if (now - lastDetectRef.current < DETECT_EVERY_MS) return;
      lastDetectRef.current = now;

      const fw = video.videoWidth;
      const fh = video.videoHeight;
      // Detection runs on a small copy of the whole frame (frame aspect).
      const dw = DETECT_W;
      const dh = Math.max(1, Math.round((DETECT_W * fh) / fw));
      if (dc.width !== dw) {
        dc.width = dw;
        dc.height = dh;
      }
      // The overlay is sized to the on-screen viewport, not the frame, so the
      // outline can be drawn where the page actually appears under cover.
      const vw = Math.max(1, Math.round(video.clientWidth || window.innerWidth));
      const vh = Math.max(1, Math.round(video.clientHeight || window.innerHeight));
      if (oc.width !== vw || oc.height !== vh) {
        oc.width = vw;
        oc.height = vh;
      }
      const dctx = dc.getContext("2d", { willReadFrequently: true });
      const octx = oc.getContext("2d");
      if (!dctx || !octx) return;
      dctx.drawImage(video, 0, 0, dw, dh);
      const imgData = dctx.getImageData(0, 0, dw, dh);
      // Score the live frame's sharpness on the same downscale the capture uses,
      // so the auto-snap gate and the threshold are comparable.
      liveScoreRef.current = laplacianVariance(rgbaToGray(imgData.data), dw, dh);
      const sharp = liveScoreRef.current >= BLUR_THRESHOLD;
      const quad = edge.findDocumentQuad(imgData);
      const confident = !!quad && edge.isConfidentQuad(quad, dw, dh);
      quadRef.current = quad ? { quad, w: dw, h: dh, confident } : null;
      setLowConfidence(!!quad && !confident);

      octx.clearRect(0, 0, vw, vh);
      if (quad) {
        // Map each corner from the detection frame into the visible cover space,
        // so the outline sits on the page exactly as it appears on screen.
        const pts = quad.map((p) => coverMapPoint(p.x, p.y, dw, dh, vw, vh));
        // Solid green on a confident page; dashed/soft when only a guess.
        octx.lineWidth = confident ? 2.5 : 2;
        octx.strokeStyle = confident ? "rgba(120,230,170,0.95)" : "rgba(245,205,110,0.9)";
        octx.fillStyle = confident ? "rgba(120,230,170,0.14)" : "rgba(245,205,110,0.08)";
        octx.setLineDash(confident ? [] : [6, 5]);
        octx.beginPath();
        octx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 4; i++) octx.lineTo(pts[i].x, pts[i].y);
        octx.closePath();
        octx.fill();
        octx.stroke();
      }

      // Auto-snap only on a confident AND sharp page, and only once the stream
      // has settled, so it never fires on a blurry or out-of-focus frame; feed
      // null otherwise so the hold timer resets.
      const snap = snapRef.current;
      if (autoRef.current && settledRef.current && snap && snapStateRef.current) {
        const r = snap.autoSnapStep(snapStateRef.current, {
          quad: confident && sharp ? quad : null,
          now,
        });
        snapStateRef.current = r.state;
        if (r.fire) shootRef.current();
      }
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!cameraSupported()) {
        setError(describeCameraError({ name: "NotSupported" }));
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          videoConstraints("environment"),
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        // Many browsers only apply focus through the live track, not the initial
        // getUserMedia constraints, so ask again here. Best-effort: a camera that
        // doesn't support focusMode throws, and a fixed-focus camera is fine as
        // is -- neither should stop the scan.
        void applyContinuousFocus(stream);
        setStarting(false);
        // Give the stream a moment to focus and settle before allowing a
        // capture -- iOS hands back a sharp frame a beat after playback starts.
        setTimeout(() => {
          if (!cancelled) setSettled(true);
        }, SETTLE_MS);
      } catch (e) {
        if (!cancelled) {
          setError(describeCameraError(e));
          setStarting(false);
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      stop();
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, [stop]);

  function tapToFocus(e: MouseEvent<HTMLVideoElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    void focusAt(streamRef.current, x, y);
  }

  // A plain-text dump Ricky can screenshot if anything is still off: the frame
  // the camera is delivering, the track's own settings, the screen orientation,
  // and the size of the last capture. Read live from the video and track. Called
  // from the interval below (never during render), so reading refs is safe.
  function diagnostics(): string {
    const v = videoRef.current;
    const track = streamRef.current?.getVideoTracks?.()[0];
    const s = (track?.getSettings?.() ?? {}) as Record<string, unknown>;
    const orient =
      (typeof screen !== "undefined" && screen.orientation?.type) ||
      (typeof window !== "undefined" && window.innerHeight >= window.innerWidth
        ? "portrait"
        : "landscape");
    const cap = lastCaptureRef.current;
    const lines = [
      "video frame: " + (v ? v.videoWidth + " x " + v.videoHeight : "—"),
      "screen (css): " +
        (v ? v.clientWidth + " x " + v.clientHeight : "—") +
        "  dpr " + (typeof window !== "undefined" ? window.devicePixelRatio : "—"),
      "orientation: " + orient,
      "track w x h: " + (s.width ?? "—") + " x " + (s.height ?? "—"),
      "track aspectRatio: " + (s.aspectRatio ?? "—"),
      "track facingMode: " + (s.facingMode ?? "—"),
      "track focusMode: " + ((s as { focusMode?: unknown }).focusMode ?? "—"),
      "settled: " + settledRef.current,
      "live sharpness: " + liveScoreRef.current.toFixed(0) + " (blur < " + BLUR_THRESHOLD + ")",
      "last capture: " + (cap ? cap.w + " x " + cap.h : "—"),
      "last capture score: " +
        (lastScoreRef.current == null ? "—" : lastScoreRef.current.toFixed(0)),
    ];
    return lines.join("\n");
  }

  // Refresh the diagnostic numbers a few times a second while the panel is open.
  // The refs are read inside the interval callback (not during render), and the
  // text is held in state so the render path never touches a ref.
  useEffect(() => {
    if (!diag) return;
    const id = setInterval(() => setDiagText(diagnostics()), 300);
    return () => clearInterval(id);
  }, [diag]);

  function toggleAuto() {
    setAuto((a) => {
      const next = !a;
      writeAuto(next);
      if (snapRef.current) snapStateRef.current = snapRef.current.initialAutoSnapState;
      return next;
    });
  }

  function removeShot(id: string) {
    setShots((s) => {
      const hit = s.find((x) => x.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return s.filter((x) => x.id !== id);
    });
    void deleteShot(id).catch(() => {});
  }

  function nextStudent() {
    if (!shots.some((x) => x.group === group)) return;
    setGroup((g) => g + 1);
  }

  function done() {
    setFinishing(true);
    const groups = partitionByGroup(shots, group + 1).map((g, gi) =>
      g.map(
        (shot, pi) =>
          new File([shot.blob], `scan-${gi + 1}-${pi + 1}.jpg`, { type: "image/jpeg" }),
      ),
    );
    void clearShots(assessmentId).catch(() => {});
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    stop();
    onComplete(groups);
  }

  function leave(handler: () => void) {
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    stop();
    handler();
  }

  function requestClose() {
    if (shots.length > 0) setConfirmDiscard(true);
    else leave(onCancel);
  }
  function discardAndClose() {
    void clearShots(assessmentId).catch(() => {});
    leave(onCancel);
  }

  function restore() {
    if (!restorable) return;
    setShots(restorable);
    setGroup(restorable.reduce((m, s) => Math.max(m, s.group), 0));
    seqRef.current = restorable.reduce((m, s) => Math.max(m, s.seq + 1), 0);
    setRestorable(null);
  }
  function discardRestorable() {
    restorable?.forEach((s) => URL.revokeObjectURL(s.url));
    void clearShots(assessmentId).catch(() => {});
    setRestorable(null);
  }

  const inCurrent = shots.filter((s) => s.group === group).length;

  if (error) {
    const errorView = (
      <div className="scan-camera" role="dialog" aria-modal="true" aria-label="Camera">
        <div className="scan-camera-error">
          <Camera size={30} />
          <p>{error}</p>
          <div className="scan-camera-side" style={{ justifyContent: "center" }}>
            <button type="button" className="scan-camera-btn primary" onClick={() => leave(onFallback)}>
              <Upload size={16} /> Use Upload
            </button>
            <button type="button" className="scan-camera-btn" onClick={() => leave(onCancel)}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
    return typeof document === "undefined" ? null : createPortal(errorView, document.body);
  }

  const view = (
    <div className="scan-camera" role="dialog" aria-modal="true" aria-label="Scan student work">
      <video
        ref={videoRef}
        className="scan-camera-video"
        muted
        playsInline
        autoPlay
        onClick={tapToFocus}
        aria-label="Camera preview — tap to focus"
      />
      <canvas ref={overlayCanvasRef} className="scan-camera-overlay" aria-hidden="true" />
      <canvas ref={detectCanvasRef} className="sr-only" aria-hidden="true" />
      {flash && <div className="scan-camera-flash" aria-hidden="true" />}
      <div className="scan-camera-top">
        <span className="scan-camera-count">
          {title ? title + " · " : ""}
          {mode === "class"
            ? "Student " + (group + 1) + " · " + inCurrent + (inCurrent === 1 ? " page" : " pages")
            : shots.length + (shots.length === 1 ? " page" : " pages")}
        </span>
        <div className="scan-camera-side" style={{ flex: "0 0 auto" }}>
          <button
            type="button"
            className={"scan-camera-btn" + (auto ? " primary" : "")}
            aria-pressed={auto}
            aria-label={auto ? "Auto capture on — switch to manual" : "Auto capture off — switch to auto"}
            onClick={toggleAuto}
          >
            {auto ? <Zap size={15} /> : <ZapOff size={15} />} {auto ? "Auto" : "Manual"}
          </button>
          <button
            type="button"
            className="scan-camera-icon-btn"
            aria-label="Camera diagnostics"
            aria-pressed={diag}
            onClick={() => setDiag((d) => !d)}
          >
            <Info size={18} />
          </button>
          <button
            type="button"
            className="scan-camera-icon-btn"
            aria-label="Close camera"
            onClick={requestClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      {diag && (
        <pre className="scan-camera-diag" aria-label="Camera diagnostics">
          {diagText}
        </pre>
      )}
      {starting && (
        <div className="scan-camera-starting" role="status">
          <LoaderCircle className="spin" size={22} /> Starting camera…
        </div>
      )}
      {!starting && !settled && (
        <div className="scan-camera-hint" role="status">
          Focusing…
        </div>
      )}
      {!starting && settled && tooBlurry && (
        <div className="scan-camera-hint" role="status">
          Too blurry — hold steady, a little farther from the page
        </div>
      )}
      {!starting && settled && !tooBlurry && auto && lowConfidence && (
        <div className="scan-camera-hint" role="status">
          Hold steady or tap the shutter
        </div>
      )}
      <div className="scan-camera-bottom">
        {shots.length > 0 && (
          <div className="scan-camera-thumbs" aria-label="Captured pages">
            {shots.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="scan-camera-thumb"
                aria-label={"Delete page " + (i + 1)}
                onClick={() => removeShot(s.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={"Captured page " + (i + 1)} />
                <span className="scan-camera-thumb-x">
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="scan-camera-controls">
          <div className="scan-camera-side">
            {mode === "class" && (
              <button
                type="button"
                className="scan-camera-btn"
                disabled={inCurrent === 0}
                onClick={nextStudent}
              >
                <UserPlus size={16} /> Next student
              </button>
            )}
          </div>
          <button
            type="button"
            className="scan-camera-shutter"
            aria-label="Take a photo"
            disabled={starting || finishing || !settled}
            onClick={shoot}
          />
          <div className="scan-camera-side">
            <button
              type="button"
              className="scan-camera-btn primary"
              disabled={finishing}
              onClick={done}
            >
              {finishing ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{" "}
              {mode === "class" ? "Finished" : "Done"}
            </button>
          </div>
        </div>
      </div>

      {restorable && (
        <div className="scan-camera-sheet" role="dialog" aria-modal="true" aria-label="Restore pages">
          <div className="scan-camera-sheet-card">
            <RotateCcw size={26} />
            <h2>Unsaved pages found</h2>
            <p>
              {restorable.length} page{restorable.length === 1 ? "" : "s"} from before are still
              here. Restore them and keep going?
            </p>
            <div className="scan-camera-sheet-actions">
              <button type="button" className="scan-camera-btn primary" onClick={restore}>
                Restore {restorable.length} page{restorable.length === 1 ? "" : "s"}
              </button>
              <button type="button" className="scan-camera-btn" onClick={discardRestorable}>
                Start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDiscard && (
        <div className="scan-camera-sheet" role="dialog" aria-modal="true" aria-label="Discard pages">
          <div className="scan-camera-sheet-card">
            <h2>Discard {shots.length} page{shots.length === 1 ? "" : "s"}?</h2>
            <p>These scanned pages haven’t been saved to the assessment yet.</p>
            <div className="scan-camera-sheet-actions">
              <button
                type="button"
                className="scan-camera-btn primary"
                autoFocus
                onClick={() => setConfirmDiscard(false)}
              >
                Keep scanning
              </button>
              <button type="button" className="scan-camera-btn danger" onClick={discardAndClose}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {blurryShot && (
        <div className="scan-camera-sheet" role="dialog" aria-modal="true" aria-label="Blurry photo">
          <div className="scan-camera-sheet-card">
            <Camera size={26} />
            <h2>Too blurry</h2>
            <p>
              Hold steady and move back a little from the page, then try again. You can keep this
              one if you want.
            </p>
            <div className="scan-camera-sheet-actions">
              <button type="button" className="scan-camera-btn primary" autoFocus onClick={discardBlurryShot}>
                Try again
              </button>
              <button type="button" className="scan-camera-btn" onClick={keepBlurryShot}>
                Keep anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Portal straight into document.body: no transformed/clipping ancestor (an
  // animated card, an overflow wrapper) can box in the fixed, full-screen camera.
  // On iOS that was leaving the preview inside the page with the shutter/Done
  // off-screen. (document is always defined here -- the camera only mounts after
  // a tap -- but the guard keeps it safe if it ever renders on the server.)
  return typeof document === "undefined" ? null : createPortal(view, document.body);
}
