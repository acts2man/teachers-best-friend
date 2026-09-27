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

test("the sample is zoomable", () => {
  assert.match(ui, /work-sample-overlay/, "an enlarge overlay exists");
  assert.match(ui, /setFull\(\(f\) => !f\)/, "tapping toggles full resolution");
});
