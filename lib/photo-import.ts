/**
 * "Import from Photos" for the class scan.
 *
 * A teacher who photographed a class set with their phone's own camera app
 * (not the in-app camera) picks the whole roll at once. We put the pages back
 * in the order they were taken, split them into one pile per student, and let
 * the teacher fix the split before anything uploads. Everything here is pure
 * logic or a self-contained EXIF read, so it can be unit-tested without a
 * browser; the screen is components/photo-import.tsx and the upload/grade
 * pipeline is reused unchanged (teacher-class-scan's addCameraGroups).
 */

/** Phone photos of a worksheet are usually front + back: two pages per child. */
export const DEFAULT_PAGES_PER_STUDENT = 2;

// --- EXIF capture time -----------------------------------------------------
//
// The browser gives us no capture time (createImageBitmap only bakes in
// orientation), so we read it out of the JPEG's EXIF ourselves. EXIF lives in
// the APP1 segment at the very top of the file, so we only ever look at the
// first chunk -- there is no need to read a multi-megabyte photo to the end.

const EXIF_HEAD_BYTES = 131072; // 128 KB is plenty for the APP1 segment

/**
 * Read the capture time from a JPEG's EXIF as epoch ms, or null when the file
 * carries no readable timestamp (a PNG, a stripped JPEG, a HEIC the browser
 * never decoded to EXIF). Prefers DateTimeOriginal (when the shutter fired),
 * falling back to the IFD0 DateTime.
 */
export async function readExifTimestamp(file: File): Promise<number | null> {
  try {
    const head = file.slice(0, EXIF_HEAD_BYTES);
    const buf = await head.arrayBuffer();
    return parseExifDateTime(new DataView(buf));
  } catch {
    return null;
  }
}

const DATE_TIME = 0x0132; // DateTime (IFD0)
const DATE_TIME_ORIGINAL = 0x9003; // DateTimeOriginal (Exif sub-IFD)
const EXIF_IFD_POINTER = 0x8769; // pointer from IFD0 to the Exif sub-IFD

/**
 * Pull the capture time out of a JPEG byte buffer. Exported for testing; the
 * file-reading wrapper is readExifTimestamp. Returns epoch ms or null. Scans
 * JPEG segments for APP1/"Exif", then walks the TIFF IFDs; every read is bounds
 * checked, so a truncated head (we only slice the top of the file) returns null
 * rather than throwing.
 */
