/**
 * Dependency-free page-edge detection and perspective correction.
 *
 * This is deliberately NOT OpenCV.js: an 8 MB wasm download is too heavy to
 * pull onto a mid-range phone on classroom wifi just to outline a page. It is a
 * few KB of our own code, dynamically imported only when the camera opens, and
 * it works on a small downscaled buffer so it stays smooth in a live loop.
 *
 * It is best-effort by design: `findDocumentQuad` returns null when it isn't
 * confident, and the camera then captures the full frame — detection never
 * blocks the teacher from taking the picture.
 *
 * Everything here operates on plain {data,width,height} (ImageData-shaped), so
 * it is pure and unit-testable without a canvas or a camera.
 */

export type Gray = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
export type Point = { x: number; y: number };
/** Corners in clockwise order from the top-left: [tl, tr, br, bl]. */
export type Quad = [Point, Point, Point, Point];

export type RGBA = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** Luma grayscale of an RGBA buffer. */
export function toGray(img: RGBA): Gray {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++)
    out[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return { data: out, width, height };
}

/** Sobel gradient magnitude, clamped to 0–255. */
export function sobel(gray: Gray): Gray {
  const { data, width, height } = gray;
  const out = new Uint8ClampedArray(width * height);
  const at = (x: number, y: number) => data[y * width + x];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      out[y * width + x] = Math.min(255, Math.hypot(gx, gy));
    }
  }
  return { data: out, width, height };
}

/** Order four points as [tl, tr, br, bl] by their x±y extremes. */
export function orderCorners(pts: Point[]): Quad {
  const byId = (fn: (p: Point) => number, min: boolean) =>
    pts.reduce((best, p) => (min ? fn(p) < fn(best) : fn(p) > fn(best)) ? p : best, pts[0]);
  const tl = byId((p) => p.x + p.y, true);
  const br = byId((p) => p.x + p.y, false);
  const tr = byId((p) => p.x - p.y, false);
  const bl = byId((p) => p.x - p.y, true);
  return [tl, tr, br, bl];
}

/** Shoelace area of a quad (absolute). */
export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Best-guess document quadrilateral, or null when not confident.
 *
 * Heuristic (fast, no dependency): take the strongest gradient pixels, then the
 * four corners of that edge cloud by x±y extremes — the standard quick
 * document-corner trick, which holds when the page fills most of the frame, as
 * it does when a teacher is scanning a worksheet. Rejects a result that is too
 * small or too thin to be a page, so a cluttered desk falls back to full frame.
 */
export function findDocumentQuad(
  img: RGBA,
  opts: { minAreaFraction?: number } = {},
): Quad | null {
  const minAreaFraction = opts.minAreaFraction ?? 0.18;
  const edges = sobel(toGray(img));
  const { data, width, height } = edges;
  // Adaptive threshold: keep pixels well above the mean gradient.
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  const threshold = Math.max(24, mean * 3);
  const pts: Point[] = [];
  // Ignore a 1px frame; sample every other pixel to stay light.
  for (let y = 2; y < height - 2; y += 2)
    for (let x = 2; x < width - 2; x += 2)
      if (data[y * width + x] >= threshold) pts.push({ x, y });
  if (pts.length < 24) return null;
  const quad = orderCorners(pts);
  // Reject degenerate/duplicate corners and pages too small to trust.
  const distinct = new Set(quad.map((p) => p.x + "," + p.y)).size;
  if (distinct < 4) return null;
  if (quadArea(quad) < minAreaFraction * width * height) return null;
  return quad;
}

