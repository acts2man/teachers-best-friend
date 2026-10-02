"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Camera, Check, Info, LoaderCircle, RotateCcw, Upload, UserPlus, X, Zap, ZapOff } from "lucide-react";
import {
  cameraSupported,
  coverCrop,
  coverMapPoint,
  describeCameraError,
  partitionByGroup,
  videoConstraints,
} from "@/lib/camera";
import { clearShots, deleteShot, loadShots, saveShot } from "@/lib/scan-store";

type Shot = { id: string; url: string; blob: Blob; group: number; seq: number };
type EdgeLib = typeof import("@/lib/edge-detect");
type SnapLib = typeof import("@/lib/auto-snap");
type DetectedQuad = { quad: import("@/lib/edge-detect").Quad; w: number; h: number; confident: boolean };

const AUTO_KEY = "tbf.scan.autoSnap";
const DETECT_W = 320; // downscaled working width for live detection
const CAPTURE_CAP = 2000; // long-edge cap; matches uprightPage's downstream cap
const DETECT_EVERY_MS = 120; // ~8 detections/sec keeps a mid-range phone smooth
const SETTLE_MS = 700; // let the stream focus/settle before the first capture

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
 * Page edges are detected live and outlined; on capture the page is cropped and
 * straightened, BUT only when the detection is convincingly a page (large,
 * rectangular, top near the frame top so the name band is never cut). Otherwise
 * the full frame is kept — a wrong crop is worse than no crop. Auto-snap fires
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
  // Hidden diagnostic panel (tap the "i"), and a tick that refreshes its live
  // numbers while it is open.
  const [diag, setDiag] = useState(false);
  const [diagText, setDiagText] = useState("");
  useEffect(() => {
    settledRef.current = settled;
  }, [settled]);

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
        setRestorable(
          stored.map((s) => ({
            id: s.id,
            url: URL.createObjectURL(s.blob),
            blob: s.blob,
            group: s.group,
            seq: s.seq,
          })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assessmentId]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    // Don't capture the blurry first frames: wait until the stream has settled.
    if (!settledRef.current) return;
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
    const cap = document.createElement("canvas");
    cap.width = outW;
    cap.height = outH;
    const cctx = cap.getContext("2d");
    if (!cctx) return;
    cctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    lastCaptureRef.current = { w: outW, h: outH };
    const out: HTMLCanvasElement = cap;

    const captureGroup = groupRef.current;
    const seq = seqRef.current++;
    out.toBlob(
      (blob) => {
        if (!blob) return;
        const id = crypto.randomUUID();
        setShots((s) => [
          ...s,
          { id, url: URL.createObjectURL(blob), blob, group: captureGroup, seq },
        ]);
        void saveShot({ id, assessmentId, group: captureGroup, seq, blob }).catch(() => {});
      },
      "image/jpeg",
      0.92,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
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
      const quad = edge.findDocumentQuad(dctx.getImageData(0, 0, dw, dh));
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

      // Auto-snap only on a confident page, and only once the stream has
      // settled, so it never fires on a blurry first frame; feed null otherwise.
      const snap = snapRef.current;
      if (autoRef.current && settledRef.current && snap && snapStateRef.current) {
        const r = snap.autoSnapStep(snapStateRef.current, { quad: confident ? quad : null, now });
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
      "last capture: " + (cap ? cap.w + " x " + cap.h : "—"),
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
    return (
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
  }

  return (
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
      {!starting && settled && auto && lowConfidence && (
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
              {finishing ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Done
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
    </div>
  );
}
