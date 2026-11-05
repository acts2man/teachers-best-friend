// Blur tuning: the camera-controls.mjs page frames (and a denser written page),
// blurred by known amounts, scored the way the camera scores a capture.
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const r = buildSync({ entryPoints: ["lib/camera.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} }; new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
const { laplacianVariance } = m.exports;
const W = 720, H = 1280;
// The camera-controls.mjs page: white page, dark lines, dark table.
function page(pw, ph, dense) {
  const y = new Float32Array(W * H).fill(50);
  const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
  for (let r = y0; r < y0 + ph; r++) for (let c = x0; c < x0 + pw; c++) y[r * W + c] = 245;
  const step = Math.max(10, Math.round(ph / (dense ? 44 : 28)));
  for (let k = 3; k < (dense ? 42 : 26); k++) {
    const r0 = y0 + k * step;
    if (r0 > y0 + ph - step) break;
    const len = Math.round(pw * (0.5 + (0.4 * ((k * 37) % 10)) / 10));
    const thick = Math.max(2, Math.round(pw / 160));
    if (dense) {
      // "Handwriting": short strokes with gaps, like words.
      for (let c = x0 + Math.round(pw * 0.08); c < x0 + len; c++) {
        if (((c * 13 + k * 7) % 23) < 15) for (let t = 0; t < thick + ((c >> 3) % 3); t++) y[(r0 + t - 1) * W + c] = 25;
      }
    } else for (let t = 0; t < thick; t++) for (let c = x0 + Math.round(pw * 0.08); c < x0 + len; c++) y[(r0 + t) * W + c] = 20;
  }
  return y;
}
function gaussian(src, sigma) {
  if (!sigma) return src;
  const rad = Math.ceil(sigma * 3), k = [];
  let s = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let yy = 0; yy < H; yy++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += src[yy * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + rad]; tmp[yy * W + x] = a; }
  for (let yy = 0; yy < H; yy++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -rad; i <= rad; i++) a += tmp[Math.min(H - 1, Math.max(0, yy + i)) * W + x] * k[i + rad]; out[yy * W + x] = a; }
  return out;
}
function motion(src, len) {
  if (!len) return src;
  const out = new Float32Array(W * H);
  for (let yy = 0; yy < H; yy++) for (let x = 0; x < W; x++) { let a = 0; for (let i = 0; i < len; i++) a += src[Math.min(H - 1, yy + i) * W + x]; out[yy * W + x] = a / len; }
  return out;
}
// The camera's score: a 320-wide downscale (area average, as drawImage does), grey.
function score(src) {
  const sw = 320, sh = Math.round((H * sw) / W), fx = W / sw, fy = H / sh;
  const g = new Float32Array(sw * sh);
  for (let yy = 0; yy < sh; yy++) for (let x = 0; x < sw; x++) {
    let a = 0, n = 0;
    for (let j = Math.floor(yy * fy); j < Math.floor((yy + 1) * fy); j++) for (let i = Math.floor(x * fx); i < Math.floor((x + 1) * fx); i++) { a += src[j * W + i]; n++; }
    g[yy * sw + x] = Math.round(a / n);
  }
  return [laplacianVariance(g, sw, sh), directional(g, sw, sh), reblurRatio(g, sw, sh)];
}
// How much sharper the frame is than itself re-blurred (1-2-1 binomial, at
// the score size), in the weaker direction: content cancels out.
function reblurRatio(g, w, h) {
  const b = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    b[i] = (4 * g[i] + 2 * (g[i - 1] + g[i + 1] + g[i - w] + g[i + w]) + g[i - w - 1] + g[i - w + 1] + g[i + w - 1] + g[i + w + 1]) / 16;
  }
  const dir = (img, dx, dy) => {
    let q = 0, n = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const d = img[i] - img[i - dx - dy * w];
      q += d * d; n++;
    }
    return q / n;
  };
  const r = (dx, dy) => { const a = dir(g, dx, dy), c = dir(b, dx, dy); return a > 1e-6 ? (a - c) / a : 0; };
  return Math.round(100 * Math.min(r(1, 0), r(0, 1)));
}
// The weaker direction's second-difference variance: shake smears one
// direction and leaves the other sharp, which the plain Laplacian averages away.
function directional(g, w, h) {
  const v = (dx, dy) => {
    let s = 0, q = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = 2 * g[i] - g[i - dx - dy * w] - g[i + dx + dy * w];
      s += d; q += d * d; n++;
    }
    const m = s / n;
    return q / n - m * m;
  };
  return Math.min(v(1, 0), v(0, 1));
}
const pages = { "close (camera-controls)": page(620, 1080, false), "far (camera-controls)": page(300, 390, false), "close, written page": page(620, 1080, true) };
const rows = [];
for (const [name, img] of Object.entries(pages)) {
  for (const s of [0, 1, 1.5, 2, 3, 4, 6]) rows.push({ page: name, blur: "focus σ=" + s + "px", score: score(gaussian(img, s)).map(Math.round) });
  for (const l of [6, 12, 20]) rows.push({ page: name, blur: "shake " + l + "px", score: score(motion(img, l)).map(Math.round) });
}
console.log(JSON.stringify(rows));