/** Interior angle at `b` (between b→a and b→c), in degrees. */
function cornerAngle(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

/** Whether the quad is convex (all turns the same way). */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

export type ConfidenceOpts = {
  minAreaFraction?: number;
  sideTol?: number;
  angleTolDeg?: number;
  topMargin?: number;
};

/**
 * Whether a detected quad is convincingly a page — the gate for cropping and
 * for auto-snap. A wrong crop is worse than no crop, so we only trust a quad
 * that is large, convex, roughly rectangular (opposite sides similar, corners
 * near 90°), AND whose top edge sits near the top of the frame — so a crop can
 * never slice off the top band where the student writes their name. Anything
 * short of that returns false and the caller keeps the full, uncropped frame.
 */
export function isConfidentQuad(
  q: Quad,
  frameW: number,
  frameH: number,
  opts: ConfidenceOpts = {},
): boolean {
  const minAreaFraction = opts.minAreaFraction ?? 0.45;
  const sideTol = opts.sideTol ?? 0.25;
  const angleTolDeg = opts.angleTolDeg ?? 25;
  const topMargin = opts.topMargin ?? 0.12;
  if (quadArea(q) < minAreaFraction * frameW * frameH) return false;
  if (!isConvex(q)) return false;
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const rel = (a: number, b: number) => (Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b));
  const top = d(q[0], q[1]);
  const right = d(q[1], q[2]);
  const bottom = d(q[2], q[3]);
  const left = d(q[3], q[0]);
  if (rel(top, bottom) > sideTol || rel(left, right) > sideTol) return false;
  for (let i = 0; i < 4; i++) {
    const angle = cornerAngle(q[(i + 3) % 4], q[i], q[(i + 1) % 4]);
    if (Math.abs(angle - 90) > angleTolDeg) return false;
  }
  // The top edge (tl, tr) must be near the top of the frame, or a crop would
  // risk cutting into the page above it — where the name is.
  if (Math.min(q[0].y, q[1].y) > topMargin * frameH) return false;
  return true;
}

/** Max corner movement between two quads, in pixels (∞ if either is missing). */
export function quadDrift(a: Quad | null, b: Quad | null): number {
  if (!a || !b) return Infinity;
  let max = 0;
  for (let i = 0; i < 4; i++) max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return max;
}

/** Scale a quad from one coordinate space to another (e.g. detection→display). */
export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/**
 * Solve the 3x3 projective transform H mapping the four `from` points to the
 * four `to` points (h33 = 1), by Gaussian elimination on the 8x8 system.
 * Returns a length-9 row-major matrix, or null if the points are degenerate.
 */
export function solveHomography(from: Point[], to: Point[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-9) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Apply a 3x3 homography to a point. */
export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Output size for a warped quad: average of opposite edge lengths. */
export function outputSize(q: Quad): { width: number; height: number } {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.round((d(q[0], q[1]) + d(q[3], q[2])) / 2);
  const height = Math.round((d(q[0], q[3]) + d(q[1], q[2])) / 2);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Crop and straighten the region inside `quad` of `img` into an upright
 * rectangle, by inverse-mapping each output pixel through the homography and
 * sampling the source (nearest-neighbour — fast, and the frame is already
 * high-res). Returns the warped RGBA buffer.
 */
export function warpPerspective(img: RGBA, quad: Quad, out?: { width: number; height: number }): RGBA {
  const size = out ?? outputSize(quad);
  const { width: ow, height: oh } = size;
  const dst = [
    { x: 0, y: 0 },
    { x: ow, y: 0 },
    { x: ow, y: oh },
    { x: 0, y: oh },
  ];
  // Map output-rectangle coords back to source coords.
  const h = solveHomography(dst, quad);
  const outData = new Uint8ClampedArray(ow * oh * 4);
  if (!h) return { data: outData, width: ow, height: oh };
  const { data, width: iw, height: ih } = img;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const s = applyHomography(h, { x, y });
      const sx = Math.round(s.x);
      const sy = Math.round(s.y);
      const o = (y * ow + x) * 4;
      if (sx >= 0 && sx < iw && sy >= 0 && sy < ih) {
        const si = (sy * iw + sx) * 4;
        outData[o] = data[si];
        outData[o + 1] = data[si + 1];
        outData[o + 2] = data[si + 2];
        outData[o + 3] = 255;
      } else {
        outData[o + 3] = 255;
      }
    }
  }
  return { data: outData, width: ow, height: oh };
}
