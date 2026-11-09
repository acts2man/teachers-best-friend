// The legal pages must describe how the AI provider actually holds our
// requests TODAY (corrected 2026-11-09). Production sends longer requests as
// background jobs (store:true), which the provider keeps until we retrieve the
// result; we then request deletion, and under the provider's API data policy a
// request may still be retained up to 30 days for abuse monitoring. Proven
// when: no page still claims retention is switched off / disabled / that the
// provider does not retain or stores nothing beyond the response; every page
// that describes the provider hop states the 30-day abuse-monitoring ceiling
// and that it is not used for training; docs/student-data-flow section 4
// matches. These were false on main (the pages said retention was off), so
// this fails there.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LEGAL = [
  "content/legal/how-we-use-ai.md",
  "content/legal/privacy.md",
  "content/legal/student-data-privacy.md",
  "content/legal/dpa.md",
];
const FLOW = "docs/student-data-flow.md";
const read = (f) => readFileSync(f, "utf8");
// Prose wraps, so a phrase like "up to 30 days" can straddle a line break;
// collapse whitespace before matching a phrase.
const flat = (f) => read(f).replace(/\s+/g, " ");

// Claims that are no longer true now that production uses background jobs.
const FALSE_CLAIMS = [
  /retention switched off/i,
  /retention disabled/i,
  /with retention off/i,
  /does not retain (?:the )?(?:content|request)/i,
  /beyond what is needed to return a (?:response|result)/i,
  /beyond producing a response/i,
  /transiently,? not retained/i,
];

test("no legal page still claims the provider keeps nothing / retention is off", () => {
  for (const f of LEGAL) {
    const text = read(f);
    for (const re of FALSE_CLAIMS)
      assert.ok(!re.test(text), `${f} still contains a now-false retention claim: ${re}`);
  }
});

test("every page that describes the provider hop states the 30-day abuse-monitoring ceiling", () => {
  // The four legal pages and the data-flow doc each mention OpenAI/the provider
  // and must carry the real ceiling where they describe retention.
  for (const f of [...LEGAL, FLOW]) {
    const text = flat(f);
    assert.match(text, /up to 30 days/i, `${f} must state the up-to-30-day retention`);
    assert.match(text, /abuse monitoring/i, `${f} must say the 30 days is for abuse monitoring`);
  }
});

test("the pages describe background jobs and that we request deletion", () => {
  for (const f of ["content/legal/how-we-use-ai.md", "content/legal/privacy.md", "content/legal/student-data-privacy.md", "content/legal/dpa.md"]) {
    const text = read(f);
    assert.match(text, /background job/i, `${f} should explain the background-job hop`);
    assert.match(text, /delet/i, `${f} should say we ask the provider to delete the stored copy`);
  }
});

test("no page promises deletion within an hour (no sweep exists yet)", () => {
  for (const f of [...LEGAL, FLOW]) {
    const text = read(f);
    assert.ok(!/within (?:about )?an hour/i.test(text), `${f} must not promise within-an-hour deletion`);
  }
});

test("training is still correctly denied, and zero-data-retention is addressed honestly", () => {
  const sdp = flat("content/legal/student-data-privacy.md");
  assert.match(sdp, /not used to train|never used to train|prohibited from training/i);
  assert.match(sdp, /zero data retention/i, "the strongest page names ZDR so the ceiling is not mistaken for it");
  const flow = flat(FLOW);
  assert.match(flow, /store: ?true|background job/i);
  assert.match(flow, /not? (?:enabled )?zero data retention/i);
});
