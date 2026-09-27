"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, Upload, UserPlus, X } from "lucide-react";
import {
  cameraSupported,
  describeCameraError,
  partitionByGroup,
  videoConstraints,
} from "@/lib/camera";

type Shot = { id: string; url: string; blob: Blob; group: number };

/**
 * A full-screen, rapid-fire camera for scanning student work.
 *
 * The whole point (Ricky and Michael: "scan, scan, scan") is that the shutter
 * captures instantly and stays open — no Use Photo / Retake step the native
 * camera forces after every shot. Frames are held in memory as they're taken
 * and only uploaded when the teacher taps Done, so nothing slows the shutter.
 * "Next student" records a boundary between students; on Done the shots come
 * back grouped so they feed the existing declared per-student grouping.
 *
 * It never traps the teacher: if the camera can't start (blocked, missing, in
 * use) it says so plainly and offers Upload, which always works.
 */
export function ScanCamera({
  mode,
  title,
  onComplete,
  onCancel,
  onFallback,
}: {
  /** "class" shows Next student; "single" is one student's pages. */
  mode: "single" | "class";
  title?: string;
  /** Captured pages, grouped per student (one group in single mode). */
  onComplete: (groups: File[][]) => void;
  onCancel: () => void;
  /** The teacher chose Upload instead (or the camera failed). */
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [group, setGroup] = useState(0);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Keep a ref copy of shots so unmount teardown can revoke every object URL it
  // created, even if the camera is closed from outside rather than by a button.
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setShots((s) => [
          ...s,
          { id: crypto.randomUUID(), url: URL.createObjectURL(blob), blob, group },
        ]);
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
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    stop();
    onComplete(groups);
  }

  function leave(handler: () => void) {
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    stop();
    handler();
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
          onClick={() => leave(onCancel)}
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
    </div>
  );
}
