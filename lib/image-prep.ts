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

/**
 * How much of the top of a page the class scan's name pass looks at.
 *
 * It used to be a fixed 18% band, and on Michael's real class sets (6-7 Oct) the
 * name pass read 22 names off 172 pages. In a phone photo the "Name" line sits
 * lower than 18% of the frame -- there is table and margin above the sheet --
 * and children write the name above the line, beside it, or in a corner. Since
 * the 28 Sep call the AI may read student names, so there is no longer a reason
 * to crop tight: the name pass sees the top 45% of the page, at a reduced
 * resolution, and is told to look anywhere near the top.
 */
export const NAME_AREA = 0.45;

/** Longest edge of the name-area image. A name is a few large handwritten
 * words; this keeps the name pass small without making them illegible. */
const NAME_AREA_MAX_EDGE = 1400;

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

/** The rows of a page of this height that the name pass is shown. Pure. */
export function nameAreaGeometry(height: number, area = NAME_AREA) {
  return { top: 0, height: Math.max(1, Math.round(height * area)) };
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

function toFile(canvas: HTMLCanvasElement, name: string, quality = QUALITY): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Free the pixels now: a class set prepares sixty pages back to back,
        // and on a phone a 2000px canvas left for the garbage collector is
        // 12 MB that lingers until it gets round to it.
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(new File([blob], name, { type: "image/jpeg" }));
        else reject(new Error("could not encode the page"));
      },
      "image/jpeg",
      quality,
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
 * A class-scan page: the whole upright page for grading, and a reduced copy of
 * its top part for reading the name.
 *
 * Nothing is cut off the graded page any more. The old split removed the top
 * 18% so grading never saw a name, and on a phone photo that 18% could hold the
 * first question -- grading then read it as blank. Since the 28 Sep decision the
 * AI may see names, so the page is graded whole (the grading prompt still tells
 * it to ignore and never report a name). See docs/student-data-flow.md section 4.
 *
 * Returns null for a non-image, or when the browser cannot do the work; the
 * caller then grades the original file and reads no name from it.
 */
export async function splitForClassScan(
  file: File,
): Promise<{ nameArea: File; page: File } | null> {
  if (!isImage(file)) return null;
  try {
    const bitmap = await decode(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const whole = canvasFor(size);
    whole.ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const sourceArea = nameAreaGeometry(bitmap.height);
    const areaSize = fitWithin(bitmap.width, sourceArea.height, NAME_AREA_MAX_EDGE);
    const area = canvasFor(areaSize);
    area.ctx.drawImage(
      bitmap,
      0, 0, bitmap.width, sourceArea.height,
      0, 0, areaSize.width, areaSize.height,
    );
    bitmap.close?.();
    return {
      nameArea: await toFile(area.canvas, renamed(file.name, "-name")),
      page: await toFile(whole.canvas, renamed(file.name, "")),
    };
  } catch {
    return null;
  }
}
