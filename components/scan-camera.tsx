"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, RotateCcw, Upload, UserPlus, X, Zap, ZapOff } from "lucide-react";
import {
  cameraSupported,
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

  const [shots, setShots] = useState<Shot[]>([]);
  const [group, setGroup] = useState(0);
  const [auto, setAuto] = useState(() => readAuto());
  const [lowConfidence, setLowConfidence] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restorable, setRestorable] = useState<Shot[] | null>(null);

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
    const fw = video.videoWidth;
    const fh = video.videoHeight;
    const scale = Math.min(1, CAPTURE_CAP / Math.max(fw, fh));
    const cw = Math.round(fw * scale);
    const ch = Math.round(fh * scale);
    const cap = document.createElement("canvas");
    cap.width = cw;
    cap.height = ch;
    const cctx = cap.getContext("2d");
    if (!cctx) return;
    cctx.drawImage(video, 0, 0, cw, ch);

    // Crop + straighten only when the detection is confidently a page; anything
    // less keeps the full frame, so a wrong crop never loses the top/name.
    let out: HTMLCanvasElement = cap;
    const edge = edgeRef.current;
    const det = quadRef.current;
    if (edge && det && det.confident) {
      try {
        const q = edge.scaleQuad(det.quad, cw / det.w, ch / det.h);
        const warped = edge.warpPerspective(cctx.getImageData(0, 0, cw, ch), q);
        const wc = document.createElement("canvas");
        wc.width = warped.width;
        wc.height = warped.height;
        const wctx = wc.getContext("2d");
        if (wctx) {
          const id = wctx.createImageData(warped.width, warped.height);
          id.data.set(warped.data);
          wctx.putImageData(id, 0, 0);
          out = wc;
        }
      } catch {
        out = cap; // any warp trouble → the plain frame, never a lost shot
      }
    }

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
      const dw = DETECT_W;
      const dh = Math.max(1, Math.round((DETECT_W * fh) / fw));
      if (dc.width !== dw) {
        dc.width = dw;
        dc.height = dh;
        oc.width = dw;
        oc.height = dh;
      }
      const dctx = dc.getContext("2d", { willReadFrequently: true });
      const octx = oc.getContext("2d");
      if (!dctx || !octx) return;
      dctx.drawImage(video, 0, 0, dw, dh);
      const quad = edge.findDocumentQuad(dctx.getImageData(0, 0, dw, dh));
      const confident = !!quad && edge.isConfidentQuad(quad, dw, dh);
      quadRef.current = quad ? { quad, w: dw, h: dh, confident } : null;
      setLowConfidence(!!quad && !confident);

      octx.clearRect(0, 0, dw, dh);
      if (quad) {
        // Solid green when we'll crop; dashed/soft when only a guess.
        octx.lineWidth = confident ? 2.5 : 2;
        octx.strokeStyle = confident ? "rgba(120,230,170,0.95)" : "rgba(245,205,110,0.9)";
        octx.fillStyle = confident ? "rgba(120,230,170,0.14)" : "rgba(245,205,110,0.08)";
        octx.setLineDash(confident ? [] : [6, 5]);
        octx.beginPath();
        octx.moveTo(quad[0].x, quad[0].y);
        for (let i = 1; i < 4; i++) octx.lineTo(quad[i].x, quad[i].y);
        octx.closePath();
        octx.fill();
        octx.stroke();
      }

      // Auto-snap only on a confident page; otherwise feed null so it can't fire.
      const snap = snapRef.current;
      if (autoRef.current && snap && snapStateRef.current) {
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
        const stream = await navigator.mediaDevices.getUserMedia(videoConstraints());
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStarting(false);
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
      <video ref={videoRef} className="scan-camera-video" muted playsInline autoPlay />
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
            aria-label="Close camera"
            onClick={requestClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      {starting && (
        <div className="scan-camera-starting" role="status">
          <LoaderCircle className="spin" size={22} /> Starting camera…
        </div>
      )}
      {!starting && auto && lowConfidence && (
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
            disabled={starting || finishing}
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
