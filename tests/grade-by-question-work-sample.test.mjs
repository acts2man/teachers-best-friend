// Grade-by-question shows one student's actual work inside each answer group.
//
// The answer text alone isn't enough to decide partial credit, so each group
// shows a sample of one student's page. Two things must hold and are easy to
// regress, so they are pinned against the component source:
//   1. The image is the name-removed BODY crop (studentUploadIds), never the
//      name strip, and no student name is rendered in the sample.
//   2. The teacher can cycle to a different student's work when the first is
//      unclear.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("components/teacher-review.tsx", "utf8");

test("the work sample reads the name-removed body pages, not the name strip", () => {
  assert.match(ui, /function GroupWorkSample/, "the sample component exists");
  assert.match(
    ui,
    /a\.studentUploadIds\?\.\[id\]/,
    "it joins the group's students to their stored body-page uploads",
  );
  // studentUploadIds are body crops (the 18% name band is already removed and
  // never persisted). The name strip must never be shown.
  assert.ok(
    !/stripId|nameStrip|name_strip/.test(ui.slice(ui.indexOf("function GroupWorkSample"), ui.indexOf("function GradeByQuestion"))),
    "the sample never references a name strip",
  );
});

test("the sample is served from the authenticated uploads route as an image", () => {
  assert.match(ui, /"\/api\/uploads\/" \+ uploadId/, "renders the upload by id");
});

test("no student name is rendered inside the work sample", () => {
  const sample = ui.slice(
    ui.indexOf("function GroupWorkSample"),
    ui.indexOf("function GradeByQuestion"),
  );
  // The sample deliberately shows work without identity; nameFor / student.name
  // belong to the per-student review, not here.
  assert.ok(!/nameFor\(/.test(sample), "no nameFor() call in the sample");
  assert.ok(!/\.name\b/.test(sample), "no student .name rendered in the sample");
});

test("the teacher can see a different student's work from the same group", () => {
  assert.match(ui, /Show another student’s work/, "a cycle control is offered");
  assert.match(
    ui,
    /withWork\.length > 1/,
    "the cycle control appears only when the group has more than one student with work",
  );
});

test("the sample is zoomable, in the shared full-screen viewer", () => {
  // Michael (Android/Brave and Windows/Chrome, 7 Oct): the old in-page overlay
  // dimmed the screen and showed the page cut off at the top and bottom with no
  // way to scroll. Its position:fixed was boxed in by an ancestor. The shared
  // viewer is portaled to <body>, so it is the full screen.
  const sample = ui.slice(ui.indexOf("function GroupWorkSample"), ui.indexOf("function GradeByQuestion"));
  assert.match(sample, /<ImageViewer/, "the sample opens the shared viewer");
  assert.ok(!/work-sample-overlay/.test(ui), "the old in-page overlay is gone");
  const viewer = readFileSync("components/image-viewer.tsx", "utf8");
  assert.match(viewer, /setFull\(\(f\) => !f\)/, "tapping toggles full resolution");
});

test("every student photo in review opens in the shared viewer, not a new tab", () => {
  const review = ui.slice(ui.indexOf("Original student work"));
  assert.match(review, /setViewing\(id\)/);
  assert.ok(!/href=\{"\/api\/uploads\/" \+ id\}/.test(review.slice(0, 1200)), "no new-tab link for pages");
});

test("the sample is shown large by default, not a tap-to-open thumbnail", () => {
  // Ricky: tap-to-zoom isn't a real fix — the work must be readable at a glance.
  const css = readFileSync("app/globals.css", "utf8");
  const img = css.match(/\.work-sample-thumb img\{([^}]*)\}/)?.[1] ?? "";
  assert.match(img, /width:100%/, "the sample fills the group width");
  assert.ok(!/max-height:130px/.test(img), "no tiny thumbnail height");
  assert.ok(!/object-fit:cover/.test(img), "the whole page is shown, not a cropped band");
  const wrap = css.match(/\.work-sample\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(!/max-width:190px/.test(wrap), "the sample is no longer capped narrow");
  assert.match(wrap, /width:100%/, "the sample spans the answer group");
});
