// Blur re-tuning on realistic pages (review of #200). The first tuning used
// clean synthetic pages: dark lines on white, no noise, no compression. A real
// phone photo is none of those, so each page here goes through what a photo
// does before the app scores it:
//
//   page -> out of focus (Gaussian, sigma px at 720 wide) -> camera sensor
//   noise (Gaussian, per pixel) and a little vignetting -> JPEG (quality 82,
//   as phone cameras save) -> decoded -> scored at the camera's 320-px size
//   with lib/camera.ts's own laplacianVariance and reblurRatio.
//
// Page types: light pencil on white; a grey photocopied worksheet (grey
// paper, printed lines and boxes); dense dark pen; a sparse page far away.
// Several noise seeds per case. Prints every score, then the thresholds the
// app uses and how each case is judged with BOTH measures required to say
// blurry. Run: node scripts/tune-blur-realistic.mjs
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const r = buildSync({ entryPoints: ["lib/camera.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
const { laplacianVariance, reblurRatio, isBlurry, BLUR_LAPLACIAN_MIN, BLUR_REBLUR_MIN } = m.exports;

const W = 720, H = 1280;
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function gauss(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- pages ----
function blank(table, paper, pw, ph) {
  const y = new Float32Array(W * H).fill(table);
  const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
  for (let r = y0; r < y0 + ph; r++) for (let c = x0; c < x0 + pw; c++) y[r * W + c] = paper;
  return { y, x0, y0, pw, ph };
}
/** Handwriting-like strokes: words of short wobbly strokes on ruled lines. */
function handwriting(p, ink, thick, rows, seed) {
  const rand = rng(seed);
  const step = Math.round(p.ph / (rows + 4));
  for (let k = 2; k < rows + 2; k++) {
    const base = p.y0 + k * step;
    let c = p.x0 + Math.round(p.pw * 0.08);
    const end = p.x0 + Math.round(p.pw * (0.55 + 0.35 * rand()));
    while (c < end) {
      const word = 18 + Math.floor(rand() * 50);
      for (let i = 0; i < word && c < end; i++, c++) {
        const h = Math.round(step * 0.35 * (0.6 + 0.4 * Math.sin(i * 0.7 + k)));
        // A vertical-ish stroke every few px, joined at the baseline.
        if (i % 5 < 2) for (let t = 0; t < h; t++) for (let d = 0; d < thick; d++) p.y[(base - t) * W + c + d] = ink;
        for (let d = 0; d < thick; d++) p.y[(base - (i % 7 === 0 ? h : 0)) * W + c] = ink;
      }
      c += 10 + Math.floor(rand() * 12);
    }
  }
  return p;
}
/** Printed worksheet lines and answer boxes. */
function printed(p, ink, seed) {
  const rand = rng(seed);
  const step = Math.round(p.ph / 30);
  for (let k = 2; k < 28; k++) {
    const r0 = p.y0 + k * step;
    if (k % 6 === 0) {
      // An answer box.
      const bx0 = p.x0 + Math.round(p.pw * 0.1), bx1 = p.x0 + Math.round(p.pw * 0.9);
      for (let c = bx0; c < bx1; c++) for (let t = 0; t < 2; t++) { p.y[(r0 + t) * W + c] = ink; p.y[(r0 + step * 2 + t) * W + c] = ink; }
      for (let rr = r0; rr < r0 + step * 2; rr++) for (let t = 0; t < 2; t++) { p.y[rr * W + bx0 + t] = ink; p.y[rr * W + bx1 + t] = ink; }
      continue;
    }
    // A line of print: letters as small blocks with gaps.
    let c = p.x0 + Math.round(p.pw * 0.08);
    const end = p.x0 + Math.round(p.pw * (0.6 + 0.3 * rand()));
    while (c < end) {
      const lw = 3 + Math.floor(rand() * 4);
      const lh = 7 + Math.floor(rand() * 4);
      for (let i = 0; i < lw; i++) for (let t = 0; t < lh; t++) if ((i + t) % 3) p.y[(r0 - t) * W + c + i] = ink;
      c += lw + 2 + (rand() < 0.2 ? 6 : 0);
    }
  }
  return p;
}

/** The camera-controls.mjs page of the first tuning: straight dark lines. */
function lines(p, seed) {
  const step = Math.max(10, Math.round(p.ph / 28));
  for (let k = 3; k < 26; k++) {
    const r0 = p.y0 + k * step;
    if (r0 > p.y0 + p.ph - step) break;
    const len = Math.round(p.pw * (0.5 + (0.4 * (((k + seed) * 37) % 10)) / 10));
    for (let t = 0; t < Math.max(2, Math.round(p.pw / 160)); t++)
      for (let c = p.x0 + Math.round(p.pw * 0.08); c < p.x0 + len; c++) p.y[(r0 + t) * W + c] = 20;
  }
  return p;
}

const PAGES = {
  "lines, close (first tuning)": (s) => lines(blank(50, 245, 620, 1080), s),
  "lines, far (first tuning)": (s) => lines(blank(50, 245, 300, 390), s),
  "light pencil": (s) => handwriting(blank(70, 238, 640, 1100), 165, 2, 24, s),
  "grey worksheet": (s) => handwriting(printed(blank(60, 200, 640, 1100), 45, s), 70, 2, 10, s + 1),
  "dense pen": (s) => handwriting(blank(50, 245, 640, 1100), 30, 3, 34, s),
  "far, sparse": (s) => handwriting(blank(50, 240, 300, 390), 30, 2, 12, s),
};

// ---- the camera ----
function gaussianBlur(src, sigma) {
  if (!sigma) return src;
  const rad = Math.ceil(sigma * 3), k = [];
  let s = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += src[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + rad]; tmp[y * W + x] = a; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x] * k[i + rad]; out[y * W + x] = a; }
  return out;
}
function sensor(src, noise, seed) {
  const rand = rng(seed * 7919 + 1);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / W, dy = (y - H / 2) / H;
    const vignette = 1 - 0.18 * (dx * dx + dy * dy) * 4;
    out[y * W + x] = Math.max(0, Math.min(255, Math.round(src[y * W + x] * vignette + noise * gauss(rand))));
  }
  return out;
}
async function jpegRoundTrip(gray) {
  const jpg = await sharp(Buffer.from(gray), { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 82 }).toBuffer();
  // Decoded as stored: take the first channel whatever sharp hands back.
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error("JPEG size changed");
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = data[i * info.channels];
  return out;
}
/** The camera's score size: 320 wide, area-averaged, as drawImage does. */
function scored(gray) {
  const sw = 320, sh = Math.round((H * sw) / W), fx = W / sw, fy = H / sh;
  const g = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let a = 0, n = 0;
    for (let j = Math.floor(y * fy); j < Math.floor((y + 1) * fy); j++) for (let i = Math.floor(x * fx); i < Math.floor((x + 1) * fx); i++) { a += gray[j * W + i]; n++; }
    g[y * sw + x] = Math.round(a / n);
  }
  return { laplacian: Math.round(laplacianVariance(g, sw, sh)), reblur: reblurRatio(g, sw, sh) };
}

