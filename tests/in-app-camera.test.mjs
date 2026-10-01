// Every "take a photo" button now opens the in-app ScanCamera (single mode)
// with an upload fallback, instead of the phone's native camera. Ricky has
// never produced a camera capture on the native path, so the four remaining
// native-camera buttons -- blank test, answer key, reading passage, class
// roster -- were switched over. These assertions guard that they don't quietly
// revert to capture="environment".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  "blank test (teacher-scan)": "components/teacher-scan.tsx",
  "answer key (teacher-answer-key)": "components/teacher-answer-key.tsx",
  "reading passage (teacher-assessments)": "components/teacher-assessments.tsx",
  "class roster (teacher-classes)": "components/teacher-classes.tsx",
};

for (const [label, path] of Object.entries(files)) {
  test(`${label}: uses ScanCamera single mode, not the native camera`, () => {
    const src = readFileSync(path, "utf8");
    assert.match(src, /import \{ ScanCamera \} from "\.\/scan-camera"/, "imports ScanCamera");
    assert.match(src, /<ScanCamera[\s\S]*?mode="single"/, "renders ScanCamera in single mode");
    assert.match(src, /onFallback=/, "has an upload fallback");
    assert.doesNotMatch(src, /capture="environment"/, "no native-camera input left");
  });
}