export function parseExifDateTime(view: DataView): number | null {
  const len = view.byteLength;
  if (len < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG (no SOI)

  let off = 2;
  while (off + 4 <= len) {
    if (view.getUint8(off) !== 0xff) break;
    const marker = view.getUint8(off + 1);
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no more metadata
    const segLen = view.getUint16(off + 2);
    if (segLen < 2) break;
    if (marker === 0xe1) {
      const ex = off + 4;
      // "Exif\0\0"
      if (ex + 6 <= len && view.getUint32(ex) === 0x45786966 && view.getUint16(ex + 4) === 0) {
        return parseTiff(view, ex + 6);
      }
    }
    off += 2 + segLen;
  }
  return null;
}

function parseTiff(view: DataView, base: number): number | null {
  const len = view.byteLength;
  if (base + 8 > len) return null;
  const bom = view.getUint16(base);
  const le = bom === 0x4949; // "II" little-endian; "MM" (0x4d4d) big-endian
  if (!le && bom !== 0x4d4d) return null;
  if (view.getUint16(base + 2, le) !== 0x002a) return null;

  const ifd0 = base + view.getUint32(base + 4, le);
  const dir0 = readDir(view, base, ifd0, le);
  if (!dir0) return null;

  // DateTimeOriginal lives in the Exif sub-IFD; prefer it, fall back to IFD0's
  // DateTime (the file's own timestamp), which most phone photos also carry.
  const ptr = dir0.get(EXIF_IFD_POINTER);
  if (ptr) {
    const sub = readDir(view, base, base + readLong(view, base, ptr, le), le);
    const dto = sub?.get(DATE_TIME_ORIGINAL);
    if (dto) {
      const ms = exifDateToMs(readAscii(view, base, dto, le));
      if (ms !== null) return ms;
    }
  }
  const dt = dir0.get(DATE_TIME);
  return dt ? exifDateToMs(readAscii(view, base, dt, le)) : null;
}

type Entry = { type: number; count: number; valueOff: number };

function readDir(
  view: DataView,
  base: number,
  dirOff: number,
  le: boolean,
): Map<number, Entry> | null {
  const len = view.byteLength;
  if (dirOff < base || dirOff + 2 > len) return null;
  const n = view.getUint16(dirOff, le);
  const map = new Map<number, Entry>();
  for (let i = 0; i < n; i++) {
    const e = dirOff + 2 + i * 12;
    if (e + 12 > len) break;
    map.set(view.getUint16(e, le), {
      type: view.getUint16(e + 2, le),
      count: view.getUint32(e + 4, le),
      valueOff: e + 8, // inline value, or a 4-byte offset from base when >4 bytes
    });
  }
  return map;
}

/** The LONG value of an entry (used for the Exif sub-IFD pointer). */
function readLong(view: DataView, _base: number, entry: Entry, le: boolean): number {
  return view.getUint32(entry.valueOff, le);
}

/** The ASCII string of an entry, bounds-checked; "" if unreadable. */
function readAscii(view: DataView, base: number, entry: Entry, le: boolean): string {
  const len = view.byteLength;
  const count = entry.count;
  const at = count <= 4 ? entry.valueOff : base + view.getUint32(entry.valueOff, le);
  if (at < 0 || at + count > len) return "";
  let s = "";
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/**
 * An EXIF datetime ("YYYY:MM:DD HH:MM:SS") as epoch ms, or null. Parsed as UTC
 * so the result is deterministic regardless of where the code runs; only the
 * ordering between photos matters, and every photo gets the same transform.
 */
export function exifDateToMs(s: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(ms) ? ms : null;
}

// --- Ordering and splitting (pure) -----------------------------------------

export type PhotoEntry = { time: number | null };

/**
 * The order to show the imported photos in, as a permutation of their
 * selection indices (0..n-1). EXIF capture time when every photo has one;
 * otherwise selection order, because a half-timed batch -- some photos had
 * their EXIF stripped -- would scramble unpredictably if we sorted on a mix of
 * times and gaps. Equal times keep selection order (stable).
 */
export function orderByCaptureTime(entries: PhotoEntry[]): number[] {
  const indices = entries.map((_, i) => i);
  const allTimed = entries.length > 0 && entries.every((e) => e.time !== null);
  if (!allTimed) return indices;
  return indices.sort(
    (a, b) => (entries[a].time as number) - (entries[b].time as number) || a - b,
  );
}

/**
 * Break positions for a fixed pages-per-student split: a new pile starts before
 * every Nth item, i.e. {N, 2N, ...} within range. These are positions into the
 * ordered list, not selection indices.
 */
export function everyNBreaks(total: number, perStudent: number): number[] {
  const n = Math.max(1, Math.floor(perStudent) || 1);
  const breaks: number[] = [];
  for (let i = n; i < total; i += n) breaks.push(i);
  return breaks;
}

/**
 * Split `total` ordered items into student piles at the given break positions
 * (a break at k starts a new pile before item k). Out-of-range and duplicate
 * breaks are ignored; always yields at least one pile when total > 0, and never
 * an empty pile. Each pile is a list of positions into the ordered list.
 */
export function groupByBreaks(total: number, breaks: Iterable<number>): number[][] {
  const cuts = new Set<number>();
  for (const b of breaks) {
    const k = Math.floor(b);
    if (k > 0 && k < total) cuts.add(k);
  }
  const piles: number[][] = [];
  let start = 0;
  for (const c of [...[...cuts].sort((a, b) => a - b), total]) {
    if (c <= start) continue;
    piles.push(Array.from({ length: c - start }, (_, k) => start + k));
    start = c;
  }
  return piles;
}