export const SIGMAS = [0, 1, 1.5, 2, 3, 4];
// 0 is a clean page (the first tuning's case); 3 and 6 are a phone's sensor
// noise in good and in poor light, after the JPEG.
export const NOISE = (process.env.NOISE || "0,3,6").split(",").map(Number);
export const SEEDS = [1, 2, 3];

/** Every case: { page, sigma, noise, seed, laplacian, reblur }. */
export async function measure({ seeds = SEEDS, noises = NOISE } = {}) {
  const rows = [];
  for (const [name, make] of Object.entries(PAGES))
    for (const seed of seeds) {
      const base = make(seed).y;
      for (const sigma of SIGMAS) {
        const blurred = gaussianBlur(base, sigma);
        for (const noise of noises) {
          const s = scored(await jpegRoundTrip(sensor(blurred, noise, seed)));
          rows.push({ page: name, sigma, noise, seed, ...s });
        }
      }
    }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await measure();
  const by = new Map();
  for (const r of rows) {
    const k = r.page + " | sigma " + r.sigma;
    by.set(k, [...(by.get(k) || []), r]);
  }
  console.log("page | sigma | Laplacian (min-max) | re-blur % (min-max) | flagged with both required (of " + SEEDS.length * NOISE.length + ")");
  for (const [k, list] of by) {
    const L = list.map((r) => r.laplacian), R = list.map((r) => r.reblur);
    const flagged = list.filter((r) => isBlurry(r)).length;
    console.log(`${k} | ${Math.min(...L)}-${Math.max(...L)} | ${Math.min(...R)}-${Math.max(...R)} | ${flagged}`);
  }
  console.log(`thresholds: Laplacian < ${BLUR_LAPLACIAN_MIN} AND re-blur < ${BLUR_REBLUR_MIN}%`);
  const s = search(rows);
  console.log(`search, both required: best Laplacian < ${s.L} AND re-blur < ${s.R}% -- flags ${s.caught}/${s.blurry} of sigma >= 3, ${s.mid}/${s.borderline} at sigma 2, 0/${s.sharp} at sigma <= 1.5`);
}

/**
 * The thresholds, both required, that flag the most out-of-focus pages
 * (sigma >= 3) while flagging NO page at sigma <= 1.5, with a margin -- a
 * sharp page must never be questioned. Ties go to the lower thresholds.
 */
export function search(rows) {
  const sharp = rows.filter((r) => r.sigma <= 1.5);
  const blurry = rows.filter((r) => r.sigma >= 3);
  const borderline = rows.filter((r) => r.sigma === 2);
  let best = null;
  for (let L = 20; L <= 600; L += 5)
    for (let R = 10; R <= 60; R += 1) {
      const flag = (r) => r.laplacian < L && r.reblur < R;
      // With room to spare: still no sharp page flagged at 15% more on the
      // Laplacian and 3 points more on the re-blur ratio, so a phone a little
      // noisier than these does not start questioning sharp photos.
      if (sharp.some((r) => r.laplacian < L * 1.15 && r.reblur < R + 3)) continue;
      const caught = blurry.filter(flag).length;
      if (!best || caught > best.caught) best = { L, R, caught, mid: borderline.filter(flag).length };
    }
  return { ...best, blurry: blurry.length, borderline: borderline.length, sharp: sharp.length };
}
