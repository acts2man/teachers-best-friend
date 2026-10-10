"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Images, LoaderCircle, Minus, Plus, Scissors, Undo2, X } from "lucide-react";
import {
  DEFAULT_PAGES_PER_STUDENT,
  everyNBreaks,
  groupByBreaks,
  orderByCaptureTime,
  readExifTimestamp,
} from "@/lib/photo-import";

type Ordered = { file: File; url: string };

/**
 * "Import from Photos": the teacher picked a whole phone roll of a class set at
 * once. We put the pages back in the order they were taken (EXIF capture time,
 * falling back to the order they picked), split them into one pile per student,
 * and show that split so they can fix it before anything uploads. On confirm we
 * hand grouped File[][] to onComplete, which feeds the same upload/split/grade
 * pipeline the in-app camera uses (addCameraGroups) -- there is no second
 * pipeline to keep in step.
 */
export function PhotoImport({
  files,
  onComplete,
  onCancel,
}: {
  files: File[];
  onComplete: (groups: File[][]) => void;
  onCancel: () => void;
}) {
  const [ordered, setOrdered] = useState<Ordered[] | null>(null);
  const [byCaptureTime, setByCaptureTime] = useState(false);
  const [perStudent, setPerStudent] = useState(DEFAULT_PAGES_PER_STUDENT);
  // Positions where a new student's pile starts, in the ordered list.
  const [breaks, setBreaks] = useState<Set<number>>(new Set());

  // Read capture times once, order the photos, and lay out the default split.
  // Thumbnail object URLs are created here and revoked on unmount.
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      const times = await Promise.all(files.map((f) => readExifTimestamp(f)));
      if (!live) return;
      const order = orderByCaptureTime(times.map((time) => ({ time })));
      const list = order.map((i) => {
        const url = URL.createObjectURL(files[i]);
        urls.push(url);
        return { file: files[i], url };
      });
      setByCaptureTime(times.length > 0 && times.every((t) => t !== null));
      setOrdered(list);
      setBreaks(new Set(everyNBreaks(list.length, DEFAULT_PAGES_PER_STUDENT)));
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const total = ordered?.length ?? 0;
  const piles = useMemo(() => groupByBreaks(total, breaks), [total, breaks]);

  function applyPerStudent(n: number) {
    const next = Math.max(1, Math.min(10, n));
    setPerStudent(next);
    setBreaks(new Set(everyNBreaks(total, next)));
  }

  function toggleBreak(pos: number) {
    setBreaks((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }

  function confirm() {
    if (!ordered) return;
    const groups = groupByBreaks(total, breaks).map((pile) => pile.map((i) => ordered[i].file));
    onComplete(groups);
  }

  // Which student each ordered position belongs to, for the badges.
  const studentOf = useMemo(() => {
    const map = new Array(total).fill(0);
    piles.forEach((pile, s) => pile.forEach((pos) => (map[pos] = s)));
    return map;
  }, [piles, total]);

  const view = (
    <div className="photo-import" role="dialog" aria-modal="true" aria-label="Import from Photos">
      <div className="photo-import-head">
        <div className="photo-import-title">
          <Images size={20} />
          <strong>Import from Photos</strong>
        </div>
        <button type="button" className="photo-import-x" onClick={onCancel} aria-label="Cancel import">
          <X size={20} />
        </button>
      </div>

      {!ordered ? (
        <div className="photo-import-loading">
          <LoaderCircle className="spin" size={22} />
          <p>Putting your photos in order…</p>
        </div>
      ) : total === 0 ? (
        <div className="photo-import-loading">
          <p>No photos were selected.</p>
          <button type="button" className="scan-camera-btn" onClick={onCancel}>
            Close
          </button>
        </div>
      ) : (
        <>
          <p className="photo-import-note cell-meta">
            {byCaptureTime
              ? "Ordered by when each photo was taken."
              : "A few photos had no time saved, so these are in the order you picked them."}{" "}
            Check the split into students below, then import.
          </p>

          <div className="photo-import-split-control">
            <span className="cell-meta">Pages per student</span>
            <div className="photo-import-stepper">
              <button
                type="button"
                onClick={() => applyPerStudent(perStudent - 1)}
                disabled={perStudent <= 1}
                aria-label="Fewer pages per student"
              >
                <Minus size={15} />
              </button>
              <strong aria-live="polite">{perStudent}</strong>
              <button
                type="button"
                onClick={() => applyPerStudent(perStudent + 1)}
                disabled={perStudent >= 10}
                aria-label="More pages per student"
              >
                <Plus size={15} />
              </button>
            </div>
            <span className="cell-meta">
              {piles.length} student{piles.length === 1 ? "" : "s"} · {total} page
              {total === 1 ? "" : "s"}
            </span>
          </div>

          <div className="photo-import-list">
            {ordered.map((item, pos) => (
              <div key={item.url}>
                {pos > 0 &&
                  (breaks.has(pos) ? (
                    <div className="photo-import-boundary">
                      <span>Student {studentOf[pos] + 1} starts here</span>
                      <button type="button" onClick={() => toggleBreak(pos)}>
                        <Undo2 size={13} /> Join to student {studentOf[pos]}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="photo-import-splithere"
                      onClick={() => toggleBreak(pos)}
                    >
                      <Scissors size={13} /> New student here
                    </button>
                  ))}
                <div className="photo-import-page">
                  <span className="photo-import-badge">{studentOf[pos] + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={"Page " + (pos + 1)} />
                  <span className="cell-meta">Page {pos + 1}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="photo-import-actions">
            <button type="button" className="scan-camera-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="scan-camera-btn primary" onClick={confirm}>
              <Check size={16} /> Import {piles.length} student{piles.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(view, document.body);
}
