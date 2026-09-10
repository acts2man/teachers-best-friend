import Image from "next/image";

/* Lazy, layout-stable marketing image with the page's soft-shadow + rounding.
   The frame's aspect ratio comes from width/height; the photo is object-fit
   covered into it, so a real photo of any dimensions drops in cleanly.
   Placeholder files live in /public/images — replace them at the same path. */
export function Figure({
  src,
  alt,
  width,
  height,
  className = "",
  sizes = "(max-width: 900px) 100vw, 50vw",
  priority = false,
  placeholder = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /* marks the frame while a real photo hasn't been dropped in yet */
  placeholder?: boolean;
}) {
  return (
    <figure
      className={`mk-figure${placeholder ? " is-placeholder" : ""} ${className}`.trim()}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className="mk-figure-img"
      />
      {placeholder && (
        <span className="mk-figure-tag" aria-hidden="true">
          Photo placeholder · {src.replace("/images/", "")}
        </span>
      )}
    </figure>
  );
}
