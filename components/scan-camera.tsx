"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, RotateCcw, Upload, UserPlus, X } from "lucide-react";
import {
  cameraSupported,
  describeCameraError,
  partitionByGroup,
  videoConstraints,
} from "@/lib/camera";
import { clearShots, deleteShot, loadShots, saveShot } from "@/lib/scan-store";

type Shot = { id: string; url: string; blob: Blob; group: number; seq: number };

/**
 * A full-screen, rapid-fire camera for scanning student work.
 *
 * The whole point (Ricky and Michael: "scan, scan, scan") is that the shutter
 * captures instantly and stays open — no Use Photo / Retake step the native
 * camera forces after every shot. "Next student" records a boundary; on Done
 * the shots come back grouped so they feed the existing per-student grouping.
 *
 * Two safety nets, because a class set is a lot to lose:
 *  - Closing with pages in hand asks first (Keep scanning is the default).
 *  - Every page is written to IndexedDB as it's taken (lib/scan-store), so an
 *    interruption doesn't lose the class; reopening offers to restore them,
 *    and they're cleared once Done hands off. Storage never blocks capture.
 *
 * It never traps the teacher: if the camera can't start it says so and offers
 * Upload, which always works.
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
  /** Keys the offline-saved pages so a reopen can restore this assessment's. */
  assessmentId: string;
  onComplete: (groups: File[][]) => void;
  onCancel: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  const seqRef = useRef(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [group, setGroup] = useState(0);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restorable, setRestorable] = useState<Shot[] | null>(null);

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  const stop = useCallback(() => {
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

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    // Capture at the stream's real pixel size, not the on-screen (cover-cropped)
    // size, so the frame is the sharpest the camera gave us.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const captureGroup = group;
    const seq = seqRef.current++;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const id = crypto.randomUUID();
        setShots((s) => [
          ...s,
          { id, url: URL.createObjectURL(blob), blob, group: captureGroup, seq },
        ]);
        // Persist immediately; fire-and-forget so the shutter never waits, and
        // storage failure just means we keep this page in memory only.
        void saveShot({ id, assessmentId, group: captureGroup, seq, blob }).catch(() => {});
      },
      "image/jpeg",
      0.92,
    );
    // A quick flash confirms the shot, since there is no review step.
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
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
    // Only advance once the current student has a page, so an accidental double
    // tap doesn't leave an empty student.
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
    // Handed off successfully — the saved copies are no longer needed.
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

  /** The close button: never silently drop a stack. */
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
      {/* muted + playsInline are required for iOS Safari to show the stream
          inline instead of taking over full-screen. */}
      <video ref={videoRef} className="scan-camera-video" muted playsInline autoPlay />
      {flash && <div className="scan-camera-flash" aria-hidden="true" />}
      <div className="scan-camera-top">
        <span className="scan-camera-count">
          {title ? title + " · " : ""}
          {mode === "class"
            ? "Student " + (group + 1) + " · " + inCurrent + (inCurrent === 1 ? " page" : " pages")
            : shots.length + (shots.length === 1 ? " page" : " pages")}
        </span>
        <button
          type="button"
          className="scan-camera-icon-btn"
          aria-label="Close camera"
          onClick={requestClose}
        >
          <X size={20} />
        </button>
      </div>
      {starting && (
        <div className="scan-camera-starting" role="status">
          <LoaderCircle className="spin" size={22} /> Starting camera…
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
