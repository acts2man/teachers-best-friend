"use client";
import { useState } from "react";
import { ZoomIn } from "lucide-react";

/** A rectangle on a picture, as fractions of its width and height. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * Part of a photographed page -- a handwritten name, or one answer -- shown
 * on its own, tap to open the whole page.
 *
 * The box comes from the AI ("the answer is about here"), so it is padded:
 * a box drawn tight around handwriting clips the tails of letters and the
 * working beside an answer. With no box, or until the picture has loaded, the
 * whole picture is shown -- the right work in a loose frame beats a tight
 * frame around the wrong thing.
 */
export function CroppedPhoto({
  src,
  box,
  alt,
  pad = 0.04,
  onOpen,
  className = "",
}: {
  src: string;
  box: Box | null | undefined;
  alt: string;
  pad?: number;
  onOpen: () => void;
  className?: string;
}) {
  // The picture's own width / height, known once it has loaded.
  const [ratio, setRatio] = useState<number | null>(null);
  const crop =
    box && ratio
      ? (() => {
          const x = Math.max(0, box.x - pad);
          const y = Math.max(0, box.y - pad);
          return {
            x,
            y,
            w: Math.min(1, box.x + box.width + pad) - x,
            h: Math.min(1, box.y + box.height + pad) - y,
          };
        })()
      : null;
  return (
    <button
      type="button"
      className={"cropped-photo " + className}
      onClick={onOpen}
      aria-label={"Enlarge: " + alt}
      style={crop ? { aspectRatio: String((crop.w * (ratio as number)) / crop.h) } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight)
            setRatio(img.naturalWidth / img.naturalHeight);
        }}
        style={
          crop
            ? {
                width: 100 / crop.w + "%",
                maxWidth: "none",
                transform: "translate(" + -crop.x * 100 + "%, " + -crop.y * 100 + "%)",
              }
            : undefined
        }
      />
      <span className="cropped-photo-hint">
        <ZoomIn size={12} /> Whole page
      </span>
    </button>
  );
}
