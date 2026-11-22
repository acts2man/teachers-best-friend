// Where the Playwright Chromium lives. Prefer $CHROMIUM when set; otherwise use
// whatever version is installed under /opt/pw-browsers/chromium-*/ rather than
// a pinned number that drifts between sessions (review of #216).
import { readdirSync } from "node:fs";

export function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = "/opt/pw-browsers";
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
  const dir = dirs[dirs.length - 1];
  if (!dir) throw new Error(`No chromium-* install found under ${base}; set $CHROMIUM.`);
  return `${base}/${dir}/chrome-linux64/chrome`;
}
