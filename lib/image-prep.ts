/**
 * Page preparation, in the browser, before anything is uploaded.
 *
 * Two jobs, one place, because they are the same operation:
 *
 * 1. Orientation. A phone writes the camera's rotation into EXIF rather than
 *    rotating the pixels, so a page photographed in portrait arrives sideways.
 *    A teacher reported exactly that. Decoding with `imageOrientation:
 *    "from-image"` bakes the rotation into the pixels once, here, so every
 *    later consumer -- the review screen, the model, the stored file -- sees an
 *    upright page.
 *
 * 2. Splitting off the name. For whole-class scanning the name written at the
 *    top of a page is how pages are sorted back to students, but it must not
 *    travel in the same request as that student's answers. Cutting the page in
 *    the browser means the two halves can go to two separate calls and the work
 *    never carries a name at all.
 *
 * Doing this client-side is deliberate: there is no image library on the server
 * and both deployment targets would need one, whereas every browser that can
 * take the photo can already do this.
 */

/** Fraction of the page height treated as the name band. */
export const NAME_BAND = 0.18;

/**
 * Longest edge kept after normalising. A page photograph carries far more
 * resolution than reading it needs, and every pixel is billed as model input.
 */
const MAX_EDGE = 2000;

/** JPEG quality for re-encoded pages. High enough for handwriting. */
const QUALITY = 0.92;

export function isImage(file: File) {
  return file.type.startsWith("image/");
}

/**
 * Scaled output size for a page, preserving aspect ratio and never enlarging.
 * Pure, so the sizing rule is testable without a canvas.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Where the name band and the body sit on a page of this height.
 * `body.top` is exactly `strip.height`, so no row of pixels appears in both:
 * a name cannot leak into the graded half by sitting on the boundary.
 */
export function bandGeometry(height: number, band = NAME_BAND) {
  const stripHeight = Math.max(1, Math.round(height * band));
  return {
    strip: { top: 0, height: stripHeight },
    body: { top: stripHeight, height: Math.max(1, height - stripHeight) },
  };
}

type Drawable = { width: number; height: number };

async function decode(file: File): Promise<ImageBitmap> {
  // "from-image" applies the EXIF rotation to the pixels. Without it the
  // bitmap keeps the sensor's orientation and the page arrives sideways.
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

function canvasFor({ width, height }: Drawable) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // Scanned pages are white; painting the backdrop avoids a black edge where a
  // source image has transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function toFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], name, { type: "image/jpeg" }))
          : reject(new Error("could not encode the page")),
      "image/jpeg",
      QUALITY,
    );
  });
}

function renamed(name: string, suffix: string) {
  return name.replace(/\.[^.]+$/, "") + suffix + ".jpg";
}

/**
 * An upright, sensibly sized copy of a photographed page.
 *
 * Anything that is not an image (a PDF) is returned untouched. If the browser
 * cannot decode or re-encode it, the original file is returned rather than
 * failing the upload -- a sideways page is worse than a straight one, but far
 * better than a page the teacher cannot upload at all.
 */
export async function uprightPage(file: File): Promise<File> {
  if (!isImage(file)) return file;
  try {
    const bitmap = await decode(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const { canvas, ctx } = canvasFor(size);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    return await toFile(canvas, renamed(file.name, ""));
  } catch {
    return file;
  }
}

/**
 * Splits an upright page into the name band and everything below it.
 *
 * Returns null for a non-image, or when the browser cannot do the work, so the
 * caller can fall back to the single-request path rather than silently sending
 * a page that still carries a name next to its answers.
 */
export async function splitNameBand(
  file: File,
): Promise<{ strip: File; body: File } | null> {
  if (!isImage(file)) return null;
  try {
    const bitmap = await decode(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const bands = bandGeometry(size.height);

    const strip = canvasFor({ width: size.width, height: bands.strip.height });
    strip.ctx.drawImage(
      bitmap,
      0, 0, bitmap.width, Math.round(bitmap.height * NAME_BAND),
      0, 0, size.width, bands.strip.height,
    );

    const body = canvasFor({ width: size.width, height: bands.body.height });
    const sourceTop = Math.round(bitmap.height * NAME_BAND);
    body.ctx.drawImage(
      bitmap,
      0, sourceTop, bitmap.width, bitmap.height - sourceTop,
      0, 0, size.width, bands.body.height,
    );

    bitmap.close?.();
    return {
      strip: await toFile(strip.canvas, renamed(file.name, "-name")),
      body: await toFile(body.canvas, renamed(file.name, "-work")),
    };
  } catch {
    return null;
  }
}
