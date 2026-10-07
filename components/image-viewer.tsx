"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The visible part of the screen, as "top,left,width,height".
 *
 * On a phone the layout viewport and what the teacher can actually see are not
 * the same thing: the browser's toolbars come and go, and a pinch-zoomed page
 * shows only part of it. A viewer sized to `inset: 0` can end up larger than
 * the screen, with its picture and close button somewhere off it. The visual
 * viewport is what is on the glass, so the viewer is sized to that.
 */
function subscribeViewport(onChange: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}
function viewportSnapshot() {
  const vv = window.visualViewport;
  if (!vv) return "";
  return [vv.offsetTop, vv.offsetLeft, vv.width, vv.height].map(Math.round).join(",");
}

/**
 * A picture of student work, full screen, with a close button that is always
 * on screen.
 *
 * Rendered into `document.body` through a portal. Inside the page, any
 * ancestor with a transform, filter or `contain` becomes the containing block
 * for `position: fixed`, so a "full-screen" overlay is only as big as that
 * ancestor -- the camera hit exactly this, and so did "Tap for full size" in
 * Grade by question on Android: the screen dimmed and the picture never
 * appeared. At the body there is no such ancestor.
 *
 * Tap the picture to switch between fit-to-screen and full resolution (which
 * scrolls/pans); tap the backdrop, the Close button or press Escape to close.
 */
export function ImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [full, setFull] = useState(false);
  const viewport = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind should not scroll while the picture is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const [top, left, width, height] = viewport ? viewport.split(",").map(Number) : [];
  const style = viewport ? { top, left, width, height } : undefined;

  return createPortal(
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      style={style}
      onClick={onClose}
    >
      <div className="image-viewer-bar">
        <span className="image-viewer-hint">
          {full ? "Tap the picture to fit the screen" : "Tap the picture for full size"}
        </span>
        <button
          type="button"
          className="image-viewer-close"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={18} /> Close
        </button>
      </div>
      <div className={"image-viewer-stage" + (full ? " is-full" : "")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => {
            e.stopPropagation();
            setFull((f) => !f);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
