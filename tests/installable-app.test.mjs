// PR5: the app is installable to the home screen -- a web manifest and icons so
// "Add to Home Screen" on iPhone/Android opens it full screen with its own icon.
// Deliberately NO service worker and NO offline caching of student data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, readdirSync } from "node:fs";

// A static manifest in public/ is served by both the Netlify/Next build and the
// vinext/Sites build (vinext does not emit app/manifest.ts, but serves public/
// statically and injects <link rel="manifest"> from metadata.manifest).
function renderManifest() {
  return JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
}

// ---------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------

test("the manifest declares a standalone, installable app", () => {
  const man = renderManifest();
  assert.equal(man.display, "standalone");
  assert.ok(man.name && man.short_name, "has a name and a short name");
  assert.ok(man.short_name.length <= 12, "short_name fits a home-screen label");
  assert.equal(man.start_url, "/");
  assert.ok(man.theme_color && man.background_color, "has theme + background colors");
});

test("the manifest lists 192, 512, and a maskable icon", () => {
  const man = renderManifest();
  const sizes = man.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192"));
  assert.ok(sizes.includes("512x512"));
  assert.ok(man.icons.some((i) => i.purpose === "maskable"));
  for (const i of man.icons) assert.equal(i.type, "image/png");
});

// ---------------------------------------------------------------
// The icon files exist
// ---------------------------------------------------------------

test("the referenced icon files exist and are non-empty", () => {
  const man = renderManifest();
  const files = ["apple-touch-icon.png", ...man.icons.map((i) => i.src.replace("/icons/", ""))];
  for (const f of new Set(files)) {
    const s = statSync("public/icons/" + f);
    assert.ok(s.size > 0, f + " exists and is non-empty");
  }
  // At least the three manifest icons plus the apple touch icon.
  assert.ok(readdirSync("public/icons").length >= 4);
});

// ---------------------------------------------------------------
// Layout wiring: apple touch icon, apple web app, theme color
// ---------------------------------------------------------------

test("the layout links the manifest, apple touch icon, apple web app, and theme color", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /manifest:"\/manifest\.webmanifest"/);
  assert.match(layout, /apple:"\/icons\/apple-touch-icon\.png"/);
  assert.match(layout, /appleWebApp:\{capable:true/);
  assert.match(layout, /viewport:Viewport=\{themeColor:/);
});

// ---------------------------------------------------------------
// No service worker, no offline caching of student data
// ---------------------------------------------------------------

test("there is no service worker registration anywhere in the source", () => {
  for (const dir of ["app", "components", "lib"]) {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = d + "/" + e.name;
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|mjs|js)$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          assert.doesNotMatch(
            src,
            /serviceWorker\s*\.\s*register|navigator\.serviceWorker/,
            p + " must not register a service worker",
          );
        }
      }
    };
    walk(dir);
  }
});
